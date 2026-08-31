"""Cached, resumable-enough downloading of upstream catalogues."""

from __future__ import annotations

import gzip
import hashlib
import shutil
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
    """

    key: str
    url: str
    filename: str
    description: str
    citation: str

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
    with httpx.stream("GET", source.url, follow_redirects=True, timeout=120.0) as response:
        response.raise_for_status()
        with tmp.open("wb") as fh:
            for chunk in response.iter_bytes(_CHUNK):
                fh.write(chunk)

    tmp.replace(dest)
    return dest


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
