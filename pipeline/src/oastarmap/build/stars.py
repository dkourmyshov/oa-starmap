"""Build the star dataset from HYG.

Selection is by luminosity, never by distance: the catalog is taken whole, and a
star is dropped only when the data cannot place it (no usable distance, no
magnitude). This is what keeps the rendered field free of a spherical edge —
see the project README.
"""

from __future__ import annotations

import csv
import math
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import astropy.units as u
import numpy as np

from oastarmap.build.writer import CI_UNKNOWN, NO_CATALOG_ID, write_array, write_json
from oastarmap.fetch.base import open_maybe_gzip, sha256
from oastarmap.fetch.hyg import HYGLIKE
from oastarmap.paths import DATA_OUT_DIR
from oastarmap.transform.frame import (
    GALACTIC_AXES,
    MAX_PLAUSIBLE_DISTANCE_PC,
    STORAGE_UNIT,
    icrs_to_galactic_xyz,
)
from oastarmap.transform.photometry import (
    BV_MAX,
    BV_MIN,
    SPECTRAL_CLASSES,
    build_color_lut,
    parse_spectral_class,
)

HYG_NO_DISTANCE = 100000.0
"""HYG encodes 'distance unknown or dubious' as a value >= 100000 pc.

These are not stars a hundred kiloparsecs away; treating them as real would
scatter thousands of phantom objects across the far field.
"""

UNRELIABLE_DISTANCE_PC = 3000.0
"""Beyond this, distances in this catalog should be treated as indicative only.

Not a filter — stars past this are kept and drawn. It is recorded in the manifest
so the UI can mark such objects as uncertain rather than presenting a parsec-precise
figure it cannot justify.
"""

SOL_HYG_ID = 0

# Designation fields worth keeping. Everything here is a historical human name
# for a star, which is precisely the population that must survive to any distance.
#
# Constellation is deliberately *not* here: every star has one, so storing it as a
# string per star turns a sparse names file into a dense 2.6 MB one. It is
# categorical data and is packed into a byte array with a lookup table instead.
NAME_FIELDS = ("proper", "bayer", "flam", "gl", "bf")


@dataclass
class StarRecord:
    """One accepted star, in the frame and units this project stores."""

    hyg_id: int
    x: float
    y: float
    z: float
    absmag: float
    ci: float
    spectral_class: int
    hip: int
    hd: int
    constellation: str = ""
    names: dict[str, str] = field(default_factory=dict)


@dataclass
class BuildStats:
    """Accounting for every input row, so exclusions are visible, not silent."""

    total_rows: int = 0
    accepted: int = 0
    excluded: Counter = field(default_factory=Counter)
    distance_sources: Counter = field(default_factory=Counter)

    def as_dict(self) -> dict[str, Any]:
        return {
            "total_rows": self.total_rows,
            "accepted": self.accepted,
            "excluded": dict(sorted(self.excluded.items())),
            "distance_sources": dict(sorted(self.distance_sources.items())),
        }


def _to_float(value: str) -> float:
    """Parse a CSV cell to float, treating blanks as missing rather than zero."""
    value = value.strip()
    if not value:
        return math.nan
    try:
        return float(value)
    except ValueError:
        return math.nan


def _to_int(value: str) -> int:
    value = value.strip()
    if not value:
        return int(NO_CATALOG_ID)
    try:
        return int(float(value))
    except ValueError:
        return int(NO_CATALOG_ID)


def read_hyg(path: Path, stats: BuildStats) -> list[StarRecord]:
    """Parse HYG into accepted star records, recording why rows were dropped.

    Positions are recomputed from ra/dec/dist. HYG ships its own x/y/z, but those
    are in *equatorial* Cartesian coordinates (+x to the vernal equinox, +z to the
    north celestial pole), not galactic — using them directly would rotate the
    entire map by the ~62.9 degree obliquity between the two poles.
    """
    rows: list[dict[str, str]] = []
    lines = open_maybe_gzip(path)
    reader = csv.DictReader(lines)

    for row in reader:
        stats.total_rows += 1
        rows.append(row)

    # Deterministic order, independent of file layout.
    rows.sort(key=lambda r: int(r["id"]))

    kept: list[dict[str, str]] = []
    for row in rows:
        hyg_id = int(row["id"])
        dist = _to_float(row["dist"])
        absmag = _to_float(row["absmag"])

        if hyg_id == SOL_HYG_ID:
            # Sol is the origin of the frame; its zero distance is correct, not a
            # missing value, so it bypasses the distance checks.
            kept.append(row)
            continue

        if not math.isfinite(dist) or dist >= HYG_NO_DISTANCE:
            stats.excluded["no_usable_distance"] += 1
            continue
        if dist > MAX_PLAUSIBLE_DISTANCE_PC:
            stats.excluded["implausible_distance"] += 1
            continue
        if dist <= 0.0:
            stats.excluded["non_positive_distance"] += 1
            continue
        if not math.isfinite(absmag):
            stats.excluded["no_magnitude"] += 1
            continue
        if not math.isfinite(_to_float(row["ra"])) or not math.isfinite(_to_float(row["dec"])):
            stats.excluded["no_position"] += 1
            continue

        kept.append(row)

    if not kept:
        raise ValueError(f"No usable stars parsed from {path}")

    # Vectorised coordinate transform — one astropy call for the whole catalog.
    ra = np.array([_to_float(r["ra"]) for r in kept]) * u.hourangle
    dec = np.array([_to_float(r["dec"]) for r in kept]) * u.deg
    dist = np.array([max(_to_float(r["dist"]), 0.0) for r in kept]) * u.pc

    x, y, z = icrs_to_galactic_xyz(ra, dec, dist)
    xs = x.to_value(STORAGE_UNIT)
    ys = y.to_value(STORAGE_UNIT)
    zs = z.to_value(STORAGE_UNIT)

    records: list[StarRecord] = []
    for i, row in enumerate(kept):
        hyg_id = int(row["id"])
        ci = _to_float(row["ci"])
        names = {f: row[f].strip() for f in NAME_FIELDS if row.get(f, "").strip()}

        if hyg_id == SOL_HYG_ID:
            # Guarantee an exact origin rather than a float-rounded near-origin.
            px = py = pz = 0.0
        else:
            px, py, pz = float(xs[i]), float(ys[i]), float(zs[i])

        records.append(
            StarRecord(
                hyg_id=hyg_id,
                x=px,
                y=py,
                z=pz,
                absmag=_to_float(row["absmag"]),
                ci=ci if math.isfinite(ci) else float(CI_UNKNOWN),
                spectral_class=parse_spectral_class(row.get("spect", "")),
                hip=_to_int(row.get("hip", "")),
                hd=_to_int(row.get("hd", "")),
                constellation=row.get("con", "").strip(),
                names=names,
            )
        )
        stats.distance_sources[row.get("dist_src", "").strip() or "unknown"] += 1

    stats.accepted = len(records)
    return records


