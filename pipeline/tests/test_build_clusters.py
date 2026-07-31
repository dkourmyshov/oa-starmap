"""Tests for the open cluster dataset.

The load-bearing check is :meth:`TestPositions.test_galactocentric_columns_were_not_used`.
Hunt & Reffert ship X/Y/Z columns that look heliocentric but are not — the Sun sits
at X ~ -8200 pc in them. Using them directly would place every cluster thousands of
parsecs from where it belongs, in a way that still looks superficially plausible.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from oastarmap.build.clusters import TYPE_INDEX, build_clusters
from oastarmap.fetch.clusters import HUNT_REFFERT_2023

PC_TO_LY = 3.261563777


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    if not HUNT_REFFERT_2023.path.exists():
        pytest.skip("Cluster catalog not fetched: run `oastarmap fetch`")

    out = tmp_path_factory.mktemp("clusters")
    manifest = build_clusters(out_dir=out)

    geometry = np.fromfile(out / "clusters.bin", dtype="<f4").reshape(-1, 8)
    meta = np.fromfile(out / "clusters.meta.bin", dtype="<i4").reshape(-1, 2)
    names = json.loads((out / "clusters.names.json").read_text(encoding="utf-8"))

    return {
        "dir": out,
        "manifest": manifest,
        "xyz": geometry[:, :3],
        "radius_total": geometry[:, 3],
        "radius_core": geometry[:, 4],
        "distance": geometry[:, 5],
        "distance_lo": geometry[:, 6],
        "distance_hi": geometry[:, 7],
        "meta": meta,
        "names": names,
    }


def _find(built, name: str) -> int:
    """Locate a cluster, preferring an exact primary-name match.

    Aliases are checked only as a fallback: several unrelated clusters list the
    same historical designation among their aliases (CWNU_1242 claims "Melotte_25"
    alongside the real Hyades), so an alias-first search finds the wrong object.
    """
    for i, entry in enumerate(built["names"]):
        if entry["name"] == name:
            return i
    for i, entry in enumerate(built["names"]):
        if name in str(entry.get("aliases", "")).split(","):
            return i
    raise AssertionError(f"cluster not found: {name}")


class TestPositions:
    @pytest.mark.parametrize(
        ("name", "min_pc", "max_pc"),
        [
            ("Melotte_22", 120, 150),  # Pleiades
            ("Melotte_25", 40, 55),  # Hyades
            ("NGC_2632", 170, 200),  # Praesepe / Beehive
            ("NGC_869", 2000, 2600),  # h Persei, the far half of the Double Cluster
        ],
    )
    def test_known_clusters_at_published_distances(self, built, name, min_pc, max_pc):
        i = _find(built, name)
        d = float(built["distance"][i])
        assert min_pc <= d <= max_pc, f"{name} at {d:.0f} pc"

    def test_position_magnitude_matches_distance(self, built):
        """|xyz| must equal the stored distance — the basic consistency check."""
        radial = np.linalg.norm(built["xyz"], axis=1)
        np.testing.assert_allclose(radial, built["distance"], rtol=1e-3)

    def test_galactocentric_columns_were_not_used(self, built):
        """No cluster may sit ~8 kpc off purely because the Sun's offset leaked in.

        If the catalog's own X/Y/Z had been copied, nearby clusters like the
        Hyades (47 pc) would land about 8200 pc away along -x.
        """
        i = _find(built, "Melotte_25")  # Hyades
        assert float(built["distance"][i]) < 100
        assert abs(float(built["xyz"][i][0])) < 100

    def test_pleiades_direction(self, built):
        """Published galactic coordinates: l = 166.6, b = -23.5."""
        i = _find(built, "Melotte_22")
        x, y, z = (float(v) for v in built["xyz"][i])
        r = float(built["distance"][i])
        lon = np.degrees(np.arctan2(y, x)) % 360.0
        lat = np.degrees(np.arcsin(z / r))
        assert lon == pytest.approx(166.6, abs=1.0)
        assert lat == pytest.approx(-23.5, abs=1.0)


class TestExtent:
    def test_every_cluster_has_a_positive_radius(self, built):
        """These are volumetric objects; a zero-radius cluster is a point, not a cluster."""
        assert np.all(built["radius_total"] > 0)

    def test_radii_are_physically_plausible(self, built):
        """Open clusters run from under a parsec to a few tens across.

        The upper bound is generous because sparse nearby moving groups are
        genuinely extended, and tidal tails are included in rtot.
        """
        assert np.median(built["radius_total"]) < 50
        assert np.percentile(built["radius_total"], 99) < 400
        assert built["radius_total"].max() < 1500

    def test_core_radius_does_not_exceed_total(self, built):
        assert np.all(built["radius_core"] <= built["radius_total"] * 1.001)


class TestUncertainty:
    def test_distance_band_brackets_the_estimate(self, built):
        lo, d, hi = built["distance_lo"], built["distance"], built["distance_hi"]
        assert np.all(lo <= d * 1.001)
        assert np.all(hi >= d * 0.999)

    def test_far_clusters_have_wider_bands(self, built):
        """Honest uncertainty must grow with distance, not stay flat."""
        d = built["distance"]
        frac = (built["distance_hi"] - built["distance_lo"]) / np.maximum(d, 1e-6)
        near = frac[d < 500]
        far = frac[d > 3000]
        assert len(near) > 50 and len(far) > 50
        assert np.median(far) > np.median(near)


class TestCoverage:
    def test_reaches_well_past_the_maps_region_of_interest(self, built):
        """7000 ly is ~2.1 kpc; clusters must populate that range and beyond."""
        d = built["distance"]
        assert np.sum(d > 2100) > 500
        assert d.max() > 5000

    def test_all_types_present(self, built):
        types = built["meta"][:, 0]
        assert np.sum(types == TYPE_INDEX["o"]) > 1000
        assert np.sum(types == TYPE_INDEX["m"]) > 100
        assert np.sum(types == TYPE_INDEX["g"]) > 10

    def test_no_type_falls_through_to_unknown(self, built):
        """Every code in the catalog must be handled explicitly.

        'g' was originally missing, which silently binned every globular as
        unknown — the sort of gap that shows up as a rendering oddity, not an error.
        """
        types = built["meta"][:, 0]
        assert np.sum(types == TYPE_INDEX["?"]) == 0

    def test_quality_bound_removes_only_a_negligible_population(self, built):
        excluded = built["manifest"]["stats"]["excluded"].get("implausible_distance", 0)
        assert excluded < 100, f"{excluded} clusters rejected as implausible — too many"

    def test_no_moving_group_survives_at_extragalactic_distance(self, built):
        """A moving group at 100 kpc is a parallax artefact, not an object."""
        moving = built["distance"][built["meta"][:, 0] == TYPE_INDEX["m"]]
        assert moving.max() < 30000


class TestDeterminism:
    def test_rebuild_is_byte_identical(self, built, tmp_path):
        build_clusters(out_dir=tmp_path)
        for name in ("clusters.bin", "clusters.meta.bin", "clusters.names.json"):
            assert (tmp_path / name).read_bytes() == (built["dir"] / name).read_bytes(), name
