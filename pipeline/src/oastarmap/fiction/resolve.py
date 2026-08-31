"""Binding fictional landmark names to real catalogue objects.

Name matching is the whole difficulty. People write "NGC 0225", "ngc225" and
"NGC_225" for the same object, refer to clusters by Messier number when the
catalogue only carries NGC numbers, and use proper names ("Ptolemy's Cluster") that
appear in no catalogue at all. Normalisation handles the mechanical variation;
``fiction/aliases.yaml`` handles the rest, and is user-editable precisely because
that mapping is a matter of judgement rather than syntax.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

CATALOG_PREFIXES = (
    "ngc",
    "ic",
    "messier",
    "collinder",
    "melotte",
    "berkeley",
    "ruprecht",
    "trumpler",
    "stock",
    "basel",
    "bochum",
    "lynga",
    "pismis",
    "czernik",
    "turner",
    "roslund",
    "hogg",
    "blanco",
    "alessi",
    "upgren",
    "markarian",
    "stephenson",
    "iskudarian",
)


def fold_diacritics(text: str) -> str:
    """Strip accents, so "Bo\u00f6tis" and "Bootis" are the same word.

    The colony tables spell the constellation genitives properly and our lookup
    tables spell them in ASCII. Without folding, every star in Bo\u00f6tes failed to
    resolve \u2014 Arcturus among them, along with four rows of 44 Bo\u00f6tis \u2014 because
    "bo\u00f6tis" is simply not the key "bootis". Decompose to base characters plus
    combining marks, then drop the marks.
    """
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch)
    )


def normalise(name: str) -> str:
    """Reduce a designation to a comparable key.

    Case, punctuation, accents, separator style and leading zeros in catalogue
    numbers all vary between sources and none of them carry meaning.
    """
    # U+2019 is the curly apostrophe; "Ptolemy's Cluster" gets typed both ways.
    text = fold_diacritics(name).strip().lower().replace("'", "").replace("\u2019", "")
    text = text.replace("-", "_").replace("+", "_plus_")
    text = re.sub(r"[\s_]+", "_", text)
    # "NGC 0225" and "NGC 225" denote the same object.
    text = re.sub(r"_0+(\d)", r"_\1", text)
    # "NGC225" -> "ngc_225", so bare and separated forms agree.
    for prefix in CATALOG_PREFIXES:
        text = re.sub(rf"^{prefix}(\d)", rf"{prefix}_\1", text)
    return text


GREEK = {
    "alp": "alpha", "bet": "beta", "gam": "gamma", "del": "delta", "eps": "epsilon",
    "zet": "zeta", "eta": "eta", "the": "theta", "iot": "iota", "kap": "kappa",
    "lam": "lambda", "mu": "mu", "nu": "nu", "xi": "xi", "omi": "omicron",
    "pi": "pi", "rho": "rho", "sig": "sigma", "tau": "tau", "ups": "upsilon",
    "phi": "phi", "chi": "chi", "psi": "psi", "ome": "omega",
}
"""The abbreviations the star catalogue uses for Bayer letters.

