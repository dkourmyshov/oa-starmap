"""The union of every place file.

The cases here are the four times an analysis was written against one file and
missed the rest. They are not hypothetical: each one shipped.
"""

from __future__ import annotations

import yaml

from oastarmap.fiction.places import all_places, by_article, by_name


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
         "location": {"star": "Omicron2 Eridani"}},
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
