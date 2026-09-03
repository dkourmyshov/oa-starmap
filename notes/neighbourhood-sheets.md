# Three workbooks on the solar neighbourhood, read against this map

Working notes on the three spreadsheets added to `sources/` on 4 September 2026:

- `5 parsec catalog.xlsx`
- `Data - Solar Neighbourhood's Bright Stars.xlsx`
- `Orion’s Arm - IRL_OA Planetary System Discrepancy.xlsx`

All three are the same kind of instrument pointed at different parts of the
map: modern measurements of objects Orion's Arm has been describing since the
early 2000s, against which our own data can be checked and our gaps found. They
overlap hardly at all — one carries settlement history, one carries planetary
systems, one carries stellar physics — and section 4 is the check itself, run
across all three.

Nothing here has changed `fiction/`. It is analysis, and the scripts that
produced the counts were throwaway. Every number below was computed against the
files in the repository as they stand, not recalled. Name matching is exact on
the designation wherever a number is quoted: an earlier pass that stemmed
component letters put Sirius B's mass beside Sirius A's row and produced a page
of disagreements that were not there.

---

## 1. `5 parsec catalog.xlsx` — the neighbourhood, with the setting's history beside it

One sheet, `List`, 73 rows, one per **stellar component** out to 16.2 ly:
components are listed separately, so Alpha Centauri A, B and C are three rows.
Fourteen columns, of which four are real astronomy (class, mass, age,
metallicity, planets known) and six are Orion's Arm:

| column | filled | what it is |
|---|---|---|
| OA name | 49 rows / 42 distinct | the setting's name for the system |
| EG coverage | 73 | Article 37, Mentioned 14, Partial 6, Draft 1, **None 15** |
| EG planet no. | 30 | how many planets the article gives it |
| Date colonized | 52 rows / 38 distinct systems | year A.T. |
| First colonized by | 48 | who did it |
| Colony origin | 43 | **which system they came from** |

### What of this the map already has

All 42 OA names are already in `fiction/`, though four are not findable by the
sheet's spelling. (In `fiction/` — several of them never reach the *drawn* map,
which is section 4's business and was not visible from this comparison.)

| sheet | this map | why |
|---|---|---|
| Sporehome | `Packrat sporehome` | spelling |
| Wise Violet, Insane Violet | `The Violets` | the colony table names the pair, not the components |
| Sopdet | (absent) | Sirius B; both components are `Sirius` here |

That is the whole of the naming gap in the source files, and Sopdet aside it is
a gap in *granularity*, not in coverage: this map holds no object finer than a
star system, so Sopdet has nowhere to go that is not a change of policy. Worth
recording, not worth importing.

### What it adds, and why it matters more than it looks

**The dates.** Of the 328 Inner Sphere colony names the map draws, **67 carry a
dated event and 261 do not.** The epoch control therefore shows most of the
Inner Sphere as undated — present at every year, because nothing says when it
arrived. This sheet dates **38 systems inside 16 ly**, which is the volume a
reader opens the map into and the volume the history panel is most often asked
about. Four of the 38 the map already dates, and agrees with:

| system | both say |
|---|---|
| Rihal | settled 680 |
| Gatlida | settled 636 |
| Midnight Pearl | settled 1032 |
| Akela | visited c. 450 |

Four out of four agreeing is a good sign about the sheet, and a small enough
sample that it is only a sign.

**The origins, which nothing in this project has at all.** 37 edges of a
settlement graph: not when a place was reached but *where the people came from*.
Twenty-four run straight out of Solsys — twenty-five if the sheet's own
`Solsys?` for Sporehome is allowed — and the rest are second-generation:

```
Alpha Centauri B -> Proxima                Nauri
Alpha Centauri   -> Yin, Yang, Sysactria   Nauri
Proxima Centauri -> Less Dim Twins         Wave Calls (Nauri)
Procyon          -> Luyten, Midnight Pearl Ako Forward Chaining
EZ Aquarii       -> Girb, Kaggen           Red Dwarf Kings
Epsilon Eridani  -> Baei, Teegarden's Star
```

— which is a shape the map cannot currently draw and would be worth drawing: the
Nauri working outward from Alpha Centauri, the Red Dwarf Kings from EZ Aquarii,
the Ako Forward Chaining from Procyon. Twenty-five distinct settling agents are
named, the commonest being the Red Dwarf Kings (5), Ako Forward Chaining (4),
and the Nauri, ahumans, Genetekkers and Federation/Deeper Covenant (3 each).

