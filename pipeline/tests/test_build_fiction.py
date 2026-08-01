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
import shutil

import astropy.units as u
import numpy as np
import pytest

from oastarmap.build.fiction import FRONTIER_PC, TERRAGEN_FRONTIER_LY, build_fiction
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
