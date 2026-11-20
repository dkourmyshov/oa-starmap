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

from oastarmap.fiction.schema import InnerSphereSystem, InnerSphereWormhole
from oastarmap.fiction.store import OAUPStore

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


def import_inner_sphere(page_path: Path, dest: Path) -> dict[str, int]:
    """Update table claims in the graph, preserving assignments and old evidence."""
    text = page_path.read_text(encoding="utf-8", errors="replace")
    parsed = parse(text)
    store = OAUPStore.load(dest)
    counts = store.replace_inner_sphere(
        [InnerSphereSystem.model_validate(row) for row in parsed["systems"]],
        [InnerSphereWormhole.model_validate(row) for row in parsed["wormholes"]],
    )
    store.validate()
    store.save()
    return counts