**The coverage grade.** Fifteen of the 73 nearest objects — a fifth of the solar
neighbourhood — get **no mention at all** in the Encyclopaedia: YZ Ceti, Wolf
1061, Wolf 424 A/B, TZ Arietis, Gliese 687, Gliese 674, WISE 1639, LHS 292,
WISE 1741, LHS 288, GJ 1002, DENIS 0255, Gliese 412 A/B. That is a fact about
the setting worth showing rather than smoothing over, and it is the sort of
thing this map is already built to say.

### The catch

The sheet is a **compilation**, not a source. It gives one EG link per system in
the coverage column but no per-date citation, so importing a year from it would
put a date on the map whose evidence is "a spreadsheet said so". The house rule
is that notes cite rather than recall, and a date is exactly the kind of claim
that reads as sourced once it is on screen.

The honest route is to import each date with `source:` naming this workbook and
verify against the article the map already stores for that system in
`inner_sphere.yaml`, promoting the source line as each is checked. Thirty-eight
articles is an afternoon, not a project. (`oastarmap fetch` currently dies on
this machine with `ImportError: Using SOCKS proxy, but the 'socksio' package is
not installed`, because `ALL_PROXY=socks5h://127.0.0.1:10808`; `uv add
'httpx[socks]'` fixes it.)

---

## 2. `Orion’s Arm - IRL_OA Planetary System Discrepancy.xlsx` — where the setting and the sky have parted

One sheet, 24 rows, five columns: designation, common name, EG article, a
one-line contradiction summary, and one or two ADS links.

**23 of the 24 are systems this map already draws**, matched either by
designation or by the EG article URL the map already holds. The exception is
HD 47186, which lies beyond the 100 ly the Inner Sphere table covers.

What the rows say, grouped:

| verdict | n | examples |
|---|---|---|
| Disproven | 5 | Barnard's Star (Ribas et al. 2018), Keid A b, Gliese 229 A b, Alsafi b, Gliese 832 c |
| Unstable! | 4 | Epsilon Indi A, Gliese 676 A, Iota Horologii, HD 47186 |
| Theory | 4 | Delta Pavonis, 61 Virginis, HD 192310, Lambda Serpentis |
| Discovery | 3 | Gliese 725 A b/B b/B c, e Eridani b/c/d, 55 Cancri B b/c |
| Constrained | 3 | Ran, Achird, Chara |
| Dubious | 2 | Proxima c, Tau Ceti's Tuomi/Feng candidates |
| Candidate | 2 | Rigil Kentaurus, 18 Scorpii |
| Special | 1 | Errai, von Zeipel–Lidov–Kozai |

This is the sheet most in keeping with what the map already does. The detail
panel has a warning line (`note-warn`) and prints a citation under every object;
a line reading *"Disproven: the Ribas et al. (2018) planet — see ADS"* under
Barnard's Star is one field in `worlds.yaml` and one line in `ui/detail.ts`, and
it says something no other map of this setting says. It is also the cheapest of
the three to do: 24 rows, each already carrying its own source link.

The one judgement to make first is what the map is claiming when it prints such
a line. Orion's Arm is a setting, not a prediction; a planet the EG gives a
system is not wrong when the sky turns out otherwise. The wording has to say
*the astronomy has moved since the article was written*, not *the article is
mistaken* — the second would be this map criticising its own source for not
being a survey.

---

## 3. `Data - Solar Neighbourhood's Bright Stars.xlsx` — real astronomy, no fiction in it

Four sheets. `The List` is 68 stars with 17 columns; `Legend` gives a planet
classification scheme of the author's own (temperature × mass, `CJs` for a cold
sub-Jupiter, `!!!` for dynamically hot); `Planet Detections` and `Other Papers`
are 6 and 27 bibliography rows.

**Every one of the 68 stars is already on this map, and all of them are settled
in the setting** — 60 match the Inner Sphere table by designation outright, and
the eight that do not (40 Eridani A, e Eridani, Fomalhaut A/B, Gamma Leporis
A/B, 20 Crateris, HD 217357) are component suffixes on systems the table lists
whole. So this workbook adds no places.

What it adds is per-star physics the map does not carry: bolometric luminosity,
the **Earth-irradiance distance** (the orbital radius receiving one solar
constant, computed as √L), [Fe/H] read off the mode of the SIMBAD measurements,
age, and — the part that is hardest to get elsewhere — **minimum and maximum
companion separation**, which is the dynamical bound on where a planet in a
binary can be stable at all. Then a description of the known system, and the
author's own predictions for what is likely to be found.

