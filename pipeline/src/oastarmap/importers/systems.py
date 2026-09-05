"""Read the Encyclopaedia's system articles for what they date, and for whom.

The five hundred and seventy-odd saved articles under ``sources/systems`` are
the richest source this map has for two things it records thinly: *when* a
place was reached and settled, and *who held it* on the way to its present
holder. The world file dates 354 of its 533 entries, mostly with a single year,
and records ten changes of hands. The articles say much more — Sesharia was
"colonised 1102 AT by the Doran empire colony ship Zschorn", is "currently
NoCoZo, former Doran Empire world", and its history section then arrives at the
same star in 1133 — and the Doran Empire is a polity this map does not draw at
all, because it dissolved before the setting's present.

What this module does not do is read that prose. A previous pass tried to have
a program decide what each sentence claimed, and what it produced was thirty
rows. The sentences hedge, contradict their own data panels, date events by
"the late 5th century" and name polities by three different abbreviations;
the judgement of which year is the settlement and which polity did the
settling is exactly the judgement a regex cannot be trusted with.

So the split here is the one that has worked elsewhere in this pipeline: the
machine does the part that must be exhaustive and must not invent, and a
reader does the part that needs reading. This module turns fourteen megabytes
of markup into a worksheet of a few thousand lines — every sentence that
carries a year, every data-panel field, with the article, the place the map
already binds it to, the events that place already has, and the polity names
and links in the sentence — and everything in it is a verbatim substring of a
saved page. The reader works down the worksheet and writes events into
``worlds.yaml``, each with the article as its citation and, where the sentence
names one, the polity that acted. The pipeline validates what is written.

Only the *worksheet* is produced here, and only under ``sources/derived``,
which is untracked: it is a rearrangement of somebody else's text, and the
tracked file is the one the reader writes.
"""

from __future__ import annotations

import csv
import html
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from oastarmap.fetch.eg import BASE
from oastarmap.fiction.places import Place, all_places, by_article

