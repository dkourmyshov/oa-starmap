"""Schema for hand-authored Orion's Arm data.

Validation is deliberately strict about structure and deliberately lenient about
whether a landmark currently resolves. A malformed file is an authoring error and
should fail immediately; an unresolved landmark usually just means the catalog
containing it has not been added yet, and blocking the build on that would make
the fictional layer un-startable until every catalog exists.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class Polity(BaseModel):
    """A meta-empire and the real landmarks associated with it."""

    id: str
    name: str
    color: str
    landmarks: list[str] = Field(default_factory=list)
    uncertain: bool = False

    @field_validator("id")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", value):
            raise ValueError(f"polity id must be kebab-case, got {value!r}")
        return value

    @field_validator("color")
    @classmethod
    def _hex(cls, value: str) -> str:
        if not HEX_COLOR.match(value):
            raise ValueError(f"color must be #rrggbb, got {value!r}")
        return value

    @field_validator("landmarks")
    @classmethod
    def _non_empty_names(cls, value: list[str]) -> list[str]:
        for name in value:
            if not name.strip():
                raise ValueError("landmark names must not be blank")
        return value


class FictionFile(BaseModel):
    """The top level of ``fiction/polities.yaml``."""

    polities: list[Polity]
    notes: dict[str, str] = Field(default_factory=dict)

    confirmed_placements: list[str] = Field(default_factory=list)
    """Landmarks whose surprising position has been checked against the source.

    The placement check is a proofreading aid for transcription errors, not a
    model of polity shape, and it has no standing against the fiction. Naming a
    landmark here settles the matter permanently: the check stops reporting it,
    and it stays reported nowhere. Without this, a confirmed-correct landmark
    would be re-flagged on every build forever, which is how a report becomes
    noise and then becomes ignored.
    """

    @field_validator("polities")
    @classmethod
    def _unique_ids(cls, value: list[Polity]) -> list[Polity]:
        seen: set[str] = set()
        for polity in value:
            if polity.id in seen:
                raise ValueError(f"duplicate polity id {polity.id!r}")
            seen.add(polity.id)
        return value

    @classmethod
    def load(cls, path: Path) -> FictionFile:
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must contain a mapping at the top level")
        return cls.model_validate(raw)


class AliasFile(BaseModel):
    """The top level of ``fiction/aliases.yaml``."""

    aliases: dict[str, str] = Field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> AliasFile:
        if not path.exists():
            return cls()
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must contain a mapping at the top level")
        return cls.model_validate(raw)
