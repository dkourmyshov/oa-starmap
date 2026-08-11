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

import astropy.units as u
import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

from oastarmap.fiction.resolve import fold_diacritics

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

    never_adjacent: list[list[str]] = Field(default_factory=list)
    """Polity pairs the setting keeps apart, whatever our sample of them shows.

    Colour separation only matters between polities that can be seen together,
    and how close two are is measured from the objects recorded here — which is
    a poor guide for a polity with one world. This names the cases known from
    the setting instead, so a thin sample cannot silently excuse a collision.
    """

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

    real: str = ""
    """The real object this entry is, where it is one — a catalogue designation.

    Most add-on entries are stars the setting invented, and their positions are
    assertions. A few are real objects the add-on carries only because Celestia's
    own catalogue omits them, and there the position is a copied measurement, not
    a claim. The map draws the two differently, so the distinction cannot be
    guessed from the name: an earlier flag tried a regex over designations and
    duly reported Geminga and Arkab Prior B as invented. Set by hand, and only
    where the identification is known.
    """

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


class InnerSphereSystem(BaseModel):
    """One row of the Inner Sphere star table."""

    star: str
    """Real designation, resolved against the star catalogue at build time."""

    distance_ly: str = ""
    """The source's own figure, kept as text because some rows are not numeric.

    Used to check that name resolution landed on the right star: a wrong match on
    a plausible name almost always lands at the wrong distance.
    """

    colony: str = ""
    spectral_type: str = ""
    mass_sol: str = ""
    luminosity_sol: str = ""


class InnerSphereWormhole(BaseModel):
    """One row of the wormhole nexus table."""

    star: str
    system: str = ""
    wormhole: str = ""
    gauge_m: str = ""
    nearby_unconnected: str = ""
    notes: str = ""


class InnerSphereFile(BaseModel):
    """The top level of ``fiction/inner_sphere.yaml``."""

    systems: list[InnerSphereSystem] = Field(default_factory=list)
    wormholes: list[InnerSphereWormhole] = Field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> InnerSphereFile:
        if not path.exists():
            return cls()
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must contain a mapping at the top level")
        return cls.model_validate(raw)


COLONY_STATUSES = frozenset({"", "special", "abandoned", "blight"})


class ColonyAssignment(BaseModel):
    """One Inner Sphere colony and what it belongs to."""

    colony: str
    """Matched against the colony column of ``inner_sphere.yaml``."""

    affiliations: list[str] = Field(default_factory=list)
    """Polity ids. More than one is a genuine shared presence, not a mistake."""

    also: list[str] = Field(default_factory=list)
    """Spellings the Inner Sphere table uses for the same colony.

    `colony` holds the name as the source article gives it; where the table
    disagrees, the difference is recorded here rather than by silently adopting
    the table's spelling. The astronomer is Guo Shoujing, so "Guo-Shuo Jing" is
    the table's error and "Guo-Shou Jing" stays the name.
    """

    status: str = ""
    """What is not an affiliation: special, abandoned or blight."""

    note: str = ""

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str) -> str:
        if value not in COLONY_STATUSES:
            raise ValueError(f"status must be one of {sorted(COLONY_STATUSES)}, got {value!r}")
        return value


class ColonyFile(BaseModel):
    """The top level of ``fiction/colonies.yaml``."""

    colonies: list[ColonyAssignment] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> ColonyFile:
        seen: set[str] = set()
        for entry in self.colonies:
            if entry.colony in seen:
                raise ValueError(f"duplicate colony assignment {entry.colony!r}")
            seen.add(entry.colony)
        return self

    @classmethod
    def load(cls, path: Path) -> ColonyFile:
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


class Constellation(BaseModel):
    """One row of the generated constellation table."""

    name: str
    source_name: str = ""
    """astropy's spelling, where it differs from the IAU's. See CORRECTIONS."""
    abbreviation: str
    ra_deg: float
    dec_deg: float
    radius_deg: float
    """Half-angle of the cone about the centre containing the whole figure."""
    area_sq_deg: float

    centroid_inside: bool = True
    """Whether the centre of area lies within the figure.

    False for Serpens, whose two halves sit either side of Ophiuchus, putting its
    centre of area in Hercules. A world located only by such a constellation
    cannot be placed by centroid at all.
    """


