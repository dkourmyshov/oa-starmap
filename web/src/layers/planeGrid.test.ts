import { describe, expect, it } from 'vitest';

import { CARDINALS, ringRadii, ringStep } from './planeGrid';
import { PC_TO_LY } from '../units';

describe('how far apart the distance rings sit', () => {
  it('only ever steps by 1, 2 or 5 times a power of ten', () => {
    // A ruler marked every 3 or every 250 makes the reader do arithmetic to
    // know which ring they are on, which is the one thing a scale is for.
    for (let halfHeight = 0.5; halfHeight < 1e5; halfHeight *= 1.07) {
      const step = ringStep(halfHeight);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa * 1000) / 1000);
    }
  });

  it('keeps a handful of rings across the view at every scale', () => {
    // The point of adapting at all. A fixed spacing is invisible zoomed in and
    // a solid disc zoomed out; five orders of magnitude of map lie between
    // standing next to Sol and looking across the arm.
    for (let halfHeight = 1; halfHeight < 1e5; halfHeight *= 1.31) {
      const count = ringRadii(halfHeight, halfHeight * 3).length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(10);
    }
  });

  it('scales exactly with the view', () => {
    // Ten times the view, ten times the step. Anything else would make the
    // grid drift coarser or finer as the reader zoomed, which is the failure
    // an adaptive scale exists to avoid.
    expect(ringStep(1000)).toBe(ringStep(100) * 10);
    expect(ringStep(2500)).toBe(ringStep(250) * 10);
  });

  it('goes below a hundred where the map is densest', () => {
    // The request asked for hundreds and thousands, which is right for the
    // ordinary view. Zoomed into the Inner Sphere a hundred-unit floor would
    // mean a grid with nothing on it exactly where the map is busiest, so the
    // ladder keeps going down.
    expect(ringStep(30)).toBeLessThan(100);
    expect(ringStep(30)).toBeGreaterThan(0);
  });

  it('has no rings at all before the view has a size', () => {
    // The first frame, and any frame where the camera is mid-jump.
    expect(ringStep(0)).toBe(0);
    expect(ringRadii(0, 1000)).toEqual([]);
    expect(ringStep(Number.NaN)).toBe(0);
  });

  it('starts at one step out and never draws a ring on Sol', () => {
    const radii = ringRadii(500, 5000);
    expect(radii[0]).toBe(ringStep(500));
    expect(radii).not.toContain(0);
  });

  it('stops at the furthest it is given', () => {
    const radii = ringRadii(500, 900);
    expect(Math.max(...radii)).toBeLessThanOrEqual(900);
  });
});

describe('the rings follow the unit on screen', () => {
  it('lands on round numbers of whichever unit is displayed', () => {
    // The same view, read in two units, gives two different sets of rings —
    // and each is round in its own unit. A ring at 500 ly is at 153.3 pc, and
    // labelling that "153 pc" would be a scale bar nobody could read off.
    const halfHeightPc = 300;
    const inPc = ringRadii(halfHeightPc, 1e5);
    const inLy = ringRadii(halfHeightPc * PC_TO_LY, 1e5);
    for (const [radii, halfHeight] of [
      [inPc, halfHeightPc],
      [inLy, halfHeightPc * PC_TO_LY],
    ] as const) {
      const step = ringStep(halfHeight);
      radii.forEach((radius, i) => {
        // Exactly n steps out, with no accumulated drift to round off.
        expect(radius).toBe(step * (i + 1));
      });
    }
    // And they are genuinely different sets, not the same numbers relabelled.
    expect(inLy).not.toEqual(inPc);
  });
});

describe('the four cardinal directions', () => {
  it("names them the way Orion's Arm does", () => {
    expect(CARDINALS.map((c) => c.label)).toEqual([
      'coreward',
      'spinward',
      'rimward',
      'counterspinward',
    ]);
  });

  it('points them along the axes this map is built on', () => {
    // x is galactic longitude zero and y is l = 90 degrees. Getting this
    // backwards would leave every other layer correct and the one thing on
    // screen that claims to say which way is which wrong.
    const by = new Map(CARDINALS.map((c) => [c.label, c]));
    expect([by.get('coreward')?.x, by.get('coreward')?.y]).toEqual([1, 0]);
    expect([by.get('spinward')?.x, by.get('spinward')?.y]).toEqual([0, 1]);
    expect([by.get('rimward')?.x, by.get('rimward')?.y]).toEqual([-1, 0]);
    expect([by.get('counterspinward')?.x, by.get('counterspinward')?.y]).toEqual([0, -1]);
  });

  it('makes each one the opposite of its pair', () => {
    const by = new Map(CARDINALS.map((c) => [c.label, c]));
    for (const [a, b] of [
      ['coreward', 'rimward'],
      ['spinward', 'counterspinward'],
    ]) {
      // Written with a sum rather than a negation: -0 and 0 are different
      // values to Object.is, and this is about direction, not sign of zero.
      expect(by.get(a)!.x + by.get(b)!.x).toBe(0);
      expect(by.get(a)!.y + by.get(b)!.y).toBe(0);
    }
  });
});
