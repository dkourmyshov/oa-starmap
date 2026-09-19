/**
 * Orion's Arm stars — the suns the setting asserts.
 *
 * They are drawn as discs coloured by spectral class, exactly as the catalogue
 * stars are. The add-on gives 26 of the 27 a spectral type — mostly G2V, with a
 * white dwarf, a brown dwarf, a pulsar and an O star among them — so there is
 * real stellar data here, and it is what the marker shows.
 *
 * They were open diamonds from 2026-08-01 to 2026-09-19, on the reasoning that
 * "every other point on this map is somewhere because a measurement put it
 * there, these are somewhere because the fiction says so, and the map would be
 * lying by omission if the two looked alike."
 *
 * That was true when it was written. The map then held catalogue stars and
 * these, and nothing else — so "came from the Celestia add-on" and "asserted
 * rather than observed" picked out the same set, and the diamond meant both at
 * once. It was outgrown rather than mistaken. Nine days and fifteen commits
 * later the canonical worlds arrived, one of them carrying its own right
 * ascension and declination; today 308 do, 223 from stated coordinates and 85
 * from a constellation, every one asserted by the fiction and every one drawn
 * as a dot.
 *
 * At which point the two halves came apart and only provenance was left — 21
 * marked out of 329, reading as a distinction the map could not explain. The
 * ring does not carry the other half either: continuity says how precisely a
 * thing is located, so a fictional star with a stated position takes a solid
 * ring exactly as a catalogue star does. That is correct, and a different
 * question.
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
 * magnitude limit of 7.5 that is a flux of 0.01, and a marker at one percent
 * alpha is not on the map in any useful sense.
 *
 * The mistake was treating them as photometry. They are annotations: the point
 * of drawing them is that the setting says something is there, and that is true
 * regardless of how the star field is currently exposed. The magnitude is still
 * reported in the detail panel, where it informs without hiding anything.
 */

import * as THREE from 'three';

import type { OAStarData, WorldData, WorldEntry } from '../data/manifest';
import { type EpochBasis, combinedYears } from '../data/history';
import { DOF_PARS, type DofUniforms, dofUniforms } from './dof';
import {
  DEFAULT_UNDATED_GAIN,
  DEFAULT_UNNAMED_GAIN,
  EPOCH_PARS,
  type EpochUniforms,
  attachEpochAttributes,
  epochUniforms,
} from './epoch';

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

  uniform float uSize;
  ${DOF_PARS}
  ${EPOCH_PARS}
  uniform float uBareDim;

  varying vec3 vColor;
  varying float vGain;
  varying float vBlur;
  varying float vScale;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;

    float epoch = epochGain();
    if (epoch <= 0.0) {
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vColor = aColor;

    // Entries the add-on gives nothing but a designation recede, so the ones
    // it actually says something about stand out.
    vGain = mix(1.0, uBareDim, aBare);

    // Constant screen size: a marker, not a luminosity. These sit at 150 to
    // 1,570 pc with a typical absolute magnitude of 4.7, so the magnitude law
    // would put them at apparent 12 to 16 and off the map entirely.
    // Depth of field. The sprite grows to make room for the blur and the
    // fragment scales its coordinate back, so the marker keeps its screen size
    // and only its edges soften — a ring that swelled with defocus would read
    // as a bigger region, which is a claim about the data rather than about
    // where the camera is looking.
    float defocus = dofDecades(viewPos);
    float blurPx = dofBlurPx(defocus);
    float grown = uSize + 2.0 * blurPx;
    vScale = grown / uSize;
    vBlur = min(blurPx / (uSize * 0.5), 0.5);
    vGain *= dofGain(uSize, grown) * dofDim(defocus) * epoch;
    gl_PointSize = grown;

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;

  varying vec3 vColor;
  varying float vGain;
  varying float vBlur;
  varying float vScale;

  void main() {
    vec2 offset = (gl_PointCoord * 2.0 - 1.0) * vScale;
    float w = vBlur;

    // A star's glyph: a soft filled disc, at constant size because the
    // magnitude law would put a 14.8-magnitude white dwarf below any usable
    // exposure.
    float shape = 1.0 - smoothstep(0.10 - w, 0.62 + w, length(offset));
    float alpha = shape * uOpacity * vGain;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(vColor, alpha);
  }
`;

/** Years for a run of add-on stars, each as its bound worlds have them. */
function yearsFor(bound: (WorldEntry[] | undefined)[], basis: EpochBasis): Float32Array {
  const out = new Float32Array(bound.length * 2);
  bound.forEach((here, index) => {
    const years = combinedYears(here, basis);
    out[index * 2] = years.from;
    out[index * 2 + 1] = years.to;
  });
  return out;
}

export class OAStarField {
  readonly points: THREE.Points;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;
  private readonly yearAttribute: THREE.BufferAttribute;
  private readonly namedAttribute: THREE.BufferAttribute;
  private readonly yearsByBasis: Record<EpochBasis, Float32Array>;
  private readonly designations: string[];

  constructor(data: OAStarData, worlds: WorldData | null = null) {
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

    // Only the add-on stars carrying a world are dated at all; the rest are
    // positions the setting asserts with no year attached, and take the undated
    // state rather than being dropped from a historical view they say nothing
    // about either way.
    const bound = shown.map((i) => worlds?.byOAStar.get(data.names[i]?.name ?? ''));
    const attached = attachEpochAttributes(
      geometry,
      bound.map((here) => ({ ...combinedYears(here, 'known'), distancePc: 0 })),
    );
    this.yearAttribute = attached.years;
    this.namedAttribute = attached.named;
    this.yearsByBasis = {
      known: (attached.years.array as Float32Array).slice(),
      settled: yearsFor(bound, 'settled'),
    };
    this.designations = shown.map((i) => data.names[i]?.name ?? '');

    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: DEFAULT_SIZE_PX },

        ...dofUniforms(),
        ...epochUniforms(),
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

  /**
   * Show the map as it stood in a year, or stop.
   *
   * `showUndated` reaches the shader as a gain rather than a filter, because
   * "no date recorded" is a third state and not a kind of absence: hidden it
   * must vanish completely, shown it must be visibly weaker than a place with
   * a year. Wiring it only into the picker left the reader hiding the undated
   * places and still looking at them.
   */
  setEpoch(year: number | null, showUndated = true): void {
    const uniforms = this.material.uniforms as unknown as EpochUniforms;
    uniforms.uEpochOn.value = year === null ? 0 : 1;
    uniforms.uUndatedGain.value = showUndated ? DEFAULT_UNDATED_GAIN : 0;
    if (year !== null) uniforms.uYear.value = year;
  }

  /** Which date decides when a star appears: first reached, or settled. */
  setEpochBasis(basis: EpochBasis): void {
    (this.yearAttribute.array as Float32Array).set(this.yearsByBasis[basis]);
    this.yearAttribute.needsUpdate = true;
  }

  /** Mark the stars a period's own history names; null clears the emphasis. */
  setNamedPlaces(designations: Set<string> | null, gain = DEFAULT_UNNAMED_GAIN): void {
    const named = this.namedAttribute.array as Float32Array;
    this.designations.forEach((name, index) => {
      named[index] = designations === null || designations.has(name) ? 1 : 0;
    });
    this.namedAttribute.needsUpdate = true;
    (this.material.uniforms as unknown as EpochUniforms).uUnnamedGain.value =
      designations === null ? 1 : gain;
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

  /** The uniforms the shared depth-of-field settings write into. */
  get dof(): DofUniforms {
    return this.material.uniforms as unknown as DofUniforms;
  }
}
