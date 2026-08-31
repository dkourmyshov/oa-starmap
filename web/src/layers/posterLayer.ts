/**
 * Someone else's map of the same sky, laid into the galactic plane.
 *
 * Kevin Jardine's Galaxy Map posters draw the plane from above, centred on the
 * Sun with the galactic centre to the right — the frame this map already works
 * in — so they can be placed rather than merely displayed. The pipeline
 * measures where each one's Sun sits and how many parsecs a pixel covers by
 * fitting the poster against this project's own star catalogue; all that is
 * left here is to hang the picture on those numbers.
 *
 * It is a quad in the z = 0 plane, not a billboard and not a backdrop. That
 * makes it correct in both projections for the same reason and with no extra
 * code: seen from the pole in the plan view it lies flat under the map, and
 * seen obliquely in the perspective view it foreshortens into the plane like
 * the floor it is, which is exactly what a top-down projection of the plane
 * should do. Rotating it to face the camera would be a lie about what it is.
 *
 * Only one is shown at a time. The series is a set of nested views of the same
 * volume at eight scales, so drawing two would stack two renderings of the same
 * stars a pixel apart.
 *
 * The textures are megabytes each and are fetched only when chosen, so a reader
 * who never opens the layer never pays for it.
 */

import * as THREE from 'three';

import { DATA_ROOT, type Poster } from '../data/manifest';

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform sampler2D uMap;
  uniform float uOpacity;

  varying vec2 vUv;

  void main() {
    vec4 texel = texture2D(uMap, vUv);
    float alpha = texel.a * uOpacity;
    if (alpha < 0.004) discard;

    #include <logdepthbuf_fragment>

    // Ordinary blending, not additive. A poster is a finished picture with its
    // own colours, and adding it to what is behind would wash every one of them
    // out; but it is also drawn before everything else and nothing here depth
    // tests, so what it paints over is the empty background, and the star field
    // that comes after adds on top of it as usual.
    gl_FragColor = vec4(texel.rgb, alpha);
  }
`;

export class PosterLayer {
  readonly mesh: THREE.Mesh;

  private readonly material: THREE.ShaderMaterial;
  private readonly cache = new Map<string, THREE.Texture>();
  private current: Poster | null = null;
  /** Guards against a slow fetch arriving after the reader has moved on. */
  private pending = 0;

  constructor(private readonly root = DATA_ROOT) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uOpacity: { value: 0.85 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });

    // A unit quad, scaled and shifted per poster: the Sun is rarely at the
    // centre of the image, so position and size are both set from the bounds
    // the pipeline measured rather than assumed symmetric.
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    // Before everything: it is the sheet the map is drawn on. Nothing here
    // depth-tests, so what is drawn first is what ends up underneath.
    this.mesh.renderOrder = -10;
    this.mesh.visible = false;
  }

  get poster(): Poster | null {
    return this.current;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
    this.mesh.visible = value > 0 && this.current !== null;
  }

  get opacity(): number {
    return this.material.uniforms.uOpacity.value as number;
  }

  /** Show one poster, or none. Resolves once its texture is on screen. */
  async show(poster: Poster | null): Promise<void> {
    const token = ++this.pending;
    this.current = poster;
    if (!poster) {
      this.mesh.visible = false;
      return;
    }

    const { left, right, top, bottom } = poster.bounds_pc;
    this.mesh.scale.set(right - left, top - bottom, 1);
    this.mesh.position.set((left + right) / 2, (top + bottom) / 2, 0);

    const texture = await this.texture(poster);
    // A second choice made while this one was downloading wins.
    if (token !== this.pending) return;
    this.material.uniforms.uMap.value = texture;
    this.mesh.visible = this.opacity > 0;
  }

  private async texture(poster: Poster): Promise<THREE.Texture> {
    const held = this.cache.get(poster.file);
    if (held) return held;

    const loaded = await new THREE.TextureLoader().loadAsync(`${this.root}/${poster.file}`);
    loaded.colorSpace = THREE.SRGBColorSpace;
    // Anisotropy is what keeps the poster readable when the perspective view
    // looks along the plane, where a texel spans many pixels in one screen
    // direction and almost none in the other.
    loaded.anisotropy = 8;
    loaded.minFilter = THREE.LinearMipmapLinearFilter;
    loaded.magFilter = THREE.LinearFilter;
    loaded.generateMipmaps = true;
    this.cache.set(poster.file, loaded);
    return loaded;
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * How well a poster is placed, in words, for the detail the HUD shows.
 *
 * Every poster carries its own registration residual because they differ by two
 * orders of magnitude: the 100 pc sheet is laid to within a fifth of a light
 * year, the 3 kpc one to within seventy. Saying so is the same courtesy the
 * rest of the map extends to a measured distance.
 */
export function registrationNote(poster: Poster): string {
  const r = poster.registration;
  if (r.method !== 'stars' || r.rms_pc === null) {
    return 'placed on its own boundary circle — too few catalogue objects to fit';
  }
  const ly = r.rms_pc * 3.261563777;
  const rounded = ly < 1 ? ly.toFixed(2) : ly < 10 ? ly.toFixed(1) : Math.round(ly).toString();
  return `fitted to ${r.stars_used} catalogue stars, ${rounded} ly rms`;
}
