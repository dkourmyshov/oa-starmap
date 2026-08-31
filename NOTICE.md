# Third-party material

The MIT licence in `LICENSE` covers this project's own work. It covers none of
what follows. These are other people's, on other terms, and the terms differ.

## Orion's Arm Universe Project

**The fiction is theirs, and it is not openly licensed.**

The Orion's Arm Universe Project's terms state that content submitted to it
remains the copyright of the original contributors, and that republication,
redistribution or derivative works require prior written consent:

> All Content and material submitted to, or otherwise created for, Orion's Arm
> is the copyrighted property of the original Contributor(s). […] any other use
> […] without a prior written consent from Orion's Arm, or the original
> Contributor(s), is expressly prohibited.

<https://www.orionsarm.com/Terms_Copyright_and_Submissions.html>

What this repository carries from them:

| File | What it is |
|---|---|
| `fiction/history.yaml` | 1,629 dated lines quoted from the Encyclopaedia Galactica's own timeline pages, with the article each line links |
| `fiction/inner_sphere.yaml` | The Inner Sphere star and wormhole tables, transcribed |
| `fiction/worlds.yaml` | Names, affiliations, dates and positions read off individual articles. The `note` fields are this project's own words |
| `fiction/polities.yaml`, `landmarks.yaml`, `colonies.yaml`, `oa_systems.yaml` | Names and associations read off the political maps and the system articles |
| `fiction/oa_stars.yaml` | Imported from the Orion's Arm Celestia add-on |

Every file names its source page in its own header, and every entry that can
cite an article does. The bulk source material — saved pages, the add-on
archives — is **not** redistributed here; `sources/` is gitignored and the
importers record the URLs so it can be fetched again.

If you are with Orion's Arm and would rather this were arranged differently,
please open an issue.

## Galaxy Map posters

`bitmap_maps/jardine_maps/` — eight sky maps by **Kevin Jardine / Galaxy Map**,
redistributed unmodified under **Creative Commons Attribution 4.0
International (CC BY 4.0)**. See `bitmap_maps/jardine_maps/ATTRIBUTION.md`.

<https://kevinjardine.dev>

## Astronomical catalogues

Downloaded at build time into `raw/`, which is gitignored; none of them is
redistributed by this repository. Each is credited in the map's own panel and
in the build manifest.

- **HYG v4.2** / AT-HYG — Hipparcos, Yale Bright Star and Gliese, merged by
  David Nash. <https://github.com/astronexus/HYG-Database>
- **Hunt & Reffert (2023)**, A&A 673, A114 — open clusters from Gaia DR3.
  VizieR `J/A+A/673/A114`.
- **Sharpless (1959)**, ApJS 4, 257 — HII regions. VizieR `VII/20`.
- **Russeil (2003)**, A&A 397, 133 — star-forming complex distances.
  VizieR `J/A+A/397/133`.
- **Quintana et al. (2026)**, MNRAS 549, 853 — OB associations within 1 kpc.
  VizieR `J/MNRAS/549/G853`.
- **IAU constellation boundaries**, via astropy.

## In short

The code is yours to take. The setting is Orion's Arm's, the posters are Kevin
Jardine's, and the sky belongs to the people who measured it.
