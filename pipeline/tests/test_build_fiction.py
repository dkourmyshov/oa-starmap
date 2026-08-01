"""Tests for the fictional layer and the Terragen frontier flag.

The flag exists because some Orion's Arm landmarks sit far outside any polity's
plausible volume — Berkeley 42 at ~22,000 ly, Collinder 97 at ~17,000 ly. The
source map places those in a polity's *direction*, not inside it. So the load
bearing behaviour is :meth:`TestFrontier.test_flagged_landmarks_get_no_polity_colour`:
the binding survives, but the renderer must not paint it, because the colour would
assert a territorial claim the setting never makes.
"""

from __future__ import annotations

import json
import math
import shutil

import astropy.units as u
import numpy as np
import pytest

from oastarmap.build.fiction import (
    FRONTIER_PC,
    TERRAGEN_FRONTIER_LY,
    _placement_outliers,
    build_fiction,
)
from oastarmap.fiction.resolve import Binding
from oastarmap.paths import DATA_OUT_DIR
from oastarmap.transform.frame import PC_TO_LY

# What build_fiction needs to already exist in its output directory.
INPUTS = (
    "clusters.names.json",
    "clusters.bin",
    "stars.names.json",
    "stars.bin",
    "hii.names.json",
    "hii.bin",
)


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    if not all((DATA_OUT_DIR / name).exists() for name in INPUTS):
        pytest.skip("Real catalogs not built: run `oastarmap build`")

    out = tmp_path_factory.mktemp("fiction")
    for name in INPUTS:
        shutil.copy(DATA_OUT_DIR / name, out / name)

    manifest = build_fiction(out_dir=out)
    payload = json.loads((out / "fiction.json").read_text(encoding="utf-8"))

    return {
        "dir": out,
        "manifest": manifest,
        "bindings": payload["bindings"],
        "polities": payload["polities"],
        "cluster_polity": np.fromfile(out / "fiction.clusterpolity.bin", dtype=np.uint8),
        "hii_polity": np.fromfile(out / "fiction.hiipolity.bin", dtype=np.uint8),
    }


class TestUnitConstant:
    def test_pc_to_ly_matches_astropy(self):
        """The literal the renderer asserts against must be the real conversion."""
        assert pytest.approx((1 * u.pc).to_value(u.lyr), rel=1e-9) == PC_TO_LY

    def test_frontier_conversion_is_consistent(self):
        assert pytest.approx(TERRAGEN_FRONTIER_LY / PC_TO_LY) == FRONTIER_PC
        assert pytest.approx(2146.2, abs=0.5) == FRONTIER_PC


class TestFrontier:
    def test_flag_agrees_with_the_recorded_distance(self, built):
        for binding in built["bindings"]:
            if binding["distance_pc"] is None:
                assert not binding["beyond_frontier"]
                continue
            assert binding["beyond_frontier"] == (binding["distance_pc"] > FRONTIER_PC)

    def test_flagged_landmarks_get_no_polity_colour(self, built):
        """A flagged binding must leave its object unassigned in the colour array."""
        arrays = {"cluster": built["cluster_polity"], "hii": built["hii_polity"]}
        for binding in built["bindings"]:
            if not binding["beyond_frontier"]:
                continue
            array = arrays.get(binding["kind"])
            if array is None:
                continue
            assert array[binding["index"]] == 0, (
                f"{binding['landmark']} is past the frontier but was still assigned "
                f"polity index {array[binding['index']]}"
            )

    def test_flagged_landmarks_stay_bound(self, built):
        """Flagging must not silently drop the association."""
        for binding in built["bindings"]:
            if binding["beyond_frontier"]:
                assert binding["resolved"]
                assert binding["polities"]

    def test_nearby_landmarks_are_still_coloured(self, built):
        """Otherwise the flag would be indistinguishable from a broken build."""
        coloured = sum(1 for value in built["cluster_polity"] if value != 0)
        assert coloured > 50

    def test_known_outliers_are_caught(self, built):
        flagged = {item["landmark"] for item in built["manifest"]["frontier"]["flagged"]}
        assert {"Berkeley 42", "Collinder 97"} <= flagged

    def test_flagged_list_is_ordered_by_distance(self, built):
        distances = [item["distance_ly"] for item in built["manifest"]["frontier"]["flagged"]]
        assert distances == sorted(distances, reverse=True)

    def test_every_flagged_entry_is_actually_beyond(self, built):
        for item in built["manifest"]["frontier"]["flagged"]:
            assert item["distance_ly"] > TERRAGEN_FRONTIER_LY

    def test_per_polity_counts_add_up(self, built):
        for polity in built["polities"]:
            expected = sum(
                1
                for b in built["bindings"]
                if b["resolved"] and polity["id"] in b["polities"] and b["beyond_frontier"]
            )
            assert polity["beyond_frontier_count"] == expected
            assert polity["beyond_frontier_count"] <= polity["resolved_count"]


def _spherical(lon_deg: float, lat_deg: float, distance_pc: float) -> list[float]:
    lon, lat = math.radians(lon_deg), math.radians(lat_deg)
    return [
        distance_pc * math.cos(lat) * math.cos(lon),
        distance_pc * math.cos(lat) * math.sin(lon),
        distance_pc * math.sin(lat),
    ]


