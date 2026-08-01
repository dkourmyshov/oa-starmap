"""One-time imports of external source material into tracked data files.

Distinct from ``fetch``, which downloads catalogues the build re-reads every
time. An import runs rarely, by hand, and its *output* is committed — so the
build never depends on source material that may not be present.
"""
