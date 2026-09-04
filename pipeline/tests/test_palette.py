"""The polity palette, measured rather than eyeballed.

Every polity is told apart by colour alone on this map, so two entries having
different hex codes proves nothing. Two pairs were once byte-identical — four
polities rendering as two colours — and neither reading the file nor looking at
the map made it obvious, because the map draws these as thin rings and small
words scattered across a dark field.
"""

from __future__ import annotations

import pytest

from oastarmap.fiction.color import distance
from oastarmap.fiction.schema import FictionFile
from oastarmap.paths import FICTION_DIR

#: Below this two colours are the same colour to look at.
#:
#: CIEDE2000's just-noticeable difference is about 2.3 for two patches side by
#: side. This map never shows them side by side, so the real threshold is far
#: higher — but a floor of 2.3 is the one that can be defended from the standard
#: rather than from taste, and it catches the failure that actually happened.
INDISTINGUISHABLE = 2.3


@pytest.fixture(scope="module")
def polities() -> list:
    return FictionFile.load(FICTION_DIR / "polities.yaml").polities


def test_no_two_polities_share_a_colour(polities: list) -> None:
    collisions = []
    for i, first in enumerate(polities):
        for second in polities[i + 1 :]:
            separation = distance(first.color, second.color)
            if separation < INDISTINGUISHABLE:
                collisions.append(
                    f"{first.name} {first.color} and {second.name} {second.color} "
                    f"differ by only dE {separation:.1f}"
                )
    assert collisions == [], "; ".join(collisions)


#: How far apart two polities' objects must typically be before their colours
#: stop mattering, in light years.
#:
#: Below this they are seen together and must be told apart; above it they never
#: share a view. The threshold is generous because the map is flown through
#: rather than read at one scale.
NEIGHBOURING_LY = 900.0

#: Below this many recorded objects, a polity's extent cannot be measured.
#:
#: The Seams is a border polity and diffuse by definition, yet one of its
#: systems is recorded. Cyberia is an encrypted overlay network spread through
#: everyone else's space while owning few worlds outright. Measuring proximity
#: from what we hold would report both as far from everything, so a polity this
#: sparse is treated as adjacent to all — thin data should tighten the guard,
#: not silence it.
SPARSE = 5

#: The floor for two polities that do share space.
#:
#: Well above the just-noticeable difference, because these are thin rings and
#: small words on a dark field rather than adjacent patches. Set just under the
#: closest surviving pair, so it holds the line without demanding a repaint.
NEIGHBOUR_FLOOR = 8.5


