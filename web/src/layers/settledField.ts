/**
 * Polity rings around settled systems.
 *
 * Replaces an earlier attempt that recoloured the star itself, which was hard to
 * see: a polity colour is one more hue among thousands of real spectral ones,
 * with nothing to distinguish it as a different kind of statement.
 *
 * A ring is legible because it is a different shape, not a different colour. The
 * star keeps the colour the catalogue measured; the polity is a mark drawn
 * around it, at constant screen size so it stays readable at any distance.
 */

import * as THREE from 'three';

import type { Colony, FictionData, StarData } from '../data/manifest';

export const DEFAULT_OPACITY = 0.85;

/** Ring diameter in device pixels. */
export const DEFAULT_SIZE_PX = 13.0;

/** A settled system with no polity — abandoned, blight, independent. */
const STATUS_COLOR = new THREE.Color(0x9aa4bb);

/** How much fainter a ring is when no polity holds the system. */
export const UNAFFILIATED_DIM = 0.25;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aColor;
  attribute float aAffiliated;

  uniform float uSize;
  uniform float uUnaffiliatedDim;

  varying vec3 vColor;
  varying float vGain;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;
    vColor = aColor;
    vGain = mix(uUnaffiliatedDim, 1.0, aAffiliated);
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

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    float r = length(offset);
    if (r > 1.0) discard;

    // Thin, and hollow generously: the star this marks sits at the centre and
    // must stay visible through it.
    float ring = smoothstep(0.72, 0.82, r) * (1.0 - smoothstep(0.88, 0.98, r));

    // A system with no named polity — independent, abandoned, blighted, or
    // shared among several — is marked much more faintly. The ring is there to
    // say which polity holds a system, and those have no answer to give.
    float alpha = ring * uOpacity * vGain;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class SettledField {
  readonly points: THREE.Points;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;

  constructor(stars: StarData, colonies: Map<number, Colony>, fiction: FictionData | null) {
    const polityColor = new Map<string, THREE.Color>();
    for (const polity of fiction?.polities ?? []) {
      polityColor.set(polity.id, new THREE.Color(polity.color));
    }

    const indices = [...colonies.keys()].filter((i) => i >= 0 && i < stars.count);
    this.count = indices.length;

    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    const affiliated = new Float32Array(this.count);

    indices.forEach((starIndex, out) => {
      const base = starIndex * 5;
      positions[out * 3] = stars.positions[base];
      positions[out * 3 + 1] = stars.positions[base + 1];
      positions[out * 3 + 2] = stars.positions[base + 2];

      const colony = colonies.get(starIndex);
      affiliated[out] = colony?.affiliations.length ? 1 : 0;
      const chosen = polityColor.get(colony?.affiliations[0] ?? '') ?? STATUS_COLOR;
      colors[out * 3] = chosen.r;
      colors[out * 3 + 1] = chosen.g;
      colors[out * 3 + 2] = chosen.b;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aAffiliated', new THREE.BufferAttribute(affiliated, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: DEFAULT_SIZE_PX },
        uOpacity: { value: DEFAULT_OPACITY },
        uUnaffiliatedDim: { value: UNAFFILIATED_DIM },
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
    this.points.renderOrder = 1;
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
