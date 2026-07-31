"""Star colour and spectral classification.

Colour is derived from the B-V colour index rather than invented per spectral
class, so a star's rendered colour traces its measured photometry. The two
approximations used here are documented and bounded; neither is exact physics.
"""

from __future__ import annotations

import numpy as np

SPECTRAL_CLASSES = ("O", "B", "A", "F", "G", "K", "M", "?")
"""Index order for the packed spectral-class byte. '?' covers white dwarfs,
carbon stars, S-types and unparseable entries — anything not on the main
OBAFGKM sequence."""

SPECTRAL_INDEX = {c: i for i, c in enumerate(SPECTRAL_CLASSES)}
UNKNOWN_CLASS = SPECTRAL_INDEX["?"]

# Ballesteros' formula is fitted over roughly -0.4 < B-V < 2.0 and degrades
# badly outside it, so inputs are clamped rather than extrapolated.
BV_MIN, BV_MAX = -0.4, 2.0
TEMP_MIN_K, TEMP_MAX_K = 1000.0, 40000.0


def parse_spectral_class(spect: str) -> int:
    """Reduce a spectral type string to an index into :data:`SPECTRAL_CLASSES`.

    Handles the common prefixed forms in HYG: ``sdM3`` (subdwarf), ``kA5hA7mF0``
    (peculiar A stars, where the leading lowercase letters are line-type markers,
    not the class), and ``DA3`` (white dwarf, which is not on the OBAFGKM
    sequence at all and is reported as unknown).
    """
    s = spect.strip()
    if not s:
        return UNKNOWN_CLASS

    # White dwarfs are 'D' followed by a spectral letter; the letter is not the
    # temperature class, so match this before scanning for OBAFGKM.
    if s[0] == "D":
        return UNKNOWN_CLASS

    # The class is the first *uppercase* OBAFGKM letter: lowercase prefixes are
    # qualifiers (sd = subdwarf, k/h/m = line types).
    for ch in s:
        if ch in SPECTRAL_INDEX and ch.isupper():
            return SPECTRAL_INDEX[ch]

    return UNKNOWN_CLASS


def bv_to_temperature(bv: np.ndarray) -> np.ndarray:
    """Effective temperature in kelvin from B-V, via Ballesteros (2012).

    ``T = 4600 * (1/(0.92·BV + 1.7) + 1/(0.92·BV + 0.62))``

    Accurate to a few percent for A through M stars (it gives 5756 K for the
    Sun's B-V of 0.656, against a true 5778 K). It systematically
    *under*-estimates the hottest O stars, so colours at the blue end are
    approximate. NaN in, NaN out.
    """
    bv = np.asarray(bv, dtype=np.float64)
    out = np.full(bv.shape, np.nan, dtype=np.float64)
    valid = np.isfinite(bv)
    if not np.any(valid):
        return out

    b = np.clip(bv[valid], BV_MIN, BV_MAX)
    t = 4600.0 * (1.0 / (0.92 * b + 1.70) + 1.0 / (0.92 * b + 0.62))
    out[valid] = np.clip(t, TEMP_MIN_K, TEMP_MAX_K)
    return out


def temperature_to_rgb(temp_k: np.ndarray) -> np.ndarray:
    """Approximate sRGB colour of a blackbody, normalised so max channel = 1.

    Uses Tanner Helland's piecewise fit to the blackbody locus, valid over
    1000-40000 K. Channels are normalised rather than scaled by luminosity:
    brightness is the renderer's job, this function only supplies hue.

    Args:
        temp_k: Temperatures in kelvin, any shape.

    Returns:
        Array of shape ``(..., 3)`` with components in [0, 1]. NaN input gives
        white (1, 1, 1), the neutral choice for a star of unknown colour.
    """
    t = np.asarray(temp_k, dtype=np.float64)
    rgb = np.ones((*t.shape, 3), dtype=np.float64)

    valid = np.isfinite(t)
    if not np.any(valid):
        return rgb

    x = np.clip(t[valid], TEMP_MIN_K, TEMP_MAX_K) / 100.0

    # Red
    r = np.where(
        x <= 66.0, 255.0, 329.698727446 * np.power(np.maximum(x - 60.0, 1e-9), -0.1332047592)
    )

    # Green
    g_cool = 99.4708025861 * np.log(np.maximum(x, 1e-9)) - 161.1195681661
    g_hot = 288.1221695283 * np.power(np.maximum(x - 60.0, 1e-9), -0.0755148492)
    g = np.where(x <= 66.0, g_cool, g_hot)

    # Blue
    b_mid = 138.5177312231 * np.log(np.maximum(x - 10.0, 1e-9)) - 305.0447927307
    b = np.where(x >= 66.0, 255.0, np.where(x <= 19.0, 0.0, b_mid))

    stacked = (
        np.stack(
            [np.clip(r, 0.0, 255.0), np.clip(g, 0.0, 255.0), np.clip(b, 0.0, 255.0)],
            axis=-1,
        )
        / 255.0
    )

    # Normalise so the brightest channel is 1: hue only, no implied luminosity.
    peak = np.max(stacked, axis=-1, keepdims=True)
    rgb[valid] = np.divide(stacked, peak, out=np.ones_like(stacked), where=peak > 0)
    return rgb


def build_color_lut(size: int = 256) -> np.ndarray:
    """Precompute a B-V → RGB lookup table for the renderer.

    Shipping a table keeps the star shader trivial and guarantees the pipeline
    and the renderer agree on colour, rather than each implementing its own
    approximation of the blackbody locus.

    Returns:
        ``(size, 3)`` float array. Index 0 is :data:`BV_MIN`, index ``size-1``
        is :data:`BV_MAX`.
    """
    bv = np.linspace(BV_MIN, BV_MAX, size)
    return temperature_to_rgb(bv_to_temperature(bv))
