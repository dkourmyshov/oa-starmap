"""Build the open cluster dataset.

Clusters are the map's first *volumetric* objects: each carries a physical radius,
not just a position, so it occupies space rather than being a point. They are also
its first real landmarks past the solar neighbourhood.

As with stars, nothing is dropped for being far away. A cluster is excluded only
when its distance or radius is missing or non-physical.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import astropy.units as u
import numpy as np

from oastarmap.build.writer import write_array, write_json
from oastarmap.fetch.base import open_maybe_gzip, sha256
from oastarmap.fetch.clusters import HUNT_REFFERT_2023
from oastarmap.paths import DATA_OUT_DIR
from oastarmap.transform.frame import (
    GALACTIC_AXES,
    MAX_PLAUSIBLE_DISTANCE_PC,
    STORAGE_UNIT,
    galactic_lb_to_xyz,
)

# Hunt & Reffert separate genuine open clusters from looser moving groups, and the
# catalog also carries some globulars. All three are kept; the distinction is
# preserved so the UI can filter and colour by it.
CLUSTER_TYPES = {"o": "open cluster", "m": "moving group", "g": "globular cluster"}
UNKNOWN_TYPE = "?"

TYPE_ORDER = ["o", "m", "g", UNKNOWN_TYPE]
TYPE_INDEX = {t: i for i, t in enumerate(TYPE_ORDER)}


@dataclass
class ClusterRecord:
    name: str
    all_names: str
    type_index: int
    n_members: int
    x: float
    y: float
    z: float
    distance: float
    distance_lo: float
    distance_hi: float
    radius_core: float
    radius_total: float
    log_age: float
    quality: str = ""


@dataclass
class ClusterStats:
    total_rows: int = 0
    accepted: int = 0
    excluded: Counter = field(default_factory=Counter)
    types: Counter = field(default_factory=Counter)

    def as_dict(self) -> dict[str, Any]:
        return {
            "total_rows": self.total_rows,
            "accepted": self.accepted,
            "excluded": dict(sorted(self.excluded.items())),
            "types": dict(sorted(self.types.items())),
        }


def _to_float(value: str) -> float:
    value = value.strip()
    if not value:
        return math.nan
    try:
        return float(value)
    except ValueError:
        return math.nan


def read_tsv(path: Path) -> tuple[list[str], list[list[str]]]:
    """Parse VizieR's TSV: comments, header, a units row, a dashes row, then data."""
    header: list[str] | None = None
    skip_remaining = 0
    rows: list[list[str]] = []

    for raw in open_maybe_gzip(path):
        line = raw.rstrip("\n").rstrip("\r")
        if not line or line.startswith("#"):
            continue
        if header is None:
            header = line.split("\t")
            skip_remaining = 2  # units row, then the dashed separator
            continue
        if skip_remaining:
            skip_remaining -= 1
            continue
        rows.append(line.split("\t"))

    if header is None:
        raise ValueError(f"No header found in {path}")
    return header, rows


