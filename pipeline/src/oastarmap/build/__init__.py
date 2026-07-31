"""Emitting renderer-ready datasets into ``web/public/data/``.

Two invariants hold across everything in this package:

*Determinism* — running a build twice produces byte-identical files. That means
no timestamps, no dict iteration order dependence, and a stable sort on every
record set. It is what makes "did the data actually change?" answerable.

*Self-description* — every dataset is accompanied by manifest entries stating its
coordinate frame, its unit, its provenance, and what was excluded from it. A bare
array of numbers with no declared unit is exactly the bug this project is most
concerned with avoiding.
"""

from oastarmap.build.stars import build_stars

__all__ = ["build_stars"]