class ConstellationFile(BaseModel):
    """The top level of ``fiction/constellations.yaml``."""

    constellations: list[Constellation] = Field(default_factory=list)

    def by_name(self) -> dict[str, Constellation]:
        """Keyed by name, abbreviation and astropy's spelling, all folded.

        Accents are folded too, so "Bootes" finds Boötes. An author writing a
        constellation should not have to know which of several spellings this
        project happens to store.
        """
        table: dict[str, Constellation] = {}
        for entry in self.constellations:
            for key in (entry.name, entry.abbreviation, entry.source_name):
                if not key:
                    continue
                # Both spellings, so a caller that does not fold its own lookup
                # key still finds Boötes.
                table[key.casefold()] = entry
                table[fold_diacritics(key).casefold()] = entry
        return table

    @classmethod
    def load(cls, path: Path) -> ConstellationFile:
        if not path.exists():
            return cls()
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must contain a mapping at the top level")
        return cls.model_validate(raw)


DISTANCE = re.compile(r"^\s*([-+]?\d+(?:\.\d+)?)\s*(ly|lyr|pc|kpc)\s*$", re.I)
_DISTANCE_UNITS = {"ly": u.lyr, "lyr": u.lyr, "pc": u.pc, "kpc": u.kpc}


def parse_distance(value: str) -> u.Quantity:
    """Parse a distance literal, which must carry its unit.

    The unit is mandatory rather than defaulted because this project mixes the
    two conventions by design: Orion's Arm quotes light years, astronomy quotes
    parsecs, and the two differ by a factor of 3.26 — large enough to be wrong
    and small enough to look plausible. A bare number would let an author's
    assumption pass silently into a coordinate.
    """
    match = DISTANCE.match(value)
    if not match:
        raise ValueError(
            f"distance must be a number with a unit, e.g. '805 ly' or '250 pc'; got {value!r}"
        )
    return float(match.group(1)) * _DISTANCE_UNITS[match.group(2).lower()]


