"""Worlds located by distance and constellation.

The risk this file guards is quiet: a constellation centroid or a unit slip
produces a position that is wrong by hundreds of light years while still looking
entirely plausible on the map. Nothing about a dot says which constellation it
landed in, so the check has to be made here.
"""

from __future__ import annotations

import astropy.units as u
import numpy as np
import pytest
from astropy.coordinates import ICRS, CartesianRepresentation, Galactic, get_constellation

from oastarmap.build.worlds import approximate_extent_ly
from oastarmap.fiction.schema import ConstellationFile, WorldFile, parse_distance
from oastarmap.paths import FICTION_DIR
from oastarmap.transform.frame import PC_TO_LY, STORAGE_UNIT, icrs_to_galactic_xyz

#: Published IAU areas, to catch a table built from a bad sky sampling.
KNOWN_AREAS = {
    "Hydra": 1302.8,
    "Virgo": 1294.4,
    "Ursa Major": 1279.7,
    "Canis Major": 380.1,
    "Crux": 68.4,
}


@pytest.fixture(scope="module")
def constellations() -> dict[str, object]:
    return ConstellationFile.load(FICTION_DIR / "constellations.yaml").by_name()


def test_table_covers_the_whole_sky(constellations: dict) -> None:
    entries = ConstellationFile.load(FICTION_DIR / "constellations.yaml").constellations
    assert len(entries) == 88
    total = sum(entry.area_sq_deg for entry in entries)
    # The sphere is 41,253 square degrees; sampling error should be far below 1%.
    assert total == pytest.approx(41253.0, rel=0.001)


@pytest.mark.parametrize(("name", "area"), sorted(KNOWN_AREAS.items()))
def test_areas_match_the_published_values(constellations: dict, name: str, area: float) -> None:
    assert constellations[name.casefold()].area_sq_deg == pytest.approx(area, rel=0.01)


def test_centres_fall_inside_their_own_constellation() -> None:
    """A centroid landing in the neighbouring figure would place worlds there.

    Serpens genuinely cannot pass: it is the one constellation in the sky made of
    two disjoint halves, Caput and Cauda, with Ophiuchus between them, so its
    centre of area is in Hercules. That is a fact about the sky, not a bug, and
    the table flags it so the build refuses to place a world there rather than
    silently putting it 37 degrees from where the source meant.

    The assertion is that Serpens is the *only* one. Any other constellation
    turning up here would mean the sampling or the centroid had gone wrong.
    """
    entries = ConstellationFile.load(FICTION_DIR / "constellations.yaml").constellations
    outside = []
    for entry in entries:
        found = str(get_constellation(ICRS(ra=entry.ra_deg * u.deg, dec=entry.dec_deg * u.deg)))
        # Against both spellings: astropy misspells three of the eighty-eight
        # and this project stores the corrected form.
        itself = {entry.name, entry.source_name} - {""}
        if found.strip() not in itself:
            outside.append((entry.name, found.strip()))
        assert entry.centroid_inside == (found.strip() in itself), (
            f"{entry.name} flagged centroid_inside={entry.centroid_inside} "
            f"but its centre is in {found.strip()}"
        )

    assert outside == [("Serpens", "Hercules")], (
        f"expected only Serpens to have its centre outside itself, got {outside}"
    )


def test_a_world_cannot_be_placed_in_serpens() -> None:
    """The refusal that flag buys, exercised rather than assumed."""
    from oastarmap.build.worlds import _direction
    from oastarmap.fiction.schema import World, WorldLocation

    table = ConstellationFile.load(FICTION_DIR / "constellations.yaml").by_name()
    world = World(
        name="Nowhere",
        location=WorldLocation(constellation="Serpens", distance="1000 ly"),
    )
    with pytest.raises(ValueError, match="falls outside itself"):
        _direction(world, table)


def test_names_survive_the_yaml_round_trip() -> None:
    """astropy stores "Crux " with a trailing space; YAML would drop it.

    Left unstripped at import, the stored name and the name astropy returns stop
    matching, and every check that compares them silently fails open.
    """
    table = ConstellationFile.load(FICTION_DIR / "constellations.yaml").by_name()
    assert "crux" in table
    assert table["crux"].name == "Crux"
    assert table["cru"].name == "Crux"


