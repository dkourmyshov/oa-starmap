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
