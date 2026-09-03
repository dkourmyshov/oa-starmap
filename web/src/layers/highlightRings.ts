/**
 * A ring drawn round something the reader has just asked about.
 *
 * The map colours objects by polity, which answers "what holds this" for one
 * object at a time. It does not answer the other direction — "where is this
 * polity" — because a colour among forty colours is not findable by eye. The
 * Sagittarius Sphere and the Solar Dominion are two blues, forty parsecs apart
 * on screen and four degrees apart in hue, and no legend fixes that.
 *
 * So the legend answers it instead: click a polity and its holdings get a ring
 * each. A mark laid *over* the map rather than a change *to* the map, which is
 * the important part — nothing is recoloured, nothing is dimmed, nothing is
 * hidden, so the answer costs the reader none of the map they were reading. It
 * goes away when they click again.
 *
 * The rings are instanced extent quads, the same machinery the cluster field
 * uses, so a ring can be sized in parsecs where the object has a real size —
 * round a cluster the ring is the cluster's own radius and lands just outside
 * the ring already drawn there — and fall back to a fixed pixel size where it
 * has none. A star has no radius worth drawing at any zoom this map reaches;
 * what it needs is a mark big enough to find.
 *
 * Positions in, not indices: the caller knows which catalogue it is reading and
 * this class does not need to. That also lets one instance of it serve
 * questions the layers below cannot answer together — the polity legend's
 * holdings span the star catalogue, the cluster catalogue and the H II regions,
 * and no one layer sees all three.
 */

import * as THREE from 'three';

import { EXTENT_PARS, extentGeometry, extentUniforms, instanced } from './extent';

/** The ring sits outside the object's own outline rather than over it. */
export const HALO_SCALE = 1.35;

/** No smaller than this on screen, for a mark whose job is to be findable. */
export const MIN_SIZE_PX = 15;

/** Thick enough to see against a bright cluster, thin enough not to fill it. */
export const RING_WIDTH_PX = 2.4;

export const DEFAULT_COLOR = 0xfff1a8;

export interface HighlightPoint {
  x: number;
  y: number;
  z: number;
  /** The object's own radius in parsecs, or 0 for anything point-like. */
  radiusPc?: number;
  /**
   * Drawn as a broken ring rather than a whole one, where the source places the
   * object in a polity's *direction* rather than inside its volume. The map
   * already refuses to colour those; a solid ring here would put the claim back.
   */
  dashed?: boolean;
}

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aCentre;
  attribute float aRadius;
  attribute float aDashed;

  ${EXTENT_PARS}
  uniform float uMinSize;

  varying float vSize;
  varying float vDashed;
  varying vec2 vCorner;

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(aCentre, 1.0);
    vec4 clipCentre = projectionMatrix * viewPos;
    vCorner = position.xy;
    vDashed = aDashed;
    // A floor in pixels, so a holding a kiloparsec out still reads as a mark
    // rather than as nothing. No ceiling: see layers/extent.ts.
    vSize = max(extentPixels(aRadius, clipCentre.w), uMinSize);
    gl_Position = extentCorner(clipCentre, vSize);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uRingWidthPx;

  varying float vSize;
  varying float vDashed;
  varying vec2 vCorner;

  void main() {
    float r = length(vCorner);
    if (r > 1.0) discard;

    // Constant on screen rather than in the world: this is annotation, and a
    // ring that thins out with distance stops being findable at exactly the
    // zoom where finding things is hard.
    float width = clamp(uRingWidthPx / max(vSize, 1.0), 0.006, 0.30);
    float ring = 1.0 - smoothstep(0.0, width, abs(r - (1.0 - width)));

    if (vDashed > 0.5) {
      float turn = fract(atan(vCorner.y, vCorner.x) / (2.0 * PI) * 12.0);
      ring *= step(turn, 0.55);
    }

    float alpha = ring * uOpacity;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export class HighlightRings {
  readonly mesh: THREE.Mesh;

  private readonly material: THREE.ShaderMaterial;
  private count = 0;

  constructor(color: THREE.ColorRepresentation = DEFAULT_COLOR) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...extentUniforms(),
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 0.95 },
        uRingWidthPx: { value: RING_WIDTH_PX },
        uMinSize: { value: MIN_SIZE_PX },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      // Depth off, like the ring layers it annotates: a mark that answers a
      // question the reader just asked should not be hidden behind a nebula.
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    this.mesh = new THREE.Mesh(extentGeometry(0), this.material);
    this.mesh.frustumCulled = false;
    // Over everything it marks. Set on the mesh rather than on a parent group,
    // because three.js does not inherit renderOrder — a mistake this project
    // has made before.
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
  }

  /** What is currently ringed. Zero when nothing is. */
  get marked(): number {
    return this.count;
  }

  /**
   * Ring these, in this colour, and nothing else.
   *
   * The geometry is rebuilt rather than grown into: this changes when the
   * reader clicks, which is many orders of magnitude rarer than a frame, and a
   * fixed capacity would be a guess about how large a polity gets.
   */
  show(points: readonly HighlightPoint[], color?: THREE.ColorRepresentation): void {
    this.mesh.geometry.dispose();
    this.count = points.length;
    if (color !== undefined) (this.material.uniforms.uColor.value as THREE.Color).set(color);

    const centres = new Float32Array(this.count * 3);
    const radii = new Float32Array(this.count);
    const dashed = new Float32Array(this.count);
    points.forEach((point, i) => {
      centres[i * 3] = point.x;
      centres[i * 3 + 1] = point.y;
      centres[i * 3 + 2] = point.z;
      radii[i] = (point.radiusPc ?? 0) * HALO_SCALE;
      dashed[i] = point.dashed ? 1 : 0;
    });

    const geometry = extentGeometry(this.count);
    geometry.setAttribute('aCentre', instanced(centres, 3));
    geometry.setAttribute('aRadius', instanced(radii, 1));
    geometry.setAttribute('aDashed', instanced(dashed, 1));
    this.mesh.geometry = geometry;
    // The viewport is a uniform on the material, which survives this, so a set
    // shown between frames is sized correctly without being told again.
    this.mesh.visible = this.count > 0;
  }

  /** Take every ring off the map. */
  clear(): void {
    this.show([]);
  }

  setViewport(width: number, height: number): void {
    (this.material.uniforms.uViewport.value as THREE.Vector2).set(width, height);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
