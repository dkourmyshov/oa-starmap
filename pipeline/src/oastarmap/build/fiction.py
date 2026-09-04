"""Build the Orion's Arm fictional layer.

Runs after the real catalogues, because it binds against their published output
rather than their internals — the same contract the renderer consumes.

Unresolved landmarks do not fail the build. They are reported loudly, listed in
the manifest as pending, and bind automatically once the catalogue containing them
is added. The project's rule is that nothing may be dropped *silently*; a visible
pending list satisfies that without making the fictional layer unusable until
every astronomical catalogue exists.
"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from oastarmap.build.worlds import PRESENCE_KINDS, certain_by
from oastarmap.build.writer import write_array, write_json
from oastarmap.fiction.resolve import Binding, ResolutionReport, Resolver
from oastarmap.fiction.schema import AliasFile, FictionFile, LandmarkFile
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

# Column holding heliocentric distance in each catalogue's geometry array, and the
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


def _derived_years(events: Any) -> dict[str, int | None]:
    """When a landmark first appears, when it was settled, and when it ended.

    The same three questions the world file answers, computed by the same rule,
    because a cluster the setting colonised is a place with a history and the
    historical view has to date it the same way it dates a planet.
    """
    dated = [
        {"year_at": e.year_at, "kind": e.kind, "until_at": e.until_at, "precision": e.precision}
        for e in events
    ]
    presence = [certain_by(e) for e in dated if e["kind"] in PRESENCE_KINDS]
    settled = [certain_by(e) for e in dated if e["kind"] == "settled"]
    ended = [certain_by(e) for e in dated if e["kind"] == "abandoned"]
    return {
        "known_from_at": min(presence) if presence else None,
        "settled_at": min(settled) if settled else None,
        "ended_at": max(ended) if ended else None,
    }


def _attested_at(polities: list[str], epoch_of: dict[str, int | None]) -> int | None:
    """The year the *evidence* for an association depicts, where it says.

    Not a settlement date and not presented as one. The political maps draw the
    Middle Regions in 8000 A.T.; a landmark known only from them is attested in
    8000 and says nothing whatever about 400. Before this the historical view
    had no year for those bindings at all, so Cih, Mebsuta and Almaaz — read off
    that map and off nothing else — sat on the map through the Interplanetary
    Age, three thousand years before the source that names them depicts.

    The earliest epoch among the polities claiming it, because that is the
    first year any source puts the object in anyone's hands.
    """
    epochs = [epoch_of[p] for p in polities if epoch_of.get(p) is not None]
    return min(epochs) if epochs else None


def _load_positions(out_dir: Path) -> dict[str, np.ndarray]:
    """Heliocentric xyz per catalogue, indexed exactly as bindings are."""
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
    """Heliocentric distance in pc per catalogue, indexed exactly as bindings are.

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


