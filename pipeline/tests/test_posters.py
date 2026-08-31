"""Registering a picture against the catalogue.

Every failure here is silent by nature. A poster laid a parsec out of place
still looks like a poster; a mirrored one still looks like a map. So the tests
build synthetic posters whose true frame is known, put the specific traps in
them that the real series contains, and check that the measurement comes back
with the right answer or refuses to give one.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from oastarmap.build.posters import fit_ring, marker_mask, radius_of, register


def draw_ring(image: np.ndarray, cx: float, cy: float, radius: float) -> None:
    for degrees in np.arange(0, 360, 0.05):
        angle = math.radians(degrees)
        x = round(cx + radius * math.cos(angle))
        y = round(cy + radius * math.sin(angle))
        image[y - 1 : y + 2, x - 1 : x + 2] = (255, 255, 0)


def draw_dot(image: np.ndarray, x: float, y: float, colour=(255, 255, 255), size: int = 6) -> None:
    xi, yi = round(x), round(y)
    ys, xs = np.mgrid[-size : size + 1, -size : size + 1]
    inside = (xs**2 + ys**2) <= size**2
    image[yi - size : yi + size + 1, xi - size : xi + size + 1][inside] = colour


def poster(
    cx: float,
    cy: float,
    pc_per_px: float,
    stars: np.ndarray,
    *,
    ring_at: tuple[float, float] | None = None,
    ring_radius: float = 400.0,
    labels: bool = True,
    size: int = 1000,
) -> np.ndarray:
    """A synthetic top-down poster with a known frame."""
    image = np.zeros((size, size, 3), dtype=np.uint8)
    rx, ry = ring_at if ring_at else (cx, cy)
    draw_ring(image, rx, ry, ring_radius)
    if labels:
        # Degree captions, in the same yellow as the ring and just outside it.
        # They are why the circle cannot be fitted by colour alone.
        for degrees in range(0, 360, 30):
            angle = math.radians(degrees)
            lx = rx + (ring_radius + 40) * math.cos(angle)
            ly = ry + (ring_radius + 40) * math.sin(angle)
            draw_dot(image, lx, ly, (255, 255, 0), size=9)
    for x, y, *_ in stars:
        draw_dot(image, cx + x / pc_per_px, cy - y / pc_per_px)
    return image


def catalogue(points: list[tuple[float, float]]) -> np.ndarray:
    """Galactic x, y, z, absolute magnitude — z zero, all bright enough to plot."""
    return np.array([[x, y, 0.0, 1.0] for x, y in points])


# Inside 0.85 of the 8 pc radius these posters claim, which is the window the
# registration draws its candidates from.
POINTS = [
    (1.6, 2.4), (-3.2, 1.2), (0.4, -4.0), (4.8, -1.6), (-2.4, -3.6),
    (4.4, 4.0), (-5.2, 2.8), (0.8, 5.6), (-1.2, -6.0), (6.0, 0.8),
    (-5.6, -0.8), (2.8, -5.2),
]


def test_reads_the_radius_a_filename_claims(tmp_path):
    assert radius_of(tmp_path / "25pc_poster.png") == 25
    assert radius_of(tmp_path / "400pc_poster.png") == 400
    # The k is the whole difference between three kiloparsecs and three parsecs.
    assert radius_of(tmp_path / "3kpc_poster.png") == 3000
    assert radius_of(tmp_path / "readme.png") is None


def test_finds_the_ring_and_not_the_labels_around_it():
    stars = catalogue(POINTS)
    image = poster(500, 500, 0.02, stars, ring_radius=400)
    cx, cy, radius, scatter = fit_ring(image)
    # The captions are the same yellow and sit 40 pixels out, so a fit that
    # merely averaged yellow would come back large and loose.
    assert cx == pytest.approx(500, abs=1)
    assert cy == pytest.approx(500, abs=1)
    assert radius == pytest.approx(400, abs=1)
    assert scatter < 2


def test_a_label_is_not_mistaken_for_the_object_it_names():
    image = np.zeros((200, 200, 3), dtype=np.uint8)
    draw_dot(image, 100, 100, (255, 255, 255))
    draw_dot(image, 118, 100, (0, 255, 0), size=8)  # its caption, alongside
    mask = marker_mask(image)
    assert mask[100, 100]
    assert not mask[100, 118]


def test_measures_a_frame_it_was_not_told():
    stars = catalogue(POINTS)
    image = poster(500, 500, 0.02, stars)
    result = register(image, 8.0, stars, min_stars=6)
    assert result.method == "stars"
    assert result.sun_px[0] == pytest.approx(500, abs=1)
    assert result.sun_px[1] == pytest.approx(500, abs=1)
    assert result.pc_per_px == pytest.approx(0.02, rel=1e-3)
    assert abs(result.rotation_deg) < 0.1
    assert result.aspect == pytest.approx(1.0, abs=0.01)


def test_finds_a_sun_that_is_not_at_the_centre_of_its_own_ring():
    """Two of the eight real posters do exactly this.

    The 25 pc sheet puts the Sun 43 pixels off the middle of its boundary
    circle, which is a light year and a half. Taking the ring for the Sun would
    have hung it there with nothing on screen to say so.
    """
    stars = catalogue(POINTS)
    # Displaced by the same fraction of the ring the real sheet is: five per
    # cent of the radius, which is far more than a pixel and well short of the
    # point where the two measurements are no longer describing one picture.
    image = poster(484, 486, 0.02, stars, ring_at=(500, 500))
    result = register(image, 8.0, stars, min_stars=6)
    assert result.method == "stars"
    assert result.sun_px[0] == pytest.approx(484, abs=1.5)
    assert result.sun_px[1] == pytest.approx(486, abs=1.5)
    # And it records how far it had to move, so the disagreement is on the file
    # rather than quietly absorbed.
    assert result.centre_vs_ring_px == pytest.approx(math.hypot(16, 14), abs=2)


def test_refuses_a_poster_it_cannot_check():
    """Nothing plotted: fall back to the ring and say why.

    The failure that matters is not a bad fit, it is a bad fit reported as a
    good one — so the fallback has to be visible in the result.
    """
    stars = catalogue(POINTS)
    image = poster(500, 500, 0.02, np.zeros((0, 4)))
    result = register(image, 8.0, stars, min_stars=6)
    assert result.method == "ring"
    assert result.note
    assert result.sun_px[0] == pytest.approx(500, abs=1)


def test_catches_a_poster_that_is_mirrored():
    """A flip is the error that would otherwise register perfectly.

    Coreward drawn to the left instead of the right still looks like a map of
    the galaxy, and a fit that only measured a scale would place it happily.
    Refusal is what matters here rather than which guard does it: the markers no
    longer sit where the catalogue says, so either too few match or the affine
    comes back with the wrong handedness.
    """
    stars = catalogue(POINTS)
    image = poster(500, 500, 0.02, catalogue([(-x, y) for x, y in POINTS]))
    result = register(image, 8.0, stars, min_stars=6)
    assert result.method == "ring"


def test_catches_a_poster_that_is_turned():
    stars = catalogue(POINTS)
    # Small enough that the markers are still found — a fit that fails to match
    # anything proves nothing about whether it would have noticed the turn.
    turn = math.radians(3)
    spun = catalogue([
        (x * math.cos(turn) - y * math.sin(turn), x * math.sin(turn) + y * math.cos(turn))
        for x, y in POINTS
    ])
    image = poster(500, 500, 0.02, spun)
    result = register(image, 8.0, stars, min_stars=6)
    assert result.method == "ring"
    assert "rotation" in result.note
