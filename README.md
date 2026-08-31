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
fiction/    Hand-authored Orion's Arm data (YAML). Committed — this is content.
raw/        Downloaded source catalogues. Gitignored, reproducible.
```

## Units

OA uses light years; astronomy uses parsecs. Confusing them is treated as a
correctness bug, and prevented mechanically rather than by discipline:

- Pipeline uses `astropy.units.Quantity` — mixing units raises.
- Fiction YAML requires an explicit unit literal (`distance: "4.37 ly"`).
  A bare number fails validation and fails the build.
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

## Imported source material

`fiction/oa_stars.yaml` holds 103 Orion's Arm stars extracted from the project's
Celestia add-on, with the source, archive URL and terms recorded in the file
itself. It is **tracked and hand-editable**, and the build reads only that file.

This differs deliberately from `raw/`, which is gitignored because
`oastarmap fetch` reproduces it from VizieR on demand. The add-on archive is a
hand-downloaded 2008 file, so the same scheme would have meant a clean clone
could not build the layer at all, and there would be nowhere to correct the
extraction by hand.

`fiction/inner_sphere.yaml` holds the Encyclopaedia Galactica's Inner Sphere
tables the same way: 1,122 colony rows and 281 wormhole rows.

```sh
uv run oastarmap import-oastars       # fiction/oa_stars.yaml     <- OAAddons1.zip
uv run oastarmap import-inner-sphere  # fiction/inner_sphere.yaml <- inner_sphere.html
uv run oastarmap import-history       # fiction/history.yaml      <- sources/history/
```

Re-importing overwrites hand edits, so review the diff before committing.

## Building it yourself

```sh
cd pipeline && uv run oastarmap fetch && uv run oastarmap build
cd ../web && npm ci && npm run dev
```

`fetch` pulls ~17 MB of catalogues from VizieR; `build` writes ~18 MB of binaries
into `web/public/data/`. Neither directory is tracked. Nothing in either step
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
