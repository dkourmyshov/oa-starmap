/**
 * Canonical Orion's Arm worlds, and how well the setting locates them.
 *
 * Only the worlds that carry their own coordinates are drawn here. One bound to
 * a catalogue star or to an add-on star is already on the map as that star, and
 * drawing it again would put two objects where the fiction describes one.
 *
 * Orion's Arm locates most places the way an observer would — a distance and a
 * constellation — which fixes the radius exactly and the direction only to the
 * width of the constellation. At Hyvixnym's 3,876 ly, Taurus is 1,800 ly across.
 * The map must not state a position that much more precisely than its source
 * does, so an approximately-placed world is drawn as a **soft, diffuse dot**
 * where an exactly-placed one is crisp. A blurred mark reads as an uncertain
 * position without needing to be explained.
 *
 * Two earlier attempts are worth recording, since both were worse. Drawing the
 * error as a circle at its true angular size was accurate and unusable: those
 * circles are hundreds of light years wide by construction and dominated every
 * view they appeared in. Replacing them with a broken ring around the marker
 * cost no space, but once the settled layer began ringing these worlds by
 * polity there were two concentric rings a pixel apart carrying two unrelated
 * meanings. One mark, one meaning: the dot's edge is the position's precision
 * and the ring around it is the holder.
 *
 * Circles remain for one thing: a world that genuinely *is* a volume. The
 * Corambytia Protectorate is 290 ly across because the setting says so, and that
 * is a fact about the object rather than a confession about the position. Those
 * are drawn at a true angular size, like the cluster and HII layers, so they
 * grow as you approach.
 */

import * as THREE from 'three';

import type { WorldData } from '../data/manifest';

export const DEFAULT_OPACITY = 0.9;

/** Marker diameter in device pixels. */
export const DEFAULT_SIZE_PX = 11.0;

/**
 * The marker's colour, for every world.
 *
 * Deliberately not the polity's. This glyph carries what kind of place it is and
 * how well the source located it; who holds it is a ring, drawn by the settled
 * layer exactly as it is for a star. A marker can only be one colour, so while
 * it carried the affiliation a world held by two empires showed one of them —
 * Pelion and Ossa is Non-Coercive Zone and Sophic League and drew as the former
 * alone.
 */
const MARKER = new THREE.Color(0xd6dcea);

/**
 * Ceiling on an extent circle's on-screen radius, in pixels.
 *
 * Only bites once the camera is inside the volume, where an outline larger than
 * the viewport has stopped conveying a size at all.
 */
export const MAX_CIRCLE_PX = 900.0;

const MARKER_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aColor;
  attribute float aApprox;

  uniform float uSize;

  varying vec3 vColor;
  varying float vApprox;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;
    vColor = aColor;
    vApprox = aApprox;
    gl_PointSize = uSize;

    #include <logdepthbuf_vertex>
  }
`;

const MARKER_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;

  varying vec3 vColor;
  varying float vApprox;

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    float r = length(offset);
    if (r > 1.0) discard;

    // A filled dot, and nothing around it: the polity ring drawn by the settled
    // layer needs that space. Solid where the position is exact, and softened
    // into a diffuse smudge where it is not — the same mark, losing its edge in
    // proportion to what the source failed to pin down.
    float edge = mix(0.34, 0.86, vApprox);
    float dot = 1.0 - smoothstep(0.0, edge, r);

    // The soft form spreads its light over a wider area, so lift it or it reads
    // as merely fainter rather than as less certain.
    float alpha = dot * uOpacity * mix(1.0, 1.5, vApprox);
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
    const world = data.worlds[i];
    // A world sharing another's position is drawn by its host, not beside it.
    // It carries the same coordinates, so a second marker would be one object
    // drawn twice at one point.
    if (world.x !== null && !world.in_world) shown.push(i);
  }
  return shown;
}

export class WorldField {
  readonly points: THREE.Points;
  readonly circles: THREE.Points;
  readonly count: number;

  private readonly markerMaterial: THREE.ShaderMaterial;
  private readonly circleMaterial: THREE.ShaderMaterial;

  constructor(data: WorldData) {
    const shown = positioned(data);
    this.count = shown.length;

    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    const approximate = new Float32Array(this.count);

    // A separate, much shorter list: only a world that is genuinely a volume
    // gets a circle. A direction error is not an extent, and drawing it as one
    // buried the map.
    const circlePositions: number[] = [];
    const circleColors: number[] = [];
    const circleRadii: number[] = [];

    shown.forEach((index, out) => {
      const world = data.worlds[index];
      positions[out * 3] = world.x as number;
      positions[out * 3 + 1] = world.y as number;
      positions[out * 3 + 2] = world.z as number;

      const color = MARKER;
      colors[out * 3] = color.r;
      colors[out * 3 + 1] = color.g;
      colors[out * 3 + 2] = color.b;

      // Broken ring where the source gave a region rather than a direction.
      approximate[out] = (world.direction_error_deg ?? 0) > 0 ? 1 : 0;

      // The extent the setting states, and only that. Corambytia is 290 ly
      // across because the article says so — a fact about the object, unlike a
      // direction error, which is a fact about how well we know where it is.
      const radius = world.radius_pc ?? 0;
      if (radius > 0) {
        circlePositions.push(world.x as number, world.y as number, world.z as number);
        circleColors.push(color.r, color.g, color.b);
        circleRadii.push(radius);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aApprox', new THREE.BufferAttribute(approximate, 1));
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
        uOpacity: { value: 0.45 },
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
