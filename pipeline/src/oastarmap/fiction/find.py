"""Find a place by name across every index that holds one.

The setting's places are spread over five hand-authored files and a star
catalogue, and which one a given place lives in is an accident of where it was
first written down. Searching only ``worlds.yaml`` — the obvious file, and the
largest — has twice produced a confident "not on the map" for something that was
on the map: Panthalassa, which is an add-on system, and Tianguan, which is a
polity landmark resolving to a catalogue star.

So the lookup is one function over all of them, and there is no partial version
of it to reach for by mistake.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

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


def _load(path: Path) -> Any:
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


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


def find(needle: str, fiction_dir: Path | None = None, data_dir: Path | None = None) -> list[Hit]:
    """Every place whose name, alias or label contains ``needle``.

    Case-insensitive and substring-based, because the point is to find things
    whose exact spelling is what you do not know.
    """
    fiction_dir = fiction_dir or FICTION_DIR
    data_dir = data_dir or DATA_OUT_DIR
    hits: list[Hit] = []

    worlds = _load(fiction_dir / "worlds.yaml") or {}
    for world in worlds.get("worlds", []):
        if _matches(needle, world.get("name"), world.get("also"), world.get("system")):
            loc = world.get("location") or {}
            where = ", ".join(f"{k}={v}" for k, v in loc.items() if k != "estimated") or "unplaced"
            held = ",".join(world.get("affiliations") or []) or "independent"
            hits.append(
                Hit(world["name"], "worlds.yaml", f"{world.get('kind', '?')}, {held}; {where}",
                    world)
            )

    systems = _load(fiction_dir / "oa_systems.yaml") or {}
    for entry in systems.get("systems", []):
        if _matches(needle, entry.get("label"), entry.get("star")):
            hits.append(
                Hit(entry.get("label") or entry["star"], "oa_systems.yaml",
                    f"star={entry.get('star')}, {entry.get('affiliation') or 'independent'}"
                    + (", hidden" if entry.get("hidden") else ""), entry)
            )

    stars = _load(fiction_dir / "oa_stars.yaml") or {}
    for entry in stars.get("stars", []):
        if _matches(needle, entry.get("name"), entry.get("system"), entry.get("comment")):
            hits.append(
                Hit(entry.get("system") or entry["name"], "oa_stars.yaml",
                    f"{entry['name']}, {entry.get('distance_ly', '?')} ly", entry)
            )

    inner = _load(fiction_dir / "inner_sphere.yaml") or {}
    for entry in inner.get("systems", []):
        if _matches(needle, entry.get("colony"), entry.get("star"), entry.get("system")):
            hits.append(
                Hit(entry.get("colony") or entry.get("star") or "?", "inner_sphere.yaml",
                    f"star={entry.get('star')}", entry)
            )

    polities = _load(fiction_dir / "polities.yaml") or {}
    for entry in polities.get("polities", []):
        for landmark in entry.get("landmarks", []) or []:
            if _matches(needle, landmark):
                hits.append(
                    Hit(landmark, "polities.yaml", f"landmark of {entry['name']}", entry)
                )

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

    # The built star catalogue, which is where a landmark's real object lives —
    # and the reason Tianguan could not be found by grepping fiction/ at all.
    names = data_dir / "stars.names.json"
    if names.exists():
        with names.open(encoding="utf-8") as handle:
            catalogue = json.load(handle)
        for index, entry in catalogue.items():
            if _matches(needle, *entry.values()):
                shown = ", ".join(f"{k}={v}" for k, v in entry.items())
                hits.append(Hit(shown, "stars catalogue", f"index {index}", entry))

    return hits
