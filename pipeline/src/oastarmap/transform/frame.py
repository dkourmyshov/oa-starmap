"""The one place the coordinate frame is defined.

Galactic Cartesian, heliocentric, parsecs:

    x -> galactic centre        (l =  0 deg, b = 0 deg)
    y -> direction of rotation  (l = 90 deg, b = 0 deg)   "spinward"
    z -> north galactic pole    (b = 90 deg)

This is simultaneously the standard astronomical frame and the convention used by
the Orion's Arm Universe Project, so no translation layer is required.

Every public function here takes and returns ``astropy.units.Quantity``. Bare
floats are rejected by astropy itself, which is the point: a unit mistake becomes
an exception rather than a silently wrong position 3000 ly from where it belongs.
"""

from __future__ import annotations

import astropy.units as u
import numpy as np
from astropy.coordinates import ICRS, Distance, Galactic

STORAGE_UNIT = u.pc

PC_TO_LY = 3.261563777
"""Parsecs to light years.

Orion's Arm works in light years and astronomy in parsecs, so this number is the
single point where the two meet. It is written out rather than derived so that the
renderer can assert the exact same literal and fail loudly if the halves drift; a
test checks it against astropy.
"""
"""Unit for everything written to disk. Declared in each output file's header.

Parsecs rather than light years because the source catalogues and the parallax
relation are parsec-native, so this is the representation with no conversion
error baked in. The UI displays light years by default regardless.
"""

GALACTIC_AXES = {
    "x": "galactic centre (l=0), 'coreward'",
    "y": "direction of rotation (l=90), 'spinward'",
    "z": "north galactic pole (b=90)",
}

GAIA_PARALLAX_ZERO_POINT = -0.017 * u.mas
"""Global Gaia EDR3/DR3 parallax zero-point offset (Lindegren et al. 2021).

Parallaxes are systematically *under*-estimated, so the correction
``parallax - zero_point`` increases them and therefore shrinks distances.
This is the global mean; the full Lindegren correction is a function of
magnitude, colour and position, and is deliberately not implemented here.
"""

MAX_PLAUSIBLE_DISTANCE_PC = 30000.0
"""Upper bound on a believable heliocentric distance for an object in this map.

**This is a data-quality rejection, not a selection cutoff**, and the distinction
matters because this project deliberately never applies a distance cut to shape
its samples.

Catalog far tails come from inverting parallaxes barely distinguishable from zero.
That yields an A8 supergiant at 98 kpc, or a "moving group" at 114 kpc — values
which are not measurements but divisions by almost-zero.

30 kpc is the far edge of the galactic stellar disk as seen from the Sun: the disk
reaches roughly 20 kpc galactocentric and the Sun sits 8.2 kpc out.

This cannot manufacture a visible edge. It sits about fourteen times beyond the
7000 ly region the map is built for, and only a handful of objects lie past it.
The one real population it excludes is the remote halo globulars (NGC 2419 and
kin, out past 90 kpc), which are outside this map's remit entirely.
"""

MIN_PARALLAX_OVER_ERROR = 5.0
"""Below this, a parallax does not support a distance and we refuse to invent one.

At ``parallax_over_error = 5`` the naive 1/parallax distance is already biased;
below it the inversion is meaningless. Such sources are returned as NaN and
excluded, rather than being given a plausible-looking wrong position.
"""


