import { describe, expect, it } from 'vitest';

import { pc } from '../units';
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
    dof.focus = pc(400);

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

    dof.focus = pc(1234);
    expect(stars.uDofFocusPc.value).toBe(1234);
    expect(rings.uDofFocusPc.value).toBe(1234);
  });

  it('keeps the focus positive, because the blur takes its logarithm', () => {
    const dof = new DepthOfField();
    dof.focus = pc(0);
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

  it('leaves labels alone when neither control is doing anything', () => {
    const dof = new DepthOfField();
    expect(dof.labelStyle(9000)).toEqual({ blurPx: 0, opacity: 1 });
  });

  it('dims without any blur at all, which is the decluttering case', () => {
    const dof = new DepthOfField();
    dof.focus = pc(100);
    dof.dim = 0.5;
    expect(dof.strength).toBe(0);
    expect(dof.labelStyle(100).blurPx).toBe(0);
    expect(dof.labelStyle(100).opacity).toBeCloseTo(1, 5);
    // Nothing is blurred, and the far field is still thinned out.
    expect(dof.labelStyle(3000).opacity).toBeLessThan(0.05);
  });

  it('switches the far field off entirely at the top of the range', () => {
    const dof = new DepthOfField();
    dof.focus = pc(100);
    dof.dim = 1;
    expect(dof.dimAt(1000)).toBeLessThan(1e-4);
    // And leaves the shell in focus untouched, or it would be a brightness
    // control rather than a depth one.
    expect(dof.dimAt(100)).toBeCloseTo(1, 6);
    expect(dof.dimAt(120)).toBeGreaterThan(0.9);
  });

  it('blurs a label more the further it is from the focus, either way', () => {
    const dof = new DepthOfField();
    dof.strength = 8;
    dof.focus = pc(100);

    const sharp = dof.labelStyle(100);
    const far = dof.labelStyle(10000);
    const near = dof.labelStyle(1);

    expect(sharp.blurPx).toBeCloseTo(0, 5);
    expect(far.blurPx).toBeGreaterThan(0);
    // Two decades either side of the focus blur the same: the cue is symmetric
    // in log distance, which is the whole reason it works at every scale.
    expect(near.blurPx).toBeCloseTo(far.blurPx, 5);
  });

  it('fades a label exactly as the shader fades its object', () => {
    const dof = new DepthOfField();
    dof.focus = pc(100);
    dof.dim = 0.4;
    // dofDim is written twice, once in GLSL and once here, because a DOM node
    // cannot call into a shader. They have to agree to the digit or the names
    // thin out of step with the sky behind them.
    for (const d of [10, 100, 250, 1000, 9000]) {
      expect(dof.labelStyle(d).opacity).toBeCloseTo(dof.dimAt(d), 12);
    }
  });

  it('blurs text less than the shader blurs the sky', () => {
    const dof = new DepthOfField();
    dof.strength = 10;
    dof.focus = pc(100);
    // A glyph carries its meaning in strokes a pixel or two wide; a star
    // carries none, so matching them pixel for pixel would make the names
    // unreadable while the stars behind were merely soft.
    expect(dof.labelStyle(10000).blurPx).toBeLessThan(10);
  });
});
