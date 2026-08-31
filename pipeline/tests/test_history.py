"""Reading the Encyclopaedia's history pages, and binding them to the map.

The failures here are quiet ones. A timeline read off the wrong calendar still
looks like a timeline; a period whose events all went missing still renders as a
period with nothing in it; a link matched by name instead of by id still binds
to *a* place. So these tests build pages with the specific traps the real thirty
contain and check that the answer comes back right or does not come back at all.
"""

from __future__ import annotations

import json

import pytest

from oastarmap.build.history import _polities_named, article_id, build_history
from oastarmap.fiction.schema import Polity
from oastarmap.importers.history import import_history, parse, parse_page, slug
from oastarmap.paths import FICTION_DIR

CRUMB = '<div align="right" style="padding-bottom: 8px;"><small>{}</small></div>'


def page(title: str, topic: str, crumbs: list[tuple[str, str]], body: str = "") -> str:
    """A saved history page, in the shape the real ones have."""
    trail = "&nbsp;&gt;&nbsp;".join(
        f'<a href="/eg-topic/{ident}">{name}</a>' for ident, name in crumbs
    )
    return (
        "<html><head>"
        f"<title>Orion's Arm - Encyclopedia Galactica - {title}</title>"
        f'<meta property="og:url" content="https://www.orionsarm.com/eg-topic/{topic}" />'
        "</head><body>"
        f"{CRUMB.format(trail)}"
        "<div>An essay about the period, mentioning 2400 and other years.</div>"
        f"{body}"
        "</body></html>"
    )


def timeline(*lines: str) -> str:
    """The dated part of a period page, below the navigation."""
    return "<b>Previous Page</b><br /><br />" + "<br /><br />".join(lines)


ERA = ("45b2a735dbb26", "0900 to 3200 AT: Interstellar Era")
HISTORY = ("45b170f9e0941", "History")


def expansion(*lines: str) -> str:
    return page(
        "2100 to 2600 AT: The Age of Expansion",
        "45b2bcd74e186",
        [HISTORY, ERA, ("45b2bcd74e186", "2100 to 2600 AT: The Age of Expansion")],
        timeline(*lines),
    )


def test_reads_the_span_out_of_a_title():
    parsed = parse_page(expansion("2100 - something."))
    assert parsed["name"] == "The Age of Expansion"
    assert parsed["id"] == "age-of-expansion"
    assert (parsed["start_at"], parsed["end_at"]) == (2100, 2600)


def test_reads_the_bounds_the_source_leaves_open():
    """Two of the seven eras have a bound that is not a year.

    Filling either in would be inventing a date: the Preterragen Era opens at
    the Big Bang and the Current Era has not ended.
    """
    current = parse_page(page("9999 AT to Present: Current Era", "45b2ad0f11181", [HISTORY]))
    assert (current["start_at"], current["end_at"]) == (9999, None)

    pre = parse_page(page("-13.7Gy to -7000 AT: Preterragen Era", "4858422267d00", [HISTORY]))
    assert (pre["start_at"], pre["end_at"]) == (None, -7000)


def test_counts_before_tranquility_backwards():
    agricultural = parse_page(
        page(
            "7000 BT to 270 BT: The Agricultural Age",
            "45b2ae037c7b4",
            [HISTORY, ("45b2a375249bb", "-7000 to 30 AT: Pre-Spaceflight Old Earth")],
        )
    )
    assert (agricultural["start_at"], agricultural["end_at"]) == (-7000, -270)


def test_an_era_is_told_from_a_period_by_its_breadcrumb():
    era = parse_page(page("0900 to 3200 AT: Interstellar Era", "45b2a735dbb26", [HISTORY, ERA]))
    assert era["kind"] == "era"
    assert era["parent"] == ""

    period = parse_page(expansion("2100 - something."))
    assert period["kind"] == "period"
    assert period["parent"] == "interstellar-era"


