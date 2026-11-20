"""The authoritative RDF graph, its validation and its import boundaries."""

from __future__ import annotations

import pytest
from rdflib import Literal, URIRef
from rdflib.namespace import RDF, SKOS

from oastarmap.fiction.schema import (
    ColonyAssignment,
    InnerSphereSystem,
    OAStarEntry,
    OASystem,
    Polity,
    Source,
    World,
)
from oastarmap.fiction.store import (
    OA,
    QUDT,
    SRC,
    UNIT,
    OAUPStore,
    load_store,
)
from oastarmap.paths import FICTION_DIR


def test_the_complete_inventory_is_in_one_graph():
    store = load_store()
    assert len(store.worlds) == 681
    assert len(store.stars) == 119
    assert len(store.oa_system_file.systems) == 28
    assert len(store.inner_sphere_file.systems) == 1122
    assert len(store.inner_sphere_file.wormholes) == 281
    assert len(store.colony_file.colonies) == 151
    assert len(store.fiction.polities) == 74
    assert len(store.landmark_file.landmarks) == 8
    assert len(store.alias_file.aliases) == 34


def test_legacy_parallel_stores_are_gone():
    for name in (
        "worlds.yaml", "oa_stars.yaml", "oa_systems.yaml", "inner_sphere.yaml",
        "colonies.yaml", "polities.yaml", "landmarks.yaml", "aliases.yaml",
    ):
        assert not (FICTION_DIR / name).exists()


def test_system_files_group_entities_and_their_claims():
    store = load_store()
    assert store.file_of[store.world_iris["Chorus"]] == "systems/cantor.ttl"
    star = next(store.graph.subjects(OA.sourceName, Literal("Cantor")))
    assert store.file_of[star] == "systems/cantor.ttl"
    for entity in (
        store.world_iris["Shenjing"],
        store.world_iris["Penglai"],
        store.world_iris["Qinglong"],
    ):
        assert store.file_of[entity] == "systems/shenjing.ttl"
    assert store.file_of[store.world_iris["Corambytia Protectorate"]] == (
        "volumes/corambytia-protectorate.ttl"
    )
    with pytest.raises(ValueError, match="as a directory"):
        OAUPStore.load(FICTION_DIR / "oaup" / "systems" / "cantor.ttl")


def test_real_graph_conforms_to_shacl():
    assert "Conforms: True" in load_store().validate()


def test_claims_have_stable_named_iris_and_provenance():
    store = load_store()
    for claim_type in (OA.LocationClaim, OA.EventClaim, OA.InnerSphereClaim):
        for claim in store.graph.subjects(RDF.type, claim_type):
            assert isinstance(claim, URIRef)
    world = next(world for world in store.worlds if world.name == "Beelzebub")
    entity = store.world_iris[world.name]
    location = next(
        claim
        for claim in store.graph.subjects(OA.about, entity)
        if (claim, RDF.type, OA.LocationClaim) in store.graph
    )
    distance = next(store.graph.objects(location, OA.distance))
    assert str(next(store.graph.objects(distance, QUDT.unit))) == str(UNIT.LY)
    assert str(next(store.graph.objects(location, OA.method))) == str(OA.DirectTranscription)
    assert world.location.distance in {"805 ly", "805.0 ly"}


def test_serialisation_is_deterministic(tmp_path):
    store = load_store(fresh=True)
    first = tmp_path / "first"
    second = tmp_path / "second"
    store.save(first)
    store.save(second)

    def contents(root):
        return {
            path.relative_to(root).as_posix(): path.read_bytes()
            for path in root.rglob("*.ttl")
        }

    assert contents(first) == contents(second)
    loaded = OAUPStore.load(first)
    assert len(loaded.graph) == len(store.graph)


