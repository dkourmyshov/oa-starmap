/**
 * The star point cloud.
 *
 * Two decisions here do the real work:
 *
 * **Brightness is computed from the camera, not from Earth.** The catalogue stores
 * absolute magnitude; apparent magnitude is derived per frame from the distance
 * between each star and the current camera position. Flying towards a star makes
 * it brighten, exactly as it should, and no star is privileged by having been
 * bright in Earth's sky.
 *
 * **Faint stars fade rather than vanish.** Alpha follows linear flux, so a star
 * approaching the visibility limit dims smoothly to nothing. This is what keeps
 * the catalogue's own sampling boundary invisible: stars drop out of view at the
 * point where they were already too dim to see, instead of popping out at a
 * radius and drawing a sphere in the sky.
 */

import * as THREE from 'three';

import type { Colony, StarData, WorldData } from '../data/manifest';
import { DOF_PARS, type DofUniforms, dofUniforms } from './dof';

const LOG10 = Math.LN10;

/**
 * Pixels of diameter per magnitude, for the plan view's atlas plotting.
 *
 * Chosen so the catalogue's whole range lands inside the size limits: at the
 * default limit of 7.5 a supergiant at M -8 draws about 14 pixels across and a
 * star at the limit draws the minimum, with the Sun near 3.5 in between.
 */
const MAG_STEP_PX = 0.8;

/**
 * The map scale at which a star lays down its full ink, as a view half-height
 * in parsecs.
 *
 * Around the scale the plan view opens at, so the default is what the constants
 * below say it is and zooming in can only brighten the field a little.
 */
const FLAT_INK_REFERENCE_PC = 25;

/** Least a star may be dimmed by crowding, however far out the map is pulled. */
const FLAT_INK_FLOOR = 0.01;

/**
 * How much ink one star lays down at this map scale. 1 in the perspective view,
 * which has no such thing.
 *
 * A plan view has a crowding problem a perspective view does not. Flying away
 * from a star field dims it, because the light of each star spreads over the
 * inverse square of the distance; pulling a *map* out does not dim anything, it
 * merely packs more stars into each pixel — and stars are drawn additively, so
 * a hundred of them in one pixel is white whatever each one contributes. The
 * field was legible at the opening scale and a flat sheet a few notches out.
 *
 * A pixel covers area, so the count inside it grows with the *square* of the
 * scale shrinking — and the ink deliberately does not follow that square all
 * the way back down. Two reasons. Alpha has about two and a half decades of
 * usable range before a star falls under the fragment discard, and the map
 * spans three decades of scale, so a square law spends the whole budget in the
 * first zoom step and then floors, leaving everything past it to saturate as
 * before. And full compensation is not even wanted: the Inner Sphere is
 * thousands of times denser than the rimward field, and it should look it. So
 * the gain is linear in the scale, which is half the square in log terms —
 * enough to stop the sheet going white, little enough that dense regions still
 * read as dense.
 *
 * Never above 1: this dims a crowded view, it does not brighten an empty one.
 * Brightness rising as the map is magnified is what made every star swell into
 * a disc when the reference was tied to the zoom the first time round.
 */
export function flatInkGain(halfHeightPc: number): number {
  if (halfHeightPc <= 0) return 1;
  return Math.min(Math.max(FLAT_INK_REFERENCE_PC / halfHeightPc, FLAT_INK_FLOOR), 1);
}

export interface StarFieldOptions {
  /**
   * Apparent magnitude at which a star reaches the threshold of visibility.
   * Roughly 6.5 is the naked-eye limit under a dark sky; raising it reveals
   * fainter stars, as a bigger telescope would.
   */
  magnitudeLimit?: number;
  /** Overall gain, independent of the magnitude limit. */
  exposure?: number;
  minPointSize?: number;
  maxPointSize?: number;
}

