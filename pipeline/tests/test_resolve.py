"""Tests for binding fictional landmark names onto real catalogue objects.

The subtle failure this guards against is *shadowing*. Catalogs cross-reference
each other, so one object routinely lists another's designation among its
aliases: the Gaia cluster CWNU_1242 claims "Melotte_25", which is the Hyades. If
alias entries can outrank primary names, a landmark silently binds to the wrong
object — and, having bound, reports itself as resolved.
"""

from __future__ import annotations

from oastarmap.fiction.resolve import Resolver, normalise


class TestNormalise:
    def test_case_and_separators_are_irrelevant(self):
        assert normalise("NGC 225") == normalise("ngc_225") == normalise("NGC225")

    def test_leading_zeros_are_stripped(self):
        assert normalise("NGC 0225") == normalise("NGC 225")

    def test_both_apostrophes_are_handled(self):
        """U+2019 is the curly one, which is what a word processor produces."""
        curly = "Ptolemy" + chr(0x2019) + "s Cluster"
        assert normalise("Ptolemy's Cluster") == normalise(curly)

    def test_distinct_objects_stay_distinct(self):
        assert normalise("NGC 225") != normalise("IC 225")
        assert normalise("S27") != normalise("S271")


class TestShadowing:
    def test_primary_name_outranks_another_objects_alias(self):
        """The real Melotte_25 must win even when listed second."""
        clusters = [
            {"name": "CWNU_1242", "aliases": "Melotte_25"},
            {"name": "Melotte_25", "aliases": "Hyades"},
        ]
        resolver = Resolver(clusters, {}, {})
        binding = resolver.resolve("Melotte_25", ["x"])
        assert binding.kind == "cluster"
        assert binding.index == 1

    def test_alias_still_resolves_when_nothing_claims_it_primarily(self):
        clusters = [
            {"name": "CWNU_1242", "aliases": "Melotte_25"},
            {"name": "NGC_869", "aliases": ""},
        ]
        resolver = Resolver(clusters, {}, {})
        assert resolver.resolve("Melotte_25", ["x"]).index == 0

    def test_first_writer_wins_within_a_pass(self):
        clusters = [{"name": "NGC_225", "aliases": ""}, {"name": "NGC_225", "aliases": ""}]
        assert Resolver(clusters, {}, {}).resolve("NGC 225", ["x"]).index == 0


class TestCatalogPrecedence:
    def test_hii_regions_are_searched(self):
        hii = [{"name": "S27", "aliases": "Sh2-27"}]
        resolver = Resolver([], {}, {}, hii)
        binding = resolver.resolve("S27", ["x"])
        assert binding.kind == "hii"
        assert binding.index == 0

    def test_modern_alias_form_reaches_the_same_region(self):
        hii = [{"name": "S27", "aliases": "Sh2-27,Sh 2-27"}]
        resolver = Resolver([], {}, {}, hii)
        assert resolver.resolve("Sh 2-27", ["x"]).index == 0

    def test_designation_outranks_a_star_of_the_same_name(self):
        """A catalogue designation names one object; a Bayer letter does not."""
        hii = [{"name": "S27", "aliases": ""}]
        stars = {"5": {"proper": "S27"}}
        assert Resolver([], stars, {}, hii).resolve("S27", ["x"]).kind == "hii"

    def test_unresolvable_landmark_reports_itself_unresolved(self):
        binding = Resolver([], {}, {}).resolve("Aquila Rift", ["x"])
        assert not binding.resolved
        assert binding.kind is None
        assert binding.index is None


