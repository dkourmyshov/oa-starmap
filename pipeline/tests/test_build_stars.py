"""Tests for the built star dataset.

The most important test here is :class:`TestNoSphericalEdge`. The whole selection
design exists to avoid rendering a ball of stars with a machined surface, and that
property is easy to break silently by adding a distance filter "just for
performance". These tests make the requirement checkable rather than a matter of
opinion.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from oastarmap.build.stars import MAX_PLAUSIBLE_DISTANCE_PC, build_stars
from oastarmap.build.writer import CI_UNKNOWN
from oastarmap.fetch.hyg import HYGLIKE

PC_TO_LY = 3.261563777


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    """Build the dataset once into a temp dir and load it back."""
    if not HYGLIKE.path.exists():
        pytest.skip(f"Source catalog not fetched: run `oastarmap fetch` ({HYGLIKE.filename})")

    out = tmp_path_factory.mktemp("data")
    manifest = build_stars(out_dir=out)

    positions = np.fromfile(out / "stars.bin", dtype="<f4").reshape(-1, 5)
    ids = np.fromfile(out / "stars.ids.bin", dtype="<i4").reshape(-1, 2)
    classes = np.fromfile(out / "stars.class.bin", dtype="<u1")
    names = json.loads((out / "stars.names.json").read_text(encoding="utf-8"))

    return {
        "dir": out,
        "manifest": manifest,
        "xyz": positions[:, :3],
        "absmag": positions[:, 3],
        "ci": positions[:, 4],
        "ids": ids,
        "classes": classes,
        "names": names,
        "distance": np.linalg.norm(positions[:, :3], axis=1),
    }


def _index_of_proper(built, proper: str) -> int:
    for idx, entry in built["names"].items():
        if entry.get("proper") == proper:
            return int(idx)
    raise AssertionError(f"star not found in dataset: {proper}")


class TestNoSphericalEdge:
    """The dataset must not terminate at any radius."""

    def test_stars_exist_far_beyond_any_plausible_cutoff(self, built):
        """Specifically past 1 kpc, the boundary an earlier design would have used."""
        d = built["distance"]
        assert np.sum(d > 500) > 1000
        assert np.sum(d > 1000) > 500
        assert np.sum(d > 2000) > 100

    def test_no_shell_wall(self, built):
        """No radius where a populated shell is followed by an empty one.

        A distance cutoff at D produces exactly that signature: many stars just
        inside D, none just outside.
        """
        d = built["distance"]
        d = d[np.isfinite(d) & (d > 0)]
        edges = np.logspace(0, np.log10(5000), 40)
        counts, _ = np.histogram(d, bins=edges)

        for i in range(len(counts) - 1):
            if counts[i] >= 50:
                assert counts[i + 1] > 0, (
                    f"population wall: {counts[i]} stars in "
                    f"{edges[i]:.0f}-{edges[i + 1]:.0f} pc, none beyond"
                )

    def test_falloff_is_gradual_not_cliff_like(self, built):
        """Beyond the peak, no single shell may lose more than 90% of the previous."""
        d = built["distance"]
        d = d[np.isfinite(d) & (d > 0)]
        edges = np.logspace(np.log10(50), np.log10(3000), 25)
        counts, _ = np.histogram(d, bins=edges)

        peak = int(np.argmax(counts))
        for i in range(peak, len(counts) - 1):
            if counts[i] >= 100:
                ratio = counts[i + 1] / counts[i]
                assert ratio > 0.1, (
                    f"cliff at {edges[i + 1]:.0f} pc: {counts[i]} -> {counts[i + 1]} ({ratio:.1%})"
                )

    def test_distant_stars_are_the_luminous_ones(self, built):
        """The signature of luminosity-limited selection.

        Under a distance cut, the far sample would have the same luminosity mix as
        the near one. Under a magnitude limit, only intrinsically bright stars
        survive to large distance — which is *why* the falloff is smooth.
        """
        d, absmag = built["distance"], built["absmag"]
        near = absmag[(d > 0) & (d < 100)]
        far = absmag[d > 1000]

        assert len(near) > 1000 and len(far) > 100
        # Smaller absolute magnitude means intrinsically brighter.
        assert np.median(far) < np.median(near) - 3.0


class TestNamedStars:
    """Anciently-named stars must survive to any distance — the user's requirement."""

    @pytest.mark.parametrize(
        ("proper", "min_pc", "max_pc"),
        [
            ("Wezen", 400, 600),
            ("Deneb", 400, 1000),
            ("Rigel", 200, 400),
            ("Vega", 7, 9),
            ("Betelgeuse", 100, 300),
            ("Polaris", 100, 200),
            ("Antares", 100, 250),
        ],
    )
    def test_present_at_plausible_distance(self, built, proper, min_pc, max_pc):
        idx = _index_of_proper(built, proper)
        dist = float(built["distance"][idx])
        assert min_pc <= dist <= max_pc, f"{proper} at {dist:.0f} pc"

    def test_wezen_is_far_and_bright(self, built):
        """Wezen is the case that motivated the design: distant yet naked-eye."""
        idx = _index_of_proper(built, "Wezen")
        assert built["distance"][idx] > 400
        assert built["absmag"][idx] < -6.0

    def test_sol_is_exactly_at_the_origin(self, built):
        idx = _index_of_proper(built, "Sol")
        np.testing.assert_array_equal(built["xyz"][idx], np.zeros(3, dtype=np.float32))


