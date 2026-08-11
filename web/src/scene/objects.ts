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

import { DEFAULT_SIZE_PX as RING_SIZE_PX } from '../layers/settledField';
import {
  type ClusterData,
  type Colony,
  type FictionData,
  type HiiData,
  type OAStarData,
  type StarData,
  type WorldData,
  affiliationsFor,
} from '../data/manifest';

export const KIND_STAR = 0;
export const KIND_CLUSTER = 1;
export const KIND_HII = 2;
export const KIND_OASTAR = 3;
export const KIND_WORLD = 4;

export const KIND_NAMES = [
  'star',
  'cluster',
  'HII region',
  "Orion's Arm star",
  'world',
] as const;

/**
 * Gaia-era cluster searches name their finds after the survey. There are 5,396 of
 * those against 1,702 classical designations, and a label reading "CWNU_1242"
 * tells you nothing — so they rank far below a name someone chose.
 */
const SURVEY_PREFIX =
  /^(CWNU|HSC|Theia|UPK|UBC|LISC|OCSN|HXHWL|PHOC|FoF|COIN|Casado|Ryu|SAI|Gulliver|OC)[\s_-]?\d/i;

/**
 * HYG's three-letter Greek abbreviations, as they appear in its `bayer` field.
 *
 * That field holds only the letter — "Alp", "Kap-1" — with no constellation, so
 * using it as a label produces "Alp", which names nothing: there are 88 of them.
 * The constellation lives in a separate packed array, and the two have to be put
 * back together here.
 */
const GREEK: Record<string, string> = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ',
  Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ',
  Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ',
  Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/**
 * "Alp-1" + "Cap" -> "α¹ Cap". Falls back to the raw abbreviation for anything
 * not on the Greek list, which is better than dropping the constellation.
 */
export function bayerLabel(bayer: string, constellation: string): string {
  const [letter, index] = bayer.split('-');
  const greek = GREEK[letter] ?? letter;
  const suffix = index && /^\d$/.test(index) ? SUPERSCRIPT[Number(index)] : (index ?? '');
  return constellation ? `${greek}${suffix} ${constellation}` : `${greek}${suffix}`;
}

/**
 * Most a label can gain from its object being large on screen.
 *
 * Worth reading alongside the base weights below, because the two are not
 * independent: only *extended* objects can earn this. A star or an OA marker has
 * no radius, so it scores zero here forever, and a base weight has to be
 * compared against another kind's base **plus** this. That asymmetry is what
 * made named OA systems invisible — at 0.9 they lost to every cluster on screen.
 */
const MAX_SIZE_BONUS = 1.5;

/** Added when an object carries an Orion's Arm association — the map's anchors. */
const POLITY_BONUS = 0.6;

/** Importance before anything about the current view is known. */
const BASE_IMPORTANCE = {
  starProper: 1.0,
  starBayer: 0.55,
  starDesignation: 0.3,
  clusterClassical: 0.7,
  clusterSurvey: 0.1,
  hii: 0.65,

  /**
   * Any system Orion's Arm names, from whichever source named it.
   *
   * One weight for the colony tables, the Celestia add-on and the worlds file
   * alike. Ranking them against each other would encode how far our
   * transcription has got rather than anything about the setting: Wadai used to
   * outrank the whole Inner Sphere because it happens to be one of the few
   * entries we have recorded an article URL for, not because Orion's Arm treats
   * it as more notable than Barnard's Star.
   *
   * Above the ceiling any other kind can reach — a polity-bound cluster filling
   * the view is 0.7 + 0.6 + 1.5 = 2.8 — because this is a map of Orion's Arm and
   * a system it names should be labelled whenever it is on screen.
   */
  oaSystem: 3.0,

  /**
   * A bare JD or YTS designation, which names nothing.
   *
   * Low, so that the 53 filling NGC 6633 cannot bury the cluster itself — but
   * not zero, because an unlabelled marker is a dot that cannot be looked up.
   */
  oaStarNumbered: 0.32,
};

/**
 * What to call a star that hosts one or more canonical worlds.
 *
 * The system's name wherever a world gives one, because a system is not its
 * best-known planet — labelling Sol "Earth" would be wrong the moment Luna or
 * Mars is added, and the same holds for every system that grows a second entry.
 * Only where no world names a system does the label fall back to the worlds
 * themselves, and it names them all rather than picking one arbitrarily.
 */
