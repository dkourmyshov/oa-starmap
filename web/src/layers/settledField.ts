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
 *
 * This layer covers both places a system can come from — an Inner Sphere colony
 * on a real star, and a star of the Celestia add-on — because "this system
 * belongs to that polity" is one statement and should have one appearance. The
 * two differ in whether their position was measured, and that is carried by the
 * glyph at the centre, not by the ring.
 */

import * as THREE from 'three';

import type { Colony, FictionData, OAStarData, StarData, WorldData } from '../data/manifest';

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
  private readonly polityColors: Float32Array;
  private readonly neutralColors: Float32Array;
  private readonly colorAttribute: THREE.BufferAttribute;

  constructor(
    stars: StarData,
    colonies: Map<number, Colony>,
    fiction: FictionData | null,
    oaStars: OAStarData | null = null,
    worlds: WorldData | null = null,
  ) {
    const polityColor = new Map<string, THREE.Color>();
    for (const polity of fiction?.polities ?? []) {
      polityColor.set(polity.id, new THREE.Color(polity.color));
    }

    // One ring per settled system, from whichever source knows about it. Hidden
    // add-on entries are skipped for the same reason the marker layer skips
    // them: nothing is drawn there to ring.
    const rings: { x: number; y: number; z: number; polity: string }[] = [];
    for (const [starIndex, colony] of colonies) {
      if (starIndex < 0 || starIndex >= stars.count) continue;
      // A row without a colony name is a star the table happens to list, not a
      // system anyone has settled. Ringing all 891 rows put a polity mark on
      // 579 ordinary stars.
      if (!colony.colony) continue;
      const base = starIndex * 5;
      rings.push({
        x: stars.positions[base],
        y: stars.positions[base + 1],
        z: stars.positions[base + 2],
        polity: colonies.get(starIndex)?.affiliations[0] ?? '',
      });
    }
    // A star carrying a canonical world is as settled as one carrying a colony
    // row, and was getting no ring purely because it arrived in a different
    // file. Skipped where a colony already put a ring there.
    for (const [starIndex, here] of worlds?.byStar ?? []) {
      if (starIndex < 0 || starIndex >= stars.count || colonies.has(starIndex)) continue;
      const base = starIndex * 5;
      rings.push({
        x: stars.positions[base],
        y: stars.positions[base + 1],
        z: stars.positions[base + 2],
        polity: here[0]?.affiliation ?? '',
      });
    }
    for (let i = 0; i < (oaStars?.count ?? 0); i++) {
      const entry = oaStars!.names[i];
      if (entry?.hidden) continue;
      const base = i * 5;
      rings.push({
        x: oaStars!.positions[base],
        y: oaStars!.positions[base + 1],
        z: oaStars!.positions[base + 2],
        polity: entry?.affiliation ?? '',
      });
    }
    this.count = rings.length;

    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    const neutral = new Float32Array(this.count * 3);
    const affiliated = new Float32Array(this.count);

    rings.forEach((ring, out) => {
      positions[out * 3] = ring.x;
      positions[out * 3 + 1] = ring.y;
      positions[out * 3 + 2] = ring.z;

      affiliated[out] = ring.polity ? 1 : 0;
      const chosen = polityColor.get(ring.polity) ?? STATUS_COLOR;
      colors[out * 3] = chosen.r;
      colors[out * 3 + 1] = chosen.g;
      colors[out * 3 + 2] = chosen.b;
      neutral[out * 3] = STATUS_COLOR.r;
      neutral[out * 3 + 1] = STATUS_COLOR.g;
      neutral[out * 3 + 2] = STATUS_COLOR.b;
    });

    this.polityColors = colors.slice();
    this.neutralColors = neutral;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aAffiliated', new THREE.BufferAttribute(affiliated, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.colorAttribute = geometry.getAttribute('aColor') as THREE.BufferAttribute;

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

  /**
   * Colour the rings by polity, or drop them all to neutral.
   *
   * With polity mode off the ring stays, because "settled" is a fact about the
   * system independent of who holds it; only the answer to *whose* goes away.
   */
  setPolityMode(enabled: boolean): void {
    const source = enabled ? this.polityColors : this.neutralColors;
    (this.colorAttribute.array as Float32Array).set(source);
    this.colorAttribute.needsUpdate = true;
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
