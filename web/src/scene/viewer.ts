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
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';

import { type Parsecs, pc } from '../units';

/**
 * Point the camera's up vector along its own screen-up.
 *
 * TrackballControls builds its drag basis from `camera.up`: the sideways axis is
 * `up x eye`, and the rotation axis is `moveDirection x eye`. A cross product
 * with `eye` discards whatever part of its argument lies along `eye` — so if
 * `up` is parallel to the line of sight, the vertical half of a drag cancels
 * entirely and every drag turns about one fixed axis. That is exactly the top
 * view: the camera sits on the galactic pole and orbit mode wants `up` to *be*
 * the pole, which leaves the two collinear.
 *
 * The camera's own screen-up is perpendicular to the line of sight by
 * construction and describes the orientation already on screen, so adopting it
 * conditions the basis without moving anything.
 */
function alignUpToScreen(camera: THREE.Camera): void {
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
}

/** Closest approach, in parsecs. Below this the camera is effectively inside a star. */
const MIN_TARGET_DISTANCE = 1e-3;

/** Far enough to see the whole dataset from outside. */
const MAX_TARGET_DISTANCE = 1e5;

/** Opening range, in parsecs. Wide enough to show the nearby field around Sol. */
const DEFAULT_RANGE = 65;

/**
 * How much of the depth axis the plan view keeps, in parsecs either side.
 *
 * Orthographic near and far are distances along the view axis and may be
 * negative, so this brackets the whole dataset from wherever the camera sits
 * and nothing is ever clipped for being behind it. Depth precision does not
 * matter: every layer here is an unsorted transparent sprite that neither tests
 * nor writes depth.
 */
const FLAT_DEPTH = 2e5;

/**
 * Half-height of the perspective view, as a fraction of the target distance.
 *
 * tan(fov/2) for the 60-degree field below. Switching between the projections
 * matches this to the orthographic half-height, so the map neither jumps nor
 * rescales at the moment the projection changes.
 */
const HALF_HEIGHT_AT_UNIT_DISTANCE = Math.tan((60 * Math.PI) / 180 / 2);

/**
 * The preset viewpoints, as offsets from whatever the camera is orbiting.
 *
 * Expressed in the map's own frame rather than as camera angles: x is coreward,
 * y is spinward, z is galactic north. Naming them after what they show — the
 * plane from above, the plane edge-on, the direction of the core — keeps the
 * buttons meaningful when the orbit target is a cluster rather than Sol.
 */
export type Viewpoint = 'top' | 'spin' | 'core' | 'tilted';

/**
 * How dragging moves the camera.
 *
 * `orbit` turns about galactic north: a horizontal drag sweeps galactic
 * longitude and the pole stays up, which keeps the plane level and makes the
 * viewpoint presets mean what they say. Seen from directly overhead, though,
 * sweeping longitude *is* the map spinning, which is the least useful rotation
 * from that angle.
 *
 * `trackball` turns about the screen's own axes instead: dragging left and
 * right rotates about the screen's vertical, dragging up and down about its
 * horizontal, with no fixed pole. That is the more direct thing when you are
 * looking straight down at a plane and want to tip it towards you. The cost is
 * that the horizon can roll and "up" stops meaning galactic north — which is
 * why it is a choice rather than a replacement.
 */
export type ControlMode = 'orbit' | 'galactic' | 'trackball';

/**
 * Perspective, or the flat plan view.
 *
 * `2d` is the map projection every printed star atlas uses and this one so far
 * has not: looking straight down the galactic pole with an orthographic camera,
 * so that a parsec is the same number of pixels wherever it lies. Perspective
 * is what makes a 3D view legible as depth, and it is exactly what makes a
 * *map* unreadable — two systems the same distance apart draw at different
 * sizes depending on where they sit, so nothing can be measured off the screen
 * and near things hide far ones behind them.
 *
 * Flattening throws the depth away, so the flat view has to give it back some
 * other way. It does so twice over: every label carries its own z beneath the
 * name, and the depth-of-field blur switches from distance-from-camera to
 * displacement from the plane the camera is looking at, which is the only depth
 * left to blur by. Neither is a substitute for the third dimension; together
 * they are enough to read a plan view without mistaking it for a flat galaxy.
 *
 * Rotation is off in this mode. A plan view that can be tilted is a perspective
 * view with the perspective missing, and the whole value of it is that north
 * is up and coreward is right, always.
 */
