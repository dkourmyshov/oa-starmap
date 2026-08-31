/**
 * A coordinate grid in the galactic plane, centred on Sol.
 *
 * Four rays along the cardinal galactic directions and a set of distance
 * circles, and between them the two things a reader cannot get from the objects
 * alone: which way they are looking, and how far across the view is.
 *
 * **The directions are the frame, not decoration.** Coreward is +x and galactic
 * longitude zero; spinward is +y and l = 90°, the way the disc turns; rimward
 * and counterspinward are their opposites. Those are the words Orion's Arm uses
 * for its own geography, and the whole map is built on that axis convention —
 * naming it on screen is the difference between a reader trusting the map's
 * orientation and taking it on faith.
 *
 * **The circles follow the unit toggle**, because a scale bar in the wrong unit
 * is worse than none: someone reading 500 off a ring and thinking parsecs when
 * the map means light years is out by a factor of three. The step is chosen in
 * whichever unit is displayed, so the rings always land on round numbers of the
 * unit written beside them.
 *
 * **The spacing adapts.** A fixed set of rings is either invisible zoomed in or
 * a solid disc zoomed out, so the step is picked from a 1-2-5 ladder to put a
 * handful of rings across the view at any scale. Zoomed out that is the
 * thousands the request asked for; zoomed into the Inner Sphere it is tens, and
 * refusing to go below a hundred there would have meant a grid with nothing on
 * it exactly where the map is densest.
 *
 * No depth of field. Like the borrowed sky maps this is the sheet the map is
 * drawn on rather than an object in it, and a blurred ruler is not a ruler.
 */

import * as THREE from 'three';

import { type DistanceUnit, type Parsecs, PC_TO_LY, lyToPc, pc } from '../units';

/** Segments per circle. Enough that the largest ring has no visible corners. */
const CIRCLE_SEGMENTS = 240;

/** How many rings to try to fit across the half-height of the view. */
const RINGS_ACROSS = 3.2;

export const DEFAULT_OPACITY = 0.4;

/**
 * The 1-2-5 ladder, in the displayed unit.
 *
 * The steps a ruler is allowed to use. Anything else — a 3, a 7, a 250 — makes
 * a reader do arithmetic to know which ring they are on, which is the one thing
 * a scale is for.
 */
const LADDER = [1, 2, 5];

/**
 * The step between rings, in the displayed unit, for a view this big.
 *
 * Exported and pure because it is the whole of the grid's behaviour and the
 * only part worth testing: everything else is geometry that either draws or
 * does not.
 */
export function ringStep(halfHeight: number): number {
  if (!(halfHeight > 0)) return 0;
  const target = halfHeight / RINGS_ACROSS;
  const decade = 10 ** Math.floor(Math.log10(target));
  for (const rung of LADDER) {
    if (rung * decade >= target) return rung * decade;
  }
  return 10 * decade;
}

/** Every ring to draw, in the displayed unit, nearest first. */
export function ringRadii(halfHeight: number, furthest: number): number[] {
  const step = ringStep(halfHeight);
  if (step <= 0) return [];
  const out: number[] = [];
  // Multiplied, not accumulated. Repeated addition of a step like 0.2 drifts,
  // and these numbers are not internal — they are printed on the rings.
  for (let n = 1; n <= MAX_RINGS; n++) {
    const radius = step * n;
    if (radius > furthest) break;
    out.push(radius);
  }
  return out;
}

/**
 * Most rings drawn at once.
 *
 * The step keeps this near four in the ordinary case; the cap is for the moment
 * after a jump, when the camera is still travelling and the half-height it is
 * asked about belongs to somewhere else entirely.
 */
const MAX_RINGS = 12;

/**
 * Just above the borrowed sky maps at -10, and below everything else.
 *
 * Both are the paper rather than the map: a poster is somebody's picture of
 * this volume and the grid is the ruler laid over it, and neither should ever
 * be drawn on top of an object the map is actually asserting.
 */
const GRID_RENDER_ORDER = -9;

/** How far out the rings and rays are allowed to reach, in parsecs. */
const OUTER_LIMIT_PC = 3e4;

