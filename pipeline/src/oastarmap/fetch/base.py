"""Cached, resumable-enough downloading of upstream catalogues."""

from __future__ import annotations

import gzip
import hashlib
import shutil
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import httpx

from oastarmap.paths import RAW_DIR

_CHUNK = 1 << 20


@dataclass(frozen=True)
class CatalogSource:
    """An upstream file we depend on.

    Attributes:
        key: Short stable identifier, also the subdirectory under ``raw/``.
        url: Direct download URL.
        filename: Name to store it under.
        description: Human-readable provenance, surfaced in build metadata.
        citation: How to credit this catalogue.
        fallback_urls: Mirrors to try, in order, if the primary request fails.
    """

    key: str
    url: str
    filename: str
    description: str
    citation: str
    fallback_urls: tuple[str, ...] = ()

    @property
    def path(self) -> Path:
        return RAW_DIR / self.key / self.filename


def fetch_source(source: CatalogSource, *, force: bool = False) -> Path:
    """Download ``source`` into ``raw/`` unless it is already there.

    Returns the local path. Downloads to a ``.part`` file first so an interrupted
    run cannot leave a truncated file that later looks like a valid cache hit.
    """
    dest = source.path
    dest.parent.mkdir(parents=True, exist_ok=True)

    if dest.exists() and not force:
        return dest

    tmp = dest.with_suffix(dest.suffix + ".part")
    errors: list[httpx.HTTPError] = []
    for url in (source.url, *source.fallback_urls):
        try:
            with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as response:
                response.raise_for_status()
                with tmp.open("wb") as fh:
                    for chunk in response.iter_bytes(_CHUNK):
                        fh.write(chunk)
        except httpx.HTTPError as error:
            errors.append(error)
            tmp.unlink(missing_ok=True)
            print(f"  {source.key:<10} request failed: {error}", file=sys.stderr)
            continue
        if url != source.url:
            print(f"  {source.key:<10} using mirror {url}", file=sys.stderr)
        tmp.replace(dest)
        return dest

    urls = ", ".join((source.url, *source.fallback_urls))
    raise RuntimeError(f"all download URLs failed for {source.key}: {urls}") from errors[-1]


def sha256(path: Path) -> str:
    """Content hash, recorded in build metadata so outputs are traceable."""
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def open_maybe_gzip(path: Path) -> Iterator[str]:
    """Yield decoded text lines, transparently handling ``.gz``."""
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", newline="") as fh:
        yield from fh


def decompress(path: Path, dest: Path) -> Path:
    """Write a decompressed copy of a ``.gz`` file, skipping if already present."""
    if dest.exists():
        return dest
    with gzip.open(path, "rb") as src, dest.open("wb") as out:
        shutil.copyfileobj(src, out)
    return dest
