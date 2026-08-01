"""Command line entry point: ``oastarmap fetch`` / ``oastarmap build``."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from oastarmap import __version__
from oastarmap.build.clusters import build_clusters
from oastarmap.build.fiction import build_fiction, format_report
from oastarmap.build.hii import build_hii
from oastarmap.build.oastars import ARCHIVE_NAME, build_oastars
from oastarmap.build.stars import build_stars
from oastarmap.build.writer import write_json
from oastarmap.fetch import fetch_source
from oastarmap.fetch.clusters import SOURCES as CLUSTER_SOURCES
from oastarmap.fetch.hii import SOURCES as HII_SOURCES
from oastarmap.fetch.hyg import SOURCES as HYG_SOURCES
from oastarmap.paths import DATA_OUT_DIR, RAW_DIR, SOURCES_DIR, ensure_dirs
from oastarmap.transform.frame import PC_TO_LY

ALL_SOURCES = [*HYG_SOURCES, *CLUSTER_SOURCES, *HII_SOURCES]


def cmd_fetch(args: argparse.Namespace) -> int:
    ensure_dirs()
    for source in ALL_SOURCES:
        path = fetch_source(source, force=args.force)
        size_mb = path.stat().st_size / 1e6
        print(f"  {source.key:<10} {path.name}  ({size_mb:.1f} MB)")
    print(f"\nSources are in {RAW_DIR}")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    ensure_dirs()

    missing = [s for s in ALL_SOURCES if not s.path.exists()]
    if missing:
        names = ", ".join(s.filename for s in missing)
        print(f"Missing source data: {names}\nRun `oastarmap fetch` first.", file=sys.stderr)
        return 1

    # Order matters: fiction binds against the published output of the real
    # catalogs, so they must exist first.
    datasets: dict[str, Any] = {
        "stars": build_stars(),
        "clusters": build_clusters(),
        "hii": build_hii(),
    }

    # Hand-downloaded rather than fetched, and not redistributable, so its
    # absence must not break the build for someone who only cloned the repo.
    archive = SOURCES_DIR / ARCHIVE_NAME
    if archive.exists():
        datasets["oastars"] = build_oastars(archive)
    else:
        print(f"  oastars    skipped — {archive} not present")

    datasets["fiction"] = build_fiction()

    # No timestamp: the build must be byte-reproducible so that a changed output
    # file always means changed data, never merely a rerun.
    manifest = {
        "generator": f"oastarmap {__version__}",
        "units": {
            "storage": "pc",
            "display_default": "ly",
            "pc_to_ly": PC_TO_LY,
            "note": (
                "All stored distances are parsecs. The UI displays light years by "
                "default, matching Orion's Arm convention."
            ),
        },
        "datasets": datasets,
    }
    write_json(DATA_OUT_DIR / "manifest.json", manifest)

    for label, dataset in datasets.items():
        if label == "fiction":
            print(format_report(dataset))
            continue
        total_bytes = sum(f["bytes"] for f in dataset["files"].values())
        print(f"  {label:<10} {dataset['count']:,} accepted  ({total_bytes / 1e6:.2f} MB)")
        for reason, count in dataset["stats"]["excluded"].items():
            print(f"             excluded {count:,} — {reason}")
    print(f"\nDatasets are in {DATA_OUT_DIR}")

    if args.print_manifest:
        print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="oastarmap", description=__doc__)
    parser.add_argument("--version", action="version", version=f"oastarmap {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="download source catalogs into raw/")
    p_fetch.add_argument("--force", action="store_true", help="re-download even if cached")
    p_fetch.set_defaults(func=cmd_fetch)

    p_build = sub.add_parser("build", help="emit renderer datasets into web/public/data/")
    p_build.add_argument("--print-manifest", action="store_true")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