/** The four directions, in the map's own frame. */
export const CARDINALS: { label: string; short: string; x: number; y: number }[] = [
  { label: 'coreward', short: 'core', x: 1, y: 0 },
  { label: 'spinward', short: 'spin', x: 0, y: 1 },
  { label: 'rimward', short: 'rim', x: -1, y: 0 },
  { label: 'counterspinward', short: 'trail', x: 0, y: -1 },
];

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  // Per instance: the ring's radius in parsecs, and how strongly to draw it.
  attribute float aRadius;
  attribute float aWeight;

  varying float vWeight;

  void main() {
    vWeight = aWeight;
    vec3 world = position * aRadius;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uColor;
  uniform float uOpacity;

  varying float vWeight;

  void main() {
    float alpha = uOpacity * vWeight;
    if (alpha < 0.004) discard;
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** A unit circle in the z = 0 plane, as a closed run of line segments. */
function unitCircle(): Float32Array {
  const points = new Float32Array(CIRCLE_SEGMENTS * 2 * 3);
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    const b = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
    points.set([Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0], i * 6);
  }
  return points;
}

/** The four rays, as unit segments from Sol outwards. */
function cardinalRays(): Float32Array {
  const points = new Float32Array(CARDINALS.length * 2 * 3);
  CARDINALS.forEach((direction, i) => {
    points.set([0, 0, 0, direction.x, direction.y, 0], i * 6);
  });
  return points;
}

export class PlaneGrid {
  readonly group: THREE.Group;

  private readonly rings: THREE.LineSegments;
  private readonly rays: THREE.LineSegments;
  private readonly ringMaterial: THREE.ShaderMaterial;
  private readonly rayMaterial: THREE.ShaderMaterial;
  private readonly radii: THREE.InstancedBufferAttribute;
  private readonly weights: THREE.InstancedBufferAttribute;
  private readonly rayRadius: THREE.InstancedBufferAttribute;

  /** The rings currently drawn, in the displayed unit — what the labels name. */
  private shown: number[] = [];
  private unit: DistanceUnit = 'ly';

  constructor() {
    this.group = new THREE.Group();

    const ringGeometry = new THREE.InstancedBufferGeometry();
    ringGeometry.setAttribute('position', new THREE.BufferAttribute(unitCircle(), 3));
    this.radii = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS), 1);
    this.weights = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS), 1);
    ringGeometry.setAttribute('aRadius', this.radii);
    ringGeometry.setAttribute('aWeight', this.weights);
    ringGeometry.instanceCount = 0;
    ringGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.ringMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Vector3(0.42, 0.55, 0.78) },
        uOpacity: { value: DEFAULT_OPACITY },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    this.rings = new THREE.LineSegments(ringGeometry, this.ringMaterial);
    this.rings.frustumCulled = false;
    // Set on the meshes, not on the group that holds them: three.js sorts each
    // object by its own renderOrder and does not inherit one from a parent, so
    // a number on the Group would have left the grid drawing at zero — over the
    // sky map it is supposed to lie on.
    this.rings.renderOrder = GRID_RENDER_ORDER;
    this.group.add(this.rings);

    const rayGeometry = new THREE.InstancedBufferGeometry();
    rayGeometry.setAttribute('position', new THREE.BufferAttribute(cardinalRays(), 3));
    // One instance: the rays share a length, which is the outer ring's.
    this.rayRadius = new THREE.InstancedBufferAttribute(new Float32Array([0]), 1);
    rayGeometry.setAttribute('aRadius', this.rayRadius);
    rayGeometry.setAttribute('aWeight', new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
    rayGeometry.instanceCount = 1;
    rayGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.rayMaterial = this.ringMaterial.clone();
    this.rays = new THREE.LineSegments(rayGeometry, this.rayMaterial);
    this.rays.frustumCulled = false;
    this.rays.renderOrder = GRID_RENDER_ORDER;
    this.group.add(this.rays);
  }

  /**
   * Re-space the grid for the view it is being seen at.
   *
   * Called every frame, and cheap when nothing has changed: the step is a
   * couple of logarithms and the attributes are rewritten only when the answer
   * differs from what is already drawn.
   */
  update(halfHeight: Parsecs, unit: DistanceUnit): void {
    if (!this.group.visible) return;

    // The step is chosen in the unit on screen, so the rings land on round
    // numbers of whatever the labels are about to say.
    const perUnit = unit === 'ly' ? PC_TO_LY : 1;
    const halfInUnit = (halfHeight as number) * perUnit;
    const furthest = OUTER_LIMIT_PC * perUnit;
    const radii = ringRadii(halfInUnit, furthest);

    const same =
      this.unit === unit &&
      radii.length === this.shown.length &&
      radii.every((radius, i) => radius === this.shown[i]);
    if (same) return;

    this.unit = unit;
    this.shown = radii;

    const radiusArray = this.radii.array as Float32Array;
    const weightArray = this.weights.array as Float32Array;
    radii.forEach((radius, i) => {
      radiusArray[i] = unit === 'ly' ? (lyToPc(radius as never) as number) : radius;
      // Every fifth ring heavier, so a reader counting outwards has something
      // to count. With a 1-2-5 step that lands on the round decade.
      weightArray[i] = (i + 1) % 5 === 0 ? 1 : 0.5;
    });
    this.radii.needsUpdate = true;
    this.weights.needsUpdate = true;
    (this.rings.geometry as THREE.InstancedBufferGeometry).instanceCount = radii.length;

    // The rays reach one step past the outermost ring, so the frame always
    // encloses the scale rather than stopping short of it.
    const outer = radii.length ? radiusArray[radii.length - 1] : 0;
    const step = radii.length > 1 ? radiusArray[1] - radiusArray[0] : outer;
    (this.rayRadius.array as Float32Array)[0] = outer + step;
    this.rayRadius.needsUpdate = true;
  }

  /** The rings currently drawn, in the displayed unit. Nearest first. */
  get radiiInUnit(): number[] {
    return this.shown;
  }

  /** How far the rays reach, in parsecs — where the direction labels go. */
  get reachPc(): Parsecs {
    return pc((this.rayRadius.array as Float32Array)[0]);
  }

  set opacity(value: number) {
    this.ringMaterial.uniforms.uOpacity.value = value;
    this.rayMaterial.uniforms.uOpacity.value = value;
  }

  set visible(value: boolean) {
    this.group.visible = value;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  dispose(): void {
    this.rings.geometry.dispose();
    this.rays.geometry.dispose();
    this.ringMaterial.dispose();
    this.rayMaterial.dispose();
  }
}