_TAG = re.compile(r"<[^>]+>")
_TITLE = re.compile(
    r"<title>\s*Orion's Arm - Encyclopedia Galactica - (.*?)</title>", re.S | re.I
)
_ARTICLE_ID = re.compile(r'og:url"\s+content="[^"]*/eg-article/(\w+)"', re.I)
_TOPIC_ID = re.compile(r'og:url"\s+content="[^"]*/eg-topic/(\w+)"', re.I)
_CRUMB_BLOCK = re.compile(r'padding-bottom:\s*8px;"><small>(.*?)</small>', re.S | re.I)
_CRUMB = re.compile(r'<a href="/eg-(?:topic|article)/(\w+)">([^<]*)</a>', re.I)
_LINK = re.compile(r'<a href="/eg-(article|topic)/(\w+)"[^>]*>(.*?)</a>', re.S | re.I)
_PANEL = re.compile(r'<div class="datapanel[^"]*">(.*?)</div>', re.S | re.I)
_PANEL_ROW = re.compile(r"<tr>\s*<th>(.*?)</th>\s*<td>(.*?)</td>\s*</tr>", re.S | re.I)
_SUBFIELD = re.compile(r"<b>\s*([^<:]{1,60}?)\s*:\s*</b>", re.I)
_BODY_START = re.compile(r'<div id="div_body"', re.I)
_STRIP = re.compile(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", re.S | re.I)
_BREAK = re.compile(r"<br\s*/?>|</p>|</tr>|</div>|</li>|</h\d>|</td>", re.I)
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")

#: A year the setting dates itself in. "1102 AT", "629 a.t.", "7000 BT". The
#: bare capitals are matched only as capitals: "arrived in 1500 at the star"
#: dates itself too, but not by naming its epoch.
_AT_YEAR = re.compile(r"(?<![\d.])(\d{1,5})\s*(AT|BT|[Aa]\.[Tt]\.?|[Bb]\.[Tt]\.?)(?!\w)")

#: A number that could be a year the article has left bare, as most do after
#: the first one. Too loose to trust alone, so a sentence carrying only these
#: is marked ``bare`` rather than ``at`` and the reader weighs it accordingly.
#: What a number is measuring when it is not a year. The setting writes "35 ly
#: from Sol", "140,000 km diameter", "50 thousand kilometers" and "1000 c" and
#: dates none of them. "AT" is here too, so a year the epoch pattern took is
#: not taken a second time as bare.
_UNIT = (
    r"ly|pc|km|kms|AU|kg|K|m|mm|cm|nm|kW|MW|GW|TW|W|%|light|parsec|years?|yrs?|"
    r"tons?|tonnes?|c|g|G|solar|sols?|Earth|Jupiter|billion|million|thousand|"
    r"hundred|times|AT|BT|a\.t\.|b\.t\.|CE|BCE|AD|BC|degrees|Kelvin|hours?|days?|"
    r"months?|minutes?|seconds?|metres?|meters?|miles?|kilomet\w+|standard|people|"
    r"inhabitants|individuals|colonists|ships?|sophonts?|worlds?|systems?|stars?|"
    r"planets?|habitats?|percent|per\b|x\b|by\b|mya|kya|gya|bya|lightyears?|"
    r"light-years?|millibars?|bars?|atm|psi|th|st|nd|rd|kilometers?|kilometres?"
)
_BARE_YEAR = re.compile(
    r"(?<![\d.,/-])([1-9]\d{2,3}|1[01]\d{3})"
    r"(?!\d)"
    # "100 000": a thousands group written with a space, not a year and a number.
    r"(?!\s\d{3}\b)"
    r"(?![\d,.]*[\s-]*(?:" + _UNIT + r")\b)"
)

#: A number after one of these is a catalogue designation, not a year. HD
#: 223889 is a star and Gliese 877 is the Doran homeworld; neither is a date.
_DESIGNATION = re.compile(
    r"\b(?:HD|HIP|HR|GL|GJ|Gliese|NGC|IC|JD|TYC|Wolf|Ross|Lalande|Luyten|LHS|LP|"
    r"BD|CD|SAO|Struve|Kepler|KOI|WISE|PSR|LTT|LFT|G|HDE|Tau|Messier|M|Melotte|YTS|"
    r"Collinder|Cr|Trumpler|Stock|Berkeley|Ruprecht|Pismis|Bochum|Ursa|EQ|EV|AD|"
    r"YZ|DX|GQ|UV|BL|CN|FL|AU|EZ|QY|TZ|V|van Maanen|Groombridge|Barnard|Kapteyn|"
    r"Teegarden|Proxima|Sirius|Procyon|Altair|Vega|Fomalhaut)\s*-?\s*\d+(?:[-+.]\d+)*",
    re.I,
)

#: What the site prints under every article, and which no reader wants dated:
#: the day it was first published and the day its data panel was last touched.
_BOILERPLATE = re.compile(
    r"^(?:Initially published|Data panel update|Text update|Updated?\b|Page updated|"
    r"Text by|Image from|©|Copyright)"
    r"|Orion's Arm Universe Project Inc"
    # "Minor fact correction edit (2022-02-18, by The Astronomer)": the
    # revision log, which every article carries under its text.
    r"|\(\d{4}-\d\d-\d\d(?:, by|\))",
    re.I,
)

#: The hedges the articles date with, and the precision each one claims.
_HEDGE = [
    (re.compile(r"\b(?:c\.|ca\.|circa|around|about|approximately|roughly|some)\s+\d", re.I), "circa"),
    (re.compile(r"\b(?:early|late|mid)[\s-]+\d", re.I), "circa"),
    (re.compile(r"\b(?:before|prior to|by|until|no later than)\s+\d", re.I), "not_later_than"),
    (re.compile(r"\b(?:after|since|from|no earlier than)\s+\d", re.I), "not_earlier_than"),
    (re.compile(r"\bbetween\s+\d", re.I), "between"),
]

#: A word that ends the name of a polity, in the setting's usage. What this
#: finds is a verbatim capitalised phrase and nothing more; it is not a claim
#: that the phrase names a polity, still less that the polity held anything.
#: Inner Sphere and Dyson Sphere match, and the reader passes over them.
_POLITY_SUFFIX = (
    "Empire|League|Federation|Alliance|Republic|Nexus|Dominion|Union|Commonwealth|"
    "Hegemony|Confederation|Ambi|Zone|Consortium|Coalition|Association|Society|"
    "Compact|Concord|Protectorate|Kingdom|Directorate|Collective|Biopolity|"
    "Hypernation|Panvirtuality|Covenant|Organization|Organisation|Polity|Sphere"
)
_POLITY_PHRASE = re.compile(r"\b((?:[A-Z][\w'-]+\s){0,3}(?:" + _POLITY_SUFFIX + r"))\b")

#: The panel fields whose value is a date or a holder, which are the two things
#: the worksheet exists for. The rest of the panel is stellar physics and
#: stays on the article.
PANEL_FIELDS = {
    "colonised", "colonized", "colonisation", "colonization", "settled", "founded",
    "established", "reached", "first reached", "discovered", "explored", "visited",
    "affiliation", "allegiance", "polity", "government", "government and administration",
    "history", "status", "abandoned", "founded by", "first colonised", "first colonized",
}


def _text(fragment: str) -> str:
    """Markup to readable text, keeping what links say and dropping the links."""
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub("", fragment))).strip()


