"""Build the Orion's Arm star dataset from ``fiction/oa_stars.yaml``.

These are stars the setting asserts but the sky does not have: the suns of named
OA systems, and the populations OA gives to real clusters. They cannot be bound
to a real catalogue the way landmarks are, because there is nothing to bind to —
so unlike every other dataset here, their positions come from the fiction rather
than from an observation. That makes them the one place where the map draws
something unmeasured, so they are kept in their own dataset, rendered
differently, and separately toggleable.

The source file is tracked and hand-editable; it is produced once by
``oastarmap import-oastars`` from the Celestia add-on and is not re-read from
the archive at build time. See :mod:`oastarmap.importers.celestia`.

**Trap:** the imported ``distance_ly`` is light years, as Celestia's ``.stc``
format declares. Reading it as parsecs would push everything out by 3.26x while
still looking superficially plausible. The check that settles it: 52 of these
entries sit toward NGC 6633 with distances of 1222-1236, and NGC 6633 is at
389.5 pc (1270 ly). Read as light years they land at 375-379 pc, inside the
cluster's 22.5 pc radius. Read as parsecs they would sit three times beyond it.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import astropy.units as u
import numpy as np

from oastarmap.build.writer import CI_UNKNOWN, write_array, write_json
from oastarmap.fiction.schema import OAStarEntry, OAStarFile
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR
from oastarmap.transform.frame import (
    GALACTIC_AXES,
    MAX_PLAUSIBLE_DISTANCE_PC,
    STORAGE_UNIT,
    icrs_to_galactic_xyz,
)
from oastarmap.transform.photometry import parse_spectral_class, spectral_type_to_bv

STARS_FILE = "oa_stars.yaml"

SOURCE_URL = "http://www.orionsarm.com/fm_store/OAAddons1.zip"
SOURCE_PAGE = "https://www.orionsarm.com/xcms.php?r=oa-page&page=gen_OACelestia2"
SOURCE_TERMS = "https://www.orionsarm.com/Terms_Copyright_and_Submissions.html"
SOURCE_TITLE = "Orion's Arm Celestia add-on (OAAddons1)"

LIGHT_YEAR = u.lyr
"""The unit of the imported ``distance_ly``. See the module docstring."""

DEFAULT_ABS_MAG = 4.8
"""Stand-in where the add-on gives no magnitude — roughly solar."""

_OA_DESIGNATION = re.compile(r"^\s*(JD|YTS)\b", re.I)
"""Orion's Arm's own numbering for stars it invented.

