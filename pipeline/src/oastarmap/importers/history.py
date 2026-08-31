"""Import the Encyclopaedia Galactica's history pages.

The Encyclopaedia divides the setting's past into seven **eras**, each split
into **periods** — "2100 to 2600 AT: The Age of Expansion" and so on. An era
page is an essay; a period page carries a dated timeline, one line per event,
with the places it names hyperlinked to their own articles.

That structure is what makes a historical map possible at all. The world file
already knows when places were settled, which gives the extent of settlement at
any year. What it cannot say is which of them *mattered* in a given century, and
no amount of arithmetic over settlement dates will say it either. The timeline
can: a place the era's own history names is a place that era's history was
about. So the link is the datum here, and this importer's job is to keep it —
the article id, not the name, because a name is ambiguous and an id is not.

Like the other importers this runs by hand and writes a tracked file. The thirty
pages are 1.5 MB of markup around some 1,600 dated lines, and `sources/` is not
redistributable, so a fresh clone builds from the YAML rather than the HTML.
"""

from __future__ import annotations

import html
import re
import unicodedata
from pathlib import Path
from typing import Any

_TAG = re.compile(r"<[^>]+>")
_BREAK = re.compile(r"<br\s*/?>", re.I)
_TITLE = re.compile(
    r"<title>\s*Orion's Arm - Encyclopedia Galactica - (.*?)</title>", re.S | re.I
)
_CRUMB_BLOCK = re.compile(r'padding-bottom:\s*8px;"><small>(.*?)</small>', re.S | re.I)
_CRUMB = re.compile(r'<a href="/eg-(?:topic|article)/(\w+)">([^<]*)</a>', re.I)
_LINK = re.compile(r'<a href="/eg-(article|topic)/(\w+)"[^>]*>(.*?)</a>', re.S | re.I)
_TOPIC_ID = re.compile(r'og:url"\s+content="[^"]*/eg-topic/(\w+)"', re.I)

SOURCE_URL = "https://www.orionsarm.com/eg-topic/45b170f9e0941"
SOURCE_TITLE = "History of the Terragen Sphere"

#: Where the timeline starts on a period page. Everything above it is the
#: essay, the picture and the navigation, and the essay quotes years too.
_TIMELINE_MARKER = re.compile(r"<b>\s*Previous [Pp]age\s*</b>", re.I)


def _text(fragment: str) -> str:
    """Markup to readable text, keeping what links say and dropping the links."""
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub("", fragment))).strip()


def slug(name: str) -> str:
    """A readable id for a period. Ids in the file are names, not hashes.

    The page's own hex id is stable and is kept as ``topic``, but it is
    unreadable in a diff and this file is meant to be read. The leading article
    is dropped so "The Age of Expansion" and "Age of Establishment" slug alike.
    """
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    folded = re.sub(r"^the\s+", "", folded.strip(), flags=re.I)
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", folded.lower())).strip("-")


def _year(token: str) -> int | None:
    """A year from one side of a title's span, in AT. BT counts backwards.

    Returns None for the two bounds that are not years: the Preterragen Era
    opens at the Big Bang, and the Current Era has no end.
    """
    token = token.strip()
    if re.fullmatch(r"present|now", token, flags=re.I):
        return None
    found = re.fullmatch(r"(-?\d+)\s*(AT|BT)?", token, flags=re.I)
    if not found:
        return None
    value = int(found.group(1))
    return -value if (found.group(2) or "").upper() == "BT" else value


def _span(title: str) -> tuple[int | None, int | None, str]:
    """Split "2100 to 2600 AT: The Age of Expansion" into its three parts."""
    head, _, name = title.partition(":")
    if not name:
        # "Bronze Age", "Iron Age", "Atomic Age" — named, undated subdivisions
        # of the Agricultural and Industrial ages. Kept so the hierarchy is
        # whole; they carry no timeline and never bound a map.
        return None, None, title.strip()
    parts = head.split(" to ")
    if len(parts) != 2:
        return None, None, name.strip()
    return _year(parts[0]), _year(parts[1]), name.strip()


