"""Transcribe the Encyclopaedia's Systems & Worlds indexes into a roster.

Fourteen alphabetical pages list every system article the Encyclopaedia has. Each
entry gives a name, a link, its authors, and a line of description — and the
description often says outright which polity holds the place, or which other
article the system contains. That is enough to know *what exists*, which is the
one thing a hand-built map cannot tell about itself: 285 places are recorded here
against some six hundred articles, and until now there was no list of the
difference.

Nothing here reads prose or infers anything. It copies four fields out of a list
and follows the links between them. Everything it emits is a verbatim substring
of a page in ``raw/``, which is the property that makes it safe to run
unattended — a parser cannot invent a designation it never saw, and this one is
not asked to.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from oastarmap.fetch.eg import BASE, SYSTEM_INDEX_TOPICS, fetch_system_indexes
from oastarmap.paths import FICTION_DIR

OUT_FILE = "eg_index.yaml"
ROOT_TOPIC = f"{BASE}/eg-topic/45bc1f1fca9ca"

# The list of articles sits between two HTML comments the site emits on every
# topic page. Anchoring on those keeps the "Related Topics" links below it —
# which are also eg-article-shaped — out of the roster.
_ARTICLES_BLOCK = re.compile(
    r"<!--\s*Articles\s*-->(.*?)<!--\s*Related topics\s*-->", re.I | re.S
)
_RELATED_BLOCK = re.compile(r"<!--\s*Related topics\s*-->(.*)", re.I | re.S)
_ITEM = re.compile(r"<li>(.*?)</li>", re.I | re.S)
_HEADLINE = re.compile(
    r"<b>\s*<a\s+href=\"/eg-article/([0-9a-f]+)\"[^>]*>(.*?)</a>\s*</b>(.*)", re.I | re.S
)
_AUTHORS = re.compile(r"<small>(.*?)</small>", re.I | re.S)
_LINK = re.compile(r"<a\s+href=\"/eg-article/([0-9a-f]+)\"[^>]*>(.*?)</a>", re.I | re.S)
_TOPIC_LINK = re.compile(
    r"<a\s+href=\"/eg-topic/([0-9a-f]+)\"[^>]*>\s*Systems\s*&(?:amp;)?\s*Worlds\s*(.*?)</a>",
    re.I | re.S,
)
_TAG = re.compile(r"<[^>]+>")


def _text(markup: str) -> str:
    """Tags out, entities decoded, whitespace collapsed. No interpretation."""
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", markup))).strip()


@dataclass
class IndexEntry:
    name: str
    article: str
    letters: str
    authors: list[str] = field(default_factory=list)
    description: str = ""
    mentions: list[dict[str, str]] = field(default_factory=list)
    """Other articles the description links to — "System containing Trip".

    The Encyclopaedia's own statement that one place is inside another, which is
    the relationship this map draws as containment and has so far had to be told
    by hand.
    """


def parse_index(markup: str, letters: str) -> list[IndexEntry]:
    block = _ARTICLES_BLOCK.search(markup)
    if block is None:
        return []
    entries: list[IndexEntry] = []
    for item in _ITEM.findall(block.group(1)):
        headline = _HEADLINE.search(item)
        if headline is None:
            continue
        article_id, title, rest = headline.groups()

        authors: list[str] = []
        credit = _AUTHORS.search(rest)
        if credit is not None:
            byline = _text(credit.group(1))
            byline = re.sub(r"^(?:Text|Image|Updated)\s+by\s+", "", byline, flags=re.I)
            authors = [a for a in (p.strip() for p in re.split(r",| and ", byline)) if a]
            rest = rest[: credit.start()] + rest[credit.end() :]

        mentions = [
            {"name": _text(name), "article": f"{BASE}/eg-article/{ref}"}
            for ref, name in _LINK.findall(rest)
        ]
        description = _text(rest).lstrip("- ").strip()

        entries.append(
            IndexEntry(
                name=_text(title),
                article=f"{BASE}/eg-article/{article_id}",
                letters=letters,
                authors=authors,
                description=description,
                mentions=mentions,
            )
        )
    return entries


def check_siblings(markup: str, letters: str) -> None:
    """Confirm the page we fetched is the page we asked for.

    The fourteen topic hashes were read off a rendered page rather than taken
    from anything machine-readable, so each is a claim. Every index carries links
    to its thirteen siblings, which means the set checks itself: if a hash were
    wrong we would have fetched some other page, and its sibling list would not
    match the table we started from.
    """
    related = _RELATED_BLOCK.search(markup)
    if related is None:
        raise ValueError(f"{letters}: no Related Topics block; page shape has changed")
    found = {
        _text(label).replace(" ", "").upper(): topic
        for topic, label in _TOPIC_LINK.findall(related.group(1))
    }
    if not found:
        raise ValueError(f"{letters}: no sibling indexes linked; wrong page?")
    for sibling, topic in found.items():
        expected = SYSTEM_INDEX_TOPICS.get(sibling)
        if expected is not None and expected != topic:
            raise ValueError(
                f"{letters} links {sibling} as {topic}, but our table says {expected}"
            )


def _yaml_scalar(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_index(out_path: Path | None = None) -> dict[str, object]:
    """Fetch, parse and write the roster. Returns a summary."""
    out_path = out_path or (FICTION_DIR / OUT_FILE)
    pages = fetch_system_indexes()

    entries: list[IndexEntry] = []
    for letters, fetched in pages.items():
        markup = fetched.path.read_text(encoding="utf-8", errors="replace")
        check_siblings(markup, letters)
        entries.extend(parse_index(markup, letters))

    seen: dict[str, IndexEntry] = {}
    duplicates: list[str] = []
    for entry in entries:
        if entry.article in seen:
            duplicates.append(entry.name)
            continue
        seen[entry.article] = entry
    entries = list(seen.values())

    lines = [
        "# Every system the Encyclopaedia Galactica has an article for.",
        "#",
        "# Machine-transcribed from the fourteen alphabetical Systems & Worlds",
        f"# indexes under {ROOT_TOPIC}.",
        "# Hand edits will be overwritten: rebuild with `oastarmap eg-index`.",
        "#",
        "# This is a roster and not a source of positions. It says what exists and",
        "# where to read about it, which is what tells `worlds.yaml` how much of the",
        "# setting it is still missing. `description` and `mentions` are the",
        "# Encyclopaedia's own words and links, copied and not interpreted.",
        "#",
        f"# Transcribed {date.today().isoformat()}.",
        "",
        "systems:",
    ]
    for entry in sorted(entries, key=lambda e: e.name.casefold()):
        lines.append(f"  - name: {_yaml_scalar(entry.name)}")
        lines.append(f"    article: {entry.article}")
        lines.append(f"    letters: {_yaml_scalar(entry.letters)}")
        if entry.authors:
            lines.append("    authors: [" + ", ".join(_yaml_scalar(a) for a in entry.authors) + "]")
        if entry.description:
            lines.append(f"    description: {_yaml_scalar(entry.description)}")
        if entry.mentions:
            lines.append("    mentions:")
            for mention in entry.mentions:
                lines.append(f"      - name: {_yaml_scalar(mention['name'])}")
                lines.append(f"        article: {mention['article']}")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return {
        "systems": len(entries),
        "duplicates": duplicates,
        "with_description": sum(1 for e in entries if e.description),
        "with_mentions": sum(1 for e in entries if e.mentions),
        "by_letters": {k: sum(1 for e in entries if e.letters == k) for k in SYSTEM_INDEX_TOPICS},
        "path": out_path,
    }