def _links(fragment: str) -> list[dict[str, str]]:
    return [
        {"kind": kind, "id": ident, "text": _text(label)}
        for kind, ident, label in _LINK.findall(fragment)
    ]


@dataclass
class Dated:
    """One sentence or panel field that carries a year."""

    where: str
    """``body`` for prose, or ``panel:<Label>`` for a data-panel field."""

    text: str
    years: list[int]
    form: str
    """``at`` when a year is written with its epoch, ``bare`` when only a number."""

    hint: str
    """The precision the sentence's own wording suggests; ``exact`` if unhedged."""

    polities: list[str]
    """Capitalised phrases ending in a polity word, verbatim."""

    links: list[dict[str, str]]
    """Encyclopaedia links in the sentence — the datum, where there is one."""


@dataclass
class Article:
    """One saved system article, reduced to what the worksheet needs."""

    id: str
    title: str
    crumbs: list[list[tuple[str, str]]]
    """Every navigation trail, as (id, name) pairs from the root down."""

    panel: list[tuple[str, str, list[dict[str, str]]]]
    """Data-panel fields as (label, text, links), sub-fields flattened in."""

    dated: list[Dated] = field(default_factory=list)

    @property
    def url(self) -> str:
        return f"{BASE}/eg-article/{self.id}"

    @property
    def held_by(self) -> list[str]:
        """What the article's own index says holds it, from the navigation.

        A trail through "Sephirotic Empires" ends at the present holder, and
        it is the Encyclopaedia's own filing rather than anything read out of
        prose — which makes it the one affiliation here a program can trust.
        """
        return [
            trail[-1][1]
            for trail in self.crumbs
            if len(trail) >= 3 and trail[1][1].casefold() == "sephirotic empires"
        ]


def _years(text: str) -> tuple[list[int], str]:
    """The years a sentence carries, and whether any is written with its epoch.

    A sentence that writes one year with its epoch is on that calendar for all
    of them: "between 1500 and 2100 AT" is two years, and the first is not a
    bare number. The bare pattern does not re-match a year the epoch pattern
    took, because the epoch is a letter after it.
    """
    scrubbed = _DESIGNATION.sub(lambda m: " " * len(m.group(0)), text)
    found = [
        (m.start(), -int(m.group(1)) if m.group(2).lower().startswith("b") else int(m.group(1)))
        for m in _AT_YEAR.finditer(scrubbed)
    ]
    taken = {start for start, _ in found}
    # "10198 A.T," is one year: the epoch pattern has it, and the bare pattern
    # would have it again because the comma is not the dot the unit list wants.
    bare = [
        (m.start(), int(m.group(1)))
        for m in _BARE_YEAR.finditer(scrubbed)
        if m.start() not in taken
    ]
    if found:
        return [year for _, year in sorted(found + bare)], "at"
    return [year for _, year in bare], "bare" if bare else ""