def test_finds_the_timeline_below_a_repeated_navigation():
    """The Central Alliance page repeats its navigation as a footer.

    Taking the last block after the marker left that page — sixty dated lines of
    it — reading as though the Encyclopaedia recorded nothing for six centuries.
    """
    doubled = expansion("2200 - a colony is founded.") + "<b>Previous Page</b><br />"
    parsed = parse_page(doubled)
    assert [event["year_at"] for event in parsed["events"]] == [2200]


@pytest.mark.parametrize(
    ("line", "year", "until", "precision"),
    [
        ("2100 - plain.", 2100, None, "exact"),
        ("2100 AT - with the epoch spelled out.", 2100, None, "exact"),
        ("2100's - a decade, not a year.", 2100, None, "circa"),
        ("2100s - the same, spelled without the apostrophe.", 2100, None, "circa"),
        ("2100-2300 - something that took two centuries.", 2100, 2300, "exact"),
        ("2100+ - and everything after.", 2100, None, "not_earlier_than"),
    ],
)
def test_reads_every_form_the_timeline_dates_itself_in(line, year, until, precision):
    """A range is a duration, not an uncertainty.

    On a timeline "4450-4650 - the Version War" is a war that lasted two
    centuries. Recording it as `between` would say instead that nobody knows
    when it happened to within two hundred years.
    """
    event = parse_page(expansion(line))["events"][0]
    assert (event["year_at"], event["until_at"], event["precision"]) == (year, until, precision)


def test_ignores_a_line_that_is_not_dated():
    parsed = parse_page(expansion("The AI Gods develop reactionless drives.", "2100 - dated."))
    assert len(parsed["events"]) == 1


def test_keeps_the_article_a_line_links():
    """The id, not the name.

    Several places in the Encyclopaedia are called Nova Terra. Matching a
    timeline line to a place by its name would bind the history of all of them
    to whichever one this project happens to hold.
    """
    line = '2200 - <a href="/eg-article/46de1625d2357">Qjellto</a> [Cygexpa] terraformed.'
    event = parse_page(expansion(line))["events"][0]
    assert event["links"] == [
        {"kind": "article", "id": "46de1625d2357", "text": "Qjellto"}
    ]
    # The link text stays in the sentence; only the markup goes.
    assert event["text"] == "Qjellto [Cygexpa] terraformed."


def test_drops_a_page_that_dates_on_another_calendar():
    """The Industrial Age runs 270 BT to 30 AT and dates its timeline 1800.

    Those are c.e. years. Read as written they land in the Age of Consolidation,
    putting the first steamboat two thousand years after the first starship.
    """
    industrial = page(
        "270 BT to 30 AT: The Industrial Age",
        "45b2aea00c2d7",
        [HISTORY, ("45b2a375249bb", "-7000 to 30 AT: Pre-Spaceflight Old Earth")],
        timeline(
            "1800 - first electrochemical battery.",
            "1807 - first commercially successful steamboat.",
            "1969 - first landing on the Moon.",
        ),
    )
    assert parse_page(industrial)["events"] == []


def test_keeps_a_page_that_merely_spills_past_its_own_heading():
    """The Version War page carries 4445 and 4690 for a period billed 4450-4650.

    That is the source being loose about a boundary, not about an epoch, and a
    rule strict enough to drop those would drop a fifth of the timeline.
    """
    war = page(
        "4450 to 4650 AT: The Version War Period",
        "45b2c136bbf67",
        [HISTORY, ("45b2a89db4a2a", "3200 to 5200 AT: Inner Sphere Era"),
         ("45b2c136bbf67", "4450 to 4650 AT: The Version War Period")],
        timeline(
            "4445 - the first version sabotages.",
            "4500 - the war in earnest.",
            "4600 - and still going.",
            "4690 - the economy recovers.",
        ),
    )
    assert [event["year_at"] for event in parse_page(war)["events"]] == [4445, 4500, 4600, 4690]


