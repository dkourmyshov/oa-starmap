"""The cross-index lookup.

Each case here is a search that once returned nothing and should not have. They
are regression tests for a habit rather than for a bug: the places live in five
files plus a catalogue, and reaching for the largest one is the easy mistake.
"""

from __future__ import annotations

import json

import pytest
import yaml

from oastarmap.fiction.find import find


@pytest.fixture
def indexes(tmp_path):
    """A miniature of the real layout: one place in each index that holds one."""
    fiction = tmp_path / "fiction"
    fiction.mkdir()
    data = tmp_path / "data"
    data.mkdir()

    (fiction / "worlds.yaml").write_text(yaml.safe_dump({
        "worlds": [
            {"name": "Niuearth", "kind": "planet", "affiliations": ["metasoft"],
             "location": {"oa_star": "JD 836902"}},
            {"name": "Corona", "kind": "planet", "system": "Lucida",
             "location": {"star": "Iota Piscium"}},
        ]
    }), encoding="utf-8")
    (fiction / "oa_systems.yaml").write_text(yaml.safe_dump({
        "systems": [
            {"star": "JD 98738", "label": "Panthalassa", "affiliation": "zoeific-biopolity"},
            {"star": "JD 836902", "label": "Niuearth", "affiliation": "metasoft"},
        ]
    }), encoding="utf-8")
    (fiction / "oa_stars.yaml").write_text(yaml.safe_dump({
        "stars": [
            {"name": "JD 98738", "system": "Panthalassa", "distance_ly": 862.51},
            {"name": "JD 836902", "system": "Niuearth", "distance_ly": 786.9},
        ]
    }), encoding="utf-8")
    (fiction / "inner_sphere.yaml").write_text(yaml.safe_dump({
        "systems": [{"colony": "Ridgwell", "star": "HD 1"}]
    }), encoding="utf-8")
    (fiction / "polities.yaml").write_text(yaml.safe_dump({
        "polities": [{"id": "metasoft", "name": "Metasoft", "landmarks": ["Zeta Tauri"]}]
    }), encoding="utf-8")
    (data / "fiction.json").write_text(json.dumps({
        "bindings": [
            {"landmark": "Zeta Tauri", "matched_name": "Tianguan", "kind": "star",
             "polities": ["metasoft"], "index": 26572},
        ]
    }), encoding="utf-8")
    (data / "stars.names.json").write_text(json.dumps({
        "26572": {"bayer": "Zet", "bf": "123Zet Tau", "proper": "Tianguan"},
    }), encoding="utf-8")
    return fiction, data


def test_finds_a_place_that_lives_only_in_the_add_on(indexes):
    """Panthalassa is an add-on system and is in no other file.

    Reported absent once, on the strength of a search that read worlds.yaml.
    """
    fiction, data = indexes
    hits = find("Panthalassa", fiction, data)
    assert {hit.source for hit in hits} == {"oa_systems.yaml", "oa_stars.yaml"}


def test_finds_a_landmark_under_the_name_the_catalogue_uses(indexes):
    """Tianguan is Zeta Tauri: authored under one name, matched under another.

    Grepping fiction/ for "Tianguan" finds nothing, because the name it is
    authored under is the other one.
    """
    fiction, data = indexes
    hits = find("Tianguan", fiction, data)
    sources = {hit.source for hit in hits}
    assert "landmark binding" in sources
    assert "stars catalogue" in sources
    binding = next(hit for hit in hits if hit.source == "landmark binding")
    assert binding.name == "Zeta Tauri"
    assert "metasoft" in binding.detail


def test_finds_the_same_place_in_every_index_that_holds_it(indexes):
    """Niuearth is in three, which is how the duplicate was found in the first place."""
    fiction, data = indexes
    hits = find("Niuearth", fiction, data)
    assert {hit.source for hit in hits} == {"worlds.yaml", "oa_systems.yaml", "oa_stars.yaml"}


def test_matches_are_case_insensitive_and_partial(indexes):
    """The spelling is the thing you do not know when you are looking."""
    fiction, data = indexes
    assert find("panthal", fiction, data)
    assert find("NIUEARTH", fiction, data)


def test_searches_the_inner_sphere_table_too(indexes):
    """Ridgwell is there and nowhere else; Lin-Darwon is placed relative to it."""
    fiction, data = indexes
    hits = find("Ridgwell", fiction, data)
    assert [hit.source for hit in hits] == ["inner_sphere.yaml"]


def test_a_genuine_absence_still_reports_nothing(indexes):
    fiction, data = indexes
    assert find("Nowhere At All", fiction, data) == []
