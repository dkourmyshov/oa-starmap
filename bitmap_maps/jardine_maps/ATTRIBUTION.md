# Galaxy Map posters

Credit: **Kevin Jardine / Galaxy Map**
Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**
<https://kevinjardine.dev> · <https://mastodon.social/@galaxy_map>

Redistributed here under that licence. The files are unmodified.

Each poster is a top-down orthographic projection of the galactic plane centred
on the Sun with the galactic centre to the right — the same frame this project
uses — which is what makes them placeable rather than merely viewable. The
underlying star data is the poster author's own, drawn from Gaia DR3 and from
Golovin et al., *The fifth catalogue of nearby stars (CNS5)*, A&A 670 (2023):
A19; the individual sheets name their sources on the face of the image.

Where they sit in this map's frame is measured, not assumed: see
`pipeline/src/oastarmap/build/posters.py`, which fits each sheet against this
project's own star catalogue and records the residual alongside it.

The same attribution travels with the layer at runtime — it is written into
`posters.json` at build time and shown in the sky-map panel whenever a sheet is
displayed.
