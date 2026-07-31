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

import type { ClusterData, HiiData, StarData } from '../data/manifest';
import { KIND_CLUSTER, KIND_HII, KIND_STAR, ObjectIndex } from './objects';

const WIDTH = 800;
const HEIGHT = 600;

const ALL_VISIBLE = { star: true, cluster: true, hii: true };

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
    const hidden = { ...pickOptions, visible: { star: false, cluster: true, hii: true } };
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
    const hidden = { ...layoutOptions, visible: { star: false, cluster: true, hii: true } };
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
