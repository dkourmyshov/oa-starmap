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


def all_places(fiction_dir: Path | None = None) -> list[Place]:
    """Every place in every file, in no particular order."""
    fiction_dir = fiction_dir or FICTION_DIR
    places: list[Place] = []

    worlds = _load(fiction_dir / "worlds.yaml") or {}
    for w in worlds.get("worlds", []):
        location = w.get("location") or {}
        aliases = [
            *(w.get("also") or []),
            w.get("system") or "",
            location.get("star") or "",
            location.get("oa_star") or "",
        ]
        places.append(Place(w["name"], "worlds.yaml", w.get("article", ""),
                            [a for a in aliases if a], w))

    systems = _load(fiction_dir / "oa_systems.yaml") or {}
    for e in systems.get("systems", []):
        label = e.get("label") or e["star"]
        places.append(Place(label, "oa_systems.yaml", e.get("article", ""),
                            [e["star"], e.get("real") or ""], e))

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
                            [e.get("star") or ""], e))

    polities = _load(fiction_dir / "polities.yaml") or {}
    for p in polities.get("polities", []):
        for landmark in p.get("landmarks") or []:
            places.append(Place(landmark, "polities.yaml", "", [], {"polity": p["id"]}))

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
