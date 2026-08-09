/**
 * Orion's Arm stars — the suns the setting asserts.
 *
 * Every other point on this map is somewhere because a measurement put it there.
 * These are somewhere because the fiction says so, and the map would be lying by
 * omission if the two looked alike. So they are drawn as small open diamonds
 * rather than filled discs: recognisably stars, unmistakably not observations.
 *
 * The exception is the handful the add-on carries only because Celestia's
 * catalogue omits them — Wadai's white dwarf, Geminga, Arkab Prior B. Those are
 * real objects at measured positions, so a diamond would state the opposite of
 * the truth about them; they get a filled disc. The distinction comes from the
 * curated `real` field, never from the shape of the designation.
 *
 * What the marker no longer carries is the polity. An affiliation is drawn the
 * same way here as it is on a real settled star — a ring around the star and a
 * coloured label — so that one fact has one appearance. Wadai is the case that
 * forced it: it is in both source sets, and used to render as a coloured diamond
 * while the identical statement about any Inner Sphere colony rendered as a ring.
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

/**
 * Opacity for entries carrying only a designation.
 *
 * A judgement about the *source*, not about the object: it means the add-on
 * says nothing beyond the number. JD 518791 is dimmed here yet appears in the
 * Encyclopaedia Galactica, so this must stay a display weighting and never
 * become a filter.
 */
export const BARE_DIM = 0.42;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aColor;
  attribute float aBare;
  attribute float aReal;

  uniform float uSize;
  uniform float uBareDim;

  varying vec3 vColor;
  varying float vGain;
  varying float vReal;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;

    vColor = aColor;
    vReal = aReal;

    // Entries the add-on gives nothing but a designation recede, so the ones
    // it actually says something about stand out.
    vGain = mix(1.0, uBareDim, aBare);

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
  varying float vGain;
  varying float vReal;

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;

    // A real object gets a star's glyph: a soft filled disc, drawn at constant
    // size because the magnitude law would put a 14.8-magnitude white dwarf
    // below any usable exposure. The rest get an open diamond.
    float disc = 1.0 - smoothstep(0.10, 0.62, length(offset));

    // L1 distance makes a diamond where L2 would make a circle.
    float d = abs(offset.x) + abs(offset.y);

    // Hollow: the outline is the tell, and a filled marker at this size would be
    // indistinguishable from a star.
    float edge = 1.0 - smoothstep(0.42, 1.0, d);
    float core = 1.0 - smoothstep(0.0, 0.46, d);
    float diamond = d > 1.0 ? 0.0 : clamp(edge - core, 0.0, 1.0);

    float shape = mix(diamond, disc, vReal);
    float alpha = shape * uOpacity * vGain;
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
    // Hidden entries are dropped from the geometry, not merely faded: they are
    // the 52 the add-on says nothing about beyond sitting in NGC 6633, and
    // stacked markers obscure the cluster they are meant to populate.
    const shown: number[] = [];
    for (let i = 0; i < data.count; i++) {
      if (!data.names[i]?.hidden) shown.push(i);
    }
    this.count = shown.length;

    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    const bare = new Float32Array(this.count);
    const real = new Float32Array(this.count);

    const lut = data.colorLut;
    const lutSize = lut.length / 3;
    const { ci_unknown_sentinel: unknown } = data.dataset.layout.positions;

    for (let out = 0; out < shown.length; out++) {
      const i = shown[out];
      const base = i * 5;
      positions[out * 3] = data.positions[base];
      positions[out * 3 + 1] = data.positions[base + 1];
      positions[out * 3 + 2] = data.positions[base + 2];

      // Nothing but a JD/YTS number: no system, no curation, nothing to read.
      const entry = data.names[i];
      bare[out] =
        entry && entry.oa_designation && !entry.system && !entry.affiliation ? 1 : 0;
      real[out] = entry?.real ? 1 : 0;

      const ci = data.positions[base + 4];
      if (ci <= unknown + 1 || lutSize === 0) {
        // Unknown colour renders white, the same neutral the real field uses.
        colors[out * 3] = 1;
        colors[out * 3 + 1] = 1;
        colors[out * 3 + 2] = 1;
      } else {
        // The LUT spans B-V -0.4 .. 2.0, matching the pipeline's build_color_lut.
        const t = Math.min(Math.max((ci + 0.4) / 2.4, 0), 1);
        const slot = Math.min(Math.round(t * (lutSize - 1)), lutSize - 1) * 3;
        colors[out * 3] = lut[slot];
        colors[out * 3 + 1] = lut[slot + 1];
        colors[out * 3 + 2] = lut[slot + 2];
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aBare', new THREE.BufferAttribute(bare, 1));
    geometry.setAttribute('aReal', new THREE.BufferAttribute(real, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: DEFAULT_SIZE_PX },
        uOpacity: { value: DEFAULT_OPACITY },
        uBareDim: { value: BARE_DIM },
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
