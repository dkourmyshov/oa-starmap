"""Tests for the galactic coordinate frame and unit safety.

These are the load-bearing correctness tests of the whole project: a subtly wrong
rotation puts objects in plausible-looking but wrong places, with the error growing
with distance, which is exactly the kind of bug nobody notices by eye.
"""

from __future__ import annotations

import astropy.units as u
import numpy as np
import pytest
from astropy.coordinates import ICRS, Galactic

from oastarmap.transform.frame import (
    GAIA_PARALLAX_ZERO_POINT,
    STORAGE_UNIT,
    absolute_magnitude,
    galactic_lb_to_xyz,
    icrs_to_galactic_xyz,
    parallax_to_distance,
)

# ICRS directions that *define* the galactic frame's axes.
NGP_RA, NGP_DEC = 192.85948 * u.deg, 27.12825 * u.deg  # b = +90
GC_RA, GC_DEC = 266.40500 * u.deg, -28.93617 * u.deg  # l = 0, b = 0


class TestAxisDefinitions:
    """The frame must match its docstring exactly: x coreward, y spinward, z north."""

    def test_ngp_maps_to_positive_z(self):
        x, y, z = icrs_to_galactic_xyz(NGP_RA, NGP_DEC, 100.0 * u.pc)
        assert z.to_value(u.pc) == pytest.approx(100.0, abs=0.05)
        assert x.to_value(u.pc) == pytest.approx(0.0, abs=0.05)
        assert y.to_value(u.pc) == pytest.approx(0.0, abs=0.05)

    def test_galactic_centre_maps_to_positive_x(self):
        x, y, z = icrs_to_galactic_xyz(GC_RA, GC_DEC, 100.0 * u.pc)
        assert x.to_value(u.pc) == pytest.approx(100.0, abs=0.05)
        assert y.to_value(u.pc) == pytest.approx(0.0, abs=0.05)
        assert z.to_value(u.pc) == pytest.approx(0.0, abs=0.05)

    def test_l90_maps_to_positive_y(self):
        """Spinward. This is the axis that catches a left/right handedness flip."""
        x, y, z = galactic_lb_to_xyz(90.0 * u.deg, 0.0 * u.deg, 100.0 * u.pc)
        assert y.to_value(u.pc) == pytest.approx(100.0, abs=1e-9)
        assert x.to_value(u.pc) == pytest.approx(0.0, abs=1e-9)
        assert z.to_value(u.pc) == pytest.approx(0.0, abs=1e-9)

    def test_frame_is_right_handed(self):
        """x cross y must equal z, not -z."""
        d = 1.0 * u.pc
        ex = np.array([q.to_value(u.pc) for q in galactic_lb_to_xyz(0 * u.deg, 0 * u.deg, d)])
        ey = np.array([q.to_value(u.pc) for q in galactic_lb_to_xyz(90 * u.deg, 0 * u.deg, d)])
        ez = np.array([q.to_value(u.pc) for q in galactic_lb_to_xyz(0 * u.deg, 90 * u.deg, d)])
        np.testing.assert_allclose(np.cross(ex, ey), ez, atol=1e-9)

    def test_icrs_and_lb_paths_agree(self):
        """The two entry points must not disagree — they feed different catalogs."""
        ra, dec, dist = 279.23473 * u.deg, 38.78369 * u.deg, 7.68 * u.pc  # Vega
        gal = ICRS(ra=ra, dec=dec).transform_to(Galactic())

        via_icrs = icrs_to_galactic_xyz(ra, dec, dist)
        via_lb = galactic_lb_to_xyz(gal.l, gal.b, dist)

        for a, b in zip(via_icrs, via_lb, strict=True):
            assert a.to_value(u.pc) == pytest.approx(b.to_value(u.pc), abs=1e-6)


class TestRealObjects:
    """Published positions, as an independent check on the transform."""

    @pytest.mark.parametrize(
        ("name", "ra_deg", "dec_deg", "exp_l", "exp_b"),
        [
            ("Vega", 279.23473, 38.78369, 67.45, 19.24),
            ("Deneb", 310.35798, 45.28028, 84.28, 2.00),
            ("Rigel", 78.63447, -8.20164, 209.24, -25.25),
            ("Wezen", 107.09785, -26.39320, 238.42, -8.27),
        ],
    )
    def test_published_galactic_coordinates(self, name, ra_deg, dec_deg, exp_l, exp_b):
        """Expected values are the *published* galactic coordinates for each star.

        Deliberately not copied from this code's own output — that would make the
        test circular. These are the reference positions used for spot-checking
        the built dataset later.
        """
        gal = ICRS(ra=ra_deg * u.deg, dec=dec_deg * u.deg).transform_to(Galactic())
        assert gal.l.deg == pytest.approx(exp_l, abs=0.05), name
        assert gal.b.deg == pytest.approx(exp_b, abs=0.05), name

    def test_sgr_a_star_lies_coreward(self):
        """Sgr A* is the galactic centre, so it must sit on +x, ~8.2 kpc out."""
        x, y, z = icrs_to_galactic_xyz(266.41684 * u.deg, -29.00781 * u.deg, 8178.0 * u.pc)
        assert x.to_value(u.pc) == pytest.approx(8178.0, rel=1e-4)
        assert abs(y.to_value(u.pc)) < 20.0
        assert abs(z.to_value(u.pc)) < 20.0


