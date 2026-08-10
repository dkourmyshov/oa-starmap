/**
 * Renderer, camera and controls.
 *
 * The hard problem is dynamic range. The map spans from standing next to Sol to
 * looking across 7000+ light years — five orders of magnitude — and a fixed
 * near/far pair cannot cover that without catastrophic depth precision loss.
 * Two things solve it together: a logarithmic depth buffer, and near/far planes
 * recomputed every frame from how far the camera currently is from its target.
 *
 * Movement is likewise scale-proportional. Orbit dollying is multiplicative, so a
 * scroll notch covers a light year when you are among nearby stars and hundreds
 * when you are looking at the galactic arm — the control feels the same at every
 * scale.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { type Parsecs, pc } from '../units';

/** Closest approach, in parsecs. Below this the camera is effectively inside a star. */
const MIN_TARGET_DISTANCE = 1e-3;

/** Far enough to see the whole dataset from outside. */
const MAX_TARGET_DISTANCE = 1e5;

/** Opening range, in parsecs. Wide enough to show the nearby field around Sol. */
const DEFAULT_RANGE = 65;

/**
 * The preset viewpoints, as offsets from whatever the camera is orbiting.
 *
 * Expressed in the map's own frame rather than as camera angles: x is coreward,
 * y is spinward, z is galactic north. Naming them after what they show — the
 * plane from above, the plane edge-on, the direction of the core — keeps the
 * buttons meaningful when the orbit target is a cluster rather than Sol.
 */
export type Viewpoint = 'top' | 'spin' | 'core' | 'tilted';

export const VIEWPOINTS: { id: Viewpoint; label: string; title: string }[] = [
  { id: 'top', label: 'top', title: 'From galactic north, looking down on the plane' },
  { id: 'spin', label: 'spin', title: 'In the galactic plane, looking spinward' },
  { id: 'core', label: 'core', title: 'Looking towards the galactic centre' },
  { id: 'tilted', label: 'tilted', title: 'Three-quarter view, so the plane reads as a plane' },
];

export function viewpointPosition(name: Viewpoint, range: number): THREE.Vector3 {
  switch (name) {
    case 'top':
      // Very slightly off the pole. OrbitControls clamps the polar angle away
      // from exactly zero, and starting there would leave the azimuth
      // undefined — the map would snap the first time it was dragged.
      return new THREE.Vector3(0, -1e-3, 1).normalize().multiplyScalar(range);
    case 'spin':
      // In the plane, looking spinward — towards +y, which is galactic
      // longitude 90. Named for the direction of view rather than for the disk
      // being edge-on: the galaxy's edge is not what this points at.
      return new THREE.Vector3(0, -1, 0).multiplyScalar(range);
    case 'core':
      // Coreward is +x, so the camera sits anticoreward of the target.
      return new THREE.Vector3(-1, 0, 0).multiplyScalar(range);
    case 'tilted':
      return new THREE.Vector3(0, -60, 25).normalize().multiplyScalar(range);
  }
}

export class Viewer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly canvas: HTMLCanvasElement;
  private readonly onFrame: Array<(dt: number) => void> = [];
  private clock = new THREE.Clock();
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03040a);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // Without this, depth precision collapses across the range this map covers
      // and distant stars z-fight or disappear entirely.
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1e6);
    // Galactic north is up. Not cosmetic: OrbitControls treats the camera's up
    // vector as the pole it orbits about, so with the default +y the map's own
    // z axis was just some direction, and an edge-on view — where the viewing
    // direction lies along +y — was degenerate. With +z as the pole, orbiting
    // means changing galactic latitude and longitude, which is what the
    // viewpoint presets are expressed in.
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(viewpointPosition('top', DEFAULT_RANGE));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 1.1;
    this.controls.minDistance = MIN_TARGET_DISTANCE;
    this.controls.maxDistance = MAX_TARGET_DISTANCE;
    // Panning must move in world space, not screen space, or it drifts off the
    // galactic plane in a way that is disorienting at large scales.
    this.controls.screenSpacePanning = true;

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

    /**
   * Move to a preset viewpoint, keeping the current range and orbit target.
   *
   * The range is preserved deliberately: these change where you are looking
   * from, not how far away you are, so switching viewpoint while examining a
   * cluster keeps the cluster the same size on screen.
   */
  setViewpoint(name: Viewpoint): void {
    const range = this.camera.position.distanceTo(this.controls.target);
    this.camera.position
      .copy(this.controls.target)
      .add(viewpointPosition(name, range || DEFAULT_RANGE));
    this.controls.update();
  }

  /** Distance from the camera to whatever it is orbiting. */
  get targetDistance(): Parsecs {
    return pc(this.camera.position.distanceTo(this.controls.target));
  }

  /** Distance from the camera to Sol, which is the origin of the frame. */
  get distanceFromSol(): Parsecs {
    return pc(this.camera.position.length());
  }

  addFrameCallback(callback: (dt: number) => void): void {
    this.onFrame.push(callback);
  }

  /**
   * Re-anchor the orbit target, keeping the camera's viewing direction and a
   * sensible standoff distance for the new focus.
   */
  focusOn(position: THREE.Vector3, standoff: Parsecs): void {
    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();
    if (direction.lengthSq() === 0) direction.set(0, -1, 0.4).normalize();

    this.controls.target.copy(position);
    this.camera.position.copy(position).addScaledVector(direction, standoff as number);
    this.controls.update();
  }

  private handleResize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  /**
   * Keep the depth range tied to the current viewing scale.
   *
   * Anchoring both planes to the target distance means the usable depth range
   * always brackets what is actually on screen, whether that is a single system
   * or a spiral arm.
   */
  private updateDepthRange(): void {
    const distance = Math.max(this.targetDistance as number, MIN_TARGET_DISTANCE);

    const near = Math.max(distance * 1e-4, 1e-5);
    const far = Math.max(distance * 1e4, 1e5);

    if (near !== this.camera.near || far !== this.camera.far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.renderer.setAnimationLoop(() => {
      const dt = this.clock.getDelta();
      this.controls.update();
      this.updateDepthRange();
      for (const callback of this.onFrame) callback(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
