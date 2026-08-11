"""Build the canonical Orion's Arm worlds from ``fiction/worlds.yaml``.

The interesting part is that these positions are not all the same kind of thing.
The setting locates places the way an observer would — a distance and a
constellation, or a distance and a direction borrowed from a nearby star, or a
catalogue star outright — and those differ in how much they pin down.

A world given as "805 ly, in Canis Major" has an exactly known radius and a
direction good only to the width of the constellation. Drawing it as a dot would
assert three coordinates when the source gave one and a half. So every world
carries the method that placed it and, with it, ``direction_error_deg``: the
half-angle of the cone the source actually allows. The renderer draws that circle
rather than hiding it, and the panel names the method.

Worlds that bind to something already on the map — a catalogue star, an add-on
star — contribute no position of their own. They attach their name, article and
affiliation to the object that is already there, which is the whole point of
binding rather than duplicating.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import astropy.units as u
import numpy as np

from oastarmap.build.writer import write_json
from oastarmap.fiction.resolve import fold_diacritics
from oastarmap.fiction.schema import (
    ConstellationFile,
    FictionFile,
    OAStarFile,
    OASystemFile,
    World,
    WorldFile,
    parse_distance,
)
from oastarmap.fiction.starnames import StarResolver
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR
from oastarmap.transform.frame import PC_TO_LY, STORAGE_UNIT, icrs_to_galactic_xyz

WORLDS_FILE = "worlds.yaml"
CONSTELLATIONS_FILE = "constellations.yaml"

SOURCE_TITLE = "Orion's Arm Encyclopaedia Galactica"
SOURCE_URL = "https://www.orionsarm.com/"

#: Direction error to attribute to each method, before the constellation lookup.
EXACT = 0.0

#: How far a stated distance may sit from the catalogue's before it is an error.
#:
#: Generous, because the two are allowed to disagree: Orion's Arm quotes rounded
#: figures from pre-Gaia sources, and gaps of a fifth are ordinary. What this
#: catches is the other thing entirely — a catalogue number that resolved to the
#: wrong star, where the gap is a factor of several.
DISTANCE_TOLERANCE = 0.35


#: Event kinds that put a world on a map of the sphere at a given year.
#:
#: A location is on the map once somebody has been there, whether or not they
#: stayed — an unvisited place cannot appear, but a visited one is known even if
#: the visit was a probe that flew on.
#:
#: ``reported`` counts, and is the one that needs saying. It marks the date the
#: setting *records* where the event was plainly earlier, so as a presence date
#: it is an upper bound rather than the truth: Stanislaw is reported discovered
#: in 9920 and was found some time in the 9700s. An upper bound is still the
#: best answer available, and excluding it left Stanislaw off the timeline
#: entirely, which is a worse answer than a late one.
PRESENCE_KINDS = ("visited", "settled", "contact", "stewardship", "transferred", "reported")


@dataclass
class WorldStats:
    total: int = 0
    by_method: Counter = field(default_factory=Counter)
    unlocated: list[str] = field(default_factory=list)
    unresolved: list[str] = field(default_factory=list)
    distance_conflicts: list[str] = field(default_factory=list)
    dated: int = 0
    undated: list[str] = field(default_factory=list)
    earliest: int | None = None
    latest: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "by_method": dict(sorted(self.by_method.items())),
            "unlocated": self.unlocated,
            "unresolved": self.unresolved,
            "distance_conflicts": self.distance_conflicts,
            "dated": self.dated,
            "undated": self.undated,
            "epoch_range_at": [self.earliest, self.latest],
        }


def approximate_extent_ly(distance_pc: float, error_deg: float) -> float:
    """How wide the direction error is, in light years, at a given distance.

    Carried in the data rather than left to the renderer, because it is the
    figure that makes the uncertainty legible: Corambytia's 13-degree
    constellation is 350 light years across at 1,500 ly, which is more than the
    protectorate being placed inside it.
    """
    return float(distance_pc * PC_TO_LY * np.tan(np.radians(error_deg)))


def _certain_by(event: dict[str, Any]) -> int:
    """The earliest year we can be sure the event had happened.

    The safe end of whatever the source hedged. "Between 1500 and 2100" is
    certain only by 2100; "before 1644" is certain by 1644; a span that ran from
    4496 to 4530 had begun in 4496. Taking the optimistic end instead would put
    places on a historical map years before the sources support.
    """
    if event["precision"] == "between" and event["until_at"] is not None:
        return int(event["until_at"])
    return int(event["year_at"])


def _load_star_lookup(
    out_dir: Path,
    constellation_values: list[str] | None,
) -> tuple[StarResolver, dict[int, int], dict[int, int]]:
    """Rebuild the name resolver from the published star dataset.

    Reads the arrays the star build wrote, but takes the constellation table from
    that build's return value rather than from the manifest on disk. The manifest
    is not written until every dataset is built, so reading it here would mean
    depending on the *previous* build's copy — which works until the day it is
    wrong or absent.
    """
    star_names = json.loads((out_dir / "stars.names.json").read_text(encoding="utf-8"))
    ids = np.fromfile(out_dir / "stars.ids.bin", dtype="<i4").reshape(-1, 2)
    constellation_bytes = np.fromfile(out_dir / "stars.con.bin", dtype=np.uint8)

    if not constellation_values:
        # Fall back to the published manifest. Without a constellation table the
        # resolver cannot index Bayer or Flamsteed designations at all, so every
        # star named that way silently fails to resolve — twenty of them, in a
        # build that otherwise looks healthy. Better to read a possibly-stale
        # table than to quietly resolve nothing, and better still to say so if
        # there is none.
        manifest = out_dir / "manifest.json"
        if not manifest.exists():
            raise ValueError(
                "no constellation table: pass constellation_values, or build the "
                "star dataset first so the manifest carries one"
            )
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        constellation_values = payload["datasets"]["stars"]["layout"]["constellations"]["values"]

    values = constellation_values
    constellation_of = {
        i: values[code]
        for i, code in enumerate(constellation_bytes)
        if code < len(values) and values[code]
    }

    by_hip = {int(v): i for i, v in enumerate(ids[:, 0]) if v != -1}
    by_hd = {int(v): i for i, v in enumerate(ids[:, 1]) if v != -1}
    resolver = StarResolver(
        star_names,
        hip_ids=by_hip,
        hd_ids=by_hd,
        constellation_of=constellation_of,
    )
    return resolver, by_hip, by_hd


def _star_index(
    world: World,
    resolver: StarResolver,
    by_hip: dict[int, int],
    by_hd: dict[int, int],
) -> int | None:
    """Resolve a world's real-star binding to an index in the star dataset."""
    location = world.location
    if location.hip is not None:
        return by_hip.get(location.hip)
    if location.hd is not None:
        return by_hd.get(location.hd)
    if location.star:
        # Sol is the frame's origin and carries no catalogue designation, so the
        # name resolver has nothing to match it against.
        if location.star.strip().casefold() == "sol":
            return 0
        match = resolver.resolve(location.star)
        return match.index if match else None
    return None


