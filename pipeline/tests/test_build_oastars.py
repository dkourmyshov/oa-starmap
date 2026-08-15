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

from oastarmap.build.oastars import STARS_FILE, OAStarStats, _place, build_oastars
from oastarmap.fiction.schema import OAStarFile
from oastarmap.importers.celestia import parse_stc, system_name
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR
from oastarmap.transform.photometry import spectral_type_to_bv

STARS = FICTION_DIR / STARS_FILE


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    if not STARS.exists():
        pytest.skip(f"{STARS} not present; run `oastarmap import-oastars`")

    out = tmp_path_factory.mktemp("oastars")
    manifest = build_oastars(STARS, out_dir=out)
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
        """4.2 ly to ~5100 ly, i.e. about 1.3 pc to 1600 pc.

        The floor used to be 15 pc, which was a fact about which archives had
        been read rather than about the add-on: importing all of them brings in
        its own Proxima Centauri at 4.2 ly, a real star it redeclares.

        The ceiling is what guards the unit trap either way. Reading Distance as
        parsecs rather than light years would put the furthest entry past
        5,000 pc instead of at 1,600.
        """
        distance = np.linalg.norm(built["xyz"], axis=1)
        assert 1.0 < distance.min() < 2.0
        assert 1500 < distance.max() < 1700

    def test_recorded_distance_matches_the_position(self, built):
        distance = np.linalg.norm(built["xyz"], axis=1)
        recorded = np.array([e["distance_pc"] for e in built["names"]])
        assert np.allclose(distance, recorded, rtol=1e-3)


class TestContent:
    def test_every_entry_survives(self, built):
        stats = built["manifest"]["stats"]
        assert stats["accepted"] == stats["total_entries"] == 119

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
        again = build_oastars(STARS, out_dir=tmp_path)
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


class TestSystemNames:
    """The designations name nothing; the comments attached to them do."""

    @pytest.mark.parametrize(
        ("comment", "expected"),
        [
            ("Star for Harmonic Resonance", "Harmonic Resonance"),
            ("star for Blue", "Blue"),
            ("Star for system containing Redunin", "Redunin"),
            ("G3  star for Wurm", "Wurm"),
            ("F1  star for Pluton", "Pluton"),
        ],
    )
    def test_extracts_the_system(self, comment, expected):
        assert system_name(comment) == expected

    @pytest.mark.parametrize(
        "comment",
        [
            "Star in cluster NGC 6633",  # where it is, not what it serves
            "Brown Dwarf in the Stellar Umma Region",
            "",
        ],
    )
    def test_ignores_comments_that_are_not_about_a_system(self, comment):
        assert system_name(comment) == ""

    def test_the_known_systems_are_recovered(self, built):
        systems = {e["system"] for e in built["names"] if e["system"]}
        assert systems == {
            "Blue",
            # From Cenote.zip, unread until every archive was imported. The
            # comment names two systems sharing one sun, and is copied as it
            # stands rather than guessed apart.
            "Cenote and Sequence",
            "Guanche",
            "Harmonic Resonance",
            "Heimat",
            "Muuhhome",
            "Niuearth",
            "Oshiq",
            "Panthalassa",
            "Pluton",
            "Redunin",
            "To'ul'h",
            "Wurm",
        }

    def test_the_toulh_home_system_is_present(self, built):
        """The To'ul'h home system, annotated inside the braces rather than on
        the header line — which is how five systems went missing."""
        entry = next(e for e in built["names"] if e["system"] == "To'ul'h")
        assert entry["name"] == "JD 870135"
        assert 370 < entry["distance_pc"] < 390

    def test_the_ngc_6633_population_is_annotated(self, built):
        """52 stars clumped in one cluster look unexplained without this."""
        members = [e for e in built["names"] if "NGC 6633" in e["comment"]]
        assert len(members) == 52

    def test_cluster_members_get_no_system(self, built):
        """Fifty stars labelled "NGC 6633" would be worse than none."""
        for entry in built["names"]:
            if "cluster" in entry["comment"].lower():
                assert entry["system"] == ""


class TestInBodyComments:
    """Comments sit on the header line in some entries and inside the braces in
    others. Reading only the header dropped the To'ul'h home system, four more
    named systems, and the 52 notes marking the NGC 6633 population."""

    def test_reads_a_comment_from_inside_the_braces(self):
        text = (
            '1 "JD 870135"\n{\n'
            " RA 277.352  # Star for system containing To'ul'h\n"
            " Dec 6.542\n Distance 1235.51\n}"
        )
        assert parse_stc(text)[0]["comment"] == "Star for system containing To'ul'h"

    def test_keeps_both_header_and_body_comments(self):
        text = '1 "X" # header note\n{\n RA 1  # body note\n Dec 2\n Distance 3\n}'
        assert parse_stc(text)[0]["comment"] == "header note; body note"

    def test_does_not_repeat_an_identical_comment(self):
        text = '1 "X" # same\n{\n RA 1  # same\n Dec 2\n Distance 3\n}'
        assert parse_stc(text)[0]["comment"] == "same"

    def test_no_comment_stays_empty(self):
        assert parse_stc('1 "X"\n{\n RA 1\n Dec 2\n Distance 3\n}')[0]["comment"] == ""