export function systemLabel(worlds: { name: string; system: string }[]): string {
  const named = worlds.find((w) => w.system);
  if (named) return named.system;
  if (worlds.length <= 2) return worlds.map((w) => w.name).join(' / ');
  return `${worlds[0].name} +${worlds.length - 1}`;
}

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
  /** Polity colour, where the object has one. The marker carries it too. */
  color?: string;
  /** The position is asserted by the fiction, not measured. Drawn in italic. */
  asserted?: boolean;
  /** Placed because it is selected, not because it won a slot. */
  pinned?: boolean;
}

export interface LayerVisibility {
  star: boolean;
  cluster: boolean;
  hii: boolean;
  oastar: boolean;
  world: boolean;
  /** Show only objects Orion's Arm has claimed. */
  oaOnly?: boolean;
}

export interface LayoutOptions {
  width: number;
  height: number;
  magnitudeLimit: number;
  maxLabels: number;
  visible: LayerVisibility;
  /**
   * An object to label whatever the declutter pass decides.
   *
   * The selected one. Having clicked a marker and got a panel about it, the map
   * should say which marker that was — otherwise the panel describes something
   * the reader has to keep track of by memory and mouse position.
   */
  pinned?: number | null;
}

export interface PickOptions {
  width: number;
  height: number;
  magnitudeLimit: number;
  visible: LayerVisibility;
}

/**
 * Which kind wins when several are under the cursor. Lower takes precedence.
 *
 * Stated separately from the kind constants so that adding a layer cannot
 * silently reorder picking: point-like objects must beat the extended ones they
 * sit inside, whatever order the kinds happen to be numbered in.
 */
const PICK_PRIORITY: Record<number, number> = {
  [KIND_STAR]: 0,
  [KIND_OASTAR]: 0,
  [KIND_WORLD]: 0,
  [KIND_CLUSTER]: 1,
  [KIND_HII]: 2,
};

/**
 * Pick radius for a star wearing a polity ring, in pixels.
 *
 * Taken from the ring layer's own size so the two cannot drift: anywhere inside
 * the ring is part of the mark, and clicking it should select the system it is
 * drawn around.
 */
const RING_PICK_RADIUS = RING_SIZE_PX / 2;

/**
 * A stable, spatially meaningless ordering key for one object.
 *
 * Used only to break ties in the label layout. Equal-priority candidates were
 * being placed in the order they appear in the index, which is catalogue order —
 * and HYG is ordered by an id that tracks right ascension, so catalogue order is
 * a sweep across the sky. The visible result was labels filling the screen in a
 * diagonal band: raise the density and the left half fills completely before the
 * right half gets its first label.
 *
 * There is no principled way to rank two objects of equal importance, so the
 * choice is between an arbitrary order that correlates with position and one
 * that does not. This is the second. A hash rather than a random number because
 * it must be identical on every frame — a tiebreak that changed as the camera
 * moved would make labels flicker in and out.
 *
 * The mixing constants are the usual 32-bit avalanche pair; nothing here depends
 * on their particular values beyond scattering nearby ids far apart.
 */
