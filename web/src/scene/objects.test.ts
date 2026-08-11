/**
 * Tests for the shared object index.
 *
 * The load-bearing check is `agrees with three.js's own projection`. Everything
 * here — where a label goes, what is under the cursor — rests on a hand-rolled
 * 4x4 multiply written to avoid allocating 126,000 Vector3s per frame. If it
 * disagrees with the library by even a little, labels drift off their objects and
 * clicks land on the wrong star, both of which look like styling problems rather
 * than arithmetic ones.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type {
  ClusterData,
  FictionData,
  HiiData,
  OAStarData,
  StarData,
  WorldData,
  WorldEntry,
} from '../data/manifest';
import { affiliationsFor } from '../data/manifest';
import {
  KIND_CLUSTER,
  KIND_HII,
  KIND_OASTAR,
  KIND_STAR,
  ObjectIndex,
  bayerLabel,
  composeLabel,
} from './objects';

const WIDTH = 800;
const HEIGHT = 600;

const ALL_VISIBLE = { star: true, cluster: true, hii: true, oastar: true, world: true };

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 1e6);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld();
  return cam;
}

/** Stars at given positions, all absolute magnitude 0 unless stated. */
function makeStars(
  positions: [number, number, number][],
  names: Record<string, Record<string, string>> = {},
  absMags?: number[],
): StarData {
  const data = new Float32Array(positions.length * 5);
  positions.forEach(([x, y, z], i) => {
    data[i * 5] = x;
    data[i * 5 + 1] = y;
    data[i * 5 + 2] = z;
    data[i * 5 + 3] = absMags ? absMags[i] : 0;
    data[i * 5 + 4] = 0;
  });
  return {
    count: positions.length,
    positions: data,
    ids: new Int32Array(positions.length * 2).fill(-1),
    spectralClass: new Uint8Array(positions.length),
    constellation: new Uint8Array(positions.length),
    colorLut: new Float32Array(3),
    names,
    dataset: {} as StarData['dataset'],
  };
}

function makeClusters(entries: { xyz: [number, number, number]; radius: number; name: string }[]) {
  const geometry = new Float32Array(entries.length * 8);
  entries.forEach((entry, i) => {
    geometry[i * 8] = entry.xyz[0];
    geometry[i * 8 + 1] = entry.xyz[1];
    geometry[i * 8 + 2] = entry.xyz[2];
    geometry[i * 8 + 3] = entry.radius;
  });
  return {
    count: entries.length,
    geometry,
    meta: new Int32Array(entries.length * 2),
    ages: new Float32Array(entries.length),
    names: entries.map((e) => ({ name: e.name, aliases: '', quality: '' })),
    dataset: {} as ClusterData['dataset'],
  } as ClusterData;
}

function makeHii(entries: { xyz: [number, number, number]; radius: number; name: string }[]) {
  const geometry = new Float32Array(entries.length * 7);
  entries.forEach((entry, i) => {
    geometry[i * 7] = entry.xyz[0];
    geometry[i * 7 + 1] = entry.xyz[1];
    geometry[i * 7 + 2] = entry.xyz[2];
    geometry[i * 7 + 3] = entry.radius;
  });
  return {
    count: entries.length,
    geometry,
    meta: new Int32Array(entries.length * 2),
    names: entries.map((e) => ({
      name: e.name,
      aliases: '',
      complex: '',
      diameter_arcmin: 10,
      brightness: '',
      form: '',
      structure: '',
    })),
    dataset: {} as HiiData['dataset'],
  } as HiiData;
}

function makeOAStars(
  entries: {
    xyz: [number, number, number];
    name: string;
    system?: string;
    label?: string;
    hidden?: boolean;
    real?: string;
  }[],
): OAStarData {
  const positions = new Float32Array(entries.length * 5);
  entries.forEach((entry, i) => {
    positions[i * 5] = entry.xyz[0];
    positions[i * 5 + 1] = entry.xyz[1];
    positions[i * 5 + 2] = entry.xyz[2];
    positions[i * 5 + 3] = 4.7; // typical for these; apparent mag 12+ at any range
    positions[i * 5 + 4] = -99;
  });
  return {
    count: entries.length,
    positions,
    names: entries.map((e) => ({
      name: e.name,
      comment: '',
      spectral_type: 'G2V',
      distance_pc: 0,
      oa_designation: e.name.startsWith('JD ') || e.name.startsWith('YTS '),
      system: e.system ?? '',
      label: e.label ?? e.system ?? e.name,
      affiliation: '',
      real: e.real ?? '',
      uncertain: false,
      article: '',
      note: '',
      hidden: e.hidden ?? false,
      source_file: 'x.stc',
    })),
    colorLut: new Float32Array(3),
    dataset: { layout: { positions: { ci_unknown_sentinel: -99 } } } as OAStarData['dataset'],
  };
}

const pickOptions = { width: WIDTH, height: HEIGHT, magnitudeLimit: 20, visible: ALL_VISIBLE };

