/**
 * One flat index over everything on the map, for labelling and picking.
 *
 * Both of those need the same operation — project every object to screen
 * coordinates and ask what is near a given pixel — so they share one structure
 * rather than each walking the three datasets themselves.
 *
 * It is deliberately flat typed arrays rather than an array of objects. There are
 * ~126,000 entries; allocating a Vector3 per entry per frame is what would make
 * labelling too slow to run in the render loop, so nothing here allocates during
 * projection.
 */

import * as THREE from 'three';

import type { ClusterData, FictionData, HiiData, StarData } from '../data/manifest';

export const KIND_STAR = 0;
export const KIND_CLUSTER = 1;
export const KIND_HII = 2;

export const KIND_NAMES = ['star', 'cluster', 'HII region'] as const;

/**
 * Gaia-era cluster searches name their finds after the survey. There are 5,396 of
 * those against 1,702 classical designations, and a label reading "CWNU_1242"
 * tells you nothing — so they rank far below a name someone chose.
 */
const SURVEY_PREFIX =
  /^(CWNU|HSC|Theia|UPK|UBC|LISC|OCSN|HXHWL|PHOC|FoF|COIN|Casado|Ryu|SAI|Gulliver|OC)[\s_-]?\d/i;

/** Importance before anything about the current view is known. */
const BASE_IMPORTANCE = {
  starProper: 1.0,
  starBayer: 0.55,
  starDesignation: 0.3,
  clusterClassical: 0.7,
  clusterSurvey: 0.1,
  hii: 0.65,
};

/** Added when an object carries an Orion's Arm association — the map's anchors. */
const POLITY_BONUS = 0.6;

export interface ObjectRef {
  kind: number;
  index: number;
}

/** A label the layout algorithm decided to draw, in CSS pixels. */
export interface PlacedLabel {
  id: number;
  text: string;
  x: number;
  y: number;
  importance: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  magnitudeLimit: number;
  maxLabels: number;
  visible: { star: boolean; cluster: boolean; hii: boolean };
}

export interface PickOptions {
  width: number;
  height: number;
  magnitudeLimit: number;
  visible: { star: boolean; cluster: boolean; hii: boolean };
}

/** Half-width of the label box, in pixels per character. Cheap but close enough. */
const CHAR_WIDTH = 6.2;
const LABEL_HEIGHT = 15;
const LABEL_OFFSET = 7;

export class ObjectIndex {
  readonly count: number;

  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  /** Physical radius in pc; zero for stars. */
  private readonly radius: Float32Array;
  /** Absolute magnitude; NaN for anything that is not a star. */
  private readonly absMag: Float32Array;
  private readonly kind: Uint8Array;
  private readonly srcIndex: Int32Array;
  private readonly importance: Float32Array;
  private readonly labels: (string | undefined)[];

  /** Ids that carry a label, so layout never walks the unlabelled majority. */
  private readonly labelled: Int32Array;

  /** Every id, for the pick pass. Built once; picking must consider everything. */
  private readonly everything: Int32Array;

  // Scratch, reused across every projection so the hot loops stay allocation-free.
  private readonly viewProjection = new THREE.Matrix4();
  private readonly screenX: Float32Array;
  private readonly screenY: Float32Array;
  private readonly screenR: Float32Array;
  private readonly onScreen: Uint8Array;