def test_every_world_lands_in_the_constellation_it_names() -> None:
    """The round trip that matters: name in, coordinates out, name back.

    This is the check the map itself cannot make. It converts each
    constellation-located world exactly as the build does, then asks astropy
    which constellation the resulting direction is in — so a wrong centroid, a
    swapped RA and Dec, or a light-year read as a parsec all show up as the
    wrong name coming back.
    """
    worlds = WorldFile.load(FICTION_DIR / "worlds.yaml").worlds
    table = ConstellationFile.load(FICTION_DIR / "constellations.yaml").by_name()

    checked = 0
    for world in worlds:
        if world.location.method != "constellation":
            continue
        entry = table[world.location.constellation.casefold()]
        distance = parse_distance(world.location.distance)
        x, y, z = icrs_to_galactic_xyz(
            np.array([entry.ra_deg]) * u.deg,
            np.array([entry.dec_deg]) * u.deg,
            np.array([distance.to_value(u.lyr)]) * u.lyr,
        )
        rep = CartesianRepresentation(x[0], y[0], z[0])
        back = str(get_constellation(Galactic(rep).transform_to(ICRS()))).strip()
        # Compared against the entry, not the written name, because three of
        # astropy's names are misspelled and this file corrects them.
        expected = {entry.name, entry.source_name} - {""}
        assert back in expected, (
            f"{world.name} is said to be in {world.location.constellation} "
            f"but its built position is in {back}"
        )

        # And the radius survives the trip, which is the half of the position
        # the source actually pinned down.
        built = float(np.sqrt(x[0] ** 2 + y[0] ** 2 + z[0] ** 2).to_value(STORAGE_UNIT))
        assert built == pytest.approx(distance.to_value(STORAGE_UNIT), rel=1e-6)
        checked += 1

    assert checked >= 5, "expected several constellation-located worlds to check"


def test_distance_literals_must_carry_a_unit() -> None:
    assert parse_distance("805 ly").to_value(u.lyr) == pytest.approx(805.0)
    assert parse_distance("250 pc").to_value(u.pc) == pytest.approx(250.0)
    # The whole point: a bare number is the one thing that must not parse.
    with pytest.raises(ValueError, match="must be a number with a unit"):
        parse_distance("805")


def test_light_years_and_parsecs_do_not_silently_swap() -> None:
    """805 ly is 247 pc; reading one as the other misplaces a world by 3.26x."""
    assert parse_distance("805 ly").to_value(u.pc) == pytest.approx(805 / PC_TO_LY, rel=1e-6)
    assert parse_distance("805 pc").to_value(u.pc) == pytest.approx(805.0)


def test_direction_error_grows_with_distance() -> None:
    """The reason a constellation is a worse position further out."""
    near = approximate_extent_ly(100.0, 13.94)
    far = approximate_extent_ly(1000.0, 13.94)
    assert far == pytest.approx(near * 10, rel=1e-6)
    # Canis Major at Beelzebub's 805 ly is a couple of hundred ly across.
    assert approximate_extent_ly(805 / PC_TO_LY, 13.94) == pytest.approx(200, abs=5)


def test_exact_positions_claim_no_error() -> None:
    worlds = WorldFile.load(FICTION_DIR / "worlds.yaml").worlds
    by_name = {w.name: w for w in worlds}
    # Macrystis is the one world given real coordinates rather than a region.
    assert by_name["Macrystis"].location.method == "direction"
    assert by_name["Macrystis"].location.ra_deg is not None


def test_a_location_cannot_use_two_methods() -> None:
    from pydantic import ValidationError

    from oastarmap.fiction.schema import WorldLocation

    with pytest.raises(ValidationError, match="only one of"):
        WorldLocation(hip=99240, constellation="Pavo", distance="20 ly")


def test_a_sky_location_needs_a_distance() -> None:
    from pydantic import ValidationError

    from oastarmap.fiction.schema import WorldLocation

    with pytest.raises(ValidationError, match="needs a distance"):
        WorldLocation(constellation="Canis Major")


def test_dated_history_is_ordered_and_derived() -> None:
    """The two summary years are derived, and must agree with the events.

    They are what a historical view of the sphere would be drawn from, and they
    are computed rather than authored precisely so that editing a date cannot
    leave a stale summary behind. This checks the derivation against the events
    it came from, for every world.
    """
    import json

    from oastarmap.build.worlds import PRESENCE_KINDS, _certain_by
    from oastarmap.paths import DATA_OUT_DIR

    path = DATA_OUT_DIR / "worlds.json"
    if not path.exists():
        pytest.skip("dataset not built")

    for world in json.loads(path.read_text(encoding="utf-8")):
        events = world["events"]
        years = [e["year_at"] for e in events]
        assert years == sorted(years), f"{world['name']} events are not in order"

        # The safe end of each hedge, not the bare year: "between 1500 and
        # 2100" is only certain by 2100.
        presence = [_certain_by(e) for e in events if e["kind"] in PRESENCE_KINDS]
        assert world["known_from_at"] == (min(presence) if presence else None)

        settled = [_certain_by(e) for e in events if e["kind"] == "settled"]
        assert world["settled_at"] == (min(settled) if settled else None)

        # A place cannot be settled before anyone has been there.
        if world["settled_at"] is not None:
            assert world["known_from_at"] is not None
            assert world["known_from_at"] <= world["settled_at"]