class TestTrackedImport:
    """The star file is tracked, so the build must not need the archive."""

    def test_the_source_file_is_tracked(self):
        import subprocess

        listed = subprocess.run(
            ["git", "ls-files", "fiction/oa_stars.yaml"],
            capture_output=True,
            text=True,
            cwd=STARS.parents[1],
            check=False,
        ).stdout.strip()
        assert listed == "fiction/oa_stars.yaml", (
            "fiction/oa_stars.yaml is not tracked; a clean clone could not build "
            "the Orion's Arm star layer"
        )

    def test_the_file_carries_its_provenance(self):
        """Attribution travels with the data, not only in the pipeline."""
        header = STARS.read_text(encoding="utf-8")[:2000]
        assert "OAAddons1" in header
        assert "orionsarm.com" in header
        assert "Terms_Copyright" in header
        assert "light years" in header

    def test_import_round_trips_the_archive_exactly(self):
        """A %g format silently turned RA 290.6596 into 290.66."""
        import zipfile

        from oastarmap.importers.celestia import read_archive
        from oastarmap.paths import SOURCES_DIR

        archive = SOURCES_DIR / "OAAddons1.zip"
        if not archive.exists():
            pytest.skip("archive not present; it is downloaded by hand")

        imported = {(s.name, s.source_file): s for s in OAStarFile.load(STARS).stars}
        checked = 0
        with zipfile.ZipFile(archive) as handle:
            for record in read_archive(archive):
                entry = imported[(record["name"], record["source_file"])]
                assert entry.ra_deg == record["ra_deg"]
                assert entry.dec_deg == record["dec_deg"]
                assert entry.distance_ly == record["distance_ly"]
                checked += 1
            assert handle  # archive stayed readable throughout
        assert checked == 103

    def test_a_non_positive_distance_is_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="must be positive"):
            OAStarFile.model_validate(
                {"stars": [{"name": "X", "ra_deg": 1, "dec_deg": 2, "distance_ly": 0}]}
            )


class TestCuration:
    """fiction/oa_systems.yaml is hand-authored and never overwritten by import."""

    def test_every_assignment_lands(self, built):
        curated = {e["label"]: e for e in built["names"] if e["affiliation"]}
        assert curated["H'tat'sa'thoss"]["affiliation"] == "caretaker-gods"
        assert curated["Wadai"]["affiliation"] == "sophic-league"
        assert curated["Muuhome"]["affiliation"] == "xenosophont"
        # Curated entries that name a holder. Not every curated entry does:
        # Enigma's is unsettled, the Boomerang Nebula is a real object nobody
        # holds, and Oh-F-Star-4 briefly claimed the Non-Coercive Zone on no
        # authority and now claims nothing.
        assert len(curated) == 24

    def test_the_naming_rule_prefers_a_named_primary(self, built):
        """Hiederia over Redunin: the primary has a name of its own."""
        entry = next(e for e in built["names"] if e["name"] == "Hiederia")
        assert entry["label"] == "Hiederia"
        assert entry["system"] == "Redunin"

    def test_the_naming_rule_falls_back_to_the_notable_world(self, built):
        entry = next(e for e in built["names"] if e["name"] == "JD 836901")
        assert entry["label"] == "Wurm"

    def test_a_curated_label_overrides_the_add_on_comment(self, built):
        """The comment says To'ul'h, which is the species, not the system."""
        entry = next(e for e in built["names"] if e["name"] == "JD 870135")
        assert entry["label"] == "H'tat'sa'thoss"
        assert entry["system"] == "To'ul'h"

    def test_enigma_is_left_unassigned(self, built):
        """Its position contradicts membership of NGC 6755; see the note."""
        entry = next(e for e in built["names"] if e["name"] == "Enigma")
        assert entry["affiliation"] == ""
        assert "NGC 6755" in entry["note"]

    def test_uncertainty_is_carried_through(self, built):
        entry = next(e for e in built["names"] if e["name"] == "Cantor")
        assert entry["uncertain"] is True

    def test_cluster_filler_is_hidden(self, built):
        """The comment rule hides a group; nothing else may fall into it."""
        filler = [e for e in built["names"] if e["hidden"] and "NGC 6633" in e["comment"]]
        assert len(filler) == 52
        assert all(not e["affiliation"] for e in filler)

    def test_duplicates_of_something_already_drawn_are_hidden(self, built):
        """The other reason to hide: this entry is an object the map already has.

        No comment marks these, so the group rule above cannot see them — they
        are named one at a time in the curation file. The add-on's second Proxima
        is a real star the catalogue already carries, and the Arkab Prior
        Necklace is a megastructure declared as though it were its own sun,
        sitting on Arkab Prior B's exact position.

        JD 836902 is the third and a different case: not a duplicate within the
        add-on but one across files. Niuearth is in ``worlds.yaml`` with the
        article behind it, and once that entry binds to this star rather than to
        a constellation the two draw the same world twice.
        """
        hidden = {e["name"] for e in built["names"] if e["hidden"]}
        assert {"Proxima Centauri2", "Arkab Prior Necklace", "JD 836902"} <= hidden
        assert len(hidden) == 55  # the 52 above, and these three

    def test_curating_an_absent_star_fails_the_build(self, tmp_path):
        """Otherwise a designation typo silently loses the whole assignment."""
        from oastarmap.fiction.schema import OAStarFile, OASystemFile

        stars = OAStarFile.model_validate(
            {"stars": [{"name": "A", "ra_deg": 1, "dec_deg": 2, "distance_ly": 10}]}
        )
        curation = OASystemFile.model_validate({"systems": [{"star": "B", "label": "B"}]})
        with pytest.raises(ValueError, match=r"absent from oa_stars\.yaml"):
            _place(stars.stars, curation, OAStarStats())

    def test_every_cited_affiliation_exists(self, built):
        """A typo in an affiliation id would silently drop the colour."""
        from oastarmap.fiction.schema import FictionFile

        known = {p.id for p in FictionFile.load(STARS.with_name("polities.yaml")).polities}
        used = {e["affiliation"] for e in built["names"] if e["affiliation"]}
        assert used <= known
        assert {"caretaker-gods", "xenosophont", "stellar-umma"} <= used