def _hint(text: str) -> str:
    for pattern, precision in _HEDGE:
        if pattern.search(text):
            return precision
    return "exact"


def _dated(where: str, fragment: str) -> Dated | None:
    text = _text(fragment)
    if _BOILERPLATE.search(text):
        return None
    years, form = _years(text)
    if not years:
        return None
    return Dated(
        where=where,
        text=text,
        years=years,
        form=form,
        hint=_hint(text),
        polities=sorted(set(_POLITY_PHRASE.findall(text))),
        links=_links(fragment),
    )


def _panel_fields(markup: str) -> list[tuple[str, str, list[dict[str, str]]]]:
    """Every field of the data panel, with a row's bold sub-fields split out.

    The panel is a two-column table, and its cells are free markup: the
    "Polity" row of Sesharia holds a name, a symbol, an affiliation and a
    colonisation date, each behind its own bold label. Those are the fields a
    reader wants, so they come out as fields of their own, named "Polity /
    Affiliation" so the row they sat in is not lost.
    """
    fields: list[tuple[str, str, list[dict[str, str]]]] = []
    for block in _PANEL.findall(markup):
        for label, cell in _PANEL_ROW.findall(block):
            label = _text(label).rstrip(":").strip()
            parts = _SUBFIELD.split(cell)
            # parts alternates: leading text, sub-label, sub-text, sub-label, …
            lead = parts[0]
            if _text(lead):
                fields.append((label, _text(lead), _links(lead)))
            for sub_label, sub_cell in zip(parts[1::2], parts[2::2]):
                name = f"{label} / {_text(sub_label)}"
                fields.append((name, _text(sub_cell), _links(sub_cell)))
    return fields


def parse_article(markup: str, topics: bool = False) -> Article | None:
    """One saved page, or None where it is not a system article.

    The folder holds a few of the alphabetical index pages beside the articles
    they list; those are topics, and what they date is other articles. A
    polity's own page is a topic too — the Sephirotic empires are filed as
    topics with an essay and a data panel — and reading those for founding
    years is what `topics` is for.
    """
    found = _ARTICLE_ID.search(markup)
    if not found and topics:
        found = _TOPIC_ID.search(markup)
    if not found or (not topics and _TOPIC_ID.search(markup)):
        return None
    title_found = _TITLE.search(markup)
    title = _text(title_found.group(1)) if title_found else ""

    flat = _STRIP.sub("", markup)
    crumb_block = _CRUMB_BLOCK.search(flat)
    crumbs: list[list[tuple[str, str]]] = []
    if crumb_block:
        for trail in re.split(r"<br\s*/?>", crumb_block.group(1), flags=re.I):
            pairs = _CRUMB.findall(trail)
            if pairs:
                crumbs.append([(ident, _text(name)) for ident, name in pairs])

    article = Article(id=found.group(1), title=title, crumbs=crumbs, panel=_panel_fields(flat))

    for label, text, links in article.panel:
        head = label.split(" / ")[-1].casefold()
        if head in PANEL_FIELDS or label.casefold() in PANEL_FIELDS:
            # A field is read a sentence at a time, as the prose is: the
            # "History" sub-field of a panel is a whole essay in a cell, and
            # one row carrying five years is a row the reader has to re-read.
            found = False
            for sentence in _SENTENCE.split(text):
                dated = _dated(f"panel:{label}", sentence)
                if dated:
                    dated.links = [l for l in links if l["text"] and l["text"] in sentence]
                    article.dated.append(dated)
                    found = True
            if not found and head in PANEL_FIELDS:
                # An undated holder is still a holder. "Affiliation: Currently
                # NoCoZo, former Doran Empire world" dates nothing and says
                # more about the place's history than most dated sentences.
                article.dated.append(
                    Dated(
                        where=f"panel:{label}",
                        text=text,
                        years=[],
                        form="",
                        hint="",
                        polities=sorted(set(_POLITY_PHRASE.findall(text))),
                        links=links,
                    )
                )

    body_start = _BODY_START.search(flat)
    body = flat[body_start.start() :] if body_start else flat
    body = _PANEL.sub(" ", body)
    if crumb_block:
        body = body.replace(crumb_block.group(0), " ")
    # Sentences are split on the markup first, so a link survives to be read
    # out of each sentence, and only then on punctuation.
    for chunk in _BREAK.split(body):
        plain = _text(chunk)
        if not plain:
            continue
        # A sentence's links are found again in its markup by the text they
        # carry, because the split on punctuation happened after tags came off.
        chunk_links = _links(chunk)
        for sentence in _SENTENCE.split(plain):
            dated = _dated("body", sentence)
            if not dated:
                continue
            dated.links = [link for link in chunk_links if link["text"] and link["text"] in sentence]
            article.dated.append(dated)
    return article


