"""The union of every place file.

The cases here are the four times an analysis was written against one file and
missed the rest. They are not hypothetical: each one shipped.
"""

from __future__ import annotations

import yaml

from oastarmap.fiction.places import all_places, by_article, by_name, by_polity


def write(fiction, name, payload):
    (fiction / name).write_text(yaml.safe_dump(payload), encoding="utf-8")


def build(tmp_path):
    fiction = tmp_path / "fiction"
    fiction.mkdir()
    write(fiction, "worlds.yaml", {"worlds": [
        {"name": "Niuearth", "kind": "planet", "affiliations": ["metasoft"],
         "article": "https://www.orionsarm.com/eg-article/52b993102478a",
         "location": {"oa_star": "JD 836902"}},
        {"name": "Twilight", "kind": "planet", "also": ["Dusk"],
         "article": "https://www.orionsarm.com/eg-article/aaa",
         "location": {"star": "Omicron2 Eridani"},
         "events": [{"year_at": 3000, "kind": "transferred", "polity": "linnent"}]},
    ]})
    write(fiction, "oa_systems.yaml", {"systems": [
        {"star": "JD 98738", "label": "Panthalassa", "affiliation": "zoeific-biopolity",
         "article": "https://www.orionsarm.com/eg-article/bbb"},
    ]})
    write(fiction, "oa_stars.yaml", {"stars": [
        {"name": "JD 98738", "system": "Panthalassa", "distance_ly": 862.51},
    ]})
    write(fiction, "inner_sphere.yaml", {"systems": [
        {"star": "Omicron2 Eridani A", "colony": "Keid", "distance_ly": 16.34},
        {"star": "HD 9999", "colony": "", "distance_ly": 20.0},
    ]})
    write(fiction, "polities.yaml", {"polities": [
        {"id": "metasoft", "name": "Metasoft", "landmarks": ["Zeta Tauri"]},
    ]})
    write(fiction, "colonies.yaml", {"colonies": [
        {"colony": "Keid", "affiliations": ["zoeific-biopolity"]},
    ]})
    return fiction


def test_gathers_every_file(tmp_path):
    sources = {p.source for p in all_places(build(tmp_path))}
    assert sources == {
        "worlds.yaml", "oa_systems.yaml", "oa_stars.yaml",
        "inner_sphere.yaml", "polities.yaml",
    }


def test_finds_a_colony_table_place_that_has_no_article(tmp_path):
    """Keid is a colony row and carries no URL.

    Indexing by article alone reported 176 articles as having no entry here,
    when their places were in this table the whole time. The colony table is the
    largest file and the only one that cannot be matched by URL at all.
    """
    index = by_name(all_places(build(tmp_path)))
    assert [p.source for p in index["keid"]] == ["inner_sphere.yaml"]
    assert not index["keid"][0].article


def test_article_index_covers_only_what_records_a_url(tmp_path):
    places = all_places(build(tmp_path))
    urls = by_article(places)
    assert "https://www.orionsarm.com/eg-article/bbb" in urls
    # And the count is well short of the total, which is the point: a survey
    # that counts articles against this index is measuring coverage of one
    # field, not membership of the map.
    assert len(urls) < len(places)


def test_a_place_answers_to_its_aliases(tmp_path):
    index = by_name(all_places(build(tmp_path)))
    assert index["dusk"][0].name == "Twilight"
    assert index["omicron2 eridani"][0].name == "Twilight"
    assert index["jd 836902"][0].name == "Niuearth"


def test_the_same_place_in_several_files_appears_once_per_file(tmp_path):
    """Panthalassa is an add-on system and an add-on star.

    Both are kept: they are different records saying different things, and
    collapsing them would hide which file a fact came from.
    """
    index = by_name(all_places(build(tmp_path)))
    assert {p.source for p in index["panthalassa"]} == {"oa_systems.yaml", "oa_stars.yaml"}


def test_a_table_row_with_no_colony_is_still_a_place(tmp_path):
    """It names a star the map holds, so it is findable by that."""
    index = by_name(all_places(build(tmp_path)))
    assert index["hd 9999"][0].source == "inner_sphere.yaml"


def test_landmarks_are_places_too(tmp_path):
    index = by_name(all_places(build(tmp_path)))
    assert index["zeta tauri"][0].source == "polities.yaml"


def test_a_polity_is_gathered_from_every_file_that_names_it(tmp_path):
    """Each file says who holds a place in its own way, and none is a superset.

    `worlds.yaml` carries a list, `oa_systems.yaml` a single field, and a colony
    row's holder is in `colonies.yaml` under a name that has to be matched back.
    Answering from any one of them is the mistake this module exists to stop,
    and it was made twice more before this lookup was written: once reading the
    Keter Dominion's reach off `worlds.yaml` while seven of its systems sat in
    the colony table, once calling a polity unplaced that had a system in
    `oa_systems.yaml`.
    """
    index = by_polity(all_places(build(tmp_path)))

    assert {p.source for p in index["zoeific-biopolity"]} == {
        "oa_systems.yaml",   # Panthalassa, by its own `affiliation`
        "inner_sphere.yaml",  # Keid, via colonies.yaml
    }
    assert {p.source for p in index["metasoft"]} == {
        "worlds.yaml",    # Niuearth, by `affiliations`
        "polities.yaml",  # Zeta Tauri, by being listed as its landmark
    }


def test_a_place_no_file_assigns_is_held_by_nobody(tmp_path):
    """The add-on stars record no holder at all, and must not invent one."""
    places = {p.name: p for p in all_places(build(tmp_path)) if p.source == "oa_stars.yaml"}
    assert places["Panthalassa"].polities == []


def test_a_polity_that_only_ever_held_is_still_a_holder(tmp_path):
    """A past holding is a holding: the map draws it whenever the year is set back.

    LinnEnt has no present affiliation anywhere and nine worlds held through
    events. The first version of this lookup counted affiliations alone and
    reported it holding nothing, while the palette check — which does count
    events — was at the same moment refusing to let it share a colour.
    """
    places = all_places(build(tmp_path))
    assert by_polity(places)["linnent"][0].name == "Twilight"
    assert "linnent" not in by_polity(places, when="now")


def test_holding_now_and_holding_ever_are_both_askable(tmp_path):
    places = all_places(build(tmp_path))
    assert {p.name for p in by_polity(places, when="now")["metasoft"]} == {
        "Niuearth", "Zeta Tauri",
    }
