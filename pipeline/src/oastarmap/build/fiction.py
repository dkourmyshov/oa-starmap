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
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from oastarmap.build.writer import write_array, write_json
from oastarmap.fiction.resolve import Binding, ResolutionReport, Resolver
from oastarmap.fiction.schema import AliasFile, FictionFile
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR
from oastarmap.transform.frame import PC_TO_LY

NO_POLITY = 0
"""Value in the per-cluster polity array meaning "no polity assigned".

Polity indices in that array are therefore 1-based, leaving 0 free as the
unassigned marker without needing a parallel mask.
"""

TERRAGEN_FRONTIER_LY = 7000.0
"""How far the Terragen Sphere canonically reaches.

The published frontier after Tranquility is roughly 5,000-7,000 ly depending on
direction, so anything past 7,000 ly cannot literally be inside a polity's
volume. Several landmarks are past it anyway — Berkeley 42 at ~10,600 ly, and
Collinder 97, which the source map draws much closer to the Inner Sphere,
apparently on an older distance estimate.

Those associations are not errors in the fiction; the source is a schematic
sketch that places some landmarks in a polity's general *direction* rather than
inside its territory. So the binding is kept and flagged rather than dropped: the
object still resolves and still appears in the panel, but it is not painted in a
polity's colour, because doing so would assert a territorial claim the setting
does not make.
"""

FRONTIER_PC = TERRAGEN_FRONTIER_LY / PC_TO_LY

# Column holding heliocentric distance in each catalog's geometry array, and the
# stride of that array. Stars carry no distance column; theirs is |xyz|.
_DISTANCE_COLUMN = {"cluster": (8, 5), "hii": (7, 4)}


OUTLIER_DIRECTION_DEG = 90.0
OUTLIER_SPREAD_RATIO = 3.0
MIN_LANDMARKS_FOR_OUTLIERS = 4

"""Thresholds for :func:`_placement_outliers`; both must be exceeded."""


