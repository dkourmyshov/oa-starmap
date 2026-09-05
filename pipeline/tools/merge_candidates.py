"""Write accepted candidate events into fiction/worlds.yaml, keeping the file's layout.

usage: merge_candidates.py <id> --keep 0,2,5 [--polity 2=nocozo] [--kind 3=visited]
                           [--precision 1=circa] [--name "Bone-Claw"] [--affiliations a,b]
                           [--note-extra 2="..."] [--dry]

Indices are the event positions shown by review_candidates.py (0-based, in file order).
Text is spliced into the YAML rather than round-tripped through a parser, so the
file's comments and folded notes stay exactly as they are.
"""
import io, os, re, sys, textwrap, argparse
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DERIVED = os.path.join(ROOT, "sources", "derived")
WORLDS = os.path.join(ROOT, "fiction", "worlds.yaml")
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
args = ap.parse_args()

def overrides(items):
    out = {}
    for item in items:
        k, _, v = item.partition("=")
        out[int(k)] = v
    return out

cand = yaml.safe_load(io.open(os.path.join(DERIVED, "candidates", args.ident + ".yaml"), encoding="utf-8"))
events = cand.get("events") or []
keep = [int(x) for x in args.keep.split(",") if x.strip() != ""]
pol_over, kind_over, prec_over, extra = overrides(args.polity), overrides(args.kind), overrides(args.precision), overrides(args.note_extra)

def fold(text, indent):
    """A folded YAML scalar: `>-` then wrapped lines at the indent."""
    lines = textwrap.wrap(" ".join(text.split()), width=78 - indent)
    pad = " " * indent
    return ">-\n" + "\n".join(pad + line for line in lines)

def event_block(i):
    e = events[i]
    kind = kind_over.get(i, e["kind"])
    pol = pol_over.get(i, e.get("polity") or "")
    prec = prec_over.get(i, e.get("precision") or "exact")
    quote = " ".join((e.get("quote") or "").split())
    note = f'"{quote}"'
    if e.get("note"):
        note += " " + " ".join(e["note"].split())
    if i in extra:
        note += " " + extra[i]
    out = [f"      - year_at: {e['year_at']}"]
    if e.get("until_at"):
        out.append(f"        until_at: {e['until_at']}")
    out.append(f"        kind: {kind}")
    if pol:
        out.append(f"        polity: {pol}")
    if prec != "exact":
        out.append(f"        precision: {prec}")
    out.append("        note: " + fold(note, 10))
    return "\n".join(out) + "\n"

blocks = "".join(event_block(i) for i in keep)
url = BASE + args.ident
s = io.open(WORLDS, encoding="utf-8").read()

m = re.search(r"\n  - name: ([^\n]*)\n(?:(?!\n  - name: )[\s\S])*?article: " + re.escape(url) + r"\n", s)
if m:
    # existing entry: find its span
    start = m.start() + 1
    nxt = s.find("\n  - name: ", start + 5)
    sect = s.find("\n  # ----", start + 5)
    end = min(x for x in (nxt, sect, len(s)) if x > 0)
    entry = s[start:end]
    if "\n    events:\n" in entry:
        # append after the last event, i.e. before the entry's `    note:` if it follows events
        note_at = entry.find("\n    note:")
        ev_at = entry.find("\n    events:\n")
        insert_at = note_at + 1 if note_at > ev_at else len(entry.rstrip("\n")) + 1
        new_entry = entry[:insert_at] + blocks + entry[insert_at:]
    else:
        note_at = entry.find("\n    note:")
        insert_at = note_at + 1 if note_at > 0 else len(entry.rstrip("\n")) + 1
        new_entry = entry[:insert_at] + "    events:\n" + blocks + entry[insert_at:]
    s = s[:start] + new_entry + s[end:]
    print(f"appended {len(keep)} events to {m.group(1)}")
else:
    inner = yaml.safe_load(io.open(os.path.join(ROOT, "fiction", "inner_sphere.yaml"), encoding="utf-8"))
    rows = [r for r in inner["systems"] if isinstance(r, dict) and (r.get("article") or "").rstrip("/") == url]
    if not rows:
        sys.exit(f"no worlds.yaml entry and no colony row for {url}; give --name and add the location by hand")
    row = rows[0]
    colonies = yaml.safe_load(io.open(os.path.join(ROOT, "fiction", "colonies.yaml"), encoding="utf-8"))["colonies"]
    name = args.name or re.split(r"[/(]", row["colony"])[0].strip()
    if ("\n  - name: " + name + "\n") in s:
        sys.exit(f"an entry named {name!r} already exists without this article; fold by hand")
    aff = args.affiliations.split(",") if args.affiliations is not None else next(
        (c.get("affiliations", []) for c in colonies if c["colony"] == row["colony"]), [])
    aff_text = "[" + ", ".join(aff) + "]"
    entry_note = args.entry_note or f"{row['star']}, as the colony table has it."
    new_entry = (
        f"  - name: {name}\n"
        f"    kind: system\n"
        f"    system: {name}\n"
        f"    affiliations: {aff_text}\n"
        f"    article: {url}\n"
        f"    location:\n"
        f"      star: {row['star']}\n"
        f"    events:\n" + blocks +
        f"    note: " + fold(entry_note, 6) + "\n\n"
    )
    anchor = "  - name: Huanghua\n    kind: system\n"
    assert s.count(anchor) == 1
    s = s.replace(anchor, new_entry + anchor, 1)
    print(f"new entry {name} at {row['star']} with {len(keep)} events, affiliations {aff_text}")

if args.dry:
    print(blocks)
else:
    io.open(WORLDS, "w", encoding="utf-8", newline="\n").write(s)
