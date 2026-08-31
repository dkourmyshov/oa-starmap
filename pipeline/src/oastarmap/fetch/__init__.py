"""Downloading source catalogues into ``raw/``.

Downloads are cached by filename and verified by size, so re-running ``fetch`` is
cheap and offline builds work. Nothing here transforms data — that is
``transform``'s job — so the contents of ``raw/`` stay byte-identical to what the
upstream archives published.
"""

from oastarmap.fetch.base import CatalogSource, fetch_source

__all__ = ["CatalogSource", "fetch_source"]