def prose(markup: str) -> str:
    """The article's text alone, for a reader that reads whole articles.

    The worksheet carries only the sentences with a year or a holder in them,
    which is enough to find the claims and not always enough to read them:
    Corona's "it then joined the NoCoZo, was annexed by the Solar Dominion, and
    finally became an Iota Network world" carries no year and frames every
    dated line around it. The navigation, the data panel and the footer are
    left in, since the panel is often where the dates are.
    """
    flat = _STRIP.sub("", markup)
    start = _BODY_START.search(flat)
    body = flat[start.start() :] if start else flat
    text = html.unescape(_TAG.sub(" ", _BREAK.sub("\n", body)))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def read_articles(folder: Path, topics: bool = False) -> tuple[list[Article], int]:
    """Every article in the folder, and how many pages were skipped as topics."""
    articles: list[Article] = []
    skipped = 0
    for path in sorted(folder.glob("*.htm*")):
        article = parse_article(path.read_text(encoding="utf-8", errors="replace"), topics)
        if article is None:
            skipped += 1
        else:
            articles.append(article)
    return articles, skipped


def _events_by_article(places: Iterable[Place]) -> dict[str, list[str]]:
    """What the world file already dates, keyed by article URL.

    Shown on every row so the reader sees the gap rather than the article:
    a place with "settled 1102" already recorded needs its transfer read, not
    its settlement read again.
    """
    out: dict[str, list[str]] = {}
    for place in places:
        if place.source != "worlds.yaml" or not place.article:
            continue
        events = place.record.get("events") or []
        out[place.article.rstrip("/")] = [
            f"{e.get('kind')} {e.get('year_at')}"
            + (f"-{e['until_at']}" if e.get("until_at") else "")
            + (f" ({e['polity']})" if e.get("polity") else "")
            for e in events
        ]
    return out


WORKSHEET_COLUMNS = [
    "article", "title", "held_by", "place", "file", "has",
    "where", "form", "years", "hint", "polities", "links", "text",
]