class WorldLocation(BaseModel):
    """How a world's position is known — and how precisely, per axis.

    Orion's Arm locates places the way an observer would, and the resulting
    positions are not uniform in quality. A world given as "805 ly, Canis Major"
    has an exact radius and a direction good to fourteen degrees; one bound to a
    catalogue star is exact in all three. Recording *which* is what lets the map
    draw the difference rather than flattening both into a dot.

    Exactly one of the four methods must be given, or none at all for a place the
    setting describes without locating.
    """

    hip: int | None = None
    hd: int | None = None
    star: str = ""
    """A real star, by Hipparcos number, HD number, or catalogue name.

    A bare number is not accepted on its own. Catalogue numbers are a dense,
    unstructured identifier space — almost any six digits in range name a real
    star — so a wrong one does not fail to resolve. It lands on a real star and
    draws an ordinary dot, and nothing downstream can tell. Oikoumene spent a
    batch at 1,019 ly because HD 175869 is 64 Serpentis and the system meant was
    Zeta Serpentis at 75; the number had been invented rather than read from
    anywhere, and its resolving was taken as evidence it was right.

    So a number must be accompanied by something with independent content:
    ``star`` (the name, which the resolver must agree with), ``distance`` (which
    the build checks), or ``catalogue_from_source`` where the article itself
    gives the number and there is nothing to cross-check it against. The
    constellation is deliberately not enough — Zeta and 64 Serpentis are both in
    Serpens, as are Mu and Kappa Capricorni in Capricornus.
    """

    catalogue_from_source: bool = False
    """The source states this catalogue number itself, rather than a name.

    The one honest case for a bare number: there is no name to resolve and no
    distance given, so the number is the source's own claim and stands or falls
    with it. Declaring it says the number was copied rather than produced.
    """

    oa_star: str = ""
    """An entry of ``oa_stars.yaml``, by the add-on's own designation."""

    world: str = ""
    """Another world in this file, by name, whose position this one shares.

    For something inside a system the map places from coordinates rather than
    from a catalogue star: Potato is an asteroid habitat in the Bonfire System,
    and repeating Bonfire's coordinates would put two markers on one point and
    let them drift apart the day one of them is corrected. Where the system is a
    catalogue star, use that star instead — two worlds on one star already group
    themselves.
    """

    ra_deg: float | None = None
    dec_deg: float | None = None
    """An exact direction, with ``distance`` supplying the radius."""

    constellation: str = ""
    """A region of sky.

    With ``distance`` it places the world. Without one it still records the
    direction, which is worth keeping even though nothing can be drawn from it:
    a constellation alone is a cone from Sol, not a point. Orion's Arm's
    "sectors" are these — the Centaurus sector is the volume behind the
    constellation as seen from Earth — so several places are known to be
    somewhere down a particular line and no further.
    """

    distance: str = ""
    """Distance from Sol, with its unit: '805 ly'.

    Required by the direction and constellation methods, where it supplies the
    radius. Optional but strongly wanted on a ``star`` binding, where it is a
    *check* rather than a position: the build compares it against the catalogue
    and fails if the two disagree. That check exists because a wrong catalogue
    number resolves to a real star and looks entirely correct — Oikoumene was
    bound to HD 175869, which is 64 Serpentis at 1,019 ly, when the intended
    star was Zeta Serpentis at 75. Nothing about the resulting dot said so.
    """

    near: str = ""
    """What the direction was taken from, for the record. Not resolved."""

    distance_conflict: bool = False
    """The stated distance and the catalogue's genuinely disagree, and we know.

    Set only where the identifier is unambiguous and the distance is the thing
    in doubt, and only alongside an entry in questions.md saying so. Naming the
    case here settles it permanently: the build stops failing on this one world
    and keeps failing on every other, which is what a check is for. Without it
    the only way past a known conflict is to weaken the check for everything.
    """

    note: str = ""

    @property
    def method(self) -> str:
        if self.hip is not None or self.hd is not None or self.star:
            return "star"
        if self.oa_star:
            return "oa_star"
        if self.world:
            return "world"
        if self.ra_deg is not None and self.dec_deg is not None:
            return "direction"
        # A constellation without a distance is a direction and nothing more, so
        # it cannot place anything; the constellation is still recorded.
        if self.constellation and self.distance:
            return "constellation"
        return "none"

    @model_validator(mode="after")
    def _one_method(self) -> WorldLocation:
        number = self.hip is not None or self.hd is not None
        if number and not (self.star or self.distance or self.catalogue_from_source):
            raise ValueError(
                "a catalogue number needs a name, a distance, or "
                "catalogue_from_source: a wrong number resolves to a real star"
            )

        given = [
            bool(self.hip is not None or self.hd is not None or self.star),
            bool(self.oa_star),
            bool(self.world),
            bool(self.ra_deg is not None or self.dec_deg is not None),
            bool(self.constellation),
        ]
        if sum(given) > 1:
            raise ValueError("give only one of star / oa_star / world / ra+dec / constellation")
        if (self.ra_deg is None) != (self.dec_deg is None):
            raise ValueError("ra_deg and dec_deg must be given together")
        if self.method == "direction" and not self.distance:
            raise ValueError("a direction location needs a distance")
        if self.distance and self.method not in {"direction", "constellation", "star"}:
            raise ValueError(f"a {self.method} location takes no distance")
        if self.distance:
            parse_distance(self.distance)
        return self


