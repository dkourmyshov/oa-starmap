"""Every Orion's Arm place, from every file that holds one, in one list.

The places are spread over four hand-authored files plus the polity landmarks,
and which file a place lives in is an accident of where it was first written
down. Nothing about a place tells you which file it is in, and no file is a
superset of another:

    worlds.yaml        533 entries, 495 with an article URL
    inner_sphere.yaml  1122 colony rows, 266 with a URL
    oa_stars.yaml      119 add-on stars, none with a URL
    oa_systems.yaml    28 curated labels, 26 with a URL

Every analysis written against this data has had to remember to union them, and
four times running one did not — most expensively when a survey of the article
corpus reported 176 articles as having "no entry in the map", when the places
were in the colony table all along and the index had been built from worlds.yaml
alone. The colony table cannot be matched by URL at all, because it carries
none.

So the union lives here, once, and consumers take it rather than assembling
their own. :func:`by_article` and :func:`by_name` are the two lookups every
caller was writing by hand.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from oastarmap.paths import FICTION_DIR


@dataclass
class Place:
    """One named place, and which file said so."""

    name: str
    source: str
    """File it came from: worlds.yaml, inner_sphere.yaml, oa_stars.yaml, …"""

    article: str = ""
    """Its Encyclopaedia article, where the source records one. Often empty."""

    aliases: list[str] = field(default_factory=list)
    """Other names for the same place: `also`, its system, its star."""

    record: dict[str, Any] = field(default_factory=dict)
    """The entry as written, for callers that need a field this class omits."""

    polities: list[str] = field(default_factory=list)
    """Who holds it, by polity id, however its own file happens to say so.

    Five files, five conventions: `worlds.yaml` has a list under
    `affiliations`, `oa_systems.yaml` a single `affiliation`, a colony row
    keeps its holder in `colonies.yaml` under a name that has to be matched
    back, a landmark's holder is the polity that lists it, and `oa_stars.yaml`
    records none at all. Resolved once here so that "who does this polity
    hold" is a question with one answer rather than five partial ones.
    """

    past_polities: list[str] = field(default_factory=list)
    """Who has held it, by polity id, from the dated events on the entry.

    A polity can hold nothing today and a great deal in 3000 AT, and the map
    draws it at those places whenever the year is set back — so for any
    question about reach, colour or confusability, a past holding is a holding.
    LinnEnt is the case: no present affiliation anywhere, nine worlds held
    through events, and a first pass at this lookup reported it holding
    nothing at all.
    """

    @property
    def names(self) -> list[str]:
        """Every name this place answers to, the canonical one first."""
        seen, out = set(), []
        for name in [self.name, *self.aliases]:
            if name and name not in seen:
                seen.add(name)
                out.append(name)
        return out


def _load(path: Path) -> Any:
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def _colony_holders(fiction_dir: Path) -> dict[str, list[str]]:
    """Colony name, case-folded, to the polities `colonies.yaml` gives it.

    The colony table itself records no holder: the assignment lives in a
    separate file keyed by the same column, and one row's column can name
    several colonies of several polities. Split the same way that file
    documents — on "/" and "&", parentheticals ignored — so a lookup by
    either the whole column or one name in it finds the holder.
    """
    colonies = _load(fiction_dir / "colonies.yaml") or {}
    holders: dict[str, list[str]] = defaultdict(list)
    for entry in colonies.get("colonies", []):
        name = entry.get("colony") or ""
        affiliations = entry.get("affiliations") or []
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
    """Every place in every file, in no particular order."""
    fiction_dir = fiction_dir or FICTION_DIR
    places: list[Place] = []
    colony_holders = _colony_holders(fiction_dir)

    worlds = _load(fiction_dir / "worlds.yaml") or {}
    for w in worlds.get("worlds", []):
        location = w.get("location") or {}
        aliases = [
            *(w.get("also") or []),
            w.get("system") or "",
            location.get("star") or "",
            location.get("oa_star") or "",
        ]
        past = []
        for event in w.get("events") or []:
            polity = event.get("polity")
            if polity and polity not in past:
                past.append(polity)
        places.append(Place(w["name"], "worlds.yaml", w.get("article", ""),
                            [a for a in aliases if a], w,
                            list(w.get("affiliations") or []), past))

    systems = _load(fiction_dir / "oa_systems.yaml") or {}
    for e in systems.get("systems", []):
        label = e.get("label") or e["star"]
        held = [e["affiliation"]] if e.get("affiliation") else []
        past = []
        for event in e.get("events") or []:
            polity = event.get("polity")
            if polity and polity not in past:
                past.append(polity)
        places.append(Place(label, "oa_systems.yaml", e.get("article", ""),
                            [e["star"], e.get("real") or ""], e, held, past))

    stars = _load(fiction_dir / "oa_stars.yaml") or {}
    for e in stars.get("stars", []):
        places.append(Place(e.get("system") or e["name"], "oa_stars.yaml", "",
                            [e["name"]], e))

    inner = _load(fiction_dir / "inner_sphere.yaml") or {}
    for e in inner.get("systems", []):
        # A row with no colony name is a star the table happens to list, not a
        # place anyone has settled — but it still names a star this map holds,
        # so it is kept and identified by that.
        name = e.get("colony") or e.get("star") or ""
        if not name:
            continue
        places.append(Place(name, "inner_sphere.yaml", e.get("article", ""),
                            [e.get("star") or ""], e,
                            colony_holders.get(name.strip().casefold(), [])))

    polities = _load(fiction_dir / "polities.yaml") or {}
    for p in polities.get("polities", []):
        for landmark in p.get("landmarks") or []:
            places.append(Place(landmark, "polities.yaml", "", [],
                                {"polity": p["id"]}, [p["id"]]))

    return places


def by_article(places: list[Place] | None = None) -> dict[str, list[Place]]:
    """Places keyed by their article URL. Only the sources that record one."""
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
    """Places keyed by the polity that holds them, across every file.

    The lookup this module was missing. Twice in one sitting an analysis asked
    "where does this polity reach" and answered it from `worlds.yaml` alone:
    once concluding the Keter Dominion began at 1,119 ly when seven of its
    systems are inside 90 ly in the colony table, and once that a polity had no
    place on the map at all when it had one in `oa_systems.yaml`. Both were the
    same mistake as the four the module header records, in a lookup nobody had
    written down yet.

    `when="ever"`, the default, counts a past holding as a holding: the map
    draws it in history mode, so it bears on reach, colour and confusability
    exactly as a present one does. `when="now"` narrows to present
    affiliations. The default is the superset because the failure this lookup
    exists to stop is always an undercount — the first version of it counted
    only present affiliations and duly reported LinnEnt, which holds nine
    worlds through events, as holding nothing.
    """
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
