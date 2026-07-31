"""Tests for the HII region dataset.

The load-bearing check is :meth:`TestDistanceMethod.test_stellar_distance_wins`.
Russeil publishes two distances per complex and the kinematic one is catastrophic
for exactly the regions this map cares most about — nearby, high-latitude ones.
S27 is the zeta Ophiuchi region, a couple of hundred parsecs away; its kinematic
distance is 21.6 kpc. Preferring the wrong column would fling it past the far side
of the galaxy while every other region still looked fine.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from oastarmap.build.hii import DISTANCE_METHODS, METHOD_INDEX, build_hii
from oastarmap.fetch.hii import (
    RUSSEIL_2003_COMPLEXES,
    RUSSEIL_2003_MEMBERS,
    SHARPLESS_1959,
)
from oastarmap.transform.frame import MAX_PLAUSIBLE_DISTANCE_PC

SOURCES = (SHARPLESS_1959, RUSSEIL_2003_MEMBERS, RUSSEIL_2003_COMPLEXES)


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    if not all(source.path.exists() for source in SOURCES):
        pytest.skip("HII catalogs not fetched: run `oastarmap fetch`")

    out = tmp_path_factory.mktemp("hii")
    manifest = build_hii(out_dir=out)

    geometry = np.fromfile(out / "hii.bin", dtype="<f4").reshape(-1, 7)
    meta = np.fromfile(out / "hii.meta.bin", dtype="<i4").reshape(-1, 2)
    names = json.loads((out / "hii.names.json").read_text(encoding="utf-8"))

    return {
        "dir": out,
        "manifest": manifest,
        "xyz": geometry[:, :3],
        "radius": geometry[:, 3],
        "distance": geometry[:, 4],
        "distance_lo": geometry[:, 5],
        "distance_hi": geometry[:, 6],
        "method": meta[:, 0],
        "number": meta[:, 1],
        "names": names,
    }


def _find(built, name: str) -> int:
    for i, entry in enumerate(built["names"]):
        if entry["name"] == name:
            return i
    raise AssertionError(f"HII region not found: {name}")


class TestDistanceMethod:
    def test_stellar_distance_wins(self, built):
        """S27 is ~200 pc away. Its kinematic distance says 21.6 kpc."""
        i = _find(built, "S27")
        assert built["method"][i] == METHOD_INDEX["stellar"]
        assert 100 < built["distance"][i] < 600, (
            f"S27 placed at {built['distance'][i]:.0f} pc. The zeta Ophiuchi region "
            f"is a few hundred parsecs away; a kiloparsec-scale value means the "
            f"kinematic distance was used in preference to the stellar one."
        )

    def test_every_method_index_is_known(self, built):
        assert set(np.unique(built["method"])).issubset(range(len(DISTANCE_METHODS)))

    def test_both_methods_are_represented(self, built):
        """If one vanished, the preference logic has collapsed to a constant."""
        methods = built["manifest"]["stats"]["methods"]
        assert methods["stellar"] > 0
        assert methods["kinematic"] > 0

    def test_stellar_is_preferred_wherever_available(self, built):
        """No region may carry a kinematic distance when a stellar one exists.

        Recomputed from the raw complex table rather than trusting the build, so
        the test would survive a rewrite of the selection code.
        """
        from oastarmap.build.hii import read_complexes, read_membership

        complexes = read_complexes(RUSSEIL_2003_COMPLEXES.path)
        membership = read_membership(RUSSEIL_2003_MEMBERS.path)

        for i, entry in enumerate(built["names"]):
            if built["method"][i] != METHOD_INDEX["kinematic"]:
                continue
            key = membership[int(built["number"][i])]
            assert complexes[key].method == "kinematic", (
                f"{entry['name']} was placed kinematically although its complex "
                f"has a stellar distance."
            )


class TestGeometry:
    def test_radius_matches_angular_size_at_distance(self, built):
        for entry, radius, distance in zip(
            built["names"], built["radius"], built["distance"], strict=True
        ):
            half_angle = (float(entry["diameter_arcmin"]) / 2.0) * (math.pi / 180.0 / 60.0)
            expected = distance * math.tan(half_angle)
            assert radius == pytest.approx(expected, rel=1e-4)

    def test_position_is_consistent_with_distance(self, built):
        """|xyz| must equal the adopted distance: the frame conversion preserves it."""
        norms = np.linalg.norm(built["xyz"], axis=1)
        assert np.allclose(norms, built["distance"], rtol=1e-4)

    def test_s27_lies_toward_the_galactic_centre_and_north(self, built):
        """Sharpless puts S27 at l=6.3, b=+23.6 — coreward and well above the plane."""
        i = _find(built, "S27")
        x, y, z = built["xyz"][i]
        assert x > 0 and z > 0
        assert x > abs(y), "l=6.3 deg is almost straight toward the centre"

    def test_no_implausible_distances(self, built):
        assert built["distance"].max() <= MAX_PLAUSIBLE_DISTANCE_PC
        assert built["distance"].min() > 0

    def test_uncertainty_band_brackets_the_distance(self, built):
        assert np.all(built["distance_lo"] <= built["distance"] + 1e-3)
        assert np.all(built["distance_hi"] >= built["distance"] - 1e-3)
        assert np.all(built["distance_lo"] >= 0)

    def test_radii_are_physical(self, built):
        """Nothing should be a point, and nothing should span a kiloparsec."""
        assert built["radius"].min() > 0
        assert built["radius"].max() < 1000


class TestDesignations:
    def test_names_are_unique(self, built):
        names = [entry["name"] for entry in built["names"]]
        assert len(names) == len(set(names))

    def test_name_matches_sharpless_number(self, built):
        for entry, number in zip(built["names"], built["number"], strict=True):
            assert entry["name"] == f"S{number}"

    def test_modern_alias_form_is_offered(self, built):
        """Papers and SIMBAD write "Sh2-27", not "S27"; both must resolve."""
        i = _find(built, "S27")
        assert "Sh2-27" in built["names"][i]["aliases"].split(",")

    def test_expected_landmarks_are_present(self, built):
        """The Orion's Arm landmarks this catalog was added to bind."""
        for name in ("S27", "S31", "S67", "S119", "S126", "S155", "S171", "S202", "S232"):
            _find(built, name)


class TestBuild:
    def test_rebuild_is_byte_identical(self, built, tmp_path):
        again = build_hii(out_dir=tmp_path)
        assert again["count"] == built["manifest"]["count"]
        for key, entry in built["manifest"]["files"].items():
            first = (built["dir"] / entry["file"]).read_bytes()
            second = (tmp_path / again["files"][key]["file"]).read_bytes()
            assert first == second, f"{key} differs between builds"

    def test_frame_is_declared_heliocentric_parsecs(self, built):
        frame = built["manifest"]["frame"]
        assert frame["name"] == "galactic-cartesian-heliocentric"
        assert frame["unit"] == "pc"
        assert frame["origin"] == "Sol"

    def test_exclusions_are_accounted_for(self, built):
        stats = built["manifest"]["stats"]
        assert stats["accepted"] + sum(stats["excluded"].values()) == stats["total_rows"]

    def test_most_of_the_catalog_is_placeable(self, built):
        """A large drop in yield means the Russeil join has broken."""
        stats = built["manifest"]["stats"]
        assert stats["accepted"] > 200, (
            f"only {stats['accepted']} of {stats['total_rows']} Sharpless regions "
            f"were placed; the join against Russeil's complexes has regressed."
        )
