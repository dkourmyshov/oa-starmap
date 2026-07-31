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

export const DEFAULT_OPACITY = 0.45;

/** H-alpha. Emission nebulae are red because that is the line they shine in. */
const EMISSION_COLOR = new THREE.Color(0xff5566);

/** Matches `layout.methods.order` in the manifest. */
const METHOD_KINEMATIC = 1;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute float aRadius;
  attribute vec3 aColor;
  attribute float aKinematic;
  attribute float aAssigned;

  uniform float uViewportHeight;
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uShowKinematic;
  uniform float uUnassignedDim;

  varying vec3 vColor;
  varying float vFade;
  varying float vSize;
  varying float vGain;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;

    float dist = max(length(viewPos.xyz), 1e-4);
    float projected = aRadius * projectionMatrix[1][1] * uViewportHeight / dist;

    vFade = smoothstep(0.4, 2.0, projected);
    gl_PointSize = clamp(projected, uMinSize, uMaxSize);
    vSize = gl_PointSize;
    vColor = aColor;

    vGain = mix(uUnassignedDim, 1.0, aAssigned);

    // Culling in the vertex stage: collapsing the point to zero size is the
    // cheapest way to remove it without rebuilding the buffers.
    if (aKinematic > 0.5 && uShowKinematic < 0.5) {
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

  varying vec3 vColor;
  varying float vFade;
  varying float vSize;
  varying float vGain;

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
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
  readonly points: THREE.Points;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;
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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aKinematic', new THREE.BufferAttribute(kinematic, 1));
    geometry.setAttribute('aAssigned', new THREE.BufferAttribute(assigned, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.colorAttribute = geometry.getAttribute('aColor') as THREE.BufferAttribute;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uViewportHeight: { value: 1080 },
        uMinSize: { value: 2.0 },
        uMaxSize: { value: 4000.0 },
        uOpacity: { value: DEFAULT_OPACITY },
        uShowKinematic: { value: 1.0 },
        uUnassignedDim: { value: 1.0 },
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

  setViewportHeight(pixels: number): void {
    this.material.uniforms.uViewportHeight.value = pixels;
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
