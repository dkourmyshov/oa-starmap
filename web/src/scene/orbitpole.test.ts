/**
 * OrbitControls reads `object.up` once, in its constructor.
 *
 * This is the assumption the viewer's per-viewpoint up rests on, and it is not
 * ours — it belongs to three.js, and an upgrade could change it in either
 * direction. Pinning it here means the rebuild is either justified or shown to
 * be unnecessary, rather than being cargo carried forward.
 *
 * The failure it guards against was not subtle in effect but was invisible in
 * code: assigning `camera.up` changed what `lookAt` drew while the control went
 * on turning about the axis it was built with, so at the core view a horizontal
 * drag swept the camera through the x-z plane and read on screen as tilting up
 * and down.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';

/** A DOM element with just enough surface for OrbitControls to attach to. */
function stubElement(): HTMLElement {
  return {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getRootNode: () => ({ addEventListener() {}, removeEventListener() {} }),
    ownerDocument: { addEventListener() {}, removeEventListener() {} },
  } as unknown as HTMLElement;
}

/** The axis the control actually turns about, recovered from its own state. */
function poleOf(controls: OrbitControls): THREE.Vector3 {
  const quat = (controls as unknown as { _quat: THREE.Quaternion })._quat;
  return new THREE.Vector3(0, 1, 0).applyQuaternion(quat.clone().invert()).normalize();
}

describe('the orbit control captures up at construction', () => {
  it('does not follow a later change to camera.up', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.up.set(0, 1, 0);
    camera.position.set(0, 0, 65);
    const controls = new OrbitControls(camera, stubElement());

    expect(poleOf(controls).dot(new THREE.Vector3(0, 1, 0))).toBeCloseTo(1, 6);

    camera.up.set(0, 0, 1);
    controls.update();
    // Still the old axis: this is the whole reason the viewer rebuilds.
    expect(poleOf(controls).dot(new THREE.Vector3(0, 1, 0))).toBeCloseTo(1, 6);
    controls.dispose();
  });

  it('picks up the new axis when rebuilt', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.up.set(0, 1, 0);
    camera.position.set(0, 0, 65);
    const first = new OrbitControls(camera, stubElement());
    first.dispose();

    camera.up.set(0, 0, 1);
    const second = new OrbitControls(camera, stubElement());
    expect(poleOf(second).dot(new THREE.Vector3(0, 0, 1))).toBeCloseTo(1, 6);
    second.dispose();
  });
});
