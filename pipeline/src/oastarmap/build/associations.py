"""Build the OB association dataset.

The simplest build in this pipeline, and deliberately so: Quintana et al. publish
their positions in heliocentric galactic Cartesian parsecs, which is the frame
this project stores and the frame the renderer draws in. There is no coordinate
transformation between the paper and the screen, and so no place for one to go
wrong. What this step does is read the table, check the frame against the
distance the paper also gives, and write it out.

The one judgement here is what an association's *extent* means. It is not a
radius, because these things are not spheres — Ori OB1b is 35 pc across in X and
23 in Z, and drawing it round would make a chain look like a ball. It is not an
edge either: an OB association is unbound and dissolving, and has no boundary
anywhere. What the catalogue gives is the intrinsic dispersion along each axis,
so what the map draws is a one-sigma ellipsoid — a contour through a
distribution, with rather more of the association outside it than a reader used
to cluster radii would expect. The layer draws it as a broken outline for that
reason, and the panel says so in words.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from oastarmap.build.clusters import read_tsv
from oastarmap.build.writer import write_array, write_json
from oastarmap.fetch.associations import QUINTANA_2026
from oastarmap.fetch.base import sha256
from oastarmap.paths import DATA_OUT_DIR
from oastarmap.transform.frame import GALACTIC_AXES, STORAGE_UNIT

GEOMETRY_FILE = "associations.bin"
NAMES_FILE = "associations.names.json"

#: Components per association in the geometry array.
GEOMETRY = ["x", "y", "z", "sigma_x", "sigma_y", "sigma_z", "distance"]

#: How far the position may disagree with the direction and distance the same
#: row states, before the row is refused.
#:
#: The catalogue writes each association's place twice — as Cartesian x, y, z and
#: as l, b and a distance — so the two must describe the same point. Checking
#: costs nothing and is the only guard available against the axis convention
#: being something other than what the column names say: a transposed Y and Z
#: would lift Orion out of the galactic plane and look, on screen, merely
#: surprising.
#:
#: The tolerances are loose because every one of these numbers is a *median
#: taken per column*, and the median of a set of distances is not the length of
#: the vector of median coordinates. For a group as extended as Cep OB6 —
#: 34 pc of spread at 207 pc — that alone accounts for four per cent. Across the
#: catalogue the radii agree to 0.27 per cent and the directions to a few tenths
#: of a degree; a genuinely wrong axis would be out by tens of degrees, which
#: either of these catches with room to spare.
FRAME_TOLERANCE_DEG = 3.0
FRAME_TOLERANCE_FRACTION = 0.08


@dataclass
class AssociationStats:
    total_rows: int = 0
    accepted: int = 0
    excluded: Counter[str] = field(default_factory=Counter)
    """Reasons, counted. Nothing is dropped silently."""

    def as_dict(self) -> dict[str, Any]:
        return {
            "total_rows": self.total_rows,
            "accepted": self.accepted,
            "excluded": dict(self.excluded),
        }


@dataclass
class Association:
    name: str
    alt_name: str
    members: int
    x: float
    y: float
    z: float
    sigma_x: float
    sigma_y: float
    sigma_z: float
    distance: float
    glon: float
    glat: float
    age_max_myr: float | None
    mass_sol: float | None
    o_stars: float | None
    b_stars: float | None
    extinction_av: float | None


def _number(cell: str) -> float | None:
    """A VizieR cell as a number, or None where it is blank or a dash."""
    text = cell.strip()
    if not text or text == "-":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _text(cell: str) -> str:
    """A VizieR cell as text. A lone dash means the column has no value."""
    text = cell.strip()
    return "" if text == "-" else text


def _check_frame(
    name: str, x: float, y: float, z: float, distance: float, glon: float, glat: float
) -> None:
    """Refuse a row whose Cartesian position is not where its own l, b, d put it.

    See FRAME_TOLERANCE_DEG. The direction is the telling half: a swapped pair of
    axes moves an association tens of degrees across the sky and barely changes
    its distance from Sol, so a radius check alone would pass one happily.
    """
    radius = math.sqrt(x * x + y * y + z * z)
    if radius <= 0:
        raise ValueError(f"{name}: position is the origin, which is where Sol is")

    if abs(radius - distance) > FRAME_TOLERANCE_FRACTION * distance:
        raise ValueError(
            f"{name}: |xyz| is {radius:.1f} pc but the catalogue states "
            f"d = {distance:.1f} pc. The axis convention is not what the column "
            f"names say, and nothing here should be drawn until it is."
        )

    longitude = math.degrees(math.atan2(y, x)) % 360.0
    latitude = math.degrees(math.asin(max(-1.0, min(1.0, z / radius))))
    # Longitude differences shrink toward the poles, so weight by cos(b) before
    # combining them; otherwise a high-latitude group fails on a rounding error.
    delta_l = abs((longitude - glon + 180.0) % 360.0 - 180.0) * math.cos(math.radians(glat))
    separation = math.hypot(delta_l, latitude - glat)
    if separation > FRAME_TOLERANCE_DEG:
        raise ValueError(
            f"{name}: x, y, z point at l={longitude:.2f} b={latitude:.2f}, but the "
            f"catalogue states l={glon:.2f} b={glat:.2f} — {separation:.1f} degrees "
            f"apart. The axes are not the ones the column names claim."
        )


def read_associations(path: Path, stats: AssociationStats) -> list[Association]:
    header, rows = read_tsv(path)
    ix = {name: i for i, name in enumerate(header)}

    required = ("Name", "X", "Y", "Z", "s_X", "s_Y", "s_Z", "d")
    missing = [column for column in required if column not in ix]
    if missing:
        raise ValueError(f"{path} is missing columns {missing}; got {header}")

    def cell(row: list[str], column: str) -> str:
        at = ix.get(column)
        return row[at] if at is not None and at < len(row) else ""

    out: list[Association] = []
    for row in rows:
        stats.total_rows += 1
        name = _text(cell(row, "Name"))
        if not name:
            stats.excluded["no name"] += 1
            continue

        position = [_number(cell(row, column)) for column in ("X", "Y", "Z")]
        spread = [_number(cell(row, column)) for column in ("s_X", "s_Y", "s_Z")]
        distance = _number(cell(row, "d"))
        if any(value is None for value in (*position, *spread)) or distance is None:
            stats.excluded["incomplete position"] += 1
            continue

        x, y, z = (float(value) for value in position)  # type: ignore[arg-type]
        glon = _number(cell(row, "GLON")) or 0.0
        glat = _number(cell(row, "GLAT")) or 0.0
        # The frame check described above. A row that fails it is not dropped
        # quietly; it would mean the catalogue's own columns disagree, which is
        # a reason to stop rather than to draw 55 of 56.
        _check_frame(name, x, y, z, distance, glon, glat)

        out.append(
            Association(
                name=name,
                alt_name=_text(cell(row, "AName")),
                members=int(_number(cell(row, "N")) or 0),
                x=x,
                y=y,
                z=z,
                sigma_x=float(spread[0]),  # type: ignore[arg-type]
                sigma_y=float(spread[1]),  # type: ignore[arg-type]
                sigma_z=float(spread[2]),  # type: ignore[arg-type]
                distance=distance,
                glon=glon,
                glat=glat,
                age_max_myr=_number(cell(row, "Agemax")),
                mass_sol=_number(cell(row, "Mtot")),
                o_stars=_number(cell(row, "NO")),
                b_stars=_number(cell(row, "NB")),
                extinction_av=_number(cell(row, "AV")),
            )
        )
        stats.accepted += 1

    # Nearest first, which is the order the catalogue itself is in and the order
    # a reader scanning the panel wants.
    out.sort(key=lambda entry: entry.distance)
    return out


def build_associations(
    out_dir: Path | None = None, source_path: Path | None = None
) -> dict[str, Any] | None:
    """Write the OB association dataset. None when the catalogue is not fetched."""
    out_dir = out_dir or DATA_OUT_DIR
    source_path = source_path or QUINTANA_2026.path
    if not source_path.exists():
        return None

    stats = AssociationStats()
    associations = read_associations(source_path, stats)
    count = len(associations)

    geometry = np.zeros((count, len(GEOMETRY)), dtype=np.float32)
    for at, entry in enumerate(associations):
        geometry[at] = (
            entry.x,
            entry.y,
            entry.z,
            entry.sigma_x,
            entry.sigma_y,
            entry.sigma_z,
            entry.distance,
        )

    files = {
        "geometry": write_array(out_dir / GEOMETRY_FILE, geometry),
        "names": write_json(
            out_dir / NAMES_FILE,
            [
                {
                    "name": entry.name,
                    "alt_name": entry.alt_name,
                    "members": entry.members,
                    "glon": round(entry.glon, 3),
                    "glat": round(entry.glat, 3),
                    "age_max_myr": entry.age_max_myr,
                    "mass_sol": entry.mass_sol,
                    "o_stars": entry.o_stars,
                    "b_stars": entry.b_stars,
                    "extinction_av": entry.extinction_av,
                }
                for entry in associations
            ],
        ),
    }

    return {
        "count": count,
        "frame": {
            "name": "galactic-cartesian-heliocentric",
            "unit": str(STORAGE_UNIT),
            "axes": GALACTIC_AXES,
            "origin": "Sol",
        },
        "layout": {
            "geometry": {
                "components": GEOMETRY,
                "units": [str(STORAGE_UNIT)] * len(GEOMETRY),
                "note": (
                    "x, y, z are the catalogue's own median heliocentric galactic "
                    "Cartesian position — the same frame this map stores, copied "
                    "rather than converted. sigma_* are the intrinsic dispersions "
                    "along each axis, checked against the stated distance."
                ),
            },
            "extent": {
                "kind": "ellipsoid",
                "sigma": 1.0,
                "note": (
                    "Drawn as a one-sigma ellipsoid, not a radius and not an edge. "
                    "An OB association is unbound and has no boundary; the outline "
                    "is a contour through a distribution, with much of the "
                    "association outside it. It is broken rather than solid for "
                    "that reason."
                ),
            },
            "names": {"note": "Parallel array, one entry per association, same order."},
        },
        "files": files,
        "selection": {
            "rule": "the catalogue entire; no cut of this project's own",
            "note": (
                "Every association Quintana et al. publish is drawn. Their census "
                "reaches 1 kpc and no further, so this layer stops there because "
                "the catalogue does, not because the associations do — Cyg OB2, "
                "Car OB1 and the rest of the arm are real and simply absent."
            ),
        },
        "stats": stats.as_dict(),
        "source": {
            "description": QUINTANA_2026.description,
            "citation": QUINTANA_2026.citation,
            "url": QUINTANA_2026.url,
            "sha256": sha256(source_path),
        },
    }


def format_report(fragment: dict[str, Any] | None) -> str:
    if fragment is None:
        return "  assoc      skipped — run `oastarmap fetch`"
    total = sum(entry["bytes"] for entry in fragment["files"].values())
    return (
        f"  assoc      {fragment['count']} OB associations  ({total / 1e3:.1f} kB)\n"
        f"             within 1 kpc, the census's own limit — not the sky's"
    )