function shuffleKey(id: number): number {
  let x = (id + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
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
  /** 1 where the object carries Orion's Arm content of any kind. */
  private readonly isOA: Uint8Array;
  /** 1 where the position comes from the fiction rather than a measurement. */
  private readonly assertedPosition: Uint8Array;
  /**
   * 1 where a star is drawn no matter how faint it is.
   *
   * The star shader gives a settled system an alpha floor, because most of them
   * are dim red dwarfs that the magnitude law renders nearly invisible. Picking
   * applied the magnitude limit anyway, so those stars were drawn, ringed, and
   * not clickable — which is the worst of the three states.
   */
  private readonly floored: Uint8Array;
  private readonly labelColor: (string | undefined)[];

  /** Tiebreak order for the label layout. See `shuffleKey`. */
  private readonly shuffle: Uint32Array;

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
    oaStars: OAStarData | null = null,
    colonies: Map<number, Colony> | null = null,
    worlds: WorldData | null = null,
  ) {
    const clusterCount = clusters?.count ?? 0;
    const hiiCount = hii?.count ?? 0;
    const oaCount = oaStars?.count ?? 0;
    const worldCount = worlds?.worlds.length ?? 0;
    // Upper bound: hidden Orion's Arm entries are skipped, so the arrays are
    // allocated for the worst case and `count` is trimmed to what was filled.
    const total = stars.count + clusterCount + hiiCount + oaCount + worldCount;

    this.px = new Float32Array(total);
    this.py = new Float32Array(total);
    this.pz = new Float32Array(total);
    this.radius = new Float32Array(total);
    this.absMag = new Float32Array(total);
    this.kind = new Uint8Array(total);
    this.srcIndex = new Int32Array(total);
    this.importance = new Float32Array(total);
    this.labels = new Array(total);
    this.isOA = new Uint8Array(total);
    this.assertedPosition = new Uint8Array(total);
    this.floored = new Uint8Array(total);
    this.labelColor = new Array(total);

    this.screenX = new Float32Array(total);
    this.screenY = new Float32Array(total);
    this.screenR = new Float32Array(total);
    this.onScreen = new Uint8Array(total);

    const polityByKind = buildPolityLookup(fiction);
    const polityColor = new Map<string, string>(
      (fiction?.polities ?? []).map((p) => [p.id, p.color]),
    );
    const polityColorByIndex = new Map<number, string>(
      (fiction?.polities ?? []).map((p) => [p.index, p.color]),
    );
    const constellations = stars.dataset?.layout?.constellations?.values ?? [];
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

      // A canonical world outranks a colony-table row, which outranks the
      // catalogue: an Encyclopaedia article is the most specific thing said
      // about a system, and it is what a reader is looking for.
      const here = worlds?.byStar.get(i);
      if (here?.length) {
        this.labels[at] = systemLabel(here);
        this.importance[at] = BASE_IMPORTANCE.oaSystem;
        this.isOA[at] = 1;
        this.floored[at] = 1;
        this.labelColor[at] = polityColor.get(
          affiliationsFor(colonies?.get(i), here)[0] ?? '',
        );
      }

      // What Orion's Arm calls the system takes precedence over what the sky
      // calls the star: inside the Inner Sphere that is the point of the map.
      const colony = colonies?.get(i);
      if (colony?.colony && !this.labels[at]) {
        this.labels[at] = colony.colony;
        // No bonus for carrying a polity. Belonging to one does not make a
        // system more notable, and adding it here made the assigned systems
        // crowd their unassigned neighbours off the map.
        this.importance[at] = BASE_IMPORTANCE.oaSystem;
        this.isOA[at] = 1;
        this.floored[at] = 1;
        this.labelColor[at] = polityColor.get(
          affiliationsFor(colony, worlds?.byStar.get(i))[0] ?? '',
        );
      }

      const names = stars.names[String(i)];
      if (names && !this.labels[at]) {
        const constellation = constellations[stars.constellation[i]] ?? '';
        if (names.proper) {
          this.labels[at] = names.proper;
          this.importance[at] = BASE_IMPORTANCE.starProper;
        } else if (names.bayer) {
          this.labels[at] = bayerLabel(names.bayer, constellation);
          this.importance[at] = BASE_IMPORTANCE.starBayer;
        } else if (names.flam) {
          // Flamsteed number, which is likewise meaningless without one.
          this.labels[at] = constellation ? `${names.flam} ${constellation}` : names.flam;
          this.importance[at] = BASE_IMPORTANCE.starDesignation;
        } else if (names.gl) {
          this.labels[at] = names.gl;
          this.importance[at] = BASE_IMPORTANCE.starDesignation;
        }
      }
      if (polityByKind.star.has(i)) {
        // A star named on the political maps. The bonus lifts it clear of the
        // catalogue designations, but never past a named system: 3.0 is the top
        // of the scale for a point object, and letting a polity association push
        // anything above it is what made assigned systems outrank their
        // neighbours.
        this.importance[at] = Math.min(
          this.importance[at] + POLITY_BONUS,
          BASE_IMPORTANCE.oaSystem,
        );
        this.isOA[at] = 1;
      }
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
        if (polityByKind.cluster.has(i)) {
          this.importance[at] += POLITY_BONUS;
          this.isOA[at] = 1;
          this.labelColor[at] = polityColorByIndex.get(fiction?.clusterPolity?.[i] ?? 0);
        }
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
        if (polityByKind.hii.has(i)) {
          this.importance[at] += POLITY_BONUS;
          this.isOA[at] = 1;
          this.labelColor[at] = polityColorByIndex.get(fiction?.hiiPolity?.[i] ?? 0);
        }
        if (this.labels[at]) labelled.push(at);
        at++;
      }
    }

    if (oaStars) {
      for (let i = 0; i < oaStars.count; i++) {
        // Entries the add-on says nothing about beyond their cluster are not
        // indexed at all: unlabellable and unclickable, matching what is drawn.
        if (oaStars.names[i]?.hidden) continue;

        const base = i * 5;
        this.px[at] = oaStars.positions[base];
        this.py[at] = oaStars.positions[base + 1];
        this.pz[at] = oaStars.positions[base + 2];
        this.absMag[at] = oaStars.positions[base + 3];
        this.kind[at] = KIND_OASTAR;
        this.srcIndex[at] = i;
        this.isOA[at] = 1;

        // The label is curated: the add-on's own comments name whichever of
        // the system, its primary or its inhabitants a contributor thought of.
        const entry = oaStars.names[i];
        const bound = entry ? worlds?.byOAStar.get(entry.name) : undefined;
        this.labels[at] =
          (bound?.length ? systemLabel(bound) : '') || entry?.label || entry?.name || '';
        // Anything but a bare JD/YTS number counts as named: a designation the
        // add-on chose (Cantor), a system its comment gives, or curation we
        // added. Only the unadorned catalogue numbers rank low.
        const named =
          !entry?.oa_designation ||
          Boolean(entry?.affiliation || entry?.article || entry?.system);
        this.importance[at] = named
          ? BASE_IMPORTANCE.oaSystem
          : BASE_IMPORTANCE.oaStarNumbered;

        // Italic says the position is asserted rather than measured. Most
        // add-on entries are, but a few are real objects it carries because
        // Celestia's catalogue omits them, and those are not.
        this.assertedPosition[at] = entry?.real ? 0 : 1;
        if (entry?.affiliation) this.labelColor[at] = polityColor.get(entry.affiliation);
        if (this.labels[at]) labelled.push(at);
        at++;
      }
    }

    if (worlds) {
      for (let i = 0; i < worlds.worlds.length; i++) {
        const world = worlds.worlds[i];
        // A world bound to a star or an add-on star is already indexed as that
        // object, above. Indexing it again would put two clickable things where
        // the setting describes one place.
        if (world.x === null) continue;

        this.px[at] = world.x;
        this.py[at] = world.y as number;
        this.pz[at] = world.z as number;
        // A volume has a real extent; a point world's circle is only its
        // direction error, which must not make it clickable across the sky.
        this.radius[at] = world.radius_pc ?? 0;
        this.absMag[at] = NaN;
        this.kind[at] = KIND_WORLD;
        this.srcIndex[at] = i;
        this.isOA[at] = 1;
        this.labels[at] = world.name;
        this.importance[at] = BASE_IMPORTANCE.oaSystem;
        // Everything reaching here was placed from the fiction's own numbers;
        // one bound to a catalogue star is indexed as that star instead.
        this.assertedPosition[at] = 1;
        this.labelColor[at] = polityColor.get(world.affiliations[0] ?? '');
        if (this.labels[at]) labelled.push(at);
        at++;
      }
    }

    this.labelled = Int32Array.from(labelled);

    this.shuffle = new Uint32Array(at);
    for (let id = 0; id < at; id++) this.shuffle[id] = shuffleKey(id);

    // Trailing slots were never filled. Leaving them in would make the pick pass
    // scan zeroed entries, which read as stars sitting exactly on Sol.
    this.count = at;
    this.everything = new Int32Array(at);
    for (let i = 0; i < at; i++) this.everything[i] = i;
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
      if (kind === KIND_OASTAR && !visible.oastar) continue;
      if (kind === KIND_WORLD && !visible.world) continue;
      if (visible.oaOnly && !this.isOA[id]) continue;

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
        // exactly what is drawn — except for the stars the shader floors, which
        // are drawn however faint they are and must stay clickable to match.
        if (!this.floored[id]) {
          const apparent = this.absMag[id] + 5 * Math.log10(Math.max(distance, 1e-6) / 10);
          if (apparent > magnitudeLimit) continue;
        }
        // A ringed star is a mark about 13 pixels across, not a point. Clicking
        // anywhere on the ring should select the system it encircles.
        this.screenR[id] = this.floored[id] ? RING_PICK_RADIUS : 0;
      } else if (kind === KIND_OASTAR || kind === KIND_WORLD) {
        // Drawn as constant-size markers regardless of the magnitude limit, so
        // gating them on it here would make visible markers unclickable.
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
   *
   * Within a kind it is by *importance* before proximity. Nearest-wins sounds
   * neutral and is not: in the Inner Sphere a named system sits among dozens of
   * anonymous catalogue stars, so nearest-wins hands back a dull neighbour more
   * often than the thing being aimed at, and the only way to hit the system was
   * to zoom in until nothing else was within range. Someone clicking within a
   * few pixels of a named place meant the named place.
   *
   * None of this depends on whether a label is drawn. Every object is scanned
   * here, labelled or not — labels come from `layout`, which walks a separate
   * list of only the labelled ones — so an unlabelled object is clickable and
   * always has been.
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
    let bestRank = -Infinity;
    let bestScore = Infinity;

    for (let id = 0; id < this.count; id++) {
      if (!this.onScreen[id]) continue;

      const dx = this.screenX[id] - x;
      const dy = this.screenY[id] - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const kind = this.kind[id];

      let score: number;
      if (kind === KIND_STAR || kind === KIND_OASTAR || kind === KIND_WORLD) {
        const reach = Math.max(this.screenR[id], tolerance);
        if (distance > reach) continue;
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

      const priority = PICK_PRIORITY[kind] ?? 99;
      // Quantised, so a hair's difference in weight cannot beat a click that was
      // plainly aimed somewhere else.
      const rank = Math.round(this.importance[id] * 4);
      const better =
        priority < bestKind ||
        (priority === bestKind &&
          (rank > bestRank || (rank === bestRank && score < bestScore)));
      if (better) {
        best = id;
        bestKind = priority;
        bestRank = rank;
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
    // `labelled` omits anything without a name, and a pinned object may be one
    // of those — its screen position would otherwise be a stale value from an
    // earlier frame.
    if (options.pinned != null && !this.labels[options.pinned]) {
      this.onScreen[options.pinned] = 0;
    }

    const candidates: { id: number; priority: number; tiebreak: number }[] = [];
    for (let n = 0; n < this.labelled.length; n++) {
      const id = this.labelled[n];
      if (!this.onScreen[id]) continue;
      // On-screen size earns a label its place: an object filling the view is
      // worth naming even when it is intrinsically dull, and vice versa.
      //
      // Gated on having a real physical extent, not merely a non-zero screen
      // radius. A ringed star carries one now so that clicks land anywhere on
      // its ring, and without this guard that pick radius would leak in here as
      // a priority bonus — putting settled systems back above their neighbours
      // through the side door.
      const size =
        this.radius[id] > 0 ? Math.min(this.screenR[id] / 40, MAX_SIZE_BONUS) : 0;
      candidates.push({ id, priority: this.importance[id] + size, tiebreak: this.shuffle[id] });
    }
    // Priority first, exactly; the shuffle only ever separates equals, so it
    // cannot promote a less important label above a more important one.
    candidates.sort((a, b) => b.priority - a.priority || a.tiebreak - b.tiebreak);

    const placed: PlacedLabel[] = [];
    const boxes: number[][] = [];

    // The pinned label goes down first and unconditionally: it claims its space
    // before anything competes for it, and it is never rejected for collision,
    // because the one label the reader has asked for should not be the one that
    // loses. It is skipped below so it cannot be placed twice.
    const pinned = options.pinned ?? null;
    if (pinned !== null && this.onScreen[pinned] && this.labels[pinned]) {
      const text = this.labels[pinned] as string;
      const halfWidth = (text.length * CHAR_WIDTH) / 2;
      const cx = this.screenX[pinned];
      const cy = this.screenY[pinned] - LABEL_OFFSET - LABEL_HEIGHT / 2;
      boxes.push([cx - halfWidth, cy - LABEL_HEIGHT / 2, cx + halfWidth, cy + LABEL_HEIGHT / 2]);
      placed.push({
        id: pinned,
        text,
        x: cx,
        y: cy,
        importance: this.importance[pinned],
        color: this.labelColor[pinned],
        asserted: this.assertedPosition[pinned] === 1,
        pinned: true,
      });
    }

    for (const candidate of candidates) {
      if (candidate.id === pinned) continue;
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
      placed.push({
        id,
        text,
        x: cx,
        y: cy,
        importance: candidate.priority,
        color: this.labelColor[id],
        asserted: this.assertedPosition[id] === 1,
      });
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
