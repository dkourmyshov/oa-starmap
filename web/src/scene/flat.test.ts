/**
 * The plan view, as far as it can be checked without a GPU.
 *
 * Three things change when the projection goes orthographic, and each of them
 * fails silently: an object below the plane must still be drawn (a perspective
 * camera would call it "behind"), an extent must keep its physical size in
 * pixels wherever it lies, and a star's brightness must stop depending on where
 * on the sheet it happens to be. None of those shows up as an error — they show
 * up as a map that is quietly wrong.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { ObjectIndex } from './objects';
import type { ClusterData, StarData } from '../data/manifest';

const WIDTH = 800;
const HEIGHT = 600;
const ALL_VISIBLE = {
  star: true,
  cluster: true,
  hii: true,
  oastar: true,
  world: true,
  association: true,
};

/**
 * Looking down the pole, half the view 100 pc tall.
 *
 * Built the way the viewer builds it: a unit-height frustum with `zoom`
 * carrying the scale, so half the visible height is exactly 1 / zoom.
 */
function flatCamera(halfHeightPc = 100): THREE.OrthographicCamera {
  const aspect = WIDTH / HEIGHT;
  const cam = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, -2e5, 2e5);
  cam.up.set(0, 1, 0);
  cam.position.set(0, 0, 500);
  cam.zoom = 1 / halfHeightPc;
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

function makeStars(positions: [number, number, number][], absMags?: number[]): StarData {
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
    names: Object.fromEntries(positions.map((_, i) => [String(i), { proper: `S${i}` }])),
    dataset: {} as StarData['dataset'],
  };
}

function makeClusters(
  entries: { xyz: [number, number, number]; radius: number; name: string }[],
): ClusterData {
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
    names: entries.map((e) => ({ name: e.name })),
    dataset: {} as ClusterData['dataset'],
  } as unknown as ClusterData;
}

const options = {
  width: WIDTH,
  height: HEIGHT,
  magnitudeLimit: 20,
  maxLabels: 50,
  visible: ALL_VISIBLE,
};

describe('the plan view', () => {
  it('draws what is below the plane as readily as what is above it', () => {
    // The camera sits 500 pc north. A perspective camera would put the second
    // of these behind itself and cull it; on a map it is simply further north
    // than the eye, which is not a reason to omit it — an orthographic camera
    // has no station for anything to be behind. Set apart in x only so that
    // both names have room; down the axis they occupy the same pixel, which is
    // exactly why the mode prints the number.
    const index = new ObjectIndex(makeStars([[-50, 0, 40], [50, 0, 900]]), null, null, null);
    const placed = index.layout(flatCamera(), options);
    expect(placed.map((p) => p.text).sort()).toEqual(['S0', 'S1']);
  });

  it('puts two stars the same distance apart the same distance apart on screen', () => {
    // The whole point of dropping perspective. Under it, the pair further from
    // the camera would draw closer together and nothing could be measured.
    // The second pair is 800 pc further down the axis, and set apart in y so
    // the declutter pass has somewhere to put both names — down the axis alone
    // they would land on the same pixel, which is itself the point.
    const index = new ObjectIndex(
      makeStars([
        [0, -40, 0],
        [20, -40, 0],
        [0, 40, -800],
        [20, 40, -800],
      ]),
      null,
      null,
      null,
    );
    const placed = index.layout(flatCamera(), options);
    const at = (text: string) => placed.find((p) => p.text === text)!;
    const near = at('S1').x - at('S0').x;
    const far = at('S3').x - at('S2').x;
    expect(far).toBeCloseTo(near, 6);
    // And the scale is the one the frustum asked for: half the view is 100 pc
    // over 300 pixels, so a parsec is three pixels.
    expect(near).toBeCloseTo(20 * (HEIGHT / 2 / 100), 4);
  });

  it('keeps a cluster its true size however far down the axis it lies', () => {
    // Ten parsecs across, one at the focal plane and one three kiloparsecs
    // below it. Half the view is 100 pc over 300 pixels, so both rings are 30
    // pixels no matter how far down the axis they sit — which is what makes the
    // plan view a map rather than a picture of one. Read through the picker,
    // because that is where the screen radius is visible from outside.
    const index = new ObjectIndex(
      makeStars([]),
      makeClusters([
        { xyz: [-60, 0, 0], radius: 10, name: 'near' },
        { xyz: [60, 0, -3000], radius: 10, name: 'far' },
      ]),
      null,
      null,
    );
    const cam = flatCamera();
    const pickOptions = { width: WIDTH, height: HEIGHT, magnitudeLimit: 20, visible: ALL_VISIBLE };
    const onRing = (centreX: number) => index.pick(cam, centreX + 29, HEIGHT / 2, pickOptions);

    expect(onRing(WIDTH / 2 - 180)).not.toBeNull();
    expect(onRing(WIDTH / 2 + 180)).not.toBeNull();
    expect(onRing(WIDTH / 2 - 180)).not.toBe(onRing(WIDTH / 2 + 180));
  });

  it('carries each object its own height above the plane', () => {
    const index = new ObjectIndex(makeStars([[0, 0, 40], [30, 0, -125]]), null, null, null);
    const placed = index.layout(flatCamera(), options);
    expect(placed.find((p) => p.text === 'S0')!.z).toBe(40);
    // Signed: the label prints which side of the plane, because "125 pc off the
    // plane" names two different places.
    expect(placed.find((p) => p.text === 'S1')!.z).toBe(-125);
  });

  it('plots a star by how luminous it is, not by where it sits', () => {
    // Two stars of the same absolute magnitude: one at the centre of the sheet
    // and near the plane, one at its corner and 400 pc below. Neither their
    // distance from the camera nor their distance from Sol may separate them —
    // on a plan view either would draw a brightness gradient that says only
    // what the positions already say.
    const index = new ObjectIndex(
      makeStars(
        [
          [0, 0, -20],
          [42, 42, -400],
        ],
        [6, 6],
      ),
      null,
      null,
      null,
    );
    const cam = flatCamera();
    const flat = { ...options, magnitudeLimit: 7, absoluteMagnitudes: true };
    expect(index.layout(cam, flat)).toHaveLength(2);

    // And it is a real threshold, not a way past one: both are magnitude 6, so
    // a limit above them keeps both and a limit below drops both.
    expect(index.layout(cam, { ...flat, magnitudeLimit: 5 })).toHaveLength(0);
  });

  it('does not change what is drawn when the map is zoomed', () => {
    // The failure this replaces: brightness scaled to the view height, so
    // zooming in swelled every star into a disc and pulled fainter ones out of
    // nothing. Zoom over a map is a magnifying glass — it changes how large the
    // map is drawn, never what is on it.
    // Spread down the axis rather than across it, since z does not move
    // anything on screen: all three stay in frame at either zoom, so what
    // changes between the two passes is only the scale.
    const index = new ObjectIndex(
      makeStars([[0, 0, 0], [20, 10, -50], [-20, 15, 400]], [4, 6, 14]),
      null,
      null,
      null,
    );
    const flat = { ...options, magnitudeLimit: 11, absoluteMagnitudes: true };
    const wide = index.layout(flatCamera(300), flat).map((p) => p.text).sort();
    const close = index.layout(flatCamera(60), flat).map((p) => p.text).sort();
    expect(close).toEqual(wide);
    // And it is a real selection, not everything: the absolute magnitude 14
    // dwarf is under the limit at either zoom.
    expect(wide).toEqual(['S0', 'S1']);
  });
});
