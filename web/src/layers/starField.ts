/**
 * The star point cloud.
 *
 * Two decisions here do the real work:
 *
 * **Brightness is computed from the camera, not from Earth.** The catalog stores
 * absolute magnitude; apparent magnitude is derived per frame from the distance
 * between each star and the current camera position. Flying towards a star makes
 * it brighten, exactly as it should, and no star is privileged by having been
 * bright in Earth's sky.
 *
 * **Faint stars fade rather than vanish.** Alpha follows linear flux, so a star
 * approaching the visibility limit dims smoothly to nothing. This is what keeps
 * the catalog's own sampling boundary invisible: stars drop out of view at the
 * point where they were already too dim to see, instead of popping out at a
 * radius and drawing a sphere in the sky.
 */

import * as THREE from 'three';

import type { Colony, FictionData, StarData } from '../data/manifest';

const LOG10 = Math.LN10;

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
  attribute vec3 aPolity;
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
  uniform float uPolityMode;
  uniform float uSettledBoost;
  uniform float uSettledFloor;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;

    // Scene units are parsecs. Guard the origin so Sol does not divide by zero
    // when the camera sits exactly on it.
    float distPc = max(length(viewPos.xyz), 1e-4);

    // Apparent magnitude from *this* viewpoint: m = M + 5 log10(d / 10pc).
    float m = aAbsMag + 5.0 * (log(distPc / 10.0) / ${LOG10.toFixed(9)});

    // Linear flux relative to the visibility limit; clamped before pow() so a
    // very close star cannot overflow to infinity.
    float rel = min(uMagLimit - m, 30.0);
    float flux = pow(10.0, 0.4 * rel) * uExposure;

    // Smooth fade to nothing. No threshold, no pop.
    vAlpha = clamp(flux, 0.0, 1.0);

    // A star Orion's Arm has settled is the point of the map, and most of them
    // are dim red dwarfs that the magnitude law alone renders nearly invisible.
    // Given a floor and a size boost they stay legible without the exposure
    // having to be wound up until everything else blows out.
    float settled = aSettled * uSettledBoost;
    vAlpha = max(vAlpha, aSettled * uSettledFloor);

    // Bright stars grow; faint ones stay minimal and fade out via alpha.
    float size = uMinSize * sqrt(max(flux, 1.0)) + settled;
    gl_PointSize = clamp(size, uMinSize, uMaxSize) * uPixelRatio;

    if (aCi < uCiUnknown + 1.0) {
      // Colour index unknown — neutral white rather than an invented colour.
      vColor = vec3(1.0);
    } else {
      float t = clamp((aCi - uBvMin) / (uBvMax - uBvMin), 0.0, 1.0);
      vColor = texture2D(uColorLut, vec2(t, 0.5)).rgb;
    }

    // In polity mode a settled star takes its polity's colour. Its real colour
    // is still what the catalogue measured, so this is a mode rather than a
    // correction, and the toggle puts the photometry back.
    if (uPolityMode > 0.5 && aSettled > 0.5) {
      vColor = aPolity;
    }

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Soft round sprite: a hard-edged square point reads as a pixel artefact.
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(offset, offset);
    if (r2 > 1.0) discard;

    float falloff = exp(-r2 * 3.0) * (1.0 - r2);
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
    fiction: FictionData | null = null,
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
    const polity = new Float32Array(data.count * 3);
    const settled = new Float32Array(data.count);

    const polityColor = new Map<string, THREE.Color>();
    for (const entry of fiction?.polities ?? []) {
      polityColor.set(entry.id, new THREE.Color(entry.color));
    }
    // Colonies with a status but no polity — abandoned, blight, independent —
    // are still Orion's Arm content and still deserve prominence; they simply
    // have no colour to take.
    const STATUS_COLOR = new THREE.Color(0x9aa4bb);

    for (let i = 0; i < data.count; i++) {
      const src = i * 5;
      positions[i * 3] = data.positions[src];
      positions[i * 3 + 1] = data.positions[src + 1];
      positions[i * 3 + 2] = data.positions[src + 2];
      absMag[i] = data.positions[src + 3];
      colorIndex[i] = data.positions[src + 4];

      const colony = colonies?.get(i);
      if (!colony) continue;
      settled[i] = 1;
      const chosen = polityColor.get(colony.affiliations[0] ?? '') ?? STATUS_COLOR;
      polity[i * 3] = chosen.r;
      polity[i * 3 + 1] = chosen.g;
      polity[i * 3 + 2] = chosen.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aAbsMag', new THREE.BufferAttribute(absMag, 1));
    geometry.setAttribute('aCi', new THREE.BufferAttribute(colorIndex, 1));
    geometry.setAttribute('aPolity', new THREE.BufferAttribute(polity, 3));
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
        uPolityMode: { value: 1.0 },
        uSettledBoost: { value: 2.2 },
        uSettledFloor: { value: 0.55 },
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

  /** Colour settled stars by polity, or by their measured photometry. */
  setPolityMode(enabled: boolean): void {
    this.material.uniforms.uPolityMode.value = enabled ? 1.0 : 0.0;
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

  updatePixelRatio(ratio: number): void {
    this.material.uniforms.uPixelRatio.value = ratio;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.material.uniforms.uColorLut.value as THREE.DataTexture).dispose();
    this.material.dispose();
  }
}
