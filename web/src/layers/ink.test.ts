/**
 * How much ink a star lays down at a given map scale.
 *
 * The plan view's crowding problem, which the perspective view does not have:
 * pulling a map out packs more stars into each pixel without dimming any of
 * them, and they are drawn additively, so the sheet goes white. The rule has to
 * dim on the way out without brightening on the way in — brightening on the way
 * in is what made every star swell into a disc the first time zoom was wired
 * into the star field.
 */

import { describe, expect, it } from 'vitest';

import { flatInkGain } from './starField';

/** The gain's own floor, as asserted below rather than imported. */
const FLOOR = 0.01;

describe('flatInkGain', () => {
  it('does nothing in the perspective view', () => {
    // Distance already dims that one, star by star and honestly.
    expect(flatInkGain(0)).toBe(1);
  });

  it('follows the scale, and deliberately not the area', () => {
    expect(flatInkGain(25)).toBe(1);
    // Twice the half-height is half the ink, not a quarter of it. A pixel does
    // hold four times as many stars there, but alpha has about two and a half
    // decades of range against the map's three of scale, so a square law would
    // spend the lot in one zoom step and floor — and a dense region ought to
    // read as denser anyway.
    expect(flatInkGain(50)).toBeCloseTo(0.5, 6);
    expect(flatInkGain(250)).toBeCloseTo(0.1, 6);
  });

  it('keeps dimming across the range the map is actually used over', () => {
    // The failure this replaces: the gain hit its floor at a 144 pc half-height
    // and did nothing for the two decades beyond, which is where the whole
    // Terragen sphere is looked at.
    expect(flatInkGain(400)).toBeGreaterThan(FLOOR);
    expect(flatInkGain(1500)).toBeGreaterThan(FLOOR);
    expect(flatInkGain(400)).toBeGreaterThan(flatInkGain(1500));
  });

  it('never brightens, however far in the map is magnified', () => {
    for (const halfHeight of [25, 10, 1, 0.01]) {
      expect(flatInkGain(halfHeight)).toBeLessThanOrEqual(1);
    }
  });

  it('holds a floor, so the sparse outskirts are not dimmed away', () => {
    // The Inner Sphere is thousands of times denser than the rimward field, so
    // no single number exposes both. Chasing the core to the bottom would take
    // the rest of the map with it.
    const widest = flatInkGain(20000);
    expect(widest).toBe(FLOOR);
    expect(widest).toBe(flatInkGain(1e6));
  });

  it('leaves the brightest stars visible at the widest scale', () => {
    // The fragment discards below 0.004. A star at the top of the ink range
    // lays down 0.55, so it has to survive the floor or the widest view is
    // empty rather than sparse — the settled systems have their own floor and
    // are exempt from this gain entirely.
    expect(0.55 * flatInkGain(20000)).toBeGreaterThan(0.004);
  });

  it('falls monotonically as the map is pulled out', () => {
    const scales = [10, 25, 60, 150, 400, 1200, 5000];
    const gains = scales.map(flatInkGain);
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeLessThanOrEqual(gains[i - 1]);
    }
  });
});
