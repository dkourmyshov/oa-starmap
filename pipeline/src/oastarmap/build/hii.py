"""Build the HII region dataset.

Sharpless gives every region a designation, a position and an angular diameter.
Russeil gives its parent star-forming complex a distance. Together those are
enough to place a region in space *and* give it a physical size, which is what
makes it volumetric rather than a point.

Two things are worth stating plainly, because both are judgement calls that shape
what the map asserts:

**The distance belongs to the complex, not the region.** Russeil measured
complexes; a region inherits its complex's distance because that is what physical
association means. The uncertainty band is carried through unchanged and the
method is recorded per region, so nothing here claims more precision than the
source does.

**Stellar distances are preferred over kinematic ones.** A kinematic distance
converts a radial velocity into a distance by assuming galactic rotation. Toward
l~0 and l~180 the rotation curve is nearly perpendicular to the line of sight, so
the conversion is ill-conditioned and small velocity errors explode. It places
S27 — the zeta Ophiuchi region, some 200 pc away — at 21.6 kpc, and S232 at
24.7 kpc. Where Russeil also lists a stellar (photometric) distance, that is used
instead and the region is flagged accordingly.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import astropy.units as u
import numpy as np

from oastarmap.build.clusters import read_tsv
from oastarmap.build.writer import write_array, write_json
from oastarmap.fetch.base import sha256
from oastarmap.fetch.hii import (
    RUSSEIL_2003_COMPLEXES,
    RUSSEIL_2003_MEMBERS,
    SHARPLESS_1959,
)
from oastarmap.paths import DATA_OUT_DIR
from oastarmap.transform.frame import (
    GALACTIC_AXES,
    MAX_PLAUSIBLE_DISTANCE_PC,
    STORAGE_UNIT,
    galactic_lb_to_xyz,
)

DISTANCE_METHODS = ["stellar", "kinematic"]
"""Index 0 is preferred. See the module docstring for why the order matters."""

METHOD_INDEX = {name: i for i, name in enumerate(DISTANCE_METHODS)}

# Russeil names each complex by its own galactic coordinates, "GLON+GLAT" to one
# decimal, which is exactly how the member table refers back to it.
_COMPLEX_NAME = re.compile(r"^(\d+\.\d+)([+-]\d+\.\d+)$")

# Sharpless numbers appear as "S27", "Sh27", "Sh2-27" depending on the source.
_SHARPLESS = re.compile(r"[Ss](?:h2?[-_]?)?(\d+)$")

_SPLIT = re.compile(r"[,;/ ]+")


@dataclass
class HiiRecord:
    number: int
    x: float
    y: float
    z: float
    radius: float
    distance: float
    distance_lo: float
    distance_hi: float
    method_index: int
    complex_name: str
    diameter_arcmin: float
    brightness: str
    form: str
    structure: str

    @property
    def name(self) -> str:
        return f"S{self.number}"


@dataclass
class HiiStats:
    total_rows: int = 0
    accepted: int = 0
    excluded: Counter = field(default_factory=Counter)
    methods: Counter = field(default_factory=Counter)

    def as_dict(self) -> dict[str, Any]:
        return {
            "total_rows": self.total_rows,
            "accepted": self.accepted,
            "excluded": dict(sorted(self.excluded.items())),
            "methods": dict(sorted(self.methods.items())),
        }


def _to_float(value: str) -> float:
    value = value.strip()
    if not value:
        return math.nan
    try:
        return float(value)
    except ValueError:
        return math.nan


def _indexed(path: Path) -> tuple[dict[str, int], list[list[str]]]:
    header, rows = read_tsv(path)
    return {name: i for i, name in enumerate(header)}, rows


def _cell(row: list[str], ix: dict[str, int], column: str) -> str:
    i = ix.get(column, -1)
    return row[i].strip() if 0 <= i < len(row) else ""


@dataclass
class Complex:
    """One Russeil star-forming complex, reduced to a single best distance."""

    name: str
    distance_pc: float
    lo_pc: float
    hi_pc: float
    method: str


def read_complexes(path: Path) -> dict[tuple[float, float], Complex]:
    """Key complexes by their published galactic coordinates, as table 1 names them."""
    ix, rows = _indexed(path)
    for required in ("GLON", "GLAT"):
        if required not in ix:
            raise ValueError(f"Russeil complex table is missing {required!r}; got {list(ix)}")

    out: dict[tuple[float, float], Complex] = {}
    for row in rows:
        lon = _to_float(_cell(row, ix, "GLON"))
        lat = _to_float(_cell(row, ix, "GLAT"))
        if not (math.isfinite(lon) and math.isfinite(lat)):
            continue

        stellar = _to_float(_cell(row, ix, "DistSt"))
        kinematic = _to_float(_cell(row, ix, "Dist"))

        if math.isfinite(stellar) and stellar > 0:
            error = _to_float(_cell(row, ix, "e_DistSt"))
            error = abs(error) if math.isfinite(error) else 0.0
            distance, lo, hi, method = stellar, stellar - error, stellar + error, "stellar"
        elif math.isfinite(kinematic) and kinematic > 0:
            # Published asymmetrically, and the lower bound can run past zero where
            # the kinematic solution is degenerate. Clamped rather than dropped:
            # the distance is still the catalogue's best value, just badly bounded.
            plus = _to_float(_cell(row, ix, "err+D"))
            minus = _to_float(_cell(row, ix, "err-D"))
            plus = abs(plus) if math.isfinite(plus) else 0.0
            minus = abs(minus) if math.isfinite(minus) else 0.0
            distance = kinematic
            lo, hi, method = kinematic - minus, kinematic + plus, "kinematic"
        else:
            continue

        key = (round(lon, 1), round(lat, 1))
        name = f"{lon:.1f}{lat:+.1f}"
        # A duplicated key would silently shadow one complex with another; keeping
        # the first is only safe because the coordinates are the identifier.
        out.setdefault(
            key,
            Complex(
                name=name,
                distance_pc=distance * 1000.0,
                lo_pc=max(lo, 0.0) * 1000.0,
                hi_pc=hi * 1000.0,
                method=method,
            ),
        )
    return out


def read_membership(path: Path) -> dict[int, tuple[float, float]]:
    """Map each Sharpless number onto the complex that contains it."""
    ix, rows = _indexed(path)
    if "Name" not in ix:
        raise ValueError(f"Russeil member table is missing 'Name'; got {list(ix)}")

    out: dict[int, tuple[float, float]] = {}
    for row in rows:
        matched = _COMPLEX_NAME.match(_cell(row, ix, "Name"))
        if not matched:
            continue
        key = (round(float(matched.group(1)), 1), round(float(matched.group(2)), 1))
        blob = " ".join(_cell(row, ix, column) for column in ("HaName", "CONames"))
        for token in _SPLIT.split(blob):
            found = _SHARPLESS.fullmatch(token)
            if found:
                out.setdefault(int(found.group(1)), key)
    return out


def read_regions(
    sharpless_path: Path,
    members_path: Path,
    complexes_path: Path,
    stats: HiiStats,
) -> list[HiiRecord]:
    complexes = read_complexes(complexes_path)
    membership = read_membership(members_path)

    ix, rows = _indexed(sharpless_path)
    for required in ("Sh2", "GLon", "GLat", "Diam"):
        if required not in ix:
            raise ValueError(f"Sharpless table is missing {required!r}; got {list(ix)}")

    kept: list[tuple[int, list[str], Complex]] = []
    for row in rows:
        stats.total_rows += 1

        number_text = _cell(row, ix, "Sh2")
        if not number_text.isdigit():
            stats.excluded["no_designation"] += 1
            continue
        number = int(number_text)

        key = membership.get(number)
        if key is None:
            stats.excluded["no_parent_complex"] += 1
            continue
        parent = complexes.get(key)
        if parent is None:
            stats.excluded["complex_has_no_distance"] += 1
            continue
        if parent.distance_pc > MAX_PLAUSIBLE_DISTANCE_PC:
            stats.excluded["implausible_distance"] += 1
            continue

        diameter = _to_float(_cell(row, ix, "Diam"))
        if not math.isfinite(diameter) or diameter <= 0:
            stats.excluded["no_angular_size"] += 1
            continue
        if not math.isfinite(_to_float(_cell(row, ix, "GLon"))) or not math.isfinite(
            _to_float(_cell(row, ix, "GLat"))
        ):
            stats.excluded["no_position"] += 1
            continue

        kept.append((number, row, parent))

    if not kept:
        raise ValueError(f"No usable HII regions parsed from {sharpless_path}")

    kept.sort(key=lambda item: item[0])

    lon = np.array([_to_float(_cell(r, ix, "GLon")) for _, r, _ in kept]) * u.deg
    lat = np.array([_to_float(_cell(r, ix, "GLat")) for _, r, _ in kept]) * u.deg
    dist = np.array([c.distance_pc for _, _, c in kept]) * u.pc

    x, y, z = galactic_lb_to_xyz(lon, lat, dist)
    xs = x.to_value(STORAGE_UNIT)
    ys = y.to_value(STORAGE_UNIT)
    zs = z.to_value(STORAGE_UNIT)

    records: list[HiiRecord] = []
    for i, (number, row, parent) in enumerate(kept):
        diameter = _to_float(_cell(row, ix, "Diam"))
        # Angular diameter in arcmin to a physical radius. Small-angle is not safe
        # here: S245 spans 12 degrees, so the tangent is taken properly.
        half_angle = (diameter / 2.0) * (math.pi / 180.0 / 60.0)
        radius = parent.distance_pc * math.tan(half_angle)

        stats.methods[parent.method] += 1
        records.append(
            HiiRecord(
                number=number,
                x=float(xs[i]),
                y=float(ys[i]),
                z=float(zs[i]),
                radius=radius,
                distance=parent.distance_pc,
                distance_lo=parent.lo_pc,
                distance_hi=parent.hi_pc,
                method_index=METHOD_INDEX[parent.method],
                complex_name=parent.name,
                diameter_arcmin=diameter,
                brightness=_cell(row, ix, "Bright"),
                form=_cell(row, ix, "Form"),
                structure=_cell(row, ix, "Struct"),
            )
        )

    stats.accepted = len(records)
    return records


def build_hii(
    sharpless_path: Path | None = None,
    members_path: Path | None = None,
    complexes_path: Path | None = None,
    out_dir: Path | None = None,
) -> dict[str, Any]:
    """Build the HII region dataset and return its manifest entry."""
    sharpless_path = sharpless_path or SHARPLESS_1959.path
    members_path = members_path or RUSSEIL_2003_MEMBERS.path
    complexes_path = complexes_path or RUSSEIL_2003_COMPLEXES.path
    out_dir = out_dir or DATA_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    stats = HiiStats()
    records = read_regions(sharpless_path, members_path, complexes_path, stats)
    n = len(records)

    geometry = np.empty((n, 7), dtype=np.float32)
    meta = np.empty((n, 2), dtype=np.int32)
    names: list[dict[str, str | float]] = []

    for i, rec in enumerate(records):
        geometry[i] = (
            rec.x,
            rec.y,
            rec.z,
            rec.radius,
            rec.distance,
            rec.distance_lo,
            rec.distance_hi,
        )
        meta[i] = (rec.method_index, rec.number)
        names.append(
            {
                "name": rec.name,
                # The Sh2- form is what SIMBAD and most modern papers use.
                "aliases": f"Sh2-{rec.number},Sh 2-{rec.number}",
                "complex": rec.complex_name,
                "diameter_arcmin": rec.diameter_arcmin,
                "brightness": rec.brightness,
                "form": rec.form,
                "structure": rec.structure,
            }
        )

    files = {
        "geometry": write_array(out_dir / "hii.bin", geometry),
        "meta": write_array(out_dir / "hii.meta.bin", meta),
        "names": write_json(out_dir / "hii.names.json", names),
    }

    return {
        "count": n,
        "frame": {
            "name": "galactic-cartesian-heliocentric",
            "unit": str(STORAGE_UNIT),
            "axes": GALACTIC_AXES,
            "origin": "Sol",
        },
        "layout": {
            "geometry": {
                "components": [
                    "x",
                    "y",
                    "z",
                    "radius",
                    "distance",
                    "distance_lo",
                    "distance_hi",
                ],
                "units": [str(STORAGE_UNIT)] * 7,
                "note": (
                    "radius is the physical radius implied by the Sharpless angular "
                    "diameter at the adopted distance. distance_lo/hi are Russeil's "
                    "own uncertainty bounds on the parent complex, clamped at zero."
                ),
            },
            "meta": {"components": ["method_index", "sharpless_number"]},
            "methods": {
                "order": DISTANCE_METHODS,
                "note": (
                    "How the parent complex's distance was determined. Kinematic "
                    "distances are ill-conditioned toward l~0 and l~180 and should "
                    "be read as far less certain than stellar ones."
                ),
            },
            "names": {"note": "Parallel array, one entry per region, same order."},
        },
        "files": files,
        "selection": {
            "rule": "complete Sharpless catalogue; no distance cutoff",
            "note": (
                "A region is excluded only when it cannot be placed: no parent "
                "complex in Russeil (2003), no distance for that complex, or no "
                "angular diameter. Distances are inherited from the parent complex, "
                "preferring stellar over kinematic determinations."
            ),
        },
        "stats": stats.as_dict(),
        "source": {
            "description": (
                f"{SHARPLESS_1959.description} Distances joined from "
                f"{RUSSEIL_2003_COMPLEXES.description}"
            ),
            "citation": f"{SHARPLESS_1959.citation} {RUSSEIL_2003_COMPLEXES.citation}",
            "url": SHARPLESS_1959.url,
            "sha256": sha256(sharpless_path),
        },
    }
