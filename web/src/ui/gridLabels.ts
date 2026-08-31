/**
 * The numbers and the direction names on the plane grid.
 *
 * A ring with no number is decoration, and four unlabelled rays could point
 * anywhere. This is the half of the grid that makes it a coordinate system.
 *
 * Its own overlay rather than a part of the map's label layer, because it is a
 * different kind of writing. Those labels name objects and compete with each
 * other for room — they are decluttered, prioritised, and dropped when the map
 * is crowded. These name the graticule. They must never be dropped, never move
 * to make way for a star, and never be mistaken for something that is out
 * there: a reader who reads "2 000 ly" as the name of a place has been misled
 * by the map. So they are drawn in the grid's own colour, at its own weight,
 * and in a layer that knows nothing about objects.
 */

import * as THREE from 'three';

import { CARDINALS } from '../layers/planeGrid';
import { type DistanceUnit, type Parsecs, lyToPc } from '../units';

/** Where the ring numbers sit: on the diagonal, clear of all four rays. */
const RING_BEARING = Math.PI / 4;

const view = new THREE.Vector3();
const clip = new THREE.Vector4();

/**
 * Screen position of a world point, or null when it is not on screen.
 *
 * Written out rather than using Vector3.project, which divides by w without
 * looking at its sign: a point behind a perspective camera comes back mirrored
 * into the view instead of absent, which would put "rimward" on the coreward
 * side of the screen whenever the camera turned round.
 */
function project(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
): { x: number; y: number } | null {
  view.copy(point).applyMatrix4(camera.matrixWorldInverse);
  clip.set(view.x, view.y, view.z, 1).applyMatrix4(camera.projectionMatrix);
  if (clip.w <= 0) return null;
  const x = (clip.x / clip.w) * 0.5 + 0.5;
  const y = -(clip.y / clip.w) * 0.5 + 0.5;
  if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) return null;
  return { x: x * width, y: y * height };
}

export class GridLabels {
  private readonly root: HTMLElement;
  private readonly nodes: HTMLElement[] = [];
  private shown = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'grid-labels';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  set visible(value: boolean) {
    this.shown = value;
    this.root.style.display = value ? '' : 'none';
  }

  /**
   * Place every label for the grid as it currently stands.
   *
   * Takes the ring radii in the displayed unit rather than re-deriving them, so
   * the number written on a ring is the number that ring was drawn from and the
   * two cannot drift apart.
   */
  update(
    camera: THREE.Camera,
    width: number,
    height: number,
    radii: number[],
    reach: Parsecs,
    unit: DistanceUnit,
  ): void {
    if (!this.shown) return;
    camera.updateMatrixWorld();

    let at = 0;
    const place = (
      point: THREE.Vector3,
      text: string,
      className: string,
    ): void => {
      const screen = project(point, camera, width, height);
      if (!screen) return;
      const node = this.nodeAt(at++);
      node.className = className;
      node.textContent = text;
      node.style.transform = `translate(-50%, -50%) translate(${screen.x}px, ${screen.y}px)`;
      node.style.display = '';
    };

    const toPc = (value: number): number =>
      unit === 'ly' ? (lyToPc(value as never) as number) : value;

    for (const radius of radii) {
      const distance = toPc(radius);
      place(
        new THREE.Vector3(
          distance * Math.cos(RING_BEARING),
          distance * Math.sin(RING_BEARING),
          0,
        ),
        // Spaced thousands, and the unit on every ring rather than once in a
        // corner: this is the only place on screen that says which unit the
        // map is currently in, and a bare "500" is exactly the ambiguity the
        // whole units apparatus exists to prevent.
        `${radius.toLocaleString('en-US')} ${unit}`,
        'grid-label',
      );
    }

    const out = reach as number;
    for (const direction of CARDINALS) {
      place(
        new THREE.Vector3(direction.x * out, direction.y * out, 0),
        direction.label,
        'grid-label grid-label-direction',
      );
    }

    for (let i = at; i < this.nodes.length; i++) this.nodes[i].style.display = 'none';
  }

  private nodeAt(index: number): HTMLElement {
    let node = this.nodes[index];
    if (!node) {
      node = document.createElement('div');
      this.root.appendChild(node);
      this.nodes[index] = node;
    }
    return node;
  }

  dispose(): void {
    this.root.remove();
  }
}
