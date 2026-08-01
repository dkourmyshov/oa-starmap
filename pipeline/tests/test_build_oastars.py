"""Tests for the Orion's Arm star dataset.

The load-bearing check is :meth:`TestDistanceUnit.test_ngc_6633_population_lands_in_the_cluster`.
Celestia's ``.stc`` format gives ``Distance`` in light years; reading it as
parsecs would push every star out by 3.26x while still looking entirely
plausible, because nothing else in the file contradicts it. The 52 entries the
add-on places in NGC 6633 are the anchor that settles it: read as light years
they land inside the real cluster, read as parsecs they land three times beyond.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from oastarmap.build.oastars import ARCHIVE_NAME, build_oastars, parse_stc
from oastarmap.paths import DATA_OUT_DIR, SOURCES_DIR
from oastarmap.transform.photometry import spectral_type_to_bv

ARCHIVE = SOURCES_DIR / ARCHIVE_NAME


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    if not ARCHIVE.exists():
        pytest.skip(f"{ARCHIVE} not present; it is downloaded by hand")

    out = tmp_path_factory.mktemp("oastars")
    manifest = build_oastars(ARCHIVE, out_dir=out)
    positions = np.fromfile(out / "oastars.bin", dtype="<f4").reshape(-1, 5)
    names = json.loads((out / "oastars.names.json").read_text(encoding="utf-8"))
    return {
        "dir": out,
        "manifest": manifest,
        "xyz": positions[:, :3],
        "absmag": positions[:, 3],
        "ci": positions[:, 4],
        "names": names,
    }


def _find(built, name: str) -> int:
    for i, entry in enumerate(built["names"]):
        if entry["name"] == name:
            return i
    raise AssertionError(f"OA star not found: {name}")


class TestParser:
    def test_reads_a_plain_entry(self):
        found = parse_stc('123 "Cantor"\n{\n RA 112.654\n Dec -54.842\n Distance 2735.51\n}\n')
        assert found[0]["name"] == "Cantor"
        assert found[0]["RA"] == "112.654"
        assert found[0]["Distance"] == "2735.51"

    def test_survives_crlf(self):
        """Reading from the zip keeps CRLF, which defeats `$` on the header line."""
        found = parse_stc('1 "X"\r\n{\r\n RA 1\r\n Dec 2\r\n Distance 3\r\n}\r\n')
        assert len(found) == 1
        assert found[0]["name"] == "X"

    def test_keeps_the_comment_after_the_name(self):
        """The comments are where the add-on says which system a star is for."""
        text = '1 "JD 10013" #Star for Harmonic Resonance\n{\nRA 1\nDec 2\nDistance 3\n}'
        assert parse_stc(text)[0]["comment"] == "Star for Harmonic Resonance"

    def test_accepts_fields_in_any_order(self):
        found = parse_stc('1 "X"\n{\nSpectralType "G2V"\nAbsMag 4.7\nRA 1\nDec 2\nDistance 3\n}')
        assert found[0]["SpectralType"] == "G2V"
        assert found[0]["AbsMag"] == "4.7"


class TestSpectralColour:
    @pytest.mark.parametrize(
        ("spectral", "low", "high"),
        [
            ("G2V", 0.60, 0.68),  # the Sun is 0.656
            ("A0V", -0.05, 0.05),
            ("M0V", 1.30, 1.50),
            ("B2IV", -0.30, -0.20),
            ("K0V", 0.75, 0.87),
            ("F1v", 0.28, 0.40),  # lowercase luminosity class
        ],
    )
    def test_main_sequence_colours(self, spectral, low, high):
        assert low <= spectral_type_to_bv(spectral) <= high

    @pytest.mark.parametrize("spectral", ["DA2", "T1V", "Q", "", "junk"])
    def test_off_sequence_types_have_no_colour(self, spectral):
        """White dwarfs, brown dwarfs and Celestia's neutron-star Q render white."""
        assert math.isnan(spectral_type_to_bv(spectral))


