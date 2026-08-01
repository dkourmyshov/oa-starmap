"""Tests for the Inner Sphere colony dataset.

The load-bearing idea is that resolution here is *checkable*. The source gives a
distance for every row, and star names are full of plausible near-misses, so a
match that lands at the wrong distance is caught rather than trusted. See
:class:`TestDistanceVerification`.
"""

from __future__ import annotations

import json

import pytest

from oastarmap.build.inner_sphere import (
    DISTANCE_AGREES,
    DISTANCE_WRONG_STAR,
    INNER_SPHERE_FILE,
    build_inner_sphere,
)
from oastarmap.fiction.starnames import (
    GENITIVE,
    GREEK_NAMES,
    is_absent_catalogue,
    verify_distance,
)
from oastarmap.importers.inner_sphere import parse
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR

SOURCE = FICTION_DIR / INNER_SPHERE_FILE


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    if not SOURCE.exists():
        pytest.skip(f"{SOURCE} not present; run `oastarmap import-inner-sphere`")
    if not (DATA_OUT_DIR / "manifest.json").exists():
        pytest.skip("Star dataset not built: run `oastarmap build`")

    manifest = build_inner_sphere(SOURCE, out_dir=DATA_OUT_DIR)
    colonies = json.loads((DATA_OUT_DIR / "innersphere.json").read_text(encoding="utf-8"))
    return {"manifest": manifest, "colonies": colonies}


class TestParser:
    def test_splits_the_two_tables(self):
        text = (
            "<tr><td>Star</td><td>d</td><td>c</td><td>s</td><td>m</td><td>l</td></tr>"
            "<tr><td>Sol</td><td>0</td><td>Solsys</td><td>G2 V</td><td>1</td><td>1</td></tr>"
            "<h2>The Wormhole Nexus</h2>"
            "<tr><td>Alpha Lyrae</td><td>Aksijaha</td><td>N/A</td>"
            "<td>N/A</td><td>.</td><td>Root</td></tr>"
        )
        parsed = parse(text)
        assert [s["star"] for s in parsed["systems"]] == ["Sol"]
        assert parsed["systems"][0]["colony"] == "Solsys"
        assert [w["star"] for w in parsed["wormholes"]] == ["Alpha Lyrae"]

    def test_rejects_a_page_without_the_nexus_heading(self):
        with pytest.raises(ValueError, match="not found"):
            parse("<tr><td>Sol</td></tr>")


class TestNameTables:
    def test_all_88_constellations_are_present(self):
        assert len(GENITIVE) == 88

    def test_all_24_greek_letters_are_present(self):
        assert len(GREEK_NAMES) == 24

    def test_abbreviations_look_like_iau_forms(self):
        for abbreviation in GENITIVE.values():
            assert 2 <= len(abbreviation) <= 4
            assert abbreviation[0].isupper()

    @pytest.mark.parametrize("name", ["2MASS J0523-1403", "WISE 0855-0714", "Luhman 16 A"])
    def test_absent_catalogues_are_recognised(self, name):
        """No amount of alias work resolves these; HYG has none of them."""
        assert is_absent_catalogue(name)

    @pytest.mark.parametrize("name", ["Gliese 699", "HD 10700", "Alpha Centauri A"])
    def test_ordinary_names_are_not_called_absent(self, name):
        assert not is_absent_catalogue(name)


class TestDistanceVerification:
    def test_agreement_within_tolerance(self):
        assert verify_distance(10.0, 10.5, DISTANCE_AGREES)

    def test_disagreement_beyond_tolerance(self):
        assert not verify_distance(10.0, 30.0, DISTANCE_AGREES)

    def test_sol_is_handled(self):
        """The source puts Sol at 0 ly, which no ratio test can handle."""
        assert verify_distance(0.0, 0.0)
        assert not verify_distance(50.0, 0.0)

    def test_a_wrong_star_is_rejected(self, built):
        """GJ 1150: the source says 77 ly, the catalogue 230."""
        rejected = {r["star"] for r in built["manifest"]["stats"]["rejected_distance"]}
        assert "GJ 1150" in rejected
        assert all(c["star"] != "GJ 1150" for c in built["colonies"])

    def test_a_dated_parallax_is_kept_and_flagged(self, built):
        """Xi Ursae Majoris is 19% out — an old parallax, not a wrong star."""
        flagged = {r["star"] for r in built["manifest"]["stats"]["distance_disagreement"]}
        assert any(name.startswith("Xi Ursae Majoris") for name in flagged)
        kept = {c["star"] for c in built["colonies"]}
        assert any(name.startswith("Xi Ursae Majoris") for name in kept)

    def test_everything_kept_is_within_the_wrong_star_threshold(self, built):
        for report in built["manifest"]["stats"]["distance_disagreement"]:
            ratio = abs(report["catalogue_ly"] - report["source_ly"]) / report["source_ly"]
            assert ratio <= DISTANCE_WRONG_STAR


class TestResolution:
    def test_most_rows_resolve(self, built):
        stats = built["manifest"]["stats"]
        assert stats["resolved"] / stats["total_rows"] > 0.7

    def test_the_nearest_systems_are_named(self, built):
        by_star = {c["star"]: c["colony"] for c in built["colonies"]}
        assert by_star["Sol"] == "Solsys"
        assert by_star["Alpha Centauri A"] == "Cenauri"
        assert by_star["Gliese 699"] == "Barnard's Star"
        assert by_star["Wolf 359"] == "Akela"

    def test_component_letters_resolve(self, built):
        """ "Alpha Centauri A" is "Alp-1 Cen" in the catalogue, not "Alp Cen"."""
        stars = {c["star"] for c in built["colonies"]}
        assert {"Alpha Centauri A", "Alpha Centauri B"} <= stars

    def test_every_method_contributes(self, built):
        methods = built["manifest"]["stats"]["methods"]
        assert methods["bayer/flamsteed"] > 100
        assert methods["Gliese"] > 100
        assert methods["HD"] > 100

    def test_star_indices_are_in_range(self, built):
        count = json.loads((DATA_OUT_DIR / "manifest.json").read_text(encoding="utf-8"))[
            "datasets"
        ]["stars"]["count"]
        for colony in built["colonies"]:
            assert 0 <= colony["star_index"] < count

    def test_absent_catalogues_are_reported_apart(self, built):
        """They are a different problem from a name we failed to parse."""
        absent = built["manifest"]["stats"]["absent_catalogue"]
        assert len(absent) > 20
        assert all(is_absent_catalogue(name) for name in absent)

    def test_wormholes_are_imported_but_not_built(self, built):
        assert built["manifest"]["wormholes"]["count"] == 281