def test_project_iris_are_serialised_as_prefixed_names(tmp_path):
    def text_of(root):
        return "\n".join(
            path.read_text(encoding="utf-8") for path in sorted(root.rglob("*.ttl"))
        )

    text = text_of(FICTION_DIR / "oaup")
    for family in ("id", "claim", "value"):
        expanded = f"<https://dkourmyshov.github.io/oa-starmap/{family}/"
        for line in text.splitlines():
            if expanded in line:
                assert line.startswith("@prefix"), f"expanded {family}: IRI: {line}"

    generated = OAUPStore.from_models(
        tmp_path / "oaup", worlds=[World(name="Example", extent="10 ly")]
    )
    generated.save()
    text = text_of(generated.path)
    assert "id:world-example" in text
    assert "value:world-example-extent" in text
    assert "<https://dkourmyshov.github.io/oa-starmap/id/world" not in text


def test_reimport_preserves_curation_and_superseded_evidence(tmp_path):
    source = Source(title="Articles", url="https://example.org/")
    store = OAUPStore.from_models(
        tmp_path / "oaup/",
        stars=[OAStarEntry(
            name="Cantor", ra_deg=112.654, dec_deg=-54.842, distance_ly=2735.51,
            source_file="cantor.stc",
        )],
        systems=[OASystem(
            star="Cantor", label="Cantor", affiliation="caretaker-gods", hidden=True
        )],
        polities=[Polity(
            id="caretaker-gods", name="Caretaker Gods", color="#112233", source="articles"
        )],
        sources={"articles": source},
    )
    old_claim = next(store.graph.subjects(RDF.type, OA.CelestiaLocationClaim))
    store.replace_celestia([OAStarEntry(
        name="Cantor", ra_deg=112.654, dec_deg=-54.842, distance_ly=2700,
        source_file="cantor.stc",
    )])

    assert len(store.stars) == 1
    assert store.stars[0].distance_ly == 2700
    assert store.oa_system_file.systems[0].label == "Cantor"
    assert store.oa_system_file.systems[0].hidden is True
    assert store.graph.value(old_claim, OA.canonical) == Literal(False)
    claims = list(store.graph.subjects(RDF.type, OA.CelestiaLocationClaim))
    assert len(claims) == 2


def test_inner_sphere_reimport_preserves_editorial_assignments(tmp_path):
    store = OAUPStore.from_models(
        tmp_path / "oaup/",
        inner_systems=[InnerSphereSystem(
            star="Sol", colony="Solsys", distance_ly="0"
        )],
        colonies=[ColonyAssignment(colony="Solsys", affiliations=["solsys-organization"])],
        polities=[Polity(
            id="solsys-organization", name="Solsys Organization", color="#112233"
        )],
    )
    old_claim = next(store.graph.subjects(RDF.type, OA.InnerSphereClaim))
    counts = store.replace_inner_sphere(
        [InnerSphereSystem(star="Sol", colony="Solsys", distance_ly="0.0")], []
    )
    assert counts == {"systems": 1, "wormholes": 0}
    assert store.inner_sphere_file.systems[0].distance_ly == "0.0"
    assert store.colony_file.colonies[0].affiliations == ["solsys-organization"]
    assert store.graph.value(old_claim, OA.canonical) == Literal(False)


def test_shacl_rejects_an_incomplete_event(tmp_path):
    store = OAUPStore.from_models(tmp_path / "oaup/")
    event = URIRef("https://example.org/incomplete-event")
    store.graph.add((event, RDF.type, OA.EventClaim))
    store.graph.add((event, OA.yearAT, Literal(3000)))
    store.graph.add((event, OA.canonical, Literal(True)))
    try:
        store.validate(FICTION_DIR / "shapes.ttl")
    except ValueError as error:
        assert "Conforms: False" in str(error)
        assert "oa:eventKind" in str(error)
        assert "oa:precision" in str(error)
    else:
        raise AssertionError("an event without its subject, kind and precision validated")


def test_preferred_names_are_not_repository_filenames():
    store = load_store()
    for entity in store.graph.subjects(RDF.type, OA.World):
        assert str(next(store.graph.objects(entity, SKOS.prefLabel)))
    assert str(next(store.graph.objects(SRC["celestia-addons"], OA.terms))).startswith(
        "https://www.orionsarm.com/"
    )