class TestDistanceUnit:
    def test_ngc_6633_population_lands_in_the_cluster(self, built):
        """The anchor: light years put them inside it, parsecs put them past it."""
        cluster_names = json.loads(
            (DATA_OUT_DIR / "clusters.names.json").read_text(encoding="utf-8")
        )
        geometry = np.fromfile(DATA_OUT_DIR / "clusters.bin", dtype="<f4").reshape(-1, 8)
        i = next(j for j, e in enumerate(cluster_names) if e["name"] == "NGC_6633")
        centre, radius = geometry[i, :3], float(geometry[i, 3])

        offsets = np.linalg.norm(built["xyz"] - centre, axis=1)
        inside = int((offsets <= radius).sum())
        assert inside >= 40, (
            f"only {inside} OA stars fall inside NGC 6633 (radius {radius:.1f} pc); "
            f"the add-on places ~52 there, so Distance is probably being read in "
            f"the wrong unit"
        )

    def test_distances_span_the_expected_range(self, built):
        """50 ly to ~5100 ly, i.e. about 15 pc to 1600 pc."""
        distance = np.linalg.norm(built["xyz"], axis=1)
        assert 10 < distance.min() < 30
        assert 1500 < distance.max() < 1700

    def test_recorded_distance_matches_the_position(self, built):
        distance = np.linalg.norm(built["xyz"], axis=1)
        recorded = np.array([e["distance_pc"] for e in built["names"]])
        assert np.allclose(distance, recorded, rtol=1e-3)


class TestContent:
    def test_every_entry_survives(self, built):
        stats = built["manifest"]["stats"]
        assert stats["accepted"] == stats["total_entries"] == 103

    def test_named_systems_are_present(self, built):
        for name in ("Cantor", "Enigma", "Hiederia", "Pen-y-Ghent", "Geminga"):
            _find(built, name)

    def test_oa_designation_marks_only_oa_numbering(self, built):
        """It must never be read as "this object is fictional"."""
        for entry in built["names"]:
            expected = entry["name"].startswith(("JD ", "YTS "))
            assert entry["oa_designation"] == expected

    def test_real_objects_are_not_claimed_as_invented(self, built):
        """Geminga and Arkab Prior B are real; the flag must not say otherwise."""
        for name in ("Geminga", "Arkab Prior B", "EG 471"):
            assert built["names"][_find(built, name)]["oa_designation"] is False

    def test_off_sequence_stars_carry_the_unknown_colour_sentinel(self, built):
        for name in ("Geminga", "EG 471"):
            assert built["ci"][_find(built, name)] < -50

    def test_name_collisions_are_reported_not_silently_merged(self, built):
        """The add-on reuses one designation for two genuinely different stars.

        "JD 518791" appears in both alottafictionalstars.stc and oastars7.stc at
        617 pc and 157 pc, on opposite sides of the plane. Both are kept, because
        dropping either would discard a position the source asserts — but the
        collision has to be visible, or a duplicated label looks like our bug.
        """
        from collections import Counter

        counts = Counter(e["name"] for e in built["names"])
        duplicated = sorted(name for name, n in counts.items() if n > 1)
        assert duplicated == built["manifest"]["stats"]["name_collisions"]
        assert duplicated == ["JD 518791"]

    def test_colliding_entries_are_distinct_objects(self, built):
        """Confirms they are a source collision, not the same star parsed twice."""
        rows = [i for i, e in enumerate(built["names"]) if e["name"] == "JD 518791"]
        assert len(rows) == 2
        separation = float(np.linalg.norm(built["xyz"][rows[0]] - built["xyz"][rows[1]]))
        assert separation > 100

    def test_nothing_duplicates_the_real_star_catalogue(self, built):
        """A duplicate would draw the same star twice, once as fact and once as fiction."""
        real = json.loads((DATA_OUT_DIR / "stars.names.json").read_text(encoding="utf-8"))
        known = {
            (entry.get(field) or "").strip().lower()
            for entry in real.values()
            for field in ("proper", "bayer", "flam", "gl", "bf")
            if (entry.get(field) or "").strip()
        }
        clashes = [e["name"] for e in built["names"] if e["name"].lower() in known]
        assert clashes == []


class TestBuild:
    def test_rebuild_is_byte_identical(self, built, tmp_path):
        again = build_oastars(ARCHIVE, out_dir=tmp_path)
        for key, entry in built["manifest"]["files"].items():
            first = (built["dir"] / entry["file"]).read_bytes()
            second = (tmp_path / again["files"][key]["file"]).read_bytes()
            assert first == second, f"{key} differs between builds"

    def test_frame_is_declared_heliocentric_parsecs(self, built):
        frame = built["manifest"]["frame"]
        assert frame["name"] == "galactic-cartesian-heliocentric"
        assert frame["unit"] == "pc"

    def test_source_records_the_distance_unit(self, built):
        """The trap is worth stating in the output, not only in the code."""
        assert "light year" in built["manifest"]["source"]["distance_unit"]
