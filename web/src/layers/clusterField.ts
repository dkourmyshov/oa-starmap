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

  attribute float aRadius;
  attribute vec3 aColor;
  attribute vec3 aColorB;
  attribute float aShared;
  attribute float aAssigned;

  uniform float uViewportHeight;
  ${DOF_PARS}
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

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;

    float dist = max(length(viewPos.xyz), 1e-4);

    // Projected diameter in device pixels for a sphere of physical radius aRadius.
    // projectionMatrix[1][1] is 1/tan(fov/2), so this is the true angular size.
    float projected = aRadius * projectionMatrix[1][1] * uViewportHeight / dist;

    // Below the minimum a cluster would vanish; clamping keeps distant ones as
    // small marks. Fade them instead of popping so the far field stays calm.
    // Depth of field. The sprite grows to make room and the fragment scales its
    // coordinate back, so the outline keeps the angular size it is there to
    // report and only its edge softens. vSize stays the unblurred size, because
    // the ring's thickness is derived from it and a hairline must not thin just
    // because the thing is out of focus.
    vFade = smoothstep(0.35, 1.6, projected);
    float base = clamp(projected, uMinSize, uMaxSize);
    float blurPx = dofBlurPx(dist);
    float grown = base + 2.0 * blurPx;
    vScale = grown / base;
    vBlur = min(blurPx / max(base * 0.5, 1e-4), 0.5);
    vFade *= dofGain(base, grown);
    gl_PointSize = grown;
    vSize = base;

    vColor = aColor;
    vColorB = aColorB;
    vShared = aShared;

    // Clusters carrying an Orion's Arm association are the ones being navigated
    // by, so the other ~7000 recede rather than competing with them.
    vGain = mix(uUnassignedDim, 1.0, aAssigned);

    // Orion's Arm-only mode: keep just what the setting has claimed.
    if (uOnlyOA > 0.5 && aAssigned < 0.5) {
      gl_PointSize = 0.0;
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

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
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
  readonly points: THREE.Points;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;
  private readonly typeColors: Float32Array;
  private readonly polityColorArray: Float32Array;
  private readonly colorAttribute: THREE.BufferAttribute;

  constructor(data: ClusterData, fiction: FictionData | null = null) {
    this.count = data.count;

    // Polity colours, indexed 1-based to match the packed byte array.
    const polityColors: (THREE.Color | undefined)[] = [];
    for (const polity of fiction?.polities ?? []) {
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
      const second = holders && holders.length > 1 ? polityColors[holders[1]] : undefined;
      shared[i] = second ? 1 : 0;
      const other = second ?? chosen;
      secondColors[i * 3] = other.r;
      secondColors[i * 3 + 1] = other.g;
      secondColors[i * 3 + 2] = other.b;
    }

    this.typeColors = typeColors;
    this.polityColorArray = colors.slice();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aColorB', new THREE.BufferAttribute(secondColors, 3));
    geometry.setAttribute('aShared', new THREE.BufferAttribute(shared, 1));
    geometry.setAttribute('aAssigned', new THREE.BufferAttribute(assigned, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.colorAttribute = geometry.getAttribute('aColor') as THREE.BufferAttribute;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uViewportHeight: { value: 1080 },
        ...dofUniforms(),
        uMinSize: { value: 3.0 },
        uMaxSize: { value: 3000.0 },
        uOpacity: { value: DEFAULT_OPACITY },
        uRingWidthPx: { value: 1.6 },
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

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  setViewportHeight(pixels: number): void {
    this.material.uniforms.uViewportHeight.value = pixels;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
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
