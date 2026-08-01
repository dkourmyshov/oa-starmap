/**
 * Orion's Arm stars — the suns the setting asserts.
 *
 * Every other point on this map is somewhere because a measurement put it there.
 * These are somewhere because the fiction says so, and the map would be lying by
 * omission if the two looked alike. So they are drawn as small open diamonds
 * rather than filled discs: recognisably stars, unmistakably not observations.
 *
 * Brightness still follows the same camera-relative magnitude law as the real
 * field, because their absolute magnitudes are asserted too and behaving
 * differently would misrepresent what the source says. What changes is the
 * shape, not the physics.
 */

import * as THREE from 'three';

import type { OAStarData } from '../data/manifest';

export const DEFAULT_MAGNITUDE_LIMIT = 9.5;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute float aAbsMag;
  attribute vec3 aColor;

  uniform float uMagLimit;
  uniform float uExposure;
  uniform float uScale;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;

    float distPc = max(length(viewPos.xyz), 1e-4);

    // Apparent magnitude at the camera, not at Earth — same law as the real field.
    float m = aAbsMag + 5.0 * (log(distPc / 10.0) / 2.302585093);
    float rel = min(uMagLimit - m, 30.0);
    float flux = pow(10.0, 0.4 * rel) * uExposure;

    vAlpha = clamp(flux, 0.0, 1.0);
    vColor = aColor;

    // A wider floor than real stars get: an outline needs a few pixels before it
    // reads as a diamond rather than as a dot.
    gl_PointSize = clamp(3.5 + 2.0 * log(1.0 + flux), 4.0, 22.0) * uScale;

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;

    // L1 distance makes a diamond where L2 would make a circle.
    float d = abs(offset.x) + abs(offset.y);
    if (d > 1.0) discard;

    // Hollow: the outline is the tell, and a filled marker at this size would be
    // indistinguishable from a star.
    float edge = 1.0 - smoothstep(0.42, 1.0, d);
    float core = 1.0 - smoothstep(0.0, 0.46, d);
    float ring = clamp(edge - core, 0.0, 1.0);

    float alpha = ring * vAlpha * uOpacity;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class OAStarField {
  readonly points: THREE.Points;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;

  constructor(data: OAStarData) {
    this.count = data.count;

    const positions = new Float32Array(data.count * 3);
    const absMag = new Float32Array(data.count);
    const colors = new Float32Array(data.count * 3);

    const lut = data.colorLut;
    const lutSize = lut.length / 3;
    const { ci_unknown_sentinel: unknown } = data.dataset.layout.positions;

    for (let i = 0; i < data.count; i++) {
      const base = i * 5;
      positions[i * 3] = data.positions[base];
      positions[i * 3 + 1] = data.positions[base + 1];
      positions[i * 3 + 2] = data.positions[base + 2];
      absMag[i] = data.positions[base + 3];

      const ci = data.positions[base + 4];
      if (ci <= unknown + 1 || lutSize === 0) {
        // Unknown colour renders white, the same neutral the real field uses.
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 1;
        colors[i * 3 + 2] = 1;
      } else {
        // The LUT spans B-V -0.4 .. 2.0, matching the pipeline's build_color_lut.
        const t = Math.min(Math.max((ci + 0.4) / 2.4, 0), 1);
        const slot = Math.min(Math.round(t * (lutSize - 1)), lutSize - 1) * 3;
        colors[i * 3] = lut[slot];
        colors[i * 3 + 1] = lut[slot + 1];
        colors[i * 3 + 2] = lut[slot + 2];
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aAbsMag', new THREE.BufferAttribute(absMag, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMagLimit: { value: DEFAULT_MAGNITUDE_LIMIT },
        uExposure: { value: 1.0 },
        uOpacity: { value: 1.0 },
        uScale: { value: 1.0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    // Draw over the real field so a marker is never hidden inside a star cloud.
    this.points.renderOrder = 2;
  }

  set magnitudeLimit(value: number) {
    this.material.uniforms.uMagLimit.value = value;
  }

  set exposure(value: number) {
    this.material.uniforms.uExposure.value = value;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
  }

  set visible(value: boolean) {
    this.points.visible = value;
  }

  get visible(): boolean {
    return this.points.visible;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
