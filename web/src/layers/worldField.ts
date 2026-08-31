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

import type { WorldData, WorldEntry } from '../data/manifest';
import { type EpochBasis, worldYears } from '../data/history';

import { DOF_PARS, type DofUniforms, dofUniforms } from './dof';
import {
  DEFAULT_UNDATED_GAIN,
  DEFAULT_UNNAMED_GAIN,
  EPOCH_PARS,
  type EpochPlace,
  type EpochUniforms,
  attachEpochAttributes,
  epochUniforms,
} from './epoch';
import { EXTENT_PARS, extentGeometry, extentUniforms, instanced } from './extent';
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
export const HAZARD_RING_PX = 1.8;

/**
 * Ceiling on an extent circle's on-screen diameter, in pixels.
 *
 * It used to be 900, and that was a ceiling on a symptom: point sprites are
 * capped by the driver at around a thousand pixels, so past that the outline
 * stopped growing while everything around it kept growing — which reads as the
 * circle shrinking. Extents are instanced quads now (see layers/extent.ts) and
 * have no such limit, so the ceiling can sit far beyond any viewport and the
 * circle is drawn at the radius the data actually claims. What is left is a
 * guard against a pathological radius, not a display rule: a quad larger than
 * the screen costs nothing extra, since the rasteriser clips it.
 */
export const MAX_CIRCLE_PX = 20000.0;

const MARKER_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aColor;

  uniform float uSize;
  ${DOF_PARS}
  ${EPOCH_PARS}

  varying vec3 vColor;
  varying float vDim;
  varying float vScale;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPos;
    vColor = aColor;

    // Not yet founded, or already ended: collapsed rather than faded, for the
    // reason given in layers/epoch.ts.
    float epoch = epochGain();
    if (epoch <= 0.0) {
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    // The marker keeps its screen size and softens, as the rings do.
    float defocus = dofDecades(viewPos);
    float blurPx = dofBlurPx(defocus);
    float grown = uSize + 2.0 * blurPx;
    vScale = grown / uSize;
    vDim = dofGain(uSize, grown) * dofDim(defocus) * epoch;
    gl_PointSize = grown;

    #include <logdepthbuf_vertex>
  }
`;

const MARKER_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float uOpacity;

  varying vec3 vColor;
  varying float vDim;
  varying float vScale;

  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    if (length(offset) > 1.0) discard;
    float r = length(offset) * vScale;

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
    float alpha = dot * uOpacity * vDim;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(vColor, alpha);
  }
`;