def _outliers(
    points: list[tuple[str, list[float]]],
    polity: str = "p",
    confirmed: set[str] | None = None,
) -> list[str]:
    """Run the check over a synthetic polity and return the landmark names it flags."""
    bindings = [
        Binding(landmark=name, polities=[polity], kind="cluster", index=i)
        for i, (name, _) in enumerate(points)
    ]
    positions = {"cluster": np.array([xyz for _, xyz in points], dtype=np.float32)}
    return [item["landmark"] for item in _placement_outliers(bindings, positions, confirmed)]


# A plausible polity: a loose group off toward l ~ 230, like the Sophic League.
GROUP = [
    ("a", _spherical(225, 2, 480)),
    ("b", _spherical(231, -6, 700)),
    ("c", _spherical(240, 4, 350)),
    ("d", _spherical(220, -3, 900)),
    ("e", _spherical(246, 8, 520)),
]


class TestPlacementOutliers:
    """The check that would have caught "Eagle Nebula" standing in for "Seagull"."""

    def test_catches_an_object_on_the_far_side_of_the_sky(self):
        """NGC 6611 sits at l=17, against a group spanning l=220 to l=246."""
        points = [*GROUP, ("wrong-name", _spherical(17, 1, 1700))]
        assert _outliers(points) == ["wrong-name"]

    def test_a_coherent_group_flags_nothing(self):
        assert _outliers(GROUP) == []

    def test_distance_alone_is_not_enough(self):
        """Remote but in the right direction is a holding, not a typo."""
        points = [*GROUP, ("far-but-aligned", _spherical(232, 0, 6000))]
        assert _outliers(points) == []

    def test_direction_alone_is_not_enough(self):
        """A nearby object subtends a wide angle without being anywhere odd.

        This is the S27 case: 200 pc away, 126 degrees off the Solar Dominion's
        mean direction, and entirely unremarkable.
        """
        spread_out = [
            ("a", _spherical(30, 10, 2400)),
            ("b", _spherical(80, -5, 1800)),
            ("c", _spherical(300, 3, 2100)),
            ("d", _spherical(340, -8, 1500)),
            ("e", _spherical(200, 6, 2000)),
        ]
        points = [*spread_out, ("nearby", _spherical(6, 24, 200))]
        flagged = _outliers(points)
        assert "nearby" not in flagged

    def test_the_author_can_settle_it_permanently(self):
        """Confirmed fiction overrules the check; that is the whole hierarchy."""
        points = [*GROUP, ("really-is-out-there", _spherical(17, 1, 1700))]
        assert _outliers(points) == ["really-is-out-there"]
        assert _outliers(points, confirmed={"really-is-out-there"}) == []

    def test_confirming_one_does_not_shield_another(self):
        points = [
            *GROUP,
            ("confirmed-one", _spherical(17, 1, 1700)),
            ("other-one", _spherical(20, -2, 1900)),
        ]
        assert _outliers(points, confirmed={"confirmed-one"}) == ["other-one"]

    def test_too_few_landmarks_to_judge(self):
        """Three points have no meaningful centre; refuse rather than guess."""
        points = [
            ("a", _spherical(225, 2, 480)),
            ("b", _spherical(231, -6, 700)),
            ("c", _spherical(17, 1, 1700)),
        ]
        assert _outliers(points) == []

    def test_reports_both_measures(self):
        points = [*GROUP, ("wrong-name", _spherical(17, 1, 1700))]
        bindings = [
            Binding(landmark=name, polities=["p"], kind="cluster", index=i)
            for i, (name, _) in enumerate(points)
        ]
        positions = {"cluster": np.array([xyz for _, xyz in points], dtype=np.float32)}
        found = _placement_outliers(bindings, positions)
        assert found[0]["degrees_from_polity_mean"] > 90
        assert found[0]["spread_ratio"] > 3


class TestSeagullCorrection:
    """Regression: "Eagle Nebula" bound NGC 6611, 200 degrees from the Sophic group."""

    def test_the_real_data_has_no_placement_outliers(self, built):
        found = built["manifest"]["placement_outliers"]["found"]
        assert found == [], f"unexpected placement outliers: {found}"

    def test_seagull_binds_to_the_sharpless_region(self, built):
        binding = next(b for b in built["bindings"] if b["landmark"] == "Seagull Nebula")
        assert binding["matched_name"] == "S296"
        assert "sophic-league" in binding["polities"]

    def test_no_landmark_still_points_at_ngc_6611(self, built):
        assert all(b["matched_name"] != "NGC_6611" for b in built["bindings"])


class TestBindings:
    def test_resolved_bindings_report_what_they_hit(self, built):
        """Berkeley 42 resolving to NGC 6749 is correct but not self-evident."""
        for binding in built["bindings"]:
            if binding["resolved"]:
                assert binding["matched_name"], binding["landmark"]

    def test_berkeley_42_resolves_to_its_ngc_designation(self, built):
        binding = next(b for b in built["bindings"] if b["landmark"] == "Berkeley 42")
        assert binding["matched_name"] == "NGC_6749"

    def test_unresolved_bindings_carry_no_distance(self, built):
        for binding in built["bindings"]:
            if not binding["resolved"]:
                assert binding["distance_pc"] is None

    def test_rebuild_is_byte_identical(self, built, tmp_path):
        for name in INPUTS:
            shutil.copy(DATA_OUT_DIR / name, tmp_path / name)
        again = build_fiction(out_dir=tmp_path)
        for key, entry in built["manifest"]["files"].items():
            first = (built["dir"] / entry["file"]).read_bytes()
            second = (tmp_path / again["files"][key]["file"]).read_bytes()
            assert first == second, f"{key} differs between builds"
