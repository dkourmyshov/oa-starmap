/**
 * HII regions — the Sharpless catalogue placed at Russeil's complex distances.
 *
 * Drawn unlike clusters on purpose. A cluster is an *annotation*: a ring marking
 * where a group of stars is, deliberately hollow so it does not hide them. An HII
 * region is a thing you would actually see — glowing hydrogen — so it is drawn as
 * a soft filled glow, additively blended, in H-alpha red.
 *
 * The size is a true angular projection of the physical radius, the same
 * treatment clusters get, so these grow as you fly into them.
 *
 * Honesty affordance: regions whose distance is kinematic rather than stellar can
 * be hidden entirely. Kinematic distances toward l~0 and l~180 are near-worthless
 * (see `build/hii.py`), and being able to strip the map down to the
 * well-determined ones is more useful than a footnote saying so.
 */

import * as THREE from 'three';

import type { FictionData, HiiData } from '../data/manifest';
import { EXTENT_PARS, extentGeometry, extentUniforms, instanced } from './extent';
import {
  DEFAULT_UNDATED_GAIN,
  DEFAULT_UNNAMED_GAIN,
  EPOCH_PARS,
  type EpochPlace,
  type EpochUniforms,
  epochUniforms,
  instancedEpochAttributes,
  yearsArray,
} from './epoch';
import { type EpochBasis, landmarkYears } from '../data/history';

export const DEFAULT_OPACITY = 0.45;

/** H-alpha. Emission nebulae are red because that is the line they shine in. */
const EMISSION_COLOR = new THREE.Color(0xff5566);