#: The forms a timeline line dates itself in, and what each one claims.
#:
#: Ranges are ``exact`` with an ``until_at`` rather than ``between``: on a
#: timeline "4450-4650 - the Version War" is a war that lasted two centuries,
#: not a war whose date is uncertain by two centuries. Only the decade forms
#: hedge, and they hedge by a decade.
_DATE = re.compile(
    r"""^\s*
    (?P<from>-?\d{1,5})
    (?:
        (?P<decade>'?s)
      | \s*(?:AT)?\s*[-\u2013\u2014]\s*(?P<to>\d{1,5})(?:\s*AT)?
      | (?P<open>\+)
      | /\d+
    )?
    \s*(?:AT)?\s*[-\u2013\u2014]\s+
    """,
    re.X,
)


def _event(chunk: str) -> dict[str, Any] | None:
    """One dated line, or None if this fragment is not one.

    The pre-spaceflight pages date in "b.c.e." and are deliberately not matched:
    they are the only pages whose years are not After Tranquility, and reading
    "~8000 b.c.e." as the year 8000 would put the invention of pottery in the
    middle of the Age of Consolidation.
    """
    plain = _text(chunk)
    found = _DATE.match(plain)
    if not found:
        return None

    year = int(found.group("from"))
    until = int(found.group("to")) if found.group("to") else None
    if until is not None and until < year:
        return None
    precision = "exact"
    if found.group("decade"):
        precision = "circa"
    elif found.group("open"):
        precision = "not_earlier_than"

    body = plain[found.end() :].strip()
    if not body:
        return None

    links = [
        {"kind": kind, "id": ident, "text": _text(label)}
        for kind, ident, label in _LINK.findall(chunk)
    ]
    return {
        "year_at": year,
        "until_at": until,
        "precision": precision,
        "text": body,
        "links": links,
    }


def _on_this_epoch(
    events: list[dict[str, Any]], start: int | None, end: int | None
) -> list[dict[str, Any]]:
    """Drop a page's dates when they are plainly not the epoch it claims.

    The Industrial Age runs 270 BT to 30 AT and dates its timeline 1800, 1801,
    1807 — c.e., not A.T. Read as written those forty-five lines land in the Age
    of Consolidation, putting the first steamboat two thousand years after the
    first starship. They are not converted, because a conversion this file
    performs is a claim this file cannot cite; they are dropped, and the page
    keeps its essay and its place in the hierarchy without them.

    The test is wholesale disagreement, not any disagreement. Timeline pages
    routinely spill a few years past their own headings — the Version War page
    carries 4445 and 4690 for a period billed as 4450 to 4650 — and those are
    the source being loose about a boundary, not about an epoch. So the events
    go only when *most* of them fall outside, which no page with a boundary
    quibble ever manages and the one page on the wrong calendar manages
    completely.
    """
    if not events or start is None or end is None:
        return events
    inside = sum(1 for event in events if start <= event["year_at"] <= end)
    return events if inside * 2 >= len(events) else []


def parse_page(markup: str) -> dict[str, Any] | None:
    """One history page: what it is, where it sits, and what it dates."""
    title_found = _TITLE.search(markup)
    topic_found = _TOPIC_ID.search(markup)
    if not title_found or not topic_found:
        return None

    flat = re.sub(r"\s+", " ", markup)
    title = _text(title_found.group(1))
    start, end, name = _span(title)

    crumb_block = _CRUMB_BLOCK.search(flat)
    crumbs = _CRUMB.findall(crumb_block.group(1)) if crumb_block else []
    # History > Era > Period. Two crumbs is an era, three a period; the last is
    # the page itself, so the parent is the one before it.
    parent = _text(crumbs[-2][1]) if len(crumbs) >= 3 else ""

    # Split at the *first* marker, not the last: the Central Alliance page
    # repeats its navigation as a footer, and taking the last piece left that
    # page — sixty dated lines of it — reading as though it had no history.
    timeline = _TIMELINE_MARKER.split(flat, maxsplit=1)
    events: list[dict[str, Any]] = []
    if len(timeline) > 1:
        for chunk in _BREAK.split(timeline[1]):
            found = _event(chunk)
            if found:
                events.append(found)
    events = _on_this_epoch(events, start, end)

    return {
        "id": slug(name),
        "topic": topic_found.group(1),
        "name": name,
        "title": title,
        "kind": "period" if parent else "era",
        "parent": slug(_span(parent)[2]) if parent else "",
        "start_at": start,
        "end_at": end,
        "events": events,
    }


