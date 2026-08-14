"""Place the sheet's unplaced labels by interpolating between its placed ones.

A single affine fit over the whole sheet is the wrong instrument: the rows and
columns are not evenly spaced, so a transform that is right in Cygnus is wrong in
Vela. Every label we can already place is an anchor, and each unplaced label is
fitted from the anchors *around it* — which also absorbs the local offset between
where Anders put a landmark and where the catalogue puts it, instead of averaging
that offset across the sheet.

What comes out is a proposal, not a position. Three numbers say how much to
trust each one: how far the nearest anchor is, how well the local fit reproduces
the anchors it used, and whether the target sits inside them or beyond the edge.
"""
import json
import re
import sys
from collections import defaultdict

import numpy as np
import yaml

sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from readods import read_sheet

R = '../web/public/data/'
PC = 3.261563777
K = 12          # anchors per local fit
MIN_ANCHORS = 6


def norm(name):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\?|\(.*?\)', '', name).strip().lower())


# ---- everything we can already place ---------------------------------------
# Built through the real Resolver, not by indexing catalogue names directly.
# The difference is large: the sheet says "M50", "Gamma Cas", "Ptolemy's
# Cluster", and none of those is a catalogue name. Looking them up by hand made
# them targets to be interpolated when they are anchors we already have, which
# both loses an anchor and invents an answer for something already known.
sys.path.insert(0, 'src')
from oastarmap.fiction.resolve import Resolver as _Resolver   # noqa: E402

placed = {}
clusters = json.load(open(R + 'clusters.names.json', encoding='utf-8'))
cgeom = np.fromfile(R + 'clusters.bin', dtype=np.float32).reshape(-1, 8)
for i, r in enumerate(clusters):
    for n in [r['name']] + r.get('aliases', '').split(','):
        if n:
            placed.setdefault(norm(n), ('cluster', cgeom[i, :3] * PC))
hii = json.load(open(R + 'hii.names.json', encoding='utf-8'))
hgeom = np.fromfile(R + 'hii.bin', dtype=np.float32).reshape(-1, 7)
for i, r in enumerate(hii):
    nm = r if isinstance(r, str) else r.get('name', '')
    if nm:
        placed.setdefault(norm(nm), ('hii', hgeom[i, :3] * PC))

stars = np.fromfile(R + 'stars.bin', dtype=np.float32).reshape(-1, 5)
star_names = json.load(open(R + 'stars.names.json', encoding='utf-8'))
for idx, entry in star_names.items():
    for field in ('proper', 'bf', 'bayer'):
        v = entry.get(field)
        if v:
            placed.setdefault(norm(v), ('star', stars[int(idx), :3] * PC))

oa_pos = np.fromfile(R + 'oastars.bin', dtype=np.float32).reshape(-1, 5)
oa_entries = json.load(open(R + 'oastars.names.json', encoding='utf-8'))
oa_index = {e['name']: i for i, e in enumerate(oa_entries)}
for i, e in enumerate(oa_entries):
    for n in filter(None, [e.get('label'), e.get('name')]):
        placed.setdefault(norm(n), ('add-on', oa_pos[i, :3] * PC))

worlds = json.load(open(R + 'worlds.json', encoding='utf-8'))
wrows = worlds['worlds'] if isinstance(worlds, dict) else worlds
for r in wrows:
    p = None
    if r.get('x') is not None:
        p = np.array([r['x'], r['y'], r['z']]) * PC
    elif r.get('star_index') is not None:
        p = stars[r['star_index'], :3] * PC
    elif r.get('oa_star') and r['oa_star'] in oa_index:
        p = oa_pos[oa_index[r['oa_star']], :3] * PC
    if p is not None:
        for n in [r['name']] + (r.get('also') or []):
            placed.setdefault(norm(n), ('world', p))
inner = json.load(open(R + 'innersphere.json', encoding='utf-8'))
for c in (inner['colonies'] if isinstance(inner, dict) else inner):
    if c['colony']:
        for n in c['colony'].split(' / '):
            placed.setdefault(norm(n), ('colony', stars[c['star_index'], :3] * PC))

_aliases = yaml.safe_load(open('../fiction/aliases.yaml', encoding='utf-8'))['aliases']
_resolver = _Resolver(clusters, star_names, _aliases, hii)
_geom = {'cluster': cgeom, 'hii': hgeom}


def locate(text):
    """Where the map puts this label, by any route it knows."""
    key = norm(text)
    if key in placed:
        return placed[key][1]
    binding = _resolver.resolve(text, [])
    if not binding.resolved or binding.index is None:
        return None
    if binding.kind == 'star':
        return stars[binding.index, :3] * PC
    return _geom[binding.kind][binding.index, :3] * PC

# ---- the sheet -------------------------------------------------------------
cells, _ = read_sheet("../sources/Orion's Arm Map.ods", 'Sheet1')
polities = yaml.safe_load(open('../fiction/polities.yaml', encoding='utf-8'))['polities']
label_names = {norm(p['name']) for p in polities}
extra_labels = {'innersphere', 'serpensregion', 'puppis', 'tunh', 'umma', 'noconeg',
                'saggitariuscooperation', 'perseusrift', 'cygexba', 'emplededcetic',
                'emplecokcetic', 'metasoft', 'outland'}

anchors, targets = [], []
for c in cells:
    k = norm(c['text'])
    if not k or k in label_names or k in extra_labels or len(c['text']) < 3:
        continue
    found = locate(c['text'])
    if found is not None:
        anchors.append((c, found))
    else:
        targets.append(c)

print(f'{len(anchors)} anchors, {len(targets)} labels to place')