def parallax_to_distance(
    parallax: u.Quantity,
    parallax_over_error: np.ndarray | None = None,
    *,
    apply_zero_point: bool = True,
    min_parallax_over_error: float = MIN_PARALLAX_OVER_ERROR,
) -> u.Quantity:
    """Invert parallax to distance, refusing the cases the data cannot support.

    Args:
        parallax: Observed parallax, an angle Quantity (e.g. ``mas``).
        parallax_over_error: Optional SNR per source. Sources below
            ``min_parallax_over_error`` yield NaN.
        apply_zero_point: Apply the Lindegren+2021 global offset.
        min_parallax_over_error: SNR floor.

    Returns:
        Distance in parsecs. NaN where the parallax is non-positive or too noisy.
    """
    corrected = parallax - GAIA_PARALLAX_ZERO_POINT if apply_zero_point else parallax

    # Work in mas so the reciprocal is directly parsecs.
    observed_mas = np.atleast_1d(parallax.to_value(u.mas)).astype(np.float64)
    plx_mas = np.atleast_1d(corrected.to_value(u.mas)).astype(np.float64)

    # Test usability against the *observed* parallax as well as the corrected one.
    # A measured parallax of zero or below carries no distance information, and the
    # sub-milliarcsecond zero-point nudge must not be allowed to turn it into a
    # confident-looking distance of tens of kiloparsecs.
    usable = (observed_mas > 0) & (plx_mas > 0)
    if parallax_over_error is not None:
        usable &= np.atleast_1d(parallax_over_error) >= min_parallax_over_error

    dist_pc = np.full(plx_mas.shape, np.nan, dtype=np.float64)
    np.divide(1000.0, plx_mas, out=dist_pc, where=usable)

    if corrected.isscalar:
        return dist_pc[0] * u.pc
    return dist_pc * u.pc


def icrs_to_galactic_xyz(
    ra: u.Quantity,
    dec: u.Quantity,
    distance: u.Quantity,
) -> tuple[u.Quantity, u.Quantity, u.Quantity]:
    """Convert ICRS sky position + distance to heliocentric galactic Cartesian.

    The rotation is delegated to astropy rather than hand-rolled; the galactic
    pole and node are defined by convention and getting them slightly wrong
    produces errors that grow with distance and are easy to miss by eye.

    Args:
        ra: Right ascension (angle Quantity).
        dec: Declination (angle Quantity).
        distance: Distance (length Quantity). May contain NaN, which propagates.

    Returns:
        ``(x, y, z)`` as Quantities in :data:`STORAGE_UNIT`.
    """
    coord = ICRS(ra=ra, dec=dec, distance=Distance(distance, allow_negative=True))
    cart = coord.transform_to(Galactic()).cartesian

    return (
        cart.x.to(STORAGE_UNIT),
        cart.y.to(STORAGE_UNIT),
        cart.z.to(STORAGE_UNIT),
    )


def galactic_lb_to_xyz(
    lon: u.Quantity,
    lat: u.Quantity,
    distance: u.Quantity,
) -> tuple[u.Quantity, u.Quantity, u.Quantity]:
    """Convert galactic (l, b) + distance to galactic Cartesian.

    Many extended-object catalogues (SNRs, HII regions, molecular clouds) are
    published directly in galactic coordinates, so this avoids a pointless
    round trip through ICRS.
    """
    d = distance.to(STORAGE_UNIT)
    lon_rad = lon.to_value(u.rad)
    lat_rad = lat.to_value(u.rad)
    cos_lat = np.cos(lat_rad)

    return (
        d * (cos_lat * np.cos(lon_rad)),
        d * (cos_lat * np.sin(lon_rad)),
        d * np.sin(lat_rad),
    )


def absolute_magnitude(apparent_mag: np.ndarray, distance: u.Quantity) -> np.ndarray:
    """Absolute magnitude from apparent magnitude and distance.

    ``M = m - 5 * log10(d / 10 pc)``. NaN distances propagate to NaN.
    """
    d_pc = np.atleast_1d(distance.to_value(u.pc)).astype(np.float64)
    result = np.full(d_pc.shape, np.nan, dtype=np.float64)
    valid = np.isfinite(d_pc) & (d_pc > 0)
    np.subtract(
        np.atleast_1d(apparent_mag),
        5.0 * np.log10(d_pc / 10.0, where=valid, out=np.zeros_like(d_pc)),
        out=result,
        where=valid,
    )
    return result