def worksheet_rows(
    articles: Iterable[Article], places: list[Place] | None = None
) -> list[dict[str, str]]:
    """One row per dated sentence or holder field, joined to the map's places.

    Articles come out in the order a reader should take them: first those on
    the map that state a year where the map has none, then the rest of the
    ones on the map, then the ones bound to nowhere — and within each, the
    article with the most dated rows first. A reading pass that stops early
    has then read the articles with the most to give.
    """
    places = places if places is not None else all_places()
    index = by_article(places)
    events = _events_by_article(places)

    def order(article: Article) -> tuple[int, int]:
        bound = bool(index.get(article.url))
        dated = sum(1 for d in article.dated if d.years)
        if bound and dated and not events.get(article.url):
            rank = 0
        elif bound:
            rank = 1
        else:
            rank = 2
        return rank, -len(article.dated)

    rows: list[dict[str, str]] = []
    for article in sorted(articles, key=order):
        bound = index.get(article.url, [])
        names = "; ".join(dict.fromkeys(p.name for p in bound))
        files = "; ".join(dict.fromkeys(p.source for p in bound))
        has = "; ".join(events.get(article.url, []))
        for dated in article.dated:
            rows.append(
                {
                    "article": article.id,
                    "title": article.title,
                    "held_by": "; ".join(article.held_by),
                    "place": names,
                    "file": files,
                    "has": has,
                    "where": dated.where,
                    "form": dated.form,
                    "years": " ".join(str(y) for y in dated.years),
                    "hint": dated.hint,
                    "polities": "; ".join(dated.polities),
                    "links": "; ".join(
                        f"{link['text']} [{link['kind']}:{link['id']}]" for link in dated.links
                    ),
                    "text": dated.text,
                }
            )
    return rows


def write_worksheet(rows: list[dict[str, str]], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=WORKSHEET_COLUMNS, delimiter="\t",
                                lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def show(article: Article, rows: list[dict[str, str]]) -> str:
    """An article's share of the worksheet, laid out to be read rather than parsed."""
    own = [row for row in rows if row["article"] == article.id]
    head = [f"{article.title}  <{article.url}>"]
    if article.held_by:
        head.append(f"  filed under: {', '.join(article.held_by)}")
    if own:
        if own[0]["place"]:
            head.append(f"  on the map as: {own[0]['place']} ({own[0]['file']})")
        else:
            head.append("  not on the map")
        if own[0]["has"]:
            head.append(f"  already dated: {own[0]['has']}")
    lines = head
    for row in own:
        tag = f"[{row['where']}]"
        years = f" {row['years']}" if row["years"] else ""
        hint = f" ~{row['hint']}" if row["hint"] not in ("", "exact") else ""
        form = " (bare)" if row["form"] == "bare" else ""
        lines.append(f"  {tag}{years}{hint}{form}: {row['text']}")
        if row["polities"] or row["links"]:
            lines.append(f"      polities: {row['polities']}  links: {row['links']}")
    return "\n".join(lines)


def summarise(
    articles: list[Article],
    rows: list[dict[str, str]],
    skipped: int,
    places: list[Place] | None = None,
) -> dict[str, Any]:
    """The numbers a run prints, so a change in the corpus or the parser shows.

    Whether an article is on the map is read from the places, not from its
    rows: an article the parser found nothing to date is still on the map, and
    counting it as absent made the number move whenever the parser did.
    """
    index = by_article(places if places is not None else all_places())
    by_article_rows: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_article_rows.setdefault(row["article"], []).append(row)
    bound = [a for a in articles if index.get(a.url)]
    undated_places = [
        a for a in bound
        if a.id in by_article_rows
        and not by_article_rows[a.id][0]["has"]
        and any(r["years"] for r in by_article_rows[a.id])
    ]
    return {
        "articles": len(articles),
        "skipped_topics": skipped,
        "with_panel": sum(1 for a in articles if a.panel),
        "filed_under_a_polity": sum(1 for a in articles if a.held_by),
        "rows": len(rows),
        "rows_at": sum(1 for r in rows if r["form"] == "at"),
        "rows_bare": sum(1 for r in rows if r["form"] == "bare"),
        "rows_holder_only": sum(1 for r in rows if not r["years"]),
        "articles_with_a_year": sum(1 for a in articles if any(d.years for d in a.dated)),
        "articles_on_the_map": len(bound),
        "articles_off_the_map": len(articles) - len(bound),
        "dated_but_map_undated": len(undated_places),
    }