def _direction(
    world: World,
    constellations: dict[str, Any],
) -> tuple[float, float, float] | None:
    """RA, Dec and direction error for a world placed on the sky."""
    location = world.location
    if location.method == "direction":
        assert location.ra_deg is not None and location.dec_deg is not None
        return location.ra_deg, location.dec_deg, EXACT
    if location.method == "constellation":
        entry = constellations.get(fold_diacritics(location.constellation).casefold())
        if entry is None:
            raise ValueError(
                f"world {world.name!r} cites unknown constellation "
                f"{location.constellation!r}"
            )
        if not entry.centroid_inside:
            # Placing it at the centroid would put it in a different
            # constellation, which is worse than not placing it at all.
            raise ValueError(
                f"world {world.name!r} is located only by {entry.name}, whose "
                f"centre of area falls outside itself; it needs coordinates"
            )
        return entry.ra_deg, entry.dec_deg, entry.radius_deg
    return None


def build_worlds(
    worlds_path: Path | None = None,
    out_dir: Path | None = None,
    constellation_values: list[str] | None = None,
) -> dict[str, Any]:
    """Build the worlds dataset and return its manifest entry."""
    worlds_path = worlds_path or FICTION_DIR / WORLDS_FILE
    out_dir = out_dir or DATA_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    resolver, by_hip, by_hd = _load_star_lookup(out_dir, constellation_values)
    star_positions = np.fromfile(out_dir / "stars.bin", dtype="<f4").reshape(-1, 5)

    source = WorldFile.load(worlds_path)
    constellations = ConstellationFile.load(
        worlds_path.with_name(CONSTELLATIONS_FILE)
    ).by_name()

    known_polities = {
        p.id for p in FictionFile.load(worlds_path.with_name("polities.yaml")).polities
    }
    unknown = sorted({a for w in source.worlds for a in w.affiliations} - known_polities)
    if unknown:
        raise ValueError(f"worlds.yaml cites unknown affiliations: {unknown}")

    # Add-on designations, so an `oa_star` binding fails loudly rather than
    # silently placing nothing.
    oa_names: set[str] = set()
    oa_path = worlds_path.with_name("oa_stars.yaml")
    if oa_path.exists():
        oa_names = {entry.name for entry in OAStarFile.load(oa_path).stars}
        curation = OASystemFile.load(worlds_path.with_name("oa_systems.yaml"))
        oa_names |= {system.star for system in curation.systems}

    stats = WorldStats()
    records: list[dict[str, Any]] = []

    for world in sorted(source.worlds, key=lambda w: w.name):
        stats.total += 1
        method = world.location.method
        stats.by_method[method] += 1

        events = [
            {
                "year_at": e.year_at,
                "kind": e.kind,
                "note": e.note,
                "until_at": e.until_at,
                "precision": e.precision,
            }
            for e in sorted(world.events, key=lambda e: (e.year_at, e.kind))
        ]
        presence = [_certain_by(e) for e in events if e["kind"] in PRESENCE_KINDS]
        settled_years = [_certain_by(e) for e in events if e["kind"] == "settled"]
        known_from = min(presence) if presence else None
        settled_at = min(settled_years) if settled_years else None

        # When it stopped, where it did. Kept apart from the presence years
        # rather than folded into them: Hoopworld disintegrated in 10580 and
        # nothing records when it was built, so counting the ending as a
        # presence date would put it on the map in the year it vanished.
        ended = [_certain_by(e) for e in events if e["kind"] == "abandoned"]
        ended_at = max(ended) if ended else None

        if events:
            stats.dated += 1
            years = [e["year_at"] for e in events]
            stats.earliest = min(years) if stats.earliest is None else min(stats.earliest, *years)
            stats.latest = max(years) if stats.latest is None else max(stats.latest, *years)
        else:
            stats.undated.append(world.name)

        record: dict[str, Any] = {
            "name": world.name,
            "kind": world.kind,
            "system": world.system,
            "parent": world.parent,
            "also": world.also,
            "affiliations": world.affiliations,
            "uncertain": world.uncertain,
            "article": world.article,
            "note": world.note,
            "method": method,
            "events": events,
            # The years a map of the sphere is drawn from: when this place
            # first appears, when it became inhabited, and when it ended.
            # Derived rather than authored, so that editing a date cannot leave
            # a stale summary behind.
            "known_from_at": known_from,
            "settled_at": settled_at,
            "ended_at": ended_at,
            "star_index": None,
            "oa_star": "",
            "in_world": "",
            "distance_checked": False,
            "x": None,
            "y": None,
            "z": None,
            "distance_pc": None,
            "direction_error_deg": None,
            "direction_error_ly": None,
            "radius_pc": None,
        }

        if world.extent:
            record["radius_pc"] = round(
                float(parse_distance(world.extent).to_value(STORAGE_UNIT)) / 2.0, 4
            )

        if method == "star":
            index = _star_index(world, resolver, by_hip, by_hd)
            if index is None:
                stats.unresolved.append(world.name)
            else:
                record["star_index"] = int(index)
                if world.location.distance and not world.location.distance_conflict:
                    stated = parse_distance(world.location.distance).to_value(STORAGE_UNIT)
                    actual = float(np.linalg.norm(star_positions[index, :3]))
                    if abs(actual - stated) > DISTANCE_TOLERANCE * max(stated, 1e-9):
                        raise ValueError(
                            f"world {world.name!r} states "
                            f"{stated * PC_TO_LY:,.1f} ly but the star it binds to is at "
                            f"{actual * PC_TO_LY:,.1f} ly — that is not a rounding "
                            "difference, it is a different star"
                        )
                    record["distance_checked"] = True
                elif world.location.distance:
                    stats.distance_conflicts.append(world.name)
        elif method == "oa_star":
            if oa_names and world.location.oa_star not in oa_names:
                raise ValueError(
                    f"world {world.name!r} binds to unknown add-on star "
                    f"{world.location.oa_star!r}"
                )
            record["oa_star"] = world.location.oa_star
        elif method == "world":
            record["in_world"] = world.location.world
        elif method == "none":
            stats.unlocated.append(world.name)
        else:
            ra, dec, error = _direction(world, constellations)  # type: ignore[misc]
            distance = parse_distance(world.location.distance)
            x, y, z = icrs_to_galactic_xyz(
                np.array([ra]) * u.deg,
                np.array([dec]) * u.deg,
                np.array([distance.to_value(u.lyr)]) * u.lyr,
            )
            record["x"] = round(float(x.to_value(STORAGE_UNIT)[0]), 4)
            record["y"] = round(float(y.to_value(STORAGE_UNIT)[0]), 4)
            record["z"] = round(float(z.to_value(STORAGE_UNIT)[0]), 4)
            record["distance_pc"] = round(float(distance.to_value(STORAGE_UNIT)), 4)
            record["direction_error_deg"] = round(error, 2)
            record["direction_error_ly"] = round(
                approximate_extent_ly(record["distance_pc"], error), 1
            )

        records.append(record)

    # Second pass: a world that shares another's position copies it once both
    # exist, so the file may name them in any order.
    by_name = {r["name"]: r for r in records}
    for record in records:
        if record["method"] != "world":
            continue
        host = by_name.get(record["in_world"])
        if host is None:
            raise ValueError(
                f"world {record['name']!r} sits in {record['in_world']!r}, "
                "which is not in this file"
            )
        if host["x"] is None:
            raise ValueError(
                f"world {record['name']!r} sits in {record['in_world']!r}, which has no position "
                "of its own; bind it to whatever places the host instead"
            )
        for key in ("x", "y", "z", "distance_pc", "direction_error_deg", "direction_error_ly"):
            record[key] = host[key]

    files = {"worlds": write_json(out_dir / "worlds.json", records)}

    return {
        "count": len(records),
        "files": files,
        "layout": {
            "worlds": {
                "note": (
                    "One entry per world. A world with a star_index or an oa_star "
                    "has no coordinates of its own: it names an object already on "
                    "the map. One with x/y/z was placed from a direction and a "
                    "distance, and direction_error_deg says how much of the sky "
                    "the direction actually allows — zero when the source gave "
                    "coordinates, the constellation's enclosing half-angle when it "
                    "gave a constellation."
                )
            }
        },
        "stats": stats.as_dict(),
        "source": {
            "description": (
                "Canonical Orion's Arm places, hand-authored from the Encyclopaedia "
                "Galactica, one entry per article."
            ),
            "citation": SOURCE_TITLE,
            "url": SOURCE_URL,
        },
    }


def format_report(dataset: dict[str, Any]) -> str:
    """A short build report, in the style of the other fiction builds."""
    stats = dataset["stats"]
    lines = [f"  worlds     {dataset['count']:,} entries"]
    if stats["dated"]:
        first, last = stats["epoch_range_at"]
        lines.append(f"             {stats['dated']} dated, {first}-{last} A.T.")
    for method, count in stats["by_method"].items():
        described = {
            "star": "bound to a catalogue star",
            "oa_star": "bound to a Celestia add-on star",
            "direction": "placed by direction and distance",
            "world": "sharing another world's position",
            "constellation": "placed by constellation and distance",
            "none": "described but not located",
        }.get(method, method)
        lines.append(f"             {count:>3} {described}")
    if stats["unresolved"]:
        lines.append(f"             unresolved bindings: {', '.join(stats['unresolved'])}")
    if stats["distance_conflicts"]:
        lines.append(
            "             stated distance disagrees with the catalogue, acknowledged: "
            + ", ".join(stats["distance_conflicts"])
        )
    return "\n".join(lines)

