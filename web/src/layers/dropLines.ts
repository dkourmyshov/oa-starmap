/**
 * A line from every claimed system down to the galactic plane.
 *
 * The oldest fix for the oldest problem with a 3D scatter plot: on a flat
 * screen a point has two coordinates and the third is a guess. Two systems a
 * hundred parsecs apart in z land on the same pixel, and nothing in a
 * perspective projection tells you which is nearer — a dot is a dot. Dropping a
 * thread from each one to z = 0 gives the eye the missing coordinate twice
 * over: the foot of the line says where the system is *in the plane*, and the
 * length of it says how far above or below.
 *
 * It works because the plane is real here. This is not an arbitrary reference
 * surface chosen to hang lines from; it is the galactic plane, the map's own
 * z = 0, the sheet the borrowed sky maps lie on and the grid measures out. A
 * line to it is a statement about galactic latitude, not a drawing aid.
 *
 * **North and south are told apart.** A system above the plane gets a slightly
 * warmer line than one below it, because the sign is the half of the
 * information a length alone throws away, and from most angles you cannot see
 * which end of the thread the plane is at.
 *
 * The list comes from the ring layer rather than being rebuilt: that class is
 * the one place the setting's systems are gathered from all five files that
 * hold them, and walking those files twice would be two chances to disagree
 * about which places exist. It follows the same epoch, for the same reason —
 * a thread hanging under a colony three centuries before anyone reached it
 * would be the last thing on screen still asserting it.
 */

import * as THREE from 'three';

import { type EpochBasis } from '../data/history';
import {
  DEFAULT_UNDATED_GAIN,
  EPOCH_PARS,
  type EpochUniforms,
  epochUniforms,
} from './epoch';

/** Faint by default. A guide should not out-draw the thing it guides to. */
export const DEFAULT_OPACITY = 0.28;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  ${EPOCH_PARS}

  // 0 at the system, 1 at the plane. The line fades along its own length.
  attribute float aFoot;
  // +1 above the galactic plane, -1 below it.
  attribute float aSide;

  varying float vFade;
  varying float vSide;

  void main() {
    float epoch = epochGain();
    if (epoch <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vSide = aSide;
    // Strongest where it leaves the system and gone by the time it lands, so
    // the thread reads as hanging from the marker rather than as a stick the
    // marker is mounted on. The floor keeps the foot visible enough to locate
    // in the plane, which is half of what the line is for.
    vFade = mix(1.0, 0.25, aFoot) * epoch;

    vec3 world = position;
    // The foot of the line is the system's own x and y, at z = 0. Computed
    // here rather than stored so the two ends cannot drift apart.
    world.z = mix(position.z, 0.0, aFoot);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uNorth;
  uniform vec3 uSouth;
  uniform float uOpacity;

  varying float vFade;
  varying float vSide;

  void main() {
    float alpha = uOpacity * vFade;
    if (alpha < 0.004) discard;
    #include <logdepthbuf_fragment>
    // Which side of the plane, in the one channel a hairline has to spare.
    gl_FragColor = vec4(mix(uSouth, uNorth, step(0.0, vSide)), alpha);
  }
`;

export interface Placements {
  /** Interleaved xyz per system, in parsecs. */
  positions: Float32Array;
  /** Interleaved [from, to] per system, under each basis. */
  known: Float32Array;
  settled: Float32Array;
}

export class DropLines {
  readonly lines: THREE.LineSegments;
  readonly count: number;

  private readonly material: THREE.ShaderMaterial;
  private readonly yearAttribute: THREE.BufferAttribute;
  private readonly yearsByBasis: Record<EpochBasis, Float32Array>;

  constructor(placements: Placements) {
    this.count = Math.floor(placements.positions.length / 3);

    // Two vertices a system: one at the system, one at its foot. Both carry the
    // system's own position, and the shader flattens the second — see aFoot.
    const positions = new Float32Array(this.count * 6);
    const foot = new Float32Array(this.count * 2);
    const side = new Float32Array(this.count * 2);
    // The epoch attributes are per vertex here rather than per instance, since
    // this is plain geometry: both ends of a line share one system's years.
    const years = new Float32Array(this.count * 4);
    const settledYears = new Float32Array(this.count * 4);
    const named = new Float32Array(this.count * 2).fill(1);

    for (let i = 0; i < this.count; i++) {
      const x = placements.positions[i * 3];
      const y = placements.positions[i * 3 + 1];
      const z = placements.positions[i * 3 + 2];
      positions.set([x, y, z, x, y, z], i * 6);
      foot[i * 2] = 0;
      foot[i * 2 + 1] = 1;
      const above = z >= 0 ? 1 : -1;
      side[i * 2] = above;
      side[i * 2 + 1] = above;
      for (const [source, target] of [
        [placements.known, years],
        [placements.settled, settledYears],
      ] as const) {
        const from = source[i * 2];
        const to = source[i * 2 + 1];
        target.set([from, to, from, to], i * 4);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aFoot', new THREE.BufferAttribute(foot, 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.yearAttribute = new THREE.BufferAttribute(years.slice(), 2);
    geometry.setAttribute('aYears', this.yearAttribute);
    geometry.setAttribute('aNamed', new THREE.BufferAttribute(named, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.yearsByBasis = { known: years, settled: settledYears };

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...epochUniforms(),
        uNorth: { value: new THREE.Vector3(0.55, 0.66, 0.86) },
        uSouth: { value: new THREE.Vector3(0.44, 0.5, 0.7) },
        uOpacity: { value: DEFAULT_OPACITY },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    this.lines = new THREE.LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    // Under the rings and markers it hangs from, over the grid it lands on.
    this.lines.renderOrder = -1;
    this.lines.visible = false;
  }

  /** Show the map as it stood in a year, or stop. See layers/epoch.ts. */
  setEpoch(year: number | null, showUndated = true): void {
    const uniforms = this.material.uniforms as unknown as EpochUniforms;
    uniforms.uEpochOn.value = year === null ? 0 : 1;
    uniforms.uUndatedGain.value = showUndated ? DEFAULT_UNDATED_GAIN : 0;
    if (year !== null) uniforms.uYear.value = year;
  }

  /** Which date decides when a line appears: first known, or settled. */
  setEpochBasis(basis: EpochBasis): void {
    (this.yearAttribute.array as Float32Array).set(this.yearsByBasis[basis]);
    this.yearAttribute.needsUpdate = true;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
  }

  set visible(value: boolean) {
    this.lines.visible = value;
  }

  get visible(): boolean {
    return this.lines.visible;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}
