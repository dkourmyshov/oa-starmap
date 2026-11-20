"""Entity-centric lookups over the single OAUP graph."""

from __future__ import annotations

from oastarmap.fiction.places import all_places, by_article, by_name, by_polity
from oastarmap.fiction.schema import (
    ColonyAssignment,
    InnerSphereSystem,
    OAStarEntry,
    OASystem,
    Polity,
    World,
    WorldEvent,
    WorldLocation,
)
from oastarmap.fiction.store import OAUPStore


def build(tmp_path):
    fiction = tmp_path / "fiction"
    fiction.mkdir()
    store = OAUPStore.from_models(
        fiction / "oaup/",
        worlds=[
            World(
                name="Niuearth", kind="planet", affiliations=["metasoft"],
                article="https://www.orionsarm.com/eg-article/52b993102478a",
                location=WorldLocation(oa_star="JD 836902"),
            ),
            World(
                name="Twilight", kind="planet", also=["Dusk"],
                article="https://www.orionsarm.com/eg-article/aaa",
                location=WorldLocation(star="Omicron2 Eridani"),
                events=[WorldEvent(year_at=3000, kind="transferred", polity="linnent")],
            ),
        ],
        systems=[OASystem(
            star="JD 98738", label="Panthalassa", affiliation="zoeific-biopolity",
            article="https://www.orionsarm.com/eg-article/bbb",
        )],
        stars=[
            OAStarEntry(
                name="JD 98738", system="Panthalassa", ra_deg=1, dec_deg=2,
                distance_ly=862.51,
            ),
            OAStarEntry(name="JD 1", ra_deg=1, dec_deg=2, distance_ly=10),
        ],
        inner_systems=[
            InnerSphereSystem(star="Omicron2 Eridani A", colony="Keid", distance_ly="16.34"),
            InnerSphereSystem(star="HD 9999", colony="", distance_ly="20.0"),
        ],
        polities=[Polity(
            id="metasoft", name="Metasoft", color="#112233", landmarks=["Zeta Tauri"]
        )],
        colonies=[ColonyAssignment(colony="Keid", affiliations=["zoeific-biopolity"])],
    )
    store.save()
    return fiction


def test_gathers_every_kind_of_place(tmp_path):
    sources = {place.source for place in all_places(build(tmp_path))}
    assert sources == {"world", "celestia", "inner-sphere", "landmark"}


def test_finds_a_colony_table_place_that_has_no_article(tmp_path):
    index = by_name(all_places(build(tmp_path)))
    assert [place.source for place in index["keid"]] == ["inner-sphere"]
    assert not index["keid"][0].article


def test_article_index_covers_only_what_records_a_url(tmp_path):
    places = all_places(build(tmp_path))
    urls = by_article(places)
    assert "https://www.orionsarm.com/eg-article/bbb" in urls
    assert len(urls) < len(places)


def test_a_place_answers_to_its_aliases(tmp_path):
    index = by_name(all_places(build(tmp_path)))
    assert index["dusk"][0].name == "Twilight"
    assert index["omicron2 eridani"][0].name == "Twilight"
    assert index["jd 836902"][0].name == "Niuearth"


def test_an_import_and_its_curation_are_one_place(tmp_path):
    """The imported star and system curation are evidence about one entity."""
    index = by_name(all_places(build(tmp_path)))
    matches = index["panthalassa"]
    assert len(matches) == 1
    assert matches[0].source == "celestia"
    assert matches[0].article.endswith("/bbb")
    assert matches[0].polities == ["zoeific-biopolity"]


def test_a_table_row_with_no_colony_is_still_a_place(tmp_path):
    index = by_name(all_places(build(tmp_path)))
    assert index["hd 9999"][0].source == "inner-sphere"


def test_landmarks_are_places_too(tmp_path):
    index = by_name(all_places(build(tmp_path)))
    assert index["zeta tauri"][0].source == "landmark"


def test_a_polity_is_gathered_from_every_claim_that_names_it(tmp_path):
    index = by_polity(all_places(build(tmp_path)))
    assert {place.source for place in index["zoeific-biopolity"]} == {
        "celestia", "inner-sphere"
    }
    assert {place.source for place in index["metasoft"]} == {"world", "landmark"}


def test_a_place_no_claim_assigns_is_held_by_nobody(tmp_path):
    places = {place.name: place for place in all_places(build(tmp_path))}
    assert places["JD 1"].polities == []


def test_a_polity_that_only_ever_held_is_still_a_holder(tmp_path):
    places = all_places(build(tmp_path))
    assert by_polity(places)["linnent"][0].name == "Twilight"
    assert "linnent" not in by_polity(places, when="now")


def test_holding_now_and_holding_ever_are_both_askable(tmp_path):
    places = all_places(build(tmp_path))
    assert {place.name for place in by_polity(places, when="now")["metasoft"]} == {
        "Niuearth", "Zeta Tauri"
    }
