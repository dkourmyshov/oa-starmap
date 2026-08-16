# The stellar Snake, and what Orion's Arm has put in it

Working notes from reading Wang et al. 2021, *The Stellar "Snake" I: Whole
Structure and Properties* ([arXiv:2109.05999v3](https://arxiv.org/abs/2109.05999)),
against this map. The paper is in `sources/`. Nothing here has changed
`fiction/`; it is analysis, and the scripts that produced it were throwaway.

## What the Snake is

A young (30–40 Myr) filamentary stellar structure in the solar neighbourhood,
about 500 pc long, 500 pc wide and just over 100 pc thick, running from Orion
through Puppis into Vela. The authors identify **thirteen open clusters
embedded in it** and argue the whole thing is one population.

Table 1 of the paper gives each cluster's galactic longitude, latitude and
distance. Those are the figures used throughout below, converted at 3.261564
ly/pc. Two caveats the paper states about them, both of which matter more than
the quoted errors:

- the distances are **inverse-parallax** (`d = 1000/ϖ`), which the authors say
  produces "a substantial elongation effect along the line of sight" — a bias
  they name and do not correct, acting along exactly the axis most separations
  here are measured on;
- the ±0.2 to ±1.5 pc are **standard errors on the mean** over hundreds of
  members, not accuracy.

| Cluster | l | b | d (pc) | ly |
|---|---|---|---|---|
| Tian 2 | 218.33 | −2.12 | 285.9 | 932 |
| NGC 2232 | 214.42 | −7.51 | 319.2 | 1041 |
| Trumpler 10 | 262.71 | 0.72 | 433.9 | 1415 |
| Collinder 132 | 242.89 | −9.04 | 645.8 | 2106 |
| BBJ 1 | 224.26 | −13.76 | 368.5 | 1202 |
| BBJ 2 | 238.17 | −10.71 | 393.7 | 1284 |
| BBJ 3 | 260.75 | −8.36 | 326.6 | 1065 |
| NGC 2547 | 264.42 | −8.60 | 386.0 | 1259 |
| NGC 2451B | 252.31 | −6.81 | 363.7 | 1186 |
| Collinder 135 | 248.81 | −11.03 | 299.4 | 977 |
| Collinder 140 | 244.95 | −7.77 | 383.9 | 1252 |
| UBC 7 | 248.73 | −13.51 | 276.3 | 901 |
| Haffner 13 | 245.05 | −3.60 | 560.3 | 1827 |

§3.3 flags **Collinder 132 and Haffner 13** as "not well bridged with the main
structure" — the two outliers, and also the two most distant.

## Orion's Arm places nearest each cluster

All 452 places in this map that carry a position, ranked by distance to each
cluster. Bare add-on designations and catalogue objects excluded.

The precision column is the point of the table. Most of these worlds are placed
by **constellation**, which fixes the distance and leaves the direction good
only to the constellation's width — often ±300 to ±950 ly, larger than the
separation being quoted. Only the entries marked exact mean what they say.

| Cluster | 1st | 2nd | 3rd |
|---|---|---|---|
| Tian 2 | Jafalgia 117 (±361) | Beelzebub 275 (±200) | *Alnitak 332* |
| NGC 2232 | Jafalgia 156 (±361) | Valdern Megastructure 203 | Elmo 301 (±378) |
| Trumpler 10 | Zarauztar 289 (±484) | Kaumbrey 326 (±505) | *Regor 351* |
| Collinder 132 | Oia 220 (±969) | Hhrraiirah 247 (±913) | Bambata 454 |
| BBJ 1 | Valdern Megastructure 268 | Jafalgia 364 (±361) | Beelzebub 425 (±200) |
| BBJ 2 | Jensan 282 (±650) | *Naos 431* | Beelzebub 489 (±200) |
| BBJ 3 | ***Regor 66*** | ***Naos 114*** | Vela SNR 165 |
| NGC 2547 | *Regor 147* | *Naos 257* | Vast Endeavour 329 (±530) |
| NGC 2451B | *Naos 132* | *Regor 221* | Jensan 248 (±650) |
| Collinder 135 | *Naos 201* | Nivline 267 (±333) | Vela SNR 283 |
| Collinder 140 | Jensan 178 (±650) | *Naos 286* | *Regor 388* |
| UBC 7 | Nivline 212 (±333) | Beelzebub 259 (±200) | *Naos 267* |
| Haffner 13 | Hhrraiirah 187 (±913) | Oia 295 (±969) | Jensan 428 (±650) |

*Italic* entries are exactly placed. Reading only those:

- **Regor (γ Velorum) and Naos (ζ Puppis), both NoCoZo, are inside the Snake** —
  66 and 114 ly from BBJ 3, and within ~300 ly of four more clusters.
- **Haffner 13 has no exactly placed Orion's Arm neighbour within 555 ly.** Its
  three nearest all carry errors four to five times their separations. It is the
  emptiest part of the structure as this map holds it.
- **BBJ 2 is nearly as empty** — nearest reliably placed world is Naos at 431 ly.

Two further observations:

**Transcend 1 sits at NGC 2451A**, the foreground component of the pair whose
**B** component is a Snake member — 620 ly against 1186. Different clusters on
one bearing, so the Transcend stands directly in front of the Snake along that
line of sight.

**The Anders/Encyclopaedia divergence over Vela reads as shared volume, not
contradiction.** The clusters Anders Sandberg's maps colour Sophic — NGC 2547
(1259), NGC 2451B (1186), Collinder 135 (977), Collinder 140 (1252) — are
interleaved in distance with the Encyclopaedia's NoCoZo worlds Regor (1117) and
Naos (1084). Same volume at the same radii, two metaempires.

## The Kelarc corridor

Kelarc (Sophic League, settled 2701) is 176 ly from Sol. The line from Kelarc to
Collinder 132 is **1934 ly** long, and it turns out to run almost exactly down
the Snake's spine. Perpendicular offsets of the thirteen from that line:

| Collinder 140 | **39 ly** | Collinder 135 | 101 | UBC 7 | 117 |
|---|---|---|---|---|---|
| BBJ 2 | 123 | NGC 2451B | 185 | BBJ 3 | 312 |

Named waypoints along it, measured from Kelarc: **Transcend 1 at 438 ly (cross
87)**, Big Tor 461 (cross 82), Nivline 546 (cross 52), Jensan 1227 (cross 135),
Hhrraiirah 1794 (cross 204), Oia 1913 (cross 219).

A consistency check that passes: **Jensan's stated origin — anarchist refugees
from Neli-Neti — is geometrically sound.** Neli-Neti is 698 ly out and settled
3189; the leg to Jensan is 1179 ly, so leaving around 3700 arrives by 5309 at
about 0.73c. The corridor is a route the setting already uses.

## Travel times, and what the drive table forbids

Cruise speed in Orion's Arm is **0.84c for every drive from the conversion drive
(1987 AT) onward**; the differences between later drives are in maximum speed,
range, and what they do about debris. Maxima: conversion drive 0.88c (range 200
ly), conversion ramjet 0.96c (10,000+ ly), displacement 0.98c (1,000 ly), Halo
0.99c (5,000 ly), void ship 0.999+c. The Halo drive first appears in **4200 AT**.
Acceleration is g-compensated at up to 1000 g, so the ramp is days and journey
time is simply distance ÷ speed.

Two consequences for anything crossing this volume:

**A 1,934 ly leg is a two-millennium journey.** From Kelarc: 2302 years at
cruise, 1953 years at the Halo drive's absolute maximum. Nothing launched in
4330 reaches Collinder 132 before **6283**.

**Distance is the constraint, not date.** A launch at 4330 arriving 5800 has
1470 years, which buys 1235 ly at cruise and 1455 ly flat out — so it can reach
Collinder 140 (1079 ly from Kelarc), BBJ 2 (1116), NGC 2451B (995) or Trumpler
10 (1244), but not Collinder 132 or Haffner 13.

The older 1500 ly figure for Collinder 132, taken from early two-dimensional
maps, is what made longer journeys look possible. Two independent modern sources
put it at **~2100** — this map's cluster catalogue (Hunt & Reffert, as Theia
1765) gives 2079 ly and the Snake paper 2106 — and the Encyclopaedia's own
worlds out there agree with them rather than with 1500: Hhrraiirah 1981, Oia
2101, Blefuscu 2105, Grignard 2120, Bambata 2200. The articles and the
astrometry independently place the far neighbourhood in the same shell.

## Expansion arithmetic

From a colony at Collinder 140 founded 5614, flying direct at 0.84c, the rest of
the structure comes within reach in this order — no-earlier-than dates, since
they allow no time to build a launch capability at each step:

| BBJ 2 | 5810 | NGC 2451B | 5816 | Collinder 135 | 5962 |
|---|---|---|---|---|---|
| BBJ 3 | 6050 | UBC 7 | 6058 | NGC 2547 | 6115 |
| BBJ 1 | 6154 | Trumpler 10 | 6188 | Haffner 13 | 6311 |
| Tian 2 | 6327 | NGC 2232 | 6367 | **Collinder 132** | **6634** |

Collinder 132 comes last, being the far terminus 857 ly beyond. Anything
spreading along the Snake from the middle reaches it late — after Oia (5411),
Hhrraiirah (5533), Grignard (5309) and Bambata (6100) — which is a reason those
places are independent rather than a problem to explain. The paper's note that
Collinder 132 and Haffner 13 are poorly bridged to the main body gives the same
answer from the kinematics: a structure stops being a corridor where it stops
being coherent.

## What this is for

Mantycore is writing a contribution to the setting sited in this volume, and
these numbers came out of testing its timeline. That work is the author's and is
not recorded here. What is worth keeping is the method, which applies to any
canon date in this map:

- a stated founding date plus a plausible origin implies a mean speed, and
  0.84c cruise / 0.99c absolute makes that a hard test rather than a soft one;
- the corridor decomposition — along-track and cross-track from origin to
  destination — turns "is X on the way?" into a number;
- and where a route crosses a real stellar structure, the structure's own
  coherence is an argument about where a civilisation would and would not
  spread.
