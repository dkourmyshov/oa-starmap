"""The Orion's Arm fictional layer.

``oaup/`` is the sole source of truth. Fictional objects reference real
catalogue objects rather than duplicating their coordinates, and source claims
retain provenance independently of the generated map data.
"""

from oastarmap.fiction.resolve import ResolutionReport, Resolver
from oastarmap.fiction.schema import FictionFile, Polity
from oastarmap.fiction.store import OAUPStore, load_store

__all__ = [
    "FictionFile",
    "OAUPStore",
    "Polity",
    "ResolutionReport",
    "Resolver",
    "load_store",
]
