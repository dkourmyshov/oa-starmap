"""The Orion's Arm fictional layer.

Fictional content references real objects rather than duplicating their
coordinates, so improvements to the astronomical data propagate automatically and
a single object can carry both its catalogue identity and its OA identity.
"""

from oastarmap.fiction.resolve import ResolutionReport, Resolver
from oastarmap.fiction.schema import FictionFile, Polity

__all__ = ["FictionFile", "Polity", "ResolutionReport", "Resolver"]
