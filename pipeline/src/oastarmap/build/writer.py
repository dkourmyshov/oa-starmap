"""Helpers for writing deterministic, self-describing output files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

CI_UNKNOWN = np.float32(-99.0)
"""Sentinel for a missing B-V colour index.

A sentinel rather than NaN because NaN in a vertex attribute is awkward to test
for portably in GLSL and can poison interpolation. Any value below -50 means
"colour unknown"; the shader falls back to a neutral white.
"""

NO_CATALOG_ID = np.int32(-1)
"""Sentinel for "this star has no ID in that catalog"."""


def write_array(path: Path, array: np.ndarray) -> dict[str, Any]:
    """Write a numpy array as raw little-endian bytes and describe it.

    Returns a manifest fragment recording dtype, shape and byte length so the
    renderer never has to guess how to unpack the file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)

    # Force little-endian so output does not depend on the build machine.
    dtype = array.dtype.newbyteorder("<")
    data = np.ascontiguousarray(array, dtype=dtype)
    path.write_bytes(data.tobytes())

    return {
        "file": path.name,
        "dtype": str(dtype.base),
        "shape": list(data.shape),
        "bytes": data.nbytes,
    }


def write_json(path: Path, payload: Any) -> dict[str, Any]:
    """Write JSON deterministically: sorted keys, fixed separators, no timestamp."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    return {"file": path.name, "bytes": len(text.encode("utf-8"))}
