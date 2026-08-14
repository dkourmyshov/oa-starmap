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
 * The ring is **segmented** where a system is held by more than one polity, one
 * arc per holder. That is not a rare case dressed up: Cyberia is an encrypted
 * overlay network, so nearly everything it holds it shares, and Felicidade
 * belongs to four meta-empires at once. Drawing only the first would make a
 * shared system indistinguishable from a wholly owned one, and choosing which
 * holder to show would be a silent editorial decision repeated on every such
 * system.
 *
 * This layer covers every place a system can come from — an Inner Sphere colony
 * on a real star, a canonical world, a star of the Celestia add-on — because
 * "this system belongs to that polity" is one statement and should have one
 * appearance.
 *
 * The ring's continuity says how well the place is located, which is a second
 * thing said by the same mark without competing with the first: its colours are
 * who holds it. Three states, because the sources make three different claims.
 * **Solid** is a position. **Dashed** is an exact radius and a doubtful
 * direction, which is what a constellation gives. **Dotted** is neither exact —
 * the handful interpolated from the transcription of Anders Sandberg's maps,
 * where checking against places we hold puts the answer six hundred to nine
 * hundred light years out in both coordinates. "Somewhere along this line" and
 * "somewhere in this region" should not look alike. An earlier arrangement put that on a ring of the marker's own,
 * which landed a pixel inside this one and read as two rings meaning nothing in
 * particular. Only worlds are ever dashed — a catalogue star is exactly where
 * the catalogue says.
 */

import * as THREE from 'three';

import {
  type Colony,
  type FictionData,
  type OAStarData,
  type StarData,
  type WorldData,
  affiliationsFor,
} from '../data/manifest';

export const DEFAULT_OPACITY = 0.85;

/** Ring diameter in device pixels. */
export const DEFAULT_SIZE_PX = 13.0;

/** A settled system with no polity — abandoned, blight, independent. */
const STATUS_COLOR = new THREE.Color(0x9aa4bb);

/** How much fainter a ring is when no polity holds the system. */
export const UNAFFILIATED_DIM = 0.25;

/**
 * Most holders a ring can show separately.
 *
 * Four, because Felicidade has four and nothing recorded has more. A ring cut
 * into more arcs than this stops reading as segments at thirteen pixels across,
 * so beyond the limit the extra holders are left to the detail panel rather
 * than shown as a smear.
 */
