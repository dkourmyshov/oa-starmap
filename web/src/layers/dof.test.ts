import { describe, expect, it } from 'vitest';

import { DepthOfField, dofUniforms } from './dof';

/**
 * The blur itself is GLSL and cannot run here. What can be tested is the part
 * that made the first attempt look wrong: whether every layer actually receives
 * the same focus, and whether the labels agree with it.
 */
describe('DepthOfField', () => {
  it('pushes the current settings to a layer that registers late', () => {
    const dof = new DepthOfField();
    dof.strength = 6;
    dof.dim = 0.25;
    dof.focus = 400;

    const late = dofUniforms();
    dof.register(late);

    expect(late.uDofStrength.value).toBe(6);
    expect(late.uDofDim.value).toBe(0.25);
    expect(late.uDofFocusPc.value).toBe(400);
  });

  it('moves every registered layer together', () => {
    const dof = new DepthOfField();
    const stars = dofUniforms();
    const rings = dofUniforms();
    dof.register(stars);
    dof.register(rings);

    dof.focus = 1234;
    expect(stars.uDofFocusPc.value).toBe(1234);
    expect(rings.uDofFocusPc.value).toBe(1234);
  });

  it('keeps the focus positive, because the blur takes its logarithm', () => {
    const dof = new DepthOfField();
    dof.focus = 0;
    expect(dof.focus).toBeGreaterThan(0);
  });

  it('clamps dimming to a fraction and strength to non-negative', () => {
    const dof = new DepthOfField();
    dof.dim = 5;
    expect(dof.dim).toBe(1);
    dof.dim = -2;
    expect(dof.dim).toBe(0);
    dof.strength = -3;
    expect(dof.strength).toBe(0);
  });

  it('leaves labels alone when the mode is off', () => {
    const dof = new DepthOfField();
    expect(dof.labelStyle(9000)).toEqual({ blurPx: 0, opacity: 1 });
  });

  it('blurs a label more the further it is from the focus, either way', () => {
    const dof = new DepthOfField();
    dof.strength = 8;
    dof.focus = 100;

    const sharp = dof.labelStyle(100);
    const far = dof.labelStyle(10000);
    const near = dof.labelStyle(1);

    expect(sharp.blurPx).toBeCloseTo(0, 5);
    expect(far.blurPx).toBeGreaterThan(0);
    // Two decades either side of the focus blur the same: the cue is symmetric
    // in log distance, which is the whole reason it works at every scale.
    expect(near.blurPx).toBeCloseTo(far.blurPx, 5);
  });

  it('never fades a label all the way out', () => {
    const dof = new DepthOfField();
    dof.strength = 12;
    dof.dim = 1;
    // A missing label is a hole in the map; an unreadable one is only noise.
    expect(dof.labelStyle(1e6).opacity).toBeGreaterThan(0.1);
  });

  it('blurs text less than the shader blurs the sky', () => {
    const dof = new DepthOfField();
    dof.strength = 10;
    dof.focus = 100;
    // A glyph carries its meaning in strokes a pixel or two wide; a star
    // carries none, so matching them pixel for pixel would make the names
    // unreadable while the stars behind were merely soft.
    expect(dof.labelStyle(10000).blurPx).toBeLessThan(10);
  });
});
