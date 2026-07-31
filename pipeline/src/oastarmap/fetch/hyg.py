"""The HYG star catalog — the project's "classical sky" layer.

We use the AT-HYG derived ``hyglike`` file rather than plain HYG v4.1. Both carry
the same historical designations, but AT-HYG updated just under 90% of distances
from Gaia DR3 and explicitly prioritises 3D positional accuracy, which is the
property this project depends on most.

A warning that shaped the transform: **HYG's own x/y/z columns are equatorial**
(+x to the vernal equinox, +z to the north *celestial* pole), not galactic. They
are deliberately ignored. Positions are recomputed from ra/dec/dist through
:mod:`oastarmap.transform.frame`.
"""

from __future__ import annotations

from oastarmap.fetch.base import CatalogSource

_RAW_BASE = "https://raw.githubusercontent.com/astronexus/HYG-Database/main"

HYGLIKE = CatalogSource(
    key="hyg",
    url=f"{_RAW_BASE}/hyg/athyg_v3/hyglike_from_athyg_v32.csv.gz",
    filename="hyglike_from_athyg_v32.csv.gz",
    description=(
        "AT-HYG v3.2, HYG-compatible subset (118,971 stars). Hipparcos + Yale "
        "Bright Star + Gliese cross-matched, with ~90% of distances updated from "
        "Gaia DR3. No magnitude cutoff."
    ),
    citation="Nash, D. (Astronomy Nexus), AT-HYG v3.2 / HYG Database. CC BY-SA 4.0.",
)

HYG_V41 = CatalogSource(
    key="hyg",
    url=f"{_RAW_BASE}/hyg/CURRENT/hygdata_v41.csv",
    filename="hygdata_v41.csv",
    description=(
        "HYG v4.1 (current classic release). Better multiplicity and Gliese "
        "secondary completeness than AT-HYG, but older distances."
    ),
    citation="Nash, D. (Astronomy Nexus), HYG Database v4.1. CC BY-SA 4.0.",
)

SOURCES = [HYGLIKE]