def read_clusters(path: Path, stats: ClusterStats) -> list[ClusterRecord]:
    header, rows = read_tsv(path)
    ix = {name: i for i, name in enumerate(header)}

    required = ("Name", "GLON", "GLAT", "dist50")
    missing = [c for c in required if c not in ix]
    if missing:
        raise ValueError(f"Cluster table is missing columns {missing}; got {header}")

    def cell(row: list[str], column: str) -> str:
        i = ix.get(column, -1)
        return row[i] if 0 <= i < len(row) else ""

    kept: list[list[str]] = []
    for row in rows:
        stats.total_rows += 1

        if not cell(row, "Name").strip():
            stats.excluded["no_name"] += 1
            continue
        distance = _to_float(cell(row, "dist50"))
        if not math.isfinite(distance) or distance <= 0:
            stats.excluded["no_usable_distance"] += 1
            continue
        if distance > MAX_PLAUSIBLE_DISTANCE_PC:
            # Chiefly parallax blow-ups — the catalog contains "moving groups"
            # placed past 100 kpc, which cannot be moving groups. Also drops the
            # remote halo globulars, which are outside this map's remit.
            stats.excluded["implausible_distance"] += 1
            continue
        if not math.isfinite(_to_float(cell(row, "GLON"))) or not math.isfinite(
            _to_float(cell(row, "GLAT"))
        ):
            stats.excluded["no_position"] += 1
            continue
        kept.append(row)

    if not kept:
        raise ValueError(f"No usable clusters parsed from {path}")

    # Deterministic ordering, independent of how VizieR returned the rows.
    kept.sort(key=lambda r: (cell(r, "Name").strip(), _to_float(cell(r, "dist50"))))

    lon = np.array([_to_float(cell(r, "GLON")) for r in kept]) * u.deg
    lat = np.array([_to_float(cell(r, "GLAT")) for r in kept]) * u.deg
    dist = np.array([_to_float(cell(r, "dist50")) for r in kept]) * u.pc

    x, y, z = galactic_lb_to_xyz(lon, lat, dist)
    xs = x.to_value(STORAGE_UNIT)
    ys = y.to_value(STORAGE_UNIT)
    zs = z.to_value(STORAGE_UNIT)

    records: list[ClusterRecord] = []
    for i, row in enumerate(kept):
        type_code = cell(row, "Type").strip() or UNKNOWN_TYPE
        if type_code not in TYPE_INDEX:
            type_code = UNKNOWN_TYPE
        stats.types[CLUSTER_TYPES.get(type_code, "unknown")] += 1

        radius_total = _to_float(cell(row, "rtotpc"))
        radius_core = _to_float(cell(row, "r50pc"))
        distance = float(dist[i].to_value(u.pc))

        # A cluster with no measured extent still exists; give it the core radius,
        # or a nominal small size, rather than discarding a real object.
        if not math.isfinite(radius_total) or radius_total <= 0:
            radius_total = radius_core if math.isfinite(radius_core) else math.nan
        if not math.isfinite(radius_total) or radius_total <= 0:
            radius_total = 1.0
            stats.excluded["radius_defaulted"] += 1

        n_members = _to_float(cell(row, "N"))
        log_age = _to_float(cell(row, "logAge50"))
        lo = _to_float(cell(row, "dist16"))
        hi = _to_float(cell(row, "dist84"))

        records.append(
            ClusterRecord(
                name=cell(row, "Name").strip(),
                all_names=cell(row, "AllNames").strip(),
                type_index=TYPE_INDEX[type_code],
                n_members=int(n_members) if math.isfinite(n_members) else 0,
                x=float(xs[i]),
                y=float(ys[i]),
                z=float(zs[i]),
                distance=distance,
                distance_lo=lo if math.isfinite(lo) else distance,
                distance_hi=hi if math.isfinite(hi) else distance,
                radius_core=radius_core if math.isfinite(radius_core) else radius_total * 0.5,
                radius_total=radius_total,
                log_age=log_age if math.isfinite(log_age) else float("nan"),
                quality=cell(row, "CMDClHuman").strip(),
            )
        )

    stats.accepted = len(records)
    return records


def build_clusters(source_path: Path | None = None, out_dir: Path | None = None) -> dict[str, Any]:
    """Build the open cluster dataset and return its manifest entry."""
    source_path = source_path or HUNT_REFFERT_2023.path
    out_dir = out_dir or DATA_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    stats = ClusterStats()
    records = read_clusters(source_path, stats)
    n = len(records)

    # x, y, z, radius_total, radius_core, distance, distance_lo, distance_hi
    geometry = np.empty((n, 8), dtype=np.float32)
    meta = np.empty((n, 2), dtype=np.int32)  # type index, member count
    ages = np.empty(n, dtype=np.float32)
    names: list[dict[str, str | float]] = []

    for i, rec in enumerate(records):
        geometry[i] = (
            rec.x,
            rec.y,
            rec.z,
            rec.radius_total,
            rec.radius_core,
            rec.distance,
            rec.distance_lo,
            rec.distance_hi,
        )
        meta[i] = (rec.type_index, rec.n_members)
        ages[i] = rec.log_age
        names.append(
            {
                "name": rec.name,
                "aliases": rec.all_names,
                "quality": rec.quality,
            }
        )

    files = {
        "geometry": write_array(out_dir / "clusters.bin", geometry),
        "meta": write_array(out_dir / "clusters.meta.bin", meta),
        "ages": write_array(out_dir / "clusters.age.bin", ages),
        "names": write_json(out_dir / "clusters.names.json", names),
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
            "geometry": {
                "components": [
                    "x",
                    "y",
                    "z",
                    "radius_total",
                    "radius_core",
                    "distance",
                    "distance_lo",
                    "distance_hi",
                ],
                "units": [str(STORAGE_UNIT)] * 8,
                "note": (
                    "radius_total is the cluster's full extent and radius_core its "
                    "half-number radius, both physical. distance_lo/hi are the 16th "
                    "and 84th percentiles, i.e. the honest uncertainty band."
                ),
            },
            "meta": {"components": ["type_index", "member_count"]},
            "types": {"order": TYPE_ORDER, "labels": CLUSTER_TYPES},
            "ages": {"units": "log10(yr)", "note": "NaN where not determined."},
            "names": {"note": "Parallel array, one entry per cluster, same order."},
        },
        "files": files,
        "selection": {
            "rule": "complete catalog; no distance cutoff",
            "note": (
                "Clusters are excluded only for missing name, distance or position. "
                "The catalog's own X/Y/Z columns are galactocentric and are "
                "deliberately not used; positions come from GLON/GLAT/dist50."
            ),
        },
        "stats": stats.as_dict(),
        "source": {
            "description": HUNT_REFFERT_2023.description,
            "citation": HUNT_REFFERT_2023.citation,
            "url": HUNT_REFFERT_2023.url,
            "sha256": sha256(source_path),
        },
    }
