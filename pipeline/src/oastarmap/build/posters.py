"""Register scanned sky maps against the catalogue and place them in the frame.

A poster is a picture, not a dataset: it arrives as pixels with no coordinates
attached, and the only way to lay it over a map that does have coordinates is to
work out where its own frame sits. Kevin Jardine's Galaxy Map series says as
much on its face -- "top down orthographic projection from above the galactic
plane centred on the Sun with the galactic centre to the right" -- which fixes
the projection and the handedness but not the two numbers that matter: where the
Sun is in the image, and how many parsecs a pixel covers.

Those are measured here rather than typed in, by two independent routes that are
made to agree:

**The ring.** Each poster carries a yellow boundary circle labelled with its
radius, and that circle is the only structure in the image at a constant radius
all the way round -- so a histogram of yellow pixels by distance from the centre
spikes at it, and a least-squares circle through the spike gives centre and
radius to well under a pixel. Scale follows from the label.

**The stars.** The poster plots objects this project already holds positions
for. Predicting where each should land, finding the marker actually drawn there,
and solving the full six-parameter affine gives centre, scale, rotation and
aspect at once. Solving all six rather than assuming a scale is the point: a
poster that had been rotated, flipped or stretched would show up as a rotation
away from zero or an aspect away from one, instead of quietly registering wrong.

The second is the measurement; the first is the check on it. They have to agree
on scale to five per cent and on centre to six per cent of the radius before the
star fit is accepted, and every poster in the Jardine series passes -- rotations
within a tenth of a degree, aspects within one per cent, scales within half a
per cent of what the ring says independently.

The check is not ceremony. Two of the eight put the Sun somewhere other than the
centre of their own boundary ring -- the 25 pc poster by 43 pixels, the 10 pc by
23 -- so a reader who assumed the obvious thing would have hung both a parsec
out of place, with nothing on screen to say so. The residuals travel into the
manifest for the same reason: a backdrop that is right to a fifth of a parsec at
100 pc and to twenty parsecs at 3 kpc should say which it is.
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from oastarmap.build.writer import write_json
from oastarmap.paths import DATA_OUT_DIR, REPO_ROOT

POSTER_SOURCE_DIR = REPO_ROOT / "bitmap_maps"
"""Hand-collected sky maps, one directory per series."""

_SERIES = {
    "jardine_maps": {
        "title": "Galaxy Map",
        "credit": "Kevin Jardine / Galaxy Map",
        "licence": "CC BY 4.0",
        "url": "https://kevinjardine.dev",
        "note": (
            "Top-down orthographic projection of the galactic plane centred on the "
            "Sun, galactic centre to the right — the same frame this map uses."
        ),
    },
}

_RADIUS = re.compile(r"^(\d+)(k?)pc", re.I)


@dataclass
class Registration:
    """Where a poster's frame sits in ours, and how well that is known."""

    sun_px: tuple[float, float]
    pc_per_px: float
    method: str
    """`stars` where the catalogue fit was accepted, `ring` where it was not."""

    ring_px: tuple[float, float, float] = (0.0, 0.0, 0.0)
    """Fitted boundary circle: centre x, centre y, radius, all in pixels."""

    stars_used: int = 0
    rms_px: float | None = None
    rotation_deg: float = 0.0
    aspect: float = 1.0
    scale_vs_ring: float | None = None
    centre_vs_ring_px: float | None = None
    note: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "sun_px": list(self.sun_px),
            "pc_per_px": self.pc_per_px,
            "method": self.method,
            "ring_px": list(self.ring_px),
            "stars_used": self.stars_used,
            "rms_px": self.rms_px,
            "rms_pc": None if self.rms_px is None else self.rms_px * self.pc_per_px,
            "rotation_deg": self.rotation_deg,
            "aspect": self.aspect,
            "scale_vs_ring": self.scale_vs_ring,
            "centre_vs_ring_px": self.centre_vs_ring_px,
            "note": self.note,
        }


