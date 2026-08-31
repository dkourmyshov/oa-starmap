"""Bind the Encyclopaedia's history to the places on the map.

The world file already dates settlement, which is enough to draw the Terragen
Sphere growing: at any year, the places whose first recorded event has happened.
What settlement dates cannot say is which places a century was *about*. Nothing
in a list of founding years distinguishes the system where a war ended from the
one that was merely colonised the same decade.

The Encyclopaedia's own timeline says it, one line at a time, and says it in the
only form that survives being machine-read: a hyperlink. So this step matches
every timeline link against the four files that hold places — worlds, the Inner
Sphere colony table, the Celestia add-on's systems, and the landmarks — on the
article id, and writes out which places each period names.

Matching is on the id and never on the name. "Nova Terra" is a place, a habitat
and a political movement in this setting, and a name match would bind the
history of all three to whichever one this project happens to hold.

Most links resolve to nothing here, and that is the expected case rather than a
failure: the timeline links technologies, treaties, clades and people far more
often than places, and none of those belong on a star map. What is counted and
reported is the other kind of miss — a link that names a place the map does not
carry — because that is a gap worth seeing.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from oastarmap.build.writer import write_json
from oastarmap.fiction.schema import FictionFile, HistoryFile, LandmarkFile, Polity
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR

HISTORY_FILE = "history.yaml"
OUT_FILE = "history.json"

SOURCE_TITLE = "History of the Terragen Sphere"
SOURCE_URL = "https://www.orionsarm.com/eg-topic/45b170f9e0941"

_ARTICLE_ID = re.compile(r"/eg-(?:article|topic)/(\w+)")


def article_id(url: str) -> str:
    """The Encyclopaedia's id out of one of its URLs, or "" if it is not one."""
    found = _ARTICLE_ID.search(url or "")
    return found.group(1) if found else ""


def _polity_patterns(fiction_dir: Path) -> list[tuple[Polity, re.Pattern[str]]]:
    """The polities whose names can safely be looked for in running prose.

    This is the only temporal statement about polities the sources support. The
    affiliations elsewhere in this project are undated — read off a political
    map of one epoch and off articles about the setting's present — so nothing
    here can say who held a system in 515 A.T. What the Encyclopaedia's own
    timeline can say is which polities a given century was *about*, because each
    period's page talks about them by name and dates every line it writes.

    Two names are excluded rather than matched: see `ambiguous_name`, and the
    xenosophont bucket, which is a category this project uses and not the name
    of anybody the timeline could mention.
    """
    path = fiction_dir / "polities.yaml"
    if not path.exists():
        return []
    fiction = FictionFile.load(path)
    out: list[tuple[Polity, re.Pattern[str]]] = []
    for polity in fiction.polities:
        if polity.ambiguous_name or polity.kind == "xenosophont":
            continue
        out.append((polity, re.compile(rf"\b{re.escape(polity.name)}\b", re.I)))
    return out


def _polities_named(
    events: list[dict[str, Any]], patterns: list[tuple[Polity, re.Pattern[str]]]
) -> list[dict[str, Any]]:
    """Which polities this period's own timeline names, and how often.

    Deliberately a count of mentions and nothing more. It is not a claim that
    the polity existed in every year of the period, still less that it held
    anything; it is the Encyclopaedia writing the name down while telling that
    century's story, which is a fact about the source and a useful one. The
    centuries before any polity existed name none, which is the check that it
    is measuring something real.
    """
    counts: Counter[str] = Counter()
    found: dict[str, Polity] = {}
    for event in events:
        for polity, pattern in patterns:
            if pattern.search(event["text"]):
                counts[polity.id] += 1
                found[polity.id] = polity
    return [
        {
            "id": polity_id,
            "name": found[polity_id].name,
            "color": found[polity_id].color,
            "mentions": count,
        }
        for polity_id, count in counts.most_common()
    ]


def _index(data_dir: Path) -> dict[str, dict[str, Any]]:
    """Every mapped place that cites an article, keyed by that article's id.

    Read from the build's own output rather than from the source YAML, for the
    same reason the fiction step reads it: the renderer consumes these files,
    and a history entry pointing at a world the world build dropped would be a
    reference to something not on the map.

    Where two files hold the same article the first writer wins, in the order
    worlds, colonies, add-on systems, landmarks. That order is deliberate: a
    world is the richest record of a place and the one the renderer can locate
    by every route, and the others are progressively thinner descriptions of
    the same thing.
    """
    index: dict[str, dict[str, Any]] = {}

    def claim(ident: str, entry: dict[str, Any]) -> None:
        if ident and ident not in index:
            index[ident] = entry

    worlds_path = data_dir / "worlds.json"
    if worlds_path.exists():
        for world in json.loads(worlds_path.read_text(encoding="utf-8")):
            claim(
                article_id(world.get("article", "")),
                {
                    "ref": "world",
                    "name": world["name"],
                    "world": world["name"],
                    "located": world.get("method") not in (None, "", "none"),
                },
            )

    colonies_path = data_dir / "innersphere.json"
    if colonies_path.exists():
        for colony in json.loads(colonies_path.read_text(encoding="utf-8")):
            if not colony.get("colony"):
                continue
            claim(
                article_id(colony.get("article", "")),
                {
                    "ref": "star",
                    "name": colony["colony"],
                    "star_index": colony["star_index"],
                    "located": True,
                },
            )

    oastars_path = data_dir / "oastars.names.json"
    if oastars_path.exists():
        for entry in json.loads(oastars_path.read_text(encoding="utf-8")):
            if entry.get("hidden"):
                continue
            claim(
                article_id(entry.get("article", "")),
                {
                    "ref": "oa_star",
                    "name": entry.get("label") or entry["name"],
                    "oa_star": entry["name"],
                    "located": True,
                },
            )

    for landmark in LandmarkFile.load(FICTION_DIR / "landmarks.yaml").landmarks:
        claim(
            article_id(landmark.article),
            {
                "ref": "landmark",
                "name": landmark.name,
                "catalogue": landmark.catalogue,
                "located": True,
            },
        )

    return index


