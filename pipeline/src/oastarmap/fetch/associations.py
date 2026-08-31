"""OB associations — Quintana et al. (2026), the Gaia census within 1 kpc.

The loose groupings of young massive stars that dominate any wide picture of the
solar neighbourhood: Ori OB1 and Vel OB2 are the two most conspicuous features on
Kevin Jardine's sheets, and this map drew neither of them.

Chosen over the two obvious alternatives for one reason each.

**de Zeeuw et al. (1999)**, the Hipparcos census, is the classic reference and
is still what most sources point at. Its twelve groups do not include Ori OB1:
Orion sits where Hipparcos parallaxes stop being useful and most of its members
are below the catalogue's limit. Taking it would have supplied Vel OB2, omitted
the other half of the question, and given no sign that anything was missing.

**Melnik & Dambis**, who re-derive Gaia DR2 distances for the classical Blaha &
Humphreys associations, reach 3 kpc and use the traditional designations, but
publish a distance and a centre rather than an extent. An association has no
edge; what it has is a shape, and a catalogue that gives only a centre cannot
draw one.

Quintana et al. publish the median position in heliocentric galactic Cartesian
coordinates — this project's own frame, with no transformation between the
paper and the screen — together with the intrinsic dispersion along each of the
three axes. That is what makes the shape drawable: these things are chains and
sheets, not balls, and Ori OB1b is half again as extended in X as in Z.

**The 1 kpc limit is the catalogue's, not the sky's.** Cyg OB2, Car OB1 and
everything else beyond it exists and is simply not in this table. The build says
so in its selection note, because an OB association layer that stops at 1 kpc
looks exactly like an OB association layer that has run out of associations.
"""

from __future__ import annotations

from oastarmap.fetch.base import CatalogSource

_VIZIER = "https://vizier.cds.unistra.fr/viz-bin/asu-tsv"

#: Everything the map or the panel shows. Kinematic ages, velocity gradients and
#: the crossmatches against open-cluster catalogues are left behind: they are
#: what the paper is about and not what a position on a map needs.
COLUMNS = [
    "Name",
    "AName",
    "N",
    "GLON",
    "GLAT",
    "d",
    "X",
    "s_X",
    "Y",
    "s_Y",
    "Z",
    "s_Z",
    "Agemax",
    "Mtot",
    "NO",
    "NB",
    "AV",
]

QUINTANA_2026 = CatalogSource(
    key="associations",
    url=(
        f"{_VIZIER}?-source=J/MNRAS/549/G853/table1"
        f"&-out.max=unlimited&-out={','.join(COLUMNS)}"
    ),
    filename="quintana_2026_associations.tsv",
    description=(
        "Quintana et al. (2026), 'A new Gaia census of OB associations within "
        "1 kpc'. 56 associations and 2,551 members, with median heliocentric "
        "galactic Cartesian positions and the intrinsic dispersion along each "
        "axis — the shape, not just the place."
    ),
    citation="Quintana A.L. et al., 2026, MNRAS 549, 853. VizieR J/MNRAS/549/G853.",
)

SOURCES = [QUINTANA_2026]