Two honest uses for it, in order of appetite:

1. **A block on the detail panel** for the 68: luminosity, the 1-au-equivalent
   distance, and the companion limits. Small, factual, and it makes the panel
   answer "could anything live here" for the stars the setting says something
   does.
2. **A selection** — stars whose companion limits leave room for a temperate
   world. This would be the first thing on the map chosen by an astrophysical
   argument rather than by a catalogue cut, which is either the interesting part
   or the part to be careful about.

The predictions column is the author's, clearly marked as such in the sheet, and
would have to stay marked as such anywhere it reached the screen. It is not the
same kind of statement as the luminosity beside it.

---

## 4. Checking our own data against all three

The three sheets are modern astronomy on stars the setting has been describing
since the early 2000s, and the map holds both: the Inner Sphere table's own
`distance_ly`, `spectral_type`, `mass_sol` and `luminosity_sol` on one side, the
star catalogue's positions on the other. That makes a three-way check possible
on 890 built rows, and the sheets a fourth opinion on the nearest hundred.

### Distance: the map already prefers the catalogue, and does not say so

`build/inner_sphere.py:321` writes `"distance_ly": round(catalogue_ly, 3)`.
Every built row carries **our** distance, never the source's, and the Orion's
Arm figure does not survive the build at all. `distance_disagrees` is the only
trace, and it fires at 15%.

Comparing the YAML against the built rows, over 890 systems:

| the two differ by | rows |
|---|---|
| under 1% | 837 |
| 1–5% | 22 |
| 5–10% | 10 |
| 10–15% | 15 |
| over 15% (flagged) | 6 |

So the Encyclopaedia's own distances are in excellent agreement with Gaia almost
everywhere — 94% inside 1% — and **31 rows disagree by 5% or more while only 6
of them are flagged.** Thirteen carry a colony name:

| system | colony | OA | ours |
|---|---|---|---|
| Xi Ursae Majoris (5 rows) | Alula Australis / Fons Luminis | 28.5 | 34.0 |
| Xi Scorpii (4 rows) | Kiyoshi | 90.3–91.0 | 79.4 |
| Omega Sagittarii A | Terebellum | 76.4 | 84.8 |
| Nu Octantis A/B | Kounzu Faashi | 63.3 | 69.1 |
| Gliese 667 A | Yall-Ull | 23.6 | 22.3 |

A row more than 50% out is rejected outright and never drawn
(`DISTANCE_WRONG_STAR = 0.5`), on the reasoning that it resolved to the wrong
star — which is usually right and is worth revisiting now there is a second
modern source to check it against.

The sheets cannot arbitrate these thirty-one: the bright-star sheet carries no
distance column, and the 5 pc sheet stops at 16 ly, where all three sources
already agree — of its 46 rows that match the map, **not one differs from either
the Encyclopaedia's distance or ours by more than 5%.**

### Spectral class: no disagreement worth the name

Nought of 40 in the 5 pc set, one of 55 in the bright-star set — Groombridge
1830, which the map has as G8 VI and the sheet as K1 V. It is a metal-poor
subdwarf at [Fe/H] −1.33; the two classifications are a real dispute in the
literature, not an error in either.

### Mass: the setting's figures run light at the bottom of the main sequence

Matching on the designation alone, 86 stars carry a mass in both the map and a
sheet. Split at 0.6 M☉:

| | n | median map ÷ sheet | map lighter | map heavier |
|---|---|---|---|---|
| under 0.6 M☉ | 27 | **0.89** | 17 | 4 |
| 0.6 M☉ and up | 59 | 1.00 | 15 | 12 |

Above 0.6 M☉ there is no bias at all. Below it the map is systematically light,
and by a lot in individual cases — Ross 128 and Ross 154 at 0.10 against 0.18,
Luyten's Star 0.16 against 0.29, Gliese 687 0.21 against 0.40. This is what an
older mass–luminosity relation for M dwarfs looks like, and the direction is
consistent enough that it is a property of the source table rather than of any
one row.

Luminosity, by contrast, is fine: 2 of 55 differ by more than 15% (70 Ophiuchi B
and Epsilon Eridani). The Encyclopaedia measured the light well and converted it
to mass with the tools of the day.