export type Projection = '3d' | '2d';

export const PROJECTIONS: { id: Projection; label: string; title: string }[] = [
  { id: '3d', label: '3D', title: 'Perspective, free to orbit' },
  { id: '2d', label: '2D', title: 'Plan view down the galactic pole, to scale, z on the labels' },
];

export const CONTROL_MODES: { id: ControlMode; label: string; title: string }[] = [
  {
    id: 'orbit',
    label: 'orbit',
    title: "Turn about the screen's vertical, re-chosen for each viewpoint",
  },
  {
    id: 'galactic',
    label: 'galaxy',
    title: 'Turn about galactic north always; the plane stays level',
  },
  {
    id: 'trackball',
    label: 'free',
    title: "Turn about the screen's own axes; free, but the horizon can roll",
  },
];

/** Galactic north, the pole the fixed-axis mode always turns about. */
const GALACTIC_NORTH = new THREE.Vector3(0, 0, 1);

export const VIEWPOINTS: { id: Viewpoint; label: string; title: string }[] = [
  { id: 'top', label: 'top', title: 'From galactic north, looking down on the plane' },
  { id: 'spin', label: 'spin', title: 'In the galactic plane, looking spinward' },
  { id: 'core', label: 'core', title: 'Looking towards the galactic centre' },
  { id: 'tilted', label: 'tilted', title: 'Three-quarter view, so the plane reads as a plane' },
];

/**
 * Which way is up on screen, per viewpoint — and so which axis orbiting turns
 * about.
 *
 * These are the same question. OrbitControls sweeps azimuth about `camera.up`,
 * so a horizontal drag turns the view about whatever that axis is; when up is
 * also what points up on screen, a horizontal drag turns the map about the
 * screen's vertical, which is what the gesture looks like it should do.
 *
 * It goes wrong when up lies along the line of sight, because then there is no
 * screen direction for it to be and turning about it merely spins the image.
 * That was the whole of the trouble: a single global up of galactic north put
 * the pole exactly down the barrel of the top view, which is the default.
 *
 * So each viewpoint names an up perpendicular to its own line of sight, and
 * every preset starts at the equator of its control sphere rather than at a
 * pole. Galactic north wherever the view is edge-on to the plane, spinward
 * looking down at it — which is the orientation Orion's Arm draws anyway,
 * coreward to the right.
 */
const UP_REFERENCE: Record<Viewpoint, THREE.Vector3> = {
  // Galactic north wherever the view is edge-on to the plane; spinward looking
  // down at it, since north is then the line of sight and cannot be up as well.
  top: new THREE.Vector3(0, 1, 0),
  spin: new THREE.Vector3(0, 0, 1),
  core: new THREE.Vector3(0, 0, 1),
  tilted: new THREE.Vector3(0, 0, 1),
};

/**
 * The up vector for a viewpoint: its reference direction with the line of sight
 * projected out.
 *
 * The projection is what makes the result exactly perpendicular rather than
 * merely close, and it is done here rather than by writing perpendicular
 * vectors into the table so that the property cannot be lost by hand. `tilted`
 * is the case that shows why — it looks obliquely at the plane, so plain
 * galactic north sits 67 degrees off its line of sight, close enough to work
 * and not close enough to be the screen's vertical.
 */
