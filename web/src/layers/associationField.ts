/**
 * OB associations — the loose groupings of young massive stars.
 *
 * The two most conspicuous features on any wide picture of the solar
 * neighbourhood, Ori OB1 and Vel OB2, and the two this map drew nothing for.
 *
 * Every other extent layer here draws a circle from a radius. These cannot be:
 * an OB association is a chain or a sheet, not a ball — Ori OB1b spreads 35 pc
 * along X and 23 along Z — and the catalogue gives a dispersion per axis rather
 * than a size. So this layer draws an **ellipsoid**, axis-aligned to the
 * galactic frame, projected properly rather than approximated by its mean.
 *
 * How the projection works. The three semi-axes are world-space offsets along
 * galactic x, y and z; projecting each of their endpoints and subtracting the
 * centre gives three screen-space vectors. The outline is then the image of the
 * unit sphere under the 2x3 matrix those vectors form, which is an ellipse, and
 * an ellipse is fully described on screen by the 2x2 matrix M = A * transpose(A).
 * The quad is sized to that ellipse's bounding box and the fragment shader tests
 * the quadratic form. Everything here follows from that one matrix: the extent,
 * the inside test, and the ring.
 *
 * There is deliberately no "Orion's Arm only" filter here. The other extent
 * layers dim what no polity holds, which is a real distinction among clusters
 * and nebulae because some of those are landmarks the setting names. No OB
 * association is, so the filter would hide all fifty-six and make a layer the
 * reader had just switched on appear broken. This is a reference frame, like
 * the borrowed sky maps, and it is off until it is asked for.
 *
 * **The outline is broken, and that is the point.** A cluster's radius is a
 * boundary of sorts; an association has none at all. It is unbound, dissolving,
 * and the contour drawn here is one standard deviation of a distribution with a
 * good deal of the association outside it. A solid line would claim an edge that
 * does not exist, so the line is dashed and the panel says what it means.
 */

import * as THREE from 'three';

import type { AssociationData, FictionData } from '../data/manifest';
import { DOF_PARS, type DofUniforms, dofUniforms } from './dof';
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
import { extentGeometry, extentUniforms, instanced } from './extent';

export const DEFAULT_OPACITY = 0.75;

/**
 * Young hot stars, and a colour that says so.
 *
 * Chosen to sit apart from both neighbours it will overlap: the clusters are
 * coloured by type across the whole wheel, and the HII regions are the red of
 * their own emission. A cold blue-white is what an O star looks like and what
 * neither of those uses.
 */
const OUTLINE = new THREE.Color(0x8fb8ff);

/** Ring thickness in device pixels. */
export const RING_PX = 1.5;

/** Dashes around the outline. Enough to read as broken at any size. */
export const DASHES = 34.0;

