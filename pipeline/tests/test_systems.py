"""Laying out the system articles for a reader.

What the worksheet is for is exhaustiveness without invention: every year an
article states reaches the reader, and nothing reaches them that the page did
not say. The failures that matter are therefore the quiet ones — a catalogue
number read as a year, a page's own publication date read as history, a
data-panel field with five years in it collapsed to one line, an index page
parsed as though it were a system — and these tests build pages with exactly
those traps in them.
"""

from __future__ import annotations

from oastarmap.fiction.places import Place
from oastarmap.importers.systems import (
    Article,
    parse_article,
    show,
    summarise,
    worksheet_rows,
)

CRUMBS = (
    '<div align="right" style="padding-bottom: 8px;"><small>'
    '<a href="/eg-topic/45b17e0030cdc">Galactography</a>&nbsp;>&nbsp;'
    '<a href="/eg-topic/45bc1dcf97592">Regions of Space</a>&nbsp;>&nbsp;'
    '<a href="/eg-topic/45bcbcab90032">Inner Sphere</a><br>'
    '<a href="/eg-topic/45b17e0030cdc">Galactography</a>&nbsp;>&nbsp;'
    '<a href="/eg-topic/45bc148c97563">Sephirotic Empires</a>&nbsp;>&nbsp;'
    '<a href="/eg-topic/45cd3bb5026a4">Non-Coercive Zone (NoCoZo)</a><br>'
    "</small></div>"
)


def page(ident: str, title: str, body: str, panel: str = "", kind: str = "article") -> str:
    """A saved page, in the shape the real ones have."""
    return (
        "<html><head>"
        f"<title>Orion's Arm - Encyclopedia Galactica - {title}</title>"
        f'<meta property="og:url" content="https://www.orionsarm.com/eg-{kind}/{ident}" />'
        "</head><body>"
        '<div id="div_body"><div id="div_body_header"><span>'
        f"{title}</span></div>{CRUMBS}"
        f'{"<div class=" + chr(34) + "datapanel dpposcenter100" + chr(34) + "><table>" + panel + "</table></div>" if panel else ""}'
        f"<p>{body}</p>"
        "<p>Initially published on 04 August 2002.</p>"
        "</div></body></html>"
    )


def row(label: str, cell: str) -> str:
    return f"<tr><th>{label}:</th><td>{cell}</td></tr>"


SESHARIA = page(
    "48f94f1a7f8db",
    "Sesharia",
    "The Dorans arrived at HR 637 in 1133 AT. Secharia made contact with nearby "
    '<a href="/eg-article/57f4f02853c69">p Eridani</a> in 1307 AT. '
    "The last remnants entered the Terragen Federation in 5855. "
    'See also <a href="/eg-article/4ce43b81bb70d">Glim (HD 223889)</a>.',
    panel=row("System", "<b>Sesharia</b>")
    + row("Primary", "GL 86, HR 637")
    + row(
        "Polity",
        "<b>Name:</b> Sesharia <br><b>Affiliation:</b> Currently "
        '<a href="/eg-topic/45cd3bb5026a4">NoCoZo</a>, former '
        '<a href="/eg-article/464d0cf4b278f">Doran Empire</a> world. '
        "<br><b>Colonized:</b> 1102 AT by the Doran empire colony ship <i>Zschorn</i>",
    ),
)


def dated_by_where(article: Article) -> dict[str, list]:
    out: dict[str, list] = {}
    for dated in article.dated:
        out.setdefault(dated.where, []).append(dated)
    return out


def test_an_index_page_is_not_an_article():
    """The folder holds a few alphabetical index pages beside the articles.

    An index dates nothing itself, and every year on it belongs to some other
    article; reading one as a system would attribute all of them to nowhere.
    """
    assert parse_article(page("45e38b2fcd0bf", "Systems & Worlds S - T", "x 2100 AT", kind="topic")) is None


