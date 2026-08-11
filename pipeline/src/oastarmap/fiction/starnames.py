"""Resolving human-written star names against the built star catalogue.

Orion's Arm names stars the way people do — "Alpha Centauri A", "Gliese 699",
"61 Cygni A" — while the catalogue stores Bayer letters, Flamsteed numbers,
Gliese designations and HD numbers in four separate places, one of which is a
packed byte array. Bridging the two is most of the work in reading OA's system
tables.

Every strategy here is checked against the distance the source itself gives, so
a plausible-looking wrong match is caught rather than trusted. See
:func:`verify_distance`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from oastarmap.fiction.resolve import fold_diacritics, normalise

GREEK_NAMES = {
    "alpha": "Alp",
    "beta": "Bet",
    "gamma": "Gam",
    "delta": "Del",
    "epsilon": "Eps",
    "zeta": "Zet",
    "eta": "Eta",
    "theta": "The",
    "iota": "Iot",
    "kappa": "Kap",
    "lambda": "Lam",
    "mu": "Mu",
    "nu": "Nu",
    "xi": "Xi",
    "omicron": "Omi",
    "pi": "Pi",
    "rho": "Rho",
    "sigma": "Sig",
    "tau": "Tau",
    "upsilon": "Ups",
    "phi": "Phi",
    "chi": "Chi",
    "psi": "Psi",
    "omega": "Ome",
}
"""Greek letter names to the three-letter abbreviations the catalogue uses."""

GENITIVE = {
    "andromedae": "And",
    "antliae": "Ant",
    "apodis": "Aps",
    "aquarii": "Aqr",
    "aquilae": "Aql",
    "arae": "Ara",
    "arietis": "Ari",
    "aurigae": "Aur",
    "bootis": "Boo",
    "caeli": "Cae",
    "camelopardalis": "Cam",
    "cancri": "Cnc",
    "canum venaticorum": "CVn",
    "canis majoris": "CMa",
    "canis minoris": "CMi",
    "capricorni": "Cap",
    "carinae": "Car",
    "cassiopeiae": "Cas",
    "centauri": "Cen",
    "cephei": "Cep",
    "ceti": "Cet",
    "chamaeleontis": "Cha",
    "circini": "Cir",
    "columbae": "Col",
    "comae berenices": "Com",
    "coronae australis": "CrA",
    "coronae borealis": "CrB",
    "corvi": "Crv",
    "crateris": "Crt",
    "crucis": "Cru",
    "cygni": "Cyg",
    "delphini": "Del",
    "doradus": "Dor",
    "draconis": "Dra",
    "equulei": "Equ",
    "eridani": "Eri",
    "fornacis": "For",
    "geminorum": "Gem",
    "gruis": "Gru",
    "herculis": "Her",
    "horologii": "Hor",
    "hydrae": "Hya",
    "hydri": "Hyi",
    "indi": "Ind",
    "lacertae": "Lac",
    "leonis": "Leo",
    "leonis minoris": "LMi",
    "leporis": "Lep",
    "librae": "Lib",
    "lupi": "Lup",
    "lyncis": "Lyn",
    "lyrae": "Lyr",
    "mensae": "Men",
    "microscopii": "Mic",
    "monocerotis": "Mon",
    "muscae": "Mus",
    "normae": "Nor",
    "octantis": "Oct",
    "ophiuchi": "Oph",
    "orionis": "Ori",
    "pavonis": "Pav",
    "pegasi": "Peg",
    "persei": "Per",
    "phoenicis": "Phe",
    "pictoris": "Pic",
    "piscium": "Psc",
    "piscis austrini": "PsA",
    "puppis": "Pup",
    "pyxidis": "Pyx",
    "reticuli": "Ret",
    "sagittae": "Sge",
    "sagittarii": "Sgr",
    "scorpii": "Sco",
    "sculptoris": "Scl",
    "scuti": "Sct",
    "serpentis": "Ser",
    "sextantis": "Sex",
    "tauri": "Tau",
    "telescopii": "Tel",
    "trianguli": "Tri",
    "trianguli australis": "TrA",
    "tucanae": "Tuc",
    "ursae majoris": "UMa",
    "ursae minoris": "UMi",
    "velorum": "Vel",
    "virginis": "Vir",
    "volantis": "Vol",
    "vulpeculae": "Vul",
}
"""All 88 constellation genitives to their IAU abbreviations."""

# Catalogues with no representation in HYG at all. Checked, not assumed: none of
# these strings occurs anywhere in the built star names.
ABSENT_CATALOGUES = ("2MASS", "WISE", "DENIS", "SCR", "Luhman", "SIMP", "ULAS", "CFBDS")

_COMPONENT = re.compile(r"\s+([A-D])[a-d]?$")
_HD = re.compile(r"HD\s*(\d+)", re.I)
_HIP = re.compile(r"HIP\s*(\d+)", re.I)
_GLIESE = re.compile(r"(?:Gliese|Gl|GJ)\s*([\d.]+)\s*([A-D])?$", re.I)
# "Zeta1 Reticuli", "Alpha Centauri", "61 Cygni". The optional trailing digit on
# a Greek name is a component number written inline: Zeta1 is the catalogue's
# "Zet-1". Without this, Zeta1 Reticuli resolves to nothing.
_TWO_PART = re.compile(r"([^\W\d_]+|\d+)\s*(\d+)?\s+(.+)")

# Alpha Centauri A is "Alp-1 Cen" in the catalogue, B is "Alp-2". The component
# letter becomes a numeric suffix on the Bayer letter for multiple systems.
_COMPONENT_SUFFIX = {"A": "1", "B": "2", "C": "3", "D": "4"}


@dataclass(frozen=True)
class StarMatch:
    index: int
    method: str


class StarResolver:
    """Matches written star names onto indices in the built star dataset."""

    def __init__(
        self,
        star_names: dict[str, dict[str, str]],
        hip_ids: dict[int, int],
        hd_ids: dict[int, int],
        constellation_of: dict[int, str],
    ) -> None:
        self._hip = hip_ids
        self._hd = hd_ids

        self._by_name: dict[str, int] = {}
        for key, entry in star_names.items():
            index = int(key)
            for field in ("proper", "gl", "bf"):
                value = (entry.get(field) or "").strip()
                if value:
                    self._by_name.setdefault(normalise(value), index)

        # Bayer and Flamsteed designations mean nothing without a constellation,
        # and the constellation is stored apart from the names.
        self._by_designation: dict[str, int] = {}
        for key, entry in star_names.items():
            index = int(key)
            constellation = constellation_of.get(index, "")
            if not constellation:
                continue
            for field in ("bayer", "flam"):
                value = (entry.get(field) or "").strip()
                if value:
                    self._by_designation.setdefault(normalise(f"{value} {constellation}"), index)

    def _designation(self, head: str, tail: str, component: str, inline: str = "") -> int | None:
        """ "Alpha Centauri" + "A" -> "Alp-1 Cen"; "61 Cygni" -> "61 Cyg"."""
        # Folded, because the tables write "Boötis" and the genitive table
        # is ASCII.
        abbreviation = GENITIVE.get(fold_diacritics(tail).lower())
        if not abbreviation:
            return None

        lead = GREEK_NAMES.get(head.lower(), head)
        # An inline digit is already the component number; a trailing letter
        # has to be translated into one.
        suffix = inline or _COMPONENT_SUFFIX.get(component, "")
        attempts = [f"{lead} {abbreviation}"]
        if suffix:
            # Try the suffixed form first: for a double star the plain Bayer
            # letter often belongs to neither component.
            attempts.insert(0, f"{lead}-{suffix} {abbreviation}")

        for attempt in attempts:
            found = self._by_designation.get(normalise(attempt))
            if found is not None:
                return found
        return None

    def resolve(self, raw: str) -> StarMatch | None:
        raw = raw.strip()
        if not raw:
            return None

        matched = _COMPONENT.search(raw)
        component = matched.group(1) if matched else ""
        base = _COMPONENT.sub("", raw).strip()

        for candidate in dict.fromkeys((raw, base)):
            found = self._by_name.get(normalise(candidate))
            if found is not None:
                return StarMatch(found, "name")
            found = self._by_designation.get(normalise(candidate))
            if found is not None:
                return StarMatch(found, "designation")

            hd = _HD.fullmatch(candidate)
            if hd and int(hd.group(1)) in self._hd:
                return StarMatch(self._hd[int(hd.group(1))], "HD")

            hip = _HIP.fullmatch(candidate)
            if hip and int(hip.group(1)) in self._hip:
                return StarMatch(self._hip[int(hip.group(1))], "HIP")

        # The catalogue attaches the component letter to the Gliese number
        # itself — "Gl 559A", not "Gl 559 A".
        gliese = _GLIESE.fullmatch(raw) or _GLIESE.fullmatch(base)
        if gliese:
            number, letter = gliese.group(1), (gliese.group(2) or component or "")
            for prefix in ("Gl", "GJ"):
                for form in (f"{prefix} {number}{letter}", f"{prefix} {number}"):
                    found = self._by_name.get(normalise(form))
                    if found is not None:
                        return StarMatch(found, "Gliese")

        two_part = _TWO_PART.fullmatch(base)
        if two_part:
            found = self._designation(
                two_part.group(1), two_part.group(3), component, two_part.group(2) or ""
            )
            if found is not None:
                return StarMatch(found, "bayer/flamsteed")

        return None


def verify_distance(catalogue_ly: float, source_ly: float, tolerance: float = 0.15) -> bool:
    """Does the catalogue put the star where the source says it is?

    The source tables give a distance for every row, which turns name matching
    from a guess into something checkable: a wrong match on a plausible name
    almost always lands at the wrong distance.
    """
    if source_ly <= 0:
        # Sol, and anything else the source places at the origin.
        return catalogue_ly < 1.0
    return abs(catalogue_ly - source_ly) / source_ly < tolerance


def is_absent_catalogue(name: str) -> bool:
    """True for designations from surveys HYG does not include at all.

    Reported separately from ordinary failures: no amount of alias work will
    resolve these, because the objects are not in the catalogue. They are recent
    faint discoveries — brown dwarfs and late M dwarfs — which is the gap GCNS
    exists to fill.
    """
    return any(name.upper().startswith(prefix.upper()) for prefix in ABSENT_CATALOGUES)
