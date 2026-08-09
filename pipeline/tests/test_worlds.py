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
        if found.strip() != entry.name:
            outside.append((entry.name, found.strip()))
        assert entry.centroid_inside == (found.strip() == entry.name), (
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
        back = get_constellation(Galactic(rep).transform_to(ICRS()))
        assert back == world.location.constellation, (
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
