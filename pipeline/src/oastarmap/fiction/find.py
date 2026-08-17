"""Find a place by name across every index that holds one.

Built on :mod:`oastarmap.fiction.places`, which is the union of every file, so
this command and any analysis written against that module see the same places.
An earlier version of this file assembled its own union and was correct; the
lesson was that having *two* assemblies is how they drift, not that one of them
was wrong.

Two things live here and not there: the built star catalogue, which is where a
landmark's real object is, and the resolved landmark bindings, which join a
landmark's authored name to the catalogue name it matched. Neither is a
hand-authored place, and both are needed to answer "is X on the map?" — Tianguan
is Zeta Tauri, and grepping fiction/ for "Tianguan" finds nothing at all.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from oastarmap.fiction.places import Place, all_places
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR


@dataclass
class Hit:
    """One place, and which index it came from."""

    name: str
    source: str
    detail: str = ""
    fields: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        tail = f"  {self.detail}" if self.detail else ""
        return f"{self.name}  [{self.source}]{tail}"


def _matches(needle: str, *values: object) -> bool:
    lowered = needle.casefold()
    for value in values:
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            if any(lowered in str(item).casefold() for item in value):
                return True
        elif lowered in str(value).casefold():
            return True
    return False


def _describe(place: Place) -> str:
    record = place.record
    if place.source == "worlds.yaml":
        loc = record.get("location") or {}
        where = ", ".join(f"{k}={v}" for k, v in loc.items() if k != "estimated") or "unplaced"
        held = ",".join(record.get("affiliations") or []) or "independent"
        return f"{record.get('kind', '?')}, {held}; {where}"
    if place.source == "oa_systems.yaml":
        held = record.get("affiliation") or "independent"
        hidden = ", hidden" if record.get("hidden") else ""
        return f"star={record.get('star')}, {held}{hidden}"
    if place.source == "oa_stars.yaml":
        return f"{record.get('name')}, {record.get('distance_ly', '?')} ly"
    if place.source == "inner_sphere.yaml":
        return f"star={record.get('star')}, {record.get('distance_ly', '?')} ly"
    if place.source == "polities.yaml":
        return f"landmark of {record.get('polity')}"
    return ""


def find(needle: str, fiction_dir: Path | None = None, data_dir: Path | None = None) -> list[Hit]:
    """Every place whose name, alias or label contains ``needle``.

    Case-insensitive and substring-based, because the point is to find things
    whose exact spelling is what you do not know.
    """
    fiction_dir = fiction_dir or FICTION_DIR
    data_dir = data_dir or DATA_OUT_DIR

    hits = [
        Hit(place.name, place.source, _describe(place), place.record)
        for place in all_places(fiction_dir)
        if _matches(needle, *place.names)
    ]

    # Resolved landmark bindings. A landmark is authored under one name and
    # matched under another — Zeta Tauri in polities.yaml, Tianguan in the
    # catalogue — so searching either file alone finds one half of the pair and
    # not the fact that they are the same object.
    built = data_dir / "fiction.json"
    if built.exists():
        with built.open(encoding="utf-8") as handle:
            payload = json.load(handle)
        for binding in payload.get("bindings", []):
            if _matches(needle, binding.get("landmark"), binding.get("matched_name")):
                held = ",".join(binding.get("polities") or []) or "unheld"
                matched = binding.get("matched_name")
                via = f" as {matched}" if matched and matched != binding.get("landmark") else ""
                hits.append(
                    Hit(binding["landmark"], "landmark binding",
                        f"{held}; {binding.get('kind') or 'unresolved'}{via}", binding)
                )

    names = data_dir / "stars.names.json"
    if names.exists():
        with names.open(encoding="utf-8") as handle:
            catalogue = json.load(handle)
        for index, entry in catalogue.items():
            if _matches(needle, *entry.values()):
                shown = ", ".join(f"{k}={v}" for k, v in entry.items())
                hits.append(Hit(shown, "stars catalogue", f"index {index}", entry))

    return hits