def build_history(
    fiction_dir: Path | None = None, out_dir: Path | None = None
) -> dict[str, Any] | None:
    """Write ``history.json``. Returns the manifest fragment, or None if absent."""
    fiction_dir = fiction_dir or FICTION_DIR
    out_dir = out_dir or DATA_OUT_DIR

    history = HistoryFile.load(fiction_dir / HISTORY_FILE)
    if not history.periods:
        return None

    places = _index(out_dir)
    patterns = _polity_patterns(fiction_dir)

    resolved_ids: set[str] = set()
    link_total = 0
    link_resolved = 0

    periods: list[dict[str, Any]] = []
    for period in history.periods:
        events: list[dict[str, Any]] = []
        named: list[str] = []
        for event in period.events:
            here: list[dict[str, Any]] = []
            for link in event.links:
                link_total += 1
                found = places.get(link.id)
                if found is None:
                    continue
                link_resolved += 1
                resolved_ids.add(link.id)
                if link.id not in [entry["article"] for entry in here]:
                    here.append({"article": link.id, **found})
                if link.id not in named:
                    named.append(link.id)
            events.append(
                {
                    "year_at": event.year_at,
                    "until_at": event.until_at,
                    "precision": event.precision,
                    "text": event.text,
                    "places": here,
                }
            )
        periods.append(
            {
                "id": period.id,
                "name": period.name,
                "title": period.title,
                "kind": period.kind,
                "parent": period.parent,
                "start_at": period.start_at,
                "end_at": period.end_at,
                "article": f"https://www.orionsarm.com/eg-topic/{period.topic}",
                "events": events,
                # The places this period's own history names, most-named first.
                # This is the answer to "what mattered then" that the settlement
                # dates cannot give.
                "places": _ranked(events),
                # The polities this century's history is about. See
                # _polities_named: a mention, not a holding.
                "polities": _polities_named(events, patterns),
                "named_count": len(named),
            }
        )

    write_json(out_dir / OUT_FILE, {"periods": periods})

    dated = [
        event
        for period in periods
        for event in period["events"]
    ]
    years = [event["year_at"] for event in dated]

    return {
        "count": len(periods),
        "eras": sum(1 for period in periods if period["kind"] == "era"),
        "files": {"history": {"file": OUT_FILE, "bytes": (out_dir / OUT_FILE).stat().st_size}},
        "stats": {
            "events": len(dated),
            "links": link_total,
            "links_to_places": link_resolved,
            "places": len(resolved_ids),
            "first_year_at": min(years) if years else None,
            "last_year_at": max(years) if years else None,
        },
        "source": {
            "description": (
                "The Encyclopaedia Galactica's history pages: seven eras, each divided "
                "into periods, each period carrying its own dated timeline."
            ),
            "citation": SOURCE_TITLE,
            "url": SOURCE_URL,
        },
    }


def _ranked(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The places a period names, most-mentioned first.

    Mentions are the ranking because they are what the source offers. A place
    the century's timeline returns to five times is a place that century was
    about, and one it names once in passing is not — which is as much as a link
    count can honestly claim, and it is the claim the panel makes.
    """
    counts: Counter[str] = Counter()
    entries: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for event in events:
        for place in event["places"]:
            ident = place["article"]
            if ident not in entries:
                entries[ident] = place
                order.append(ident)
            counts[ident] += 1
    ranked = sorted(order, key=lambda ident: (-counts[ident], entries[ident]["name"]))
    return [{**entries[ident], "mentions": counts[ident]} for ident in ranked]


def format_report(fragment: dict[str, Any] | None) -> str:
    """What the build prints about the history layer."""
    if fragment is None:
        return "  history:  no history file"
    stats = fragment["stats"]
    return (
        f"  history:  {fragment['count']} pages ({fragment['eras']} eras), "
        f"{stats['events']} dated events, "
        f"{stats['links_to_places']}/{stats['links']} links reach "
        f"{stats['places']} places on the map\n"
        f"            {stats['first_year_at']} to {stats['last_year_at']} AT"
    )
