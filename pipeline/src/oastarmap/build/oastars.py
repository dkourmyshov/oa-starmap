"""Orion's Arm stars, from the project's own Celestia add-on.

These are the stars the setting asserts but the sky does not have: the suns of
named OA systems, and the populations OA gives to real clusters. They cannot be
bound to a real catalogue the way landmarks are, because there is nothing to bind
to — so unlike every other dataset here, their positions come from the fiction
rather than from an observation.

That makes them the one place where the map draws something unmeasured, so they
are kept in their own dataset, rendered differently, and separately toggleable.

**Trap:** Celestia's ``.stc`` format gives ``Distance`` in **light years**, not
parsecs. Reading it as parsecs would push everything out by 3.26x while still
looking superficially plausible. The check that settles it: 52 of these entries
sit toward NGC 6633 with distances of 1222-1236, and NGC 6633 is at 389.5 pc
(1270 ly). Read as light years they land at 375-379 pc, inside the cluster's
22.5 pc radius. Read as parsecs they would sit three times beyond it.
"""

from __future__ import annotations

import math
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import astropy.units as u
import numpy as np

from oastarmap.build.writer import CI_UNKNOWN, write_array, write_json
from oastarmap.fetch.base import sha256
from oastarmap.paths import DATA_OUT_DIR, SOURCES_DIR
from oastarmap.transform.frame import (
    GALACTIC_AXES,
    MAX_PLAUSIBLE_DISTANCE_PC,
    STORAGE_UNIT,
    icrs_to_galactic_xyz,
)
from oastarmap.transform.photometry import parse_spectral_class, spectral_type_to_bv

ARCHIVE_NAME = "OAAddons1.zip"

SOURCE_URL = "http://www.orionsarm.com/fm_store/OAAddons1.zip"
SOURCE_PAGE = "https://www.orionsarm.com/xcms.php?r=oa-page&page=gen_OACelestia2"
SOURCE_TITLE = "Orion's Arm Celestia add-on (OAAddons1)"

LIGHT_YEAR = u.lyr
"""The unit of the ``Distance`` field. See the module docstring."""

# `[Modify] [catalogue-number] "Name"  # optional comment`
_HEADER = re.compile(
    r"^[ \t]*(?:(?:Modify|Replace|Add|Barycenter)\s+)?(\d+)?[ \t]*\"([^\"]+)\"[ \t]*(?:#(.*))?$",
    re.M,
)
_FIELD = re.compile(r"^\s*(RA|Dec|Distance|SpectralType|AbsMag)\s+(\S+)", re.M)

_SYSTEM_FOR = re.compile(r"\bstars?\s+for\s+(?:the\s+)?(?:system\s+containing\s+)?(.+)$", re.I)
"""What the add-on's comments say a star is *for*.

The designations are opaque — "JD 836901" names nothing — but the comments
attached to them are not: "G3 star for Wurm" means this star is the sun of Wurm,
and Wurm is what the system is known for. Where a comment says so, that name is
carried through and used as the label, because it is the only human-meaningful
identifier the source offers.
"""


def system_name(comment: str) -> str:
    """The system a star is the sun of, from its comment, or an empty string.

    Only the "star for X" phrasing is read. Comments like "Star in cluster
    NGC 6633" or "Brown Dwarf in the Stellar Umma Region" describe where the star
    is rather than what it serves, and naming a star after its cluster would put
    fifty identical labels on the map.
    """
    matched = _SYSTEM_FOR.search(comment or "")
    return matched.group(1).strip() if matched else ""


_OA_DESIGNATION = re.compile(r"^\s*(JD|YTS)\b", re.I)
"""Orion's Arm's own numbering for stars it invented.

Only the positive case is asserted. The absence of a JD or YTS prefix says the
entry is *named or externally designated* — it does not say the object is real.
An earlier version of this flag ran the test the other way round, matching real
catalogue prefixes, and duly reported Geminga and Arkab Prior B as not real when
both are real objects the add-on supplies because Celestia's catalogue omits
them. Which entries correspond to real objects is a question for a cross-match,
not for a regex over names.
"""


