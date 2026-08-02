/**
 * Object labels, drawn as an HTML overlay.
 *
 * The plan called for SDF text in the scene (`troika-three-text`). At the scale
 * this map actually needs — a few dozen labels visible at once, chosen by a
 * declutter pass — DOM elements are the better trade: they are crisp at any
 * device pixel ratio without a font atlas, they inherit the existing panel
 * styling, and they cost no draw calls. SDF text earns its keep when thousands of
 * labels must live inside the 3D scene and be occluded by it; neither is true
 * here, since labels are annotations that should never be hidden behind a star.
 *
 * The elements are pooled. Creating and destroying nodes every frame is what
 * makes DOM overlays slow, so the pool only ever grows to the label cap.
 */

import type * as THREE from 'three';

import {
  KIND_CLUSTER,
  KIND_HII,
  KIND_OASTAR,
  KIND_STAR,
  type LayerVisibility,
  type ObjectIndex,
} from '../scene/objects';

export const DEFAULT_MAX_LABELS = 45;

/** Re-run the declutter pass at most this often. */
const LAYOUT_INTERVAL_MS = 70;

const KIND_CLASS: Record<number, string> = {
  [KIND_STAR]: 'map-label-star',
  [KIND_CLUSTER]: 'map-label-cluster',
  [KIND_HII]: 'map-label-hii',
  [KIND_OASTAR]: 'map-label-oastar',
};

export class LabelOverlay {
  private readonly root: HTMLElement;
  private readonly pool: HTMLElement[] = [];
  private lastLayout = 0;
  private enabled = true;

  maxLabels = DEFAULT_MAX_LABELS;

  constructor(
    parent: HTMLElement,
    private readonly objects: ObjectIndex,
    private readonly onSelect: (id: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'map-labels';
    parent.appendChild(this.root);
  }

  set visible(value: boolean) {
    this.enabled = value;
    this.root.style.display = value ? '' : 'none';
    if (!value) this.hideFrom(0);
  }

  get visible(): boolean {
    return this.enabled;
  }

  update(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    magnitudeLimit: number,
    visibleLayers: LayerVisibility,
    now: number,
  ): void {
    if (!this.enabled) return;
    if (now - this.lastLayout < LAYOUT_INTERVAL_MS) return;
    this.lastLayout = now;

    const placed = this.objects.layout(camera, {
      width,
      height,
      magnitudeLimit,
      maxLabels: this.maxLabels,
      visible: visibleLayers,
    });

    for (let i = 0; i < placed.length; i++) {
      const label = placed[i];
      const node = this.nodeAt(i);
      const kind = this.objects.ref(label.id).kind;

      node.textContent = label.text;
      node.className = `map-label ${KIND_CLASS[kind] ?? ''}`;
      node.style.transform = `translate3d(${label.x}px, ${label.y}px, 0) translate(-50%, -50%)`;
      // Faint labels stay legible but recede, so the eye lands on the anchors.
      node.style.opacity = String(Math.min(0.45 + label.importance * 0.4, 1));
      // The polity colour rides on the label rather than on the object, so a
      // star keeps the colour its photometry actually measured.
      node.style.color = label.color ?? '';
      node.style.display = '';
      node.dataset.id = String(label.id);
    }

    this.hideFrom(placed.length);
  }

  private nodeAt(i: number): HTMLElement {
    let node = this.pool[i];
    if (!node) {
      node = document.createElement('button');
      node.className = 'map-label';
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = Number(node.dataset.id);
        if (Number.isFinite(id)) this.onSelect(id);
      });
      this.root.appendChild(node);
      this.pool[i] = node;
    }
    return node;
  }

  private hideFrom(start: number): void {
    for (let i = start; i < this.pool.length; i++) {
      this.pool[i].style.display = 'none';
    }
  }
}