def test_a_reported_discovery_still_dates_the_world() -> None:
    """Stanislaw's only date is a report, and it must still place it in time.

    The report is an upper bound — the discovery it reports happened in the
    9700s — but excluding it left the world with no date at all, which is a
    worse answer than a late one.
    """
    import json

    from oastarmap.paths import DATA_OUT_DIR

    path = DATA_OUT_DIR / "worlds.json"
    if not path.exists():
        pytest.skip("dataset not built")

    worlds = {w["name"]: w for w in json.loads(path.read_text(encoding="utf-8"))}
    assert worlds["Stanislaw"]["known_from_at"] == 9920
    assert worlds["Stanislaw"]["settled_at"] is None

    # And a world whose articles give no date stays undated rather than guessing.
    assert worlds["Sand"]["known_from_at"] is None
    assert worlds["Macrystis"]["known_from_at"] is None


def test_affiliation_is_the_present_holder() -> None:
    """Kalii passed from a Caretaker to the Non-Coercive Zone in 4323.

    The history is kept as events; the affiliation is who holds it now. Without
    that rule an entry would silently record whichever owner was transcribed
    first.
    """
    worlds = {w.name: w for w in WorldFile.load(FICTION_DIR / "worlds.yaml").worlds}
    kalii = worlds["Kalii"]
    assert kalii.affiliations == ["nocozo"]
    assert [(e.year_at, e.kind) for e in kalii.events] == [
        (3780, "stewardship"),
        (4323, "transferred"),
    ]


def test_event_kinds_are_a_closed_vocabulary() -> None:
    from pydantic import ValidationError

    from oastarmap.fiction.schema import WorldEvent

    assert WorldEvent(year_at=3709, kind="settled").kind == "settled"
    with pytest.raises(ValidationError, match="event kind must be one of"):
        WorldEvent(year_at=3709, kind="colonised")


def test_a_world_can_be_held_by_several_polities() -> None:
    """Errai is held jointly, and recording one holder would be a silent choice.

    The field is a list for the same reason the colony table's is: the setting
    has shared systems, and picking whichever partner was transcribed first
    would look exactly like a fact.
    """
    worlds = {w.name: w for w in WorldFile.load(FICTION_DIR / "worlds.yaml").worlds}
    assert worlds["Anomie"].affiliations == ["communion-of-worlds", "sophic-league"]


def test_every_affiliation_names_a_known_polity() -> None:
    """A typo here would silently drop a world's colour rather than failing."""
    from oastarmap.fiction.schema import FictionFile

    known = {p.id for p in FictionFile.load(FICTION_DIR / "polities.yaml").polities}
    for world in WorldFile.load(FICTION_DIR / "worlds.yaml").worlds:
        for affiliation in world.affiliations:
            assert affiliation in known, f"{world.name} cites unknown polity {affiliation!r}"


def test_worlds_bound_to_a_star_are_bound_to_a_real_one() -> None:
    """The build reports unresolved bindings rather than raising, so check them.

    A binding that silently fails leaves the world undrawn and its polity
    uncoloured, which looks like the setting having nothing to say rather than
    like a resolution failure.
    """
    import json

    from oastarmap.paths import DATA_OUT_DIR

    path = DATA_OUT_DIR / "worlds.json"
    if not path.exists():
        pytest.skip("dataset not built")

    unresolved = [
        w["name"]
        for w in json.loads(path.read_text(encoding="utf-8"))
        if w["method"] == "star" and w["star_index"] is None
    ]
    assert unresolved == [], f"star bindings that resolved to nothing: {unresolved}"


