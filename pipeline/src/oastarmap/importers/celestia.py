"""Import Orion's Arm stars from the project's Celestia add-on.

Runs by hand, not as part of the build: it reads ``sources/OAAddons1.zip`` and
writes ``fiction/oa_stars.yaml``, which is tracked. The build then reads only
that file.

The earlier arrangement re-parsed the archive on every build, following the
pattern used for ``raw/``. That pattern relies on the source being reproducible
on demand, which is true of a VizieR query and not of a hand-downloaded 2008
archive: a clean clone could not build this layer at all, and there was nowhere
to correct the extraction by hand. Importing once and committing the result
fixes both, and makes any future re-import show up as a reviewable diff.
"""

from __future__ import annotations

import math
import re
import zipfile
from pathlib import Path
from typing import Any

# `[Modify] [catalogue-number] "Name"  # optional comment`
_HEADER = re.compile(
    r"^[ \t]*(?:(?:Modify|Replace|Add|Barycenter)\s+)?(\d+)?[ \t]*\"([^\"]+)\"[ \t]*(?:#(.*))?$",
    re.M,
)
_FIELD = re.compile(r"^\s*(RA|Dec|Distance|SpectralType|AbsMag)\s+(\S+)", re.M)
_COMMENT = re.compile(r"#(.*)$", re.M)

_SYSTEM_FOR = re.compile(r"\bstars?\s+for\s+(?:the\s+)?(?:system\s+containing\s+)?(.+)$", re.I)
"""What the add-on's comments say a star is *for*.

The designations are opaque — "JD 836901" names nothing — but the comments
attached to them are not: "G3 star for Wurm" means this star is the sun of Wurm,
and Wurm is what the system is known for.
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


def parse_stc(text: str, source_file: str = "") -> list[dict[str, Any]]:
    """Pull star records out of one Celestia ``.stc`` file.

    Deliberately tolerant. These files are hand-maintained: fields appear in any
    order, indentation is inconsistent, and a comment may sit on the header line
    or inside the braces. Only RA, Dec and Distance actually matter.
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

        body = text[opening:closing]
        fields = {key: value.strip('"') for key, value in _FIELD.findall(body)}

        # Comments sit on the header line for some entries and inside the braces
        # for others — the To'ul'h home system is annotated on its RA line, and
        # reading only the header lost it along with four other named systems and
        # the 52 notes marking the NGC 6633 population.
        comments = [(header.group(3) or "").strip()]
        comments += [c.strip() for c in _COMMENT.findall(body)]
        seen: list[str] = []
        for comment in comments:
            if comment and comment not in seen:
                seen.append(comment)

        records.append(
            {
                "catalogue_number": header.group(1) or "",
                "name": header.group(2).strip(),
                "comment": "; ".join(seen),
                "source_file": source_file,
                **fields,
            }
        )
    return records


def _to_float(value: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.nan


def read_archive(archive_path: Path) -> list[dict[str, Any]]:
    """Every usable star across the archive's ``.stc`` files, in a stable order."""
    records: list[dict[str, Any]] = []
    with zipfile.ZipFile(archive_path) as archive:
        for entry in sorted(archive.namelist()):
            if not entry.lower().endswith(".stc"):
                continue
            text = archive.read(entry).decode("utf-8", errors="replace")
            records.extend(parse_stc(text, Path(entry).name))

    usable: list[dict[str, Any]] = []
    for record in records:
        ra, dec = _to_float(record.get("RA", "")), _to_float(record.get("Dec", ""))
        distance = _to_float(record.get("Distance", ""))
        if not record["name"] or not (math.isfinite(ra) and math.isfinite(dec)):
            continue
        if not math.isfinite(distance) or distance <= 0:
            continue

        abs_mag = _to_float(record.get("AbsMag", ""))
        usable.append(
            {
                "name": record["name"],
                "ra_deg": ra,
                "dec_deg": dec,
                # Celestia's .stc declares Distance in light years, not parsecs.
                "distance_ly": distance,
                "spectral_type": record.get("SpectralType", ""),
                "abs_mag": abs_mag if math.isfinite(abs_mag) else None,
                "system": system_name(record["comment"]),
                "comment": record["comment"],
                "source_file": record["source_file"],
            }
        )

    usable.sort(key=lambda r: (r["name"], r["source_file"]))
    return usable


HEADER = """\
# Orion's Arm stars, imported from the project's Celestia add-on.
#
#   Source:  Orion's Arm Celestia add-on (OAAddons1)
#   Archive: http://www.orionsarm.com/fm_store/OAAddons1.zip
#   Page:    https://www.orionsarm.com/xcms.php?r=oa-page&page=gen_OACelestia2
#   Terms:   https://www.orionsarm.com/Terms_Copyright_and_Submissions.html
#
# These are stars the setting asserts but the sky does not have: the suns of
# named OA systems, and the populations OA gives to real clusters. Their
# positions come from the fiction, not from an observation.
#
# `distance_ly` is light years, as Celestia's .stc format declares. It is named
# for its unit because reading it as parsecs would move every star 3.26x further
# out while still looking plausible.
#
# `system` is what the add-on's comment says the star is for, and is the name the
# map labels it with. It is extracted from `comment` on import, and may be
# corrected by hand where the source knows a system by a name its comment does
# not use.
#
# Regenerate with `uv run oastarmap import-oastars`, which rewrites this file
# from the archive. Re-importing discards hand edits, so review the diff.
"""


def write_yaml(stars: list[dict[str, Any]], dest: Path) -> int:
    """Write the imported stars as YAML, with provenance in the file itself.

    Hand-rolled rather than ``yaml.dump`` so the header comments survive and the
    field order stays stable — the file is meant to be read and diffed.
    """

    def scalar(value: Any) -> str:
        if value is None:
            return "null"
        if isinstance(value, float):
            # repr() is the shortest string that round-trips back to the same
            # float, so parsing "290.6596" and writing it here gives "290.6596".
            # A %g format loses digits: it turned that into 290.66.
            return repr(value)
        text = str(value)
        return '""' if not text else "'" + text.replace("'", "''") + "'"

    lines = [HEADER, "stars:"]
    for star in stars:
        lines.append(f"  - name: {scalar(star['name'])}")
        for field in (
            "ra_deg",
            "dec_deg",
            "distance_ly",
            "spectral_type",
            "abs_mag",
            "system",
            "comment",
            "source_file",
        ):
            lines.append(f"    {field}: {scalar(star[field])}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(stars)


def import_oastars(archive_path: Path, dest: Path) -> int:
    """Read the archive and write the tracked star file. Returns the count."""
    return write_yaml(read_archive(archive_path), dest)
