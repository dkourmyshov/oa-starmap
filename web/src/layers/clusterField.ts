/**
 * Open clusters, moving groups and globulars.
 *
 * These are the map's first objects with real *extent*. Their on-screen size is
 * the projection of a physical radius in parsecs, not a fixed sprite size — so a
 * cluster grows as you approach it and shrinks with distance exactly as a real
 * volume would, which is what makes them usable as navigational landmarks.
 *
 * They are drawn as rings rather than filled discs so they read as regions of
 * space and do not hide the stars inside them.
 */

import * as THREE from 'three';

import type { ClusterData, FictionData } from '../data/manifest';

import { DOF_PARS, type DofUniforms, dofUniforms } from './dof';
import {
  DEFAULT_UNDATED_GAIN,
  DEFAULT_UNNAMED_GAIN,
  EPOCH_PARS,
  type EpochUniforms,
  type EpochPlace,
  epochUniforms,
  instancedEpochAttributes,
  yearsArray,
} from './epoch';
import { type EpochBasis, landmarkYears } from '../data/history';

import { EXTENT_PARS, extentGeometry, extentUniforms, instanced } from './extent';
import { FOCUS_PARS, UNFOCUSED_DIM, type FocusUniforms, focusUniforms } from './focus';
export const DEFAULT_OPACITY = 0.7;