describe('projection', () => {
  it("agrees with three.js's own projection", () => {
    // All within the frustum: at z=-100 a 60-degree vertical field reaches
    // +/-57.7 pc, and the 4:3 aspect widens that to +/-77 pc horizontally.
    const points: [number, number, number][] = [
      [0, 0, -100],
      [30, 20, -100],
      [-45, 12, -250],
      [5, -30, -100],
      [200, 150, -1000],
    ];
    const cam = camera();
    const index = new ObjectIndex(makeStars(points), null, null, null);

    for (const [i, point] of points.entries()) {
      const expected = new THREE.Vector3(...point).project(cam);
      const expectedX = (expected.x * 0.5 + 0.5) * WIDTH;
      const expectedY = (-expected.y * 0.5 + 0.5) * HEIGHT;

      // Picking exactly at the projected position must find that star.
      const id = index.pick(cam, expectedX, expectedY, pickOptions, 1);
      expect(id, `point ${i} at (${expectedX}, ${expectedY})`).toBe(i);
    }
  });

  it('culls objects outside the viewport', () => {
    const cam = camera();
    // Far below the bottom edge: at z=-60 the frustum only reaches +/-34.6 pc.
    const index = new ObjectIndex(makeStars([[5, -80, -60]]), null, null, null);
    const projected = new THREE.Vector3(5, -80, -60).project(cam);
    const y = (-projected.y * 0.5 + 0.5) * HEIGHT;
    expect(y).toBeGreaterThan(HEIGHT);
    expect(index.pick(cam, 443, y, pickOptions, 5)).toBeNull();
  });

  it('ignores objects behind the camera', () => {
    const cam = camera();
    // Mirror of a visible point: same screen position if the sign were dropped.
    const index = new ObjectIndex(makeStars([[0, 0, 100]]), null, null, null);
    expect(index.pick(cam, WIDTH / 2, HEIGHT / 2, pickOptions, 50)).toBeNull();
  });
});

describe('picking', () => {
  it('returns the star nearest the cursor', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([
        [0, 0, -100],
        [8, 0, -100],
      ]),
      null,
      null,
      null,
    );
    const centre = new THREE.Vector3(0, 0, -100).project(cam);
    const cx = (centre.x * 0.5 + 0.5) * WIDTH;
    const cy = (-centre.y * 0.5 + 0.5) * HEIGHT;

    expect(index.pick(cam, cx, cy, pickOptions, 200)).toBe(0);
    expect(index.pick(cam, cx + 100, cy, pickOptions, 200)).toBe(1);
  });

  it('misses when nothing is within tolerance', () => {
    const cam = camera();
    const index = new ObjectIndex(makeStars([[0, 0, -100]]), null, null, null);
    expect(index.pick(cam, 10, 10, pickOptions, 5)).toBeNull();
  });

  it('respects the magnitude limit, so only drawn stars are clickable', () => {
    const cam = camera();
    // At 100 pc, m = M + 5*log10(10) = M + 5. A star of M=10 is m=15.
    const index = new ObjectIndex(makeStars([[0, 0, -100]], {}, [10]), null, null, null);
    const at = { ...pickOptions, magnitudeLimit: 7.5 };
    expect(index.pick(cam, WIDTH / 2, HEIGHT / 2, at, 50)).toBeNull();
    expect(
      index.pick(cam, WIDTH / 2, HEIGHT / 2, { ...pickOptions, magnitudeLimit: 16 }, 50),
    ).toBe(0);
  });

  it('prefers a star over a cluster surrounding it', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]]),
      makeClusters([{ xyz: [0, 0, -100], radius: 20, name: 'NGC_1' }]),
      null,
      null,
    );
    const id = index.pick(cam, WIDTH / 2, HEIGHT / 2, pickOptions, 20);
    expect(id).not.toBeNull();
    expect(index.ref(id as number).kind).toBe(KIND_STAR);
  });

  it('treats a large cluster as a ring, not a disc', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([]),
      makeClusters([{ xyz: [0, 0, -100], radius: 30, name: 'NGC_1' }]),
      null,
      null,
    );
    // Dead centre is the hollow middle — not the cluster.
    expect(index.pick(cam, WIDTH / 2, HEIGHT / 2, pickOptions, 7)).toBeNull();
  });

  it('keeps a small cluster clickable throughout', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([]),
      makeClusters([{ xyz: [0, 0, -100], radius: 0.05, name: 'NGC_1' }]),
      null,
      null,
    );
    const id = index.pick(cam, WIDTH / 2, HEIGHT / 2, pickOptions, 7);
    expect(id).not.toBeNull();
    expect(index.ref(id as number).kind).toBe(KIND_CLUSTER);
  });

  it('prefers a cluster over an HII region behind it', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([]),
      makeClusters([{ xyz: [0, 0, -100], radius: 0.05, name: 'NGC_1' }]),
      makeHii([{ xyz: [0, 0, -120], radius: 40, name: 'S1' }]),
      null,
    );
    const id = index.pick(cam, WIDTH / 2, HEIGHT / 2, pickOptions, 7);
    expect(index.ref(id as number).kind).toBe(KIND_CLUSTER);
  });

  it('never returns an object from a hidden layer', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]]),
      makeClusters([{ xyz: [0, 0, -100], radius: 0.05, name: 'NGC_1' }]),
      null,
      null,
    );
    const hidden = { ...pickOptions, visible: { star: false, cluster: true, hii: true, oastar: true, world: true } };
    const id = index.pick(cam, WIDTH / 2, HEIGHT / 2, hidden, 20);
    expect(index.ref(id as number).kind).toBe(KIND_CLUSTER);
  });

  it('maps ids back to per-catalog indices', () => {
    const index = new ObjectIndex(
      makeStars([
        [0, 0, -1],
        [0, 0, -2],
      ]),
      makeClusters([{ xyz: [0, 0, -3], radius: 1, name: 'NGC_1' }]),
      makeHii([{ xyz: [0, 0, -4], radius: 1, name: 'S1' }]),
      null,
    );
    expect(index.ref(0)).toEqual({ kind: KIND_STAR, index: 0 });
    expect(index.ref(1)).toEqual({ kind: KIND_STAR, index: 1 });
    expect(index.ref(2)).toEqual({ kind: KIND_CLUSTER, index: 0 });
    expect(index.ref(3)).toEqual({ kind: KIND_HII, index: 0 });
  });
});

