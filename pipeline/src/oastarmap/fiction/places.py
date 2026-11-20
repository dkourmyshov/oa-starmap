"""Entity-centric views over the authoritative OAUP knowledge graph.

There is one input, ``fiction/oaup/``. The logical origin labels below describe
how evidence entered the graph; they are not filenames and never select a subset
of the data. Queries therefore cover worlds, imported systems, colony rows and
real-object landmarks without asking every caller to assemble a union.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from oastarmap.fiction.store import OAUP_DIR, load_store
from oastarmap.paths import FICTION_DIR


@dataclass
class Place:
    """One place in the knowledge graph, with its resolved editorial metadata."""

    name: str
    source: str
    """Logical evidence collection: world, celestia, inner-sphere or landmark."""

    article: str = ""
    aliases: list[str] = field(default_factory=list)
    record: dict[str, Any] = field(default_factory=dict)
    polities: list[str] = field(default_factory=list)
    past_polities: list[str] = field(default_factory=list)

    @property
    def names(self) -> list[str]:
        """Every name this place answers to, the canonical one first."""
        seen, out = set(), []
        for name in [self.name, *self.aliases]:
            if name and name not in seen:
                seen.add(name)
                out.append(name)
        return out


def _past_polities(events: list[Any]) -> list[str]:
    return list(dict.fromkeys(event.polity for event in events if event.polity))


def _colony_holders(store: Any) -> dict[str, list[str]]:
    """Colony name, case-folded, to its editorial polity assignments."""
    holders: dict[str, list[str]] = defaultdict(list)
    for entry in store.colony_file.colonies:
        name = entry.colony
        affiliations = entry.affiliations
        if not name or not affiliations:
            continue
        keys = [name, *re.split(r"[/&]", re.sub(r"\([^)]*\)", "", name))]
        for key in keys:
            key = key.strip().casefold()
            if key:
                for polity in affiliations:
                    if polity not in holders[key]:
                        holders[key].append(polity)
    return dict(holders)


def all_places(fiction_dir: Path | None = None) -> list[Place]:
    """Every place in the single authoritative graph."""
    fiction_dir = fiction_dir or FICTION_DIR
    source_path = fiction_dir / OAUP_DIR if fiction_dir.is_dir() else fiction_dir
    store = load_store(source_path)
    places: list[Place] = []
    colony_holders = _colony_holders(store)

    for world in store.worlds:
        location = world.location
        aliases = [*world.also, world.system, location.star, location.oa_star]
        places.append(Place(
            world.name,
            "world",
            world.article,
            [alias for alias in aliases if alias],
            world.model_dump(),
            world.affiliations,
            _past_polities(world.events),
        ))

    curation = {system.star: system for system in store.oa_system_file.systems}
    for star in store.stars:
        curated = curation.get(star.name)
        label = (curated.label if curated else "") or star.system or star.name
        record = star.model_dump()
        if curated:
            record.update(curated.model_dump())
        places.append(Place(
            label,
            "celestia",
            curated.article if curated else "",
            [star.name, curated.real if curated else ""],
            record,
            [curated.affiliation] if curated and curated.affiliation else [],
            _past_polities(curated.events) if curated else [],
        ))

    for row in store.inner_sphere_file.systems:
        name = row.colony or row.star
        if not name:
            continue
        places.append(Place(
            name,
            "inner-sphere",
            row.article,
            [row.star],
            row.model_dump(),
            colony_holders.get(name.strip().casefold(), []),
        ))

    named = {landmark.catalogue: landmark for landmark in store.landmark_file.landmarks}
    memberships: dict[str, list[str]] = defaultdict(list)
    for polity in store.fiction.polities:
        for catalogue in polity.landmarks:
            if polity.id not in memberships[catalogue]:
                memberships[catalogue].append(polity.id)
    for catalogue in dict.fromkeys([*memberships, *named]):
        landmark = named.get(catalogue)
        places.append(Place(
            landmark.name if landmark else catalogue,
            "landmark",
            landmark.article if landmark else "",
            [catalogue] if landmark and landmark.name != catalogue else [],
            landmark.model_dump() if landmark else {"catalogue": catalogue},
            memberships.get(catalogue, []),
            _past_polities(landmark.events) if landmark else [],
        ))
    return places


def by_article(places: list[Place] | None = None) -> dict[str, list[Place]]:
    """Places keyed by their article URL. Only entities that record one."""
    index: dict[str, list[Place]] = defaultdict(list)
    for place in places if places is not None else all_places():
        if place.article:
            index[place.article.strip().rstrip("/")].append(place)
    return dict(index)


def by_name(places: list[Place] | None = None) -> dict[str, list[Place]]:
    """Places keyed by every name they answer to, case-folded."""
    index: dict[str, list[Place]] = defaultdict(list)
    for place in places if places is not None else all_places():
        for name in place.names:
            index[name.casefold()].append(place)
    return dict(index)


def by_polity(
    places: list[Place] | None = None, *, when: str = "ever"
) -> dict[str, list[Place]]:
    """Places keyed by current or historical polity, across the whole graph."""
    if when not in ("ever", "now"):
        raise ValueError(f"when must be 'ever' or 'now', got {when!r}")
    index: dict[str, list[Place]] = defaultdict(list)
    for place in places if places is not None else all_places():
        held = list(place.polities)
        if when == "ever":
            held += [p for p in place.past_polities if p not in held]
        for polity in held:
            index[polity].append(place)
    return dict(index)
