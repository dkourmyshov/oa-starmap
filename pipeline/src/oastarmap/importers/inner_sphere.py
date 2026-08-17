"""Import the Inner Sphere tables from the Encyclopaedia Galactica page.

Two tables, both keyed on a real star name:

* **Systems** — 0 to 100 ly, giving each star's Orion's Arm colony name along
  with spectral type, mass and luminosity.
* **Wormholes** — the links of the nexus, by sector, with gauge and notes.

Like the Celestia import, this runs by hand and writes a tracked file. The saved
HTML is 380 KB of markup around ~1,400 rows of data; re-scraping it on every
build would make the build depend on a page that is not in the repository.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

_ROW = re.compile(r"<tr.*?</tr>", re.S | re.I)
_CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S | re.I)
_TAG = re.compile(r"<[^>]+>")
_HREF = re.compile(r"""href\s*=\s*["']([^"']*(?:eg-article|eg-topic)/[0-9a-f]+)""", re.I)

WORMHOLE_HEADING = "The Wormhole Nexus"
"""Splits the page: system tables above, nexus tables below."""

SOURCE_URL = "https://www.orionsarm.com/eg-topic/45bcbcab90032"
SOURCE_TITLE = "The Stars of the Inner Sphere"


def _cells(row: str) -> list[str]:
    return [
        html.unescape(re.sub(r"\s+", " ", _TAG.sub("", cell))).strip()
        for cell in _CELL.findall(row)
    ]


def _cell_links(row: str) -> list[str]:
    """The Encyclopaedia article each cell links to, or "" where it links none.

    The colony-name cell is a hyperlink for 390 of the 1,431 rows, and the first
    version of this importer threw those away with the rest of the markup —
    which left the colony table the one file with no article URLs at all, and so
    the one file that could not be matched to the article corpus by anything but
    its names.
    """
    out = []
    for cell in _CELL.findall(row):
        found = _HREF.search(cell)
        out.append(
            f"https://www.orionsarm.com/{found.group(1).lstrip('/')}" if found else ""
        )
    return out


def _rows(fragment: str) -> list[list[str]]:
    return [_cells(row) for row in _ROW.findall(fragment)]


def parse(text: str) -> dict[str, list[dict[str, Any]]]:
    """Pull both tables out of the saved page."""
    split = text.find(WORMHOLE_HEADING)
    if split < 0:
        raise ValueError(f"{WORMHOLE_HEADING!r} not found; is this the right page?")

    systems: list[dict[str, Any]] = []
    for raw in _ROW.findall(text[:split]):
        row = _cells(raw)
        # Header rows repeat per distance shell, and carry the same width.
        if len(row) != 6 or row[0] in ("Star", ""):
            continue
        links = _cell_links(raw)
        # The colony cell carries the link; a few rows link from the star
        # instead, so anything in the row is better than nothing.
        article = next((u for u in ([links[2]] if len(links) > 2 else []) + links if u), "")
        systems.append(
            {
                "star": row[0],
                "distance_ly": row[1],
                "colony": row[2],
                "article": article,
                "spectral_type": row[3],
                "mass_sol": row[4],
                "luminosity_sol": row[5],
            }
        )

    wormholes: list[dict[str, Any]] = []
    for row in _rows(text[split:]):
        if len(row) != 6 or row[0] in ("Star", ""):
            continue
        wormholes.append(
            {
                "star": row[0],
                "system": row[1],
                "wormhole": row[2],
                "gauge_m": row[3],
                "nearby_unconnected": row[4],
                "notes": row[5],
            }
        )

    return {"systems": systems, "wormholes": wormholes}


HEADER = """\
# The Inner Sphere, imported from the Encyclopaedia Galactica.
#
#   Source: The Stars of the Inner Sphere
#   Page:   https://www.orionsarm.com/eg-topic/45bcbcab90032
#   Terms:  https://www.orionsarm.com/Terms_Copyright_and_Submissions.html
#
# `systems` gives every star within 100 light years its Orion's Arm colony name.
# `star` is the real designation and is resolved against the star catalogue at
# build time; `distance_ly` is the source's own figure and is used to check that
# the resolution landed on the right star rather than a plausible wrong one.
#
# `wormholes` is the nexus table: which systems are linked, the gauge of the
# link, and which nearby stars are notably *not* connected.
#
# Regenerate with `uv run oastarmap import-inner-sphere`, which rewrites this
# file from the saved page. Re-importing discards hand edits, so review the diff.
"""


def _scalar(value: Any) -> str:
    text = str(value)
    return '""' if not text else "'" + text.replace("'", "''") + "'"


def write_yaml(parsed: dict[str, list[dict[str, Any]]], dest: Path) -> dict[str, int]:
    """Write both tables as YAML, with provenance in the file itself."""
    lines = [HEADER, "systems:"]
    for entry in parsed["systems"]:
        lines.append(f"  - star: {_scalar(entry['star'])}")
        for field in ("distance_ly", "colony", "article", "spectral_type", "mass_sol",
                      "luminosity_sol"):
            lines.append(f"    {field}: {_scalar(entry[field])}")

    lines.append("")
    lines.append("wormholes:")
    for entry in parsed["wormholes"]:
        lines.append(f"  - star: {_scalar(entry['star'])}")
        for field in ("system", "wormhole", "gauge_m", "nearby_unconnected", "notes"):
            lines.append(f"    {field}: {_scalar(entry[field])}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"systems": len(parsed["systems"]), "wormholes": len(parsed["wormholes"])}


def import_inner_sphere(page_path: Path, dest: Path) -> dict[str, int]:
    """Read the saved page and write the tracked file. Returns row counts."""
    text = page_path.read_text(encoding="utf-8", errors="replace")
    return write_yaml(parse(text), dest)
