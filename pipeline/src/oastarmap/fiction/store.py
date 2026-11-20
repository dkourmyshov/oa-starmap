"""The authoritative OAUP knowledge graph.

``fiction/oaup/`` is the sole source for fictional objects, their editorial
curation and their source claims. The Pydantic models in :mod:`.schema` are
validated views for the build, not alternative stores. Source claims are explicit
resources so that provenance, method, precision and conflicts survive the build.

The authoring syntax is deliberately RDF 1.1 Turtle. It works with archival and
validation tools today; RDF 1.2 reifiers can be added as an export later without
changing the stable identifiers or claim model.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path
from typing import Any

from pyshacl import validate as shacl_validate
from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import DCTERMS, PROV, RDF, SKOS, XSD

from oastarmap.fiction.resolve import normalise
from oastarmap.fiction.schema import (
    DISTANCE,
    AliasFile,
    ColonyAssignment,
    ColonyFile,
    FictionFile,
    InnerSphereFile,
    InnerSphereSystem,
    InnerSphereWormhole,
    Landmark,
    LandmarkFile,
    OAStarEntry,
    OAStarFile,
    OASystem,
    OASystemFile,
    Polity,
    Source,
    World,
    WorldEvent,
    WorldFile,
    WorldLocation,
)
from oastarmap.paths import FICTION_DIR

BASE = "https://dkourmyshov.github.io/oa-starmap/"
OA = Namespace(f"{BASE}vocab#")
ID = Namespace(f"{BASE}id/")
CLAIM = Namespace(f"{BASE}claim/")
VALUE = Namespace(f"{BASE}value/")
SRC = Namespace(f"{BASE}source/")
QUDT = Namespace("http://qudt.org/schema/qudt/")
UNIT = Namespace("http://qudt.org/vocab/unit/")

OAUP_DIR = "oaup"
ONTOLOGY_FILE = "ontology.ttl"
SHAPES_FILE = "shapes.ttl"

_UNITS = {"ly": UNIT.LY, "lyr": UNIT.LY, "pc": UNIT.PC, "kpc": UNIT.KPC}
_UNIT_NAMES = {str(UNIT.LY): "ly", str(UNIT.PC): "pc", str(UNIT.KPC): "kpc"}
def _camel(value: str) -> str:
    camel = re.sub(r"_([a-z])", lambda m: m.group(1).upper(), value)
    return camel[:1].upper() + camel[1:]


_EVENT_TERMS = {
    kind: OA[_camel(kind)]
    for kind in (
        "observed", "visited", "settled", "contact", "capital", "stewardship",
        "transferred", "independent", "reported", "abandoned",
    )
}
_EVENT_KINDS = {str(iri): kind for kind, iri in _EVENT_TERMS.items()}
_PRECISION_TERMS = {
    precision: OA[_camel(precision)]
    for precision in ("exact", "circa", "not_later_than", "not_earlier_than", "between")
}
_PRECISIONS = {str(iri): precision for precision, iri in _PRECISION_TERMS.items()}


def _add(graph: Graph, subject: URIRef, predicate: URIRef, value: Any) -> None:
    if value is None or value == "" or value == []:
        return
    if isinstance(value, bool):
        obj: Any = Literal(value)
    elif isinstance(value, int):
        obj = Literal(value, datatype=XSD.integer)
    elif isinstance(value, float):
        obj = Literal(repr(value), datatype=XSD.decimal)
    elif isinstance(value, URIRef):
        obj = value
    else:
        obj = Literal(str(value))
    graph.add((subject, predicate, obj))


def _one(graph: Graph, subject: URIRef, predicate: URIRef) -> Any | None:
    values = list(graph.objects(subject, predicate))
    if len(values) > 1:
        raise ValueError(f"{subject} has {len(values)} values for {predicate}")
    return values[0] if values else None


def _text(graph: Graph, subject: URIRef, predicate: URIRef) -> str:
    value = _one(graph, subject, predicate)
    return "" if value is None else str(value)


def _int(graph: Graph, subject: URIRef, predicate: URIRef) -> int | None:
    value = _one(graph, subject, predicate)
    return None if value is None else int(value)


def _float(graph: Graph, subject: URIRef, predicate: URIRef) -> float | None:
    value = _one(graph, subject, predicate)
    return None if value is None else float(value)


def _bool(graph: Graph, subject: URIRef, predicate: URIRef) -> bool:
    return bool(_one(graph, subject, predicate))


def _slug(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "object"


def _entity_id(entity: URIRef) -> str:
    return str(entity).removeprefix(str(ID))


def _claim_id(entity: URIRef, family: str, suffix: str = "") -> URIRef:
    tail = f"-{suffix}" if suffix else ""
    return CLAIM[f"{family}-{_entity_id(entity)}{tail}"]


def _content_id(value: Any) -> str:
    text = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def _quantity(
    graph: Graph,
    claim: URIRef,
    predicate: URIRef,
    text: str,
    local_name: str,
) -> None:
    if not text:
        return
    matched = DISTANCE.match(text)
    if matched is None:
        raise ValueError(f"not a quantity with a known unit: {text!r}")
    number, unit = matched.groups()
    # Value IRIs derive from their owning claim or entity, not their contents.
    owner = str(claim).removeprefix(str(CLAIM)).removeprefix(str(ID))
    value = VALUE[f"{owner.replace('/', '-')}-{local_name}"]
    graph.add((claim, predicate, value))
    graph.add((value, RDF.type, OA.QuantityValue))
    graph.add((value, QUDT.numericValue, Literal(number, datatype=XSD.decimal)))
    graph.add((value, QUDT.unit, _UNITS[unit.lower()]))
    graph.add((value, OA.lexicalPrecision, OA.ExactAsPrinted))


def _quantity_text(graph: Graph, claim: URIRef, predicate: URIRef) -> str:
    value = _one(graph, claim, predicate)
    if value is None:
        return ""
    number = _one(graph, value, QUDT.numericValue)
    unit = _one(graph, value, QUDT.unit)
    if number is None or unit is None:
        raise ValueError(f"{value} is an incomplete quantity")
    return f"{number} {_UNIT_NAMES[str(unit)]}"


def _canonical_claims(graph: Graph, entity: URIRef, claim_type: URIRef) -> list[URIRef]:
    return sorted(
        (
            claim
            for claim in graph.subjects(OA.about, entity)
            if (claim, RDF.type, claim_type) in graph
            and (claim, OA.canonical, Literal(True)) in graph
        ),
        key=str,
    )


def _event(graph: Graph, claim: URIRef, default_article: str = "") -> dict[str, Any]:
    kind = _one(graph, claim, OA.eventKind)
    precision = _one(graph, claim, OA.precision)
    polity = _one(graph, claim, OA.polity)
    source = _one(graph, claim, PROV.hadPrimarySource)
    source_note = _text(graph, claim, OA.sourceDescription)
    return {
        "year_at": _int(graph, claim, OA.yearAT),
        "kind": _EVENT_KINDS[str(kind)],
        "note": _text(graph, claim, OA.note),
        "source": (
            source_note
            if source_note
            else str(source)
            if source is not None and str(source) != default_article
            else ""
        ),
        "until_at": _int(graph, claim, OA.untilAT),
        "precision": _PRECISIONS[str(precision)],
        "polity": _entity_id(polity).removeprefix("polity-") if polity else "",
    }


def _events(graph: Graph, entity: URIRef) -> list[WorldEvent]:
    claims = _canonical_claims(graph, entity, OA.EventClaim)
    claims.sort(key=lambda c: (_int(graph, c, OA.recordOrder) or 0, str(c)))
    article = _text(graph, entity, OA.article)
    if not article:
        for curation in graph.subjects(OA.about, entity):
            if (curation, RDF.type, OA.SystemCuration) in graph:
                article = _text(graph, curation, OA.article)
    return [
        WorldEvent.model_validate(_event(graph, claim, article))
        for claim in claims
    ]


def _location(graph: Graph, entity: URIRef) -> WorldLocation:
    claims = _canonical_claims(graph, entity, OA.LocationClaim)
    if not claims:
        return WorldLocation()
    if len(claims) != 1:
        raise ValueError(f"{entity} has {len(claims)} canonical location claims")
    claim = claims[0]
    return WorldLocation(
        hip=_int(graph, claim, OA.hipparcosId),
        hd=_int(graph, claim, OA.hdId),
        star=_text(graph, claim, OA.starName),
        catalogue_from_source=_bool(graph, claim, OA.catalogueFromSource),
        oa_star=_text(graph, claim, OA.oaStarName),
        world=_text(graph, claim, OA.worldName),
        ra_deg=_float(graph, claim, OA.rightAscensionDeg),
        dec_deg=_float(graph, claim, OA.declinationDeg),
        constellation=_text(graph, claim, OA.constellationName),
        distance=_quantity_text(graph, claim, OA.distance),
        near=_text(graph, claim, OA.nearName),
        estimated=_text(graph, claim, OA.derivation),
        direction_error_deg=_float(graph, claim, OA.directionErrorDeg),
        distance_error=_quantity_text(graph, claim, OA.distanceError),
        distance_conflict=_bool(graph, claim, OA.knownDistanceConflict),
        note=_text(graph, claim, OA.note),
    )


class OAUPStore:
    """A parsed graph plus validated, build-friendly views of its contents."""

    def __init__(
        self,
        path: Path,
        graph: Graph | None = None,
        file_of: dict[URIRef, str] | None = None,
    ) -> None:
        self.path = Path(path)
        self.graph = graph if graph is not None else Graph()
        self.file_of = file_of or {}
        self._group_files: dict[str, str] = {}
        self._file_groups: dict[str, str] = {}
        self._bind()
        self.refresh()

    def _bind(self) -> None:
        for prefix, namespace in (
            ("oa", OA), ("id", ID), ("claim", CLAIM), ("value", VALUE),
            ("src", SRC), ("qudt", QUDT), ("unit", UNIT), ("skos", SKOS),
            ("prov", PROV), ("dcterms", DCTERMS),
        ):
            self.graph.bind(prefix, namespace)

    @classmethod
    def empty(cls, path: Path) -> OAUPStore:
        graph = Graph()
        dataset = ID.dataset
        graph.add((dataset, RDF.type, OA.OAUPDataset))
        graph.add((dataset, DCTERMS.title, Literal("Orion's Arm Universe Project starmap data")))
        return cls(path, graph)

    @classmethod
    def load(cls, path: Path | None = None) -> OAUPStore:
        from oastarmap.fiction.layout import load_graph, validate_file_assignment

        path = path or FICTION_DIR / OAUP_DIR
        if not path.is_dir():
            raise ValueError(f"OAUP data must be loaded as a directory, got {path}")
        graph, file_of = load_graph(path)
        store = cls(path, graph, file_of)
        validate_file_assignment(store)
        return store

    def save(self, path: Path | None = None) -> None:
        from oastarmap.fiction.layout import write_files

        path = path or self.path
        if path.suffix:
            raise ValueError(f"OAUP data must be saved as a directory, got {path}")
        write_files(self, path)
        self.path = path

    def validate(self, shapes_path: Path | None = None) -> str:
        shapes_path = shapes_path or self.path.with_name(SHAPES_FILE)
        shapes = Graph().parse(shapes_path, format="turtle")
        conforms, _, report = shacl_validate(
            self.graph, shacl_graph=shapes, advanced=True, inference="none"
        )
        if not conforms:
            raise ValueError(f"OAUP RDF validation failed:\n{report}")
        return str(report)

    def _unique_entity(self, family: str, name: str) -> URIRef:
        base = f"{family}-{_slug(name)}"
        candidate = ID[base]
        if candidate not in set(self.graph.subjects()):
            return candidate
        digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]
        candidate = ID[f"{base}-{digest}"]
        number = 2
        while candidate in set(self.graph.subjects()):
            candidate = ID[f"{base}-{digest}-{number}"]
            number += 1
        return candidate

    def add_source(self, key: str, source: Source) -> URIRef:
        subject = SRC[key]
        self.graph.add((subject, RDF.type, OA.SourceSnapshot))
        self.graph.add((subject, RDF.type, PROV.Entity))
        _add(self.graph, subject, DCTERMS.title, source.title)
        _add(self.graph, subject, OA.locator, URIRef(source.url))
        _add(self.graph, subject, OA.page, source.page)
        _add(self.graph, subject, OA.epochAT, source.epoch_at)
        _add(self.graph, subject, OA.note, source.note)
        return subject

    def add_event(
        self, entity: URIRef, event: WorldEvent, order: int, default_article: str = ""
    ) -> URIRef:
        claim = _claim_id(entity, "event", f"{order + 1:03d}")
        graph = self.graph
        graph.add((claim, RDF.type, OA.EventClaim))
        graph.add((claim, RDF.type, PROV.Entity))
        _add(graph, claim, OA.about, entity)
        _add(graph, claim, OA.canonical, True)
        _add(graph, claim, OA.recordOrder, order)
        _add(graph, claim, OA.yearAT, event.year_at)
        _add(graph, claim, OA.eventKind, _EVENT_TERMS[event.kind])
        _add(graph, claim, OA.precision, _PRECISION_TERMS[event.precision])
        _add(graph, claim, OA.untilAT, event.until_at)
        _add(graph, claim, OA.note, event.note)
        if event.polity:
            _add(graph, claim, OA.polity, ID[f"polity-{event.polity}"])
        if event.source.startswith(("http://", "https://")):
            _add(graph, claim, PROV.hadPrimarySource, URIRef(event.source))
        elif event.source:
            _add(graph, claim, OA.sourceDescription, event.source)
        elif default_article:
            _add(graph, claim, PROV.hadPrimarySource, URIRef(default_article))
        return claim

    def add_world(self, world: World, entity: URIRef | None = None) -> URIRef:
        graph = self.graph
        entity = entity or self._unique_entity("world", world.name)
        graph.add((entity, RDF.type, OA.World))
        graph.add((entity, RDF.type, OA.Place))
        _add(graph, entity, SKOS.prefLabel, world.name)
        _add(graph, entity, OA.kind, world.kind)
        _add(graph, entity, OA.systemName, world.system)
        _add(graph, entity, OA.parentName, world.parent)
        for alias in world.also:
            _add(graph, entity, SKOS.altLabel, alias)
        _add(graph, entity, OA.labelsSystem, world.labels_system)
        _add(graph, entity, OA.uncertain, world.uncertain)
        _quantity(graph, entity, OA.extent, world.extent, "extent")
        _add(graph, entity, OA.article, URIRef(world.article) if world.article else None)
        _add(graph, entity, OA.note, world.note)
        for order, polity in enumerate(world.affiliations):
            self.add_affiliation(entity, polity, world.article, order)

        location = world.location
        if location.model_dump(exclude_defaults=True):
            claim = _claim_id(entity, "location")
            graph.add((claim, RDF.type, OA.LocationClaim))
            graph.add((claim, RDF.type, PROV.Entity))
            _add(graph, claim, OA.about, entity)
            _add(graph, claim, OA.canonical, True)
            method = OA.EditorialEstimate if location.estimated else OA.DirectTranscription
            _add(graph, claim, OA.method, method)
            _add(graph, claim, OA.hipparcosId, location.hip)
            _add(graph, claim, OA.hdId, location.hd)
            _add(graph, claim, OA.starName, location.star)
            _add(graph, claim, OA.catalogueFromSource, location.catalogue_from_source)
            _add(graph, claim, OA.oaStarName, location.oa_star)
            _add(graph, claim, OA.worldName, location.world)
            _add(graph, claim, OA.rightAscensionDeg, location.ra_deg)
            _add(graph, claim, OA.declinationDeg, location.dec_deg)
            _add(graph, claim, OA.constellationName, location.constellation)
            _quantity(graph, claim, OA.distance, location.distance, "distance")
            _add(graph, claim, OA.nearName, location.near)
            _add(graph, claim, OA.derivation, location.estimated)
            _add(graph, claim, OA.directionErrorDeg, location.direction_error_deg)
            _quantity(graph, claim, OA.distanceError, location.distance_error, "distance-error")
            _add(graph, claim, OA.knownDistanceConflict, location.distance_conflict)
            _add(graph, claim, OA.note, location.note)
            if world.article:
                _add(graph, claim, PROV.hadPrimarySource, URIRef(world.article))
        for order, event in enumerate(world.events):
            self.add_event(entity, event, order, world.article)
        self.world_iris[world.name] = entity
        self.world_file.worlds.append(world)
        return entity

    def add_affiliation(
        self, entity: URIRef, polity: str, article: str = "", order: int | None = None
    ) -> URIRef:
        claim = _claim_id(entity, "affiliation", polity)
        graph = self.graph
        if (claim, RDF.type, OA.AffiliationClaim) in graph:
            return claim
        graph.add((claim, RDF.type, OA.AffiliationClaim))
        graph.add((claim, RDF.type, PROV.Entity))
        _add(graph, claim, OA.about, entity)
        _add(graph, claim, OA.polity, ID[f"polity-{polity}"])
        _add(graph, claim, OA.canonical, True)
        _add(graph, claim, OA.recordOrder, order)
        if article:
            _add(graph, claim, PROV.hadPrimarySource, URIRef(article))
        return claim

    def add_star(self, star: OAStarEntry, entity: URIRef | None = None) -> URIRef:
        graph = self.graph
        entity = entity or self._unique_entity("star", star.name)
        graph.add((entity, RDF.type, OA.CelestiaStar))
        graph.add((entity, RDF.type, OA.Star))
        graph.add((entity, RDF.type, OA.Place))
        _add(graph, entity, SKOS.prefLabel, star.name)
        _add(graph, entity, OA.sourceName, star.name)
        claim = _claim_id(entity, "celestia", _content_id(star.model_dump()))
        graph.add((claim, RDF.type, OA.CelestiaLocationClaim))
        graph.add((claim, RDF.type, OA.LocationClaim))
        graph.add((claim, RDF.type, PROV.Entity))
        _add(graph, claim, OA.about, entity)
        graph.set((claim, OA.canonical, Literal(True)))
        _add(graph, claim, OA.method, OA.ImportedValue)
        _add(graph, claim, OA.rightAscensionDeg, star.ra_deg)
        _add(graph, claim, OA.declinationDeg, star.dec_deg)
        _quantity(graph, claim, OA.distance, f"{star.distance_ly!r} ly", "distance")
        _add(graph, claim, OA.spectralType, star.spectral_type)
        _add(graph, claim, OA.absoluteMagnitude, star.abs_mag)
        _add(graph, claim, OA.sourceSystemName, star.system)
        _add(graph, claim, OA.sourceComment, star.comment)
        _add(graph, claim, OA.sourceFile, star.source_file)
        _add(graph, claim, OA.sourceArchive, star.archive)
        _add(graph, claim, PROV.hadPrimarySource, SRC["celestia-addons"])
        return entity

    def add_curation(self, system: OASystem, entities: dict[str, list[URIRef]]) -> URIRef:
        matches = entities.get(system.star, [])
        if len(matches) != 1:
            raise ValueError(
                f"curation for {system.star!r} needs one matching Celestia record; "
                f"found {len(matches)}"
            )
        entity = matches[0]
        graph = self.graph
        claim = _claim_id(entity, "curation")
        graph.add((claim, RDF.type, OA.SystemCuration))
        graph.add((claim, RDF.type, PROV.Entity))
        _add(graph, claim, OA.about, entity)
        _add(graph, claim, OA.editorialLabel, system.label)
        if system.affiliation:
            self.add_affiliation(entity, system.affiliation, system.article)
        _add(graph, claim, OA.realObjectIdentity, system.real)
        _add(graph, claim, OA.uncertain, system.uncertain)
        _add(graph, claim, OA.hidden, system.hidden)
        _add(graph, claim, OA.article, URIRef(system.article) if system.article else None)
        _add(graph, claim, OA.note, system.note)
        for order, event in enumerate(system.events):
            self.add_event(entity, event, order, system.article)
        return entity

    def add_inner_system(self, row: InnerSphereSystem, order: int) -> URIRef:
        graph = self.graph
        entity = ID[f"inner-sphere-row-{order + 1:04d}"]
        graph.add((entity, RDF.type, OA.InnerSphereSystem))
        graph.add((entity, RDF.type, OA.StarSystem))
        graph.add((entity, RDF.type, OA.Place))
        graph.set((entity, SKOS.prefLabel, Literal(row.colony or row.star)))
        claim = _claim_id(entity, "inner-sphere", _content_id(row.model_dump()))
        graph.add((claim, RDF.type, OA.InnerSphereClaim))
        graph.add((claim, RDF.type, PROV.Entity))
        _add(graph, claim, OA.about, entity)
        graph.set((claim, OA.canonical, Literal(True)))
        _add(graph, claim, OA.method, OA.DirectTranscription)
        graph.set((claim, OA.recordOrder, Literal(order, datatype=XSD.integer)))
        _add(graph, claim, OA.starName, row.star)
        _add(graph, claim, OA.colonyName, row.colony)
        _add(graph, claim, OA.article, URIRef(row.article) if row.article else None)
        _add(graph, claim, OA.spectralType, row.spectral_type)
        _add(graph, claim, OA.massSol, row.mass_sol)
        _add(graph, claim, OA.luminositySol, row.luminosity_sol)
        if DISTANCE.match(f"{row.distance_ly} ly"):
            _quantity(
                graph, claim, OA.sourceDistance, f"{row.distance_ly} ly", "source-distance"
            )
        elif row.distance_ly:
            _add(graph, claim, OA.sourceDistanceText, row.distance_ly)
        _add(graph, claim, PROV.hadPrimarySource, SRC["inner-sphere-table"])
        return entity

    def add_wormhole(self, row: InnerSphereWormhole, order: int) -> URIRef:
        graph = self.graph
        claim = CLAIM[f"wormhole-{order + 1:04d}-{_content_id(row.model_dump())}"]
        graph.add((claim, RDF.type, OA.WormholeClaim))
        graph.add((claim, RDF.type, PROV.Entity))
        graph.set((claim, OA.canonical, Literal(True)))
        graph.set((claim, OA.recordOrder, Literal(order, datatype=XSD.integer)))
        _add(graph, claim, OA.starName, row.star)
        _add(graph, claim, OA.systemName, row.system)
        _add(graph, claim, OA.wormholeName, row.wormhole)
        _add(graph, claim, OA.gaugeMetres, row.gauge_m)
        _add(graph, claim, OA.nearbyUnconnected, row.nearby_unconnected)
        _add(graph, claim, OA.note, row.notes)
        _add(graph, claim, PROV.hadPrimarySource, SRC["inner-sphere-table"])
        return claim

    def add_colony(self, entry: ColonyAssignment, order: int) -> URIRef:
        graph = self.graph
        subject = ID[f"colony-assignment-{order + 1:04d}"]
        graph.add((subject, RDF.type, OA.ColonyAssignment))
        _add(graph, subject, OA.colonyName, entry.colony)
        for alias in entry.also:
            _add(graph, subject, SKOS.altLabel, alias)
        for polity_order, polity in enumerate(entry.affiliations):
            self.add_affiliation(subject, polity, order=polity_order)
        _add(graph, subject, OA.status, entry.status)
        _add(graph, subject, OA.note, entry.note)
        return subject

    def add_polity(self, polity: Polity, order: int = 0) -> URIRef:
        graph = self.graph
        entity = ID[f"polity-{polity.id}"]
        graph.add((entity, RDF.type, OA.Polity))
        _add(graph, entity, OA.polityId, polity.id)
        _add(graph, entity, OA.recordOrder, order)
        _add(graph, entity, SKOS.prefLabel, polity.name)
        _add(graph, entity, OA.color, polity.color)
        _add(graph, entity, OA.uncertain, polity.uncertain)
        _add(graph, entity, OA.ambiguousName, polity.ambiguous_name)
        _add(graph, entity, OA.foundedAT, polity.founded_at)
        _add(graph, entity, OA.dissolvedAT, polity.dissolved_at)
        _add(graph, entity, OA.kind, polity.kind)
        _add(graph, entity, OA.note, polity.note)
        if polity.source:
            _add(graph, entity, OA.hasSource, SRC[polity.source])
        return entity

    def add_landmark(
        self,
        catalogue: str,
        name: str = "",
        landmark: Landmark | None = None,
        order: int | None = None,
    ) -> URIRef:
        graph = self.graph
        existing = [
            subject
            for subject in graph.subjects(RDF.type, OA.Landmark)
            if normalise(_text(graph, subject, OA.catalogueDesignation)) == normalise(catalogue)
        ]
        entity = existing[0] if existing else self._unique_entity("landmark", catalogue)
        graph.add((entity, RDF.type, OA.Landmark))
        graph.add((entity, RDF.type, OA.Place))
        _add(graph, entity, OA.catalogueDesignation, catalogue)
        if landmark is None:
            _add(graph, entity, SKOS.prefLabel, name or catalogue)
            return entity

        graph.set((entity, SKOS.prefLabel, Literal(landmark.name)))
        _add(graph, entity, OA.hasFictionalName, True)
        _add(graph, entity, OA.recordOrder, order)
        if normalise(landmark.name) != normalise(catalogue):
            _add(graph, entity, SKOS.altLabel, catalogue)
        _add(graph, entity, OA.article, URIRef(landmark.article) if landmark.article else None)
        _add(graph, entity, OA.note, landmark.note)
        for order, event in enumerate(landmark.events):
            self.add_event(entity, event, order, landmark.article)
        return entity

    def add_alias(self, alias: str, target: str) -> URIRef:
        graph = self.graph
        subject = ID[f"alias-{_slug(alias)}"]
        graph.add((subject, RDF.type, OA.IdentityAlias))
        _add(graph, subject, SKOS.altLabel, alias)
        _add(graph, subject, OA.catalogueDesignation, target)
        return subject

    def replace_celestia(self, stars: Iterable[OAStarEntry]) -> int:
        """Replace the current import, retaining superseded claims and curation."""
        existing: dict[tuple[str, str], URIRef] = {}
        for entity in self.graph.subjects(RDF.type, OA.CelestiaStar):
            claims = _canonical_claims(self.graph, entity, OA.CelestiaLocationClaim)
            for claim in claims:
                key = (
                    _text(self.graph, entity, OA.sourceName),
                    _text(self.graph, claim, OA.sourceFile),
                )
                existing[key] = entity
                self.graph.set((claim, OA.canonical, Literal(False)))
        count = 0
        for star in stars:
            key = (star.name, star.source_file)
            entity = existing.get(key)
            self.add_star(star, entity)
            count += 1
        self.refresh()
        return count

    def replace_inner_sphere(
        self,
        systems: Iterable[InnerSphereSystem],
        wormholes: Iterable[InnerSphereWormhole],
    ) -> dict[str, int]:
        """Replace current table claims without disturbing editorial assignments."""
        for claim_type in (OA.InnerSphereClaim, OA.WormholeClaim):
            for claim in self.graph.subjects(RDF.type, claim_type):
                self.graph.set((claim, OA.canonical, Literal(False)))
        system_rows = list(systems)
        wormhole_rows = list(wormholes)
        for order, row in enumerate(system_rows):
            self.add_inner_system(row, order)
        for order, row in enumerate(wormhole_rows):
            self.add_wormhole(row, order)
        self.refresh()
        return {"systems": len(system_rows), "wormholes": len(wormhole_rows)}

    @classmethod
    def from_models(
        cls,
        path: Path,
        *,
        worlds: Iterable[World] = (),
        stars: Iterable[OAStarEntry] = (),
        systems: Iterable[OASystem] = (),
        inner_systems: Iterable[InnerSphereSystem] = (),
        wormholes: Iterable[InnerSphereWormhole] = (),
        colonies: Iterable[ColonyAssignment] = (),
        polities: Iterable[Polity] = (),
        sources: dict[str, Source] | None = None,
        landmarks: Iterable[Landmark] = (),
        aliases: dict[str, str] | None = None,
        hide_comment_matching: Iterable[str] = (),
        hide_designation_only: bool = False,
        never_adjacent: Iterable[list[str]] = (),
        confirmed_placements: Iterable[str] = (),
        notes: dict[str, str] | None = None,
    ) -> OAUPStore:
        store = cls.empty(path)
        store.add_source("celestia-addons", Source(
            title="Orion's Arm Celestia add-ons",
            url="https://www.orionsarm.com/xcms.php?r=oa-page&page=gen_OACelestia2",
            note="Original .stc records and coordinates; distances are light years.",
        ))
        _add(
            store.graph,
            SRC["celestia-addons"],
            OA.terms,
            URIRef("https://www.orionsarm.com/Terms_Copyright_and_Submissions.html"),
        )
        store.add_source("inner-sphere-table", Source(
            title="The Stars of the Inner Sphere",
            url="https://www.orionsarm.com/eg-topic/45bcbcab90032",
        ))
        for key, source in (sources or {}).items():
            store.add_source(key, source)
        for world in worlds:
            store.add_world(world)
        star_entities: dict[str, list[URIRef]] = {}
        for star in stars:
            entity = store.add_star(star)
            star_entities.setdefault(star.name, []).append(entity)
        for system in systems:
            store.add_curation(system, star_entities)
        for order, row in enumerate(inner_systems):
            store.add_inner_system(row, order)
        for order, row in enumerate(wormholes):
            store.add_wormhole(row, order)
        for order, colony in enumerate(colonies):
            store.add_colony(colony, order)
        polity_list = list(polities)
        for order, polity in enumerate(polity_list):
            store.add_polity(polity, order)
        for polity in polity_list:
            for order, landmark in enumerate(polity.landmarks):
                entity = store.add_landmark(landmark)
                claim = store.add_affiliation(entity, polity.id, order=order)
                if polity.source:
                    _add(store.graph, claim, PROV.hadPrimarySource, SRC[polity.source])
        for order, landmark in enumerate(landmarks):
            store.add_landmark(landmark.catalogue, landmark.name, landmark, order)
        for alias, target in (aliases or {}).items():
            store.add_alias(alias, target)
        dataset = ID.dataset
        for rule in hide_comment_matching:
            _add(store.graph, dataset, OA.hideCommentMatching, rule)
        _add(store.graph, dataset, OA.hideDesignationOnly, hide_designation_only)
        for pair in never_adjacent:
            if len(pair) != 2:
                raise ValueError(f"never_adjacent needs pairs, got {pair!r}")
            first, second = (ID[f"polity-{value}"] for value in pair)
            _add(store.graph, first, OA.neverAdjacentWith, second)
            _add(store.graph, second, OA.neverAdjacentWith, first)
        for name in confirmed_placements:
            for entity in store.graph.subjects(RDF.type, OA.Landmark):
                if _text(store.graph, entity, OA.catalogueDesignation) == name:
                    _add(store.graph, entity, OA.confirmedPlacement, True)
        for key, text in (notes or {}).items():
            subject = ID[f"editorial-note-{_slug(key)}"]
            store.graph.add((subject, RDF.type, OA.EditorialNote))
            _add(store.graph, subject, OA.noteKey, key)
            _add(store.graph, subject, OA.note, text)
        store.refresh()
        return store

    def refresh(self) -> None:
        graph = self.graph
        worlds: list[World] = []
        for entity in sorted(graph.subjects(RDF.type, OA.World), key=str):
            worlds.append(World(
                name=_text(graph, entity, SKOS.prefLabel),
                kind=_text(graph, entity, OA.kind) or "planet",
                system=_text(graph, entity, OA.systemName),
                parent=_text(graph, entity, OA.parentName),
                also=sorted(str(v) for v in graph.objects(entity, SKOS.altLabel)),
                labels_system=_bool(graph, entity, OA.labelsSystem),
                affiliations=_affiliations(graph, entity),
                uncertain=_bool(graph, entity, OA.uncertain),
                extent=_quantity_text(graph, entity, OA.extent),
                location=_location(graph, entity),
                events=_events(graph, entity),
                article=_text(graph, entity, OA.article),
                note=_text(graph, entity, OA.note),
            ))
        self.world_file = WorldFile(worlds=worlds)

        stars: list[OAStarEntry] = []
        star_entities: dict[str, URIRef] = {}
        for entity in sorted(graph.subjects(RDF.type, OA.CelestiaStar), key=str):
            claims = _canonical_claims(graph, entity, OA.CelestiaLocationClaim)
            if not claims:
                continue
            if len(claims) != 1:
                raise ValueError(f"{entity} has {len(claims)} canonical Celestia claims")
            claim = claims[0]
            name = _text(graph, entity, OA.sourceName)
            stars.append(OAStarEntry(
                name=name,
                ra_deg=_float(graph, claim, OA.rightAscensionDeg) or 0.0,
                dec_deg=_float(graph, claim, OA.declinationDeg) or 0.0,
                distance_ly=float(_quantity_text(graph, claim, OA.distance).split()[0]),
                spectral_type=_text(graph, claim, OA.spectralType),
                abs_mag=_float(graph, claim, OA.absoluteMagnitude),
                system=_text(graph, claim, OA.sourceSystemName),
                comment=_text(graph, claim, OA.sourceComment),
                source_file=_text(graph, claim, OA.sourceFile),
                archive=_text(graph, claim, OA.sourceArchive),
            ))
            star_entities[name] = entity
        self.oa_star_file = OAStarFile(stars=stars)

        systems: list[OASystem] = []
        for claim in sorted(graph.subjects(RDF.type, OA.SystemCuration), key=str):
            entity = _one(graph, claim, OA.about)
            name = _text(graph, entity, OA.sourceName)
            systems.append(OASystem(
                star=name,
                label=_text(graph, claim, OA.editorialLabel),
                affiliation=next(iter(_affiliations(graph, entity)), ""),
                real=_text(graph, claim, OA.realObjectIdentity),
                uncertain=_bool(graph, claim, OA.uncertain),
                hidden=_bool(graph, claim, OA.hidden),
                article=_text(graph, claim, OA.article),
                note=_text(graph, claim, OA.note),
                events=_events(graph, entity),
            ))
        self.oa_system_file = OASystemFile(
            systems=systems,
            hide_comment_matching=[
                str(v) for v in graph.objects(ID.dataset, OA.hideCommentMatching)
            ],
            hide_designation_only=_bool(graph, ID.dataset, OA.hideDesignationOnly),
        )

        inner_rows: list[tuple[int, URIRef, InnerSphereSystem]] = []
        inner_iris: dict[str, list[URIRef]] = {}
        for entity in sorted(graph.subjects(RDF.type, OA.InnerSphereSystem), key=str):
            claims = _canonical_claims(graph, entity, OA.InnerSphereClaim)
            if not claims:
                continue
            if len(claims) != 1:
                raise ValueError(f"{entity} has {len(claims)} canonical Inner Sphere claims")
            claim = claims[0]
            row = InnerSphereSystem(
                star=_text(graph, claim, OA.starName),
                distance_ly=(
                    _quantity_text(graph, claim, OA.sourceDistance).removesuffix(" ly")
                    or _text(graph, claim, OA.sourceDistanceText)
                ),
                colony=_text(graph, claim, OA.colonyName),
                article=_text(graph, claim, OA.article),
                spectral_type=_text(graph, claim, OA.spectralType),
                mass_sol=_text(graph, claim, OA.massSol),
                luminosity_sol=_text(graph, claim, OA.luminositySol),
            )
            inner_rows.append((_int(graph, claim, OA.recordOrder) or 0, entity, row))
            if row.colony:
                inner_iris.setdefault(row.colony, []).append(entity)
        inner_systems = [row for _, _, row in sorted(inner_rows, key=lambda item: item[0])]
        wormholes: list[InnerSphereWormhole] = []
        for claim in sorted(graph.subjects(RDF.type, OA.WormholeClaim), key=str):
            if not _bool(graph, claim, OA.canonical):
                continue
            wormholes.append(InnerSphereWormhole(
                star=_text(graph, claim, OA.starName),
                system=_text(graph, claim, OA.systemName),
                wormhole=_text(graph, claim, OA.wormholeName),
                gauge_m=_text(graph, claim, OA.gaugeMetres),
                nearby_unconnected=_text(graph, claim, OA.nearbyUnconnected),
                notes=_text(graph, claim, OA.note),
            ))
        self.inner_sphere_file = InnerSphereFile(systems=inner_systems, wormholes=wormholes)

        colonies: list[ColonyAssignment] = []
        for subject in sorted(graph.subjects(RDF.type, OA.ColonyAssignment), key=str):
            colonies.append(ColonyAssignment(
                colony=_text(graph, subject, OA.colonyName),
                affiliations=_affiliations(graph, subject),
                also=sorted(str(v) for v in graph.objects(subject, SKOS.altLabel)),
                status=_text(graph, subject, OA.status),
                note=_text(graph, subject, OA.note),
            ))
        self.colony_file = ColonyFile(colonies=colonies)

        polities: list[Polity] = []
        polity_entities: dict[str, URIRef] = {}
        polity_subjects = sorted(
            graph.subjects(RDF.type, OA.Polity),
            key=lambda entity: (_int(graph, entity, OA.recordOrder) or 0, str(entity)),
        )
        for entity in polity_subjects:
            polity_id = _text(graph, entity, OA.polityId)
            polity_entities[polity_id] = entity
            polities.append(Polity(
                id=polity_id,
                name=_text(graph, entity, SKOS.prefLabel),
                color=_text(graph, entity, OA.color),
                uncertain=_bool(graph, entity, OA.uncertain),
                source=_text(graph, entity, OA.hasSource).removeprefix(str(SRC)),
                ambiguous_name=_bool(graph, entity, OA.ambiguousName),
                founded_at=_int(graph, entity, OA.foundedAT),
                dissolved_at=_int(graph, entity, OA.dissolvedAT),
                kind=_text(graph, entity, OA.kind) or "meta-empire",
                note=_text(graph, entity, OA.note),
            ))
        landmarks: list[Landmark] = []
        landmark_subjects = sorted(
            graph.subjects(RDF.type, OA.Landmark),
            key=lambda entity: (
                _int(graph, entity, OA.recordOrder) is None,
                _int(graph, entity, OA.recordOrder) or 0,
                str(entity),
            ),
        )
        for entity in landmark_subjects:
            catalogue = _text(graph, entity, OA.catalogueDesignation)
            claims = _canonical_claims(graph, entity, OA.AffiliationClaim)
            claims.sort(key=lambda c: (_int(graph, c, OA.recordOrder) or 0, str(c)))
            for claim in claims:
                polity = _one(graph, claim, OA.polity)
                polity_id = _entity_id(polity).removeprefix("polity-")
                if catalogue not in polities[[p.id for p in polities].index(polity_id)].landmarks:
                    polities[[p.id for p in polities].index(polity_id)].landmarks.append(catalogue)
            if _bool(graph, entity, OA.hasFictionalName):
                landmarks.append(Landmark(
                    catalogue=catalogue,
                    name=_text(graph, entity, SKOS.prefLabel),
                    events=_events(graph, entity),
                    article=_text(graph, entity, OA.article),
                    note=_text(graph, entity, OA.note),
                ))
        self.landmark_file = LandmarkFile(landmarks=landmarks)

        source_keys = {p.source for p in polities if p.source}
        source_models: dict[str, Source] = {}
        for key in sorted(source_keys):
            subject = SRC[key]
            source_models[key] = Source(
                title=_text(graph, subject, DCTERMS.title),
                url=_text(graph, subject, OA.locator),
                page=_text(graph, subject, OA.page),
                epoch_at=_int(graph, subject, OA.epochAT),
                note=_text(graph, subject, OA.note),
            )
        never_adjacent: list[list[str]] = []
        for entity in polity_entities.values():
            for other in graph.objects(entity, OA.neverAdjacentWith):
                pair = sorted([
                    _text(graph, entity, OA.polityId), _text(graph, other, OA.polityId)
                ])
                if pair not in never_adjacent:
                    never_adjacent.append(pair)
        notes = {
            _text(graph, subject, OA.noteKey): _text(graph, subject, OA.note)
            for subject in graph.subjects(RDF.type, OA.EditorialNote)
        }
        confirmed = [
            _text(graph, entity, OA.catalogueDesignation)
            for entity in graph.subjects(RDF.type, OA.Landmark)
            if _bool(graph, entity, OA.confirmedPlacement)
        ]
        self.fiction_file = FictionFile(
            polities=polities,
            sources=source_models,
            notes=notes,
            never_adjacent=never_adjacent,
            confirmed_placements=confirmed,
        )
        self.alias_file = AliasFile(aliases={
            _text(graph, subject, SKOS.altLabel): _text(graph, subject, OA.catalogueDesignation)
            for subject in graph.subjects(RDF.type, OA.IdentityAlias)
        })

        self.world_iris = {
            _text(graph, entity, SKOS.prefLabel): entity
            for entity in graph.subjects(RDF.type, OA.World)
        }
        self.inner_iris = inner_iris

    @property
    def worlds(self) -> list[World]:
        return self.world_file.worlds

    @property
    def stars(self) -> list[OAStarEntry]:
        return self.oa_star_file.stars

    @property
    def fiction(self) -> FictionFile:
        return self.fiction_file


def _affiliations(graph: Graph, entity: URIRef) -> list[str]:
    out: list[str] = []
    claims = _canonical_claims(graph, entity, OA.AffiliationClaim)
    claims.sort(
        key=lambda c: (
            _int(graph, c, OA.recordOrder) is None,
            _int(graph, c, OA.recordOrder) or 0,
            str(c),
        )
    )
    for claim in claims:
        polity = _one(graph, claim, OA.polity)
        value = _entity_id(polity).removeprefix("polity-")
        if value not in out:
            out.append(value)
    return out


@lru_cache(maxsize=16)
def _cached_store(path: str, fingerprint: tuple[tuple[str, int, int], ...]) -> OAUPStore:
    del fingerprint
    return OAUPStore.load(Path(path))


def load_store(path: Path | None = None, *, fresh: bool = False) -> OAUPStore:
    """Load the whole directory graph, cached by every file's content metadata."""
    path = (path or FICTION_DIR / OAUP_DIR).resolve()
    if fresh:
        return OAUPStore.load(path)
    fingerprint = tuple(
        (str(source.relative_to(path)), source.stat().st_mtime_ns, source.stat().st_size)
        for source in sorted(path.rglob("*.ttl"))
    )
    return _cached_store(str(path), fingerprint)