def _member_counts(out_dir: Path) -> Counter[str]:
    """How many objects of any kind each polity actually holds.

    The legend used to hide a polity with no *landmark* bindings, which meant it
    hid seventeen of them: a landmark is a cluster or nebula read off the
    political maps, and most polities are represented here by colonies, add-on
    systems and worlds instead. The Caretaker Gods held eighteen objects and did
    not appear on the legend at all.

    Counted from the published output of the other builds rather than from their
    return values, the same way the Inner Sphere build reads the star arrays. All
    three are written before this one runs; a missing file means that dataset was
    skipped, which is a normal state rather than an error.
    """
    counts: Counter[str] = Counter()

    colonies = out_dir / "innersphere.json"
    if colonies.exists():
        for row in json.loads(colonies.read_text(encoding="utf-8")):
            for affiliation in row.get("affiliations", []):
                counts[affiliation] += 1

    # The add-on carries one affiliation a star; a world carries a list, because
    # Orion's Arm volumes interpenetrate and a place can be held by several at
    # once. Reading the singular field on both was a silent undercount: every
    # world in the file contributed nothing at all, so the Fomalhaut Acquisition
    # Society showed 1 for the six objects it holds, and any polity present only
    # through worlds counted zero and was dropped from the legend entirely.
    for name in ("oastars.names.json", "worlds.json"):
        path = out_dir / name
        if not path.exists():
            continue
        for row in json.loads(path.read_text(encoding="utf-8")):
            one = row.get("affiliation")
            if one:
                counts[one] += 1
            for affiliation in row.get("affiliations") or ():
                counts[affiliation] += 1

    return counts


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

    # HII regions are optional so the fictional layer still builds if that catalogue
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

    # And the full list, sparsely, for the few objects more than one polity
    # holds. The byte array above can only carry one, so on its own it made
    # Blanco 1 — Communion of Worlds in its article, Non-Coercive Zone on the
    # political maps — look like an ordinary single-holder landmark.
    shared: dict[str, dict[str, list[int]]] = {"cluster": {}, "hii": {}}
    for binding in report.bindings:
        if binding.kind not in shared or binding.index is None or binding.beyond_frontier:
            continue
        if len(binding.polities) < 2:
            continue
        shared[binding.kind][str(binding.index)] = [polity_index[p] for p in binding.polities]

    # What year each polity's evidence is *of*. The political maps depict 8000
    # A.T. and say so; the system articles carry no epoch at all.
    epoch_of = {
        polity.id: fiction.sources[polity.source].epoch_at
        for polity in fiction.polities
        if polity.source in fiction.sources
    }

    # Orion's Arm names for real objects. Resolved through the same table as a
    # landmark, so the file can write the designation the way a person would.
    landmark_names: list[dict[str, Any]] = []
    for entry in LandmarkFile.load(FICTION_DIR / "landmarks.yaml").landmarks:
        found = resolver.resolve(entry.catalogue, [])
        if found.index is None:
            raise ValueError(
                f"landmarks.yaml names {entry.catalogue!r}, which matches no catalogued object"
            )
        landmark_names.append(
            {
                "kind": found.kind,
                "index": found.index,
                "catalogue": found.matched_name or entry.catalogue,
                "name": entry.name,
                "article": entry.article,
                "note": entry.note,
                # The same three years a world carries, by the same rule. A
                # cluster can be settled too — Aleph Absolute around 3000, the
                # Enigma Cluster in 7222 — and without these the historical view
                # had no year for any of them and drew them in every century.
                **_derived_years(entry.events),
                "events": [
                    {
                        "year_at": e.year_at,
                        "kind": e.kind,
                        "note": e.note,
                        "until_at": e.until_at,
                        "precision": e.precision,
                    }
                    for e in sorted(entry.events, key=lambda e: (e.year_at, e.kind))
                ],
            }
        )

    # Landmarks plus every other kind of member, so the legend can show a polity
    # that holds only colonies.
    members = _member_counts(out_dir)
    for polity in fiction.polities:
        members[polity.id] += sum(1 for b in report.resolved if polity.id in b.polities)

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
                        "member_count": members.get(p.id, 0),
                        "beyond_frontier_count": sum(
                            1 for b in report.resolved if p.id in b.polities and b.beyond_frontier
                        ),
                    }
                    for p in fiction.polities
                ],
                "bindings": [
                    {**b.as_dict(), "attested_at": _attested_at(b.polities, epoch_of)}
                    for b in report.bindings
                ],
                "shared_polities": shared,
                "landmark_names": landmark_names,
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
            # Only worth showing when the catalogue knows the object by another
            # name — "Berkeley 42 (= NGC 6749)" is information, "Czernik 8
            # (= Czernik 8)" is noise.
            via = f" (= {matched})" if matched and matched != item["landmark"] else ""
            lines.append(f"               {item['landmark']}{via} at {item['distance_ly']:,} ly")
    if res["unresolved"]:
        lines.append(f"             {res['unresolved']} pending — catalogue not yet loaded:")
        pending = res["pending"]
        for i in range(0, len(pending), 6):
            lines.append("               " + ", ".join(pending[i : i + 6]))
    return "\n".join(lines)


__all__ = ["Binding", "build_fiction", "format_report"]