describe('label layout', () => {
  const layoutOptions = {
    width: WIDTH,
    height: HEIGHT,
    magnitudeLimit: 20,
    maxLabels: 50,
    visible: ALL_VISIBLE,
  };

  it('labels only objects that have a name', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars(
        [
          [0, 0, -100],
          [40, 0, -100],
        ],
        { '0': { proper: 'Vega' } },
      ),
      null,
      null,
      null,
    );
    const placed = index.layout(cam, layoutOptions);
    expect(placed.map((p) => p.text)).toEqual(['Vega']);
  });

  it('rejects labels that would overlap', () => {
    const cam = camera();
    // Two named stars at almost the same screen position.
    const index = new ObjectIndex(
      makeStars(
        [
          [0, 0, -100],
          [0.01, 0, -100],
        ],
        { '0': { proper: 'Vega' }, '1': { proper: 'Altair' } },
      ),
      null,
      null,
      null,
    );
    expect(index.layout(cam, layoutOptions)).toHaveLength(1);
  });

  it('honours the maximum', () => {
    const cam = camera();
    const positions: [number, number, number][] = [];
    const names: Record<string, Record<string, string>> = {};
    for (let i = 0; i < 40; i++) {
      positions.push([(i % 8) * 4 - 16, Math.floor(i / 8) * 4 - 8, -100]);
      names[String(i)] = { proper: `Star${i}` };
    }
    const index = new ObjectIndex(makeStars(positions, names), null, null, null);
    expect(index.layout(cam, { ...layoutOptions, maxLabels: 5 })).toHaveLength(5);
  });

  it('ranks a proper name above a survey designation', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]], { '0': { proper: 'Vega' } }),
      makeClusters([{ xyz: [30, 0, -100], radius: 0.1, name: 'CWNU_1242' }]),
      null,
      null,
    );
    const placed = index.layout(cam, layoutOptions);
    expect(placed[0].text).toBe('Vega');
  });

  it('drops labels for a hidden layer', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]], { '0': { proper: 'Vega' } }),
      null,
      null,
      null,
    );
    const hidden = { ...layoutOptions, visible: { star: false, cluster: true, hii: true, oastar: true, world: true } };
    expect(index.layout(cam, hidden)).toHaveLength(0);
  });

  it('renders cluster underscores as spaces', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([]),
      makeClusters([{ xyz: [0, 0, -100], radius: 0.1, name: 'Melotte_25' }]),
      null,
      null,
    );
    expect(index.layout(cam, layoutOptions)[0].text).toBe('Melotte 25');
  });
});

describe('Bayer designations', () => {
  it('joins the Greek letter to its constellation', () => {
    // HYG's `bayer` field is "Alp" alone. On its own it names 88 different stars.
    expect(bayerLabel('Alp', 'And')).toBe('α And');
    expect(bayerLabel('Bet', 'Cap')).toBe('β Cap');
  });

  it('renders the component index as a superscript', () => {
    expect(bayerLabel('Alp-1', 'Cap')).toBe('α¹ Cap');
    expect(bayerLabel('Kap-2', 'Sgr')).toBe('κ² Sgr');
  });

  it('keeps an unrecognised abbreviation rather than dropping it', () => {
    expect(bayerLabel('Zzz', 'Ori')).toBe('Zzz Ori');
  });

  it('survives a missing constellation', () => {
    expect(bayerLabel('Alp', '')).toBe('α');
  });

  it('is what the label layout actually emits', () => {
    const cam = camera();
    const stars = makeStars([[0, 0, -100]], { '0': { bayer: 'Alp-1' } });
    stars.constellation = new Uint8Array([1]);
    stars.dataset = {
      layout: { constellations: { values: ['', 'Cap'] } },
    } as StarData['dataset'];
    const placed = new ObjectIndex(stars, null, null, null).layout(cam, {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 10,
      visible: ALL_VISIBLE,
    });
    expect(placed[0].text).toBe('α¹ Cap');
  });
});