/** Beyond any viewport — see layers/extent.ts; there is no point-sprite cap. */
export const MAX_SIZE_PX = 20000.0;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aCentre;
  attribute vec3 aSigma;

  uniform vec2 uViewport;
  uniform float uMaxPx;
  ${DOF_PARS}
  ${EPOCH_PARS}

  varying vec2 vCorner;
  varying vec2 vHalf;
  varying vec3 vShape;
  varying float vFade;
  varying float vBlur;

  /** Where a clip-space point lands, in device pixels from the screen centre. */
  vec2 screenOf(vec4 clip) {
    return clip.xy / max(clip.w, 1e-4) * 0.5 * uViewport;
  }

  void main() {
    vec4 viewCentre = modelViewMatrix * vec4(aCentre, 1.0);
    vec4 clipCentre = projectionMatrix * viewCentre;

    float epoch = epochGain();
    if (epoch <= 0.0) {
      gl_Position = clipCentre;
      return;
    }

    vCorner = position.xy;

    // The three semi-axes carried into view space. Only the rotation applies:
    // they are offsets, not positions.
    mat3 rotation = mat3(modelViewMatrix);
    vec3 axisX = rotation * vec3(aSigma.x, 0.0, 0.0);
    vec3 axisY = rotation * vec3(0.0, aSigma.y, 0.0);
    vec3 axisZ = rotation * vec3(0.0, 0.0, aSigma.z);

    vec2 centre = screenOf(clipCentre);
    vec2 a = screenOf(projectionMatrix * (viewCentre + vec4(axisX, 0.0))) - centre;
    vec2 b = screenOf(projectionMatrix * (viewCentre + vec4(axisY, 0.0))) - centre;
    vec2 c = screenOf(projectionMatrix * (viewCentre + vec4(axisZ, 0.0))) - centre;

    // M = A * transpose(A) for the 2x3 matrix A = [a b c], which is the shape
    // matrix of the projected ellipse. Symmetric, so three numbers hold it, and
    // the fragment shader needs nothing else to know the whole outline.
    vShape = vec3(
      a.x * a.x + b.x * b.x + c.x * c.x,
      a.x * a.y + b.x * b.y + c.x * c.y,
      a.y * a.y + b.y * b.y + c.y * c.y
    );

    // The bounding box of that ellipse is exactly sqrt of the diagonal.
    vHalf = clamp(sqrt(max(vec2(vShape.x, vShape.z), vec2(0.0))), vec2(0.0), vec2(uMaxPx));

    // Too small to read as a shape at all. Fading rather than popping keeps the
    // far field calm, as the cluster layer does.
    float span = max(vHalf.x, vHalf.y);
    vFade = smoothstep(2.0, 6.0, span) * epoch;

    float defocus = dofDecades(viewCentre);
    float blurPx = dofBlurPx(defocus);
    vBlur = blurPx;
    vFade *= dofDim(defocus);

    // Grown by the blur so a softened edge has somewhere to go, in both axes.
    vec2 grown = vHalf + blurPx + 1.0;
    vHalf = grown;

    vec4 clip = clipCentre;
    clip.xy += position.xy * (2.0 * grown) * clipCentre.w / uViewport;
    gl_Position = clip;

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uRingPx;
  uniform float uDashes;

  varying vec2 vCorner;
  varying vec2 vHalf;
  varying vec3 vShape;
  varying float vFade;
  varying float vBlur;

  void main() {
    if (vFade <= 0.0) discard;

    // Where this fragment is, in device pixels from the ellipse's centre.
    vec2 p = vCorner * vHalf;

    // The quadratic form of the ellipse: q = 1 on the outline, less inside.
    // M inverse, written out for a symmetric 2x2.
    float det = vShape.x * vShape.z - vShape.y * vShape.y;
    // Seen exactly edge-on the ellipse collapses to a line and the form is
    // singular. A floor keeps that case a very thin ellipse instead of a
    // division by zero, which is what it looks like anyway.
    det = max(det, 1e-3);
    float q = (vShape.z * p.x * p.x - 2.0 * vShape.y * p.x * p.y + vShape.x * p.y * p.y) / det;
    if (q <= 0.0) discard;

    // Distance from the outline in pixels, near enough: one unit of sqrt(q) is
    // about the ellipse's mean semi-axis, so scaling by it converts.
    float scale = 0.5 * (vHalf.x + vHalf.y);
    float edge = (sqrt(q) - 1.0) * scale;

    float width = uRingPx * 0.5 + vBlur;
    float ring = 1.0 - smoothstep(width * 0.6, width, abs(edge));
    if (ring <= 0.0) discard;

    // Broken, because there is no edge here to draw solid. See the module note.
    float turn = fract(0.25 - atan(p.y, p.x) / (2.0 * PI));
    float dash = smoothstep(0.18, 0.34, abs(fract(turn * uDashes) - 0.5) * 2.0);
    ring *= dash;

    float alpha = ring * uOpacity * vFade;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(uColor, alpha);
  }
`;

export class AssociationField {
  readonly mesh: THREE.Mesh;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;
  private readonly yearAttribute: THREE.InstancedBufferAttribute;
  private readonly namedAttribute: THREE.InstancedBufferAttribute;
  private readonly yearsByBasis: Record<EpochBasis, Float32Array>;
  /** Instance slot by the name a timeline line would use for it. */
  private readonly byCatalogue = new Map<string, number>();

  constructor(data: AssociationData, fiction: FictionData | null = null) {
    this.count = data.count;

    const centres = new Float32Array(this.count * 3);
    const sigmas = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      const base = i * 7;
      centres[i * 3] = data.geometry[base];
      centres[i * 3 + 1] = data.geometry[base + 1];
      centres[i * 3 + 2] = data.geometry[base + 2];
      sigmas[i * 3] = data.geometry[base + 3];
      sigmas[i * 3 + 1] = data.geometry[base + 4];
      sigmas[i * 3 + 2] = data.geometry[base + 5];
    }

    const geometry = extentGeometry(this.count);
    geometry.setAttribute('aCentre', instanced(centres, 3));
    geometry.setAttribute('aSigma', instanced(sigmas, 3));

    // Real objects with no date of their own, so they take the undated state
    // along with the rest of the sky the setting never mentions — unless the
    // fiction has named one, in which case it is dated like any landmark.
    const epochPlaces = (basis: EpochBasis): EpochPlace[] =>
      Array.from({ length: this.count }, (_unused, index) => {
        const years = landmarkYears(fiction, 'association', index, basis);
        return { from: years.from, to: years.to, distancePc: 0 };
      });
    const attached = instancedEpochAttributes(geometry, epochPlaces('known'));
    this.yearAttribute = attached.years;
    this.namedAttribute = attached.named;
    this.yearsByBasis = {
      known: attached.yearsArray,
      settled: yearsArray(epochPlaces('settled')),
    };
    data.names.forEach((entry, index) => {
      this.byCatalogue.set(`cat:${entry.name}`, index);
      if (entry.alt_name) this.byCatalogue.set(`cat:${entry.alt_name}`, index);
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...extentUniforms(),
        ...dofUniforms(),
        ...epochUniforms(),
        uColor: { value: new THREE.Vector3(OUTLINE.r, OUTLINE.g, OUTLINE.b) },
        uOpacity: { value: DEFAULT_OPACITY },
        uRingPx: { value: RING_PX },
        uDashes: { value: DASHES },
        uMaxPx: { value: MAX_SIZE_PX },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    // Under the cluster rings: an association contains clusters, and the
    // smaller mark should not be buried by the larger one drawn over it.
    this.mesh.renderOrder = 0;
  }

  /** Device pixels, both axes: the corner offsets are computed in them. */
  setViewport(width: number, height: number): void {
    (this.material.uniforms.uViewport.value as THREE.Vector2).set(width, height);
  }

  /** Show the map as it stood in a year, or stop. See layers/epoch.ts. */
  setEpoch(year: number | null, showUndated = true): void {
    const uniforms = this.material.uniforms as unknown as EpochUniforms;
    uniforms.uEpochOn.value = year === null ? 0 : 1;
    uniforms.uUndatedGain.value = showUndated ? DEFAULT_UNDATED_GAIN : 0;
    if (year !== null) uniforms.uYear.value = year;
  }

  /** Which date decides when it appears: first known, or settled. */
  setEpochBasis(basis: EpochBasis): void {
    (this.yearAttribute.array as Float32Array).set(this.yearsByBasis[basis]);
    this.yearAttribute.needsUpdate = true;
  }

  /** Mark the associations a period's own history names; null clears it. */
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

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
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