  constructor(
    stars: StarData,
    clusters: ClusterData | null,
    hii: HiiData | null,
    fiction: FictionData | null,
  ) {
    const clusterCount = clusters?.count ?? 0;
    const hiiCount = hii?.count ?? 0;
    const total = stars.count + clusterCount + hiiCount;
    this.count = total;

    this.px = new Float32Array(total);
    this.py = new Float32Array(total);
    this.pz = new Float32Array(total);
    this.radius = new Float32Array(total);
    this.absMag = new Float32Array(total);
    this.kind = new Uint8Array(total);
    this.srcIndex = new Int32Array(total);
    this.importance = new Float32Array(total);
    this.labels = new Array(total);

    this.screenX = new Float32Array(total);
    this.screenY = new Float32Array(total);
    this.screenR = new Float32Array(total);
    this.onScreen = new Uint8Array(total);

    const polityByKind = buildPolityLookup(fiction);
    const labelled: number[] = [];
    let at = 0;

    for (let i = 0; i < stars.count; i++) {
      const base = i * 5;
      this.px[at] = stars.positions[base];
      this.py[at] = stars.positions[base + 1];
      this.pz[at] = stars.positions[base + 2];
      this.absMag[at] = stars.positions[base + 3];
      this.kind[at] = KIND_STAR;
      this.srcIndex[at] = i;

      const names = stars.names[String(i)];
      if (names) {
        if (names.proper) {
          this.labels[at] = names.proper;
          this.importance[at] = BASE_IMPORTANCE.starProper;
        } else if (names.bayer) {
          this.labels[at] = names.bayer;
          this.importance[at] = BASE_IMPORTANCE.starBayer;
        } else if (names.bf || names.gl) {
          this.labels[at] = names.bf || names.gl;
          this.importance[at] = BASE_IMPORTANCE.starDesignation;
        }
      }
      if (polityByKind.star.has(i)) this.importance[at] += POLITY_BONUS;
      if (this.labels[at]) labelled.push(at);
      at++;
    }

    if (clusters) {
      for (let i = 0; i < clusters.count; i++) {
        const base = i * 8;
        this.px[at] = clusters.geometry[base];
        this.py[at] = clusters.geometry[base + 1];
        this.pz[at] = clusters.geometry[base + 2];
        this.radius[at] = clusters.geometry[base + 3];
        this.absMag[at] = NaN;
        this.kind[at] = KIND_CLUSTER;
        this.srcIndex[at] = i;

        const name = clusters.names[i]?.name ?? '';
        this.labels[at] = name.replace(/_/g, ' ');
        this.importance[at] = SURVEY_PREFIX.test(name)
          ? BASE_IMPORTANCE.clusterSurvey
          : BASE_IMPORTANCE.clusterClassical;
        if (polityByKind.cluster.has(i)) this.importance[at] += POLITY_BONUS;
        if (this.labels[at]) labelled.push(at);
        at++;
      }
    }

    if (hii) {
      for (let i = 0; i < hii.count; i++) {
        const base = i * 7;
        this.px[at] = hii.geometry[base];
        this.py[at] = hii.geometry[base + 1];
        this.pz[at] = hii.geometry[base + 2];
        this.radius[at] = hii.geometry[base + 3];
        this.absMag[at] = NaN;
        this.kind[at] = KIND_HII;
        this.srcIndex[at] = i;
        this.labels[at] = hii.names[i]?.name ?? '';
        this.importance[at] = BASE_IMPORTANCE.hii;
        if (polityByKind.hii.has(i)) this.importance[at] += POLITY_BONUS;
        if (this.labels[at]) labelled.push(at);
        at++;
      }
    }

    this.labelled = Int32Array.from(labelled);

    this.everything = new Int32Array(total);
    for (let i = 0; i < total; i++) this.everything[i] = i;
  }

  ref(id: number): ObjectRef {
    return { kind: this.kind[id], index: this.srcIndex[id] };
  }

  /**
   * Project a set of ids to screen pixels, recording radius in pixels too.
   *
   * Writes into the shared scratch arrays. `onScreen` is the authority on whether
   * an entry is usable: anything behind the camera or outside the viewport is
   * marked 0 and its coordinates are meaningless.
   */
  private project(
    camera: THREE.PerspectiveCamera,
    ids: ArrayLike<number>,
    options: PickOptions | LayoutOptions,
  ): void {
    const { width, height, magnitudeLimit, visible } = options;

    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const m = this.viewProjection.elements;

    const cam = camera.position;
    // projectionMatrix[1][1] = 1/tan(fov/2); the same factor the layer shaders use
    // to turn a physical radius into an angular size.
    const focal = camera.projectionMatrix.elements[5];
    const halfHeight = height * 0.5;

    for (let n = 0; n < ids.length; n++) {
      const id = ids[n];
      this.onScreen[id] = 0;

      const kind = this.kind[id];
      if (kind === KIND_STAR && !visible.star) continue;
      if (kind === KIND_CLUSTER && !visible.cluster) continue;
      if (kind === KIND_HII && !visible.hii) continue;

      const x = this.px[id];
      const y = this.py[id];
      const z = this.pz[id];

      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0) continue; // behind the camera

      const ndcX = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      const ndcY = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.2 || ndcY > 1.2) continue;

      const dx = x - cam.x;
      const dy = y - cam.y;
      const dz = z - cam.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (kind === KIND_STAR) {
        // Same magnitude test the star shader applies, so what is clickable is
        // exactly what is drawn.
        const apparent = this.absMag[id] + 5 * Math.log10(Math.max(distance, 1e-6) / 10);
        if (apparent > magnitudeLimit) continue;
        this.screenR[id] = 0;
      } else {
        this.screenR[id] = (this.radius[id] * focal * halfHeight) / Math.max(distance, 1e-4);
      }