@dataclass
class Poster:
    name: str
    series: str
    file: str
    width: int
    height: int
    radius_pc: float
    registration: Registration
    meta: dict[str, str] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        sx, sy = self.registration.sun_px
        s = self.registration.pc_per_px
        # The quad the renderer draws, in parsecs, as offsets from Sol. Image y
        # runs down and the map's y runs up, so the top edge is the positive one.
        return {
            "name": self.name,
            "series": self.series,
            "file": self.file,
            "width": self.width,
            "height": self.height,
            "radius_pc": self.radius_pc,
            "bounds_pc": {
                "left": -sx * s,
                "right": (self.width - sx) * s,
                "top": sy * s,
                "bottom": -(self.height - sy) * s,
            },
            "registration": self.registration.as_dict(),
            **self.meta,
        }


def radius_of(path: Path) -> float | None:
    """The map radius a filename claims, in parsecs. `3kpc_poster.png` -> 3000."""
    found = _RADIUS.match(path.name)
    if not found:
        return None
    return float(found.group(1)) * (1000.0 if found.group(2) else 1.0)


def fit_ring(rgb: np.ndarray) -> tuple[float, float, float, float]:
    """The boundary circle: centre x, centre y, radius, and residual scatter.

    The degree labels around the rim are the same yellow as the ring itself, so
    they cannot be excluded by colour. They can be excluded by geometry: the
    ring is the one thing present at a single radius through every angle, so it
    dominates a histogram of radii however the labels are scattered. Two passes,
    because the first uses the image centre as its guess and the second uses the
    circle the first found.
    """
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ys, xs = np.nonzero(
        (red > 190) & (green > 190) & (blue < 70) & (np.abs(red - green) < 25)
    )
    height, width = red.shape
    cx, cy = width / 2.0, height / 2.0
    radius, scatter = 0.0, 0.0
    for _ in range(3):
        distance = np.hypot(xs - cx, ys - cy)
        counts, edges = np.histogram(distance, bins=np.arange(0, max(width, height), 2.0))
        peak = edges[int(counts.argmax())] + 1.0
        near = np.abs(distance - peak) < 12
        px, py = xs[near].astype(float), ys[near].astype(float)
        if len(px) < 200:
            break
        design = np.column_stack([px, py, np.ones_like(px)])
        d, e, f = np.linalg.lstsq(design, -(px**2 + py**2), rcond=None)[0]
        cx, cy = -d / 2.0, -e / 2.0
        radius = float(np.sqrt(cx * cx + cy * cy - f))
        scatter = float(np.std(np.hypot(px - cx, py - cy) - radius))
    return float(cx), float(cy), radius, scatter


def marker_mask(rgb: np.ndarray) -> np.ndarray:
    """Pixels that could be a plotted object rather than annotation.

    Object markers are bright discs in any hue. The labels beside them are green
    and are excluded, which is what keeps a name from being mistaken for the
    thing it names — they sit within a few pixels of each other.
    """
    red, green, blue = (rgb[..., i].astype(int) for i in range(3))
    bright = (red + green + blue) > 260
    label_green = (green > red + 60) & (green > blue + 60)
    return bright & ~label_green


def _blob(mask: np.ndarray, px: float, py: float, half: int) -> tuple[float, float] | None:
    """Centroid of the marker nearest a predicted position, or None."""
    height, width = mask.shape
    x0, y0 = int(px) - half, int(py) - half
    if x0 < 0 or y0 < 0 or x0 + 2 * half >= width or y0 + 2 * half >= height:
        return None
    ys, xs = np.nonzero(mask[y0 : y0 + 2 * half, x0 : x0 + 2 * half])
    if len(xs) < 40:
        return None
    seed = int(np.argmin((xs - half) ** 2 + (ys - half) ** 2))
    near = ((xs - xs[seed]) ** 2 + (ys - ys[seed]) ** 2) < 14**2
    if near.sum() < 40:
        return None
    return float(x0 + xs[near].mean()), float(y0 + ys[near].mean())