describe('Orion\u2019s Arm stars', () => {
  it('stays pickable below the magnitude limit', () => {
    // Drawn as constant-size markers, so the star magnitude limit must not gate
    // them. At 100 pc with M=4.7 the apparent magnitude is ~9.7; a limit of 7.5
    // would hide a real star and previously hid these too.
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([]),
      null,
      null,
      null,
      makeOAStars([{ xyz: [0, 0, -100], name: 'Cantor' }]),
    );
    const at = { ...pickOptions, magnitudeLimit: 7.5 };
    const id = index.pick(cam, WIDTH / 2, HEIGHT / 2, at, 10);
    expect(id).not.toBeNull();
    expect(index.ref(id as number).kind).toBe(KIND_OASTAR);
  });

  it('is hidden when its layer is off', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([]),
      null,
      null,
      null,
      makeOAStars([{ xyz: [0, 0, -100], name: 'Cantor' }]),
    );
    const hidden = {
      ...pickOptions,
      visible: { star: true, cluster: true, hii: true, oastar: false, world: true },
    };
    expect(index.pick(cam, WIDTH / 2, HEIGHT / 2, hidden, 10)).toBeNull();
  });

  it('ranks a named system above JD filler', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([]),
      null,
      null,
      null,
      makeOAStars([
        { xyz: [30, 0, -100], name: 'JD 518774' },
        { xyz: [0, 0, -100], name: 'Cantor' },
      ]),
    );
    const placed = index.layout(cam, {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 10,
      visible: ALL_VISIBLE,
    });
    expect(placed[0].text).toBe('Cantor');
  });
});

describe('Orion\u2019s Arm system names', () => {
  const layoutAt = (index: ObjectIndex) =>
    index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 10,
      visible: ALL_VISIBLE,
    });

  it('labels a star by the system it is the sun of', () => {
    // "JD 836901" names nothing; its comment says it is the sun of Wurm.
    const index = new ObjectIndex(
      makeStars([]),
      null,
      null,
      null,
      makeOAStars([{ xyz: [0, 0, -100], name: 'JD 836901', system: 'Wurm' }]),
    );
    expect(layoutAt(index)[0].text).toBe('Wurm');
  });

  it('ranks a star with a system alongside a named one', () => {
    const index = new ObjectIndex(
      makeStars([]),
      null,
      null,
      null,
      makeOAStars([
        { xyz: [0, 0, -100], name: 'JD 836901', system: 'Wurm' },
        { xyz: [40, 0, -100], name: 'JD 518774' },
      ]),
    );
    const placed = layoutAt(index);
    expect(placed[0].text).toBe('Wurm');
  });

  it('still labels a bare designation rather than hiding it', () => {
    // An unlabelled marker is a dot that cannot be looked up.
    const index = new ObjectIndex(
      makeStars([]),
      null,
      null,
      null,
      makeOAStars([{ xyz: [0, 0, -100], name: 'JD 518774' }]),
    );
    expect(layoutAt(index).map((p) => p.text)).toEqual(['JD 518774']);
  });

  it('falls back to the designation when no system is given', () => {
    const index = new ObjectIndex(
      makeStars([]),
      null,
      null,
      null,
      makeOAStars([{ xyz: [0, 0, -100], name: 'Cantor' }]),
    );
    expect(layoutAt(index)[0].text).toBe('Cantor');
  });
});

describe('label priority', () => {
  const layoutOne = (index: ObjectIndex, maxLabels: number) =>
    index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels,
      visible: ALL_VISIBLE,
    });

  it('labels a named OA system ahead of a screen-filling polity cluster', () => {
    // The regression: only extended objects earn the size bonus, so a cluster
    // large on screen scored 2.8 while a named OA system scored 0.9 and never
    // appeared while clusters were on.
    const clusters = makeClusters([{ xyz: [20, 0, -100], radius: 60, name: 'NGC_1' }]);
    const fiction = {
      polities: [{ index: 1, id: 'p', name: 'P' }],
      bindings: [{ kind: 'cluster', index: 0, polities: ['p'] }],
    } as unknown as FictionData;

    const index = new ObjectIndex(
      makeStars([]),
      clusters,
      null,
      fiction,
      makeOAStars([{ xyz: [-20, 0, -100], name: 'JD 1', system: 'Wurm' }]),
    );
    expect(layoutOne(index, 1)[0].text).toBe('Wurm');
  });

  it('labels a named OA system ahead of a proper-named real star', () => {
    const index = new ObjectIndex(
      makeStars([[20, 0, -100]], { '0': { proper: 'Vega' } }),
      null,
      null,
      null,
      makeOAStars([{ xyz: [-20, 0, -100], name: 'Cantor' }]),
    );
    expect(layoutOne(index, 1)[0].text).toBe('Cantor');
  });

  it('still ranks a bare designation below an ordinary cluster', () => {
    const index = new ObjectIndex(
      makeStars([]),
      makeClusters([{ xyz: [20, 0, -100], radius: 1, name: 'NGC_1' }]),
      null,
      null,
      makeOAStars([{ xyz: [-20, 0, -100], name: 'JD 518774' }]),
    );
    expect(layoutOne(index, 1)[0].text).toBe('NGC 1');
  });
});