@dataclass
class OAStar:
    name: str
    comment: str
    x: float
    y: float
    z: float
    abs_mag: float
    color_index: float
    spectral_type: str
    spectral_class: int
    distance: float
    oa_designation: bool
    system: str
    source_file: str


@dataclass
class OAStarStats:
    total_entries: int = 0
    accepted: int = 0
    excluded: Counter = field(default_factory=Counter)
    spectral: Counter = field(default_factory=Counter)
    files: Counter = field(default_factory=Counter)
    name_collisions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "total_entries": self.total_entries,
            "accepted": self.accepted,
            "excluded": dict(sorted(self.excluded.items())),
            "spectral_types": dict(sorted(self.spectral.items())),
            "files": dict(sorted(self.files.items())),
            "name_collisions": self.name_collisions,
        }


def _to_float(value: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.nan


def parse_stc(text: str, source_file: str = "") -> list[dict[str, Any]]:
    """Pull star records out of one Celestia ``.stc`` file.

    Deliberately tolerant. These files are hand-maintained: fields appear in any
    order, indentation is inconsistent, and a comment can follow the name on the
    header line. Only the presence of RA, Dec and Distance actually matters.
    """
    # Reading out of the zip gives raw bytes, so CRLF survives decoding and the
    # trailing \r defeats `$` on every header line. Normalise first.
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    records: list[dict[str, Any]] = []
    for header in _HEADER.finditer(text):
        opening = text.find("{", header.end())
        if opening < 0:
            continue
        closing = text.find("}", opening)
        if closing < 0:
            continue

        fields = {key: value.strip('"') for key, value in _FIELD.findall(text[opening:closing])}
        records.append(
            {
                "catalogue_number": header.group(1) or "",
                "name": header.group(2).strip(),
                "comment": (header.group(3) or "").strip(),
                "source_file": source_file,
                **fields,
            }
        )
    return records


def read_archive(archive_path: Path, stats: OAStarStats) -> list[OAStar]:
    """Read every ``.stc`` in the add-on archive and place its stars."""
    records: list[dict[str, Any]] = []
    with zipfile.ZipFile(archive_path) as archive:
        for entry in sorted(archive.namelist()):
            if not entry.lower().endswith(".stc"):
                continue
            text = archive.read(entry).decode("utf-8", errors="replace")
            found = parse_stc(text, Path(entry).name)
            stats.files[Path(entry).name] = len(found)
            records.extend(found)

    kept: list[dict[str, Any]] = []
    for record in records:
        stats.total_entries += 1

        if not record["name"]:
            stats.excluded["no_name"] += 1
            continue
        ra, dec = _to_float(record.get("RA", "")), _to_float(record.get("Dec", ""))
        distance_ly = _to_float(record.get("Distance", ""))
        if not (math.isfinite(ra) and math.isfinite(dec)):
            stats.excluded["no_position"] += 1
            continue
        if not math.isfinite(distance_ly) or distance_ly <= 0:
            stats.excluded["no_distance"] += 1
            continue
        if (distance_ly * u.lyr).to_value(u.pc) > MAX_PLAUSIBLE_DISTANCE_PC:
            stats.excluded["implausible_distance"] += 1
            continue
        kept.append(record)

    if not kept:
        raise ValueError(f"No usable stars parsed from {archive_path}")

    # Deterministic ordering, independent of archive iteration order.
    kept.sort(key=lambda r: (r["name"], r["source_file"]))

    ra = np.array([_to_float(r["RA"]) for r in kept]) * u.deg
    dec = np.array([_to_float(r["Dec"]) for r in kept]) * u.deg
    distance = np.array([_to_float(r["Distance"]) for r in kept]) * LIGHT_YEAR

    x, y, z = icrs_to_galactic_xyz(ra, dec, distance)
    xs = x.to_value(STORAGE_UNIT)
    ys = y.to_value(STORAGE_UNIT)
    zs = z.to_value(STORAGE_UNIT)
    distance_pc = distance.to_value(STORAGE_UNIT)

    stars: list[OAStar] = []
    for i, record in enumerate(kept):
        spectral = record.get("SpectralType", "")
        bv = spectral_type_to_bv(spectral)
        abs_mag = _to_float(record.get("AbsMag", ""))
        if not math.isfinite(abs_mag):
            # Without a magnitude the renderer cannot decide whether to draw it,
            # so give it a sun-like value rather than dropping a real assertion.
            abs_mag = 4.8
            stats.excluded["absmag_defaulted"] += 1

        stats.spectral[spectral or "(none)"] += 1
        stars.append(
            OAStar(
                name=record["name"],
                comment=record["comment"],
                x=float(xs[i]),
                y=float(ys[i]),
                z=float(zs[i]),
                abs_mag=abs_mag,
                color_index=bv if math.isfinite(bv) else float(CI_UNKNOWN),
                spectral_type=spectral,
                spectral_class=parse_spectral_class(spectral),
                distance=float(distance_pc[i]),
                oa_designation=bool(_OA_DESIGNATION.match(record["name"])),
                system=system_name(record["comment"]),
                source_file=record["source_file"],
            )
        )

    # The add-on reuses "JD 518791" across two files for two different stars,
    # 617 pc and 157 pc away on opposite sides of the plane. Both are kept —
    # dropping either would discard a position the source asserts — but the
    # collision is recorded so a duplicate label is explained rather than a bug.
    seen = Counter(star.name for star in stars)
    stats.name_collisions = sorted(name for name, n in seen.items() if n > 1)

    stats.accepted = len(stars)
    return stars


def build_oastars(archive_path: Path | None = None, out_dir: Path | None = None) -> dict[str, Any]:
    """Build the Orion's Arm star dataset, or return ``None`` if unavailable."""
    archive_path = archive_path or SOURCES_DIR / ARCHIVE_NAME
    out_dir = out_dir or DATA_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    stats = OAStarStats()
    stars = read_archive(archive_path, stats)
    n = len(stars)

    # Same five-component layout as the real star dataset, so the renderer can
    # reuse the magnitude and colour path unchanged.
    positions = np.empty((n, 5), dtype=np.float32)
    names: list[dict[str, Any]] = []

    for i, star in enumerate(stars):
        positions[i] = (star.x, star.y, star.z, star.abs_mag, star.color_index)
        names.append(
            {
                "name": star.name,
                "comment": star.comment,
                "spectral_type": star.spectral_type,
                "distance_pc": round(star.distance, 3),
                "oa_designation": star.oa_designation,
                "system": star.system,
                "source_file": star.source_file,
            }
        )

    files = {
        "positions": write_array(out_dir / "oastars.bin", positions),
        "names": write_json(out_dir / "oastars.names.json", names),
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
            "positions": {
                "components": ["x", "y", "z", "absmag", "ci"],
                "units": [str(STORAGE_UNIT)] * 3 + ["mag", "B-V"],
                "ci_unknown_sentinel": float(CI_UNKNOWN),
                "note": (
                    "Identical layout to the real star dataset. B-V is derived from "
                    "the spectral type rather than measured, so colour here is an "
                    "approximation of an assertion."
                ),
            },
            "names": {"note": "Parallel array, one entry per star, same order."},
        },
        "files": files,
        "selection": {
            "rule": "every star in the add-on with a usable position",
            "note": (
                "Positions are asserted by the fiction, not observed. Not every "
                "entry is invented: Geminga, Arkab Prior B, EG 471 and two HD "
                "numbers are real objects the add-on supplies because Celestia's "
                "own catalogue omits them. The oa_designation flag marks only the "
                "entries using OA's own JD/YTS numbering, which are certainly "
                "invented; its absence is not a claim that an object is real. "
                "None of the 103 matches anything in the real star dataset."
            ),
        },
        "stats": stats.as_dict(),
        "source": {
            "description": (
                "Stars from the Orion's Arm Celestia add-on: the suns of named OA "
                "systems, plus populations the setting gives to real clusters."
            ),
            "citation": f"{SOURCE_TITLE}. {SOURCE_PAGE}",
            "url": SOURCE_URL,
            "sha256": sha256(archive_path),
            "distance_unit": "light years, as Celestia .stc declares",
        },
    }