EVENT_KINDS = frozenset(
    {
        "observed",
        "visited",
        "settled",
        "contact",
        "capital",
        "stewardship",
        "transferred",
        "reported",
        "abandoned",
    }
)
"""What a dated event in a world's history is.

Deliberately few, and deliberately not a full historical vocabulary. Two of
these carry the weight — ``visited`` and ``settled`` — because those are what a
map of the sphere at a given year is drawn from: a location appears once
somebody has been there, and reads as inhabited once somebody has stayed. The
rest exist because collapsing them into those two would lose the distinction the
sources actually draw. Duxed was colonised in 1813 and acquired its Caretaker in
2917, and a model with one date per place would have to discard one of them.

- ``observed``     seen from a distance and not reached. Rangar was observed in
                   3702 and has no establishment date at all, so calling that a
                   visit would put people there who never went.
- ``visited``      somebody went, or a probe did. Nobody stayed.
- ``settled``      a colony was established.
- ``contact``      first contact with a resident xenosophont species.
- ``capital``      became the seat of a polity. The Seat of Judgement in 2465,
                   Gillbank later — a dated fact about a place that is neither
                   its settlement nor a change of owner.
- ``stewardship``  a Caretaker God took the system under protection.
- ``transferred``  the system changed hands between polities.
- ``reported``     the date the setting *records*, where the event itself is
                   known to be earlier. Stanislaw's discovery is reported in
                   9920 and had plainly happened before that.
- ``abandoned``    the colony ended.
"""


EVENT_PRECISIONS = frozenset({"exact", "circa", "not_later_than", "not_earlier_than", "between"})
"""How well a dated event's year is known.

- ``exact``            the year as the source gives it.
- ``circa``            "around 3000". A rough figure the source itself hedges.
- ``not_later_than``   "before 1644". An upper bound; the event is earlier.
- ``not_earlier_than`` a lower bound, the mirror of the above.
- ``between``          somewhere in ``year_at``..``until_at``.
"""


class WorldEvent(BaseModel):
    """One dated thing that happened at a world.

    Years are After Tranquility, the setting's own epoch, counted from the 1969
    Moon landing. Stored as given rather than converted to CE: the sources quote
    AT throughout, and a stored conversion would be a second thing to keep right
    for no gain.
    """

    year_at: int
    kind: str
    note: str = ""

    until_at: int | None = None
    """The second year, where there is one. What it means depends on `precision`.

    With ``exact`` it is the end of something that took time: Cyberia's takeover
    of Fata Morgana ran from 4496 to 4530, an infiltration rather than an event.
    With ``between`` it is the far end of an uncertainty range instead — Mu
    Capricorni was colonised somewhere in 1500 to 2100, which is not a
    six-hundred-year colonisation.
    """

    precision: str = "exact"
    """How well the year is known. See :data:`EVENT_PRECISIONS`.

    The sources hedge in several distinct ways and flattening them all to a bare
    year would let a guess filter as though it were a date. Barawatten was
    settled "before 1644", Aleph Absolute "around 3000", Mu Capricorni "within
    1500 to 2100" — three different claims, and only one of them is a date.
    """

    @model_validator(mode="after")
    def _span_runs_forwards(self) -> WorldEvent:
        if self.until_at is not None and self.until_at < self.year_at:
            raise ValueError(f"until_at {self.until_at} precedes year_at {self.year_at}")
        if self.precision == "between" and self.until_at is None:
            raise ValueError("a 'between' event needs until_at for the far end of the range")
        return self

    @field_validator("precision")
    @classmethod
    def _known_precision(cls, value: str) -> str:
        if value not in EVENT_PRECISIONS:
            raise ValueError(
                f"precision must be one of {sorted(EVENT_PRECISIONS)}, got {value!r}"
            )
        return value

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, value: str) -> str:
        if value not in EVENT_KINDS:
            raise ValueError(f"event kind must be one of {sorted(EVENT_KINDS)}, got {value!r}")
        return value


