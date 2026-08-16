/**
 * Depth of field, shared by every layer that draws a point sprite.
 *
 * A projection of four decades of depth onto a flat screen gives the eye no way
 * to tell a near object from a far one. Blurring by distance from whatever the
 * camera is orbiting restores the one depth cue the medium can carry.
 *
 * It is not optics. A real lens blurs by |1/d - 1/f|, which past a few hundred
 * parsecs is nothing at all, so everything distant would be equally and
 * uselessly sharp. The circle of confusion here grows with the *ratio* of
 * distance to focus instead — 200 pc against 100 blurs as much as 4,000 against
 * 2,000 — which is what makes the cue work at every scale the camera reaches.
 *
 * Blurring the stars alone turned out to look wrong rather than deep: the rings
 * and labels stayed crisp over a soft sky, so the eye read the sharp things as
 * a separate flat plane pasted on top. Everything drawn at a position has to
 * agree about where the focus is, which is why this lives in one module and
 * every layer takes the same three uniforms.
 */

import * as THREE from 'three';

import type { Parsecs } from '../units';

/** How the blur is computed, in GLSL, for whichever shader wants it. */
export const DOF_PARS = /* glsl */ `
  uniform float uDofStrength;
  uniform float uDofFocusPc;
  uniform float uDofMaxPx;
  uniform float uDofDim;

  /** Blur radius in pixels for something this far from the camera. */
  float dofBlurPx(float distPc) {
    if (uDofStrength <= 0.0) return 0.0;
    float decades = abs(log(distPc / uDofFocusPc) / 2.302585092994046);
    return min(decades * uDofStrength, uDofMaxPx);
  }

  /**
   * What survives being spread from px across to blurredPx.
   *
   * Linear rather than the area ratio physics would give. Conserving energy
   * exactly puts a faint star two decades off focus near a thousandth of its
   * brightness, under the fragment discard, and a blurred star still has to be
   * *there* to read as distant. Halving the brightness for twice the width is
   * enough to stop defocus reading as *brighter*, which is the one thing that
   * would invert the cue. It is not a knob: how much of the far field remains
   * is dofDim's business, and one job per control.
   */
  float dofGain(float px, float blurredPx) {
    return px / max(blurredPx, 1e-4);
  }

  /**
   * How much of an object at this distance is left, by distance from focus
   * alone.
   *
   * Independent of the blur, and useful without it: the Inner Sphere is dense
   * enough that thinning it to a shell is worth having on its own, with every
   * marker still crisp. Gaussian in log distance, so the falloff has a soft
   * edge rather than a boundary, and steep enough at the top of the range to
   * switch the far field off entirely rather than merely dim it.
   */
  float dofDim(float distPc) {
    if (uDofDim <= 0.0) return 1.0;
    float decades = abs(log(distPc / uDofFocusPc) / 2.302585092994046);
    return exp(-decades * decades * uDofDim * 12.0);
  }
`;

export interface DofUniforms {
  uDofStrength: { value: number };
  uDofFocusPc: { value: number };
  uDofMaxPx: { value: number };
  uDofDim: { value: number };
  [key: string]: THREE.IUniform;
}

export function dofUniforms(): DofUniforms {
  return {
    uDofStrength: { value: 0.0 },
    uDofFocusPc: { value: 100.0 },
    uDofMaxPx: { value: 14.0 },
    uDofDim: { value: 0.0 },
  };
}

/**
 * The settings, held once and pushed to every layer that registered.
 *
 * Layers register their own uniform objects rather than being asked for by
 * name, so a new sprite layer joins by adding one line at construction and
 * cannot be forgotten by the code that moves the focus each frame.
 */
export class DepthOfField {
  private readonly targets: DofUniforms[] = [];
  private strengthValue = 0;
  private dimValue = 0;
  private focusValue = 100;

  register(...uniforms: (DofUniforms | DofUniforms[])[]): void {
    for (const entry of uniforms.flat()) {
      this.targets.push(entry);
      entry.uDofStrength.value = this.strengthValue;
      entry.uDofDim.value = this.dimValue;
      entry.uDofFocusPc.value = this.focusValue;
    }
  }

  /** Pixels of blur radius per decade of distance from the focus. 0 is off. */
  set strength(value: number) {
    this.strengthValue = Math.max(0, value);
    for (const u of this.targets) u.uDofStrength.value = this.strengthValue;
  }

  get strength(): number {
    return this.strengthValue;
  }

  /** 0 blurs without dimming; 1 conserves brightness exactly. */
  set dim(value: number) {
    this.dimValue = Math.min(Math.max(value, 0), 1);
    for (const u of this.targets) u.uDofDim.value = this.dimValue;
  }

  get dim(): number {
    return this.dimValue;
  }

  /** The distance held sharp. Guarded positive: the blur takes its log. */
  set focus(value: Parsecs) {
    this.focusValue = Math.max(value, 1e-3);
    for (const u of this.targets) u.uDofFocusPc.value = this.focusValue;
  }

  get focus(): number {
    return this.focusValue;
  }

  /**
   * The shader's dofDim, in TypeScript.
   *
   * Duplicated deliberately: labels are DOM nodes and cannot call into GLSL,
   * and the two have to agree exactly or the names fade out of step with the
   * sky they annotate. The test holds them to the same numbers.
   */
  dimAt(distPc: number): number {
    if (this.dimValue <= 0) return 1;
    const decades = Math.abs(Math.log10(Math.max(distPc, 1e-4) / this.focusValue));
    return Math.exp(-decades * decades * this.dimValue * 12);
  }

  /**
   * How much a label at this distance should be blurred and faded, in CSS
   * terms. Labels are DOM nodes, so they cannot share the shader — but they
   * have to agree with it, or they float above the scene as a sharp plane.
   */
  labelStyle(distPc: number): { blurPx: number; opacity: number } {
    if (this.strengthValue <= 0) return { blurPx: 0, opacity: this.dimAt(distPc) };
    const decades = Math.abs(Math.log10(Math.max(distPc, 1e-4) / this.focusValue));
    const blurPx = Math.min(decades * this.strengthValue, 14) * LABEL_BLUR_SCALE;
    return { blurPx, opacity: this.dimAt(distPc) };
  }
}

/**
 * Labels blur less than the sky does.
 *
 * Matching the shader pixel for pixel makes them unreadable while the stars
 * behind are merely soft — a glyph carries its meaning in strokes a pixel or
 * two wide, where a star carries none.
 */
const LABEL_BLUR_SCALE = 0.35;