Landmarks are written the way people say them and catalogues the way they are
printed, and for a Bayer designation those differ twice over. Gamma Cassiopeiae
is a landmark of the Solar Dominion and sits in the catalogue as "27Gam Cas" — a
Flamsteed number the landmark does not use, and a Greek letter cut to three
characters. Neither difference carries meaning, and together they were enough to
leave a star this map has had all along on the list of things it cannot find.
"""

_BAYER = re.compile(r"^(?:\d+)?([A-Za-z]{2,3})(?:-(\d))?[\s_]+([A-Za-z]{3})$")


def bayer_forms(value: str) -> list[str]:
    """Every key a Bayer designation should answer to, normalised.

    "27Gam Cas" gives itself, "Gam Cas" without the Flamsteed number, and
    "Gamma Cas" with the letter spelled out. A superscript is kept — "Alp-1 Cen"
    and "Alp-2 Cen" are two stars and must not collapse onto one key.
    """
    keys = [normalise(value)]
    matched = _BAYER.match(value.strip())
    if matched:
        letter, superscript, constellation = matched.groups()
        suffix = f"-{superscript}" if superscript else ""
        keys.append(normalise(f"{letter}{suffix} {constellation}"))
        spelled = GREEK.get(letter.lower())
        if spelled:
            keys.append(normalise(f"{spelled}{suffix} {constellation}"))
    return keys


_SPELLED = re.compile(r"^([A-Za-z]+|\d+)(?:-(\d))?[\s_]+([A-Za-z]{4,})$")


def abbreviated_forms(landmark: str) -> list[str]:
    """A spelled-out designation, cut down to how the catalogue writes it.

    "Epsilon Geminorum" is in the star catalogue as "27Eps Gem": the Greek letter
    abbreviated, the constellation abbreviated, and a Flamsteed number in front.
    :func:`bayer_forms` grows the catalogue's side of that towards the landmark;
    this shrinks the landmark's side towards the catalogue, which is the half
    that cannot be done by table — the IAU abbreviations are not all prefixes of
    their genitives, so "Aquarii" cannot be turned into "Aqr" by cutting.

    Cutting works the way round it is used here because it only *proposes* keys.
    A wrong one is absent from the index and costs nothing; the exact forms are
    tried first, so this never overrides a real match.
    """
    matched = _SPELLED.match(landmark.strip())
    if not matched:
        return []
    word, superscript, constellation = matched.groups()
    suffix = f"-{superscript}" if superscript else ""
    short = constellation[:3]
    letters = {word, word[:3]} if word.isalpha() else {word}
    return [normalise(f"{letter}{suffix} {short}") for letter in letters]


@dataclass
class Binding:
    """One landmark, and what it resolved to."""

    landmark: str
    polities: list[str]
    kind: str | None = None  # "cluster" | "hii" | "star" | None
    index: int | None = None
    matched_name: str | None = None
    via_alias: str | None = None
    distance_pc: float | None = None
    beyond_frontier: bool = False
    """Sits outside the canonical Terragen volume; see ``build/fiction.py``."""

    @property
    def resolved(self) -> bool:
        return self.index is not None

    def as_dict(self) -> dict[str, Any]:
        return {
            "landmark": self.landmark,
            "polities": self.polities,
            "resolved": self.resolved,
            "kind": self.kind,
            "index": self.index,
            "matched_name": self.matched_name,
            "via_alias": self.via_alias,
            "distance_pc": self.distance_pc,
            "beyond_frontier": self.beyond_frontier,
        }


@dataclass
class ResolutionReport:
    bindings: list[Binding] = field(default_factory=list)

    @property
    def resolved(self) -> list[Binding]:
        return [b for b in self.bindings if b.resolved]

    @property
    def unresolved(self) -> list[Binding]:
        return [b for b in self.bindings if not b.resolved]

    def as_dict(self) -> dict[str, Any]:
        return {
            "total": len(self.bindings),
            "resolved": len(self.resolved),
            "unresolved": len(self.unresolved),
            "pending": sorted(
                {b.landmark for b in self.unresolved},
                key=str.lower,
            ),
        }


class Resolver:
    """Matches landmark names against the built real catalogues."""

    def __init__(
        self,
        cluster_names: list[dict[str, Any]],
        star_names: dict[str, dict[str, str]],
        aliases: dict[str, str],
        hii_names: list[dict[str, Any]] | None = None,
    ) -> None:
        self._aliases = {normalise(k): v for k, v in aliases.items()}

        self._clusters = self._index_named(cluster_names)
        self._hii = self._index_named(hii_names or [])

        # What each catalogue calls the object, so a binding can report what it
        # actually hit. "Berkeley 42" resolving to NGC 6749 is correct but not
        # obvious, and a binding that says only "resolved" hides that.
        self._primary: dict[str, list[str]] = {
            "cluster": [str(e.get("name", "")) for e in cluster_names],
            "hii": [str(e.get("name", "")) for e in (hii_names or [])],
        }

        self._stars: dict[str, int] = {}
        self._star_names: dict[int, str] = {}
        for index_str, entry in star_names.items():
            for field_name in ("proper", "bayer", "bf"):
                value = entry.get(field_name, "")
                if not value:
                    continue
                for key in bayer_forms(value):
                    if key and key not in self._stars:
                        self._stars[key] = int(index_str)
                        self._star_names.setdefault(int(index_str), value)

    @staticmethod
    def _index_named(entries: list[dict[str, Any]]) -> dict[str, int]:
        """Index a catalogue by name, primary names taking precedence over aliases.

        Two passes, not one: every primary name is claimed before any alias is
        considered. Catalogs cross-reference each other freely, so an object that
        merely *lists* another's designation among its aliases must not be able to
        shadow the object that designation actually belongs to. Within each pass
        the first writer wins.
        """
        index: dict[str, int] = {}
        for position, entry in enumerate(entries):
            key = normalise(str(entry.get("name", "")))
            if key and key not in index:
                index[key] = position
        for position, entry in enumerate(entries):
            for candidate in str(entry.get("aliases", "")).split(","):
                key = normalise(candidate)
                if key and key not in index:
                    index[key] = position
        return index

    def resolve(self, landmark: str, polities: list[str]) -> Binding:
        binding = Binding(landmark=landmark, polities=polities)

        key = normalise(landmark)
        alias_target = self._aliases.get(key)
        keys = [key]
        if alias_target:
            keys.append(normalise(alias_target))
        # Last, so an exact match or an alias always wins over a guessed
        # abbreviation. These only ever add keys that may not exist.
        keys.extend(abbreviated_forms(landmark))
        if alias_target:
            keys.extend(abbreviated_forms(alias_target))

        # Most specific catalogue first: a Sharpless or cluster designation names one
        # object, whereas a star's Bayer letter is only unique within a
        # constellation.
        catalogues = (("cluster", self._clusters), ("hii", self._hii), ("star", self._stars))
        for attempt, lookup_key in enumerate(keys):
            for kind, index in catalogues:
                if lookup_key in index:
                    binding.kind = kind
                    binding.index = index[lookup_key]
                    binding.via_alias = alias_target if attempt else None
                    binding.matched_name = self._primary_name(kind, binding.index)
                    return binding

        return binding

    def _primary_name(self, kind: str, index: int) -> str | None:
        if kind == "star":
            return self._star_names.get(index)
        names = self._primary.get(kind, [])
        return names[index] if index < len(names) else None