A = np.array([[a['col'], a['row']] for a, _ in anchors], float)
P = np.array([p for _, p in anchors])


def _loo(A, P, K):
    """How far each anchor lands from itself when the others predict it."""
    errs = np.empty(len(A))
    for i in range(len(A)):
        mask = np.ones(len(A), bool)
        mask[i] = False
        a, p = A[mask], P[mask]
        d = np.hypot(a[:, 0] - A[i, 0], a[:, 1] - A[i, 1])
        o = np.argsort(d)[:K]
        w = 1.0 / (1.0 + d[o] ** 2)
        M = np.column_stack([a[o, 0], a[o, 1], np.ones(len(o))])
        W = np.sqrt(w)[:, None]
        c = [np.linalg.lstsq(M * W, p[o, j] * W[:, 0], rcond=None)[0] for j in (0, 1)]
        pred = np.array([c[0] @ [A[i, 0], A[i, 1], 1], c[1] @ [A[i, 0], A[i, 1], 1]])
        errs[i] = np.linalg.norm(pred - P[i, :2])
    return errs


# An anchor the rest of the sheet cannot predict is not anchoring anything — it
# is dragging every fit that uses it. Two quite different things end up here and
# both should go: objects whose catalogue distance is wrong (Collinder 97 sits at
# 16,804 ly here and the Encyclopaedia says 2,045) and objects Anders genuinely
# drew somewhere else. Dropping them takes the median prediction error from 693
# ly to 265.
DISCORDANT = []
_keep = np.ones(len(A), bool)
for _ in range(40):
    _e = _loo(A[_keep], P[_keep], K)
    _idx = np.where(_keep)[0]
    _w = int(_e.argmax())
    if _e[_w] < 4 * np.median(_e) or _keep.sum() < 60:
        break
    DISCORDANT.append((anchors[_idx[_w]][0]['text'], float(_e[_w]),
                       float(np.linalg.norm(P[_idx[_w]]))))
    _keep[_idx[_w]] = False

ACCURACY = _loo(A[_keep], P[_keep], K)
print(f'dropped {len(DISCORDANT)} discordant anchors; {_keep.sum()} anchor the fits')
print(f'prediction error, leave-one-out: median {np.median(ACCURACY):.0f} ly, '
      f'{100*np.mean(ACCURACY<600):.0f}% within 600 ly')
A, P = A[_keep], P[_keep]

# z from the text colour, calibrated on the anchors themselves.
by_colour = defaultdict(list)
for (c, p) in anchors:
    for f in c['fg']:
        by_colour[f].append(p[2])
LAYER_Z = {f: float(np.median(v)) for f, v in by_colour.items() if len(v) >= 4}
print('z-layers, from the anchors:',
      {k: round(v) for k, v in sorted(LAYER_Z.items(), key=lambda kv: kv[1])})


def local_fit(col, row):
    d = np.hypot(A[:, 0] - col, A[:, 1] - row)
    order = np.argsort(d)[:K]
    if len(order) < MIN_ANCHORS:
        return None
    w = 1.0 / (1.0 + d[order] ** 2)
    M = np.column_stack([A[order, 0], A[order, 1], np.ones(len(order))])
    W = np.sqrt(w)[:, None]
    coef = [np.linalg.lstsq(M * W, P[order, i] * W[:, 0], rcond=None)[0] for i in (0, 1)]
    pred = np.array([coef[0] @ [col, row, 1], coef[1] @ [col, row, 1]])
    fitted = np.column_stack([M @ coef[0], M @ coef[1]])
    rms = float(np.sqrt(np.mean(np.sum((fitted - P[order, :2]) ** 2, axis=1))))
    inside = (A[order, 0].min() <= col <= A[order, 0].max()
              and A[order, 1].min() <= row <= A[order, 1].max())
    return pred, rms, float(d[order].min()), inside


out = []
for c in targets:
    got = local_fit(c['col'], c['row'])
    if got is None:
        continue
    (x, y), rms, nearest, inside = got
    zs = [LAYER_Z[f] for f in c['fg'] if f in LAYER_Z]
    z = float(np.mean(zs)) if zs else 0.0
    out.append({'name': c['text'], 'x': x, 'y': y, 'z': z, 'rms': rms,
                'nearest': nearest, 'inside': inside,
                'dist': float(np.hypot(np.hypot(x, y), z))})

out.sort(key=lambda r: (not r['inside'], r['rms']))
print(f'\n{len(out)} placed; {sum(1 for r in out if r["inside"])} sit inside their anchors\n')
print(f'{"label":30} {"dist":>7} {"x":>7} {"y":>7} {"z":>6} {"fit":>6} {"gap":>5}')
for r in out[:45]:
    flag = '' if r['inside'] else '  (extrapolated)'
    print(f'{r["name"][:30]:30} {r["dist"]:7.0f} {r["x"]:7.0f} {r["y"]:7.0f} {r["z"]:6.0f} '
          f'{r["rms"]:6.0f} {r["nearest"]:5.1f}{flag}')

with open(sys.argv[1], 'w', encoding='utf-8') as fh:
    fh.write('name\tx_ly\ty_ly\tz_ly\tdistance_ly\tfit_rms_ly\tnearest_anchor_cells\tinside_anchors\n')
    for r in out:
        fh.write(f'{r["name"]}\t{r["x"]:.0f}\t{r["y"]:.0f}\t{r["z"]:.0f}\t{r["dist"]:.0f}\t'
                 f'{r["rms"]:.0f}\t{r["nearest"]:.1f}\t{"yes" if r["inside"] else "no"}\n')
