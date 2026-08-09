"""Write ``questions.md`` — everything the map cannot settle for itself.

The document exists to be taken to the Orion's Arm community, so it is written
for a reader who knows the setting and not this codebase. Every item says what
we hold, what the sources say, what the map does in the meantime, and what would
settle it. An item that only says "unclear" wastes the reader's time.

It is generated rather than kept by hand because most of it is counted straight
out of the datasets — unresolved star names, distance disagreements, landmarks
past the frontier — and those change with every edit to the fiction. A
hand-maintained copy would be stale within a week, and a stale list of open
questions is worse than none: it sends someone to answer a question that is no
longer open.

The half that cannot be counted lives in ``fiction/questions.yaml``: the
contradictions where both sources parsed perfectly and simply disagree, the
readings that could go either way, the category questions about the setting.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from oastarmap.fiction.schema import FictionFile, Question, QuestionFile
from oastarmap.paths import FICTION_DIR

QUESTIONS_FILE = "questions.yaml"
OUTPUT_NAME = "questions.md"

#: How many examples to list before saying "and N more". Long enough to show the
#: shape of the problem, short enough that the document stays readable.
SAMPLE = 12


def _plural(count: int, singular: str, plural: str = "") -> str:
    """"1 row" / "6 rows". The document is for people, not for a log."""
    return f"{count:,} {singular if count == 1 else (plural or singular + 's')}"


def _tidy(name: str) -> str:
    """Catalogue names are stored with underscores; nobody writes them that way."""
    return name.replace("_", " ")


def _sample(items: list[str], limit: int = SAMPLE) -> str:
    shown = ", ".join(str(item) for item in items[:limit])
    if len(items) > limit:
        return f"{shown}, and {len(items) - limit:,} more"
    return shown


def _question_section(question: Question) -> list[str]:
    lines = [f"### {question.topic} — {question.summary}", ""]
    if question.severity:
        lines.append(f"*{question.severity}*")
        lines.append("")
    if question.detail:
        lines.append(question.detail)
        lines.append("")
    if question.map_does:
        lines.append(f"**What the map does now.** {question.map_does}")
        lines.append("")
    if question.would_settle:
        lines.append(f"**What would settle it.** {question.would_settle}")
        lines.append("")
    for link in question.links:
        lines.append(f"- {link}")
    if question.links:
        lines.append("")
    return lines


def _derived_sections(datasets: dict[str, Any]) -> list[str]:
    """The half of the document that is counted rather than written."""
    lines: list[str] = []

    # Polity display names. The datasets carry slugs, which are an implementation
    # detail — a reader should see "Keter Dominion", not "keter-dominion".
    polity_name = {
        p.id: p.name for p in FictionFile.load(FICTION_DIR / "polities.yaml").polities
    }

    inner = datasets.get("inner_sphere")
    if inner:
        stats = inner["stats"]
        lines += [
            "## The Inner Sphere colony tables",
            "",
            f"{stats['resolved']:,} of {stats['total_rows']:,} rows resolve to a star we "
            "hold. The rest break down as follows.",
            "",
        ]

        if stats["unresolved"]:
            lines += [
                f"### {_plural(len(stats['unresolved']), 'star name')} we cannot match",
                "",
                "Names that are not obviously from a catalogue we lack — secondary "
                "components, variable-star designations, and forms we may simply be "
                "parsing wrong. This is the list most likely to contain our mistakes "
                "rather than the setting's.",
                "",
                f"{_sample(sorted(stats['unresolved']))}",
                "",
            ]

        if stats["absent_catalogue"]:
            lines += [
                f"### {_plural(len(stats['absent_catalogue']), 'name')} from "
                "catalogues we do not carry",
                "",
                "2MASS, WISE, DENIS, SCR and Luhman designations. Not a question for "
                "the setting — these are real objects, and the gap is ours to close "
                "by adding the catalogues. Listed so nobody spends time on them.",
                "",
                f"{_sample(sorted(stats['absent_catalogue']))}",
                "",
            ]

        if stats["distance_disagreement"]:
            lines += [
                f"### {_plural(len(stats['distance_disagreement']), 'distance')} "
                "that disagree by 15-50%",
                "",
                "Kept and drawn at the catalogue's distance. A gap of this size is "
                "usually a pre-Gaia parallax against a modern one rather than a "
                "different star, but it is worth knowing which figure the setting "
                "means to assert.",
                "",
            ]
            for row in stats["distance_disagreement"]:
                if isinstance(row, dict):
                    lines.append(
                        f"- **{row.get('colony') or row.get('star')}** — "
                        f"{row.get('source_ly')} ly stated, "
                        f"{row.get('catalogue_ly')} ly in catalogue"
                    )
                else:
                    lines.append(f"- {row}")
            lines.append("")

        if stats["rejected_distance"]:
            lines += [
                f"### {_plural(len(stats['rejected_distance']), 'row')} rejected as "
                "the wrong star",
                "",
                "The name matched but the distance was out by more than half, which "
                "is too far to be a parallax revision. Dropped rather than drawn in "
                "the wrong place.",
                "",
            ]
            for row in stats["rejected_distance"]:
                if isinstance(row, dict):
                    lines.append(
                        f"- **{row.get('star')}** — {row.get('source_ly')} ly stated, "
                        f"{row.get('catalogue_ly')} ly at the star of that name"
                    )
                else:
                    lines.append(f"- {row}")
            lines.append("")

        if stats["assignments_awaiting_star"]:
            lines += [
                f"### {_plural(len(stats['assignments_awaiting_star']), 'polity assignment')} "
                "with nowhere to go",
                "",
                "Colonies we have been given a polity for, whose star does not "
                "resolve. The assignment is held and will apply the moment the name "
                "matches.",
                "",
                f"{_sample(sorted(stats['assignments_awaiting_star']))}",
                "",
            ]

    fiction = datasets.get("fiction")
    if fiction:
        frontier = fiction["frontier"]
        flagged = frontier["flagged"]
        if flagged:
            lines += [
                f"## {_plural(len(flagged), 'landmark')} past the "
                f"{frontier['ly']:,.0f} ly frontier",
                "",
                "Landmarks that fall inside a polity's area on the political maps but "
                "sit far beyond any canonical Terragen frontier. The maps are slices "
                "of the galactic plane with approximate borders, so a landmark inside "
                "a polity's outline marks a direction rather than a territorial "
                "claim. Drawn, bound, and deliberately not given a polity colour.",
                "",
            ]
            for entry in flagged:
                matched = _tidy(entry["matched_name"] or "")
                also = f" (= {matched})" if matched and matched != entry["landmark"] else ""
                polities = ", ".join(polity_name.get(p, p) for p in entry["polities"])
                lines.append(
                    f"- **{entry['landmark']}**{also} at "
                    f"{entry['distance_ly']:,.0f} ly — {polities}"
                )
            lines.append("")

        pending = fiction["resolution"]["pending"]
        if pending:
            lines += [
                f"## {_plural(len(pending), 'landmark')} waiting on a catalogue",
                "",
                "Named in the political maps, and real, but in a catalogue this map "
                "does not carry yet — mostly supernova remnants, planetary nebulae "
                "and reflection nebulae. Ours to fix, not the setting's.",
                "",
                f"{_sample(sorted(pending), 24)}",
                "",
            ]

        shared = fiction.get("shared_landmarks") or []
        if shared:
            lines += [
                f"## {_plural(len(shared), 'landmark')} claimed by more than one polity",
                "",
                "Not necessarily an error — the political maps overlap, and a "
                "landmark on a boundary can legitimately fall in two volumes. "
                "Recorded in case any of these is a reading mistake.",
                "",
                f"{_sample(sorted(shared))}",
                "",
            ]

    worlds = datasets.get("worlds")
    if worlds:
        by_method = worlds["stats"]["by_method"]
        constellation = by_method.get("constellation", 0)
        if constellation:
            lines += [
                "## Worlds located only by constellation",
                "",
                f"{constellation} of {worlds['stats']['total']} canonical worlds are "
                "given as a distance and a constellation. That fixes the distance "
                "exactly and the direction only to the width of the constellation, "
                "which at these ranges is hundreds to thousands of light years. The "
                "map draws these with a broken ring rather than a solid one, and "
                "the detail panel gives the error in light years.",
                "",
                "Coordinates, or a nearby named star, would turn any of these from a "
                "region into a position.",
                "",
            ]

        unlocated = worlds["stats"]["unlocated"]
        if unlocated:
            lines += [
                f"## {_plural(len(unlocated), 'place')} described but not located",
                "",
                f"{_sample(sorted(unlocated))}",
                "",
            ]

    oastars = datasets.get("oastars")
    if oastars and oastars["stats"]["name_collisions"]:
        collisions = oastars["stats"]["name_collisions"]
        lines += [
            f"## {_plural(len(collisions), 'designation')} reused in the Celestia add-on",
            "",
            "One designation, two entries, different positions. Both are kept, since "
            "dropping either would discard a position the add-on asserts.",
            "",
            f"{_sample(sorted(collisions))}",
            "",
        ]

    return lines


def build_questions(
    datasets: dict[str, Any],
    questions_path: Path | None = None,
    out_path: Path | None = None,
) -> dict[str, Any]:
    """Write the questions document. Returns a small summary for the build report."""
    questions_path = questions_path or FICTION_DIR / QUESTIONS_FILE
    out_path = out_path or FICTION_DIR.parent / OUTPUT_NAME

    source = QuestionFile.load(questions_path)
    open_questions = [q for q in source.questions if q.status == "open"]
    settled = [q for q in source.questions if q.status == "settled"]

    lines = [
        "# Questions for the Orion's Arm community",
        "",
        "This map is built from the Encyclopaedia Galactica, the Celestia add-on, "
        "the Inner Sphere colony tables and the political maps of the Middle "
        "Regions, cross-checked against real astronomical catalogues. Where those "
        "disagree, or where a source locates something too loosely to draw, the "
        "disagreement is recorded here rather than quietly resolved.",
        "",
        "Nothing below is a complaint about the setting. Most of it is the ordinary "
        "friction of turning prose into coordinates, and a fair number of the items "
        "are our own gaps rather than the setting's — those are marked as such.",
        "",
        "**Generated by `oastarmap build`.** The counted sections come straight from "
        "the data and will change as it does; the written ones are in "
        "`fiction/questions.yaml`.",
        "",
        "---",
        "",
    ]

    if open_questions:
        lines += [f"## Open questions ({len(open_questions)})", ""]
        for question in open_questions:
            lines += _question_section(question)

    lines += _derived_sections(datasets)

    if settled:
        lines += [
            f"## Settled ({len(settled)})",
            "",
            "Kept so a question answered once is not asked again, and so that a "
            "confirmation is on the record alongside the contradictions.",
            "",
        ]
        for question in settled:
            lines += _question_section(question)

    # Trailing blank lines collapse to exactly one, so the file is stable across
    # rebuilds regardless of which sections happen to be present.
    text = "\n".join(lines).rstrip() + "\n"
    out_path.write_text(text, encoding="utf-8")

    return {
        "open": len(open_questions),
        "settled": len(settled),
        "path": str(out_path),
        "bytes": len(text.encode("utf-8")),
    }


def format_report(summary: dict[str, Any]) -> str:
    return (
        f"  questions  {summary['open']} open, {summary['settled']} settled "
        f"-> {OUTPUT_NAME}"
    )