class TestUnitSafety:
    """Confusing ly and pc must be impossible, not merely discouraged."""

    def test_bare_number_cannot_be_added_to_a_distance(self):
        """The actual failure mode astropy prevents: a number with no unit."""
        with pytest.raises(u.UnitConversionError):
            _ = (1.0 * u.pc) + 1.0

    def test_pc_and_ly_convert_rather_than_concatenate(self):
        """1 pc + 1 ly is 1.3066 pc — never 2 of anything."""
        total = (1.0 * u.pc) + (1.0 * u.lyr)
        assert total.to_value(u.pc) == pytest.approx(1.30660, abs=1e-5)
        assert total.to_value(u.pc) != pytest.approx(2.0, abs=0.1)

    def test_light_year_conversion_factor(self):
        """The constant the TypeScript side hardcodes — keep them in agreement."""
        assert (1.0 * u.pc).to_value(u.lyr) == pytest.approx(3.261564, abs=1e-6)

    def test_storage_unit_is_parsecs(self):
        assert STORAGE_UNIT is u.pc

    def test_output_is_in_storage_unit_regardless_of_input_unit(self):
        """Feeding light years must not produce light years downstream."""
        x_pc, _, _ = icrs_to_galactic_xyz(GC_RA, GC_DEC, 100.0 * u.pc)
        x_ly, _, _ = icrs_to_galactic_xyz(GC_RA, GC_DEC, 326.1564 * u.lyr)
        assert x_pc.unit == STORAGE_UNIT
        assert x_ly.unit == STORAGE_UNIT
        assert x_ly.to_value(u.pc) == pytest.approx(x_pc.to_value(u.pc), rel=1e-5)


class TestParallax:
    def test_simple_inversion(self):
        d = parallax_to_distance(100.0 * u.mas, apply_zero_point=False)
        assert d.to_value(u.pc) == pytest.approx(10.0, rel=1e-9)

    def test_zero_point_shrinks_distance(self):
        """The offset increases parallax, so it must *reduce* the distance."""
        with_zp = parallax_to_distance(100.0 * u.mas, apply_zero_point=True)
        without = parallax_to_distance(100.0 * u.mas, apply_zero_point=False)
        assert with_zp < without
        assert with_zp.to_value(u.pc) == pytest.approx(1000.0 / 100.017, rel=1e-9)

    def test_zero_point_sign_is_negative(self):
        assert GAIA_PARALLAX_ZERO_POINT.to_value(u.mas) < 0

    def test_noisy_parallax_yields_nan_not_a_guess(self):
        plx = np.array([10.0, 10.0]) * u.mas
        snr = np.array([50.0, 2.0])
        d = parallax_to_distance(plx, snr)
        assert np.isfinite(d.to_value(u.pc)[0])
        assert np.isnan(d.to_value(u.pc)[1])

    def test_non_positive_parallax_yields_nan(self):
        d = parallax_to_distance(np.array([-1.0, 0.0, 5.0]) * u.mas)
        vals = d.to_value(u.pc)
        assert np.isnan(vals[0])
        assert np.isnan(vals[1])
        assert np.isfinite(vals[2])

    def test_accepts_parallax_in_arcsec_too(self):
        """Unit-agnostic input: 0.1 arcsec is 100 mas."""
        a = parallax_to_distance(0.1 * u.arcsec, apply_zero_point=False)
        b = parallax_to_distance(100.0 * u.mas, apply_zero_point=False)
        assert a.to_value(u.pc) == pytest.approx(b.to_value(u.pc), rel=1e-9)


class TestAbsoluteMagnitude:
    def test_at_ten_parsecs_apparent_equals_absolute(self):
        m = absolute_magnitude(np.array([5.0]), np.array([10.0]) * u.pc)
        assert m[0] == pytest.approx(5.0, abs=1e-9)

    def test_distance_modulus(self):
        """At 100 pc the modulus is exactly 5 magnitudes."""
        m = absolute_magnitude(np.array([10.0]), np.array([100.0]) * u.pc)
        assert m[0] == pytest.approx(5.0, abs=1e-9)

    def test_nan_distance_propagates(self):
        m = absolute_magnitude(np.array([5.0, 5.0]), np.array([10.0, np.nan]) * u.pc)
        assert np.isfinite(m[0])
        assert np.isnan(m[1])

    def test_deneb_is_intrinsically_luminous(self):
        """Sanity anchor: Deneb must come out brighter than about -7 absolute.

        This is what justifies the no-distance-cutoff design — Deneb is 800 pc
        away and still naked-eye visible.
        """
        m = absolute_magnitude(np.array([1.25]), np.array([802.0]) * u.pc)
        assert m[0] < -7.0