/** Index order must match `layout.types.order` in the manifest. */
const TYPE_COLORS: Record<number, THREE.Color> = {
  0: new THREE.Color(0x6fd8e0), // open cluster - teal
  1: new THREE.Color(0x7fe0a8), // moving group - green
  2: new THREE.Color(0xe8b26a), // globular cluster - amber
  3: new THREE.Color(0x9aa4bb), // unknown - grey
};

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aCentre;
  attribute float aRadius;
  attribute vec3 aColor;
  attribute vec3 aColorB;
  attribute float aShared;
  attribute float aAssigned;

  ${EXTENT_PARS}
  ${DOF_PARS}
  ${EPOCH_PARS}
  ${FOCUS_PARS}
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uUnassignedDim;
  uniform float uOnlyOA;

  varying vec3 vColor;
  varying vec3 vColorB;
  varying float vShared;
  varying float vFade;
  varying float vSize;
  varying float vBlur;
  varying float vScale;
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

    // Below the minimum a cluster would vanish; clamping keeps distant ones as
    // small marks. Fade them instead of popping so the far field stays calm.
    // Depth of field. The quad grows to make room and the fragment scales its
    // coordinate back, so the outline keeps the angular size it is there to
    // report and only its edge softens. vSize stays the unblurred size, because
    // the ring's thickness is derived from it and a hairline must not thin just
    // because the thing is out of focus.
    vFade = smoothstep(0.35, 1.6, projected) * epoch;
    float base = clamp(projected, uMinSize, uMaxSize);
    float defocus = dofDecades(viewPos);
    float blurPx = dofBlurPx(defocus);
    float grown = base + 2.0 * blurPx;
    vScale = grown / base;
    vBlur = min(blurPx / max(base * 0.5, 1e-4), 0.5);
    vFade *= dofGain(base, grown) * dofDim(defocus);
    gl_Position = extentCorner(clipCentre, grown);
    vSize = base;

    vColor = aColor;
    vColorB = aColorB;
    vShared = aShared;

    // Clusters carrying an Orion's Arm association are the ones being navigated
    // by, so the other ~7000 recede rather than competing with them.
    vGain = mix(uUnassignedDim, 1.0, aAssigned) * focusGain();

    // Orion's Arm-only mode: keep just what the setting has claimed. A quad
    // collapsed onto its centre covers no fragments, which is how a mesh
    // declines to draw one instance.
    if (uOnlyOA > 0.5 && aAssigned < 0.5) {
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
  uniform float uRingWidthPx;

  varying vec3 vColor;
  varying float vFade;
  varying float vSize;
  varying float vBlur;
  varying float vScale;
  varying float vGain;
  varying vec3 vColorB;
  varying float vShared;
  varying vec2 vCorner;

  void main() {
    // The quad corner, in the same [-1, 1] the point sprite's gl_PointCoord
    // gave once this had subtracted its centre — so everything below is as it
    // was when these were sprites.
    vec2 offset = vCorner;
    if (length(offset) > 1.0) discard;
    float r = length(offset) * vScale;

    // Ring thickness is constant in *pixels*, not a fraction of the sprite.
    // Defining it in sprite space made a nearby moving group render as a
    // 180-pixel-thick band rather than an outline, which is what washed out the
    // inner sphere.
    float width = clamp(uRingWidthPx / max(vSize, 1.0), 0.004, 0.40);
    float ring = 1.0 - smoothstep(0.0, width + vBlur, abs(r - (1.0 - width)));

    // The interior tint is useful for small distant clusters, where the ring
    // alone is nearly invisible, but it must fade out as the sprite grows or a
    // nearby cluster becomes a screen-filling wash over the stars it contains.
    float interiorGain = 1.0 - smoothstep(50.0, 240.0, vSize);
    float interior = (1.0 - smoothstep(0.0, 0.85, r)) * 0.10 * interiorGain;

    float alpha = (ring + interior) * uOpacity * vFade * vGain;
    if (alpha < 0.004) discard;

    // A cluster two polities both claim is drawn half in each colour. Blanco 1
    // is the Communion of Worlds in its own article and the Non-Coercive Zone
    // on the political maps, and a single colour would have to pick one.
    vec3 color = vColor;
    if (vShared > 0.5) {
      float turn = fract(0.25 - atan(offset.y, offset.x) / (2.0 * PI));
      color = turn < 0.5 ? vColor : vColorB;
    }

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(color, alpha);
  }
`;

export class ClusterField {
  readonly mesh: THREE.Mesh;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;
  private readonly yearAttribute: THREE.InstancedBufferAttribute;
  private readonly namedAttribute: THREE.InstancedBufferAttribute;
  /** Instance slot by the catalogue designation a timeline line would use. */
  private readonly byCatalogue = new Map<string, number>();
  private readonly yearsByBasis: Record<EpochBasis, Float32Array>;
  private readonly typeColors: Float32Array;
  private readonly polityColorArray: Float32Array;
  private readonly colorAttribute: THREE.BufferAttribute;
  private readonly focusAttribute: THREE.BufferAttribute;
  /** Which instances each polity holds, for setFocusPolity. */
  private readonly byPolity = new Map<string, number[]>();

  constructor(data: ClusterData, fiction: FictionData | null = null) {
    this.count = data.count;

    // Polity colours, indexed 1-based to match the packed byte array. The ids
    // are kept the same way round, so a holder read out of the packed bytes can
    // be named without a search.
    const polityColors: (THREE.Color | undefined)[] = [];
    const polityIds: string[] = [];
    for (const polity of fiction?.polities ?? []) {
      polityIds[polity.index] = polity.id;
      polityColors[polity.index] = new THREE.Color(polity.color);
    }

    const positions = new Float32Array(data.count * 3);
    const radii = new Float32Array(data.count);
    const colors = new Float32Array(data.count * 3);
    const secondColors = new Float32Array(data.count * 3);
    const typeColors = new Float32Array(data.count * 3);
    const assigned = new Float32Array(data.count);
    const shared = new Float32Array(data.count);

    for (let i = 0; i < data.count; i++) {
      const src = i * 8;
      positions[i * 3] = data.geometry[src];
      positions[i * 3 + 1] = data.geometry[src + 1];
      positions[i * 3 + 2] = data.geometry[src + 2];
      radii[i] = data.geometry[src + 3];

      const byType = TYPE_COLORS[data.meta[i * 2]] ?? TYPE_COLORS[3];
      typeColors[i * 3] = byType.r;
      typeColors[i * 3 + 1] = byType.g;
      typeColors[i * 3 + 2] = byType.b;

      const polityIndex = fiction?.clusterPolity[i] ?? 0;
      const byPolity = polityIndex ? polityColors[polityIndex] : undefined;
      const chosen = byPolity ?? byType;
      assigned[i] = byPolity ? 1 : 0;
      colors[i * 3] = chosen.r;
      colors[i * 3 + 1] = chosen.g;
      colors[i * 3 + 2] = chosen.b;

      // The second holder, where there is one. Only two are shown: a cluster
      // ring is a thin outline and cutting it finer than halves stops reading
      // as anything. Nothing recorded has three.
      const holders = fiction?.sharedPolities?.get(`cluster:${i}`);
      // Membership is recorded for every holder, not only the two that get an
      // arc: a cluster a third polity also claims should light up when that
      // polity is picked, even though the ring has no room to say so.
      for (const index of holders ?? (polityIndex ? [polityIndex] : [])) {
        const id = polityIds[index];
        if (!id) continue;
        const held = this.byPolity.get(id);
        if (held) held.push(i);
        else this.byPolity.set(id, [i]);
      }
      const second = holders && holders.length > 1 ? polityColors[holders[1]] : undefined;
      shared[i] = second ? 1 : 0;
      const other = second ?? chosen;
      secondColors[i * 3] = other.r;
      secondColors[i * 3 + 1] = other.g;
      secondColors[i * 3 + 2] = other.b;
    }

    this.typeColors = typeColors;
    this.polityColorArray = colors.slice();

    const geometry = extentGeometry(data.count);
    geometry.setAttribute('aCentre', instanced(positions, 3));
    geometry.setAttribute('aRadius', instanced(radii, 1));
    geometry.setAttribute('aColor', instanced(colors, 3));
    geometry.setAttribute('aColorB', instanced(secondColors, 3));
    geometry.setAttribute('aShared', instanced(shared, 1));
    geometry.setAttribute('aAssigned', instanced(assigned, 1));
    geometry.setAttribute('aFocus', instanced(new Float32Array(data.count).fill(1), 1));
    // One pair of years per cluster, not per corner of its quad. Most of the
    // catalogue has none: these are the few the setting names, dated by their
    // own history where they have one and by their source's epoch where the
    // political maps are all that mention them.
    const epochPlaces = (basis: EpochBasis): EpochPlace[] =>
      Array.from({ length: data.count }, (_unused, index) => {
        const years = landmarkYears(fiction, 'cluster', index, basis);
        return { from: years.from, to: years.to, distancePc: 0 };
      });
    const attached = instancedEpochAttributes(geometry, epochPlaces('known'));
    this.yearAttribute = attached.years;
    this.namedAttribute = attached.named;
    for (const entry of fiction?.landmarkNames.values() ?? []) {
      if (entry.kind === 'cluster') {
        this.byCatalogue.set(`cat:${entry.catalogue}`, entry.index);
      }
    }
    this.yearsByBasis = {
      known: attached.yearsArray,
      settled: yearsArray(epochPlaces('settled')),
    };
    this.colorAttribute = geometry.getAttribute('aColor') as THREE.BufferAttribute;
    this.focusAttribute = geometry.getAttribute('aFocus') as THREE.BufferAttribute;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...extentUniforms(),
        ...dofUniforms(),
        ...epochUniforms(),
        uMinSize: { value: 3.0 },
        // Far beyond any viewport: with quads instead of point sprites there
        // is no cap to work around, and a cluster drawn at anything but its own
        // radius is a false statement about its size. See layers/extent.ts.
        uMaxSize: { value: 20000.0 },
        uOpacity: { value: DEFAULT_OPACITY },
        uRingWidthPx: { value: 1.6 },
        ...focusUniforms(),
        uUnassignedDim: { value: 1.0 },
        uOnlyOA: { value: 0.0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // Normal rather than additive: these are annotations marking regions, not
      // light sources. Additive made overlapping clusters in the crowded solar
      // neighbourhood sum towards white.
      blending: THREE.NormalBlending,
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
   * A cluster is a real object and was there in 2100 as surely as in 10600, so
   * a year cannot say whether it exists. What it says is whether the setting
   * had anything to do with it yet — a landmark the Encyclopaedia dates, or one
   * whose polity is attested by a map of a stated epoch. The rest of the
   * catalogue is ordinary astronomy with no year at all, and takes the undated
   * state along with everything else that has none.
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
   * Keyed on the catalogue designation, which is the only name a cluster and a
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

  /**
   * Pick out one polity's holdings by taking everything else down.
   *
   * Nothing is added and nothing is hidden: the chosen polity's rings stay
   * exactly as they were drawn, in their own colour, and the rest of the
   * catalogue stays on screen as the context they are held in. See layers/focus.ts.
   */
  setFocusPolity(polityId: string | null): void {
    const uniforms = this.material.uniforms as unknown as FocusUniforms;
    if (polityId === null) {
      // The attribute is left as it stands. With the dim at 1 it cannot be
      // read, and rewriting it to clear a selection would be work for nothing.
      uniforms.uFocusDim.value = 1;
      return;
    }
    const focus = this.focusAttribute.array as Float32Array;
    focus.fill(0);
    for (const index of this.byPolity.get(polityId) ?? []) focus[index] = 1;
    this.focusAttribute.needsUpdate = true;
    uniforms.uFocusDim.value = UNFOCUSED_DIM;
  }

  /**
   * Colour by Orion's Arm polity, or by astronomical object type.
   *
   * Switching also dims the unassigned clusters in polity mode: the point of
   * that view is the fictional geography, and 7000 undifferentiated rings drown
   * out the ~100 that carry meaning.
   */
  setPolityMode(enabled: boolean): void {
    const source = enabled ? this.polityColorArray : this.typeColors;
    (this.colorAttribute.array as Float32Array).set(source);
    this.colorAttribute.needsUpdate = true;
    this.material.uniforms.uUnassignedDim.value = enabled ? 0.22 : 1.0;
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

  /** The uniforms the shared depth-of-field settings write into. */
  get dof(): DofUniforms {
    return this.material.uniforms as unknown as DofUniforms;
  }
}