// The logdepthbuf chunks are what opt this material into the renderer's
// logarithmic depth buffer. The star layer does not depth-test today, so nothing
// visibly depends on them yet — but without them a custom ShaderMaterial silently
// writes linear depth, which would break against any opaque geometry added later.
const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute float aAbsMag;
  attribute float aCi;
  attribute float aSettled;

  uniform float uPixelRatio;
  uniform float uMagLimit;
  uniform float uExposure;
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uCiUnknown;
  uniform float uBvMin;
  uniform float uBvMax;
  uniform sampler2D uColorLut;
  uniform float uOnlyOA;
  uniform float uSettledBoost;
  uniform float uSettledFloor;
  uniform float uAbsoluteMags;
  uniform float uFlatInk;
  ${DOF_PARS}

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSharp;

  void main() {
    // Set before the cull below can return early: a varying left unwritten on
    // any path is undefined on some drivers, even where the fragment is
    // discarded anyway.
    vSharp = 1.0;

    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;

    // Scene units are parsecs. Guard the origin so Sol does not divide by zero
    // when the camera sits exactly on it.
    float distPc = max(length(viewPos.xyz), 1e-4);

    // Apparent magnitude from *this* viewpoint: m = M + 5 log10(d / 10pc).
    //
    // The plan view has no viewpoint to compute it from. An orthographic camera
    // has no station: it is not standing anywhere, and length(viewPos) there
    // measures how far across the map a star is rather than how far away, so
    // using it would darken the edges of the sheet into a vignette that means
    // nothing. Measuring from Sol instead was no better: it puts a brightness
    // gradient centred on the origin over the whole sheet, which says only how
    // far from home a star is — something the map already shows by where it
    // draws it.
    //
    // So the plan view drops apparent magnitude altogether and plots absolute:
    // how luminous the star is, full stop. That is the quantity that survives
    // being flattened, it is the quantity this map selects on in the first
    // place, and it does not move when the view does. The magnitude limit
    // becomes a luminosity threshold, which is what a plan view of a galaxy
    // wants anyway — the supergiants first, and the dwarfs when asked for.
    float m = uAbsoluteMags > 0.5
      ? aAbsMag
      : aAbsMag + 5.0 * (log(distPc / 10.0) / ${LOG10.toFixed(9)});

    // How many magnitudes brighter than the limit this star is.
    float mags = uMagLimit - m;

    // Size and brightness, by two different laws, because the two magnitudes
    // are distributed quite differently.
    //
    // Apparent magnitude from a moving camera is self-limiting: distance dims
    // the far field, so at any moment only a handful of stars sit far above the
    // limit and a flux law spends its range well. Absolute magnitude has no
    // such brake. This catalogue spans roughly M -8 to +16 — twenty-four
    // magnitudes, a flux ratio of four thousand million — so a flux law
    // saturates about four magnitudes above the limit and every star past that
    // is the same white disc at full alpha. The plan view washed out to a
    // sheet: the magnitude and exposure sliders both had to go to their minimum
    // for anything to be legible, which is the sign of a law with no headroom.
    //
    // So the plan view plots the way a printed atlas does: the diameter grows a
    // fixed amount per magnitude, and the ink follows gently. That spends the
    // whole twenty-four magnitudes instead of the first four.
    float size;
    if (uAbsoluteMags > 0.5) {
      // Faint plotted stars are drawn lightly, luminous ones fully, over about
      // six magnitudes; and the last magnitude before the limit fades out, so
      // the threshold has no edge to it — the same rule the perspective law
      // gets from its own smooth falloff.
      //
      // The levels are low because they are laid down additively and a plan
      // view stacks far more stars per pixel than a perspective one does; how
      // much lower still, at a given scale, is uFlatInk's business below.
      vAlpha = clamp(mags, 0.0, 1.0) * mix(0.08, 0.55, clamp(mags / 6.0, 0.0, 1.0)) * uExposure;
      size = uMinSize + max(mags, 0.0) * ${MAG_STEP_PX};
    } else {
      // Linear flux relative to the visibility limit; clamped before pow() so a
      // very close star cannot overflow to infinity.
      float flux = pow(10.0, 0.4 * min(mags, 30.0)) * uExposure;
      // Smooth fade to nothing. No threshold, no pop.
      vAlpha = clamp(flux, 0.0, 1.0);
      size = uMinSize * sqrt(max(flux, 1.0));
    }

    // In Orion's Arm-only mode the sky is reduced to what the setting names.
    if (uOnlyOA > 0.5 && aSettled < 0.5) {
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      #include <logdepthbuf_vertex>
      return;
    }

    // A star Orion's Arm has settled is the point of the map, and most of them
    // are dim red dwarfs that the magnitude law alone renders nearly invisible.
    // Given a floor and a size boost they stay legible without the exposure
    // having to be wound up until everything else blows out.
    // Crowding, before the settled floor rather than after it. The catalogue is
    // what crowds a pixel — hundreds of thousands of stars, most of them in the
    // Inner Sphere — where the settled systems are some fifteen hundred spread
    // over the whole map and never pile up. Dimming them with the sheet would
    // take out the one layer the map exists for at exactly the scale where the
    // whole Terragen sphere is in view. 1 in the perspective view; see
    // flatInkGain.
    vAlpha *= uFlatInk;

    float settled = aSettled * uSettledBoost;
    vAlpha = max(vAlpha, aSettled * uSettledFloor);

    // Bright stars grow; faint ones stay minimal and fade out via alpha.
    float px = clamp(size + settled, uMinSize, uMaxSize) * uPixelRatio;

    // Depth of field, measured in decades rather than in parsecs.
    //
    // A real lens blurs by |1/d - 1/f|, which at these ranges is nothing at all
    // past a few hundred parsecs: everything beyond would be equally, uselessly
    // sharp. The map's whole span is four decades, so the circle of confusion
    // grows with the *ratio* of distance to focus instead. Two hundred parsecs
    // against a hundred blurs as much as four thousand against two thousand,
    // which is what makes the cue work at every scale the camera reaches.
    float defocus = dofDecades(viewPos);
    float blurPx = dofBlurPx(defocus) * uPixelRatio;
    if (blurPx > 0.0) {
      float blurred = px + 2.0 * blurPx;
      vAlpha *= dofGain(px, blurred);
      vSharp = px / blurred;
      px = blurred;
    }
    // Outside the blur test: dimming is its own control and works alone.
    vAlpha *= dofDim(defocus);
    gl_PointSize = px;

    if (aCi < uCiUnknown + 1.0) {
      // Colour index unknown — neutral white rather than an invented colour.
      vColor = vec3(1.0);
    } else {
      float t = clamp((aCi - uBvMin) / (uBvMax - uBvMin), 0.0, 1.0);
      vColor = texture2D(uColorLut, vec2(t, 0.5)).rgb;
    }

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSharp;

  void main() {
    // Soft round sprite: a hard-edged square point reads as a pixel artefact.
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(offset, offset);
    if (r2 > 1.0) discard;

    // In focus, the profile is sharply peaked and reads as a point of light.
    // Out of focus it flattens towards an even disc, which is what a defocused
    // point source actually looks like and, more to the point, is what the eye
    // reads as "not where I am looking".
    float peak = mix(0.35, 3.0, vSharp);
    float falloff = exp(-r2 * peak) * (1.0 - r2);
    float alpha = vAlpha * falloff;
    if (alpha < 0.004) discard;

    // After the discards, so rejected fragments never write depth.
    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class StarField {
  readonly points: THREE.Points;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;

  constructor(
    data: StarData,
    options: StarFieldOptions = {},
    colonies: Map<number, Colony> | null = null,
    worlds: WorldData | null = null,
  ) {
    const {
      magnitudeLimit = 7.5,
      exposure = 1.0,
      minPointSize = 1.4,
      maxPointSize = 26.0,
    } = options;

    this.count = data.count;

    const positions = new Float32Array(data.count * 3);
    const absMag = new Float32Array(data.count);
    const colorIndex = new Float32Array(data.count);
    const settled = new Float32Array(data.count);


    for (let i = 0; i < data.count; i++) {
      const src = i * 5;
      positions[i * 3] = data.positions[src];
      positions[i * 3 + 1] = data.positions[src + 1];
      positions[i * 3 + 2] = data.positions[src + 2];
      absMag[i] = data.positions[src + 3];
      colorIndex[i] = data.positions[src + 4];

      // Settled from either source. A star carrying a canonical world needs the
      // floor as much as one carrying a colony row — Orion's Arm names plenty of
      // systems around dim stars, and the magnitude law alone hides them.
      //
      // A colony *row* is not enough: the source table lists every star within
      // 100 ly, and 579 of its 891 rows name no colony at all. Those are
      // ordinary stars that happen to have been catalogued, and lifting them out
      // of the magnitude law would claim the setting had settled them.
      if (colonies?.get(i)?.colony || worlds?.byStar.has(i)) settled[i] = 1;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aAbsMag', new THREE.BufferAttribute(absMag, 1));
    geometry.setAttribute('aCi', new THREE.BufferAttribute(colorIndex, 1));
    geometry.setAttribute('aSettled', new THREE.BufferAttribute(settled, 1));

    // Frustum culling is disabled: the bounding sphere spans tens of kiloparsecs,
    // so it is never a useful rejection test, and computing it costs a full pass.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    // The pipeline ships RGB triples, but WebGL2 has no 3-component float texture
    // format, so pad to RGBA here rather than wasting a third of the file on disk.
    const lutSize = data.colorLut.length / 3;
    const lutRgba = new Float32Array(lutSize * 4);
    for (let i = 0; i < lutSize; i++) {
      lutRgba[i * 4] = data.colorLut[i * 3];
      lutRgba[i * 4 + 1] = data.colorLut[i * 3 + 1];
      lutRgba[i * 4 + 2] = data.colorLut[i * 3 + 2];
      lutRgba[i * 4 + 3] = 1.0;
    }

    const lut = new THREE.DataTexture(
      lutRgba,
      lutSize,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    lut.needsUpdate = true;
    lut.minFilter = THREE.LinearFilter;
    lut.magFilter = THREE.LinearFilter;
    lut.wrapS = THREE.ClampToEdgeWrapping;

    const lutMeta = data.dataset.layout.color_lut as {
      bv_min?: number;
      bv_max?: number;
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uMagLimit: { value: magnitudeLimit },
        uExposure: { value: exposure },
        uMinSize: { value: minPointSize },
        uMaxSize: { value: maxPointSize },
        uCiUnknown: { value: data.dataset.layout.positions.ci_unknown_sentinel },
        uBvMin: { value: lutMeta.bv_min ?? -0.4 },
        uBvMax: { value: lutMeta.bv_max ?? 2.0 },
        uOnlyOA: { value: 0.0 },
        uSettledBoost: { value: 2.2 },
        uSettledFloor: { value: 0.55 },
        uAbsoluteMags: { value: 0.0 },
        uFlatInk: { value: 1.0 },
        ...dofUniforms(),
        uColorLut: { value: lut },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Draw only the stars Orion's Arm has settled. */
  setOnlyOA(enabled: boolean): void {
    this.material.uniforms.uOnlyOA.value = enabled ? 1.0 : 0.0;
  }

  set magnitudeLimit(value: number) {
    this.material.uniforms.uMagLimit.value = value;
  }

  get magnitudeLimit(): number {
    return this.material.uniforms.uMagLimit.value as number;
  }

  set exposure(value: number) {
    this.material.uniforms.uExposure.value = value;
  }

  /**
   * Plot stars by absolute magnitude, ignoring where anything is.
   *
   * For the plan view, which has no camera for an apparent magnitude to be
   * apparent from. See the note beside the magnitude law.
   */
  set absoluteMagnitudes(enabled: boolean) {
    this.material.uniforms.uAbsoluteMags.value = enabled ? 1.0 : 0.0;
  }

  /** How much ink one star lays down, for the crowding at this map scale. */
  set flatInk(gain: number) {
    this.material.uniforms.uFlatInk.value = gain;
  }

  /** The uniforms the shared depth-of-field settings write into. */
  get dof(): DofUniforms {
    return this.material.uniforms as unknown as DofUniforms;
  }

  updatePixelRatio(ratio: number): void {
    this.material.uniforms.uPixelRatio.value = ratio;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.material.uniforms.uColorLut.value as THREE.DataTexture).dispose();
    this.material.dispose();
  }
}