def register(
    rgb: np.ndarray,
    radius_pc: float,
    stars: np.ndarray,
    *,
    min_stars: int = 8,
) -> Registration:
    """Measure where a poster's frame sits, and how well.

    `stars` is an (N, 4) array of galactic x, y, z in parsecs and absolute
    magnitude. Only the projection onto the plane is used, since that is what a
    top-down poster draws.
    """
    ring_cx, ring_cy, ring_r, ring_scatter = fit_ring(rgb)
    ring = (ring_cx, ring_cy, ring_r)
    if ring_r <= 0:
        return Registration((rgb.shape[1] / 2, rgb.shape[0] / 2), radius_pc / 1000.0,
                            "none", ring, note="no boundary ring found")

    ring_scale = radius_pc / ring_r
    mask = marker_mask(rgb)

    inside = stars[
        (np.hypot(stars[:, 0], stars[:, 1]) < 0.85 * radius_pc)
        & (np.abs(stars[:, 2]) < radius_pc)
    ]
    chosen = inside[inside[:, 3] < 3.0]
    if len(chosen) < min_stars:
        # The close-in posters plot the neighbourhood entire, dwarfs included:
        # there is no star of absolute magnitude 3 within ten parsecs.
        chosen = inside
    chosen = chosen[np.argsort(chosen[:, 3])][:60]

    fallback = Registration((ring_cx, ring_cy), ring_scale, "ring", ring,
                            note="too few catalogue objects inside the poster")
    if len(chosen) < min_stars:
        return fallback

    cx, cy, scale = ring_cx, ring_cy, ring_scale
    live = chosen
    rms = rotation = None
    aspect = 1.0
    used = 0
    # Coarse first, because two of these posters place the Sun tens of pixels
    # off their own ring and the seed has to reach that far; tight afterwards,
    # so a neighbour picked up by the wide pass is dropped again.
    for half in (50, 26, 14, 14):
        seen = []
        for x, y, _z, _m in live:
            found = _blob(mask, cx + x / scale, cy - y / scale, half)
            if found:
                seen.append((x, y, found[0], found[1]))
        if len(seen) < min_stars:
            break
        design = np.array([[s[0], s[1], 1.0] for s in seen])
        want_x = np.array([s[2] for s in seen])
        want_y = np.array([s[3] for s in seen])
        sol_x = np.linalg.lstsq(design, want_x, rcond=None)[0]
        sol_y = np.linalg.lstsq(design, want_y, rcond=None)[0]
        a, _b, cx = sol_x
        c, d, cy = sol_y
        scale = 1.0 / float(np.hypot(a, c))
        residual = np.hypot(design @ sol_x - want_x, design @ sol_y - want_y)
        rms = float(np.sqrt((residual**2).mean()))
        rotation = float(np.degrees(np.arctan2(c, a)))
        aspect = float(abs(d) / abs(a))
        used = len(seen)
        keep = residual < max(2.5, float(np.median(residual)) * 2.5)
        live = np.array([[seen[i][0], seen[i][1], 0.0, 0.0] for i in range(used) if keep[i]])

    if rms is None or rotation is None:
        return fallback

    # Accepted on agreement with the ring, not on an absolute residual. The wide
    # posters mark associations and star-forming complexes rather than points,
    # so their centroids scatter by several pixels — which at three kiloparsecs
    # is a fifth of a per cent. What has to hold is that two independent
    # measurements of the same picture agree: the circle its author drew, and
    # where this project's own catalogue says the objects on it belong.
    scale_ratio = scale / ring_scale - 1.0
    centre_shift = float(np.hypot(cx - ring_cx, cy - ring_cy))
    accepted = (
        used >= min_stars
        and abs(rotation) < 0.5
        and abs(aspect - 1.0) < 0.02
        and rms < 0.01 * ring_r
        and abs(scale_ratio) < 0.05
        and centre_shift < 0.06 * ring_r
    )
    if not accepted:
        fallback.stars_used = used
        fallback.rms_px = rms
        fallback.rotation_deg = rotation
        fallback.aspect = aspect
        fallback.note = (
            f"star fit rejected: {used} objects, rms {rms:.1f}px, "
            f"rotation {rotation:.2f}deg, aspect {aspect:.4f}, "
            f"scale {scale_ratio * 100:+.1f}% and centre {centre_shift:.0f}px from the ring"
        )
        return fallback

    return Registration(
        sun_px=(float(cx), float(cy)),
        pc_per_px=scale,
        method="stars",
        ring_px=ring,
        stars_used=used,
        rms_px=rms,
        rotation_deg=rotation,
        aspect=aspect,
        scale_vs_ring=scale_ratio,
        centre_vs_ring_px=centre_shift,
        note=f"ring residual {ring_scatter:.2f}px",
    )


