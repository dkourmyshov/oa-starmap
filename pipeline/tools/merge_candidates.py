"""Add reviewed candidate events to fiction/oaup/.

Usage: merge_candidates.py <id> --keep 0,2,5 [--polity 2=nocozo]
                           [--kind 3=visited] [--precision 1=circa]
                           [--name "Bone-Claw"] [--affiliations a,b]
                           [--note-extra 2="..."] [--dry]
"""

import argparse
import os
import re
import sys

import yaml

from oastarmap.fiction.schema import World, WorldEvent, WorldLocation
from oastarmap.fiction.store import load_store

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DERIVED = os.path.join(ROOT, "sources", "derived")
BASE = "https://www.orionsarm.com/eg-article/"

ap = argparse.ArgumentParser()
ap.add_argument("ident")
ap.add_argument("--keep", required=True)
ap.add_argument("--polity", action="append", default=[])
ap.add_argument("--kind", action="append", default=[])
ap.add_argument("--precision", action="append", default=[])
ap.add_argument("--note-extra", action="append", default=[])
ap.add_argument("--name")
ap.add_argument("--affiliations")
ap.add_argument("--entry-note", default="")
ap.add_argument("--dry", action="store_true")
ap.add_argument("--force", action="store_true")
args = ap.parse_args()


def overrides(items):
    out = {}
    for item in items:
        key, _, value = item.partition("=")
        out[int(key)] = value
    return out


pol_over, kind_over, prec_over, extra = (
    overrides(args.polity), overrides(args.kind), overrides(args.precision),
    overrides(args.note_extra),
)
with open(
    os.path.join(DERIVED, "candidates", args.ident + ".yaml"), encoding="utf-8"
) as handle:
    candidate = yaml.safe_load(handle)
keep = [int(value) for value in args.keep.split(",") if value.strip()]
url = BASE + args.ident


def reviewed_event(index):
    source = candidate["events"][index]
    quote = " ".join((source.get("quote") or "").split())
    note = f'"{quote}"'
    if source.get("note"):
        note += " " + " ".join(source["note"].split())
    if index in extra:
        note += " " + extra[index]
    return WorldEvent(
        year_at=source["year_at"],
        until_at=source.get("until_at"),
        kind=kind_over.get(index, source["kind"]),
        polity=pol_over.get(index, source.get("polity") or ""),
        precision=prec_over.get(index, source.get("precision") or "exact"),
        note=note,
    )


store = load_store(fresh=True)
existing = next((world for world in store.worlds if world.article.rstrip("/") == url), None)
if existing is not None:
    have = {(event.year_at, event.kind) for event in existing.events}
    selected = []
    for index in keep:
        event = reviewed_event(index)
        if (event.year_at, event.kind) in have and not args.force:
            print(f"skipped {event.kind} {event.year_at}: already on the entity")
        else:
            selected.append(event)
    if not selected:
        print(f"nothing new for {existing.name}")
        sys.exit(0)
    for event in selected:
        print(f"  {event.kind} {event.year_at} {event.polity}".rstrip())
    if not args.dry:
        entity = store.world_iris[existing.name]
        for offset, event in enumerate(selected):
            store.add_event(entity, event, len(existing.events) + offset, existing.article)
    action = f"append {len(selected)} events to {existing.name}"
else:
    rows = [
        row for row in store.inner_sphere_file.systems
        if row.article.rstrip("/") == url
    ]
    if not rows:
        sys.exit(f"no world entity and no colony row for {url}; give --name and add a location")
    row = rows[0]
    name = args.name or re.split(r"[/(]", row.colony)[0].strip()
    if name in store.world_iris:
        sys.exit(f"an entity named {name!r} already exists without this article")
    if args.affiliations is not None:
        affiliations = args.affiliations.split(",")
    else:
        affiliations = next(
            (
                assignment.affiliations
                for assignment in store.colony_file.colonies
                if assignment.colony == row.colony
            ),
            [],
        )
    events = [reviewed_event(index) for index in keep]
    world = World(
        name=name,
        kind="system",
        system=name,
        affiliations=affiliations,
        article=url,
        location=WorldLocation(star=row.star),
        events=events,
        note=args.entry_note or f"{row.star}, as the colony table has it.",
    )
    for event in events:
        print(f"  {event.kind} {event.year_at} {event.polity}".rstrip())
    if not args.dry:
        store.add_world(world)
    action = f"new entity {name} at {row.star} with {len(events)} events"

if args.dry:
    print(f"dry run: {action}")
else:
    store.validate()
    store.save()
    print(action)