const CIRCLE_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aCentre;
  attribute vec3 aColor;
  attribute float aRadius;
  attribute float aHazard;

  ${EXTENT_PARS}
  ${DOF_PARS}
  ${EPOCH_PARS}
  uniform float uMaxPx;

  varying vec3 vColor;
  varying float vFade;
  varying float vSize;
  varying float vBlur;
  varying float vScale;
  varying float vHazard;
  varying vec2 vCorner;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(aCentre, 1.0);
    vec4 clipCentre = projectionMatrix * viewPos;

    float epoch = epochGain();
    if (epoch <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vCorner = position.xy;
    vColor = aColor;
    vHazard = aHazard;

    // The same angular-size projection the other extent layers use — see
    // layers/extent.ts, which carries the note.
    float pixels = extentPixels(aRadius, clipCentre.w);

    // Below a few pixels the outline degenerates into a dot indistinguishable
    // from the marker, which would read as a precision the world does not have.
    vFade = smoothstep(3.0, 7.0, pixels) * epoch;

    // The value above is already the projected *diameter*: a physical radius r
    // at distance d subtends a screen radius of r * P[1][1] * height / (2d),
    // and the expression omits the 2. The quad is sized as a width, and the
    // fragment draws its ring at the quad's edge, so this is the whole of it.
    // It used to be doubled, which drew every extent at twice its true size —
    // invisible on Corambytia, whose 11 degrees merely looked like 22, and
    // impossible to miss on the Gehenna front, which covered the sphere.
    // clusterField computes the same quantity and does not double it.
    // Depth of field. The quad grows to make room and the fragment scales its
    // coordinate back, so the outline keeps the angular size it is there to
    // report and only its edge softens. vSize stays the unblurred size, because
    // the ring's thickness is derived from it and a hairline must not thin just
    // because the thing is out of focus.
    float base = clamp(pixels, 0.0, uMaxPx);
    float defocus = dofDecades(viewPos);
    float blurPx = dofBlurPx(defocus);
    float grown = base + 2.0 * blurPx;
    vScale = base > 0.0 ? grown / base : 1.0;
    vBlur = base > 0.0 ? min(blurPx / max(base * 0.5, 1e-4), 0.5) : 0.0;
    vFade *= dofGain(max(base, 1e-4), max(grown, 1e-4)) * dofDim(defocus);
    gl_Position = extentCorner(clipCentre, grown);
    vSize = base;

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
  varying float vBlur;
  varying float vScale;
  varying float vHazard;
  varying vec2 vCorner;

  void main() {
    // The quad corner, in the same [-1, 1] gl_PointCoord gave when these were
    // sprites, so everything below is unchanged.
    vec2 offset = vCorner;
    if (length(offset) > 1.0) discard;
    float r = length(offset) * vScale;

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
    float ring = 1.0 - smoothstep(0.0, width + vBlur, abs(r - (1.0 - width)));

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

/** How a world's years reach the epoch shader, under one basis. */
function epochPlaces(worlds: WorldEntry[], basis: EpochBasis): EpochPlace[] {
  return worlds.map((world) => {
    const years = worldYears(world, basis);
    return {
      from: years.from,
      to: years.to,
      distancePc: Math.hypot(world.x ?? 0, world.y ?? 0, world.z ?? 0),
    };
  });
}

function yearArray(worlds: WorldEntry[], basis: EpochBasis): Float32Array {
  const out = new Float32Array(worlds.length * 2);
  epochPlaces(worlds, basis).forEach((place, index) => {
    out[index * 2] = place.from;
    out[index * 2 + 1] = place.to;
  });
  return out;
}

export class WorldField {
  readonly points: THREE.Points;
  readonly circles: THREE.Mesh;
  readonly count: number;

  private readonly markerMaterial: THREE.ShaderMaterial;
  private readonly circleMaterial: THREE.ShaderMaterial;

  private readonly yearAttribute: THREE.BufferAttribute;
  private readonly namedAttribute: THREE.BufferAttribute;
  private readonly yearsByBasis: Record<EpochBasis, Float32Array>;
  private readonly markerNames: string[];
  private readonly circleYearAttribute: THREE.InstancedBufferAttribute;
  private readonly circleNamedAttribute: THREE.InstancedBufferAttribute;
  private readonly circleYearsByBasis: Record<EpochBasis, Float32Array>;
  private readonly circleNames: string[] = [];

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
    const markerWorlds: WorldEntry[] = [];
    const circleWorlds: WorldEntry[] = [];

    shown.forEach((index, out) => {
      const world = data.worlds[index];
      markerWorlds.push(world);
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
        circleWorlds.push(world);
        this.circleNames.push(world.name);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    // Both bases, as the rings keep them: switching between "first reached" and
    // "settled" rewrites an attribute rather than rebuilding the layer.
    const attached = attachEpochAttributes(geometry, epochPlaces(markerWorlds, 'known'));
    this.yearAttribute = attached.years;
    this.namedAttribute = attached.named;
    this.yearsByBasis = {
      known: (attached.years.array as Float32Array).slice(),
      settled: yearArray(markerWorlds, 'settled'),
    };
    this.markerNames = markerWorlds.map((world) => world.name);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.markerMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: DEFAULT_SIZE_PX },
        uOpacity: { value: DEFAULT_OPACITY },
        ...dofUniforms(),
        ...epochUniforms(),
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

    const circleGeometry = extentGeometry(circleRadii.length);
    circleGeometry.setAttribute('aCentre', instanced(new Float32Array(circlePositions), 3));
    circleGeometry.setAttribute('aColor', instanced(new Float32Array(circleColors), 3));
    circleGeometry.setAttribute('aRadius', instanced(new Float32Array(circleRadii), 1));
    circleGeometry.setAttribute('aHazard', instanced(new Float32Array(circleHazard), 1));
    // The outlines are instanced, so their copy of the year attributes has to
    // be too — one pair of years per volume, not per corner of its quad.
    this.circleYearsByBasis = {
      known: yearArray(circleWorlds, 'known'),
      settled: yearArray(circleWorlds, 'settled'),
    };
    this.circleYearAttribute = instanced(this.circleYearsByBasis.known.slice(), 2);
    this.circleNamedAttribute = instanced(new Float32Array(circleWorlds.length).fill(1), 1);
    circleGeometry.setAttribute('aYears', this.circleYearAttribute);
    circleGeometry.setAttribute('aNamed', this.circleNamedAttribute);

    this.circleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0.45 },
        ...extentUniforms(),
        uMaxPx: { value: MAX_CIRCLE_PX },
        uRingPx: { value: RING_PX },
        uHazardRingPx: { value: HAZARD_RING_PX },
        uHazardDim: { value: 1.0 },
        ...dofUniforms(),
        ...epochUniforms(),
      },
      vertexShader: CIRCLE_VERTEX,
      fragmentShader: CIRCLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    this.circles = new THREE.Mesh(circleGeometry, this.circleMaterial);
    this.circles.frustumCulled = false;
    this.circles.renderOrder = 3;
  }

  /**
   * Show the map as it stood in a year, or stop.
   *
   * `showUndated` reaches the shader as a gain rather than a filter, because
   * "no date recorded" is a third state and not a kind of absence: hidden it
   * must vanish completely, shown it must be visibly weaker than a place with
   * a year. Wiring it only into the picker left the reader hiding the undated
   * places and still looking at them.
   */
  setEpoch(year: number | null, showUndated = true): void {
    for (const material of [this.markerMaterial, this.circleMaterial]) {
      const uniforms = material.uniforms as unknown as EpochUniforms;
      uniforms.uEpochOn.value = year === null ? 0 : 1;
      uniforms.uUndatedGain.value = showUndated ? DEFAULT_UNDATED_GAIN : 0;
      if (year !== null) uniforms.uYear.value = year;
    }
  }

  /** Which date decides when a world appears: first reached, or settled. */
  setEpochBasis(basis: EpochBasis): void {
    (this.yearAttribute.array as Float32Array).set(this.yearsByBasis[basis]);
    this.yearAttribute.needsUpdate = true;
    (this.circleYearAttribute.array as Float32Array).set(this.circleYearsByBasis[basis]);
    this.circleYearAttribute.needsUpdate = true;
  }

  /** Mark the worlds a period's own history names; null clears the emphasis. */
  setNamedPlaces(names: Set<string> | null, gain = DEFAULT_UNNAMED_GAIN): void {
    const write = (
      attribute: THREE.BufferAttribute | THREE.InstancedBufferAttribute,
      order: string[],
    ): void => {
      const array = attribute.array as Float32Array;
      order.forEach((name, index) => {
        array[index] = names === null || names.has(name) ? 1 : 0;
      });
      attribute.needsUpdate = true;
    };
    write(this.namedAttribute, this.markerNames);
    write(this.circleNamedAttribute, this.circleNames);
    for (const material of [this.markerMaterial, this.circleMaterial]) {
      (material.uniforms as unknown as EpochUniforms).uUnnamedGain.value =
        names === null ? 1 : gain;
    }
  }

  /** Device pixels, both axes: the corner offsets are computed in them. */
  setViewport(width: number, height: number): void {
    (this.circleMaterial.uniforms.uViewport.value as THREE.Vector2).set(width, height);
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

  /**
   * The uniforms the shared depth-of-field settings write into.
   *
   * Two, because this layer draws with two materials — the world markers and
   * the extent circles — and both have to agree with everything else about
   * where the focus is.
   */
  get dof(): DofUniforms[] {
    return [
      this.markerMaterial.uniforms as unknown as DofUniforms,
      this.circleMaterial.uniforms as unknown as DofUniforms,
    ];
  }
}
