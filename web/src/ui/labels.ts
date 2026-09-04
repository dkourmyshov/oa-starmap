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

import type { DepthOfField } from '../layers/dof';
import { type DistanceUnit, DEFAULT_UNIT, formatOffset, pc } from '../units';

import {
  KIND_CLUSTER,
  KIND_HII,
  KIND_OASTAR,
  KIND_STAR,
  KIND_WORLD,
  type EpochFilter,
  type LayerVisibility,
  type NameMode,
  type ObjectIndex,
} from '../scene/objects';

export const DEFAULT_MAX_LABELS = 45;

/**
 * What a name outside the chosen polity is multiplied by.
 *
 * Not the shaders' 0.14. A ring at a seventh of its brightness is still a ring
 * on a black sky; a word at a seventh is gone, and a map that deletes half its
 * names to answer a question has answered a different one. This is far enough
 * down that the eye stops reading them and near enough that they are still
 * there when looked at. The colour comes off as well, which does most of the
 * work: a grey name recedes behind a coloured one at any opacity.
 */
export const UNFOCUSED_LABEL_GAIN = 0.32;

/**
 * How much taller a label is once it carries its altitude, in pixels.
 *
 * The declutter pass lays boxes out from constants rather than from measured
 * elements — the labels are not in the document when it runs — so this has to
 * match the CSS. It is the second line's own line height, and the map-label-z
 * rule is where the other half of the number lives.
 */
const ALTITUDE_LINE_PX = 12;

/** Re-run the declutter pass at most this often. */
const LAYOUT_INTERVAL_MS = 70;

const KIND_CLASS: Record<number, string> = {
  [KIND_STAR]: 'map-label-star',
  [KIND_CLUSTER]: 'map-label-cluster',
  [KIND_HII]: 'map-label-hii',
  [KIND_OASTAR]: 'map-label-oastar',
  [KIND_WORLD]: 'map-label-world',
};

export class LabelOverlay {
  private readonly root: HTMLElement;
  private readonly pool: HTMLElement[] = [];
  private lastLayout = 0;
  private enabled = true;

  maxLabels = DEFAULT_MAX_LABELS;

  /** The selected object, labelled whatever the declutter pass decides. */
  selected: number | null = null;

  /** Which of an object's names to show. */
  nameMode: NameMode = 'oa';

  /**
   * The year the map is showing, while history mode is on.
   *
   * A property rather than another argument to `update`, because it changes
   * when the reader moves a slider and not once a frame — and because the label
   * layout must never offer a name for a place the layers have stopped drawing.
   */
  epoch: EpochFilter | undefined = undefined;

  /**
   * Print each object's height above the galactic plane under its name.
   *
   * On for the plan view and off otherwise. Looking down the pole is the one
   * projection that discards z entirely, so it is the one that has to say the
   * number out loud; in a perspective view the reader can see it and printing
   * it on forty labels at once would be noise.
   */
  showAltitude = false;

  /** Which unit the altitude is written in. Follows the HUD's toggle. */
  unit: DistanceUnit = DEFAULT_UNIT;

  /**
   * Judge a star by its absolute magnitude, as the plan view does. Passed
   * straight through so the labels name exactly the stars that are drawn.
   */
  absoluteMagnitudes = false;

  /**
   * The depth-of-field settings, or null when the mode is off.
   *
   * Labels have to agree with the shaders about where the focus is. Blurring
   * the sky and leaving the names crisp is worse than not blurring at all: the
   * sharp things read as a flat plane pasted over the scene, which is the
   * opposite of the depth the effect is for.
   */
  depthOfField: DepthOfField | null = null;

  /**
   * Whose names are being picked out, or null for all of them.
   *
   * The layers dim the marks; without this the names went on shouting in forty
   * colours over a map that had gone quiet, which is worse than not dimming at
   * all — the labels are the loudest thing on screen and they were pointing
   * everywhere at once.
   */
  focusPolity: string | null = null;

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
    camera: THREE.Camera,
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
      epoch: this.epoch,
      pinned: this.selected,
      nameMode: this.nameMode,
      absoluteMagnitudes: this.absoluteMagnitudes,
      extraHeight: this.showAltitude ? ALTITUDE_LINE_PX : 0,
    });

    for (let i = 0; i < placed.length; i++) {
      const label = placed[i];
      const node = this.nodeAt(i);
      const kind = this.objects.ref(label.id).kind;

      this.write(node, label.text, label.z);
      // Italic marks an asserted position, not a kind. Keyed off the object's
      // own flag rather than which layer it came from, because the two disagree:
      // Wadai is an entry of the Celestia add-on and a real white dwarf, and
      // setting it in italic claimed the setting had invented its position.
      const asserted = label.asserted ? ' map-label-asserted' : '';
      const pinned = label.pinned ? ' map-label-selected' : '';
      // Outside the chosen polity a name recedes and gives up its colour. The
      // selected object is exempt: it was clicked, and an answer the reader
      // cannot read is not an answer.
      const held =
        this.focusPolity === null ||
        Boolean(label.pinned) ||
        Boolean(label.polities?.includes(this.focusPolity));
      // A class rather than an inline colour, because clearing the inline one
      // does not leave a label grey: every kind carries a colour of its own in
      // the sheet — clusters cyan, H II pink, worlds violet — so an unfocused
      // label simply fell back to that and went on competing in a different hue.
      const muted = held ? '' : ' map-label-muted';
      node.className = `map-label ${KIND_CLASS[kind] ?? ''}${asserted}${pinned}${muted}`;
      node.style.transform = `translate3d(${label.x}px, ${label.y}px, 0) translate(-50%, -50%)`;
      // Faint labels stay legible but recede, so the eye lands on the anchors.
      // The selected one is always full strength: it was asked for.
      const base = label.pinned ? 1 : Math.min(0.45 + label.importance * 0.4, 1);
      // The selected label is never blurred: it was asked for, and an answer
      // the reader cannot read is not an answer.
      const dof =
        this.depthOfField && !label.pinned
          ? this.depthOfField.labelStyle(label.depthPc, label.z)
          : null;
      const gain = held ? 1 : UNFOCUSED_LABEL_GAIN;
      node.style.opacity = String((dof ? base * dof.opacity : base) * gain);
      node.style.filter = dof && dof.blurPx > 0.05 ? `blur(${dof.blurPx.toFixed(2)}px)` : '';
      // The polity colour rides on the label rather than on the object, so a
      // star keeps the colour its photometry actually measured.
      node.style.color = held ? (label.color ?? '') : '';
      node.style.display = '';
      node.dataset.id = String(label.id);
    }

    this.hideFrom(placed.length);
  }

  /**
   * Put the name, and in the plan view the altitude, into a pooled node.
   *
   * Two child spans rather than textContent, because the altitude is set
   * smaller and dimmer than the name and a text node cannot be styled apart
   * from its parent. The second is emptied rather than removed when it is not
   * wanted, so the pool keeps its shape and no node is built per frame.
   */
  private write(node: HTMLElement, text: string, zPc: number): void {
    const [name, altitude] = node.children as unknown as HTMLElement[];
    name.textContent = text;
    altitude.textContent = this.showAltitude ? formatOffset(pc(zPc), this.unit) : '';
    altitude.style.display = this.showAltitude ? '' : 'none';
  }

  private nodeAt(i: number): HTMLElement {
    let node = this.pool[i];
    if (!node) {
      node = document.createElement('button');
      node.className = 'map-label';
      node.appendChild(document.createElement('span'));
      const altitude = document.createElement('span');
      altitude.className = 'map-label-z';
      node.appendChild(altitude);
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
