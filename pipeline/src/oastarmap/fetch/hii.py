"""HII regions — Sharpless (1959) positions, Russeil (2003) distances.

No single catalog gives both. The Sharpless catalogue is the one that carries the
designations Orion's Arm actually uses ("S27", "S232"), but it predates any
distance determination: it has positions and angular diameters only. Russeil's
star-forming complexes supply the missing dimension, and list their member
regions by Sharpless number, so the two join cleanly.

The obvious modern alternative, the WISE catalog of Anderson+ (2014), was tried
and rejected: it is radio-selected and inner-Galaxy weighted, and carries a
distance for none of the sixteen Sharpless regions this map needs. The nearby,
high-latitude, optically-discovered regions are precisely its blind spot.

**Trap:** Russeil publishes two distances per complex. The kinematic one assumes
the region follows galactic rotation, which fails badly toward l~0 and l~180 and
for anything nearby — it places S27 (the zeta Ophiuchi region, ~200 pc) at
21.6 kpc and S232 at 24.7 kpc. The stellar distance is preferred wherever it
exists; see ``build/hii.py``.
"""

from __future__ import annotations

from oastarmap.fetch.base import CatalogSource

_VIZIER = "https://vizier.cds.unistra.fr/viz-bin/asu-tsv"


def _url(source: str, columns: list[str]) -> str:
    return f"{_VIZIER}?-source={source}&-out.max=unlimited&-out={','.join(columns)}"


SHARPLESS_1959 = CatalogSource(
    key="hii",
    url=_url("VII/20/catalog", ["Sh2", "GLon", "GLat", "Diam", "Form", "Struct", "Bright"]),
    filename="sharpless_1959.tsv",
    description=(
        "Sharpless (1959), 'A Catalogue of HII Regions'. 313 optically-discovered "
        "emission nebulae with positions, angular diameters and morphology codes. "
        "No distances — see Russeil (2003)."
    ),
    citation="Sharpless S., 1959, ApJS 4, 257. VizieR VII/20.",
)

RUSSEIL_2003_MEMBERS = CatalogSource(
    key="hii",
    url=_url("J/A%2BA/397/133/table1", ["Name", "HaName", "CONames"]),
    filename="russeil_2003_members.tsv",
    description=(
        "Russeil (2003) table 1: the member sources of each star-forming complex, "
        "which is what maps a Sharpless number onto a complex with a distance."
    ),
    citation="Russeil D., 2003, A&A 397, 133. VizieR J/A+A/397/133.",
)

RUSSEIL_2003_COMPLEXES = CatalogSource(
    key="hii",
    url=_url(
        "J/A%2BA/397/133/table3",
        ["Seq", "GLON", "GLAT", "VLSR", "Dist", "err%2BD", "err-D", "DistSt", "e_DistSt"],
    ),
    filename="russeil_2003_complexes.tsv",
    description=(
        "Russeil (2003) table 3: 481 star-forming complexes with kinematic and "
        "stellar distances and their asymmetric uncertainties."
    ),
    citation="Russeil D., 2003, A&A 397, 133. VizieR J/A+A/397/133.",
)

SOURCES = [SHARPLESS_1959, RUSSEIL_2003_MEMBERS, RUSSEIL_2003_COMPLEXES]
