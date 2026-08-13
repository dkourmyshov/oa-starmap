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
 * does — so that is said by the polity ring around it, which is drawn dashed
 * where the position is approximate. This layer draws only the dot.
 *
 * Three arrangements were tried before that. A circle at the error's true
 * angular size was accurate and unusable, those circles being hundreds of light
 * years wide and dominating every view. A broken ring around the marker cost no
 * space but landed a pixel inside the polity ring, so the two read as one
 * confusion. Softening the dot's own edge instead was legible in principle and
 * too quiet to notice in practice. The dash was always the clearest of them;
 * what it needed was somewhere to live that was not already occupied.
 *
 * Circles remain for one thing: a world that genuinely *is* a volume. The
 * Corambytia Protectorate is 290 ly across because the setting says so, and that
 * is a fact about the object rather than a confession about the position. Those
 * are drawn at a true angular size, like the cluster and HII layers, so they
 * grow as you approach.
 *
 * Two limits remain in that, and both are visible on the Gehenna front, which
 * is 5,240 ly across and reaches to within 410 ly of Sol. The size uses
 * `-viewPos.z`, the depth along the view axis, where the cluster layer uses the
 * true distance — so an extent far off to the side inflates. And a billboard
 * cannot show a volume the camera is *inside*: the correct picture there is one
 * that surrounds the view, and a disc at the centroid is not it. Four
 * catalogued clusters contain Sol, so that limit is not peculiar to this layer.
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
 * The outline colour for a volume that is a hazard rather than a territory.
 *
 * Deliberately dark, which is the opposite of what the Gehenna front is: two
 * hundred times the ionising output of a Type II supernova. A bright boundary
 * would be truer to the physics and useless on the map — the circle is 5,240 ly
 * across and reaches to within 410 ly of Sol, so anything luminous at that size
 * lights the whole sphere and buries the places inside it. Dark red carries the
 * meaning without taking the view.
 */
const HAZARD = new THREE.Color(0xa81f2a);

/**
 * Ring thickness in device pixels, held constant as the circle grows.
 *
 * A hazard's line is the thinner of the two but not thinner than a pixel, which
 * is where the first attempt went: 0.9 px dimmed to 55% of a dark red left a
 * sub-pixel line at an alpha of 0.25, and the front vanished from the map
 * entirely. Dark has a floor, and it is set by whether the thing can be seen.
 */
export const RING_PX = 1.6;
export const HAZARD_RING_PX = 1.4;

