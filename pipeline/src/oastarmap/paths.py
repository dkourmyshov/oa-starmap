"""Canonical locations within the repository.

Resolved from this file's position so the pipeline works regardless of the
working directory it is invoked from.
"""

from pathlib import Path

# .../oa-starmap/pipeline/src/oastarmap/paths.py -> .../oa-starmap
REPO_ROOT = Path(__file__).resolve().parents[3]

RAW_DIR = REPO_ROOT / "raw"
"""Downloaded source catalogs. Gitignored; reproducible via `oastarmap fetch`."""

FICTION_DIR = REPO_ROOT / "fiction"
"""Hand-authored Orion's Arm data. Committed — this is content, not generated."""

DATA_OUT_DIR = REPO_ROOT / "web" / "public" / "data"
"""Generated datasets consumed by the renderer. Gitignored."""


def ensure_dirs() -> None:
    """Create the directories the pipeline writes to."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    DATA_OUT_DIR.mkdir(parents=True, exist_ok=True)
