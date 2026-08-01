"""Build the Inner Sphere colony dataset.

Every star within 100 light years that Orion's Arm has named. Unlike the Celestia
stars, these are not new objects: each row names a star the catalogue already
contains, so the work is resolution rather than placement.

Resolution is checkable, which is unusual and worth exploiting. The source gives
a distance for every row, so a match can be *verified*: a wrong match on a
plausible name — and star names are full of plausible near-misses — almost always
lands at the wrong distance. Disagreement beyond 50% rejects the match; between
15% and 50% the row is kept and flagged, because the source predates Gaia.

Some rows cannot resolve at all. The table includes 2MASS, WISE, DENIS, SCR and
Luhman designations, and none of those catalogues has any representation in HYG;
those are recent faint discoveries, which is the gap GCNS exists to fill. They
are reported separately from ordinary failures, because no amount of alias work
will fix them.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from oastarmap.build.writer import write_json
from oastarmap.fiction.schema import InnerSphereFile
from oastarmap.fiction.starnames import StarResolver, is_absent_catalogue, verify_distance
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR
from oastarmap.transform.frame import PC_TO_LY

INNER_SPHERE_FILE = "inner_sphere.yaml"

SOURCE_URL = "https://www.orionsarm.com/eg-topic/45bcbcab90032"
SOURCE_TITLE = "The Stars of the Inner Sphere"

DISTANCE_AGREES = 0.15
DISTANCE_WRONG_STAR = 0.5
"""Two thresholds, because a distance disagreement has two possible causes.