/**
 * Ceiling on an extent circle's on-screen diameter, in pixels.
 *
 * Bites when the camera is close to a volume or inside it, where an outline
 * larger than the viewport has stopped conveying a size at all. Once it bites,
 * the outline stops growing while everything around it keeps growing, which
 * reads as the circle shrinking — so it is a ceiling on a symptom, not a fix.
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

    // A filled dot, and nothing around it: the polity ring drawn by the settled
    // layer needs that space. Solid where the position is exact, and softened
    // into a diffuse smudge where it is not — the same mark, losing its edge in
    // proportion to what the source failed to pin down.
    //
    // The soft form has to stay well inside the ring. This sprite is 11 pixels
    // across and the ring's inner edge is at 4.7, so a fade reaching r = 0.86
    // arrives exactly there and — drawing later — paints over the polity
    // instead of sitting inside it. Ending at 0.62 leaves a clear gap.
    float dot = 1.0 - smoothstep(0.0, 0.40, r);
    float alpha = dot * uOpacity;
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
  attribute float aHazard;

  uniform float uViewportHeight;
  uniform float uMaxPx;

  varying vec3 vColor;
  varying float vFade;
  varying float vSize;
  varying float vHazard;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;
    vColor = aColor;
    vHazard = aHazard;

    // The same angular-size projection the volumetric layers use: a physical
    // radius, foreshortened by distance.
    float distance = max(-viewPos.z, 1e-4);
    float pixels = aRadius * projectionMatrix[1][1] * uViewportHeight / distance;

    // Below a few pixels the outline degenerates into a dot indistinguishable
    // from the marker, which would read as a precision the world does not have.
    vFade = smoothstep(3.0, 7.0, pixels);

    // The value above is already the projected *diameter*: a physical radius r
    // at distance d subtends a screen radius of r * P[1][1] * height / (2d),
    // and the expression omits the 2. gl_PointSize is a width, and the fragment
    // draws its ring at the sprite's edge, so this is the whole of it.
    // It used to be doubled, which drew every extent at twice its true size —
    // invisible on Corambytia, whose 11 degrees merely looked like 22, and
    // impossible to miss on the Gehenna front, which covered the sphere.
    // clusterField computes the same quantity and does not double it.
    gl_PointSize = clamp(pixels, 0.0, uMaxPx);
    vSize = gl_PointSize;

    #include <logdepthbuf_vertex>
  }
`;

const CIRCLE_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;
  uniform float uRingPx;
  uniform float uHazardRingPx;
  uniform float uHazardDim;

  varying vec3 vColor;
  varying float vFade;
  varying float vSize;
  varying float vHazard;

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    float r = length(offset);
    if (r > 1.0) discard;

    // A thin outline, and nothing inside it: the region is not an object and
    // must not read as one.
    //
    // Thickness is held constant in *pixels* rather than as a fraction of the
    // sprite, which is what the cluster layer learned first: a fixed band in
    // sprite space becomes a wall as the circle grows, and at the Gehenna
    // front's size it would fill the view. This stays a hairline at any size.
    // Never thinner than a pixel. Sprite space is fractions of the whole
    // sprite, so on the Gehenna front's 900-pixel circle a width of 0.001 is
    // sub-pixel: most fragments miss the ring entirely and it disappears rather
    // than thinning. Asking for a hairline has to mean one pixel, not less.
    float widthPx = max(mix(uRingPx, uHazardRingPx, vHazard), 1.0);
    float width = clamp(widthPx / max(vSize, 1.0), 0.0, 0.35);
    float ring = 1.0 - smoothstep(0.0, width, abs(r - (1.0 - width)));

    float alpha = ring * uOpacity * vFade * mix(1.0, uHazardDim, vHazard);
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

    // A separate, much shorter list: only a world that is genuinely a volume
    // gets a circle. A direction error is not an extent, and drawing it as one
    // buried the map.
    const circlePositions: number[] = [];
    const circleColors: number[] = [];
    const circleRadii: number[] = [];
    const circleHazard: number[] = [];

    shown.forEach((index, out) => {
      const world = data.worlds[index];
      positions[out * 3] = world.x as number;
      positions[out * 3 + 1] = world.y as number;
      positions[out * 3 + 2] = world.z as number;

      const color = MARKER;
      colors[out * 3] = color.r;
      colors[out * 3 + 1] = color.g;
      colors[out * 3 + 2] = color.b;

      // The extent the setting states, and only that. Corambytia is 290 ly
      // across because the article says so — a fact about the object, unlike a
      // direction error, which is a fact about how well we know where it is.
      const radius = world.radius_pc ?? 0;
      if (radius > 0) {
        // A hazard is not a territory, and the setting says which is which:
        // Corambytia is a protectorate and the Gehenna front is something
        // spreading through what other people hold. The one word decides the
        // colour and the weight of the line.
        const hazard = world.kind === 'hazard';
        const outline = hazard ? HAZARD : color;
        circlePositions.push(world.x as number, world.y as number, world.z as number);
        circleColors.push(outline.r, outline.g, outline.b);
        circleRadii.push(radius);
        circleHazard.push(hazard ? 1 : 0);
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
    circleGeometry.setAttribute(
      'aHazard',
      new THREE.BufferAttribute(new Float32Array(circleHazard), 1),
    );
    circleGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.circleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0.45 },
        uViewportHeight: { value: 1080 },
        uMaxPx: { value: MAX_CIRCLE_PX },
        uRingPx: { value: RING_PX },
        uHazardRingPx: { value: HAZARD_RING_PX },
        uHazardDim: { value: 1.0 },
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
