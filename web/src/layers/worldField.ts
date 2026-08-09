/**
 * Canonical Orion's Arm worlds, and how well the setting locates them.
 *
 * Only the worlds that carry their own coordinates are drawn here. One bound to
 * a catalogue star or to an add-on star is already on the map as that star, and
 * drawing it again would put two objects where the fiction describes one.
 *
 * The layer's real job is the second mark. Orion's Arm locates most places the
 * way an observer would — a distance and a constellation — which fixes the
 * radius exactly and the direction only to the width of the constellation. At
 * Hyvixnym's 3,876 ly, Taurus is 1,800 ly across. Drawing a dot at the
 * constellation's centre and stopping there would state a position twelve
 * hundred light years more precisely than the source does, so every such world
 * gets a circle at its true angular error: the dot says where the centre of the
 * region is, and the circle says how much of the sky the source actually
 * allowed. Worlds given exact coordinates get no circle, because for them there
 * is nothing to admit.
 *
 * The circle is drawn at a true angular size, like the cluster and HII layers,
 * rather than at a constant screen size like the markers. That is the point of
 * it: an uncertainty that did not grow as you flew toward it would not be one.
 */

import * as THREE from 'three';

import type { FictionData, WorldData } from '../data/manifest';

export const DEFAULT_OPACITY = 0.9;

/** Marker diameter in device pixels. */
export const DEFAULT_SIZE_PX = 11.0;

/** A world with no polity, or one whose affiliation is unsettled. */
const NEUTRAL = new THREE.Color(0x9aa4bb);

/**
 * Ceiling on the uncertainty circle's on-screen radius, in pixels.
 *
 * Without it, flying inside a 1,800 ly region fills the viewport with a single
 * outline and the map becomes unreadable. Clamping distorts the very quantity
 * the circle exists to report, so it is set high enough that it only ever bites
 * when the camera is already inside the region — at which point the circle has
 * stopped being informative anyway.
 */
export const MAX_CIRCLE_PX = 900.0;

const MARKER_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aColor;

  uniform float uSize;

  varying vec3 vColor;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;
    vColor = aColor;
    gl_PointSize = uSize;

    #include <logdepthbuf_vertex>
  }
`;

const MARKER_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;

  varying vec3 vColor;

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    float r = length(offset);
    if (r > 1.0) discard;

    // A filled centre inside a ring: a place, not a star. The ring keeps it
    // legible against the diamonds of the add-on stars, which are hollow.
    float core = 1.0 - smoothstep(0.0, 0.34, r);
    float ring = smoothstep(0.54, 0.66, r) * (1.0 - smoothstep(0.80, 0.94, r));

    float alpha = clamp(core + ring, 0.0, 1.0) * uOpacity;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(vColor, alpha);
  }
`;

const CIRCLE_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aColor;
  attribute float aRadius;

  uniform float uViewportHeight;
  uniform float uMaxPx;

  varying vec3 vColor;
  varying float vFade;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;
    vColor = aColor;

    // The same angular-size projection the volumetric layers use: a physical
    // radius, foreshortened by distance.
    float distance = max(-viewPos.z, 1e-4);
    float pixels = aRadius * projectionMatrix[1][1] * uViewportHeight / distance;

    // Below a few pixels the outline degenerates into a dot indistinguishable
    // from the marker, which would read as a precision the world does not have.
    vFade = smoothstep(3.0, 7.0, pixels);
    gl_PointSize = clamp(pixels * 2.0, 0.0, uMaxPx);

    #include <logdepthbuf_vertex>
  }
`;

const CIRCLE_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;

  varying vec3 vColor;
  varying float vFade;

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    float r = length(offset);
    if (r > 1.0) discard;

    // A thin outline, and nothing inside it: the region is not an object and
    // must not read as one.
    float ring = smoothstep(0.90, 0.96, r) * (1.0 - smoothstep(0.98, 1.0, r));

    float alpha = ring * uOpacity * vFade;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(vColor, alpha);
  }
`;

/** Index of every world this layer draws, in the order it draws them. */
function positioned(data: WorldData): number[] {
  const shown: number[] = [];
  for (let i = 0; i < data.worlds.length; i++) {
    if (data.worlds[i].x !== null) shown.push(i);
  }
  return shown;
}

export class WorldField {
  readonly points: THREE.Points;
  readonly circles: THREE.Points;
  readonly count: number;

  private readonly markerMaterial: THREE.ShaderMaterial;
  private readonly circleMaterial: THREE.ShaderMaterial;

  constructor(data: WorldData, fiction: FictionData | null = null) {
    const polityColor = new Map<string, THREE.Color>();
    for (const polity of fiction?.polities ?? []) {
      polityColor.set(polity.id, new THREE.Color(polity.color));
    }

    const shown = positioned(data);
    this.count = shown.length;

    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);

    // A separate, shorter list: only the worlds whose direction is uncertain
    // have anything to draw a circle for.
    const circlePositions: number[] = [];
    const circleColors: number[] = [];
    const circleRadii: number[] = [];

    shown.forEach((index, out) => {
      const world = data.worlds[index];
      positions[out * 3] = world.x as number;
      positions[out * 3 + 1] = world.y as number;
      positions[out * 3 + 2] = world.z as number;

      const color = polityColor.get(world.affiliation) ?? NEUTRAL;
      colors[out * 3] = color.r;
      colors[out * 3 + 1] = color.g;
      colors[out * 3 + 2] = color.b;

      // A volume has an extent of its own; a point world's circle is purely its
      // direction error. Both are drawn the same way because both answer the
      // same question — how much space does this entry actually claim.
      const error = world.direction_error_deg ?? 0;
      const spread =
        error > 0 ? (world.distance_pc ?? 0) * Math.tan((error * Math.PI) / 180) : 0;
      const radius = Math.max(spread, world.radius_pc ?? 0);
      if (radius > 0) {
        circlePositions.push(world.x as number, world.y as number, world.z as number);
        circleColors.push(color.r, color.g, color.b);
        circleRadii.push(radius);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.markerMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: DEFAULT_SIZE_PX },
        uOpacity: { value: DEFAULT_OPACITY },
      },
      vertexShader: MARKER_VERTEX,
      fragmentShader: MARKER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geometry, this.markerMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;

    const circleGeometry = new THREE.BufferGeometry();
    circleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(circlePositions), 3),
    );
    circleGeometry.setAttribute(
      'aColor',
      new THREE.BufferAttribute(new Float32Array(circleColors), 3),
    );
    circleGeometry.setAttribute(
      'aRadius',
      new THREE.BufferAttribute(new Float32Array(circleRadii), 1),
    );
    circleGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.circleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0.34 },
        uViewportHeight: { value: 1080 },
        uMaxPx: { value: MAX_CIRCLE_PX },
      },
      vertexShader: CIRCLE_VERTEX,
      fragmentShader: CIRCLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    this.circles = new THREE.Points(circleGeometry, this.circleMaterial);
    this.circles.frustumCulled = false;
    this.circles.renderOrder = 3;
  }

  setViewportHeight(height: number): void {
    this.circleMaterial.uniforms.uViewportHeight.value = height;
  }

  set opacity(value: number) {
    this.markerMaterial.uniforms.uOpacity.value = value;
  }

  set visible(value: boolean) {
    this.points.visible = value;
    this.circles.visible = value;
  }

  get visible(): boolean {
    return this.points.visible;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.circles.geometry.dispose();
    this.markerMaterial.dispose();
    this.circleMaterial.dispose();
  }
}
