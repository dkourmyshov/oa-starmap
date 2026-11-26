# OA Starmap

A 3D map of the galaxy from Sol out to 7000+ ly, showing real astronomical objects
alongside fictional locations from the
[Orion's Arm Universe Project](https://www.orionsarm.com/).

**[Open the map →](https://dkourmyshov.github.io/oa-starmap/)**

## Two rules that shape everything

**No distance cutoff.** A distance-limited star sample renders as a sphere with a
machined surface. Selection is by *luminosity* instead: since
`m = M + 5·log₁₀(d/10pc)`, an apparent-magnitude limit is equivalent to a
continuously declining absolute-magnitude limit. Density thins smoothly with
distance and no edge forms at any radius. This also keeps the far, anciently-named
stars — Wezen, Rigel, Deneb, Eta Carinae are all named *because* they are luminous.

**No synthetic fill.** If a region looks empty, we lack data for it. Nothing is
invented to make the map look fuller.

## Layout

```
pipeline/   Python + uv. Fetches real catalogues, converts to galactic Cartesian,
            emits compact binaries into web/public/data/.
web/        Vite + TypeScript + Three.js renderer.
fiction/    Authoritative OAUP RDF graph, ontology and SHACL shapes. Committed.
            History/questions and generated reference tables remain YAML.
raw/        Downloaded source catalogues. Gitignored, reproducible.
```

## Units

OA uses light years; astronomy uses parsecs. Confusing them is treated as a
correctness bug, and prevented mechanically rather than by discipline:

- Pipeline uses `astropy.units.Quantity` — mixing units raises.
- RDF quantities use QUDT with an explicit unit (`qudt:unit unit:LY`).
  Missing or unknown units fail SHACL validation and fail the build.
- Storage/wire format is parsecs, declared in each file's header.
- TypeScript uses branded `Parsecs` / `LightYears` types — mixing will not compile.
- The UI displays **light years by default** (OA convention), with a parsec toggle,
  and never shows a distance without its unit.

## Coordinates

Galactic Cartesian, parsecs, Sol at the origin: **x** coreward (l=0),
**y** spinward (l=90°), **z** toward the north galactic pole. This is both the
standard astronomical frame and
[OA's own convention](https://www.orionsarm.com/eg-article/464ba40cb009e), so no
translation layer is needed.

## Quick start

```sh
# Data pipeline
cd pipeline
uv sync
uv run oastarmap fetch     # downloads source catalogues into ../raw/
uv run oastarmap validate  # SHACL + domain checks on fiction/oaup/
uv run oastarmap build     # emits ../web/public/data/
uv run pytest

# Renderer
cd ../web
npm install
npm run dev
npm test                   # screen-space projection, picking and label layout
```

## Data sources

| Layer | Source | Status |
| --- | --- | --- |
| Bright / named stars | HYG v4.1 (Hipparcos + Yale BSC + Gliese) | built |
| Open clusters | Hunt & Reffert 2023 (Gaia DR3) | built |
| HII regions | Sharpless 1959 positions + Russeil 2003 distances | built |
| Orion's Arm stars | OA Celestia add-on (OAAddons1) | built |
| Inner Sphere colonies | EG, The Stars of the Inner Sphere | built |
| Nearby faint stars | Gaia Catalogue of Nearby Stars (GCNS), 100 pc volume-complete | planned |
| Supernova remnants | Green 2024/2025 | planned |
| Molecular clouds | Miville-Deschênes+ 2017 | planned |
| Globular clusters | Harris catalogue | planned |
| Spiral arms | Reid+ 2019 (BeSSeL) — a *model*, labelled as such | planned |
| Dust volume | Vergely+ 2022 | planned |

The WISE catalogue of Anderson+ (2014) is the obvious modern choice for HII regions
and was tried first. It carries a distance for **none** of the Sharpless regions
Orion's Arm names: it is radio-selected and weighted to the inner Galaxy, and the
nearby, high-latitude, optically-discovered regions are its blind spot. Sharpless
supplies positions and angular sizes but no distances; Russeil's star-forming
complexes supply the distances and list their members by Sharpless number, so the
two join. Russeil publishes both a kinematic and a stellar distance per complex —
the stellar one is preferred, because kinematic distances are ill-conditioned
toward l≈0 and l≈180 and place S27 (a few hundred parsecs away) at 21.6 kpc.

## Authoritative OAUP data

`fiction/oaup/` is the **only** source of truth for worlds, star systems,
Celestia stars, Inner Sphere records, colony assignments, polities, landmarks
and catalogue aliases. Do not add per-object YAML or JSON stores: an entity's
imported evidence and editorial curation belong together in this graph.

The directory is the authoritative unit; every consumer recursively loads all
of it. Files contain complete record groups, never isolated halves of an entity:

```text
oaup/
├── systems/           # One complete system per file, including its objects
├── objects/           # Standalone planets, habitats and other objects
├── volumes/           # Extended regions, hazards and megastructure swarms
├── polities/          # Polity definitions and editorial assignments
├── catalogue-links/   # Landmark names and catalogue aliases
├── imports/           # Unlabelled bulk source records
├── sources.ttl
└── dataset.ttl
```

Within each file, an entity sits beside its claims and quantity values. The
formatter preserves this layout and existing file assignments across imports.

The graph uses RDF 1.1 Turtle, stable entity IRIs, SKOS names, PROV-O sources,
QUDT quantities and explicit claim resources. Local names use hyphens rather
than slashes so `id:`, `claim:` and `value:` prefixes stay readable. Location,
event and affiliation claims record method and canonical selection separately.
`oa:Conflict` and `oa:EditorialDecision` support unresolved evidence without
deleting either side.
`fiction/ontology.ttl` defines the vocabulary and `fiction/shapes.ttl` the SHACL
contract; Python adds cross-record checks such as catalogue resolution and
unique canonical locations.

The build materialises ordinary JSON and binary artefacts for the renderer. The
map never needs to query RDF, and generated files are not editorial input.

The tracked graph currently holds 119 Celestia star records and the Inner
Sphere tables (1,122 system rows and 281 wormhole rows), with their sources,
archives and terms. Unlike `raw/`, these sources are hand-downloaded; importing
them into the tracked graph means a clean clone can build without them.

```sh
uv run oastarmap validate
uv run oastarmap format           # normalise the entity-grouped Turtle layout
uv run oastarmap import-oastars       # Celestia archives -> fiction/oaup/
uv run oastarmap import-inner-sphere  # inner_sphere.html -> fiction/oaup/
uv run oastarmap import-history       # sources/history/ -> fiction/history.yaml
```

Re-imports mark superseded source claims non-canonical and preserve editorial
curation. Review the diff before committing.

## Building it yourself

```sh
cd pipeline && uv run oastarmap fetch && uv run oastarmap build
cd ../web && npm ci && npm run dev
```

`fetch` pulls ~17 MB of catalogues from VizieR; the cluster catalogue falls back
to the Harvard VizieR mirror if the CDS endpoint fails. `build` writes ~18 MB
of binaries into `web/public/data/`. Neither directory is tracked. Nothing in either step
needs `sources/`, which is why a clean clone can build the whole map: the
importers read the Orion's Arm material, and what they *write* is tracked.

The published site is built the same way on every push — see
`.github/workflows/pages.yml`. If the map ever disagrees with the pipeline, the
pipeline is what is wrong.

## Licence and attribution

This project's own work — the pipeline, the renderer, the analysis and the prose
written for them — is **MIT** (see `LICENSE`).

Nothing else here is. The fiction belongs to the Orion's Arm Universe Project
under [their own terms](https://www.orionsarm.com/Terms_Copyright_and_Submissions.html),
which are not an open licence; the sky maps in `bitmap_maps/` are Kevin
Jardine's under CC BY 4.0; the astronomical catalogues are their authors'. Every
one of them is named, with what was taken and where it came from, in
[`NOTICE.md`](NOTICE.md).