describe('settled systems', () => {
  const withColony = (index: number, name: string, affiliations: string[] = []) =>
    new Map([
      [
        index,
        {
          star_index: index,
          star: 'x',
          colony: name,
          spectral_type: '',
          mass_sol: '',
          luminosity_sol: '',
          distance_ly: 10,
          method: 'name',
          distance_disagrees: false,
          affiliations,
          status: '',
          note: '',
        },
      ],
    ]);

  const layoutOne = (index: ObjectIndex, maxLabels: number) =>
    index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels,
      visible: ALL_VISIBLE,
    });

  it('labels a star by its colony rather than its catalogue name', () => {
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]], { '0': { proper: 'Wolf 359' } }),
      null,
      null,
      null,
      null,
      withColony(0, 'Akela'),
    );
    expect(layoutOne(index, 5)[0].text).toBe('Akela');
  });

  it('ranks a settled system above a plain named star', () => {
    const index = new ObjectIndex(
      makeStars(
        [
          [0, 0, -100],
          [40, 0, -100],
        ],
        { '0': { proper: 'Wolf 359' }, '1': { proper: 'Vega' } },
      ),
      null,
      null,
      null,
      null,
      withColony(0, 'Akela', ['nocozo']),
    );
    expect(layoutOne(index, 1)[0].text).toBe('Akela');
  });

  it('ranks an affiliated system above a screen-filling cluster', () => {
    const clusters = makeClusters([{ xyz: [40, 0, -100], radius: 60, name: 'NGC_1' }]);
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]], { '0': { proper: 'Wolf 359' } }),
      clusters,
      null,
      null,
      null,
      withColony(0, 'Akela', ['nocozo']),
    );
    expect(layoutOne(index, 1)[0].text).toBe('Akela');
  });
});

describe("Orion's Arm only mode", () => {
  const settled = (index: number) =>
    new Map([
      [
        index,
        {
          star_index: index,
          star: 'x',
          colony: 'Akela',
          spectral_type: '',
          mass_sol: '',
          luminosity_sol: '',
          distance_ly: 10,
          method: 'name',
          distance_disagrees: false,
          affiliations: ['nocozo'],
          status: '',
          note: '',
        },
      ],
    ]);

  const build = () =>
    new ObjectIndex(
      makeStars(
        [
          [0, 0, -100],
          [40, 0, -100],
        ],
        { '0': { proper: 'Wolf 359' }, '1': { proper: 'Vega' } },
      ),
      null,
      null,
      null,
      null,
      settled(0),
    );

  const layout = (index: ObjectIndex, oaOnly: boolean) =>
    index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 10,
      visible: { ...ALL_VISIBLE, oaOnly },
    });

  it('keeps everything when off', () => {
    expect(layout(build(), false).map((p) => p.text).sort()).toEqual(['Akela', 'Vega']);
  });

  it('drops a star with no Orion\u2019s Arm content', () => {
    expect(layout(build(), true).map((p) => p.text)).toEqual(['Akela']);
  });

  it('makes an unclaimed star unpickable too', () => {
    // Otherwise a hidden star stays clickable, which reads as a ghost.
    const index = build();
    const vega = new THREE.Vector3(40, 0, -100).project(camera());
    const x = (vega.x * 0.5 + 0.5) * WIDTH;
    const y = (-vega.y * 0.5 + 0.5) * HEIGHT;
    const opts = { width: WIDTH, height: HEIGHT, magnitudeLimit: 20 };
    expect(index.pick(camera(), x, y, { ...opts, visible: ALL_VISIBLE }, 8)).toBe(1);
    expect(
      index.pick(camera(), x, y, { ...opts, visible: { ...ALL_VISIBLE, oaOnly: true } }, 8),
    ).toBeNull();
  });

  it('carries the polity colour on the label', () => {
    const fiction = {
      polities: [{ index: 1, id: 'nocozo', name: 'NoCoZo', color: '#FF7043' }],
      bindings: [],
    } as unknown as FictionData;
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]], { '0': { proper: 'Wolf 359' } }),
      null,
      null,
      fiction,
      null,
      settled(0),
    );
    expect(layout(index, false)[0].color).toBe('#FF7043');
  });
});


describe('label priority does not encode our own record-keeping', () => {
  const colonyAt = (index: number, name: string, affiliations: string[] = []) => [
    index,
    {
      star_index: index,
      star: 'x',
      colony: name,
      spectral_type: '',
      mass_sol: '',
      luminosity_sol: '',
      distance_ly: 10,
      method: 'name',
      distance_disagrees: false,
      affiliations,
      status: '',
      note: '',
    },
  ] as const;

  const layoutAll = (index: ObjectIndex) =>
    index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 20,
      visible: ALL_VISIBLE,
    });

  /**
   * Wadai is an add-on entry that happens to carry an article; the colonies
   * around it are table rows that do not. Ranking on that made Wadai outrank
   * the whole Inner Sphere, which reports how far our transcription has got
   * rather than anything Orion's Arm says.
   */
  it('ranks an add-on system level with an Inner Sphere colony', () => {
    const index = new ObjectIndex(
      makeStars([[40, 0, -100]]),
      null,
      null,
      null,
      makeOAStars([{ xyz: [-40, 0, -100], name: 'EG 471', label: 'Wadai' }]),
      new Map([colonyAt(0, 'Akela')]),
    );

    const placed = layoutAll(index);
    const wadai = placed.find((p) => p.text === 'Wadai');
    const akela = placed.find((p) => p.text === 'Akela');
    expect(wadai).toBeDefined();
    expect(akela).toBeDefined();
    expect(wadai!.importance).toBe(akela!.importance);
  });

  it('does not rank a colony higher for having a polity', () => {
    const index = new ObjectIndex(
      makeStars([
        [-40, 0, -100],
        [40, 0, -100],
      ]),
      null,
      null,
      null,
      null,
      new Map([colonyAt(0, 'Assigned', ['metasoft']), colonyAt(1, 'Unassigned')]),
    );

    const placed = layoutAll(index);
    const assigned = placed.find((p) => p.text === 'Assigned');
    const unassigned = placed.find((p) => p.text === 'Unassigned');
    expect(assigned!.importance).toBe(unassigned!.importance);
  });
});