def test_never_reads_a_before_common_era_date_as_a_year_after_tranquility():
    agricultural = page(
        "7000 BT to 270 BT: The Agricultural Age",
        "45b2ae037c7b4",
        [HISTORY, ("45b2a375249bb", "-7000 to 30 AT: Pre-Spaceflight Old Earth")],
        timeline("~8000 b.c.e. - first permanent towns, first walled cities."),
    )
    assert parse_page(agricultural)["events"] == []


def test_orders_the_hierarchy_as_history_runs():
    pages = [
        expansion("2100 - a."),
        page("0900 to 3200 AT: Interstellar Era", "45b2a735dbb26", [HISTORY, ERA]),
        page(
            "2600 to 3200 AT: Age of Establishment",
            "45b2bdda4ba81",
            [HISTORY, ERA, ("45b2bdda4ba81", "2600 to 3200 AT: Age of Establishment")],
            timeline("2700 - b."),
        ),
    ]
    assert [entry["id"] for entry in parse(pages)] == [
        "interstellar-era",
        "age-of-expansion",
        "age-of-establishment",
    ]


def test_slugs_drop_a_leading_article():
    assert slug("The Age of Expansion") == "age-of-expansion"
    assert slug("Middle Federation / Megacorps") == "middle-federation-megacorps"


def test_article_id_out_of_either_url_form():
    assert article_id("https://www.orionsarm.com/eg-article/46de1625d2357") == "46de1625d2357"
    assert article_id("https://www.orionsarm.com/eg-topic/45cd30902bea3") == "45cd30902bea3"
    assert article_id("https://example.com/nothing") == ""


def _built(tmp_path, lines, worlds):
    """Import a one-period file, build it, and hand back history.json."""
    source = tmp_path / "history"
    source.mkdir()
    # The era page too: a period whose era is missing is a broken hierarchy, and
    # the schema refuses it rather than letting a half-read import through.
    (source / "era.htm").write_text(
        page("0900 to 3200 AT: Interstellar Era", "45b2a735dbb26", [HISTORY, ERA]),
        encoding="utf-8",
    )
    (source / "expansion.htm").write_text(expansion(*lines), encoding="utf-8")
    fiction = tmp_path / "fiction"
    fiction.mkdir()
    import_history(source, fiction / "history.yaml")

    out = tmp_path / "out"
    out.mkdir()
    (out / "worlds.json").write_text(json.dumps(worlds), encoding="utf-8")
    fragment = build_history(fiction, out)
    return fragment, json.loads((out / "history.json").read_text(encoding="utf-8"))


def test_binds_a_timeline_line_to_the_place_it_links(tmp_path):
    fragment, built = _built(
        tmp_path,
        ['2200 - <a href="/eg-article/aaa">Qjellto</a> terraformed.'],
        [
            {
                "name": "Qjellto",
                "article": "https://www.orionsarm.com/eg-article/aaa",
                "method": "star",
            }
        ],
    )
    period = next(entry for entry in built["periods"] if entry["id"] == "age-of-expansion")
    assert period["events"][0]["places"] == [
        {"article": "aaa", "ref": "world", "name": "Qjellto", "world": "Qjellto", "located": True}
    ]
    assert fragment["stats"]["links_to_places"] == 1
    assert fragment["stats"]["places"] == 1


def test_does_not_bind_by_name(tmp_path):
    """A different article about a place with the same name is a different place."""
    _, built = _built(
        tmp_path,
        ['2200 - <a href="/eg-article/aaa">Nova Terra</a> secedes.'],
        [
            {
                "name": "Nova Terra",
                "article": "https://www.orionsarm.com/eg-article/zzz",
                "method": "star",
            }
        ],
    )
    period = next(entry for entry in built["periods"] if entry["id"] == "age-of-expansion")
    assert period["events"][0]["places"] == []
    assert period["places"] == []


