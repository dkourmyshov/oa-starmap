"""Tests for binding fictional landmark names onto real catalog objects.

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
        """A catalog designation names one object; a Bayer letter does not."""
        hii = [{"name": "S27", "aliases": ""}]
        stars = {"5": {"proper": "S27"}}
        assert Resolver([], stars, {}, hii).resolve("S27", ["x"]).kind == "hii"

    def test_unresolvable_landmark_reports_itself_unresolved(self):
        binding = Resolver([], {}, {}).resolve("Aquila Rift", ["x"])
        assert not binding.resolved
        assert binding.kind is None
        assert binding.index is None


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
