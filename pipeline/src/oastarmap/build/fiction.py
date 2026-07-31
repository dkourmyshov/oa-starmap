"""Build the Orion's Arm fictional layer.

Runs after the real catalogs, because it binds against their published output
rather than their internals — the same contract the renderer consumes.

Unresolved landmarks do not fail the build. They are reported loudly, listed in
the manifest as pending, and bind automatically once the catalog containing them
is added. The project's rule is that nothing may be dropped *silently*; a visible
pending list satisfies that without making the fictional layer unusable until
every astronomical catalog exists.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from oastarmap.build.writer import write_array, write_json
from oastarmap.fiction.resolve import Binding, ResolutionReport, Resolver
from oastarmap.fiction.schema import AliasFile, FictionFile
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR

NO_POLITY = 0
"""Value in the per-cluster polity array meaning "no polity assigned".

Polity indices in that array are therefore 1-based, leaving 0 free as the
unassigned marker without needing a parallel mask.
"""


def build_fiction(
    fiction_dir: Path | None = None,
    out_dir: Path | None = None,
) -> dict[str, Any]:
    """Resolve landmark assignments and emit the fiction dataset."""
    fiction_dir = fiction_dir or FICTION_DIR
    out_dir = out_dir or DATA_OUT_DIR

    fiction = FictionFile.load(fiction_dir / "polities.yaml")
    aliases = AliasFile.load(fiction_dir / "aliases.yaml").aliases

    cluster_names_path = out_dir / "clusters.names.json"
    if not cluster_names_path.exists():
        raise FileNotFoundError(
            f"{cluster_names_path} not found — build the cluster dataset first."
        )
    cluster_names = json.loads(cluster_names_path.read_text(encoding="utf-8"))
    star_names = json.loads((out_dir / "stars.names.json").read_text(encoding="utf-8"))

    # HII regions are optional so the fictional layer still builds if that catalog
    # has not been produced yet; the landmarks simply stay pending.
    hii_path = out_dir / "hii.names.json"
    hii_names = json.loads(hii_path.read_text(encoding="utf-8")) if hii_path.exists() else []

    resolver = Resolver(cluster_names, star_names, aliases, hii_names)

    # A landmark may belong to several polities: OA's volumes interpenetrate, and
    # collapsing that to a single owner would destroy real information.
    landmark_polities: dict[str, list[str]] = defaultdict(list)
    order: list[str] = []
    for polity in fiction.polities:
        for landmark in polity.landmarks:
            if landmark not in landmark_polities:
                order.append(landmark)
            if polity.id not in landmark_polities[landmark]:
                landmark_polities[landmark].append(polity.id)

    report = ResolutionReport()
    for landmark in order:
        report.bindings.append(resolver.resolve(landmark, landmark_polities[landmark]))

    polity_index = {polity.id: i + 1 for i, polity in enumerate(fiction.polities)}

    # Per-object primary polity, for the renderer to colour by without a lookup.
    cluster_polity = np.zeros(len(cluster_names), dtype=np.uint8)
    hii_polity = np.zeros(len(hii_names), dtype=np.uint8)
    by_kind = {"cluster": cluster_polity, "hii": hii_polity}
    for binding in report.bindings:
        target = by_kind.get(binding.kind or "")
        if target is not None and binding.index is not None and binding.polities:
            target[binding.index] = polity_index[binding.polities[0]]

    files = {
        "cluster_polity": write_array(out_dir / "fiction.clusterpolity.bin", cluster_polity),
        "hii_polity": write_array(out_dir / "fiction.hiipolity.bin", hii_polity),
        "bindings": write_json(
            out_dir / "fiction.json",
            {
                "polities": [
                    {
                        "index": polity_index[p.id],
                        "id": p.id,
                        "name": p.name,
                        "color": p.color,
                        "uncertain": p.uncertain,
                        "landmark_count": len(p.landmarks),
                        "resolved_count": sum(1 for b in report.resolved if p.id in b.polities),
                    }
                    for p in fiction.polities
                ],
                "bindings": [b.as_dict() for b in report.bindings],
                "notes": fiction.notes,
            },
        ),
    }

    shared = [b.landmark for b in report.bindings if len(b.polities) > 1]

    return {
        "count": len(report.bindings),
        "polity_count": len(fiction.polities),
        "files": files,
        "layout": {
            "cluster_polity": {
                "note": (
                    "One byte per cluster, parallel to the clusters dataset. "
                    "0 means unassigned; other values are 1-based polity indices."
                ),
                "no_polity": NO_POLITY,
            },
            "hii_polity": {
                "note": (
                    "One byte per HII region, parallel to the hii dataset. "
                    "0 means unassigned; other values are 1-based polity indices."
                ),
                "no_polity": NO_POLITY,
            },
        },
        "resolution": report.as_dict(),
        "shared_landmarks": sorted(shared, key=str.lower),
        "source": {
            "description": (
                "Hand-authored Orion's Arm polity associations. Rough associations "
                "with diffuse, interpenetrating volumes — not borders."
            ),
            "citation": "Orion's Arm Universe Project (https://www.orionsarm.com/).",
        },
    }


def format_report(entry: dict[str, Any]) -> str:
    """Human-readable summary for the CLI."""
    res = entry["resolution"]
    lines = [
        f"  fiction    {res['resolved']}/{res['total']} landmarks bound "
        f"across {entry['polity_count']} polities"
    ]
    if res["unresolved"]:
        lines.append(f"             {res['unresolved']} pending — catalog not yet loaded:")
        pending = res["pending"]
        for i in range(0, len(pending), 6):
            lines.append("               " + ", ".join(pending[i : i + 6]))
    return "\n".join(lines)


__all__ = ["Binding", "build_fiction", "format_report"]