export const MAX_SEGMENTS = 4;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aColor0;
  attribute vec3 aColor1;
  attribute vec3 aColor2;
  attribute vec3 aColor3;
  attribute float aSegments;
  attribute float aAffiliated;
  attribute float aApprox;
  attribute float aVague;

  uniform float uSize;
  uniform float uUnaffiliatedDim;

  varying vec3 vColor0;
  varying vec3 vColor1;
  varying vec3 vColor2;
  varying vec3 vColor3;
  varying float vSegments;
  varying float vGain;
  varying float vApprox;
  varying float vVague;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;
    vApprox = aApprox;
    vVague = aVague;
    vColor0 = aColor0;
    vColor1 = aColor1;
    vColor2 = aColor2;
    vColor3 = aColor3;
    vSegments = aSegments;
    vGain = mix(uUnaffiliatedDim, 1.0, aAffiliated);
    gl_PointSize = uSize;

    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;

  varying vec3 vColor0;
  varying vec3 vColor1;
  varying vec3 vColor2;
  varying vec3 vColor3;
  varying float vSegments;
  varying float vGain;
  varying float vApprox;
  varying float vVague;

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    float r = length(offset);
    if (r > 1.0) discard;

    // Thin, and hollow generously: the star this marks sits at the centre and
    // must stay visible through it.
    float ring = smoothstep(0.72, 0.82, r) * (1.0 - smoothstep(0.88, 0.98, r));
    if (ring <= 0.0) discard;

    float turnAround = fract(0.25 - atan(offset.y, offset.x) / (2.0 * PI));

    // Dashed where the source gave a region rather than a position. Twelve
    // arcs, which survives being cut again by a segment boundary: a ring that
    // is both shared and approximate still reads as both.
    float dash = smoothstep(0.28, 0.44, abs(fract(turnAround * 12.0) - 0.5) * 2.0);
    // Dotted where the radius is doubtful too: more arcs and a shorter mark, so
    // it reads as less certain than a dash rather than merely different.
    float dot = smoothstep(0.62, 0.78, abs(fract(turnAround * 30.0) - 0.5) * 2.0);
    ring *= mix(mix(1.0, dash, vApprox), dot, vVague);

    vec3 color = vColor0;
    if (vSegments > 1.5) {
      // Arcs run clockwise from the top, so a two-holder ring reads as left and
      // right halves rather than as an arbitrary tilt.
      float scaled = turnAround * vSegments;
      float index = floor(scaled);

      if (index > 2.5) color = vColor3;
      else if (index > 1.5) color = vColor2;
      else if (index > 0.5) color = vColor1;

      // A hairline gap at each join. Without it two similar hues merge into one
      // arc and the ring understates how many polities are present.
      float edge = min(fract(scaled), 1.0 - fract(scaled));
      ring *= smoothstep(0.0, 0.06, edge);
    }

    // A system with no named polity — independent, abandoned, or blighted — is
    // marked much more faintly. The ring is there to say which polity holds a
    // system, and those have no answer to give.
    float alpha = ring * uOpacity * vGain;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(color, alpha);
  }