def parse(pages: list[str]) -> list[dict[str, Any]]:
    """Every page, ordered as history runs: eras by date, periods within them.

    An era with no start year sorts first, which is where the Preterragen Era
    belongs; the undated subdivisions of the Agricultural Age sort to the front
    of their own parent for the same reason and are equally harmless there.
    """
    parsed = [page for page in (parse_page(markup) for markup in pages) if page]

    by_id = {page["id"]: page for page in parsed}
    if len(parsed) != len(by_id):
        raise ValueError("two history pages share an id after slugging")

    def key(page: dict[str, Any]) -> tuple[int, int, int, int, str]:
        era = by_id.get(page["parent"], page) if page["kind"] == "period" else page
        era_start = era["start_at"]
        own = page["start_at"]
        return (
            0 if era_start is None else 1,
            era_start or 0,
            0 if page["kind"] == "era" else 1,
            own if own is not None else -(1 << 30),
            page["name"],
        )

    return sorted(parsed, key=key)


HEADER = """\
# The history of the Terragen Sphere, imported from the Encyclopaedia Galactica.
#
#   Source: History of the Terragen Sphere
#   Page:   https://www.orionsarm.com/eg-topic/45b170f9e0941
#   Terms:  https://www.orionsarm.com/Terms_Copyright_and_Submissions.html
#
# Seven eras, each divided into periods, plus the pre-spaceflight ages kept for
# completeness. `start_at` and `end_at` are years After Tranquility; both are
# empty where the source gives no year — the Preterragen Era opens at the Big
# Bang and the Current Era has no end.
#
# A period's `events` are the lines of its own dated timeline, in the order the
# page gives them. `links` is what each line hyperlinks: the article id, which
# is what binds a line to a place on the map. The link text is kept beside it
# because the id alone says nothing to a reader of this file, but the id is what
# the build matches on — the Encyclopaedia names several places alike, and every
# one of them has an id of its own.
#
# The pre-spaceflight pages date in b.c.e. rather than A.T. and are imported
# with no events at all, rather than with events on a second, unmarked epoch.
#
# Regenerate with `uv run oastarmap import-history`, which rewrites this file
# from the saved pages. Re-importing discards hand edits, so review the diff.
"""


def _scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, int):
        return str(value)
    text = str(value)
    return '""' if not text else "'" + text.replace("'", "''") + "'"


def write_yaml(periods: list[dict[str, Any]], dest: Path) -> dict[str, int]:
    """Write the whole hierarchy as YAML, with provenance in the file itself."""
    lines = [HEADER, "periods:"]
    for page in periods:
        lines.append(f"  - id: {_scalar(page['id'])}")
        for field in ("topic", "name", "title", "kind", "parent", "start_at", "end_at"):
            lines.append(f"    {field}: {_scalar(page[field])}")
        if not page["events"]:
            lines.append("    events: []")
            continue
        lines.append("    events:")
        for event in page["events"]:
            lines.append(f"      - year_at: {_scalar(event['year_at'])}")
            lines.append(f"        until_at: {_scalar(event['until_at'])}")
            lines.append(f"        precision: {_scalar(event['precision'])}")
            lines.append(f"        text: {_scalar(event['text'])}")
            if not event["links"]:
                lines.append("        links: []")
                continue
            lines.append("        links:")
            for link in event["links"]:
                lines.append(
                    f"          - {{kind: {_scalar(link['kind'])}, "
                    f"id: {_scalar(link['id'])}, text: {_scalar(link['text'])}}}"
                )

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {
        "periods": len(periods),
        "eras": sum(1 for page in periods if page["kind"] == "era"),
        "events": sum(len(page["events"]) for page in periods),
        "links": sum(len(event["links"]) for page in periods for event in page["events"]),
    }


def import_history(source_dir: Path, dest: Path) -> dict[str, int]:
    """Read the saved history pages and write the tracked file."""
    pages = [
        path.read_text(encoding="utf-8", errors="replace")
        for path in sorted(source_dir.glob("*.htm"))
    ]
    if not pages:
        raise FileNotFoundError(f"no history pages in {source_dir}")
    return write_yaml(parse(pages), dest)