      this.screenX[id] = (ndcX * 0.5 + 0.5) * width;
      this.screenY[id] = (-ndcY * 0.5 + 0.5) * height;
      this.onScreen[id] = 1;
    }
  }

  /**
   * What is under the cursor.
   *
   * Deliberately CPU-side rather than a GPU colour-ID pass. Everything on this
   * map is a point sprite, and the sizing rule for each layer already lives in
   * its shader — a pick pass would have to duplicate all three of them and stay
   * in sync forever. Projecting on click instead reuses the sizing rule written
   * here once, costs a few milliseconds for 126,000 objects, and never runs
   * during a frame.
   *
   * Ordering is by kind, not by depth: a star inside a cluster's ring should
   * select the star, and a cluster in front of a nebula should select the
   * cluster.
   */
  pick(
    camera: THREE.PerspectiveCamera,
    x: number,
    y: number,
    options: PickOptions,
    tolerance = 7,
  ): number | null {
    this.project(camera, this.everything, options);

    let best: number | null = null;
    let bestKind = 99;
    let bestScore = Infinity;

    for (let id = 0; id < this.count; id++) {
      if (!this.onScreen[id]) continue;

      const dx = this.screenX[id] - x;
      const dy = this.screenY[id] - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const kind = this.kind[id];

      let score: number;
      if (kind === KIND_STAR) {
        if (distance > tolerance) continue;
        score = distance;
      } else if (kind === KIND_CLUSTER) {
        // Clusters are drawn as rings, so the hollow middle is not the cluster.
        // Small ones are effectively solid marks and stay clickable throughout.
        const r = this.screenR[id];
        const onRing = Math.abs(distance - r) <= tolerance;
        const solid = r <= tolerance && distance <= tolerance;
        if (!onRing && !solid) continue;
        score = Math.abs(distance - r);
      } else {
        const r = Math.max(this.screenR[id], tolerance);
        if (distance > r) continue;
        score = distance;
      }

      if (kind < bestKind || (kind === bestKind && score < bestScore)) {
        best = id;
        bestKind = kind;
        bestScore = score;
      }
    }

    return best;
  }

  /**
   * Choose which labels to draw.
   *
   * Greedy by priority with rejection on overlap: sort candidates by how much
   * they matter in this view, then place them one at a time, skipping any that
   * would collide with one already placed. This is what keeps a dense field from
   * turning into an unreadable pile — the important names win the space.
   */
  layout(camera: THREE.PerspectiveCamera, options: LayoutOptions): PlacedLabel[] {
    this.project(camera, this.labelled, options);

    const candidates: { id: number; priority: number }[] = [];
    for (let n = 0; n < this.labelled.length; n++) {
      const id = this.labelled[n];
      if (!this.onScreen[id]) continue;
      // On-screen size earns a label its place: an object filling the view is
      // worth naming even when it is intrinsically dull, and vice versa.
      const size = Math.min(this.screenR[id] / 40, 1.5);
      candidates.push({ id, priority: this.importance[id] + size });
    }
    candidates.sort((a, b) => b.priority - a.priority);

    const placed: PlacedLabel[] = [];
    const boxes: number[][] = [];

    for (const candidate of candidates) {
      if (placed.length >= options.maxLabels) break;
      const id = candidate.id;
      const text = this.labels[id] as string;

      const halfWidth = (text.length * CHAR_WIDTH) / 2;
      const cx = this.screenX[id];
      const cy = this.screenY[id] - LABEL_OFFSET - LABEL_HEIGHT / 2;
      const left = cx - halfWidth;
      const right = cx + halfWidth;
      const top = cy - LABEL_HEIGHT / 2;
      const bottom = cy + LABEL_HEIGHT / 2;

      if (left < 0 || right > options.width || top < 0 || bottom > options.height) continue;

      let collides = false;
      for (const box of boxes) {
        if (left < box[2] && right > box[0] && top < box[3] && bottom > box[1]) {
          collides = true;
          break;
        }
      }
      if (collides) continue;

      boxes.push([left, top, right, bottom]);
      placed.push({ id, text, x: cx, y: cy, importance: candidate.priority });
    }

    return placed;
  }
}

function buildPolityLookup(fiction: FictionData | null): {
  star: Set<number>;
  cluster: Set<number>;
  hii: Set<number>;
} {
  const lookup = { star: new Set<number>(), cluster: new Set<number>(), hii: new Set<number>() };
  for (const binding of fiction?.bindings ?? []) {
    if (binding.index === null) continue;
    if (binding.kind === 'star') lookup.star.add(binding.index);
    else if (binding.kind === 'cluster') lookup.cluster.add(binding.index);
    else if (binding.kind === 'hii') lookup.hii.add(binding.index);
  }
  return lookup;
}