def build_stars(source_path: Path | None = None, out_dir: Path | None = None) -> dict[str, Any]:
    """Build the star dataset and return its manifest entry."""
    source_path = source_path or HYGLIKE.path
    out_dir = out_dir or DATA_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    stats = BuildStats()
    records = read_hyg(source_path, stats)
    n = len(records)

    # Index 0 is "no constellation"; the rest are sorted for deterministic output.
    constellations = ["", *sorted({r.constellation for r in records if r.constellation})]
    con_index = {name: i for i, name in enumerate(constellations)}

    # Interleaved so the renderer can upload one buffer and stride through it.
    positions = np.empty((n, 5), dtype=np.float32)
    ids = np.empty((n, 2), dtype=np.int32)
    classes = np.empty(n, dtype=np.uint8)
    cons = np.empty(n, dtype=np.uint8)
    names: dict[str, dict[str, str]] = {}

    for i, rec in enumerate(records):
        positions[i] = (rec.x, rec.y, rec.z, rec.absmag, rec.ci)
        ids[i] = (rec.hip, rec.hd)
        classes[i] = rec.spectral_class
        cons[i] = con_index[rec.constellation]
        if rec.names:
            names[str(i)] = rec.names

    files = {
        "positions": write_array(out_dir / "stars.bin", positions),
        "ids": write_array(out_dir / "stars.ids.bin", ids),
        "classes": write_array(out_dir / "stars.class.bin", classes),
        "constellations": write_array(out_dir / "stars.con.bin", cons),
        "names": write_json(out_dir / "stars.names.json", names),
        "color_lut": write_array(
            out_dir / "stars.colorlut.bin", build_color_lut().astype(np.float32)
        ),
    }

    return {
        "count": n,
        "frame": {
            "name": "galactic-cartesian-heliocentric",
            "unit": str(STORAGE_UNIT),
            "axes": GALACTIC_AXES,
            "origin": "Sol",
        },
        "layout": {
            "positions": {
                "components": ["x", "y", "z", "absmag", "ci"],
                "units": [str(STORAGE_UNIT)] * 3 + ["mag", "mag"],
                "note": (
                    "Apparent magnitude is intentionally not stored: it depends on "
                    "the observer, and the renderer computes it from absmag and the "
                    "camera's distance rather than Earth's."
                ),
                "ci_unknown_sentinel": float(CI_UNKNOWN),
            },
            "ids": {"components": ["hip", "hd"], "absent_sentinel": int(NO_CATALOG_ID)},
            "classes": {"values": list(SPECTRAL_CLASSES)},
            "constellations": {"values": constellations, "note": "Index 0 means none."},
            "names": {
                "fields": list(NAME_FIELDS),
                "note": "Sparse: keyed by star index, present only when designated.",
            },
            "color_lut": {
                "components": ["r", "g", "b"],
                "index": "linear in B-V",
                "bv_min": BV_MIN,
                "bv_max": BV_MAX,
            },
        },
        "files": files,
        "selection": {
            "rule": "luminosity-limited, not distance-limited",
            "note": (
                "The whole catalog is taken; stars are dropped only when the data "
                "cannot place them. No distance cutoff is applied to shape the sample."
            ),
            "quality_bounds": {
                "max_plausible_distance_pc": MAX_PLAUSIBLE_DISTANCE_PC,
                "why": (
                    "Rejects naive 1/parallax blow-ups (e.g. supergiants placed at "
                    "98 kpc, beyond the LMC) rather than trimming the sample. Sits "
                    "~14x beyond the map's region of interest, where fewer than "
                    "thirty stars lie, so it cannot produce a visible edge."
                ),
            },
            "reliability": {
                "unreliable_beyond_pc": UNRELIABLE_DISTANCE_PC,
                "why": (
                    "Distances past this come from inverting parallaxes close to "
                    "zero. Such stars are kept and drawn, but their distance should "
                    "be presented as indicative, not precise."
                ),
            },
        },
        "stats": stats.as_dict(),
        "source": {
            "description": HYGLIKE.description,
            "citation": HYGLIKE.citation,
            "url": HYGLIKE.url,
            "sha256": sha256(source_path),
        },
    }