def test_reads_the_holder_out_of_the_navigation():
    """The one affiliation on the page a program can trust.

    A trail through "Sephirotic Empires" is the Encyclopaedia's own filing,
    not a sentence to be read; the "Regions of Space" trail beside it is not a
    holder and must not be taken for one.
    """
    article = parse_article(SESHARIA)
    assert article is not None
    assert article.id == "48f94f1a7f8db"
    assert article.title == "Sesharia"
    assert article.held_by == ["Non-Coercive Zone (NoCoZo)"]


def test_splits_a_panel_cell_into_its_bold_sub_fields():
    """The "Polity" row holds a name, an affiliation and a date behind bold labels.

    Those are the fields the reader wants, so each comes out under its own
    name with the row it sat in kept in front.
    """
    article = parse_article(SESHARIA)
    assert article is not None
    labels = [label for label, _, _ in article.panel]
    assert "Polity / Affiliation" in labels
    assert "Polity / Colonized" in labels

    fields = dated_by_where(article)
    [colonised] = fields["panel:Polity / Colonized"]
    assert colonised.years == [1102]
    assert colonised.form == "at"
    assert colonised.hint == "exact"


def test_keeps_an_undated_holder_field():
    """"Currently NoCoZo, former Doran Empire world" dates nothing and says more
    about the place's history than most sentences with a year in them."""
    article = parse_article(SESHARIA)
    assert article is not None
    [affiliation] = dated_by_where(article)["panel:Polity / Affiliation"]
    assert affiliation.years == []
    assert affiliation.polities == ["Doran Empire"]
    # The link is the datum: an article id for the dissolved polity, a topic
    # id for the present one.
    assert {(l["kind"], l["text"]) for l in affiliation.links} == {
        ("topic", "NoCoZo"),
        ("article", "Doran Empire"),
    }


def test_dates_the_body_a_sentence_at_a_time_with_its_links():
    article = parse_article(SESHARIA)
    assert article is not None
    body = dated_by_where(article)["body"]
    by_year = {tuple(d.years): d for d in body}
    assert (1133,) in by_year and by_year[(1133,)].form == "at"
    contact = by_year[(1307,)]
    assert [l["id"] for l in contact.links] == ["57f4f02853c69"]
    # A year the article leaves bare is kept, and marked as bare.
    remnants = by_year[(5855,)]
    assert remnants.form == "bare"
    assert remnants.polities == ["Terragen Federation"]


def test_a_catalogue_number_is_not_a_year():
    """HD 223889 is a star. Half of it read as 2388 was the first thing the
    worksheet got wrong, and Gliese 877 is the Doran homeworld, not a date."""
    article = parse_article(SESHARIA)
    assert article is not None
    years = {y for d in article.dated for y in d.years}
    assert 2388 not in years and 223889 not in years
    glim = parse_article(page("x", "Glim", "The colony at Gliese 877 sent a ship to HD 223889 and HIP 5643."))
    assert glim is not None and glim.dated == []


def test_the_site_footer_is_not_history():
    """Every page ends with the day it was first published and the day its
    panel was last touched. Neither is a thing that happened in the setting."""
    article = parse_article(page("x", "Somewhere", "Data panel update (2023-02-09, by AstroChara)"))
    assert article is not None
    assert article.dated == []
    sesharia = parse_article(SESHARIA)
    assert sesharia is not None
    assert 2002 not in {y for d in sesharia.dated for y in d.years}


def test_a_hedge_is_carried_as_a_precision_hint():
    article = parse_article(
        page("x", "Hedged", "Settled circa 3100 AT. Abandoned before 4200 AT. Reached after 2000 AT. Founded between 1500 and 2100 AT.")
    )
    assert article is not None
    hints = {tuple(d.years): d.hint for d in article.dated}
    assert hints[(3100,)] == "circa"
    assert hints[(4200,)] == "not_later_than"
    assert hints[(2000,)] == "not_earlier_than"
    assert hints[(1500, 2100)] == "between"