class TestPositions:
    """Spot-checks against independently published galactic coordinates."""

    @pytest.mark.parametrize(
        ("proper", "exp_l", "exp_b"),
        [
            ("Vega", 67.45, 19.24),
            ("Deneb", 84.28, 2.00),
            ("Rigel", 209.24, -25.25),
            ("Wezen", 238.42, -8.27),
        ],
    )
    def test_direction_matches_published_galactic_coordinates(self, built, proper, exp_l, exp_b):
        idx = _index_of_proper(built, proper)
        x, y, z = (float(v) for v in built["xyz"][idx])
        r = float(built["distance"][idx])

        lon = np.degrees(np.arctan2(y, x)) % 360.0
        lat = np.degrees(np.arcsin(z / r))

        assert lon == pytest.approx(exp_l, abs=0.1), f"{proper} longitude"
        assert lat == pytest.approx(exp_b, abs=0.1), f"{proper} latitude"

    def test_hyg_equatorial_xyz_was_not_used_directly(self, built):
        """Guard against the trap of copying HYG's own x/y/z columns.

        Those are equatorial. If they had been used, Vega — which sits at galactic
        latitude +19 degrees — would land at a wildly different direction.
        """
        idx = _index_of_proper(built, "Vega")
        z = float(built["xyz"][idx][2])
        r = float(built["distance"][idx])
        lat = np.degrees(np.arcsin(z / r))
        assert lat == pytest.approx(19.24, abs=0.5)


class TestDataIntegrity:
    def test_all_arrays_have_matching_length(self, built):
        n = len(built["xyz"])
        assert len(built["absmag"]) == n
        assert len(built["ci"]) == n
        assert len(built["ids"]) == n
        assert len(built["classes"]) == n
        assert built["manifest"]["count"] == n

    def test_no_nan_positions(self, built):
        assert np.all(np.isfinite(built["xyz"]))

    def test_no_nan_magnitudes(self, built):
        assert np.all(np.isfinite(built["absmag"]))

    def test_missing_colour_uses_sentinel_not_nan(self, built):
        ci = built["ci"]
        assert np.all(np.isfinite(ci))
        known = ci[ci > float(CI_UNKNOWN) + 1.0]
        assert known.min() > -1.0 and known.max() < 6.0

    def test_spectral_classes_in_range(self, built):
        assert built["classes"].max() <= 7

    def test_no_phantom_extragalactic_stars(self, built):
        """Naive 1/parallax puts some supergiants past the LMC. None may survive.

        The bound is a data-quality rejection, not a selection cut — see
        MAX_PLAUSIBLE_DISTANCE_PC.
        """
        assert built["distance"].max() <= MAX_PLAUSIBLE_DISTANCE_PC

    def test_quality_bound_removes_only_a_negligible_population(self, built):
        """It must be impossible for this bound to create a visible edge.

        If it ever started rejecting a meaningful number of stars it would stop
        being a data-quality rule and start being the distance cutoff this
        project forbids.
        """
        excluded = built["manifest"]["stats"]["excluded"].get("implausible_distance", 0)
        assert excluded < 100, f"{excluded} stars rejected as implausible — too many"

    def test_the_bound_sits_far_outside_the_region_of_interest(self, built):
        """7000 ly is ~2.1 kpc; the bound is at 30 kpc."""
        region_of_interest_pc = 7000 / PC_TO_LY
        assert 10 * region_of_interest_pc < MAX_PLAUSIBLE_DISTANCE_PC


class TestManifest:
    def test_declares_storage_unit(self, built):
        assert built["manifest"]["frame"]["unit"] == "pc"

    def test_declares_axes_and_origin(self, built):
        frame = built["manifest"]["frame"]
        assert frame["origin"] == "Sol"
        assert set(frame["axes"]) == {"x", "y", "z"}

    def test_records_what_was_excluded(self, built):
        stats = built["manifest"]["stats"]
        assert stats["total_rows"] > stats["accepted"]
        assert sum(stats["excluded"].values()) == stats["total_rows"] - stats["accepted"]

    def test_records_source_provenance(self, built):
        source = built["manifest"]["source"]
        assert len(source["sha256"]) == 64
        assert source["url"].startswith("https://")

    def test_selection_rule_is_not_distance_limited(self, built):
        assert "distance" not in built["manifest"]["selection"]["rule"].split("-limited")[0]
        assert "luminosity" in built["manifest"]["selection"]["rule"]


class TestDeterminism:
    def test_rebuild_is_byte_identical(self, built, tmp_path):
        """A changed output file must always mean changed data, never a rerun."""
        build_stars(out_dir=tmp_path)
        for name in ("stars.bin", "stars.ids.bin", "stars.class.bin", "stars.names.json"):
            assert (tmp_path / name).read_bytes() == (built["dir"] / name).read_bytes(), name


class TestUnitsInterop:
    def test_pc_to_ly_constant_matches_the_typescript_side(self, built):
        """Both halves of the project hardcode this; they must not drift apart."""
        import astropy.units as u

        assert (1.0 * u.pc).to_value(u.lyr) == pytest.approx(PC_TO_LY, abs=1e-6)

    def test_wezen_distance_in_light_years_is_about_1600(self, built):
        """The figure quoted in the literature, as a units sanity check."""
        idx = _index_of_proper(built, "Wezen")
        ly = float(built["distance"][idx]) * PC_TO_LY
        assert 1400 < ly < 1900, f"Wezen at {ly:.0f} ly"
