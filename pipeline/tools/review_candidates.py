"""Validate candidate files against the schema and roster, and lay them out for review."""
import io, os, sys, glob
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DERIVED = os.path.join(ROOT, "sources", "derived")
KINDS = {"observed", "visited", "settled", "contact", "capital", "stewardship",
         "transferred", "independent", "reported", "abandoned"}
PRECISIONS = {"exact", "circa", "not_later_than", "not_earlier_than", "between"}

roster = {}
for line in io.open(os.path.join(DERIVED, "polities-roster.txt"), encoding="utf-8").read().splitlines()[1:]:
    pid, name, *_ = [x.strip() for x in line.split("|")]
    roster[pid] = name

worlds = yaml.safe_load(io.open(os.path.join(ROOT, "fiction", "worlds.yaml"), encoding="utf-8"))["worlds"]
by_article = {}
for w in worlds:
    if w.get("article"):
        by_article.setdefault(w["article"].rstrip("/").split("/")[-1], []).append(w)

files = sys.argv[1:] or sorted(glob.glob(os.path.join(DERIVED, "candidates", "*.yaml")))
for path in files:
    ident = os.path.basename(path)[:-5]
    problems = []
    try:
        data = yaml.safe_load(io.open(path, encoding="utf-8"))
    except Exception as exc:
        print(f"=== {ident}: YAML ERROR {exc}")
        continue
    print(f"=== {data.get('title')} ({ident})")
    existing = by_article.get(ident, [])
    if existing:
        for w in existing:
            print(f"    map: {w['name']} affiliations={w.get('affiliations')} events="
                  + "; ".join(f"{e['kind']} {e['year_at']}" + (f" ({e['polity']})" if e.get('polity') else "") for e in w.get("events", [])))
    else:
        print("    map: no worlds.yaml entry (colony row or unbound)")
    for i, e in enumerate(data.get("events") or []):
        kind = e.get("kind"); prec = e.get("precision", "exact"); pol = e.get("polity") or ""
        if kind not in KINDS: problems.append(f"event {i}: bad kind {kind!r}")
        if prec not in PRECISIONS: problems.append(f"event {i}: bad precision {prec!r}")
        if pol and pol not in roster: problems.append(f"event {i}: polity {pol!r} not in roster")
        if not isinstance(e.get("year_at"), int): problems.append(f"event {i}: year_at {e.get('year_at')!r}")
        if not e.get("quote"): problems.append(f"event {i}: no quote")
        if prec == "between" and not isinstance(e.get("until_at"), int): problems.append(f"event {i}: between without until_at")
        until = f"-{e['until_at']}" if e.get("until_at") else ""
        hedge = "" if prec == "exact" else f" ~{prec}"
        who = f" [{roster.get(pol, pol)}]" if pol else ""
        print(f"  {e.get('year_at')}{until}{hedge} {kind}{who} ({e.get('where','?')}): \"{(e.get('quote') or '')[:170]}\"")
        if e.get("note"): print(f"        note: {e['note'][:160]}")
    for h in data.get("holder_undated") or []:
        pol = h.get("polity") or ""
        if pol and pol not in roster: problems.append(f"holder_undated: {pol!r} not in roster")
        print(f"  undated holder [{roster.get(pol, pol)}]: \"{(h.get('quote') or '')[:150]}\"")
    for u in data.get("unplaced") or []:
        print(f"  unplaced: {u.get('name')}: \"{(u.get('quote') or '')[:140]}\"")
    for c in data.get("contradictions") or []:
        print(f"  CONTRADICTION about {c.get('about')}:")
        for q in c.get("quotes") or []: print(f"        - \"{q[:160]}\"")
    for d in data.get("doubts") or []:
        print(f"  doubt: {str(d)[:220]}")
    for o in data.get("other_places") or []:
        print(f"  other place: {str(o)[:120]}")
    for p in problems: print(f"  !! {p}")
    print()