Only the positive case is asserted. The absence of a JD or YTS prefix says the
entry is *named or externally designated* — it does not say the object is real.
An earlier version of this flag ran the test the other way round, matching real
catalogue prefixes, and duly reported Geminga and Arkab Prior B as not real when
both are real objects the add-on supplies because Celestia's catalogue omits
them. Which entries correspond to real objects is a question for a cross-match,
not for a regex over names.
"""


@dataclass
class OAStarStats:
    total_entries: int = 0
    accepted: int = 0
    excluded: Counter = field(default_factory=Counter)
    spectral: Counter = field(default_factory=Counter)
    name_collisions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "total_entries": self.total_entries,
            "accepted": self.accepted,
            "excluded": dict(sorted(self.excluded.items())),
            "spectral_types": dict(sorted(self.spectral.items())),
            "name_collisions": self.name_collisions,
        }


def _place(entries: list[OAStarEntry], stats: OAStarStats) -> list[dict[str, Any]]:
    """Turn imported entries into positioned records."""
    kept: list[OAStarEntry] = []
    for entry in entries:
        stats.total_entries += 1
        if (entry.distance_ly * u.lyr).to_value(u.pc) > MAX_PLAUSIBLE_DISTANCE_PC:
            stats.excluded["implausible_distance"] += 1
            continue
        kept.append(entry)

    if not kept:
        raise ValueError("No usable Orion's Arm stars in the source file")

    kept.sort(key=lambda e: (e.name, e.source_file))

    ra = np.array([e.ra_deg for e in kept]) * u.deg
    dec = np.array([e.dec_deg for e in kept]) * u.deg
    distance = np.array([e.distance_ly for e in kept]) * LIGHT_YEAR

    x, y, z = icrs_to_galactic_xyz(ra, dec, distance)
    xs = x.to_value(STORAGE_UNIT)
    ys = y.to_value(STORAGE_UNIT)
    zs = z.to_value(STORAGE_UNIT)
    distance_pc = distance.to_value(STORAGE_UNIT)

    records: list[dict[str, Any]] = []
    for i, entry in enumerate(kept):
        bv = spectral_type_to_bv(entry.spectral_type)
        abs_mag = entry.abs_mag
        if abs_mag is None or not math.isfinite(abs_mag):
            # Without a magnitude the panel has nothing to report, so give it a
            # sun-like value rather than dropping a position the source asserts.
            abs_mag = DEFAULT_ABS_MAG
            stats.excluded["absmag_defaulted"] += 1

        stats.spectral[entry.spectral_type or "(none)"] += 1
        records.append(
            {
                "name": entry.name,
                "comment": entry.comment,
                "system": entry.system,
                "spectral_type": entry.spectral_type,
                "spectral_class": parse_spectral_class(entry.spectral_type),
                "oa_designation": bool(_OA_DESIGNATION.match(entry.name)),
                "source_file": entry.source_file,
                "x": float(xs[i]),
                "y": float(ys[i]),
                "z": float(zs[i]),
                "abs_mag": float(abs_mag),
                "color_index": float(bv) if math.isfinite(bv) else float(CI_UNKNOWN),
                "distance": float(distance_pc[i]),
            }
        )

    # The add-on reuses "JD 518791" across two files for two different stars,
    # 617 pc and 157 pc away on opposite sides of the plane. Both are kept —
    # dropping either would discard a position the source asserts — but the
    # collision is recorded so a duplicate label is explained rather than a bug.
    seen = Counter(r["name"] for r in records)
    stats.name_collisions = sorted(name for name, n in seen.items() if n > 1)
    stats.accepted = len(records)
    return records


def build_oastars(stars_path: Path | None = None, out_dir: Path | None = None) -> dict[str, Any]:
    """Build the Orion's Arm star dataset and return its manifest entry."""
    stars_path = stars_path or FICTION_DIR / STARS_FILE
    out_dir = out_dir or DATA_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    stats = OAStarStats()
    records = _place(OAStarFile.load(stars_path).stars, stats)
    n = len(records)

    # Same five-component layout as the real star dataset, so the renderer can
    # reuse the colour path unchanged.
    positions = np.empty((n, 5), dtype=np.float32)
    names: list[dict[str, Any]] = []

    for i, record in enumerate(records):
        positions[i] = (
            record["x"],
            record["y"],
            record["z"],
            record["abs_mag"],
            record["color_index"],
        )
        names.append(
            {
                "name": record["name"],
                "comment": record["comment"],
                "system": record["system"],
                "spectral_type": record["spectral_type"],
                "distance_pc": round(record["distance"], 3),
                "oa_designation": record["oa_designation"],
                "source_file": record["source_file"],
            }
        )

    files = {
        "positions": write_array(out_dir / "oastars.bin", positions),
        "names": write_json(out_dir / "oastars.names.json", names),
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
                "units": [str(STORAGE_UNIT)] * 3 + ["mag", "B-V"],
                "ci_unknown_sentinel": float(CI_UNKNOWN),
                "note": (
                    "Identical layout to the real star dataset. B-V is derived from "
                    "the spectral type rather than measured, so colour here is an "
                    "approximation of an assertion."
                ),
            },
            "names": {"note": "Parallel array, one entry per star, same order."},
        },
        "files": files,
        "selection": {
            "rule": "every star in fiction/oa_stars.yaml",
            "note": (
                "Positions are asserted by the fiction, not observed. Not every "
                "entry is invented: Geminga, Arkab Prior B, EG 471 and two HD "
                "numbers are real objects the add-on supplies because Celestia's "
                "own catalogue omits them. The oa_designation flag marks only the "
                "entries using OA's own JD/YTS numbering, which are certainly "
                "invented; its absence is not a claim that an object is real. "
                "None of them matches anything in the real star dataset."
            ),
        },
        "stats": stats.as_dict(),
        "source": {
            "description": (
                "Stars from the Orion's Arm Celestia add-on: the suns of named OA "
                "systems, plus populations the setting gives to real clusters. "
                "Imported once into fiction/oa_stars.yaml, which is the tracked "
                "source of record; the archive is not read at build time."
            ),
            "citation": f"{SOURCE_TITLE}. {SOURCE_PAGE}",
            "url": SOURCE_URL,
            "terms": SOURCE_TERMS,
            "distance_unit": "light years, as Celestia .stc declares",
        },
    }
