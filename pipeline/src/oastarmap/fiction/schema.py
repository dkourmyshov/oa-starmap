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
from pydantic import BaseModel, Field, field_validator, model_validator

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

POLITY_KINDS = frozenset({"meta-empire", "polity", "xenosophont"})


class Source(BaseModel):
    """Where a piece of fictional data was read from.

    Recorded because the fiction is not uniform in kind. A political map drawn
    for one epoch, a table of colony names and a Celestia add-on say different
    things with different authority, and a reader who cannot tell which is which
    cannot judge any of it.
    """

    title: str
    url: str
    page: str = ""
    epoch_at: int | None = None
    """Setting year the source depicts, in years After Tranquility, where it says."""
    note: str = ""

    @field_validator("url")
    @classmethod
    def _http(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError(f"source url must be absolute, got {value!r}")
        return value


class Polity(BaseModel):
    """A meta-empire and the real landmarks associated with it."""

    id: str
    name: str
    color: str
    landmarks: list[str] = Field(default_factory=list)
    uncertain: bool = False
    source: str = ""
    """Key into :attr:`FictionFile.sources` for where these landmarks came from."""

    kind: str = "meta-empire"
    """What this entry actually is.

    Most are meta-empires. Some are smaller polities, and at least one is not a
    political body at all: the Muuh are a xenosophont species, and whether they
    organise into anything answering to a terragen empire is unsettled. Recording
    that as a meta-empire would assert a structure the setting does not.
    """

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, value: str) -> str:
        if value not in POLITY_KINDS:
            raise ValueError(f"kind must be one of {sorted(POLITY_KINDS)}, got {value!r}")
        return value

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
    sources: dict[str, Source] = Field(default_factory=dict)
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

    @model_validator(mode="after")
    def _sources_exist(self) -> FictionFile:
        """A dangling source key means provenance was lost, so it fails the build.

        Unlike an unresolved landmark, this cannot come right on its own later:
        nothing downstream will ever supply the missing entry.
        """
        for polity in self.polities:
            if polity.source and polity.source not in self.sources:
                raise ValueError(
                    f"polity {polity.id!r} cites unknown source {polity.source!r}; "
                    f"known sources: {sorted(self.sources)}"
                )
        return self

    @classmethod
    def load(cls, path: Path) -> FictionFile:
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must contain a mapping at the top level")
        return cls.model_validate(raw)


class OAStarEntry(BaseModel):
    """One star from the Orion's Arm Celestia add-on.

    Field names carry their units, because the one way to get this dataset badly
    wrong is to read ``distance_ly`` as parsecs.
    """

    name: str
    ra_deg: float
    dec_deg: float
    distance_ly: float
    spectral_type: str = ""
    abs_mag: float | None = None
    system: str = ""
    comment: str = ""
    source_file: str = ""

    @field_validator("distance_ly")
    @classmethod
    def _positive(cls, value: float) -> float:
        if value <= 0:
            raise ValueError(f"distance_ly must be positive, got {value}")
        return value


class OAStarFile(BaseModel):
    """The top level of ``fiction/oa_stars.yaml``."""

    stars: list[OAStarEntry] = Field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> OAStarFile:
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must contain a mapping at the top level")
        return cls.model_validate(raw)


class OASystem(BaseModel):
    """Hand-authored curation of one imported Orion's Arm star."""

    star: str
    """The add-on's own designation, matching a ``name`` in ``oa_stars.yaml``."""

    label: str = ""
    """What to call it on the map.

    Not derivable from the import. The add-on's comments name whichever of the
    system, its primary or its inhabitants the contributor thought of — JD 870135
    is commented "To'ul'h", which is the species, not the system.
    """

    affiliation: str = ""
    """Key into the polities list, or empty where the affiliation is unsettled."""

    uncertain: bool = False
    article: str = ""
    note: str = ""

    @field_validator("article")
    @classmethod
    def _http(cls, value: str) -> str:
        if value and not value.startswith(("http://", "https://")):
            raise ValueError(f"article must be an absolute URL, got {value!r}")
        return value


class OASystemFile(BaseModel):
    """The top level of ``fiction/oa_systems.yaml``."""

    systems: list[OASystem] = Field(default_factory=list)

    hide_comment_matching: list[str] = Field(default_factory=list)
    """Substrings marking entries the add-on says nothing about beyond location.

    Matched against the imported comment. A rule rather than a list of names
    because the list would be 52 designations long and would have to be
    regenerated by hand after every re-import.
    """

    @model_validator(mode="after")
    def _unique_stars(self) -> OASystemFile:
        seen: set[str] = set()
        for system in self.systems:
            if system.star in seen:
                raise ValueError(f"duplicate curation for star {system.star!r}")
            seen.add(system.star)
        return self

    @classmethod
    def load(cls, path: Path) -> OASystemFile:
        if not path.exists():
            return cls()
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
