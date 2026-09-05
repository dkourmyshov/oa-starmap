# Reading brief: dated history and holders from a system article

You are reading one Encyclopaedia Galactica system article (Orion's Arm) and
writing down, as data, what it states about **when** the place was reached,
settled or changed hands, and **which polity** did each of those. Your output
is a candidate list a human-level reviewer will check line by line before it
enters the map. Be exhaustive and be literal. Do not resolve ambiguities;
record them.

## Input

- `prose/<id>.txt`: the article's text. Its header lines (starting `#`) say
  what the map already records for this place: the place name, the file it is
  in, the events already dated, and what the site's own index files it under.
- `polities-roster.txt`: every polity id you may use, with its name, other
  names, and its founding and dissolution years where known.

## What to extract

One entry per dated claim of these kinds:

| kind | meaning |
|---|---|
| `observed` | seen from afar, not reached |
| `visited` | somebody went, or a probe did; nobody stayed |
| `settled` | a colony was established, or the first arrival that stayed |
| `contact` | first contact with a resident xenosophont species |
| `capital` | became the seat of a polity |
| `stewardship` | a Caretaker God took the system under protection |
| `transferred` | the system passed to a polity (joined, was annexed, was sold to, came under the protection of) |
| `independent` | the system left its polity and joined none (seceded, broke away, declared independence) |
| `abandoned` | the colony ended; everyone left or died |
| `reported` | the year the setting *records* a thing whose real date is earlier |

Not events: battles, plagues, ascensions, population figures, terraforming
milestones, cultural periods, publication dates, revision-log dates. Ignore
them unless one of them *is* a change of holder.

## Rules

1. **Years are After Tranquility (AT).** Never convert. "BT" is negative. A
   c.e. year is not AT; skip it or note it.
2. **Quote the sentence.** Every entry carries `quote`, the verbatim sentence
   (or clause) it was read from. No quote, no entry.
3. **Precision follows the wording.** `exact` for "in 1102"; `circa` for
   "around 1100", "the 1100s", "early 12th century"; `not_later_than` for "by
   1100", "before 1100"; `not_earlier_than` for "after 1100", "from 1100",
   "some centuries after 1100"; `between` with `until_at` for "between 1100
   and 1200" or "1100-1200". A period that ran ("occupied 4492-4606") is
   `exact` with `until_at`.
4. **Polity ids only from the roster.** If the article names a polity, group
   or company that is not on the roster, put it in `unplaced` with the quote,
   and leave `polity` empty on the entry. Never invent an id. Never map a
   megacorporation, a clade, a church, a dynasty or a local republic onto a
   polity because it sounds similar.
5. **Contradictions are data.** If the data panel says 1102 and the prose says
   1133 for the same event, write both entries and list the pair under
   `contradictions`. Do not pick one.
6. **Already-dated events**: if the header says the map already has `settled
   1102` and the article says the same, still write it (the reviewer diffs).
   If the article says something different, write it and flag the conflict.
7. **Do not infer holders.** A ship "from the First Federation" arriving is a
   `visited` with `polity: first-federation` only if the sentence says the
   Federation reached or settled the place; a trader passing through is
   nothing. A world "in the NoCoZo" with no date is a `holder_undated` note,
   not an event.
8. **One place per article.** If the article describes several worlds of one
   system, they are one place for this purpose. If it plainly describes a
   *different* place (a neighbour with its own article), skip that place and
   mention it under `other_places`.

## Output

Write `candidates/<id>.yaml` in exactly this shape. Empty lists are fine.
Nothing outside the YAML.

```yaml
article: <id>
title: <article title>
events:
  - year_at: 1102
    kind: settled
    polity: doran-empire        # roster id, or ""
    precision: exact            # exact | circa | not_later_than | not_earlier_than | between
    until_at: null              # or a year
    where: panel                # panel | body
    quote: "1102 AT by the Doran empire colony ship Zschorn from the Nanotech Window Cyborg colony at GL 877"
    note: ""                    # only if the sentence needs a gloss to be understood
holder_undated:                 # holders the article names without a year
  - polity: nocozo
    quote: "Currently NoCoZo, former Doran Empire world"
  - polity: doran-empire
    quote: "Currently NoCoZo, former Doran Empire world"
unplaced:                       # names not on the roster
  - name: "Eridanus League"
    quote: "frontier with the Eridanus League"
contradictions:
  - about: settlement year
    quotes:
      - "Colonized: 1102 AT by the Doran empire colony ship Zschorn"
      - "arriving at HR 637 in 1133 AT"
other_places: []                # other articles' places this text describes
doubts: []                      # anything you were unsure how to classify, with the quote
```
