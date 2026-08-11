"""Perceptual distance between polity colours.

Every polity on this map is told apart by hue alone — a ring around a star, a
few words of label — so two colours being *numerically* different means nothing.
What matters is whether an eye can separate them, and sRGB distance answers a
different question: #4FC3F7 and #4DD0E1 differ in every channel and are the same
colour to look at.

CIEDE2000 is the standard answer. Roughly, dE below 1 is invisible, below about
2.3 is the "just noticeable difference" for adjacent patches, and small marks
seen apart across a dark field need considerably more than that. The palette had
two pairs at dE 0.0 — four polities rendering as two colours — which no amount
of reading hex codes would have caught.
"""

from __future__ import annotations

import math


def hex_to_lab(value: str) -> tuple[float, float, float]:
    """sRGB hex to CIELAB, D65."""
    text = value.lstrip("#")
    r, g, b = (int(text[i : i + 2], 16) / 255 for i in (0, 2, 4))

    def linear(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = linear(r), linear(g), linear(b)
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 216 / 24389 else (841 / 108) * t + 4 / 29

    fx, fy, fz = f(x / 0.95047), f(y), f(z / 1.08883)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(first: tuple[float, float, float], second: tuple[float, float, float]) -> float:
    """CIEDE2000 between two CIELAB colours."""
    l1, a1, b1 = first
    l2, a2, b2 = second

    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    c_bar = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(c_bar**7 / (c_bar**7 + 25**7))) if c_bar > 0 else 0.0
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)

    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if (a1p or b1) else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if (a2p or b2) else 0.0

    delta_l = l2 - l1
    delta_c = c2p - c1p
    delta_h_angle = 0.0 if c1p * c2p == 0 else ((h2p - h1p + 180) % 360) - 180
    delta_h = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(delta_h_angle) / 2)

    l_bar = (l1 + l2) / 2
    c_bar_p = (c1p + c2p) / 2
    if c1p * c2p == 0:
        h_bar = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        h_bar = (h1p + h2p) / 2
    else:
        h_bar = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2

    t = (
        1
        - 0.17 * math.cos(math.radians(h_bar - 30))
        + 0.24 * math.cos(math.radians(2 * h_bar))
        + 0.32 * math.cos(math.radians(3 * h_bar + 6))
        - 0.20 * math.cos(math.radians(4 * h_bar - 63))
    )
    rotation = 30 * math.exp(-(((h_bar - 275) / 25) ** 2))
    rc = 2 * math.sqrt(c_bar_p**7 / (c_bar_p**7 + 25**7)) if c_bar_p > 0 else 0.0
    sl = 1 + (0.015 * (l_bar - 50) ** 2) / math.sqrt(20 + (l_bar - 50) ** 2)
    sc = 1 + 0.045 * c_bar_p
    sh = 1 + 0.015 * c_bar_p * t
    rt = -math.sin(math.radians(2 * rotation)) * rc

    return math.sqrt(
        (delta_l / sl) ** 2
        + (delta_c / sc) ** 2
        + (delta_h / sh) ** 2
        + rt * (delta_c / sc) * (delta_h / sh)
    )


def distance(first: str, second: str) -> float:
    """CIEDE2000 between two sRGB hex colours."""
    return delta_e(hex_to_lab(first), hex_to_lab(second))
