# Reading the system articles for history

What the 578 saved Encyclopaedia system articles under `sources/systems` can
give this map, how they are laid out for reading, and what a reading writes.

## What the articles hold that the map does not

The map records dated history in `fiction/worlds.yaml`: 533 places, 354 of them
with at least one event, 437 events in all, ten of which are a change of hands.
Affiliation is recorded once per place and is always the *present* holder, at
the setting's 10600-odd AT.

The articles are richer on both counts. Measured over the corpus with
`oastarmap extract-systems`:

| | count |
|---|---|
| saved pages | 578 |
| of which system articles (the rest are alphabetical index pages) | 562 |
| with a data panel | 285 |
| filed by the Encyclopaedia's own index under a Sephirotic empire | 279 |
| sentences or panel fields carrying a year written with its epoch ("1102 AT") | 919 |
| carrying a year as a bare number ("joined the NoCoZo in 3410") | 1,619 |
| panel fields naming a holder without a date ("Currently NoCoZo, former Doran Empire world") | 112 |
| articles bound to a place on the map | 482 |
| articles bound to no place | 80 |
| bound articles that state a year where the map's entry has none | 127 |

And the articles name polities that dissolved before the setting's present,
which the map could not represent at all, because a polity with no present
holdings had nowhere to appear. Ranked by how often the system articles write
the name: Solar Dominion 196, **First Federation 160**, Utopia Sphere 129,
Sophic League 122, **Conver Ambi 90**, Terragen Federation 89, Negentropy
Alliance 86, Non-Coercive Zone 85, **Taurus Nexus 82**, **Eridanus League 76**.
The bold ones are not in `polities.yaml`; the First Federation is the second
most-named polity in the whole corpus.

## Why a program does not read them

A previous attempt had a program decide what each sentence claimed. It
produced `sources/derived/article_dates.tsv`: thirty-one rows.

The corpus resists it. Sesharia's data panel says "Colonized: 1102 AT by the
Doran empire colony ship Zschorn"; its history section, three paragraphs on,
has the Dorans "arriving at HR 637 in 1133 AT". New Callisto's "Reached" field
says 1770 AT and the body then lists a bibliography dated 10447, 10270 and 10303.
Glim "was a founding member of the Doran Empire, but later seceded in 2638",
which is a change of hands *from* a polity to nobody named. The Non-Coercive
Zone appears as NoCoZo, Non-Coercive Zone (NoCoZo), and "the Zone". Deciding
which of two years is the settlement, whether "seceded" is `transferred` or
`abandoned`, and whether "Inner Sphere" in a sentence is a polity (it is not)
is reading, and the thirty-one rows are what a regex makes of reading.

## The split

The same one the history importer uses: the machine does what must be
exhaustive and must not invent; a reader does what needs judgement.

`oastarmap extract-systems` writes `sources/derived/systems_history.tsv`, one
row per dated sentence or holder field, every row a verbatim substring of a
saved page. Each row carries:

