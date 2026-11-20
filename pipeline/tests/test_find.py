"""Cross-graph and catalogue lookup regression tests."""

from __future__ import annotations

import json

import pytest

from oastarmap.fiction.find import find
from oastarmap.fiction.schema import (
    InnerSphereSystem,
    OAStarEntry,
    OASystem,
    Polity,
    World,
    WorldLocation,
)
from oastarmap.fiction.store import OAUPStore


@pytest.fixture
def indexes(tmp_path):
    fiction = tmp_path / "fiction"
    fiction.mkdir()
    data = tmp_path / "data"
    data.mkdir()

    store = OAUPStore.from_models(
        fiction / "oaup/",
        worlds=[
            World(
                name="Niuearth", kind="planet", affiliations=["metasoft"],
                location=WorldLocation(oa_star="JD 836902"),
            ),
            World(
                name="Corona", kind="planet", system="Lucida",
                location=WorldLocation(star="Iota Piscium"),
            ),
        ],
        systems=[
            OASystem(
                star="JD 98738", label="Panthalassa", affiliation="zoeific-biopolity"
            ),
            OASystem(star="JD 836902", label="Niuearth", affiliation="metasoft"),
        ],
        stars=[
            OAStarEntry(
                name="JD 98738", system="Panthalassa", ra_deg=1, dec_deg=2,
                distance_ly=862.51,
            ),
            OAStarEntry(
                name="JD 836902", system="Niuearth", ra_deg=1, dec_deg=2,
                distance_ly=786.9,
            ),
        ],
        inner_systems=[InnerSphereSystem(colony="Ridgwell", star="HD 1")],
        polities=[Polity(
            id="metasoft", name="Metasoft", color="#112233", landmarks=["Zeta Tauri"]
        )],
    )
    store.save()
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
    fiction, data = indexes
    hits = find("Panthalassa", fiction, data)
    assert [hit.source for hit in hits] == ["celestia"]


def test_finds_a_landmark_under_the_name_the_catalogue_uses(indexes):
    fiction, data = indexes
    hits = find("Tianguan", fiction, data)
    sources = {hit.source for hit in hits}
    assert "landmark binding" in sources
    assert "stars catalogue" in sources
    binding = next(hit for hit in hits if hit.source == "landmark binding")
    assert binding.name == "Zeta Tauri"
    assert "metasoft" in binding.detail


def test_finds_the_same_place_in_world_and_import_claims(indexes):
    fiction, data = indexes
    hits = find("Niuearth", fiction, data)
    assert {hit.source for hit in hits} == {"world", "celestia"}


def test_matches_are_case_insensitive_and_partial(indexes):
    fiction, data = indexes
    assert find("panthal", fiction, data)
    assert find("NIUEARTH", fiction, data)


def test_searches_the_inner_sphere_table_too(indexes):
    fiction, data = indexes
    hits = find("Ridgwell", fiction, data)
    assert [hit.source for hit in hits] == ["inner-sphere"]


def test_a_genuine_absence_still_reports_nothing(indexes):
    fiction, data = indexes
    assert find("Nowhere At All", fiction, data) == []