/** Matches `layout.methods.order` in the manifest. */
const METHOD_KINEMATIC = 1;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aCentre;
  attribute float aRadius;
  attribute vec3 aColor;
  attribute float aKinematic;
  attribute float aAssigned;

  ${EXTENT_PARS}
  ${EPOCH_PARS}
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uShowKinematic;
  uniform float uUnassignedDim;
  uniform float uOnlyOA;

  varying vec3 vColor;
  varying float vFade;
  varying float vSize;
  varying float vGain;
  varying vec2 vCorner;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(aCentre, 1.0);
    vec4 clipCentre = projectionMatrix * viewPos;
    vCorner = position.xy;

    // Nothing the setting had reached by this year is drawn. A collapsed quad
    // covers no fragments, which is how a mesh declines an instance.
    float epoch = epochGain();
    if (epoch <= 0.0) {
      gl_Position = clipCentre;
      return;
    }

    float projected = extentPixels(aRadius, clipCentre.w);

    vFade = smoothstep(0.4, 2.0, projected) * epoch;
    vSize = clamp(projected, uMinSize, uMaxSize);
    gl_Position = extentCorner(clipCentre, vSize);
    vColor = aColor;

    vGain = mix(uUnassignedDim, 1.0, aAssigned);

    // Orion's Arm-only mode: keep just what the setting has claimed. A quad
    // collapsed onto its centre covers no fragments, which is how a mesh
    // declines to draw one instance.
    if (uOnlyOA > 0.5 && aAssigned < 0.5) {
      gl_Position = clipCentre;
      vGain = 0.0;
    }

    // Culling in the vertex stage: collapsing the quad is the cheapest way to
    // remove it without rebuilding the buffers.
    if (aKinematic > 0.5 && uShowKinematic < 0.5) {
      gl_Position = clipCentre;
      vGain = 0.0;
    }

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;

  varying vec3 vColor;
  varying float vFade;
  varying float vSize;
  varying float vGain;
  varying vec2 vCorner;

  void main() {
    vec2 offset = vCorner;
    float r = length(offset);
    if (r > 1.0) discard;

    // Soft-edged glow, brightest at the centre. Squared falloff reads as gas
    // rather than as a disc with an edge.
    float glow = 1.0 - smoothstep(0.0, 1.0, r);
    glow *= glow;

    // Additive blending is right for something that emits light, but a region
    // filling the screen would still blow out everything behind it. Surface
    // brightness therefore drops as the sprite grows, which is also what really
    // happens: the same photons spread over more pixels.
    float spread = 1.0 - 0.82 * smoothstep(40.0, 400.0, vSize);

    float alpha = glow * spread * uOpacity * vFade * vGain;
    if (alpha < 0.003) discard;

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class HiiField {
  readonly mesh: THREE.Mesh;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;
  private readonly yearAttribute: THREE.InstancedBufferAttribute;
  private readonly namedAttribute: THREE.InstancedBufferAttribute;
  /** Instance slot by the catalogue designation a timeline line would use. */
  private readonly byCatalogue = new Map<string, number>();
  private readonly yearsByBasis: Record<EpochBasis, Float32Array>;
  private readonly emissionColors: Float32Array;
  private readonly polityColorArray: Float32Array;
  private readonly colorAttribute: THREE.BufferAttribute;

  constructor(data: HiiData, fiction: FictionData | null = null) {
    this.count = data.count;

    const polityColors: (THREE.Color | undefined)[] = [];
    for (const polity of fiction?.polities ?? []) {
      polityColors[polity.index] = new THREE.Color(polity.color);
    }

    const positions = new Float32Array(data.count * 3);
    const radii = new Float32Array(data.count);
    const colors = new Float32Array(data.count * 3);
    const emission = new Float32Array(data.count * 3);
    const kinematic = new Float32Array(data.count);
    const assigned = new Float32Array(data.count);

    for (let i = 0; i < data.count; i++) {
      const src = i * 7;
      positions[i * 3] = data.geometry[src];
      positions[i * 3 + 1] = data.geometry[src + 1];
      positions[i * 3 + 2] = data.geometry[src + 2];
      radii[i] = data.geometry[src + 3];

      emission[i * 3] = EMISSION_COLOR.r;
      emission[i * 3 + 1] = EMISSION_COLOR.g;
      emission[i * 3 + 2] = EMISSION_COLOR.b;

      kinematic[i] = data.meta[i * 2] === METHOD_KINEMATIC ? 1 : 0;

      const polityIndex = fiction?.hiiPolity?.[i] ?? 0;
      const byPolity = polityIndex ? polityColors[polityIndex] : undefined;
      const chosen = byPolity ?? EMISSION_COLOR;
      assigned[i] = byPolity ? 1 : 0;
      colors[i * 3] = chosen.r;
      colors[i * 3 + 1] = chosen.g;
      colors[i * 3 + 2] = chosen.b;
    }

    this.emissionColors = emission;
    this.polityColorArray = colors.slice();

    const geometry = extentGeometry(data.count);
    geometry.setAttribute('aCentre', instanced(positions, 3));
    geometry.setAttribute('aRadius', instanced(radii, 1));
    geometry.setAttribute('aColor', instanced(colors, 3));
    geometry.setAttribute('aKinematic', instanced(kinematic, 1));
    geometry.setAttribute('aAssigned', instanced(assigned, 1));

    // One pair of years per region, not per corner of its quad. Almost none of
    // the Sharpless catalogue has any: these are the few Orion's Arm names,
    // dated by their own history where they have one and by the epoch their
    // political map depicts where that map is all that mentions them.
    const epochPlaces = (basis: EpochBasis): EpochPlace[] =>
      Array.from({ length: data.count }, (_unused, index) => {
        const years = landmarkYears(fiction, 'hii', index, basis);
        return { from: years.from, to: years.to, distancePc: 0 };
      });
    const attached = instancedEpochAttributes(geometry, epochPlaces('known'));
    this.yearAttribute = attached.years;
    this.namedAttribute = attached.named;
    for (const entry of fiction?.landmarkNames.values() ?? []) {
      if (entry.kind === 'hii') {
        this.byCatalogue.set(`cat:${entry.catalogue}`, entry.index);
      }
    }
    this.yearsByBasis = {
      known: attached.yearsArray,
      settled: yearsArray(epochPlaces('settled')),
    };
    this.colorAttribute = geometry.getAttribute('aColor') as THREE.BufferAttribute;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...extentUniforms(),
        ...epochUniforms(),
        uMinSize: { value: 2.0 },
        // Far beyond any viewport — see clusterField, and layers/extent.ts.
        uMaxSize: { value: 20000.0 },
        uOpacity: { value: DEFAULT_OPACITY },
        uShowKinematic: { value: 1.0 },
        uUnassignedDim: { value: 1.0 },
        uOnlyOA: { value: 0.0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Device pixels, both axes: the corner offsets are computed in them. */
  setViewport(width: number, height: number): void {
    (this.material.uniforms.uViewport.value as THREE.Vector2).set(width, height);
  }

  /**
   * Show the map as it stood in a year, or stop.
   *
   * An HII region is a real object and was there in 2100 as surely as in 10600,
   * so a year cannot say whether it exists. What it says is whether the setting
   * had anything to do with it yet. The rest of the catalogue is ordinary
   * astronomy with no year at all, and takes the undated state along with
   * everything else that has none.
   */
  setEpoch(year: number | null, showUndated = true): void {
    const uniforms = this.material.uniforms as unknown as EpochUniforms;
    uniforms.uEpochOn.value = year === null ? 0 : 1;
    uniforms.uUndatedGain.value = showUndated ? DEFAULT_UNDATED_GAIN : 0;
    if (year !== null) uniforms.uYear.value = year;
  }

  /**
   * Mark the landmarks a period's own history names; null clears the emphasis.
   *
   * Keyed on the catalogue designation, which is the only name a region and a
   * timeline line have in common — the Encyclopaedia calls Melotte 186 Aleph
   * Absolute, and the catalogue has never heard of it.
   */
  setNamedPlaces(keys: Set<string> | null, gain = DEFAULT_UNNAMED_GAIN): void {
    const named = this.namedAttribute.array as Float32Array;
    named.fill(keys === null ? 1 : 0);
    if (keys) {
      for (const [key, index] of this.byCatalogue) if (keys.has(key)) named[index] = 1;
    }
    this.namedAttribute.needsUpdate = true;
    (this.material.uniforms as unknown as EpochUniforms).uUnnamedGain.value =
      keys === null ? 1 : gain;
  }

  /** Which date decides when it appears: first known, or settled. */
  setEpochBasis(basis: EpochBasis): void {
    (this.yearAttribute.array as Float32Array).set(this.yearsByBasis[basis]);
    this.yearAttribute.needsUpdate = true;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
  }

  /** Hide regions placed by kinematic distance, leaving only stellar ones. */
  setShowKinematic(enabled: boolean): void {
    this.material.uniforms.uShowKinematic.value = enabled ? 1.0 : 0.0;
  }

  /** Colour by Orion's Arm polity, or by emission (all regions alike). */
  setPolityMode(enabled: boolean): void {
    const source = enabled ? this.polityColorArray : this.emissionColors;
    (this.colorAttribute.array as Float32Array).set(source);
    this.colorAttribute.needsUpdate = true;
    this.material.uniforms.uUnassignedDim.value = enabled ? 0.3 : 1.0;
  }

  /** Draw only the objects carrying an Orion's Arm association. */
  setOnlyOA(enabled: boolean): void {
    this.material.uniforms.uOnlyOA.value = enabled ? 1.0 : 0.0;
  }

  set visible(value: boolean) {
    this.mesh.visible = value;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
