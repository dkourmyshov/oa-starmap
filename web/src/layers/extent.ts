/**
 * Extents drawn as instanced quads rather than as point sprites.
 *
 * A cluster, an HII region and a world's error circle are all the same thing to
 * draw: a circle of known physical radius, at a known place, whose size on
 * screen is whatever the projection makes it. Point sprites were the obvious
 * way to do that and are the wrong one, for three reasons that only bite once
 * the circle is large — which on a to-scale plan view is most of the time:
 *
 *  - `gl_PointSize` is capped by the driver, commonly at 1024 pixels. Past that
 *    the sprite stops growing while the shader goes on believing it did, so the
 *    ring, drawn at a fraction of the sprite, is scaled *inward*: zooming in
 *    made nearby clusters shrink. That was the bug that sent this rewrite.
 *  - A point is culled when its centre leaves the viewport, taking a
 *    screen-filling disc with it. Flying into a cluster made it disappear.
 *  - A sprite is square, so a circle of diameter d costs d² fragments where the
 *    ring itself needs a few thousand.
 *
 * A quad has none of those limits: it is ordinary geometry, so it clips instead
 * of vanishing and grows without bound. The corners are pushed out from the
 * projected centre in pixels, which keeps the whole calculation the same as it
 * was and works under either projection.
 */

import * as THREE from 'three';

/**
 * The corner maths, in GLSL.
 *
 * `position` is the quad corner in [-1, 1], which is also what the fragment
 * shaders want in place of `gl_PointCoord * 2.0 - 1.0` — the same coordinate,
 * so the ring and interior code carries over untouched.
 */
export const EXTENT_PARS = /* glsl */ `
  uniform vec2 uViewport;

  /**
   * Screen diameter in device pixels of something radius across, at clipW.
   *
   * clipW is the perspective divide the projection is about to apply:
   * -viewPos.z under a perspective camera, exactly 1.0 under an orthographic
   * one. So this is the true angular size in the first case and an
   * unforeshortened scale in the second, with no branch and no uniform to say
   * which camera is in use.
   */
  float extentPixels(float radius, float clipW) {
    return radius * projectionMatrix[1][1] * uViewport.y / max(clipW, 1e-4);
  }

  /**
   * This corner of a quad diameterPx across, centred on a projected point.
   *
   * The offset is multiplied by w because the perspective divide is still to
   * come and would otherwise shrink the quad by the same factor it shrinks
   * everything else — the size was already decided in pixels.
   */
  vec4 extentCorner(vec4 clipCentre, float diameterPx) {
    vec4 clip = clipCentre;
    clip.xy += position.xy * diameterPx * clipCentre.w / uViewport;
    return clip;
  }
`;

/**
 * One quad, instanced `count` times.
 *
 * Callers add their own per-instance attributes with
 * :func:`instanced`. Frustum culling is off and the bounding sphere infinite:
 * these span the whole dataset, so the test can never reject usefully, and an
 * instance whose centre is off screen may still cover it.
 */
export function extentGeometry(count: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  const corners = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  geometry.setAttribute('position', new THREE.BufferAttribute(corners, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return geometry;
}

export function instanced(array: Float32Array, itemSize: number): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(array, itemSize);
}

/** The uniform every extent layer needs, in device pixels. */
export function extentUniforms(): { uViewport: { value: THREE.Vector2 } } {
  return { uViewport: { value: new THREE.Vector2(1920, 1080) } };
}