def test_ranks_a_periods_places_by_how_often_it_names_them(tmp_path):
    """What "important in this era" means here, and all it means.

    A place the century's timeline returns to is a place that century was
    about; one it names once in passing is not. That is as much as a link count
    can honestly claim, and it is the claim the panel makes.
    """
    _, built = _built(
        tmp_path,
        [
            '2100 - <a href="/eg-article/aaa">Often</a> founded.',
            '2200 - <a href="/eg-article/aaa">Often</a> grows.',
            '2300 - <a href="/eg-article/bbb">Once</a> is surveyed.',
            '2400 - <a href="/eg-article/aaa">Often</a> again.',
        ],
        [
            {"name": "Often", "article": "https://www.orionsarm.com/eg-article/aaa",
             "method": "star"},
            {"name": "Once", "article": "https://www.orionsarm.com/eg-article/bbb",
             "method": "none"},
        ],
    )
    period = next(entry for entry in built["periods"] if entry["id"] == "age-of-expansion")
    places = period["places"]
    assert [(place["name"], place["mentions"]) for place in places] == [("Often", 3), ("Once", 1)]
    # A place the map holds but cannot position is listed and marked, not hidden:
    # the period named it, and that is true whether or not we know where it is.
    assert places[1]["located"] is False


def test_counts_the_links_that_reach_nothing(tmp_path):
    """Most links are not places, and that is the expected case.

    The timeline links technologies, treaties and clades far more often than
    star systems. What the report states is the ratio, so a reader can see how
    much of a century's history the map can show.
    """
    fragment, _ = _built(
        tmp_path,
        ['2200 - <a href="/eg-article/tech">reactionless drives</a> are developed.'],
        [],
    )
    assert fragment["stats"]["links"] == 1
    assert fragment["stats"]["links_to_places"] == 0

def _pattern_for(name, **kwargs):
    return Polity(id=name.lower().replace(" ", "-"), name=name, color="#ffffff", **kwargs)


class TestPolitiesNamed:
    """Which polities a century was about, which is a smaller claim than who held it.

    The affiliations elsewhere in this project are undated, so counting today's
    holders among the places that existed in 515 A.T. reported the Sophic League
    a millennium and a half before the timeline first mentions it. A mention is
    something the source actually says.
    """

    def patterns(self, *polities):
        import re

        return [(p, re.compile(rf"\b{re.escape(p.name)}\b", re.I)) for p in polities]

    def test_counts_the_lines_that_name_a_polity(self):
        dominion = _pattern_for("Solar Dominion")
        events = [
            {"text": "The Solar Dominion backs the Concord Ontology."},
            {"text": "Metasoft frustrates the Solar Dominion."},
            {"text": "Nothing to do with anybody."},
        ]
        assert _polities_named(events, self.patterns(dominion)) == [
            {"id": "solar-dominion", "name": "Solar Dominion", "color": "#ffffff", "mentions": 2}
        ]

    def test_a_century_before_any_polity_names_none(self):
        """The check that this measures something real.

        The Sundering runs 530 to 900 A.T. and names no polity in this map's
        list, because none of them existed. A rule that found one there would be
        matching on something other than the history.
        """
        dominion = _pattern_for("Solar Dominion")
        events = [{"text": "The arkship Starlark departs Solsys with 18,000 colonists."}]
        assert _polities_named(events, self.patterns(dominion)) == []

    def test_does_not_match_a_name_inside_a_longer_word(self):
        umma = _pattern_for("Umma")
        assert _polities_named([{"text": "Summary of the period."}], self.patterns(umma)) == []

    def test_skips_the_names_that_mean_something_else(self):
        """Two names cannot survive being looked for in prose.

        "Vela" is a constellation and the first half of Neu Vela; "Xenosophont"
        is a category this project uses as a bucket and not the name of anybody.
        Both are excluded by hand, because the rule that would catch them — no
        match after a capital — also refuses "The Vela Immunity".
        """
        from oastarmap.build.history import _polity_patterns

        patterns = _polity_patterns(FICTION_DIR)
        excluded = {"vela", "xenosophont"}
        assert not (excluded & {polity.id for polity, _ in patterns})
        assert len(patterns) > 40