class TestMatchedName:
    """A binding must say what it actually hit, not merely that it hit something."""

    def test_reports_the_catalog_name_behind_an_alias(self):
        clusters = [{"name": "NGC_6749", "aliases": "Berkeley_42,GCL_107"}]
        binding = Resolver(clusters, {}, {}).resolve("Berkeley 42", ["x"])
        assert binding.matched_name == "NGC_6749"

    def test_reports_the_hii_designation(self):
        hii = [{"name": "S27", "aliases": "Sh2-27"}]
        assert Resolver([], {}, {}, hii).resolve("Sh2-27", ["x"]).matched_name == "S27"

    def test_reports_the_star_name(self):
        stars = {"7": {"proper": "Vega"}}
        assert Resolver([], stars, {}).resolve("Vega", ["x"]).matched_name == "Vega"

    def test_unresolved_binding_has_none(self):
        assert Resolver([], {}, {}).resolve("Aquila Rift", ["x"]).matched_name is None


class TestAliases:
    def test_alias_file_redirects_to_a_real_object(self):
        clusters = [{"name": "NGC_6405", "aliases": ""}]
        resolver = Resolver(clusters, {}, {"Messier 6": "NGC 6405"})
        binding = resolver.resolve("Messier 6", ["x"])
        assert binding.index == 0
        assert binding.via_alias == "NGC 6405"

    def test_direct_match_records_no_alias(self):
        clusters = [{"name": "NGC_6405", "aliases": ""}]
        resolver = Resolver(clusters, {}, {"Messier 6": "NGC 6405"})
        assert resolver.resolve("NGC 6405", ["x"]).via_alias is None


class TestBayerForms:
    """A Bayer designation is written one way and catalogued another.

    Gamma Cassiopeiae is a Solar Dominion landmark and sits in the star
    catalogue as "27Gam Cas": a Flamsteed number the landmark does not use, and
    a Greek letter cut to three characters. It was on the unresolvable list for
    both reasons at once.
    """

    def test_spells_out_the_greek_letter(self):
        from oastarmap.fiction.resolve import bayer_forms, normalise

        keys = bayer_forms("27Gam Cas")
        assert normalise("Gamma Cas") in keys
        assert normalise("Gam Cas") in keys
        assert normalise("27Gam Cas") in keys

    def test_keeps_a_superscript_apart(self):
        """Alpha-1 and Alpha-2 Centauri are two stars, not one written twice."""
        from oastarmap.fiction.resolve import bayer_forms, normalise

        one = bayer_forms("Alp-1 Cen")
        two = bayer_forms("Alp-2 Cen")
        assert normalise("Alpha-1 Cen") in one
        assert normalise("Alpha-1 Cen") not in two
        assert not set(one) & set(two)

    def test_leaves_a_proper_name_alone(self):
        from oastarmap.fiction.resolve import bayer_forms, normalise

        assert bayer_forms("Cih") == [normalise("Cih")]


class TestAbbreviatedForms:
    """Landmarks spell designations out; the star catalogue abbreviates them.

    "Epsilon Geminorum" is catalogued as "27Eps Gem" — Greek letter cut,
    constellation cut, Flamsteed number added. bayer_forms grows the
    catalogue's side toward the landmark; this cuts the landmark's side toward
    the catalogue, which is the half no table can do: the IAU abbreviations are
    not all prefixes of their genitives, so Aquarii will never yield Aqr.
    """

    def test_cuts_both_words(self):
        from oastarmap.fiction.resolve import abbreviated_forms, normalise

        assert normalise("Eps Gem") in abbreviated_forms("Epsilon Geminorum")

    def test_cuts_a_flamsteed_designation(self):
        from oastarmap.fiction.resolve import abbreviated_forms, normalise

        assert normalise("139 Tau") in abbreviated_forms("139 Tauri")

    def test_keeps_a_superscript(self):
        from oastarmap.fiction.resolve import abbreviated_forms, normalise

        assert normalise("Alp-1 Cen") in abbreviated_forms("Alpha-1 Centauri")

    def test_proposes_nothing_for_a_plain_name(self):
        """It must not fire on names that are not designations at all."""
        from oastarmap.fiction.resolve import abbreviated_forms

        assert abbreviated_forms("Aldebaran") == []
        assert abbreviated_forms("NGC 1662") == []