describe('italic marks an asserted position, not a source', () => {
  const layoutAll = (index: ObjectIndex) =>
    index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 20,
      visible: ALL_VISIBLE,
    });

  it('leaves a real object roman even though the add-on supplied it', () => {
    const index = new ObjectIndex(
      makeStars([[0, 0, -400]]),
      null,
      null,
      null,
      makeOAStars([
        { xyz: [-40, 0, -100], name: 'EG 471', label: 'Wadai', real: 'GJ 3162' },
        { xyz: [40, 0, -100], name: 'JD 836901', system: 'Wurm' },
      ]),
    );

    const placed = layoutAll(index);
    expect(placed.find((p) => p.text === 'Wadai')!.asserted).toBe(false);
    expect(placed.find((p) => p.text === 'Wurm')!.asserted).toBe(true);
  });
});

describe('picking prefers what was aimed at', () => {
  /**
   * The anonymous star is the one closer to the click. Nearest-wins would hand
   * it back, which is why a named system in the Inner Sphere used to be
   * unreachable without zooming until nothing else was in range.
   */
  it('takes a named system over a nearer anonymous star', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([
        [0, 0, -100],
        [1.2, 0, -100],
      ]),
      null,
      null,
      null,
      null,
      new Map([
        [
          0,
          {
            star_index: 0,
            star: 'x',
            colony: 'Akela',
            spectral_type: '',
            mass_sol: '',
            luminosity_sol: '',
            distance_ly: 10,
            method: 'name',
            distance_disagrees: false,
            affiliations: [],
            status: '',
            note: '',
          },
        ],
      ]),
    );

    // Click on the anonymous star's own position.
    const at = new THREE.Vector3(1.2, 0, -100).project(cam);
    const x = (at.x * 0.5 + 0.5) * WIDTH;
    const y = (-at.y * 0.5 + 0.5) * HEIGHT;

    expect(index.pick(cam, x, y, pickOptions, 20)).toBe(0);
    expect(index.ref(index.pick(cam, x, y, pickOptions, 20) as number).kind).toBe(KIND_STAR);
  });

  it('still takes the nearer of two equals', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([
        [0, 0, -100],
        [1.2, 0, -100],
      ]),
      null,
      null,
      null,
    );
    const at = new THREE.Vector3(1.2, 0, -100).project(cam);
    const x = (at.x * 0.5 + 0.5) * WIDTH;
    const y = (-at.y * 0.5 + 0.5) * HEIGHT;
    expect(index.pick(cam, x, y, pickOptions, 20)).toBe(1);
  });

  it('finds an object that carries no label at all', () => {
    const cam = camera();
    const index = new ObjectIndex(makeStars([[0, 0, -100]]), null, null, null);
    // No names given, so nothing here is ever labelled.
    expect(
      index.layout(cam, {
        width: WIDTH,
        height: HEIGHT,
        magnitudeLimit: 20,
        maxLabels: 20,
        visible: ALL_VISIBLE,
      }),
    ).toHaveLength(0);
    expect(index.pick(cam, WIDTH / 2, HEIGHT / 2, pickOptions, 5)).toBe(0);
  });
});


describe('a settled star is clickable wherever it is drawn', () => {
  const colonyAt = (index: number, name: string) =>
    new Map([
      [
        index,
        {
          star_index: index,
          star: 'x',
          colony: name,
          spectral_type: '',
          mass_sol: '',
          luminosity_sol: '',
          distance_ly: 10,
          method: 'name',
          distance_disagrees: false,
          affiliations: [] as string[],
          status: '',
          note: '',
        },
      ],
    ]);

  /**
   * Most settled systems are dim red dwarfs. The star shader floors their alpha
   * so they stay visible, and the ring layer draws a ring around them — but
   * picking applied the magnitude limit anyway, so they were drawn, ringed, and
   * not clickable.
   */
  it('picks a star far below the magnitude limit when it carries a colony', () => {
    const cam = camera();
    // At 100 pc, m = M + 5. M = 12 gives m = 17, far below a limit of 7.5.
    const faint = makeStars([[0, 0, -100]], {}, [12]);
    const at = { ...pickOptions, magnitudeLimit: 7.5 };

    const bare = new ObjectIndex(faint, null, null, null);
    expect(bare.pick(cam, WIDTH / 2, HEIGHT / 2, at, 5)).toBeNull();

    const settled = new ObjectIndex(faint, null, null, null, null, colonyAt(0, 'Akela'));
    expect(settled.pick(cam, WIDTH / 2, HEIGHT / 2, at, 5)).toBe(0);
  });

  it('accepts a click anywhere inside the polity ring', () => {
    const cam = camera();
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]], {}, [12]),
      null,
      null,
      null,
      null,
      colonyAt(0, 'Akela'),
    );
    const at = { ...pickOptions, magnitudeLimit: 7.5 };
    // Six pixels out, inside the 13-pixel ring but outside a 1-pixel tolerance.
    expect(index.pick(cam, WIDTH / 2 + 6, HEIGHT / 2, at, 1)).toBe(0);
    expect(index.pick(cam, WIDTH / 2 + 40, HEIGHT / 2, at, 1)).toBeNull();
  });

  it('does not let the ring pick radius become a label bonus', () => {
    const index = new ObjectIndex(
      makeStars([
        [-40, 0, -100],
        [40, 0, -100],
      ]),
      null,
      null,
      null,
      null,
      new Map([...colonyAt(0, 'Ringed'), ...colonyAt(1, 'Also')]),
    );
    const placed = index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 20,
      visible: ALL_VISIBLE,
    });
    for (const label of placed) expect(label.importance).toBe(3);
  });
});