def test_a_year_with_its_epoch_is_counted_once():
    """"10198 A.T," is one year, not the same year twice."""
    article = parse_article(page("x", "Once", "This was the status quo as of 10198 A.T, when it was sent."))
    assert article is not None
    assert [d.years for d in article.dated] == [[10198]]


def test_before_tranquility_counts_backwards():
    article = parse_article(page("x", "Old", "First observed in 7000 BT."))
    assert article is not None
    assert [d.years for d in article.dated] == [[-7000]]


def test_a_reference_year_is_not_split_into_a_smaller_one():
    """"(10447)" in a bibliography is a year in the setting's eleventh
    millennium, not 1044 followed by a seven."""
    article = parse_article(page("x", "Cited", "The Story Of New Callisto, New Genome (10447)"))
    assert article is not None
    assert [d.years for d in article.dated] == [[10447]]


def test_the_worksheet_joins_each_article_to_the_map_and_what_it_already_dates():
    article = parse_article(SESHARIA)
    assert article is not None
    places = [
        Place(
            "Sesharia",
            "worlds.yaml",
            article.url,
            record={"events": [{"kind": "settled", "year_at": 1102, "polity": "doran-empire"}]},
        ),
        Place("Sesharia", "inner_sphere.yaml", article.url),
    ]
    rows = worksheet_rows([article], places)
    assert rows and all(r["place"] == "Sesharia" for r in rows)
    assert rows[0]["file"] == "worlds.yaml; inner_sphere.yaml"
    assert rows[0]["has"] == "settled 1102 (doran-empire)"
    assert rows[0]["held_by"] == "Non-Coercive Zone (NoCoZo)"

    laid_out = show(article, rows)
    assert "already dated: settled 1102 (doran-empire)" in laid_out
    assert "[panel:Polity / Colonized] 1102:" in laid_out


def test_the_summary_counts_the_gap_the_reader_is_working_down():
    """The number that matters is articles the map has but has not dated."""
    article = parse_article(SESHARIA)
    assert article is not None
    undated = [Place("Sesharia", "worlds.yaml", article.url, record={"events": []})]
    summary = summarise([article], worksheet_rows([article], undated), skipped=1, places=undated)
    assert summary["articles"] == 1
    assert summary["skipped_topics"] == 1
    assert summary["articles_on_the_map"] == 1
    assert summary["dated_but_map_undated"] == 1
    assert summary["rows_holder_only"] == 1
    assert summary["rows_at"] + summary["rows_bare"] + summary["rows_holder_only"] == summary["rows"]

    off_map = summarise([article], worksheet_rows([article], []), skipped=0, places=[])
    assert off_map["articles_off_the_map"] == 1


def test_the_worksheet_puts_the_articles_with_the_most_to_give_first():
    """A pass that stops early should have read the right articles.

    On the map and undated comes before on the map and dated, which comes
    before bound to nowhere; and within a rank, more dated rows first.
    """
    undated = parse_article(page("aaa", "Undated", "Settled in 2100 AT."))
    dated = parse_article(page("bbb", "Dated", "Settled in 2200 AT. Abandoned in 2300 AT."))
    nowhere = parse_article(page("ccc", "Nowhere", "Settled in 2400 AT. Abandoned 2500 AT. Reached 2000 AT."))
    assert undated and dated and nowhere
    places = [
        Place("Undated", "worlds.yaml", undated.url, record={"events": []}),
        Place("Dated", "worlds.yaml", dated.url, record={"events": [{"kind": "settled", "year_at": 2200}]}),
    ]
    # Given in the wrong order on purpose; the file order is by id, which is a hash.
    rows = worksheet_rows([nowhere, dated, undated], places)
    assert [r["article"] for r in rows] == ["aaa", "bbb", "bbb", "ccc", "ccc", "ccc"]
