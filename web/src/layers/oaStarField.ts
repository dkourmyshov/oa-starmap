/**
 * Orion's Arm stars — the suns the setting asserts.
 *
 * Every other point on this map is somewhere because a measurement put it there.
 * These are somewhere because the fiction says so, and the map would be lying by
 * omission if the two looked alike. So they are drawn as small open diamonds
 * rather than filled discs: recognisably stars, unmistakably not observations.
 *
 * They are drawn as *markers*, at a constant screen size and full opacity, not
 * with the camera-relative magnitude law the real field uses. An earlier version
 * did apply that law, on the reasoning that the absolute magnitudes are asserted
 * too — which made them invisible. These stars sit at 150-1570 pc with typical
 * absolute magnitude 4.7, so their apparent magnitude is 12 to 16; against a
 * magnitude limit of 7.5 that is a flux of 0.01, and a diamond at one percent
 * alpha is not on the map in any useful sense.
 *
 * The mistake was treating them as photometry. They are annotations: the point
 * of drawing them is that the setting says something is there, and that is true
 * regardless of how the star field is currently exposed. The magnitude is still
 * reported in the detail panel, where it informs without hiding anything.
 */

import * as THREE from 'three';

import type { OAStarData } from '../data/manifest';

export const DEFAULT_OPACITY = 0.95;

/** Marker diameter in device pixels. */
export const DEFAULT_SIZE_PX = 9.0;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aColor;

  uniform float uSize;

  varying vec3 vColor;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;

    vColor = aColor;

    // Constant screen size: a marker, not a luminosity. Big enough that the
    // hollow centre reads as a diamond rather than smearing into a dot.
    gl_PointSize = uSize;

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;

  varying vec3 vColor;

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

    float alpha = ring * uOpacity;
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
    const colors = new Float32Array(data.count * 3);

    const lut = data.colorLut;
    const lutSize = lut.length / 3;
    const { ci_unknown_sentinel: unknown } = data.dataset.layout.positions;

    for (let i = 0; i < data.count; i++) {
      const base = i * 5;
      positions[i * 3] = data.positions[base];
      positions[i * 3 + 1] = data.positions[base + 1];
      positions[i * 3 + 2] = data.positions[base + 2];

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
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: DEFAULT_SIZE_PX },
        uOpacity: { value: DEFAULT_OPACITY },
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