`;

/** One ring to draw: where it goes, and who holds the system. */
interface Ring {
  x: number;
  y: number;
  z: number;
  polities: string[];
  /** The direction is only approximate, so the ring is drawn dashed. */
  approximate?: boolean;
  /** The radius is doubtful too, so the ring is drawn dotted instead. */
  vague?: boolean;
}

export class SettledField {
  readonly points: THREE.Points;
  readonly count: number;

  /** How many rings show more than one holder. */
  readonly sharedCount: number;

  private readonly material: THREE.ShaderMaterial;
  private readonly polityColors: Float32Array[];
  private readonly neutralColors: Float32Array[];
  private readonly colorAttributes: THREE.BufferAttribute[];

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

    const rings: Ring[] = [];
    const ringed = new Set<number>();

    for (const [starIndex, colony] of colonies) {
      if (starIndex < 0 || starIndex >= stars.count) continue;
      // A row without a colony name is a star the table happens to list, not a
      // system anyone has settled. Ringing all of them put a polity mark on 579
      // ordinary stars.
      if (!colony.colony) continue;
      const base = starIndex * 5;
      ringed.add(starIndex);
      rings.push({
        x: stars.positions[base],
        y: stars.positions[base + 1],
        z: stars.positions[base + 2],
        polities: affiliationsFor(colony, worlds?.byStar.get(starIndex)),
      });
    }

    // Worlds on stars the colony table does not name. A star carrying a
    // canonical world is as settled as one carrying a colony row, and was
    // getting no ring purely because it arrived in a different file.
    for (const [starIndex, here] of worlds?.byStar ?? []) {
      if (starIndex < 0 || starIndex >= stars.count || ringed.has(starIndex)) continue;
      const base = starIndex * 5;
      rings.push({
        x: stars.positions[base],
        y: stars.positions[base + 1],
        z: stars.positions[base + 2],
        polities: affiliationsFor(undefined, here),
      });
    }

    // Worlds placed from their own coordinates. Their marker says what kind of
    // thing they are and how well the source located them, which leaves no room
    // for a holder — and a marker can only be one colour anyway, so a shared
    // world showed only its first. Pelion and Ossa is held by two and drew as
    // one.
    for (const world of worlds?.worlds ?? []) {
      if (world.x === null || world.in_world) continue;
      rings.push({
        x: world.x,
        y: world.y as number,
        z: world.z as number,
        polities: affiliationsFor(undefined, [world]),
        approximate: (world.direction_error_deg ?? 0) > 0,
        vague: (world.distance_error_ly ?? 0) > 0,
      });
    }

    for (let i = 0; i < (oaStars?.count ?? 0); i++) {
      const entry = oaStars!.names[i];
      if (entry?.hidden) continue;
      const base = i * 5;
      const bound = entry ? worlds?.byOAStar.get(entry.name) : undefined;
      const polities = affiliationsFor(undefined, bound);
      if (entry?.affiliation && !polities.includes(entry.affiliation)) {
        polities.push(entry.affiliation);
      }
      rings.push({
        x: oaStars!.positions[base],
        y: oaStars!.positions[base + 1],
        z: oaStars!.positions[base + 2],
        polities,
      });
    }

    this.count = rings.length;
    this.sharedCount = rings.filter((ring) => ring.polities.length > 1).length;

    const positions = new Float32Array(this.count * 3);
    const segments = new Float32Array(this.count);
    const affiliated = new Float32Array(this.count);
    const approximate = new Float32Array(this.count);
    const vague = new Float32Array(this.count);
    const colors = Array.from({ length: MAX_SEGMENTS }, () => new Float32Array(this.count * 3));
    const neutral = Array.from({ length: MAX_SEGMENTS }, () => new Float32Array(this.count * 3));

    rings.forEach((ring, out) => {
      positions[out * 3] = ring.x;
      positions[out * 3 + 1] = ring.y;
      positions[out * 3 + 2] = ring.z;

      const shown = ring.polities.slice(0, MAX_SEGMENTS);
      affiliated[out] = shown.length ? 1 : 0;
      approximate[out] = ring.approximate ? 1 : 0;
      vague[out] = ring.vague ? 1 : 0;
      segments[out] = Math.max(shown.length, 1);

      for (let slot = 0; slot < MAX_SEGMENTS; slot++) {
        // Slots past the holder count are never sampled, but are filled with
        // the last real colour so a rounding error at an arc boundary cannot
        // show black.
        const id = shown[Math.min(slot, Math.max(shown.length - 1, 0))] ?? '';
        const chosen = polityColor.get(id) ?? STATUS_COLOR;
        colors[slot][out * 3] = chosen.r;
        colors[slot][out * 3 + 1] = chosen.g;
        colors[slot][out * 3 + 2] = chosen.b;
        neutral[slot][out * 3] = STATUS_COLOR.r;
        neutral[slot][out * 3 + 1] = STATUS_COLOR.g;
        neutral[slot][out * 3 + 2] = STATUS_COLOR.b;
      }
    });

    this.polityColors = colors.map((array) => array.slice());
    this.neutralColors = neutral;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSegments', new THREE.BufferAttribute(segments, 1));
    geometry.setAttribute('aAffiliated', new THREE.BufferAttribute(affiliated, 1));
    geometry.setAttribute('aApprox', new THREE.BufferAttribute(approximate, 1));
    geometry.setAttribute('aVague', new THREE.BufferAttribute(vague, 1));
    this.colorAttributes = colors.map((array, slot) => {
      const attribute = new THREE.BufferAttribute(array, 3);
      geometry.setAttribute(`aColor${slot}`, attribute);
      return attribute;
    });
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

  /**
   * Colour the rings by polity, or drop them all to neutral.
   *
   * With polity mode off the ring stays, because "settled" is a fact about the
   * system independent of who holds it; only the answer to *whose* goes away.
   */
  setPolityMode(enabled: boolean): void {
    const source = enabled ? this.polityColors : this.neutralColors;
    this.colorAttributes.forEach((attribute, slot) => {
      (attribute.array as Float32Array).set(source[slot]);
      attribute.needsUpdate = true;
    });
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
