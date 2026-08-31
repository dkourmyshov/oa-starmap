"""Open clusters — Hunt & Reffert (2023), the all-sky Gaia DR3 census.

7,167 objects from a blind search of 729 million Gaia DR3 sources. This is the
first layer that gives the map navigable landmarks beyond the solar
neighbourhood, where individual stars stop being meaningful.

Fetched through VizieR's TSV service rather than the CDS FTP tree, which sits
behind an anti-bot gate. Columns are selected explicitly so the download stays
small and the schema this code depends on is visible here.

**Trap:** the catalogue's own X/Y/Z columns are *galactocentric* (the Sun sits at
X ~ -8200 pc), not heliocentric. They are ignored; positions are recomputed from
GLON/GLAT/dist50.
"""

from __future__ import annotations

from oastarmap.fetch.base import CatalogSource

COLUMNS = [
    "Name",
    "AllNames",
    "Type",
    "N",
    "GLON",
    "GLAT",
    "r50pc",
    "rtotpc",
    "dist16",
    "dist50",
    "dist84",
    "logAge50",
    "CMDClHuman",
    "isMerged",
]

_VIZIER = "https://vizier.cds.unistra.fr/viz-bin/asu-tsv"
_SOURCE = "J/A%2BA/673/A114/clusters"

HUNT_REFFERT_2023 = CatalogSource(
    key="clusters",
    url=f"{_VIZIER}?-source={_SOURCE}&-out.max=unlimited&-out={','.join(COLUMNS)}",
    filename="hunt_reffert_2023_clusters.tsv",
    description=(
        "Hunt & Reffert (2023), 'Improving the open cluster census II: an all-sky "
        "cluster catalogue with Gaia DR3'. 7,167 open clusters and moving groups "
        "with distances, physical radii and ages."
    ),
    citation="Hunt E.L. & Reffert S., 2023, A&A 673, A114. VizieR J/A+A/673/A114.",
)

SOURCES = [HUNT_REFFERT_2023]
