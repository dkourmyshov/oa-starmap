"""Command line entry point: ``oastarmap fetch`` / ``oastarmap build``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from oastarmap import __version__
from oastarmap.build.associations import build_associations
from oastarmap.build.associations import format_report as format_assoc_report
from oastarmap.build.clusters import build_clusters
from oastarmap.build.fiction import build_fiction, format_report
from oastarmap.build.hii import build_hii
from oastarmap.build.history import HISTORY_FILE, build_history
from oastarmap.build.history import format_report as format_history_report
from oastarmap.build.inner_sphere import INNER_SPHERE_FILE, build_inner_sphere
from oastarmap.build.inner_sphere import format_report as format_inner_report
from oastarmap.build.oastars import SOURCE_URL, STARS_FILE, build_oastars
from oastarmap.build.posters import build_posters
from oastarmap.build.posters import describe as describe_posters
from oastarmap.build.questions import build_questions
from oastarmap.build.questions import format_report as format_questions_report
from oastarmap.build.stars import build_stars
from oastarmap.build.worlds import WORLDS_FILE, build_worlds
from oastarmap.build.worlds import format_report as format_worlds_report
from oastarmap.build.writer import write_json
from oastarmap.fetch import fetch_source
from oastarmap.fetch.associations import SOURCES as ASSOCIATION_SOURCES
from oastarmap.fetch.clusters import SOURCES as CLUSTER_SOURCES
from oastarmap.fetch.hii import SOURCES as HII_SOURCES
from oastarmap.fetch.hyg import SOURCES as HYG_SOURCES
from oastarmap.fiction.find import find
from oastarmap.importers.celestia import import_oastars
from oastarmap.importers.constellations import import_constellations
from oastarmap.importers.history import import_history
from oastarmap.importers.systems import (
    parse_article,
    prose as article_prose,
    read_articles,
    show as show_article,
    summarise,
    worksheet_rows,
    write_worksheet,
)
from oastarmap.importers.inner_sphere import import_inner_sphere
from oastarmap.paths import DATA_OUT_DIR, FICTION_DIR, RAW_DIR, SOURCES_DIR, ensure_dirs
from oastarmap.transform.frame import PC_TO_LY

ALL_SOURCES = [*HYG_SOURCES, *CLUSTER_SOURCES, *HII_SOURCES, *ASSOCIATION_SOURCES]


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


def cmd_import_history(args: argparse.Namespace) -> int:
    """Rewrite the tracked history file from the saved Encyclopaedia pages."""
    if not args.pages.is_dir():
        print(f"History pages not found: {args.pages}", file=sys.stderr)
        print("Save the pages under https://www.orionsarm.com/eg-topic/45b170f9e0941 there",
              file=sys.stderr)
        return 1

    dest = FICTION_DIR / HISTORY_FILE
    counts = import_history(args.pages, dest)
    print(f"  imported {counts['periods']} pages ({counts['eras']} eras) with "
          f"{counts['events']} dated events and {counts['links']} links")
    print(f"  into {dest}")
    print("  review the diff before committing — this overwrites hand edits")
    return 0


def cmd_extract_systems(args: argparse.Namespace) -> int:
    """Lay out what the saved system articles date, for a reader to work from."""
    if not args.pages.is_dir():
        print(f"System articles not found: {args.pages}", file=sys.stderr)
        print("Save Encyclopaedia system articles there, one .htm each", file=sys.stderr)
        return 1

    articles, skipped = read_articles(args.pages, topics=args.topics)
    rows = worksheet_rows(articles)
    if args.show:
        wanted = set(args.show)
        for article in articles:
            if article.id in wanted or article.title in wanted:
                print(show_article(article, rows))
                print()
        return 0

    if args.prose:
        args.prose.mkdir(parents=True, exist_ok=True)
        wanted = {row["article"] for row in rows}
        first_row = {}
        for row in rows:
            first_row.setdefault(row["article"], row)
        for path in sorted(args.pages.glob("*.htm*")):
            markup = path.read_text(encoding="utf-8", errors="replace")
            article = parse_article(markup, topics=args.topics)
            if article is None or article.id not in wanted:
                continue
            first = first_row[article.id]
            head = [
                f"# {article.title}",
                f"# {article.url}",
                f"# on the map as: {first['place'] or '(not on the map)'}"
                + (f" [{first['file']}]" if first["file"] else ""),
                f"# already dated: {first['has'] or '(nothing)'}",
                f"# filed under: {first['held_by'] or '(no polity)'}",
                "",
            ]
            (args.prose / f"{article.id}.txt").write_text(
                "\n".join(head) + article_prose(markup), encoding="utf-8"
            )
        print(f"  prose of {len(wanted)} articles under {args.prose}")

    dest = args.out
    write_worksheet(rows, dest)
    summary = summarise(articles, rows, skipped)
    print(f"  read {summary['articles']} articles ({summary['skipped_topics']} index pages skipped), "
          f"{summary['with_panel']} with a data panel, "
          f"{summary['filed_under_a_polity']} filed under a polity")
    print(f"  {summary['rows']} rows: {summary['rows_at']} dated in AT, "
          f"{summary['rows_bare']} by a bare number, {summary['rows_holder_only']} naming a holder only")
    print(f"  {summary['articles_on_the_map']} articles are on the map, "
          f"{summary['articles_off_the_map']} are not; "
          f"{summary['dated_but_map_undated']} on the map carry a year the map does not")
    print(f"  into {dest}")
    print("  the worksheet is untracked: what is read out of it goes into fiction/worlds.yaml")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    ensure_dirs()

    missing = [s for s in ALL_SOURCES if not s.path.exists()]
    if missing:
        names = ", ".join(s.filename for s in missing)
        print(f"Missing source data: {names}\nRun `oastarmap fetch` first.", file=sys.stderr)
        return 1

    # Order matters: fiction binds against the published output of the real
    # catalogues, so they must exist first.
    datasets: dict[str, Any] = {
        "stars": build_stars(),
        "clusters": build_clusters(),
        "hii": build_hii(),
    }

    # Optional: a clone whose raw/ predates this catalogue builds without it
    # rather than failing, the same way the add-on layers do.
    associations = build_associations()
    if associations:
        datasets["associations"] = associations

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
        datasets["inner_sphere"] = build_inner_sphere(
            inner_file,
            constellation_values=datasets["stars"]["layout"]["constellations"]["values"],
        )

    # After the star build, whose name index it resolves against, and after the
    # add-on stars, whose designations it binds to.
    worlds_file = FICTION_DIR / WORLDS_FILE
    if worlds_file.exists():
        datasets["worlds"] = build_worlds(
            worlds_file,
            constellation_values=datasets["stars"]["layout"]["constellations"]["values"],
        )

    datasets["fiction"] = build_fiction()

    # After every file that holds a place, because it binds the Encyclopaedia's
    # timeline to them by article id and can only match what has been written.
    history = build_history()
    if history:
        datasets["history"] = history

    # Last, and optional. The sky-map posters are registered by fitting them
    # against the star build above, so they need it to exist; and a repository
    # without a bitmap_maps/ directory should build everything else as usual.
    posters = build_posters()
    if posters:
        datasets["posters"] = posters

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
        if label == "posters":
            print(f"  posters    {dataset['count']} registered")
            for line in describe_posters().splitlines():
                print("    " + line)
            continue
        if label == "fiction":
            print(format_report(dataset))
            continue
        if label == "inner_sphere":
            print(format_inner_report(dataset))
            continue
        if label == "worlds":
            print(format_worlds_report(dataset))
            continue
        if label == "history":
            print(format_history_report(dataset))
            continue
        if label == "associations":
            print(format_assoc_report(dataset))
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


def cmd_find(args: argparse.Namespace) -> int:
    hits = find(args.name)
    if not hits:
        print(f"no place matching {args.name!r} in any index")
        return 1
    for hit in hits:
        print(hit)
    print(f"{len(hits)} match(es) across {len({h.source for h in hits})} index(es)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="oastarmap", description=__doc__)
    parser.add_argument("--version", action="version", version=f"oastarmap {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="download source catalogues into raw/")
    p_fetch.add_argument("--force", action="store_true", help="re-download even if cached")
    p_fetch.set_defaults(func=cmd_fetch)

    p_import = sub.add_parser(
        "import-oastars",
        help="re-import fiction/oa_stars.yaml from the Celestia add-on archives",
    )
    p_import.add_argument(
        "--archive",
        type=Path,
        default=SOURCES_DIR,
        help="directory of add-on archives, or one .zip",
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

    p_history = sub.add_parser(
        "import-history",
        help="re-import fiction/history.yaml from the saved EG history pages",
    )
    p_history.add_argument(
        "--pages",
        type=Path,
        default=SOURCES_DIR / "history",
        help="directory of saved era and period pages",
    )
    p_history.set_defaults(func=cmd_import_history)

    p_systems = sub.add_parser(
        "extract-systems",
        help="lay out the dates and holders the saved EG system articles state",
    )
    p_systems.add_argument(
        "--pages",
        type=Path,
        default=SOURCES_DIR / "systems",
        help="directory of saved system articles",
    )
    p_systems.add_argument(
        "--out",
        type=Path,
        default=SOURCES_DIR / "derived" / "systems_history.tsv",
        help="where to write the worksheet",
    )
    p_systems.add_argument(
        "--prose",
        type=Path,
        metavar="DIR",
        help="also write each article's text, headed by its map binding, one file per article",
    )
    p_systems.add_argument(
        "--topics",
        action="store_true",
        help="read topic pages too, which is what a polity's own page is",
    )
    p_systems.add_argument(
        "--show",
        nargs="*",
        metavar="ARTICLE",
        help="print these articles' rows readably (by id or title) instead of writing the worksheet",
    )
    p_systems.set_defaults(func=cmd_extract_systems)

    p_con = sub.add_parser(
        "import-constellations",
        help="re-tabulate fiction/constellations.yaml from the IAU boundaries",
    )
    p_con.set_defaults(func=cmd_import_constellations)

    p_build = sub.add_parser("build", help="emit renderer datasets into web/public/data/")
    p_build.add_argument("--print-manifest", action="store_true")
    p_build.set_defaults(func=cmd_build)

    p_find = sub.add_parser(
        "find",
        help="look a place up by name across every index that holds one",
    )
    p_find.add_argument("name", help="name, alias or fragment; case-insensitive")
    p_find.set_defaults(func=cmd_find)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
