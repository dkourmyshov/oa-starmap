"""Fetch Encyclopaedia Galactica pages from orionsarm.com.

Pages are cached in ``raw/eg/`` and never refetched. That is not an optimisation:
orionsarm.com's robots.txt asks for a thirty-second crawl delay, so a full pass
over the systems catalogue is hours of wall time, and refetching what we already
have would be both slow and rude. The cache is the point.

What is committed from this is facts and links — names, designations, distances,
dates, and the article URL each came from. The prose stays in ``raw/``, which is
gitignored. An index that points at orionsarm.com is useful to the setting; a
mirror of it is not ours to make.
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from oastarmap.paths import RAW_DIR

BASE = "https://www.orionsarm.com"
EG_RAW_DIR = RAW_DIR / "eg"

CRAWL_DELAY = 30.0
"""Seconds between requests, from orionsarm.com/robots.txt.

The file disallows nothing and asks only for this. Honouring it is the whole of
what the site asks in return for being read by a machine, so it is not a knob.
"""

USER_AGENT = (
    "oa-starmap/0.1 (a 3D star map of the Orion's Arm setting; "
    "caches pages once, honours robots.txt crawl-delay)"
)

SYSTEM_INDEX_TOPICS = {
    "0-9": "45e388ba88b03",
    "A-B": "45e3893ce0944",
    "C-D": "45e389551fb53",
    "E-F": "45e3896c381f3",
    "G-H": "45e3898135ae4",
    "I-J": "45e38995863f4",
    "K-L": "45e389b11117e",
    "M-N": "45e389c6c5b8f",
    "O-P": "45e38af24bab5",
    "Q-R": "45e38b0a24995",
    "S-T": "45e38b2fcd0bf",
    "U-V": "45e38b81f1ad5",
    "W-X": "45e38b9e70461",
    "Y-Z": "45e38bb8e7e8f",
}
"""The fourteen alphabetical indexes of Systems & Worlds.

Read off the catalogue's root topic, 45bc1f1fca9ca. These hashes were taken from
a page read rather than from a machine-readable list, so each is a claim to be
checked rather than a fact: :func:`fetch_page` keeps whatever comes back, and the
parser asserts that the page it got names the letters it asked for.
"""


@dataclass
class Fetched:
    path: Path
    url: str
    from_cache: bool


def _cache_path(kind: str, key: str) -> Path:
    return EG_RAW_DIR / kind / f"{key}.html"


def fetch_page(kind: str, key: str, *, last_request: list[float]) -> Fetched:
    """Fetch ``/{kind}/{key}``, or return it from the cache untouched.

    ``last_request`` is a one-element list holding the monotonic time of the
    previous network call, shared across a run so the delay spans the whole
    session rather than each call separately. A cache hit costs nothing and does
    not reset it.
    """
    path = _cache_path(kind, key)
    url = f"{BASE}/{kind}/{key}"
    if path.exists():
        return Fetched(path=path, url=url, from_cache=True)

    waited = time.monotonic() - last_request[0]
    if last_request[0] and waited < CRAWL_DELAY:
        time.sleep(CRAWL_DELAY - waited)

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
    last_request[0] = time.monotonic()

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return Fetched(path=path, url=url, from_cache=False)


def fetch_system_indexes(*, progress=None) -> dict[str, Fetched]:
    """Fetch all fourteen alphabetical indexes. Roughly seven minutes cold."""
    last_request = [0.0]
    out: dict[str, Fetched] = {}
    for letters, topic in SYSTEM_INDEX_TOPICS.items():
        out[letters] = fetch_page("eg-topic", topic, last_request=last_request)
        if progress is not None:
            progress(letters, out[letters])
    return out
