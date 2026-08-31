"""Canonical locations within the repository.

Resolved from this file's position so the pipeline works regardless of the
working directory it is invoked from.
"""

from pathlib import Path

# .../oa-starmap/pipeline/src/oastarmap/paths.py -> .../oa-starmap
REPO_ROOT = Path(__file__).resolve().parents[3]

RAW_DIR = REPO_ROOT / "raw"
"""Downloaded source catalogues. Gitignored; reproducible via `oastarmap fetch`."""

FICTION_DIR = REPO_ROOT / "fiction"
"""Hand-authored Orion's Arm data. Committed — this is content, not generated."""

SOURCES_DIR = REPO_ROOT / "sources"
"""Orion's Arm source material, downloaded by hand rather than by `fetch`.

Gitignored and not redistributed: the OAAddons archive is covered by the terms at
https://www.orionsarm.com/Terms_Copyright_and_Submissions.html rather than the
Creative Commons licence earlier OA releases carried. Builds that need a file
from here degrade gracefully when it is absent.
"""

DATA_OUT_DIR = REPO_ROOT / "web" / "public" / "data"
"""Generated datasets consumed by the renderer. Gitignored."""


def ensure_dirs() -> None:
    """Create the directories the pipeline writes to."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    DATA_OUT_DIR.mkdir(parents=True, exist_ok=True)