def test_polities_that_share_space_are_told_apart() -> None:
    """The check that matters, and the one a global comparison gets wrong.

    Two purple polities on opposite sides of the Terragen sphere are never seen
    together and cannot be confused — Emple-Dokcetics and the Sagittarius
    Transcultural Cooperation are exactly that. Two yellows sharing the Inner
    Sphere are a real problem however far apart a colour wheel puts them, which
    is what the Solar Dominion and the Solsys Organization were at dE 3.0 while
    interpenetrating.

    So proximity is measured from the built data and colour distance is only
    demanded of pairs that meet.
    """
    import json

    import numpy as np

    from oastarmap.paths import DATA_OUT_DIR
    from oastarmap.transform.frame import PC_TO_LY

    if not (DATA_OUT_DIR / "fiction.json").exists():
        pytest.skip("dataset not built")

    def load(name: str):
        return json.loads((DATA_OUT_DIR / name).read_text(encoding="utf-8"))

    stars = np.fromfile(DATA_OUT_DIR / "stars.bin", dtype="<f4").reshape(-1, 5)[:, :3]
    clusters = np.fromfile(DATA_OUT_DIR / "clusters.bin", dtype="<f4").reshape(-1, 8)[:, :3]
    hii = np.fromfile(DATA_OUT_DIR / "hii.bin", dtype="<f4").reshape(-1, 7)[:, :3]
    fiction = load("fiction.json")

    points: dict[str, list] = {}
    catalogues = {"cluster": clusters, "hii": hii, "star": stars}
    for binding in fiction["bindings"]:
        source = catalogues.get(binding["kind"] or "")
        if not binding["resolved"] or source is None:
            continue
        for pid in binding["polities"]:
            points.setdefault(pid, []).append(source[binding["index"]])
    for row in load("innersphere.json"):
        for pid in row["affiliations"]:
            points.setdefault(pid, []).append(stars[row["star_index"]])
    for world in load("worlds.json"):
        if world["star_index"] is not None:
            here = stars[world["star_index"]]
        elif world["x"] is not None:
            here = np.array([world["x"], world["y"], world["z"]], dtype="f4")
        else:
            continue
        for pid in world["affiliations"]:
            points.setdefault(pid, []).append(here)
        # A past holder is drawn at the same place in history mode, and can be
        # confused with its neighbours there just as a present one can.
        for event in world["events"]:
            if event.get("polity"):
                points.setdefault(event["polity"], []).append(here)

    colours = {p["id"]: p["color"] for p in fiction["polities"]}
    held = {pid: np.array(v) for pid, v in points.items()}

    source = FictionFile.load(FICTION_DIR / "polities.yaml")
    apart = {frozenset(pair) for pair in source.never_adjacent}

    def typical_separation(a, b) -> float:
        grid = np.linalg.norm(a[:, None, :] - b[None, :, :], axis=2) * PC_TO_LY
        return float(np.median(np.concatenate([grid.min(axis=1), grid.min(axis=0)])))

    ids = sorted(colours)
    too_close = []
    for i, first in enumerate(ids):
        for second in ids[i + 1 :]:
            if frozenset((first, second)) in apart:
                continue

            here, there = held.get(first), held.get(second)
            # A polity drawn nowhere — entered so that an event can name it,
            # and named by none yet — meets nothing and cannot be confused
            # with anything. It joins the check when its first event lands.
            if here is None or there is None:
                continue
            measurable = (
                here is not None
                and there is not None
                and len(here) >= SPARSE
                and len(there) >= SPARSE
            )
            if measurable and typical_separation(here, there) > NEIGHBOURING_LY:
                continue

            separation = distance(colours[first], colours[second])
            if separation < NEIGHBOUR_FLOOR:
                why = "share space" if measurable else "cannot be shown apart"
                too_close.append(f"{first} and {second} {why} at dE {separation:.1f}")
    assert too_close == [], "; ".join(too_close)


def test_the_pairs_that_were_reported_are_separated(polities: list) -> None:
    """Solar against Keter, and Metasoft against its true nearest neighbour.

    Keter was 8.1 from the Solar Dominion, and Metasoft 4.2 from the Zoeific
    Biopolity — which was the closer collision of the two and the one nobody had
    noticed, the pair sitting within half a degree of the same hue.
    """
    by_id = {p.id: p.color for p in polities}
    assert distance(by_id["solar-dominion"], by_id["keter-dominion"]) > 11
    # The worst pair on the map, and one nobody reported: both sit in and around
    # Sol, so they are always seen together.
    assert distance(by_id["solar-dominion"], by_id["solsys-organization"]) > 20
    assert distance(by_id["metasoft"], by_id["zoeific-biopolity"]) > 9
    assert distance(by_id["metasoft"], by_id["mutual-progress-association"]) > 9


def test_distance_is_perceptual_rather_than_numeric() -> None:
    """The reason a hex comparison would not have caught any of this.

    The Solar Dominion and the Solsys Organization differ in every channel and
    are the same colour to look at. Two colours a similar number of sRGB steps
    apart in a different direction are plainly different.
    """
    assert distance("#FFEE58", "#FFF176") < 4
    assert distance("#FFEE58", "#FFD54F") > 7
    assert distance("#000000", "#FFFFFF") > 90
    assert distance("#FFD54F", "#FFD54F") == pytest.approx(0.0)
