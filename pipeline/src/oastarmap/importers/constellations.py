"""Tabulate the IAU constellations as directions on the sky.

Orion's Arm locates many of its worlds the way an observer would: a distance
from Sol and a constellation. That fixes the radius precisely and the direction
only to within a region of sky, so a position built from it is exact in one
dimension and coarse in the other two. To build one at all, each constellation
needs a direction and an extent.

Both are derived here rather than looked up, because the IAU boundaries are
defined as edges, not as centres: there is no published centroid to cite. The
method is to sample the sphere uniformly, ask astropy which constellation each
sample falls in, and reduce each group to

* a **centre** — the normalised mean of the sample unit vectors, which for a
  convex-ish region is its centre of area, and
* a **radius** — the greatest angular separation from that centre to any of its
  samples, so a cone of that half-angle about the centre contains the whole
  constellation.

The radius is deliberately the enclosing one rather than an area-equivalent one.
It overstates the spread for the long thin constellations — Hydra reaches about
60 degrees — but a world said to be "in Hydra" really can be anywhere along it,
and a figure that quietly excluded the ends would be the wrong kind of wrong.

Sampling is uniform in right ascension and in the *sine* of declination, which
is uniform per unit area; sampling uniformly in declination instead would crowd
the poles and drag every centroid toward them.

Output is tracked, like every other import: the numbers are stable, worth
reading, and occasionally worth overriding by hand for a constellation whose
shape makes the centroid unhelpful.
"""

from __future__ import annotations

from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord, get_constellation

SAMPLES_RA = 1440
SAMPLES_DEC = 720
"""About a million samples, near a quarter degree apart at the equator.

Fine enough that a centroid moves by well under a tenth of a degree if the grid
is refined further, which is far below the precision the source data has.
"""

CORRECTIONS = {
    "Chamaleon": "Chamaeleon",
    "Ophiucus": "Ophiuchus",
    "Pisces Austrinus": "Piscis Austrinus",
}
"""Misspellings in astropy's constellation table, against the IAU's own list.

Three of the eighty-eight. They are not ours to keep: a world recorded as being
in Ophiuchus should not fail to build because the table says "Ophiucus". The
corrected form is what the file stores and what an author writes; astropy's
spelling is kept alongside it as ``source_name``, because that is still what
``get_constellation`` returns and any check comparing the two needs to agree.
"""

SOURCE = (
    "IAU constellation boundaries (Delporte 1930, B1875), via "
    "astropy.coordinates.get_constellation"
)


def _sample_sky() -> tuple[SkyCoord, np.ndarray]:
    """A grid of equal-area sample points, and their unit vectors."""
    ra = (np.arange(SAMPLES_RA) + 0.5) * 360.0 / SAMPLES_RA
    sin_dec = -1.0 + (np.arange(SAMPLES_DEC) + 0.5) * 2.0 / SAMPLES_DEC
    ra_grid, sin_dec_grid = np.meshgrid(ra, sin_dec, indexing="ij")
    dec = np.degrees(np.arcsin(sin_dec_grid))

    coords = SkyCoord(ra=ra_grid.ravel() * u.deg, dec=dec.ravel() * u.deg)
    return coords, coords.cartesian.xyz.value.T


def tabulate() -> list[dict[str, object]]:
    """Centre, enclosing radius and area for each of the 88 constellations."""
    coords, vectors = _sample_sky()
    # astropy's table stores "Crux " with a trailing space. Stripped once, as an
    # array operation: comparing element by element over a million samples for
    # each of 88 names is a hundred million Python-level string compares.
    names = np.char.strip(np.asarray(get_constellation(coords), dtype=str))
    short = np.char.strip(np.asarray(get_constellation(coords, short_name=True), dtype=str))

    sky_area = 4.0 * np.pi * (180.0 / np.pi) ** 2
    per_sample = sky_area / len(names)

    rows: list[dict[str, object]] = []
    for name in sorted(set(names.tolist())):
        members = names == name
        centre = vectors[members].mean(axis=0)
        centre /= np.linalg.norm(centre)

        # Clipped because a dot product of two unit vectors can land a hair
        # outside [-1, 1] in floating point, and arccos would return nan.
        cosines = np.clip(vectors[members] @ centre, -1.0, 1.0)
        radius = float(np.degrees(np.arccos(cosines.min())))

        point = SkyCoord(x=centre[0], y=centre[1], z=centre[2], representation_type="cartesian")
        point.representation_type = "spherical"

        # Whether the centre of area is inside the figure at all. Serpens is the
        # one constellation in the sky that is disjoint — Caput and Cauda lie on
        # either side of Ophiuchus — so its centre of area falls in Hercules,
        # and a world placed there by centroid would be put in the wrong part of
        # the sky entirely. Recorded so the build can refuse rather than guess.
        inside = str(get_constellation(point)).strip() == name

        rows.append(
            {
                "name": CORRECTIONS.get(name, name),
                "source_name": name if name in CORRECTIONS else "",
                "abbreviation": str(short[members][0]).strip(),
                "ra_deg": round(float(point.ra.deg), 4),
                "dec_deg": round(float(point.dec.deg), 4),
                "radius_deg": round(radius, 2),
                "area_sq_deg": round(float(members.sum()) * per_sample, 1),
                "centroid_inside": inside,
            }
        )
    return rows


def import_constellations(dest: Path) -> int:
    """Write the table to ``fiction/constellations.yaml``. Returns the row count."""
    rows = tabulate()

    lines = [
        "# IAU constellations as directions on the sky, for worlds Orion's Arm",
        "# locates by distance and constellation rather than by coordinates.",
        "#",
        f"# Source: {SOURCE}.",
        "# Generated by `oastarmap import-constellations`; edit by hand only to",
        "# override a centre, and say why when you do.",
        "#",
        "# ra_deg / dec_deg  the centre of area, as a normalised mean unit vector",
        "# radius_deg        half-angle of the cone about that centre which",
        "#                   contains the whole constellation, so it is an upper",
        "#                   bound on how wrong the direction can be",
        "# area_sq_deg       for reference; the sky is 41,253 square degrees",
        "# source_name       present only where astropy's table misspells the",
        "#                   constellation and this file corrects it",
        "# centroid_inside   false where the centre of area falls outside the",
        "#                   figure itself, which makes it useless as a position.",
        "#                   Serpens is the only one: it is two disjoint halves",
        "#                   either side of Ophiuchus, and its centre is in",
        "#                   Hercules. The build refuses to place a world there.",
        "",
        "constellations:",
    ]
    for row in rows:
        lines.append(f"  - name: {row['name']}")
        if row["source_name"]:
            lines.append(f"    source_name: {row['source_name']}")
        lines.append(f"    abbreviation: {row['abbreviation']}")
        lines.append(f"    ra_deg: {row['ra_deg']}")
        lines.append(f"    dec_deg: {row['dec_deg']}")
        lines.append(f"    radius_deg: {row['radius_deg']}")
        lines.append(f"    area_sq_deg: {row['area_sq_deg']}")
        lines.append(f"    centroid_inside: {str(row['centroid_inside']).lower()}")
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(rows)