### Two rows where the columns have slipped

| system | table says | what it is |
|---|---|---|
| GJ 1061 (Baei) | `mass_sol: 0.000072`, luminosity `.` | 7.2 × 10⁻⁵ is its **luminosity**; the sheet gives mass 0.13 M☉ |
| Gliese 440 (Luliwa) | `mass_sol: 0.000466`, luminosity `.` | likewise a white dwarf's luminosity; the sheet gives 0.56 M☉ |

Two rows, both fixable from the sheet, both currently asserting a star lighter
than Jupiter.

### The size of the gap the sheets could fill

Of 909 built Inner Sphere rows, the field is blank or zero in:

| field | blank |
|---|---|
| spectral type | 76 |
| **mass** | **485** |
| luminosity | 314 |

More than half the settled systems have no mass at all. The two sheets between
them supply mass for about a hundred of the nearest, with metallicity and age
beside it, which the map holds for none of them.

### Twenty-four colonies the map does not draw at all

Checking the sheets against the map meant checking the map against itself, and
that is where the largest single finding is. **The Inner Sphere table has 1,122
rows and 909 of them reach the built map.** Of the 213 that do not:

| | rows |
|---|---|
| star is in a catalogue HYG does not carry (2MASS, WISE, DENIS, SCR, UGPS, Luhman) | 35 |
| the name did not resolve, and the row names a colony | 51 |
| the name did not resolve, no colony on the row | 126 |
| empty row | 1 |

Many of the 51 are second components of systems whose primary does resolve, so
the colony still appears. Counting one verdict per colony cell and allowing
`worlds.yaml` to rescue a name the colony layer lost, **24 named colonies are on
the map nowhere at all** — nearest first:

Patala · Urachlgarid · Home of Andromeda Kids · Less Dim Twins · Sysactria ·
Noon Pearl · Resshuna · Ighlawu · Sindhu · Ithiplumo · Retmon · Mardit ·
Chaihua · Mycosmid Node · Omuro · Matalkinnev · Goldilocks ISO · Batsu · Amity ·
Exenthar · Maru · Ahra · Tegmine · Nuisweden

Nine of those are on brown dwarfs and faint objects that HYG genuinely does not
carry, and nothing but a hand-authored entry will place them. **Six are not:**
their star is sitting in the catalogue, at the distance the table gives, under a
designation the table does not use.

| colony | table calls it | catalogue has it as | distance |
|---|---|---|---|
| Urachlgarid | DX Cancri | `GJ 1111` | 11.68 ly, both |
| Home of Andromeda Kids | Kapteyn's Star | `Gl 191`, proper **"Kapteyn's Star"** | 12.83 ly, both |
| Noon Pearl | Van Maanen 2 | `Gl 35`, proper "Van Maanen's Star" | 14.07 ly, both |
| Resshuna | Groombridge 1618 | `Gl 380` | 15.89 ly, both |
| Sindhu | EV Lacertae | `Gl 873` | 16.48 ly, both |
| Matalkinnev | AU Microscopii | `Gl 803` | 31.68 ly, both |

Kapteyn's Star is the one to look at first: the table's string and the
catalogue's `proper` field are byte-for-byte identical and the distances agree to
0.001 ly, and the row is still dropped. That is a resolver question, not a data
one, and if proper names are not being consulted then five of the other six are
the same bug wearing a different hat.

None of this needed the sheets to find. But it was looking for the sheets'
stars in our data that turned it up, which is the argument for the exercise.

---

## Where the three overlap, and where they do not

None of the three is redundant, and they check different things:

- **positions** — only the Inner Sphere table and our catalogue have them, and
  they are already compared at build time, badly (the flag is at 15%, and the
  source figure is thrown away);
- **stellar properties** — the two data sheets against the Inner Sphere table's
  own columns: agreement on class and luminosity, a systematic offset in mass,
  two slipped rows, and 485 blanks;
- **planetary systems** — only the discrepancy sheet and the bright-star sheet,
  and only the discrepancy sheet says which way the setting and the sky have
  parted;
- **history** — only the 5 pc sheet, which is the sole source here for when a
  place was settled and where its people came from.

The obvious first move is to stop the build throwing away the Encyclopaedia's
own distance. Keeping both numbers costs one field, makes the 31 disagreements
visible instead of inferable, and turns "old OA locations versus newer
scientific ones" from a thing that has to be recomputed by hand into something
the detail panel can simply show.