describe('the selected object keeps its label', () => {
  const layoutWith = (index: ObjectIndex, maxLabels: number, pinned: number | null) =>
    index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels,
      visible: ALL_VISIBLE,
      pinned,
    });

  it('places it even when the declutter pass had no room', () => {
    // Three equally important stars competing for one slot. Which one wins
    // without pinning is deliberately not specified — ties are broken by a
    // shuffle — so the test asks the layout itself and then pins a loser.
    const index = new ObjectIndex(
      makeStars(
        [
          [0, 0, -100],
          [30, 0, -100],
          [-30, 0, -100],
        ],
        { '0': { proper: 'Alpha' }, '1': { proper: 'Beta' }, '2': { proper: 'Gamma' } },
      ),
      null,
      null,
      null,
    );

    const unpinned = layoutWith(index, 1, null);
    expect(unpinned).toHaveLength(1);

    const loser = [0, 1, 2].find((id) => id !== unpinned[0].id) as number;
    const pinned = layoutWith(index, 1, loser);
    const placed = pinned.find((p) => p.id === loser);
    expect(placed).toBeDefined();
    expect(placed!.pinned).toBe(true);
  });

  it('places it exactly once', () => {
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]], { '0': { proper: 'Alpha' } }),
      null,
      null,
      null,
    );
    expect(layoutWith(index, 10, 0).filter((p) => p.text === 'Alpha')).toHaveLength(1);
  });

  it('shows nothing for an object that has no name to show', () => {
    const index = new ObjectIndex(makeStars([[0, 0, -100]]), null, null, null);
    expect(layoutWith(index, 10, 0)).toHaveLength(0);
  });
});


describe('label density fills the screen evenly', () => {
  /**
   * A grid of equally important stars spanning the view, in an index order that
   * marches steadily left to right — which is what the real catalogue does,
   * since HYG is ordered by an id that tracks right ascension.
   *
   * With ties broken by index order the labels filled the screen as a moving
   * band: raising the density completed the left half before the right half got
   * its first label. The check is that both halves fill at roughly the same
   * rate, not that any particular star wins.
   */
  const COLUMNS = 24;
  const ROWS = 6;

  function grid(): StarData {
    const positions: [number, number, number][] = [];
    const names: Record<string, Record<string, string>> = {};
    for (let cx = 0; cx < COLUMNS; cx++) {
      for (let cy = 0; cy < ROWS; cy++) {
        // Marching in x with the index, exactly as catalogue order does.
        const x = -55 + (110 * cx) / (COLUMNS - 1);
        const y = -30 + (60 * cy) / (ROWS - 1);
        names[String(positions.length)] = { proper: `S${positions.length}` };
        positions.push([x, y, -100]);
      }
    }
    return makeStars(positions, names);
  }

  function halves(maxLabels: number): { left: number; right: number } {
    const index = new ObjectIndex(grid(), null, null, null);
    const placed = index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels,
      visible: ALL_VISIBLE,
    });
    let left = 0;
    let right = 0;
    for (const label of placed) {
      if (label.x < WIDTH / 2) left++;
      else right++;
    }
    return { left, right };
  }

  it('starts on both halves rather than sweeping across', () => {
    const { left, right } = halves(12);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });

  it('keeps the two halves within a factor of two at every density', () => {
    for (const density of [8, 16, 30, 45, 60]) {
      const { left, right } = halves(density);
      const total = left + right;
      expect(total, `density ${density} placed nothing`).toBeGreaterThan(0);
      const larger = Math.max(left, right);
      const smaller = Math.min(left, right);
      expect(larger, `density ${density}: ${left} left, ${right} right`).toBeLessThanOrEqual(
        smaller * 2 + 2,
      );
    }
  });

  it('is stable across repeated layouts, so labels do not flicker', () => {
    const index = new ObjectIndex(grid(), null, null, null);
    const options = {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 20,
      visible: ALL_VISIBLE,
    };
    const first = index.layout(camera(), options).map((p) => p.id);
    const second = index.layout(camera(), options).map((p) => p.id);
    expect(second).toEqual(first);
  });
});

