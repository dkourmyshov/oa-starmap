"""Editorial file placement and deterministic, entity-grouped Turtle output.

File placement is presentation metadata. It never changes identity, labels,
containment or canonical selection in the RDF graph. Existing placements survive
imports; new records inherit a host's file or use the rules below.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING, Any

from rdflib import BNode, Graph, Literal, URIRef
from rdflib.namespace import RDF, SKOS, XSD

from oastarmap.fiction.resolve import normalise
from oastarmap.fiction.store import OA

if TYPE_CHECKING:
    from oastarmap.fiction.store import OAUPStore

_DESIGNATION_ONLY = re.compile(
    r"^(JD|HIP|HD|GJ|GL|TYC|YTS|NR)[\s-]*[\d\s-]+$", re.IGNORECASE
)
_EMPTY_CELLS = {"", ".", "..", "-", "?"}
_QUANTITY_PREDICATES = (OA.distance, OA.distanceError, OA.extent, OA.sourceDistance)
_PREFIX_ORDER = (
    "claim", "dcterms", "id", "oa", "prov", "qudt",
    "skos", "src", "unit", "value", "xsd",
)
_CLAIM_ORDER = {
    "CelestiaLocationClaim": 0,
    "LocationClaim": 1,
    "InnerSphereClaim": 2,
    "AffiliationClaim": 3,
    "EventClaim": 4,
    "SystemCuration": 5,
}


def _slug(value: str) -> str:
    from oastarmap.fiction.store import _slug as slug

    return slug(value)


_PREFIX = re.compile(r"^@prefix\s+([A-Za-z][\w-]*):\s*<([^>]+)>", re.I | re.M)
_SUBJECT = re.compile(r"^(?:<([^>]+)>|([A-Za-z][\w-]*):([^\s]+))(?=\s)", re.M)


def load_graph(directory: Path) -> tuple[Graph, dict[URIRef, str]]:
    """Parse the canonical files together, retaining their editorial placement.

    Subject blocks begin in column zero in the canonical format. Reading those
    declarations separately avoids invoking a new RDF parser for every small
    system file; the combined text still undergoes one complete Turtle parse.
    """
    graph = Graph()
    file_of: dict[URIRef, str] = {}
    documents: list[str] = []
    prefix_bindings: dict[str, str] = {}
    for source in sorted(directory.rglob("*.ttl")):
        relative = source.relative_to(directory).as_posix()
        text = source.read_text(encoding="utf-8")
        documents.append(text)
        prefixes = dict(_PREFIX.findall(text))
        for prefix, namespace in prefixes.items():
            previous = prefix_bindings.setdefault(prefix, namespace)
            if previous != namespace:
                raise ValueError(f"prefix {prefix}: changes meaning in {relative}")
        subjects: set[URIRef] = set()
        for full, prefix, local in _SUBJECT.findall(text):
            if full:
                subject = URIRef(full)
            else:
                if prefix not in prefixes:
                    raise ValueError(f"{relative}: {prefix}: is not declared")
                subject = URIRef(prefixes[prefix] + local)
            subjects.add(subject)
        if not subjects:
            raise ValueError(f"{relative}: no subject blocks begin in column zero")
        for subject in subjects:
            if subject in file_of and file_of[subject] != relative:
                raise ValueError(
                    f"subject {subject} is split between {file_of[subject]} and {relative}"
                )
            file_of[subject] = relative
    if not documents:
        raise ValueError(f"no Turtle files found under {directory}")
    graph.parse(data="\n\n".join(documents), format="turtle")
    missing = set(graph.subjects()) - set(file_of)
    if missing:
        raise ValueError(
            f"cannot determine editorial files for subjects; start each block in "
            f"column zero: {sorted(missing, key=str)[:3]}"
        )
    return graph, file_of


def validate_file_assignment(store: OAUPStore) -> None:
    """Reject an entity, claim or quantity split between physical files."""
    for claim in store.graph.subjects(OA.about):
        entity = store.graph.value(claim, OA.about)
        if entity in store.file_of and store.file_of.get(claim) != store.file_of[entity]:
            raise ValueError(
                f"{claim} is in {store.file_of.get(claim)}, but its subject is in "
                f"{store.file_of[entity]}"
            )
    for predicate in _QUANTITY_PREDICATES:
        for owner, value in store.graph.subject_objects(predicate):
            if owner in store.file_of and store.file_of.get(value) != store.file_of[owner]:
                raise ValueError(f"quantity {value} is separated from its owner {owner}")


def _path_for_group(store: OAUPStore, directory: str, name: str) -> str:
    key = f"{directory}:{normalise(name)}"
    cached = store._group_files.get(key)
    if cached:
        return cached
    base = f"{directory}/{_slug(name)}"
    path = f"{base}.ttl"
    owner = store._file_groups.get(path)
    if owner is not None and owner != key:
        digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:8]
        path = f"{base}-{digest}.ttl"
    store._group_files[key] = path
    store._file_groups[path] = key
    return path


def _celestia_hidden(store: OAUPStore, entity: URIRef) -> bool:
    claim = next(
        claim
        for claim in store.graph.subjects(OA.about, entity)
        if (claim, RDF.type, OA.CelestiaLocationClaim) in store.graph
        and bool(store.graph.value(claim, OA.canonical))
    )
    curated = next(
        (system for system in store.oa_system_file.systems if system.star == _name(store, entity)),
        None,
    )
    comment = str(store.graph.value(claim, OA.sourceComment) or "")
    if curated and curated.hidden:
        return True
    if any(rule in comment for rule in store.oa_system_file.hide_comment_matching):
        return True
    bound = {world.location.oa_star for world in store.worlds}
    return bool(
        store.oa_system_file.hide_designation_only
        and _name(store, entity) not in bound
        and not store.graph.value(claim, OA.sourceSystemName)
        and not comment
        and _DESIGNATION_ONLY.match(_name(store, entity))
    )


def _name(store: OAUPStore, entity: URIRef) -> str:
    return str(store.graph.value(entity, SKOS.prefLabel) or entity)


def _system_path(store: OAUPStore, name: str) -> str:
    return _path_for_group(store, "systems", name)


def _world_path(store: OAUPStore, entity: URIRef) -> str:
    world = next(world for world in store.worlds if store.world_iris[world.name] == entity)
    location = world.location
    if world.extent or world.kind in {"volume", "hazard", "polity_extent"}:
        return _path_for_group(store, "volumes", world.name)
    if location.world and location.world in store.world_iris:
        return assign_subject_file(store, store.world_iris[location.world])
    if location.oa_star:
        for star in store.graph.subjects(OA.sourceName, Literal(location.oa_star)):
            return assign_subject_file(store, star)
    if world.system:
        return _system_path(store, world.system)
    if world.kind == "system":
        return _system_path(store, world.name)
    if location.star:
        # Reuse an explicitly named system or Inner Sphere file where the
        # existing source designations already agree. Resolved identities from
        # the initial map build are preserved in file_of thereafter.
        for other in store.worlds:
            if (
                other.system
                and other.location.star
                and normalise(other.location.star) == normalise(location.star)
            ):
                return _system_path(store, other.system)
        for claim in store.graph.subjects(RDF.type, OA.InnerSphereClaim):
            source_star = str(store.graph.value(claim, OA.starName) or "")
            if normalise(source_star) == normalise(location.star):
                colony = str(store.graph.value(claim, OA.colonyName) or "")
                if colony not in _EMPTY_CELLS:
                    return _system_path(store, colony)
    return _path_for_group(store, "objects", world.name)


def _celestia_path(store: OAUPStore, entity: URIRef) -> str:
    if _celestia_hidden(store, entity):
        return "imports/celestia-unlabelled.ttl"
    name = _name(store, entity)
    curated = next(
        (system for system in store.oa_system_file.systems if system.star == name), None
    )
    if curated and curated.label:
        name = curated.label
    else:
        claim = next(
            claim
            for claim in store.graph.subjects(OA.about, entity)
            if (claim, RDF.type, OA.CelestiaLocationClaim) in store.graph
            and bool(store.graph.value(claim, OA.canonical))
        )
        name = str(store.graph.value(claim, OA.sourceSystemName) or name)
    return _system_path(store, name)


def _inner_sphere_path(store: OAUPStore, entity: URIRef) -> str:
    claim = next(
        claim
        for claim in store.graph.subjects(OA.about, entity)
        if (claim, RDF.type, OA.InnerSphereClaim) in store.graph
        and bool(store.graph.value(claim, OA.canonical))
    )
    colony = str(store.graph.value(claim, OA.colonyName) or "")
    if colony in _EMPTY_CELLS:
        return "imports/inner-sphere-unlabelled.ttl"
    return _system_path(store, colony)


def assign_subject_file(store: OAUPStore, subject: URIRef) -> str:
    """Choose a file for a new subject, or retain its existing placement."""
    existing = store.file_of.get(subject)
    if existing:
        return existing
    graph = store.graph
    types = set(graph.objects(subject, RDF.type))
    if OA.QuantityValue in types:
        for predicate in _QUANTITY_PREDICATES:
            owner = graph.value(None, predicate, subject)
            if owner is not None:
                return assign_subject_file(store, owner)
        raise ValueError(f"quantity {subject} has no owning claim or entity")
    entity = graph.value(subject, OA.about)
    if entity is not None:
        return assign_subject_file(store, entity)
    if OA.World in types:
        path = _world_path(store, subject)
    elif OA.CelestiaStar in types:
        path = _celestia_path(store, subject)
    elif OA.InnerSphereSystem in types:
        path = _inner_sphere_path(store, subject)
    elif OA.Polity in types:
        path = _path_for_group(store, "polities", _name(store, subject))
    elif OA.Landmark in types:
        path = "catalogue-links/landmarks.ttl"
    elif OA.IdentityAlias in types:
        path = "catalogue-links/aliases.ttl"
    elif OA.ColonyAssignment in types:
        path = "polities/colony-assignments.ttl"
    elif OA.SourceSnapshot in types or subject in set(graph.subjects(OA.locator)):
        path = "sources.ttl"
    elif OA.WormholeClaim in types:
        path = "imports/inner-sphere-wormholes.ttl"
    elif OA.OAUPDataset in types or OA.EditorialNote in types:
        path = "dataset.ttl"
    else:
        raise ValueError(f"no editorial file assignment for {subject}")
    store.file_of[subject] = path
    return path


def partition(store: OAUPStore) -> dict[str, list[tuple[Any, Any, Any]]]:
    files: dict[str, list[tuple[Any, Any, Any]]] = defaultdict(list)
    for triple in store.graph:
        subject = triple[0]
        if not isinstance(subject, URIRef):
            raise ValueError(f"editorial subjects must be named IRIs, got {subject}")
        path = assign_subject_file(store, subject)
        files[path].append(triple)
    return dict(files)


def _term(graph: Any, term: Any, namespaces: list[tuple[str, Any]]) -> str:
    if isinstance(term, URIRef):
        text = str(term)
        for prefix, namespace in namespaces:
            namespace_text = str(namespace)
            local = text.removeprefix(namespace_text)
            if text.startswith(namespace_text) and local and "/" not in local:
                return f"{prefix}:{local}"
        return f"<{text}>"
    if isinstance(term, BNode):
        raise ValueError("blank nodes are not used in the authoritative graph")
    if not isinstance(term, Literal):
        raise TypeError(f"unexpected RDF term {term!r}")
    if term.datatype == XSD.boolean:
        return "true" if bool(term) else "false"
    if term.datatype == XSD.integer:
        return str(int(term))
    if term.datatype == XSD.decimal:
        return str(term)
    text = json.dumps(str(term), ensure_ascii=False)
    if term.language:
        return f"{text}@{term.language}"
    if term.datatype and term.datatype != XSD.string:
        return f"{text}^^{_term(graph, term.datatype, namespaces)}"
    return text


def _subject_block(
    graph: Any, subject: URIRef, namespaces: list[tuple[str, Any]]
) -> str:
    predicates: dict[URIRef, list[Any]] = defaultdict(list)
    for predicate, obj in graph.predicate_objects(subject):
        predicates[predicate].append(obj)
    ordered = sorted(predicates, key=lambda p: (p != RDF.type, str(p)))
    lines: list[str] = []
    for position, predicate in enumerate(ordered):
        label = "a" if predicate == RDF.type else _term(graph, predicate, namespaces)
        objects = ", ".join(
            _term(graph, obj, namespaces)
            for obj in sorted(predicates[predicate], key=str)
        )
        prefix = f"{_term(graph, subject, namespaces)} " if position == 0 else "    "
        ending = " ." if position == len(ordered) - 1 else " ;"
        lines.append(f"{prefix}{label} {objects}{ending}")
    return "\n".join(lines)


def _ordered_subjects(store: OAUPStore, subjects: set[URIRef]) -> list[URIRef]:
    remaining = set(subjects)
    ordered: list[URIRef] = []

    def append_values(owner: URIRef) -> None:
        for predicate in _QUANTITY_PREDICATES:
            for value in sorted(store.graph.objects(owner, predicate), key=str):
                if value in remaining:
                    ordered.append(value)
                    remaining.remove(value)

    roots = [
        subject
        for subject in subjects
        if not store.graph.value(subject, OA.about)
        and (subject, RDF.type, OA.QuantityValue) not in store.graph
    ]
    roots.sort(
        key=lambda subject: (
            str(store.graph.value(subject, OA.kind) or "") != "system",
            _name(store, subject).casefold(),
            str(subject),
        )
    )
    for root in roots:
        if root not in remaining:
            continue
        ordered.append(root)
        remaining.remove(root)
        append_values(root)
        claims = sorted(
            store.graph.subjects(OA.about, root),
            key=lambda claim: (
                min(
                    (
                        _CLAIM_ORDER.get(str(kind).removeprefix(str(OA)), 50)
                        for kind in store.graph.objects(claim, RDF.type)
                    ),
                    default=50,
                ),
                str(claim),
            ),
        )
        for claim in claims:
            if claim in remaining:
                ordered.append(claim)
                remaining.remove(claim)
                append_values(claim)
    ordered.extend(sorted(remaining, key=str))
    return ordered


def _prefix_header(graph: Any, triples: list[tuple[Any, Any, Any]]) -> str:
    available = {
        prefix: str(namespace)
        for prefix, namespace in graph.namespaces()
        if prefix in _PREFIX_ORDER
    }
    used: set[str] = set()
    for triple in triples:
        for term in triple:
            if not isinstance(term, URIRef):
                continue
            for prefix, namespace in available.items():
                local = str(term).removeprefix(namespace)
                if str(term).startswith(namespace) and local and "/" not in local:
                    used.add(prefix)
                    break
    return "\n".join(
        f"@prefix {prefix}: <{available[prefix]}> ."
        for prefix in _PREFIX_ORDER
        if prefix in used
    )


def serialise_files(store: OAUPStore) -> dict[str, str]:
    """Return one deterministic Turtle document per editorial file."""
    documents: dict[str, str] = {}
    namespaces = sorted(
        (
            (prefix, namespace)
            for prefix, namespace in store.graph.namespaces()
            if prefix in _PREFIX_ORDER
        ),
        key=lambda item: len(str(item[1])),
        reverse=True,
    )
    for path, triples in partition(store).items():
        subjects = {triple[0] for triple in triples}
        blocks = []
        for subject in _ordered_subjects(store, subjects):
            label = _name(store, subject)
            is_value = (subject, RDF.type, OA.QuantityValue) in store.graph
            if not store.graph.value(subject, OA.about) and not is_value:
                blocks.append(f"# {label}")
            blocks.append(_subject_block(store.graph, subject, namespaces))
        documents[path] = (
            _prefix_header(store.graph, triples) + "\n\n" + "\n\n".join(blocks) + "\n"
        )
    return documents


def write_files(store: OAUPStore, directory: Path) -> None:
    """Write all current files and remove only stale Turtle outputs."""
    documents = serialise_files(store)
    for path, text in documents.items():
        destination = directory / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or destination.read_text(encoding="utf-8") != text:
            destination.write_text(text, encoding="utf-8", newline="\n")
    for path in directory.rglob("*.ttl"):
        relative = path.relative_to(directory).as_posix()
        if relative not in documents:
            path.unlink()
    store.file_of = {
        subject: path
        for path, triples in partition(store).items()
        for subject, _, _ in triples
    }