Within 15% the match is confirmed. Beyond 50% it is almost certainly a different
star and is rejected. In between it is *flagged and kept*: the source's figures
are rounded and predate Gaia, so genuine disagreement is expected. Xi Ursae
Majoris is the case that settled this — the source says 28.49 ly and HYG 33.97,
a 19% gap that reflects an older parallax rather than a wrong star. Rejecting it
would have discarded five correct rows to protect against nothing.
"""


@dataclass
class InnerSphereStats:
    total_rows: int = 0
    resolved: int = 0
    methods: Counter = field(default_factory=Counter)
    rejected_distance: list[dict[str, Any]] = field(default_factory=list)
    distance_disagreement: list[dict[str, Any]] = field(default_factory=list)
    unresolved: list[str] = field(default_factory=list)
    absent_catalogue: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "total_rows": self.total_rows,
            "resolved": self.resolved,
            "methods": dict(sorted(self.methods.items())),
            "rejected_distance": self.rejected_distance,
            "distance_disagreement": self.distance_disagreement,
            "unresolved": sorted(self.unresolved),
            "absent_catalogue": sorted(self.absent_catalogue),
        }


def _to_float(value: str) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return math.nan


def build_inner_sphere(
    source_path: Path | None = None,
    out_dir: Path | None = None,
) -> dict[str, Any]:
    """Resolve the Inner Sphere table against the star catalogue."""
    source_path = source_path or FICTION_DIR / INNER_SPHERE_FILE
    out_dir = out_dir or DATA_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    import json

    star_names = json.loads((out_dir / "stars.names.json").read_text(encoding="utf-8"))
    positions = np.fromfile(out_dir / "stars.bin", dtype="<f4").reshape(-1, 5)
    ids = np.fromfile(out_dir / "stars.ids.bin", dtype="<i4").reshape(-1, 2)
    constellation_bytes = np.fromfile(out_dir / "stars.con.bin", dtype=np.uint8)

    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    constellation_values = manifest["datasets"]["stars"]["layout"]["constellations"]["values"]
    constellation_of = {
        i: constellation_values[code]
        for i, code in enumerate(constellation_bytes)
        if code < len(constellation_values) and constellation_values[code]
    }

    resolver = StarResolver(
        star_names,
        hip_ids={int(v): i for i, v in enumerate(ids[:, 0]) if v != -1},
        hd_ids={int(v): i for i, v in enumerate(ids[:, 1]) if v != -1},
        constellation_of=constellation_of,
    )

    stats = InnerSphereStats()
    source = InnerSphereFile.load(source_path)
    colonies: list[dict[str, Any]] = []

    for row in source.systems:
        stats.total_rows += 1
        match = resolver.resolve(row.star)

        if match is None:
            if is_absent_catalogue(row.star):
                stats.absent_catalogue.append(row.star)
            else:
                stats.unresolved.append(row.star)
            continue

        source_ly = _to_float(row.distance_ly)
        catalogue_ly = float(np.linalg.norm(positions[match.index, :3])) * PC_TO_LY
        disagreement = 0.0
        if math.isfinite(source_ly) and source_ly > 0:
            disagreement = abs(catalogue_ly - source_ly) / source_ly

        report = {
            "star": row.star,
            "method": match.method,
            "source_ly": round(source_ly, 2),
            "catalogue_ly": round(catalogue_ly, 2),
        }
        if math.isfinite(source_ly) and disagreement > DISTANCE_WRONG_STAR:
            # Resolved to *a* star, but not the one the source is describing.
            stats.rejected_distance.append(report)
            continue
        if not verify_distance(catalogue_ly, source_ly, DISTANCE_AGREES):
            # Kept, but the two sources genuinely disagree about where it is.
            stats.distance_disagreement.append(report)

        stats.methods[match.method] += 1
        stats.resolved += 1
        colonies.append(
            {
                "star_index": match.index,
                "star": row.star,
                "colony": row.colony,
                "spectral_type": row.spectral_type,
                "mass_sol": row.mass_sol,
                "luminosity_sol": row.luminosity_sol,
                "distance_ly": round(catalogue_ly, 3),
                "method": match.method,
                "distance_disagrees": disagreement > DISTANCE_AGREES,
            }
        )

    colonies.sort(key=lambda c: (c["distance_ly"], c["star"]))

    files = {
        "colonies": write_json(out_dir / "innersphere.json", colonies),
    }

    return {
        "count": len(colonies),
        "layout": {
            "colonies": {
                "note": (
                    "One entry per resolved row. star_index points into the star "
                    "dataset; the colony name is what Orion's Arm calls that system."
                )
            }
        },
        "files": files,
        "selection": {
            "rule": "every row of the Inner Sphere table that resolves and verifies",
            "note": (
                "A row is kept when its name resolves to a catalogue star that "
                f"sits within {DISTANCE_WRONG_STAR:.0%} of the distance the source "
                f"gives; beyond that it is a different star. Between "
                f"{DISTANCE_AGREES:.0%} and {DISTANCE_WRONG_STAR:.0%} the row is "
                "kept and flagged, because the source predates Gaia and genuine "
                "disagreement is expected. Rows naming 2MASS, WISE, DENIS, SCR or "
                "Luhman objects cannot resolve at all: none of those catalogues "
                "appears in HYG, and they are counted separately."
            ),
        },
        "stats": stats.as_dict(),
        "wormholes": {
            "count": len(source.wormholes),
            "note": (
                "Imported and tracked in fiction/inner_sphere.yaml, but not yet "
                "built: links between systems are a different kind of object from "
                "anything the renderer currently draws."
            ),
        },
        "source": {
            "description": (
                "Orion's Arm colony names for the stars within 100 light years, "
                "from the Encyclopaedia Galactica."
            ),
            "citation": f"{SOURCE_TITLE}. {SOURCE_URL}",
            "url": SOURCE_URL,
        },
    }


def format_report(entry: dict[str, Any]) -> str:
    """Human-readable summary for the CLI."""
    stats = entry["stats"]
    lines = [
        f"  inner      {stats['resolved']}/{stats['total_rows']} colonies resolved "
        f"({entry['wormholes']['count']} wormhole rows imported, not yet built)"
    ]
    if stats["absent_catalogue"]:
        lines.append(
            f"             {len(stats['absent_catalogue'])} name catalogues absent "
            f"from HYG entirely (2MASS, WISE, DENIS, SCR, Luhman)"
        )
    if stats["rejected_distance"]:
        lines.append(
            f"             {len(stats['rejected_distance'])} rejected — resolved to a "
            f"star at the wrong distance:"
        )
        for item in stats["rejected_distance"][:5]:
            lines.append(
                f"               {item['star']} — source {item['source_ly']} ly, "
                f"catalogue {item['catalogue_ly']} ly"
            )
    if stats["distance_disagreement"]:
        lines.append(
            f"             {len(stats['distance_disagreement'])} kept but flagged — "
            f"source and catalogue disagree on distance"
        )
    if stats["unresolved"]:
        lines.append(f"             {len(stats['unresolved'])} unresolved by name")
    return "\n".join(lines)