describe('affiliations merge across sources', () => {
  const colony = (affiliations: string[], name = 'Felicidade') => ({
    star_index: 0,
    star: '18 Scorpii',
    colony: name,
    spectral_type: '',
    mass_sol: '',
    luminosity_sol: '',
    distance_ly: 46.11,
    method: 'name',
    distance_disagrees: false,
    affiliations,
    status: '',
    note: '',
  });

  const world = (affiliations: string[]) =>
    ({
      name: 'Felicidade Dyson',
      kind: 'megastructure',
      system: 'Felicidae',
      parent: '',
      also: [],
      affiliations,
      uncertain: false,
      article: '',
      note: '',
      method: 'star',
      star_index: 0,
      oa_star: '',
      in_world: '',
      constellation: '',
      x: null,
      y: null,
      z: null,
      distance_pc: null,
      direction_error_deg: null,
      direction_error_ly: null,
      radius_pc: null,
      events: [],
      known_from_at: null,
      settled_at: null,
      ended_at: null,
    }) as WorldEntry;

  /**
   * Felicidade is in the colony table with no affiliation at all and in the
   * worlds file held by four meta-empires. Taking the table's answer drew it as
   * unclaimed.
   */
  it('takes the worlds file over an empty colony row', () => {
    expect(affiliationsFor(colony([]), [world(['cyberian-network', 'nocozo'])])).toEqual([
      'cyberian-network',
      'nocozo',
    ]);
  });

  it('unions the two without repeating a polity', () => {
    expect(affiliationsFor(colony(['nocozo']), [world(['cyberian-network', 'nocozo'])])).toEqual([
      'cyberian-network',
      'nocozo',
    ]);
  });

  it('falls back to the colony row when no world describes the system', () => {
    expect(affiliationsFor(colony(['metasoft']), undefined)).toEqual(['metasoft']);
    expect(affiliationsFor(undefined, undefined)).toEqual([]);
  });

  it('colours a star label by the merged answer, not the colony row alone', () => {
    const fiction = {
      polities: [
        { id: 'cyberian-network', name: 'Cyberian Network', color: '#00ff00', index: 1 },
      ],
      bindings: [],
      clusterPolity: new Uint8Array(1),
      hiiPolity: null,
    } as unknown as FictionData;

    const worldsData = {
      worlds: [world(['cyberian-network'])],
      byStar: new Map([[0, [world(['cyberian-network'])]]]),
      byOAStar: new Map(),
      byHost: new Map(),
    } as unknown as WorldData;

    const index = new ObjectIndex(
      makeStars([[0, 0, -100]]),
      null,
      null,
      fiction,
      null,
      new Map([[0, colony([])]]),
      worldsData,
    );
    const placed = index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 5,
      visible: ALL_VISIBLE,
    });
    expect(placed[0].color).toBe('#00ff00');
  });
});

describe('real and Orion’s Arm names', () => {
  it('shows whichever name exists when there is only one', () => {
    for (const mode of ['oa', 'real', 'both'] as const) {
      expect(composeLabel('New Gaia', '', mode)).toBe('New Gaia');
      expect(composeLabel('', 'Vega', mode)).toBe('Vega');
    }
  });

  it('chooses between them when both exist', () => {
    expect(composeLabel('Blenke Cluster', 'Blanco 1', 'oa')).toBe('Blenke Cluster');
    expect(composeLabel('Blenke Cluster', 'Blanco 1', 'real')).toBe('Blanco 1');
    expect(composeLabel('Blenke Cluster', 'Blanco 1', 'both')).toBe('Blenke Cluster (Blanco 1)');
  });

  /**
   * The catalogue name used to be computed only as a fallback, so a settled
   * system had no real name recorded at all and asking for catalogue names
   * would have blanked every one of them.
   */
  it('keeps a settled star’s catalogue name alongside its colony name', () => {
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]], { '0': { proper: 'Lambda Aurigae' } }),
      null,
      null,
      null,
      null,
      new Map([
        [
          0,
          {
            star_index: 0,
            star: 'Lambda Aurigae',
            colony: 'New Gaia',
            spectral_type: '',
            mass_sol: '',
            luminosity_sol: '',
            distance_ly: 41,
            method: 'name',
            distance_disagrees: false,
            affiliations: [] as string[],
            status: '',
            note: '',
          },
        ],
      ]),
    );

    const layout = (nameMode: 'oa' | 'real' | 'both') =>
      index.layout(camera(), {
        width: WIDTH,
        height: HEIGHT,
        magnitudeLimit: 20,
        maxLabels: 5,
        visible: ALL_VISIBLE,
        nameMode,
      })[0].text;

    expect(layout('oa')).toBe('New Gaia');
    expect(layout('real')).toBe('Lambda Aurigae');
    expect(layout('both')).toBe('New Gaia (Lambda Aurigae)');
  });

  it('never renders a name twice when the two agree', () => {
    // A star whose only name is the catalogue's must not read "Vega (Vega)".
    const index = new ObjectIndex(
      makeStars([[0, 0, -100]], { '0': { proper: 'Vega' } }),
      null,
      null,
      null,
    );
    const placed = index.layout(camera(), {
      width: WIDTH,
      height: HEIGHT,
      magnitudeLimit: 20,
      maxLabels: 5,
      visible: ALL_VISIBLE,
      nameMode: 'both',
    });
    expect(placed[0].text).toBe('Vega');
  });
});
