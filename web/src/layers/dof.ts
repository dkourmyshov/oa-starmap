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
   * What fraction of the light survives being spread from px across to
   * blurredPx.
   *
   * Conserving exactly is the physical answer and it empties the far sky: a
   * faint star two decades off focus lands near a thousandth of its brightness
   * and falls under the fragment discard, and a blurred star still has to be
   * *there* to read as distant. So the amount of that conservation is a knob.
   * Zero blurs without dimming at all; one conserves exactly, which is worth
   * having deliberately — it thins a dense field down to the shell in focus.
   */
  float dofGain(float px, float blurredPx) {
    return mix(1.0, (px * px) / (blurredPx * blurredPx), uDofDim);
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
    uDofDim: { value: 0.6 },
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
  private dimValue = 0.6;
  private focusValue = 100;

  register(uniforms: DofUniforms): void {
    this.targets.push(uniforms);
    uniforms.uDofStrength.value = this.strengthValue;
    uniforms.uDofDim.value = this.dimValue;
    uniforms.uDofFocusPc.value = this.focusValue;
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
   * How much a label at this distance should be blurred and faded, in CSS
   * terms. Labels are DOM nodes, so they cannot share the shader — but they
   * have to agree with it, or they float above the scene as a sharp plane.
   */
  labelStyle(distPc: number): { blurPx: number; opacity: number } {
    if (this.strengthValue <= 0) return { blurPx: 0, opacity: 1 };
    const decades = Math.abs(Math.log10(Math.max(distPc, 1e-4) / this.focusValue));
    const blurPx = Math.min(decades * this.strengthValue, 14) * LABEL_BLUR_SCALE;
    // Text disappears into illegibility far faster than a point of light does,
    // so it fades on a gentler curve than dofGain and never all the way out:
    // an unreadable label is noise, but a missing one is a hole in the map.
    const opacity = 1 - this.dimValue * (1 - 1 / (1 + decades)) * LABEL_FADE_LIMIT;
    return { blurPx, opacity };
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

/** The most a label will fade, however deep the field. */
const LABEL_FADE_LIMIT = 0.8;
