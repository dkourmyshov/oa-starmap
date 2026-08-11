/**
 * The preset viewpoints, checked against the frame they are named for.
 *
 * Worth testing because the failure is silent and plausible: a "top" view that
 * is really edge-on still shows a sky full of stars, and nothing on screen says
 * which axis it is looking down. The frame is galactic Cartesian — x coreward,
 * y spinward, z galactic north — so each preset makes a claim that can be
 * checked as a direction rather than eyeballed.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { VIEWPOINTS, type Viewpoint, viewpointPosition } from './viewer';

/** Unit vector from the camera towards the thing it is orbiting. */
function viewDirection(name: Viewpoint): THREE.Vector3 {
  return viewpointPosition(name, 65).clone().negate().normalize();
}

describe('preset viewpoints', () => {
  it('keeps the requested range', () => {
    for (const { id } of VIEWPOINTS) {
      expect(viewpointPosition(id, 65).length()).toBeCloseTo(65, 6);
      expect(viewpointPosition(id, 4000).length()).toBeCloseTo(4000, 3);
    }
  });

  it('looks straight down the galactic pole from the top', () => {
    // Down means towards -z: the camera is north of the plane looking at it.
    expect(viewDirection('top').dot(new THREE.Vector3(0, 0, -1))).toBeCloseTo(1, 4);
  });

  it('does not sit exactly on the pole', () => {
    // Exactly on it leaves the azimuth undefined, and the map would snap round
    // the first time it was dragged.
    const position = viewpointPosition('top', 65);
    expect(position.y).not.toBe(0);
    expect(Math.abs(position.y)).toBeLessThan(0.5);
  });

  it('looks spinward, along the plane', () => {
    expect(viewpointPosition('spin', 65).z).toBe(0);
    // Spinward is +y by the frame's own definition.
    expect(viewDirection('spin').dot(new THREE.Vector3(0, 1, 0))).toBeCloseTo(1, 6);
    // And the view stays in the plane, so the disk crosses it rather than
    // running along it. Compared by magnitude: negating turns the zero into -0.
    expect(Math.abs(viewDirection('spin').z)).toBe(0);
  });

  it('looks coreward from the core preset', () => {
    // Coreward is +x by the frame's own definition.
    expect(viewDirection('core').dot(new THREE.Vector3(1, 0, 0))).toBeCloseTo(1, 6);
    expect(viewpointPosition('core', 65).z).toBe(0);
  });

  it('tilts out of the plane without leaving it edge-on', () => {
    const direction = viewDirection('tilted');
    // Between the two extremes: some z component, but not looking down the pole.
    expect(Math.abs(direction.z)).toBeGreaterThan(0.2);
    expect(Math.abs(direction.z)).toBeLessThan(0.8);
  });

  it('offers every preset the viewer implements', () => {
    expect(VIEWPOINTS.map((v) => v.id).sort()).toEqual(['core', 'spin', 'tilted', 'top']);
    for (const { label, title } of VIEWPOINTS) {
      expect(label).toBeTruthy();
      expect(title).toBeTruthy();
    }
  });
});

describe('the canonical top view', () => {
  /**
   * Coreward to the right, spinward up. This is how Orion's Arm's own maps are
   * drawn, and it falls out of the frame rather than being set anywhere — which
   * is exactly why it needs pinning down: a change to the up vector or to the
   * top preset's offset would rotate the whole map with nothing to say so.
   */
  function onScreen(name: Viewpoint, point: THREE.Vector3): THREE.Vector3 {
    const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.01, 1e6);
    camera.up.set(0, 0, 1);
    camera.position.copy(viewpointPosition(name, 65));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return point.clone().project(camera);
  }

  it('puts coreward to the right and spinward up', () => {
    const coreward = onScreen('top', new THREE.Vector3(30, 0, 0));
    expect(coreward.x).toBeGreaterThan(0.1);
    expect(Math.abs(coreward.y)).toBeLessThan(0.05);

    const spinward = onScreen('top', new THREE.Vector3(0, 30, 0));
    expect(spinward.y).toBeGreaterThan(0.1);
    expect(Math.abs(spinward.x)).toBeLessThan(0.05);
  });

  it('keeps galactic north up in the core view', () => {
    const north = onScreen('core', new THREE.Vector3(0, 0, 30));
    expect(north.y).toBeGreaterThan(0.1);
  });
});

describe('trackball drag basis', () => {
  /**
   * TrackballControls turns the camera about `moveDirection x eye`, where
   * `moveDirection` is built from `camera.up` for the vertical component and
   * `up x eye` for the horizontal one. A cross product with `eye` discards
   * anything parallel to `eye`, so an `up` that lies along the line of sight
   * cancels the vertical half of every drag: horizontal and vertical drags then
   * turn about two fixed world axes and any diagonal collapses onto one of them.
   *
   * The top view is precisely that case — camera on the galactic pole, up
   * *being* the pole — so this is not a hypothetical.
   */
  function axisFor(up: THREE.Vector3, eye: THREE.Vector3, dx: number, dy: number) {
    const sideways = up.clone().normalize().cross(eye.clone().normalize()).normalize();
    const vertical = up.clone().normalize().setLength(dy);
    const move = vertical.add(sideways.setLength(dx));
    return move.cross(eye);
  }

  const eye = viewpointPosition('top', 65);

  it('collapses when up lies along the line of sight', () => {
    const axis = axisFor(new THREE.Vector3(0, 0, 1), eye, 0.01, 0.01);
    // Equal drag in both directions, yet one term swamps the other completely.
    const dominant = Math.max(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z));
    const smallest = Math.min(Math.abs(axis.x), Math.abs(axis.y));
    expect(dominant / smallest).toBeGreaterThan(100);
  });

  it('is well conditioned once up is across the line of sight', () => {
    const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.01, 1e6);
    camera.up.set(0, 0, 1);
    camera.position.copy(eye);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

    // Perpendicular to the view direction, which is the whole point.
    expect(Math.abs(screenUp.dot(eye.clone().normalize()))).toBeLessThan(1e-6);

    const axis = axisFor(screenUp, eye, 0.01, 0.01);
    const dominant = Math.max(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z));
    const smallest = Math.min(Math.abs(axis.x), Math.abs(axis.y));
    expect(dominant / smallest).toBeLessThan(10);
  });

  it('leaves the view unmoved when it adopts the screen up', () => {
    const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.01, 1e6);
    camera.up.set(0, 0, 1);
    camera.position.copy(eye);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const before = new THREE.Vector3(30, 0, 0).project(camera);
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const after = new THREE.Vector3(30, 0, 0).project(camera);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
