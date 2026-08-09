"""Command line entry point: ``oastarmap fetch`` / ``oastarmap build``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from oastarmap import __version__
from oastarmap.build.clusters import build_clusters
from oastarmap.build.fiction import build_fiction, format_report
from oastarmap.build.hii import build_hii
from oastarmap.build.inner_sphere import INNER_SPHERE_FILE, build_inner_sphere
from oastarmap.build.inner_sphere import format_report as format_inner_report
from oastarmap.build.oastars import SOURCE_URL, STARS_FILE, build_oastars
from oastarmap.build.questions import build_questions
from oastarmap.build.questions import format_report as format_questions_report
from oastarmap.build.stars import build_stars
from oastarmap.build.worlds import WORLDS_FILE, build_worlds
from oastarmap.build.worlds import format_report as format_worlds_report
from oastarmap.build.writer import write_json
from oastarmap.fetch import fetch_source
from oastarmap.fetch.clusters import SOURCES as CLUSTER_SOURCES
from oastarmap.fetch.hii import SOURCES as HII_SOURCES
from oastarmap.fetch.hyg import SOURCES as HYG_SOURCES
from oastarmap.importers.celestia import import_oastars
from oastarmap.importers.constellations import import_constellations
from oastarmap.importers.inner_sphere import import_inner_sphere
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR, RAW_DIR, SOURCES_DIR, ensure_dirs
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


def cmd_import_oastars(args: argparse.Namespace) -> int:
    """Rewrite the tracked star file from the add-on archive.

    Deliberately separate from `build`: this reads source material that is not in
    the repository, and its output is committed. Re-running it overwrites hand
    edits, which is what makes reviewing the diff part of the job.
    """
    if not args.archive.exists():
        print(f"Archive not found: {args.archive}", file=sys.stderr)
        print(f"Download it from {SOURCE_URL}", file=sys.stderr)
        return 1

    dest = FICTION_DIR / STARS_FILE
    count = import_oastars(args.archive, dest)
    print(f"  imported {count} stars into {dest}")
    print("  review the diff before committing — this overwrites hand edits")
    return 0


def cmd_import_inner_sphere(args: argparse.Namespace) -> int:
    """Rewrite the tracked Inner Sphere file from the saved page."""
    if not args.page.exists():
        print(f"Page not found: {args.page}", file=sys.stderr)
        print("Save https://www.orionsarm.com/eg-topic/45bcbcab90032 there", file=sys.stderr)
        return 1

    dest = FICTION_DIR / "inner_sphere.yaml"
    counts = import_inner_sphere(args.page, dest)
    print(f"  imported {counts['systems']} systems and {counts['wormholes']} wormhole rows")
    print(f"  into {dest}")
    print("  review the diff before committing — this overwrites hand edits")
    return 0


def cmd_import_constellations(args: argparse.Namespace) -> int:
    """Rewrite the tracked constellation table.

    Derived from astropy rather than downloaded, so it could equally be computed
    at build time; it is tracked because the numbers are worth reading and
    occasionally worth overriding, and because a million sky samples is a slow
    thing to repeat on every build.
    """
    dest = FICTION_DIR / "constellations.yaml"
    count = import_constellations(dest)
    print(f"  tabulated {count} constellations into {dest}")
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

    # Read from the tracked import, never from the archive, so a clean clone
    # builds this layer like any other.
    stars_file = FICTION_DIR / STARS_FILE
    if stars_file.exists():
        datasets["oastars"] = build_oastars(stars_file)
    else:
        print(f"  oastars    skipped — {stars_file} not present; run `oastarmap import-oastars`")

    # After the star dataset, whose published output it resolves against, and
    # after the manifest's constellation table exists.
    inner_file = FICTION_DIR / INNER_SPHERE_FILE
    if inner_file.exists():
        datasets["inner_sphere"] = build_inner_sphere(inner_file)

    # After the star build, whose name index it resolves against, and after the
    # add-on stars, whose designations it binds to.
    worlds_file = FICTION_DIR / WORLDS_FILE
    if worlds_file.exists():
        datasets["worlds"] = build_worlds(
            worlds_file,
            constellation_values=datasets["stars"]["layout"]["constellations"]["values"],
        )

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

    # After every dataset, because it reports on all of them. Written into the
    # repository rather than into web/public/data: it is a document for people,
    # not a file the renderer loads.
    questions = build_questions(datasets)

    for label, dataset in datasets.items():
        if label == "fiction":
            print(format_report(dataset))
            continue
        if label == "inner_sphere":
            print(format_inner_report(dataset))
            continue
        if label == "worlds":
            print(format_worlds_report(dataset))
            continue
        total_bytes = sum(f["bytes"] for f in dataset["files"].values())
        print(f"  {label:<10} {dataset['count']:,} accepted  ({total_bytes / 1e6:.2f} MB)")
        for reason, count in dataset["stats"]["excluded"].items():
            print(f"             excluded {count:,} — {reason}")
    print(format_questions_report(questions))
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

    p_import = sub.add_parser(
        "import-oastars",
        help="re-import fiction/oa_stars.yaml from the Celestia add-on archive",
    )
    p_import.add_argument(
        "--archive",
        type=Path,
        default=SOURCES_DIR / "OAAddons1.zip",
        help="path to OAAddons1.zip",
    )
    p_import.set_defaults(func=cmd_import_oastars)

    p_inner = sub.add_parser(
        "import-inner-sphere",
        help="re-import fiction/inner_sphere.yaml from the saved EG page",
    )
    p_inner.add_argument(
        "--page",
        type=Path,
        default=SOURCES_DIR / "inner_sphere.html",
        help="path to the saved Inner Sphere page",
    )
    p_inner.set_defaults(func=cmd_import_inner_sphere)

    p_con = sub.add_parser(
        "import-constellations",
        help="re-tabulate fiction/constellations.yaml from the IAU boundaries",
    )
    p_con.set_defaults(func=cmd_import_constellations)

    p_build = sub.add_parser("build", help="emit renderer datasets into web/public/data/")
    p_build.add_argument("--print-manifest", action="store_true")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