def test_hedged_years_resolve_to_the_safe_end() -> None:
    """A historical map must not show a place before the sources support it.

    The sources hedge in several ways and they do not all mean the same thing.
    "Between 1500 and 2100" is certain only by 2100; "before 1644" is certain by
    1644; a span that ran 4496 to 4530 had already begun in 4496. Taking the
    optimistic end of each would put places on the map centuries early.
    """
    from oastarmap.build.worlds import _certain_by

    assert _certain_by({"year_at": 2245, "until_at": None, "precision": "exact"}) == 2245
    assert _certain_by({"year_at": 3000, "until_at": None, "precision": "circa"}) == 3000
    assert _certain_by({"year_at": 1644, "until_at": None, "precision": "not_later_than"}) == 1644
    assert _certain_by({"year_at": 1500, "until_at": 2100, "precision": "between"}) == 2100
    # A duration, not an uncertainty: it began in 4496.
    assert _certain_by({"year_at": 4496, "until_at": 4530, "precision": "exact"}) == 4496


def test_a_between_event_needs_both_ends() -> None:
    from pydantic import ValidationError

    from oastarmap.fiction.schema import WorldEvent

    with pytest.raises(ValidationError, match="needs until_at"):
        WorldEvent(year_at=1500, kind="settled", precision="between")
    with pytest.raises(ValidationError, match="precision must be one of"):
        WorldEvent(year_at=1500, kind="settled", precision="roughly")


def test_constellation_misspellings_are_corrected_but_still_findable() -> None:
    """astropy's table misspells three of the eighty-eight.

    Chamaleon, Ophiucus and Pisces Austrinus, against the IAU's Chamaeleon,
    Ophiuchus and Piscis Austrinus. An author writing the correct name should
    not get a build failure, and a check comparing against get_constellation
    should still match.
    """
    table = ConstellationFile.load(FICTION_DIR / "constellations.yaml").by_name()
    for correct, astropy_spelling in (
        ("Chamaeleon", "Chamaleon"),
        ("Ophiuchus", "Ophiucus"),
        ("Piscis Austrinus", "Pisces Austrinus"),
    ):
        assert correct.casefold() in table, f"{correct} not findable"
        assert astropy_spelling.casefold() in table, f"{astropy_spelling} not findable"
        assert table[correct.casefold()].name == correct
        assert table[astropy_spelling.casefold()].name == correct


def test_a_constellation_can_be_written_without_its_accent() -> None:
    table = ConstellationFile.load(FICTION_DIR / "constellations.yaml").by_name()
    assert table["bootes"].name == "Boötes"
    assert table["boötes"].name == "Boötes"


def test_a_world_can_share_another_world_s_position() -> None:
    """Potato is a habitat in the Bonfire System, which has no catalogue star.

    Copying Bonfire's coordinates into Potato's entry would put two markers on
    one point and let them drift apart the first time either was corrected.
    """
    import json

    from oastarmap.paths import DATA_OUT_DIR

    path = DATA_OUT_DIR / "worlds.json"
    if not path.exists():
        pytest.skip("dataset not built")

    worlds = {w["name"]: w for w in json.loads(path.read_text(encoding="utf-8"))}
    potato, bonfire = worlds["Potato"], worlds["The Bonfire System"]
    assert potato["method"] == "world"
    assert potato["in_world"] == "The Bonfire System"
    for key in ("x", "y", "z", "distance_pc"):
        assert potato[key] == bonfire[key], f"{key} did not follow the host"


def test_a_shared_position_must_name_a_world_that_has_one() -> None:
    from oastarmap.build.worlds import build_worlds

    source = FICTION_DIR / "worlds.yaml"
    text = source.read_text(encoding="utf-8")
    broken = text + (
        "\n  - name: Nowhere Habitat\n"
        "    kind: habitat\n"
        "    affiliations: []\n"
        "    location:\n"
        "      world: A System That Does Not Exist\n"
    )
    scratch = source.with_name("worlds.broken.yaml")
    scratch.write_text(broken, encoding="utf-8")
    try:
        with pytest.raises(ValueError, match="which is not in this file"):
            build_worlds(scratch)
    finally:
        scratch.unlink()


def test_an_ending_is_not_a_presence_date() -> None:
    """Hoopworld disintegrated in 10580 and nothing records when it was built.

    Counting the ending as a presence year would put it on a historical map in
    the year it vanished, which is the one year it certainly was not there.
    """
    import json

    from oastarmap.paths import DATA_OUT_DIR

    path = DATA_OUT_DIR / "worlds.json"
    if not path.exists():
        pytest.skip("dataset not built")

    worlds = {w["name"]: w for w in json.loads(path.read_text(encoding="utf-8"))}
    hoopworld = worlds["Hoopworld"]
    assert hoopworld["ended_at"] == 10580
    assert hoopworld["known_from_at"] is None
    assert hoopworld["settled_at"] is None

    # And a place that never ended carries no ending.
    assert worlds["Halcyon"]["ended_at"] is None