def _catalogue(out_dir: Path) -> np.ndarray:
    """Galactic x, y, z and absolute magnitude for every built star."""
    positions = np.fromfile(out_dir / "stars.bin", dtype="<f4").reshape(-1, 5)
    return positions[:, :4].astype(float)


def build_posters(
    source_dir: Path | None = None,
    out_dir: Path | None = None,
) -> dict[str, Any] | None:
    """Register every poster and copy it where the renderer can fetch it.

    Returns None when there are no posters, or no star build to register them
    against — the layer is an optional extra and its absence must not fail a
    build.
    """
    from PIL import Image

    source_dir = source_dir or POSTER_SOURCE_DIR
    out_dir = out_dir or DATA_OUT_DIR
    if not source_dir.is_dir() or not (out_dir / "stars.bin").exists():
        return None

    stars = _catalogue(out_dir)
    target = out_dir / "posters"
    target.mkdir(parents=True, exist_ok=True)

    posters: list[Poster] = []
    for series_dir in sorted(p for p in source_dir.iterdir() if p.is_dir()):
        meta = _SERIES.get(series_dir.name, {})
        for image_path in sorted(series_dir.glob("*.png")):
            radius_pc = radius_of(image_path)
            if radius_pc is None:
                continue
            with Image.open(image_path) as handle:
                rgb = np.asarray(handle.convert("RGB"))
            registration = register(rgb, radius_pc, stars)
            copied = f"{series_dir.name}__{image_path.name}"
            shutil.copyfile(image_path, target / copied)
            posters.append(
                Poster(
                    name=_poster_name(radius_pc),
                    series=series_dir.name,
                    file=f"posters/{copied}",
                    width=int(rgb.shape[1]),
                    height=int(rgb.shape[0]),
                    radius_pc=radius_pc,
                    registration=registration,
                    meta={k: v for k, v in meta.items() if isinstance(v, str)},
                )
            )

    if not posters:
        return None

    posters.sort(key=lambda p: p.radius_pc)
    payload = {
        "frame": {
            "name": "galactic-cartesian-heliocentric",
            "origin": "Sol",
            "unit": "pc",
            "note": "Posters lie in the z = 0 plane; only x and y are registered.",
        },
        "posters": [p.as_dict() for p in posters],
    }
    write_json(out_dir / "posters.json", payload)
    return {"count": len(posters), "files": {"posters": {"file": "posters.json"}}}


def _poster_name(radius_pc: float) -> str:
    return f"{radius_pc / 1000:g} kpc" if radius_pc >= 1000 else f"{radius_pc:g} pc"


def describe(out_dir: Path | None = None) -> str:
    """The registration table, for the build log and for eyeballing."""
    out_dir = out_dir or DATA_OUT_DIR
    path = out_dir / "posters.json"
    if not path.exists():
        return "no posters"
    payload = json.loads(path.read_text(encoding="utf-8"))
    lines = [
        f"{'poster':>9}  {'method':>6} {'n':>3} {'rms px':>7} {'rms pc':>7} "
        f"{'sun x':>8} {'sun y':>8} {'pc/px':>10} {'rot':>7} {'aspect':>7}"
    ]
    for poster in payload["posters"]:
        r = poster["registration"]
        rms_px = "-" if r["rms_px"] is None else f"{r['rms_px']:.2f}"
        rms_pc = "-" if r["rms_pc"] is None else f"{r['rms_pc']:.2f}"
        lines.append(
            f"{poster['name']:>9}  {r['method']:>6} {r['stars_used']:3d} {rms_px:>7} "
            f"{rms_pc:>7} {r['sun_px'][0]:8.1f} {r['sun_px'][1]:8.1f} "
            f"{r['pc_per_px']:10.6f} {r['rotation_deg']:+7.3f} {r['aspect']:7.5f}"
        )
    return "\n".join(lines)