class World(BaseModel):
    """A canonical Orion's Arm place, and where the setting puts it."""

    name: str
    kind: str = "planet"
    """planet, moon, system, megastructure, volume — descriptive, not structural."""

    system: str = ""
    """The system it is in, where that has a name of its own."""

    parent: str = ""
    """The body this one orbits directly, where the setting names it separately.

    A star for a planet, a gas giant for a moon. Named `parent` rather than
    `primary` because it is not always the star: Duxed and Macrystis are moons,
    and what they orbit is Pacol and Lontis.
    """

    also: list[str] = Field(default_factory=list)
    """Other names the setting uses for the same place."""

    affiliations: list[str] = Field(default_factory=list)
    """Polity ids. More than one is a genuine shared presence, not indecision.

    A list because the setting has them: Errai is held jointly by the Communion
    of Worlds and the Sophic League, and recording one of the two would be a
    quiet choice about which partner counts. Always the *present* holders,
    whatever the events say happened on the way there.
    """

    uncertain: bool = False

    extent: str = ""
    """Diameter, for a place that is a volume rather than a point."""

    location: WorldLocation = Field(default_factory=WorldLocation)

    events: list[WorldEvent] = Field(default_factory=list)
    """Dated history, in any order; the build sorts it."""

    article: str = ""
    note: str = ""

    @field_validator("article")
    @classmethod
    def _http(cls, value: str) -> str:
        if value and not value.startswith(("http://", "https://")):
            raise ValueError(f"article must be an absolute URL, got {value!r}")
        return value

    @field_validator("extent")
    @classmethod
    def _extent(cls, value: str) -> str:
        if value:
            parse_distance(value)
        return value


class WorldFile(BaseModel):
    """The top level of ``fiction/worlds.yaml``."""

    worlds: list[World] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_names(self) -> WorldFile:
        seen: set[str] = set()
        for world in self.worlds:
            if world.name in seen:
                raise ValueError(f"duplicate world {world.name!r}")
            seen.add(world.name)
        return self

    @classmethod
    def load(cls, path: Path) -> WorldFile:
        if not path.exists():
            return cls()
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must contain a mapping at the top level")
        return cls.model_validate(raw)


QUESTION_STATUS = frozenset({"open", "settled"})


class Question(BaseModel):
    """One thing we cannot answer from the sources we hold."""

    id: str
    topic: str
    summary: str
    status: str = "open"
    severity: str = ""
    """Free text: contradiction, reading, category, precision, data-gap…"""

    detail: str = ""
    map_does: str = ""
    """What the map does in the absence of an answer, so the question is fair."""
    would_settle: str = ""
    links: list[str] = Field(default_factory=list)

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str) -> str:
        if value not in QUESTION_STATUS:
            raise ValueError(f"status must be one of {sorted(QUESTION_STATUS)}, got {value!r}")
        return value

    @field_validator("id")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", value):
            raise ValueError(f"question id must be kebab-case, got {value!r}")
        return value


class QuestionFile(BaseModel):
    """The top level of ``fiction/questions.yaml``."""

    questions: list[Question] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_ids(self) -> QuestionFile:
        seen: set[str] = set()
        for question in self.questions:
            if question.id in seen:
                raise ValueError(f"duplicate question id {question.id!r}")
            seen.add(question.id)
        return self

    @classmethod
    def load(cls, path: Path) -> QuestionFile:
        if not path.exists():
            return cls()
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must contain a mapping at the top level")
        return cls.model_validate(raw)


class Landmark(BaseModel):
    """An Orion's Arm name for a real catalogued object."""

    catalogue: str
    """The designation the astronomical data uses, resolved through the aliases."""

    name: str
    """What the setting calls it."""

    events: list[WorldEvent] = Field(default_factory=list)
    """Dated history, same shape as a world's.

    A cluster can be colonised too. Aleph Absolute was settled around 3000 and
    the Enigma Cluster in 7222, and without this those years would have had
    nowhere to go but a prose note.
    """

    article: str = ""
    note: str = ""

    @field_validator("article")
    @classmethod
    def _http(cls, value: str) -> str:
        if value and not value.startswith(("http://", "https://")):
            raise ValueError(f"article must be an absolute URL, got {value!r}")
        return value


class LandmarkFile(BaseModel):
    """The top level of ``fiction/landmarks.yaml``."""

    landmarks: list[Landmark] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique(self) -> LandmarkFile:
        seen: set[str] = set()
        for landmark in self.landmarks:
            if landmark.catalogue in seen:
                raise ValueError(f"duplicate landmark name for {landmark.catalogue!r}")
            seen.add(landmark.catalogue)
        return self

    @classmethod
    def load(cls, path: Path) -> LandmarkFile:
        if not path.exists():
            return cls()
        raw: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must contain a mapping at the top level")
        return cls.model_validate(raw)