def _placement_outliers(
    bindings: list[Binding],
    positions: dict[str, np.ndarray],
    confirmed: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Landmarks that sit nowhere near the rest of their polity.

    This exists to catch a *name* mistake, not a geographic one. "Eagle Nebula"
    was transcribed for "Seagull Nebula" and duly bound to NGC 6611 in Serpens —
    a correct resolution of a wrong name, 200 degrees from every other Sophic
    landmark. It was caught by eye, which will not scale.

    Two independent criteria must both fire, because either alone is noisy:

    *Direction* — the angle from the polity's mean direction. Nearby objects
    subtend wide angles from Sol without being anywhere unusual, which is why
    S27, at 200 pc, sits 126 degrees from the Solar Dominion's mean and means
    nothing by it.

    *Distance from the polity's centre*, in units of that polity's own median
    spread. Alone this mostly re-finds the beyond-frontier landmarks, which are
    already reported and are not name errors.

    The centre is a per-axis median, not a mean. Two names slipping to the same
    wrong region would drag a mean far enough toward themselves to mask each
    other; a median barely moves.

    A wrong name usually lands the object somewhere else entirely, so it trips
    both. Advisory only: a slip and a genuinely remote holding are
    indistinguishable from here, and only the author can tell them apart — which
    is what ``confirmed_placements`` in the fiction file is for. Anything named
    there is the author's ruling and is not second-guessed.
    """
    confirmed = confirmed or set()

    by_polity: dict[str, list[tuple[Binding, np.ndarray]]] = defaultdict(list)
    for binding in bindings:
        table = positions.get(binding.kind or "")
        if table is None or binding.index is None or binding.index >= len(table):
            continue
        vector = np.asarray(table[binding.index], dtype=np.float64)
        if float(np.linalg.norm(vector)) <= 0:
            continue
        for polity in binding.polities:
            by_polity[polity].append((binding, vector))

    found: list[dict[str, Any]] = []
    for polity, members in sorted(by_polity.items()):
        if len(members) < MIN_LANDMARKS_FOR_OUTLIERS:
            continue

        points = np.array([vector for _, vector in members])
        units = points / np.linalg.norm(points, axis=1, keepdims=True)

        mean_direction = units.mean(axis=0)
        mean_norm = float(np.linalg.norm(mean_direction))
        if mean_norm <= 1e-9:
            continue
        mean_direction /= mean_norm

        centre = np.median(points, axis=0)
        offsets = np.linalg.norm(points - centre, axis=1)
        spread = float(np.median(offsets))
        if spread <= 0:
            continue

        for (binding, _), unit, offset in zip(members, units, offsets, strict=True):
            degrees = math.degrees(
                math.acos(float(np.clip(np.dot(unit, mean_direction), -1.0, 1.0)))
            )
            ratio = offset / spread
            if degrees <= OUTLIER_DIRECTION_DEG or ratio <= OUTLIER_SPREAD_RATIO:
                continue
            # Suppressed from the report, but deliberately still counted in the
            # centroid and spread above: a confirmed landmark is part of the
            # polity's shape, and dropping it would bias the test for its peers.
            if binding.landmark in confirmed:
                continue
            found.append(
                {
                    "landmark": binding.landmark,
                    "matched_name": binding.matched_name,
                    "polity": polity,
                    "degrees_from_polity_mean": round(degrees, 1),
                    "spread_ratio": round(ratio, 2),
                }
            )

    return sorted(found, key=lambda item: -item["degrees_from_polity_mean"])


def _load_positions(out_dir: Path) -> dict[str, np.ndarray]:
    """Heliocentric xyz per catalog, indexed exactly as bindings are."""
    positions: dict[str, np.ndarray] = {}
    for kind, (stride, _) in _DISTANCE_COLUMN.items():
        path = out_dir / f"{'clusters' if kind == 'cluster' else kind}.bin"
        if path.exists():
            positions[kind] = np.fromfile(path, dtype="<f4").reshape(-1, stride)[:, :3]
    stars = out_dir / "stars.bin"
    if stars.exists():
        positions["star"] = np.fromfile(stars, dtype="<f4").reshape(-1, 5)[:, :3]
    return positions


def _load_distances(out_dir: Path) -> dict[str, np.ndarray]:
    """Heliocentric distance in pc per catalog, indexed exactly as bindings are.

    Read back from the published binaries rather than recomputed, so the flag is
    derived from the same numbers the renderer draws.
    """
    distances: dict[str, np.ndarray] = {}

    for kind, (stride, column) in _DISTANCE_COLUMN.items():
        path = out_dir / f"{'clusters' if kind == 'cluster' else kind}.bin"
        if path.exists():
            distances[kind] = np.fromfile(path, dtype="<f4").reshape(-1, stride)[:, column]

    stars = out_dir / "stars.bin"
    if stars.exists():
        xyz = np.fromfile(stars, dtype="<f4").reshape(-1, 5)[:, :3]
        distances["star"] = np.linalg.norm(xyz, axis=1)

    return distances


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

    distances = _load_distances(out_dir)
    for binding in report.bindings:
        table = distances.get(binding.kind or "")
        if table is None or binding.index is None or binding.index >= len(table):
            continue
        binding.distance_pc = round(float(table[binding.index]), 3)
        binding.beyond_frontier = binding.distance_pc > FRONTIER_PC

    polity_index = {polity.id: i + 1 for i, polity in enumerate(fiction.polities)}

    # Per-object primary polity, for the renderer to colour by without a lookup.
    # Beyond-frontier landmarks are deliberately left unassigned here: the colour
    # is a territorial claim, and the setting does not make one that far out.
    cluster_polity = np.zeros(len(cluster_names), dtype=np.uint8)
    hii_polity = np.zeros(len(hii_names), dtype=np.uint8)
    by_kind = {"cluster": cluster_polity, "hii": hii_polity}
    for binding in report.bindings:
        target = by_kind.get(binding.kind or "")
        if target is None or binding.index is None or not binding.polities:
            continue
        if binding.beyond_frontier:
            continue
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
                        "source": p.source,
                        "landmark_count": len(p.landmarks),
                        "resolved_count": sum(1 for b in report.resolved if p.id in b.polities),
                        "beyond_frontier_count": sum(
                            1 for b in report.resolved if p.id in b.polities and b.beyond_frontier
                        ),
                    }
                    for p in fiction.polities
                ],
                "bindings": [b.as_dict() for b in report.bindings],
                "sources": {
                    key: source.model_dump() for key, source in sorted(fiction.sources.items())
                },
                "notes": fiction.notes,
            },
        ),
    }

    outliers = _placement_outliers(
        report.bindings, _load_positions(out_dir), set(fiction.confirmed_placements)
    )
    shared = [b.landmark for b in report.bindings if len(b.polities) > 1]
    beyond = sorted(
        (b for b in report.bindings if b.beyond_frontier),
        key=lambda b: -(b.distance_pc or 0),
    )

    return {
        "count": len(report.bindings),
        "polity_count": len(fiction.polities),
        "frontier": {
            "ly": TERRAGEN_FRONTIER_LY,
            "pc": round(FRONTIER_PC, 3),
            "note": (
                "Canonical reach of the Terragen Sphere. Landmarks past it keep "
                "their association but are not painted in a polity colour: the "
                "source map places some of them in a polity's general direction "
                "rather than inside its volume."
            ),
            "flagged": [
                {
                    "landmark": b.landmark,
                    "matched_name": b.matched_name,
                    "distance_ly": round((b.distance_pc or 0) * PC_TO_LY),
                    "polities": b.polities,
                }
                for b in beyond
            ],
        },
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
        "placement_outliers": {
            "threshold_deg": OUTLIER_DIRECTION_DEG,
            "threshold_spread_ratio": OUTLIER_SPREAD_RATIO,
            "note": (
                "Landmarks both pointing away from their polity's mean direction "
                "and lying far outside its own spread — the signature of a "
                "mis-transcribed name rather than a remote holding. A proofreading "
                "aid for name errors, not a model of polity shape, and it has no "
                "standing against the fiction: list a landmark under "
                "confirmed_placements to settle it permanently."
            ),
            "confirmed": sorted(fiction.confirmed_placements),
            "found": outliers,
        },
        "source": {
            "description": (
                "Hand-authored Orion's Arm polity associations. Rough associations "
                "with diffuse, interpenetrating volumes — not borders. Each polity "
                "cites the source its landmark list was read from."
            ),
            "citation": "Orion's Arm Universe Project (https://www.orionsarm.com/).",
            "cited": sorted({p.source for p in fiction.polities if p.source}),
        },
    }


def format_report(entry: dict[str, Any]) -> str:
    """Human-readable summary for the CLI."""
    res = entry["resolution"]
    lines = [
        f"  fiction    {res['resolved']}/{res['total']} landmarks bound "
        f"across {entry['polity_count']} polities"
    ]
    outliers = entry["placement_outliers"]["found"]
    if outliers:
        lines.append(f"             {len(outliers)} misplaced — check for a wrong name:")
        for item in outliers:
            lines.append(
                f"               {item['landmark']} is "
                f"{item['degrees_from_polity_mean']:.0f} deg and "
                f"{item['spread_ratio']:.1f}x the spread from {item['polity']}"
            )
        lines.append("               (if correct, add to confirmed_placements to silence)")

    flagged = entry["frontier"]["flagged"]
    if flagged:
        lines.append(
            f"             {len(flagged)} past the {entry['frontier']['ly']:,.0f} ly "
            f"frontier — bound, but not polity-coloured:"
        )
        for item in flagged:
            matched = (item["matched_name"] or "").replace("_", " ")
            # Only worth showing when the catalog knows the object by another
            # name — "Berkeley 42 (= NGC 6749)" is information, "Czernik 8
            # (= Czernik 8)" is noise.
            via = f" (= {matched})" if matched and matched != item["landmark"] else ""
            lines.append(f"               {item['landmark']}{via} at {item['distance_ly']:,} ly")
    if res["unresolved"]:
        lines.append(f"             {res['unresolved']} pending — catalog not yet loaded:")
        pending = res["pending"]
        for i in range(0, len(pending), 6):
            lines.append("               " + ", ".join(pending[i : i + 6]))
    return "\n".join(lines)


__all__ = ["Binding", "build_fiction", "format_report"]