export function viewpointUp(name: Viewpoint): THREE.Vector3 {
  const view = viewpointPosition(name, 1).negate().normalize();
  const reference = UP_REFERENCE[name].clone().normalize();
  const up = reference.sub(view.clone().multiplyScalar(reference.dot(view)));
  if (up.lengthSq() < 1e-9) {
    // The reference lies along the view, so there is no up to derive from it.
    // Reaching here means a preset's reference needs choosing again.
    throw new Error(`viewpoint ${name} has an up reference along its line of sight`);
  }
  return up.normalize();
}

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
  readonly renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  readonly trackball: TrackballControls;

  /**
   * Both cameras exist for the life of the viewer, and `camera` names whichever
   * is drawing.
   *
   * Kept as two objects rather than one that is rebuilt, because the controls
   * bind to a camera at construction and everything that has to survive a
   * projection change — where the camera is, what it is orbiting, how far out —
   * is copied across explicitly at the switch. The trackball stays bound to the
   * perspective camera for good: free rotation is a perspective idea, and the
   * plan view turns it off.
   */
  private readonly perspective: THREE.PerspectiveCamera;
  private readonly ortho: THREE.OrthographicCamera;
  private projection: Projection = '3d';

  private mode: ControlMode = 'orbit';
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

    this.perspective = new THREE.PerspectiveCamera(60, 1, 0.01, 1e6);
    // Up comes from the viewpoint rather than being a constant of the map. It is
    // the axis a horizontal drag turns about as well as the direction that ends
    // up pointing up on screen, and those are only the same thing when it lies
    // across the line of sight — see `viewpointUp`.
    this.perspective.up.copy(viewpointUp('top'));
    this.perspective.position.copy(viewpointPosition('top', DEFAULT_RANGE));

    // A unit-height frustum, with `zoom` carrying the scale: the visible half
    // height in parsecs is exactly 1 / zoom, which is the number the plan view
    // needs for its magnitude reference and its blur span, and it is the
    // quantity OrbitControls already multiplies when the wheel is turned.
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -FLAT_DEPTH, FLAT_DEPTH);
    // Spinward up, coreward to the right — the orientation Orion's Arm draws.
    this.ortho.up.set(0, 1, 0);
    this.ortho.position.set(0, 0, DEFAULT_RANGE);
    this.ortho.zoom = 1 / (DEFAULT_RANGE * HALF_HEIGHT_AT_UNIT_DISTANCE);
    this.ortho.lookAt(0, 0, 0);

    this.controls = this.makeOrbitControls();

    this.trackball = new TrackballControls(this.perspective, canvas);
    this.trackball.target.set(0, 0, 0);
    this.trackball.rotateSpeed = 2.2;
    this.trackball.zoomSpeed = 1.1;
    this.trackball.panSpeed = 0.6;
    this.trackball.dynamicDampingFactor = 0.12;
    this.trackball.minDistance = MIN_TARGET_DISTANCE;
    this.trackball.maxDistance = MAX_TARGET_DISTANCE;
    this.trackball.enabled = false;

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  /**
   * A fresh OrbitControls, reading the camera's *current* up vector.
   *
   * It has to be built rather than adjusted. OrbitControls converts `object.up`
   * into an internal quaternion once, in its constructor, and `update` never
   * looks at `object.up` again — so assigning `camera.up` afterwards changes
   * only what `lookAt` does to the rendered image, while the control goes on
   * turning about the axis it was born with. That split is worse than either
   * axis alone: with the pole left at spinward and the image drawn north-up,
   * a horizontal drag at the core view swept the camera through the x-z plane,
   * which reads on screen as tilting up and down.
   *
   * Rebuilding uses only public API, where reaching into the private quaternion
   * would work until three.js renamed it. Viewpoint changes come from button
   * presses, so the cost is nothing.
   */
  private makeOrbitControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 1.1;
    controls.minDistance = MIN_TARGET_DISTANCE;
    controls.maxDistance = MAX_TARGET_DISTANCE;
    // Under an orthographic camera the dolly does not move: OrbitControls scales
    // `zoom` instead, so the same wheel notch has to be bounded in that quantity
    // rather than in distance. These are the same two limits read as half
    // heights, since half height is 1 / zoom.
    controls.minZoom = 1 / MAX_TARGET_DISTANCE;
    controls.maxZoom = 1 / MIN_TARGET_DISTANCE;
    // The plan view is a map: north up, coreward right, and no way to tilt it
    // into a perspective view with the perspective missing.
    const flat = this.projection === '2d';
    controls.enableRotate = !flat;
    if (flat) {
      // Drag to move the map, which is the gesture every map has. The default
      // binding puts rotation on the left button and panning on the right, so
      // turning rotation off on its own leaves a left drag doing nothing at all
      // — the view stayed pinned to Sol or to whatever was last flown to, and
      // there was no way to look at anywhere else at that scale.
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    }
    // Panning must move in world space, not screen space, or it drifts off the
    // galactic plane in a way that is disorienting at large scales.
    controls.screenSpacePanning = true;
    return controls;
  }

  /** Rebuild the orbit control so its pole follows a changed `camera.up`. */
  private resyncOrbitPole(): void {
    const previous = this.controls;
    const target = previous.target.clone();
    const enabled = previous.enabled;
    previous.dispose();

    this.controls = this.makeOrbitControls();
    this.controls.target.copy(target);
    this.controls.enabled = enabled;
    this.controls.update();
  }

  /**
   * Swap how dragging moves the camera, keeping where it is pointing.
   *
   * Returning to orbit restores galactic north as the up vector. A trackball
   * drag is free to roll the camera, and OrbitControls reads up as the axis it
   * turns about — so leaving a rolled-up in place would make the presets and
   * the horizon disagree with everything else on screen. The snap back to level
   * is visible, and is the honest consequence of the two modes not sharing a
   * notion of up.
   */
  setControlMode(mode: ControlMode): void {
    if (mode === this.mode) return;
    // Nothing to choose between while the plan view is up: it does not rotate,
    // so every mode differs only in an axis none of them turns about.
    if (this.projection === '2d') return;
    this.mode = mode;

    const from = mode === 'trackball' ? this.controls : this.trackball;
    const to = mode === 'trackball' ? this.trackball : this.controls;
    to.target.copy(from.target);

    // `galactic` pins the pole to north whatever is on screen, which is what
    // keeps the plane level and is the whole point of it. The other two want up
    // across the line of sight — orbit so a horizontal drag turns about the
    // screen's vertical rather than spinning the image, trackball so its drag
    // basis does not collapse. The camera's own screen-up satisfies both and
    // preserves the orientation already showing.
    if (mode === 'galactic') this.camera.up.copy(GALACTIC_NORTH);
    else alignUpToScreen(this.camera);
    if (mode !== 'trackball') this.resyncOrbitPole();

    this.trackball.enabled = mode === 'trackball';
    this.controls.enabled = mode !== 'trackball';
    this.active.update();
  }

  get controlMode(): ControlMode {
    return this.mode;
  }

  /** Whichever camera is drawing. */
  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.projection === '2d' ? this.ortho : this.perspective;
  }

  get projectionMode(): Projection {
    return this.projection;
  }

  /**
   * Half the height of what is on screen, in parsecs — but only in the plan
   * view, and 0 in perspective, where there is no single such number.
   *
   * Two things outside this module need it. The star field computes every
   * apparent magnitude at it, because an orthographic camera is not standing
   * anywhere for a distance to be measured from; and the depth-of-field blur
   * scales its z displacement by it, so the far field falls off at a fixed
   * fraction of the view rather than at a fixed number of parsecs.
   */
  get flatHalfHeight(): Parsecs {
    return pc(this.projection === '2d' ? 1 / this.ortho.zoom : 0);
  }

  /**
   * Switch between perspective and the plan view, keeping what is on screen.
   *
   * "Keeping" means two separate things that have to be converted between. The
   * perspective camera frames by *distance*: half the view is `range * tan(fov/2)`
   * across. The orthographic one frames by `zoom` and does not care where it is
   * standing. Matching the two through that factor is what stops the map
   * jumping in scale at the moment the button is pressed.
   */
  setProjection(projection: Projection): void {
    if (projection === this.projection) return;

    // Free rotation belongs to perspective; leaving it selected would hand the
    // plan view to a control that is about to be disabled anyway.
    if (projection === '2d' && this.mode === 'trackball') this.setControlMode('orbit');

    const previous = this.active;
    const target = previous.target.clone();
    const range = Math.max(this.camera.position.distanceTo(target), MIN_TARGET_DISTANCE);

    this.projection = projection;

    if (projection === '2d') {
      this.ortho.up.set(0, 1, 0);
      this.ortho.position.copy(target).add(new THREE.Vector3(0, 0, range));
      this.ortho.zoom = 1 / (range * HALF_HEIGHT_AT_UNIT_DISTANCE);
      this.ortho.lookAt(target);
      this.ortho.updateProjectionMatrix();
    } else {
      // The wheel moved `zoom` and left the camera where it stood, so the
      // standoff is stale and the zoom is the honest record of the scale.
      const framed = 1 / this.ortho.zoom / HALF_HEIGHT_AT_UNIT_DISTANCE;
      this.perspective.up.copy(viewpointUp('top'));
      this.perspective.position.copy(target).add(viewpointPosition('top', framed));
      this.perspective.lookAt(target);
    }

    this.handleResize();
    this.resyncOrbitPole();
    this.controls.target.copy(target);
    // The mode cannot be trackball here — entering the plan view puts it back
    // to orbit above, and leaving cannot select it — so these are the same two
    // lines setControlMode writes, applied to the rebuilt control.
    this.controls.enabled = this.mode !== 'trackball';
    this.trackball.enabled = this.mode === 'trackball';
    this.controls.update();
  }

  /** Whichever control is currently driving the camera. */
  private get active(): OrbitControls | TrackballControls {
    return this.mode === 'trackball' ? this.trackball : this.controls;
  }

    /**
   * Move to a preset viewpoint, keeping the current range and orbit target.
   *
   * The range is preserved deliberately: these change where you are looking
   * from, not how far away you are, so switching viewpoint while examining a
   * cluster keeps the cluster the same size on screen.
   */
  setViewpoint(name: Viewpoint): void {
    // The plan view has exactly one viewpoint, which is what makes it a map.
    if (this.projection === '2d') return;

    const controls = this.active;
    const range = this.camera.position.distanceTo(controls.target);
    // Each preset carries its own up, chosen across its line of sight, so the
    // view arrives correctly oriented *and* well conditioned to drag from.
    // In the fixed-axis mode the pole is north wherever you go, degenerate top
    // view and all: that is the behaviour being asked for, not an oversight.
    this.camera.up.copy(this.mode === 'galactic' ? GALACTIC_NORTH : viewpointUp(name));
    this.camera.position
      .copy(controls.target)
      .add(viewpointPosition(name, range || DEFAULT_RANGE));
    this.camera.lookAt(controls.target);
    // The control's pole is fixed at construction, so a changed up only reaches
    // it through a rebuild.
    if (this.mode !== 'trackball') this.resyncOrbitPole();
    else controls.update();
  }

  /** Distance from the camera to whatever it is orbiting. */
  get targetDistance(): Parsecs {
    return pc(this.camera.position.distanceTo(this.active.target));
  }

  /**
   * Distance from the camera to whatever it is orbiting.
   *
   * Reads the *active* controls: in trackball mode the orbit controls keep a
   * stale target, so asking them directly holds the focus wherever the camera
   * last was in the other mode.
   */
  get focusDistance(): Parsecs {
    return pc(this.camera.position.distanceTo(this.active.target));
  }

  /** What the camera is orbiting, from whichever control is driving it. */
  get focusTarget(): THREE.Vector3 {
    return this.active.target;
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
    const controls = this.active;
    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, controls.target)
      .normalize();
    if (direction.lengthSq() === 0) direction.set(0, -1, 0.4).normalize();

    controls.target.copy(position);
    this.camera.position.copy(position).addScaledVector(direction, standoff as number);
    // Moving an orthographic camera back does not frame anything differently —
    // it has no perspective to widen — so the standoff has to be spent on the
    // zoom as well, or a jump to a cluster in the plan view would recentre it
    // and leave the scale wherever it was.
    if (this.projection === '2d') {
      this.ortho.zoom = 1 / ((standoff as number) * HALF_HEIGHT_AT_UNIT_DISTANCE);
      this.ortho.updateProjectionMatrix();
    }
    // Both controls carry a target, and only the active one may be moved: the
    // other is updated when the mode is switched.
    controls.update();
  }

  private handleResize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;

    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    // A unit-height frustum widened to the viewport, so `zoom` alone carries
    // the scale and half the visible height stays 1 / zoom whatever the shape
    // of the window.
    this.ortho.left = -aspect;
    this.ortho.right = aspect;
    this.ortho.top = 1;
    this.ortho.bottom = -1;
    this.ortho.updateProjectionMatrix();
    // TrackballControls caches the canvas rectangle and maps pointer motion
    // through it, so without this a resize leaves dragging misaligned with the
    // cursor. OrbitControls reads the rectangle per event and needs nothing.
    this.trackball.handleResize();
  };

  /**
   * Keep the depth range tied to the current viewing scale.
   *
   * Anchoring both planes to the target distance means the usable depth range
   * always brackets what is actually on screen, whether that is a single system
   * or a spiral arm.
   */
  private updateDepthRange(): void {
    // The plan view brackets the whole dataset once, at construction. Its near
    // and far are distances along the view axis rather than from a viewpoint,
    // and narrowing them to the current scale would clip away exactly the
    // out-of-plane objects the mode exists to show the z of.
    if (this.projection === '2d') return;

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
      this.active.update();
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
    this.trackball.dispose();
    this.renderer.dispose();
  }
}