- the article, its title, and what the Encyclopaedia's own navigation files it
  under (the one affiliation on the page a program can trust, since it is the
  site's filing rather than a sentence);
- the place the map binds the article to, which file holds it, and the events
  that entry already has, so the reader sees the gap rather than the article;
- where the sentence sits (`body`, or `panel:Polity / Colonized`), its years,
  whether they are written with their epoch or left bare, and the precision its
  own wording suggests ("circa", "before", "between");
- the capitalised phrases ending in a polity word, and every Encyclopaedia link
  in the sentence with its id, because a link to `eg-article/464d0cf4b278f` is
  the Doran Empire whatever the sentence calls it.

`oastarmap extract-systems --show <id or title>` prints one article's rows laid
out to be read. That is the form a reading pass works from, an article at a
time.

The worksheet is untracked, like everything under `sources/`: it is a
rearrangement of somebody else's text. What the reader writes is tracked.

## What a reading writes

Events into `fiction/worlds.yaml`, in the existing `events` schema, with one
addition: an event may carry a `polity`, the id of the polity it is about.
`settled` by it, `transferred` to it, `abandoned` by it, `capital` of it. That
is how a place's past holders are recorded; `affiliations` stays the present
ones. The build refuses an id that is not in `polities.yaml`, so a dissolved
polity named on an event has to be entered there, with a colour, the way
Cygexpa already is. It holds nothing on the legend and draws no ring; it exists
so that the event can name it and so that a map drawn at a year when it
existed has a colour for it.

Every event written from an article quotes the sentence it was read from in
its `note`, and names the article in `source` where that is not the entry's
own. Two claims about one event sit side by side with their provenance rather
than one quietly winning: Sesharia is recorded settled in 1102 with the 1133
in the note.

The pilot, read from the four articles that mention the Doran Empire:

| place | written |
|---|---|
| Dorangloon | settled 929 by the Doran Empire; passed to the Solar Dominion 3890; passed to the Terragen Federation 5855 (from the Sesharia article) |
| Sesharia | settled 1102 by the Doran Empire, 1133 noted; a second arrival 1599 |
| Glim | new entry at HD 223889; seceded from the Doran Empire 2638, to nobody named |
| New Callisto | reached 1770 by a First Federation ship |

Two polities entered: `doran-empire` and `first-federation`.

## How a year is coloured

History mode colours a system by who held it in the year shown, and the
legend beside it lists only the polities holding something in that year. The
rule, in `holdersAt`:

1. The latest holding event at or before the year — settled by, passed to,
   made a capital of, taken into stewardship by — names the holder. An
   abandonment ends the holding. A visit is not a holding.
2. If that holder had dissolved by the year (`dissolved_at` on the polity),
   or there is no holding event before the year at all, the present holders
   stand in. An unknown past is drawn as the present rather than as nobody,
   because most dated systems give a year and not a founder.
3. A present holder with a founding year (`founded_at`) does not stand in
   before it. A system settled in 1200 that is Keterist now was not Keterist
   then, whatever its article omits. A holding an event names is exempt from
   this: a source calling a colony Keterist before 2388 is a claim about the
   colony, and the map shows it. That is where a proto-Keterist colony goes —
   on its own event, not on a rule.

Both years are cited in `polities.yaml` beside each one, from the history
timeline where it dates them and otherwise from the polity's own article as
given by the project owner: the Solar Dominion 2217, Metasoft 2344 (the vec
polity's independence; the Version Tree itself is instituted in 2582), the
Negentropy Alliance 2465, the Utopia Sphere 2975 (Beta Arae, taken as the
first Utopia system proper; Ceres Mater in the 1900s reads as
Keterist-proto-Utopian and is the case for an event), the Terragen
Federation 2900 (the article gives 2900 to 3200; the earlier bound gates
nothing the article allows). A polity with no founding year stands in for any
year.

In history mode the detail panel says, above the fold, who held the place in
the year shown and who holds it now, so the colour on the map and the claim
beneath it can be read together.

### The polity pages themselves

The present polities' own pages are not system articles and were not in the
corpus. Their ids were harvested from the history timeline's links (36 of the
47 present polities are linked there by name), the pages fetched into
`sources/polities` — the site answers a bare fetch with 406 and a browser
user agent with the page — and the extractor run over that folder with
`--topics`, since a Sephirotic empire's page is filed as a topic. 423 rows.
Reading the rows that carry a year with a founding verb, or sit in a data
panel, settled most of the list in one pass:

- confirmed by the page's own data panel: Solar Dominion 2217, Negentropy
  Alliance 2465, Sophic League 2345, Refugium Federation 5884, Puppis
  Democracy 7100;
- new from the pages: Zoeific Biopolity 1874 (Zoe's appearance, on the
  owner's reading; the page names no founding as such), Arion Ascendancy
  7610, Efficiency Maximization Paradigm "before 5285", Silicon Generation
  1405, Emple-Dokcetics 7541, First Federation 933 to 2099, Second
  Federation 2531 to 3726, Solsys Organization 3726, Disarchy the 4700s,
  Xeon "not known before 9210", Orion Federation the 4600s;
- **page and timeline disagree**, and the page is taken as the polity's own
  account with the timeline's year kept beside it: the Non-Coercive Zone
  1598 (timeline 1498), the Crystal Star Domain 4980 (timeline 3670), the
  Communion of Worlds 2292 (timeline 1989);
- left unset on purpose: the Cyberian Network, whose panel says "varies
  according to the account; from 1400 - 3400 a.t."; the Keter Dominion keeps
  the timeline's 2388, its page dating everything around the founding and
  not the founding.

Eleven present polities have no linked page yet: Vela, the Ulysses Network,
the Perseus Principalities, the Seams, the Diamond Network, the Technorapture
Hypernation, the Far Edge Civilisation, the Iota Network, the Albireo
Confluence, the Transcend, the Primate Provolution Institute. The Iota
Network is the one that has already shown on the map.

The early polities from the Encyclopaedia's Historical Polities page are
entered, twenty-two of them, so that events can name them; they draw nowhere
until one does. The timeline dates nine: the Eridanus League from 770, the
Virginis Combine from 1590, the Conver Ambi 1984 to 3943, the Yoson
Confederacy 2520 to 3941, the Soft Cathedral to 4521, the Sagittarius Sphere
to 4805, Cygexpa to 7247, the Equalizer Civilization to about 7900, the Doran
Empire to 5855. The rest carry the page's description and no year. The
Biovirate, not on that page, is entered from the timeline: its capital fell
in 6009 and its last stronghold surrendered in 6210.

Penglai is the first place read against these, from its own article and the
Empire's: settled 678, the Penglai Evolution from the Hsien revolt of 1205 at
the earliest, the Conver Ambi's from the Shi War's end in 2251 ("formally
independent, it quickly became a totally dependent part of the Conver Ambi"),
under Metasoft protection from the Ambi's division in 3943, and the Sophic
League's after the Version War. Huanghua, read from its article because the
worksheet listed it as naming the Empire: the First Federation's from 986,
the Evolution's from 1683, and by 2000 broken away from both the Empire and
SecureSpace — which needed an event kind of its own, `independent`, for a
holding that ends with nobody named after it. Glim's secession is the same
kind. Eight older transfers whose notes named the polity in words now name
it as an id.

A rule learnt the hard way on Penglai: before entering a polity, grep the
worksheet for every article that mentions it and read those rows, and fetch
the polity's own article (the site answers a bare curl with 406; a browser
user agent gets the page) into `sources/polities/`. The Empire's own article
and Huanghua's were both there to be read, and the first pass read neither.

## What the rest of the pass looks like

127 bound articles state a year where the map has none, and 112 holder fields
name a past or present holder in words. At the rate of the pilot, a reader
takes an article in a few minutes. The worksheet orders the articles so that a
pass which stops early has read the right ones: first those on the map that
state a year the map lacks, then the rest of the ones on the map, then the
ones bound to nowhere, and within each rank the article with the most dated
rows first. The three polities above with more than seventy mentions each and
no entry will need entering as they are met.

The 80 articles bound to no place are a separate question: they are places the
map does not draw at all, and why each is undrawn is `questions.yaml`'s
territory, not this note's.

## The reading pass, as tried

The corpus is a million tokens of prose, and the reader that reads whole
articles is a cheaper model working from `sources/derived/reading-brief.md`
and `polities-roster.txt`, one article's prose at a time, writing a candidate
file under `sources/derived/candidates/` in a fixed shape: events with a
verbatim quote each, holders named without a year, names it could not place,
contradictions as pairs of quotes, doubts. The reviewer checks the candidates
against the schema and roster (`review_candidates.py`, in the session
scratchpad; worth moving into the pipeline if the pass continues) and writes
the accepted ones into `worlds.yaml`.

The trial, 2026-09-05: three Sonnet readers, two articles each, from the
first tranche. Every file valid; every entry quoted; precision followed the
wording; no polity id was invented, and the near-misses were left unplaced
rather than mapped ("Hyperion Corp" beside the roster's `hyperion`, "Mutual
Progress Alliance" beside the Association). Two contradictions and a third
founding year for the NoCoZo surfaced that a regex would have averaged away.
Six articles became 23 events across Jarre, Traction, and four new entries:
Othelia, Titawin, Excelsior and Tabit.

Cost: about 100,000 tokens per reader for two articles of some 8,000 tokens
of prose each — the brief, the roster and the reasoning are most of it, so
the fixed cost per reader dominates and more articles per reader amortise
it. At two per reader the first tranche of 126 would be some six million
Sonnet tokens; at six per reader, perhaps half that.

## Things the extractor still gets wrong, deliberately left

- "Inner Sphere", "Dyson Sphere" and "Of The Utopia Sphere" come out as polity
  phrases. They are verbatim capitalised phrases ending in a polity word, which
  is all the column claims to be; a reader passes over them.
- A bare number followed by a word the unit list does not know is kept as a
  year. The list covers the units the corpus uses; a reader will meet the odd
  population figure.
- A sentence that dates itself only by "the late 5th century" carries no year
  and is not in the worksheet. Reading the article catches it; the worksheet
  does not claim to be the article.
