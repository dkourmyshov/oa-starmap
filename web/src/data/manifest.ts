/**
 * Loading the pipeline's output.
 *
 * The manifest is the contract between the two halves of the project. It declares
 * the coordinate frame, the storage unit and the binary layout, so the renderer
 * never has to assume how to unpack a file — and a unit change on the pipeline
 * side surfaces here as a loud failure rather than a silently rescaled map.
 */

import { PC_TO_LY } from '../units';

export interface ArrayFile {
  file: string;
  dtype: string;
  shape: number[];
  bytes: number;
}

export interface StarsDataset {
  count: number;
  frame: {
    name: string;
    unit: string;
    axes: Record<string, string>;
    origin: string;
  };
  layout: {
    positions: {
      components: string[];
      units: string[];
      ci_unknown_sentinel: number;
    };
    ids: { components: string[]; absent_sentinel: number };
    classes: { values: string[] };
    constellations: { values: string[] };
    color_lut: { components: string[]; index: string };
  };
  files: {
    positions: ArrayFile;
    ids: ArrayFile;
    classes: ArrayFile;
    constellations: ArrayFile;
    names: { file: string; bytes: number };
    color_lut: ArrayFile;
  };
  selection: {
    rule: string;
    note: string;
    reliability: { unreliable_beyond_pc: number; why: string };
  };
  stats: {
    total_rows: number;
    accepted: number;
    excluded: Record<string, number>;
  };
  source: { description: string; citation: string; url: string; sha256: string };
}

export interface ClustersDataset {
  count: number;
  frame: { name: string; unit: string; axes: Record<string, string>; origin: string };
  layout: {
    geometry: { components: string[]; units: string[]; note: string };
    meta: { components: string[] };
    types: { order: string[]; labels: Record<string, string> };
    ages: { units: string; note: string };
  };
  files: {
    geometry: ArrayFile;
    meta: ArrayFile;
    ages: ArrayFile;
    names: { file: string; bytes: number };
  };
  selection: { rule: string; note: string };
  stats: { total_rows: number; accepted: number; excluded: Record<string, number> };
  source: { description: string; citation: string; url: string; sha256: string };
}

export interface ClusterName {
  name: string;
  aliases: string;
  quality: string;
}

export interface ClusterData {
  count: number;
  /** [x, y, z, radius_total, radius_core, distance, distance_lo, distance_hi] per cluster. */
  geometry: Float32Array;
  /** [type_index, member_count] per cluster. */
  meta: Int32Array;
  ages: Float32Array;
  names: ClusterName[];
  dataset: ClustersDataset;
}

export interface HiiDataset {
  count: number;
  frame: { name: string; unit: string; axes: Record<string, string>; origin: string };
  layout: {
    geometry: { components: string[]; units: string[]; note: string };
    meta: { components: string[] };
    methods: { order: string[]; note: string };
  };
  files: {
    geometry: ArrayFile;
    meta: ArrayFile;
    names: { file: string; bytes: number };
  };
  selection: { rule: string; note: string };
  stats: {
    total_rows: number;
    accepted: number;
    excluded: Record<string, number>;
    methods: Record<string, number>;
  };
  source: { description: string; citation: string; url: string; sha256: string };
}

export interface HiiName {
  name: string;
  aliases: string;
  complex: string;
  diameter_arcmin: number;
  brightness: string;
  form: string;
  structure: string;
}

export interface HiiData {
  count: number;
  /** [x, y, z, radius, distance, distance_lo, distance_hi] per region. */
  geometry: Float32Array;
  /** [method_index, sharpless_number] per region. */
  meta: Int32Array;
  names: HiiName[];
  dataset: HiiDataset;
}

export interface OAStarsDataset {
  count: number;
  frame: { name: string; unit: string; axes: Record<string, string>; origin: string };
  layout: {
    positions: { components: string[]; units: string[]; ci_unknown_sentinel: number; note: string };
  };
  files: {
    positions: ArrayFile;
    names: { file: string; bytes: number };
  };
  selection: { rule: string; note: string };
  stats: { total_entries: number; accepted: number; excluded: Record<string, number> };
  source: {
    description: string;
    citation: string;
    url: string;
    sha256: string;
    distance_unit: string;
  };
}

export interface OAStarName {
  name: string;
  /** Curated display name, from fiction/oa_systems.yaml. */
  label: string;
  comment: string;
  spectral_type: string;
  distance_pc: number;
  /** True only for OA's own JD/YTS numbering. False is not a claim of reality. */
  oa_designation: boolean;
  /** System the star is the sun of, as the add-on's comment has it. */
  system: string;
  /** Polity id, or empty where the affiliation is unsettled. */
  affiliation: string;
  /**
   * Catalogue designation, where this entry is a real object the add-on carries
   * only because Celestia's catalogue omits it. Non-empty means the position is
   * a copied measurement rather than an assertion.
   */
  real: string;
  /** The affiliation is recorded but not asserted. */
  uncertain: boolean;
  article: string;
  note: string;
  /** The add-on says nothing about this beyond where it sits. */
  hidden: boolean;
  source_file: string;
}

export interface OAStarData {
  count: number;
  /** Interleaved [x, y, z, absmag, ci] per star — same layout as the real field. */
  positions: Float32Array;
  names: OAStarName[];
  /** Shared with the real star field; colour must not diverge between them. */
  colorLut: Float32Array;
  dataset: OAStarsDataset;
}

export interface InnerSphereDataset {
  count: number;
  files: { colonies: { file: string; bytes: number } };
  selection: { rule: string; note: string };
  stats: {
    total_rows: number;
    resolved: number;
    methods: Record<string, number>;
    unresolved: string[];
    absent_catalogue: string[];
  };
  wormholes: { count: number; note: string };
  source: { description: string; citation: string; url: string };
}

export interface Colony {
  /** Index into the star dataset. */
  star_index: number;
  star: string;
  /** What Orion's Arm calls the system. Empty where it names no name. */
  colony: string;
  /**
   * What the table says the place *is*, where that is not a name: a
   * parenthetical qualifier, or one of the two cells whose slash separates a
   * name from a description rather than two names. Kept apart from `colony`
   * so a description is never drawn as a label.
   */
  described: string;
  spectral_type: string;
  mass_sol: string;
  luminosity_sol: string;
  distance_ly: number;
  method: string;
  /** Source and catalogue disagree on distance by 15-50%. */
  distance_disagrees: boolean;
  /** Polity ids; more than one is a genuine shared presence. */
  affiliations: string[];
  /** "special", "abandoned" or "blight" — none of which is an affiliation. */
  status: string;
  note: string;
}

export interface InnerSphereData {
  /** Keyed by star index, so a star can be labelled by what OA calls it. */
  byStar: Map<number, Colony>;
  dataset: InnerSphereDataset;
}

export interface FictionDataset {
  count: number;
  polity_count: number;
  files: {
    cluster_polity: ArrayFile;
    hii_polity?: ArrayFile;
    bindings: { file: string; bytes: number };
  };
  resolution: { total: number; resolved: number; unresolved: number; pending: string[] };
  shared_landmarks: string[];
  frontier: {
    ly: number;
    pc: number;
    note: string;
    flagged: {
      landmark: string;
      matched_name: string | null;
      distance_ly: number;
      polities: string[];
    }[];
  };
  source: { description: string; citation: string };
}

export interface Manifest {
  generator: string;
  units: {
    storage: string;
    display_default: string;
    pc_to_ly: number;
  };
  datasets: {
    stars: StarsDataset;
    clusters?: ClustersDataset;
    hii?: HiiDataset;
    oastars?: OAStarsDataset;
    inner_sphere?: InnerSphereDataset;
    worlds?: WorldsDataset;
    fiction?: FictionDataset;
  };
}

export type StarNames = Record<string, Record<string, string>>;

export interface StarData {
  count: number;
  /** Interleaved [x, y, z, absmag, ci] per star, in parsecs / magnitudes. */
  positions: Float32Array;
  /** Interleaved [hip, hd] per star; -1 means absent from that catalog. */
  ids: Int32Array;
  spectralClass: Uint8Array;
  constellation: Uint8Array;
  /** RGB triples indexed linearly over the B-V range. */
  colorLut: Float32Array;
  names: StarNames;
  dataset: StarsDataset;
}

const DATA_ROOT = 'data';

async function fetchBinary(file: string): Promise<ArrayBuffer> {
  const response = await fetch(`${DATA_ROOT}/${file}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${file}: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

async function fetchJson<T>(file: string): Promise<T> {
  const response = await fetch(`${DATA_ROOT}/${file}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${file}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Refuse to render data whose declared frame or unit is not what this code
 * assumes. Silently drawing a map in the wrong unit or the wrong orientation is
 * exactly the failure this project is built to avoid, so it is made fatal.
 */
function verifyContract(manifest: Manifest): void {
  const { units, datasets } = manifest;

  if (units.storage !== 'pc') {
    throw new Error(
      `Manifest declares storage unit "${units.storage}", but the renderer treats ` +
        `all scene coordinates as parsecs. Refusing to draw a map at the wrong scale.`,
    );
  }

  if (Math.abs(units.pc_to_ly - PC_TO_LY) > 1e-6) {
    throw new Error(
      `pc_to_ly disagrees: manifest ${units.pc_to_ly}, renderer ${PC_TO_LY}. ` +
        `The two halves of the project have drifted apart.`,
    );
  }

  const frame = datasets.stars.frame;
  if (frame.name !== 'galactic-cartesian-heliocentric') {
    throw new Error(
      `Unexpected coordinate frame "${frame.name}". The renderer assumes galactic ` +
        `Cartesian with Sol at the origin.`,
    );
  }
  if (frame.unit !== 'pc') {
    throw new Error(`Star positions are in "${frame.unit}", expected parsecs.`);
  }
}

export interface PolityInfo {
  index: number;
  id: string;
  name: string;
  color: string;
  uncertain: boolean;
  landmark_count: number;
  resolved_count: number;
  /** Objects of every kind the polity holds: landmarks, colonies, systems, worlds. */
  member_count: number;
  beyond_frontier_count: number;
  /** Key into `FictionData.sources` for where this landmark list was read from. */
  source: string;
}

export interface FictionSource {
  title: string;
  url: string;
  page: string;
  /** Setting year depicted, in years After Tranquility, where the source says. */
  epoch_at: number | null;
  note: string;
}

export interface FictionBinding {
  landmark: string;
  polities: string[];
  resolved: boolean;
  kind: string | null;
  index: number | null;
  matched_name: string | null;
  distance_pc: number | null;
  /** Past the canonical Terragen frontier; kept, but not polity-coloured. */
  beyond_frontier: boolean;
}

/** An Orion's Arm name for a real catalogued object. */
export interface LandmarkName {
  kind: string;
  index: number;
  catalogue: string;
  name: string;
  article: string;
  note: string;
}

export interface FictionData {
  polities: PolityInfo[];
  bindings: FictionBinding[];
  /** OA names for real objects, keyed "kind:index". */
  landmarkNames: Map<string, LandmarkName>;
  /**
   * Every polity index holding an object, for the few objects more than one
   * holds. Keyed "kind:index"; absent means the single-holder byte array
   * already has the answer.
   */
  sharedPolities: Map<string, number[]>;
  sources: Record<string, FictionSource>;
  notes: Record<string, string>;
  /** One byte per cluster; 0 = unassigned, else a 1-based polity index. */
  clusterPolity: Uint8Array;
  /** Same, per HII region. Absent when the fiction build predates that catalog. */
  hiiPolity: Uint8Array | null;
  pending: string[];
  /** Distance in pc past which the setting makes no territorial claim. */
  frontierPc: number;
  frontierLy: number;
  frontierFlagged: number;
}

export interface WorldEvent {
  /** Years After Tranquility, the setting's epoch. Never converted to CE. */
  year_at: number;
  /** visited | settled | contact | stewardship | transferred | reported | abandoned. */
  kind: string;
  note: string;
  /** Last year, for something that took time rather than happening. */
  until_at: number | null;
  /** exact | circa | not_later_than | not_earlier_than | between. */
  precision: string;
}

export interface WorldEntry {
  name: string;
  /** planet, moon, system, megastructure, volume — descriptive. */
  kind: string;
  system: string;
  /** The body it orbits: a star for a planet, a gas giant for a moon. */
  parent: string;
  also: string[];
  /** Polity ids. More than one is a genuine shared presence. */
  affiliations: string[];
  uncertain: boolean;
  article: string;
  note: string;
  /** star | oa_star | direction | constellation | none. */
  method: string;
  /** Set when the world binds to a catalogue star, which then carries it. */
  star_index: number | null;
  /** Set when it binds to a Celestia add-on star, by the add-on's designation. */
  oa_star: string;
  /** Set when it shares another world's position, by that world's name. */
  in_world: string;
  /** The system entry this world sits inside, where one is recorded. */
  within: string;
  /** Worlds recorded inside this one, where it is a system. */
  contains: string[];
  /**
   * The constellation the source names, whether or not it places the world.
   * Without a distance it is a direction and nothing more — a cone from Sol.
   */
  constellation: string;
  /** Present only when the world carries coordinates of its own, in parsecs. */
  x: number | null;
  y: number | null;
  z: number | null;
  distance_pc: number | null;
  /**
   * Half-angle of the cone the source actually allows. Zero when it gave
   * coordinates; the constellation's enclosing radius when it gave a
   * constellation; null when the world is not positioned here at all.
   */
  direction_error_deg: number | null;
  /**
   * How the position was worked out, where no source states one — empty for
   * every world whose position was read rather than inferred. This is a weaker
   * claim than any other position here and the panel says so outright, because
   * on the map an estimate and a measurement are the same dot.
   */
  estimated: string;
  /** The same error as a length at this distance, which is the legible form. */
  direction_error_ly: number | null;
  /** Half the extent, for a world that is a volume rather than a point. */
  radius_pc: number | null;
  /** Dated history, earliest first. */
  events: WorldEvent[];
  /**
   * The year from which a map of the sphere should show this place at all —
   * the earliest event establishing that anyone had been there.
   */
  known_from_at: number | null;
  /** The year it became inhabited, where it did. */
  settled_at: number | null;
  /** The year it ended, where it did. Hoopworld disintegrated in 10580. */
  ended_at: number | null;
}

export interface WorldsDataset {
  count: number;
  files: { worlds: { file: string; bytes: number } };
  stats: {
    total: number;
    by_method: Record<string, number>;
    unlocated: string[];
    unresolved: string[];
  };
  source: { description: string; citation: string; url: string };
}

export interface WorldData {
  worlds: WorldEntry[];
  /**
   * By star index, for the ones a catalogue star already carries.
   *
   * A list rather than a single entry: a system is not one world. Sol has Earth
   * and much else, and keeping only the first would silently drop the rest as
   * the file grows.
   */
  byStar: Map<number, WorldEntry[]>;
  /** By add-on designation, likewise. */
  byOAStar: Map<string, WorldEntry[]>;
  /**
   * Guests, by the name of the world whose position they share.
   *
   * Potato is an asteroid habitat in the Bonfire System, and the Bonfire System
   * is placed from coordinates rather than from a catalogue star — so there is
   * no star to group them on. The host draws the marker and carries both names.
   */
  byHost: Map<string, WorldEntry[]>;
  dataset: WorldsDataset;
}

/**
 * Every polity holding a system, from whichever source knows about it.
 *
 * A system can be described twice — as a row of the colony table and as a
 * canonical world — and the two need not agree about who holds it. Felicidade
 * is in the table with no affiliation at all and in the worlds file held by
 * four meta-empires; taking the table's answer would have drawn it as
 * unclaimed. The worlds file leads because it is hand-authored from an article
 * rather than transcribed from a column.
 */
export function affiliationsFor(
  colony: Colony | undefined,
  worlds: WorldEntry[] | undefined,
): string[] {
  const out: string[] = [];
  for (const world of worlds ?? []) {
    for (const id of world.affiliations) if (!out.includes(id)) out.push(id);
  }
  for (const id of colony?.affiliations ?? []) if (!out.includes(id)) out.push(id);
  return out;
}

export interface LoadedData {
  stars: StarData;
  clusters: ClusterData | null;
  hii: HiiData | null;
  oaStars: OAStarData | null;
  innerSphere: InnerSphereData | null;
  worlds: WorldData | null;
  fiction: FictionData | null;
}

/** Load every dataset the manifest advertises. Clusters are optional. */
export async function loadAll(): Promise<LoadedData> {
  const manifest = await fetchJson<Manifest>('manifest.json');
  verifyContract(manifest);

  const stars = await loadStars(manifest);
  const clusters = manifest.datasets.clusters
    ? await loadClusters(manifest.datasets.clusters)
    : null;
  const hii = manifest.datasets.hii ? await loadHii(manifest.datasets.hii) : null;
  // Built from hand-downloaded, non-redistributable source material, so a clone
  // without it is a normal state rather than an error.
  const oaStars = manifest.datasets.oastars
    ? await loadOAStars(manifest.datasets.oastars, stars.colorLut)
    : null;
  const innerSphere = manifest.datasets.inner_sphere
    ? await loadInnerSphere(manifest.datasets.inner_sphere)
    : null;
  const worlds = manifest.datasets.worlds ? await loadWorlds(manifest.datasets.worlds) : null;
  const fiction = manifest.datasets.fiction ? await loadFiction(manifest.datasets.fiction) : null;

  return { stars, clusters, hii, oaStars, innerSphere, worlds, fiction };
}

async function loadWorlds(dataset: WorldsDataset): Promise<WorldData> {
  const worlds = await fetchJson<WorldEntry[]>(dataset.files.worlds.file);
  const byStar = new Map<number, WorldEntry[]>();
  const byOAStar = new Map<string, WorldEntry[]>();
  const byHost = new Map<string, WorldEntry[]>();
  for (const world of worlds) {
    if (world.in_world) {
      const at = byHost.get(world.in_world);
      if (at) at.push(world);
      else byHost.set(world.in_world, [world]);
    }
    if (world.star_index !== null) {
      const at = byStar.get(world.star_index);
      if (at) at.push(world);
      else byStar.set(world.star_index, [world]);
    }
    if (world.oa_star) {
      const at = byOAStar.get(world.oa_star);
      if (at) at.push(world);
      else byOAStar.set(world.oa_star, [world]);
    }
  }
  return { worlds, byStar, byOAStar, byHost, dataset };
}

async function loadInnerSphere(dataset: InnerSphereDataset): Promise<InnerSphereData> {
  const colonies = await fetchJson<Colony[]>(dataset.files.colonies.file);
  const byStar = new Map<number, Colony>();
  for (const colony of colonies) {
    // First writer wins: the file is sorted by distance, so where two rows
    // resolve to the same star the nearer, better-determined one is kept.
    if (!byStar.has(colony.star_index)) byStar.set(colony.star_index, colony);
  }
  return { byStar, dataset };
}

async function loadOAStars(
  dataset: OAStarsDataset,
  colorLut: Float32Array,
): Promise<OAStarData> {
  if (dataset.frame.unit !== 'pc') {
    throw new Error(`OA star positions are in "${dataset.frame.unit}", expected parsecs.`);
  }

  const [positionsBuf, names] = await Promise.all([
    fetchBinary(dataset.files.positions.file),
    fetchJson<OAStarName[]>(dataset.files.names.file),
  ]);

  const positions = new Float32Array(positionsBuf);
  const expected = dataset.count * 5;
  if (positions.length !== expected) {
    throw new Error(
      `oastars.bin has ${positions.length} floats, expected ${expected} ` +
        `(${dataset.count} stars x 5 components).`,
    );
  }

  return { count: dataset.count, positions, names, colorLut, dataset };
}

async function loadFiction(dataset: FictionDataset): Promise<FictionData> {
  const hiiPolityFile = dataset.files.hii_polity?.file;
  const [payload, polityBuf, hiiPolityBuf] = await Promise.all([
    fetchJson<{
      polities: PolityInfo[];
      bindings: FictionBinding[];
      sources: Record<string, FictionSource>;
      notes: Record<string, string>;
      landmark_names?: LandmarkName[];
      shared_polities?: Record<string, Record<string, number[]>>;
    }>(dataset.files.bindings.file),
    fetchBinary(dataset.files.cluster_polity.file),
    hiiPolityFile ? fetchBinary(hiiPolityFile) : Promise.resolve(null),
  ]);

  const landmarkNames = new Map<string, LandmarkName>();
  for (const entry of payload.landmark_names ?? []) {
    landmarkNames.set(`${entry.kind}:${entry.index}`, entry);
  }
  const sharedPolities = new Map<string, number[]>();
  for (const [kind, byIndex] of Object.entries(payload.shared_polities ?? {})) {
    for (const [index, polities] of Object.entries(byIndex)) {
      sharedPolities.set(`${kind}:${index}`, polities);
    }
  }

  return {
    polities: payload.polities,
    bindings: payload.bindings,
    landmarkNames,
    sharedPolities,
    sources: payload.sources ?? {},
    notes: payload.notes,
    clusterPolity: new Uint8Array(polityBuf),
    hiiPolity: hiiPolityBuf ? new Uint8Array(hiiPolityBuf) : null,
    pending: dataset.resolution.pending,
    frontierPc: dataset.frontier.pc,
    frontierLy: dataset.frontier.ly,
    frontierFlagged: dataset.frontier.flagged.length,
  };
}

async function loadHii(dataset: HiiDataset): Promise<HiiData> {
  if (dataset.frame.unit !== 'pc') {
    throw new Error(`HII positions are in "${dataset.frame.unit}", expected parsecs.`);
  }

  const [geometryBuf, metaBuf, names] = await Promise.all([
    fetchBinary(dataset.files.geometry.file),
    fetchBinary(dataset.files.meta.file),
    fetchJson<HiiName[]>(dataset.files.names.file),
  ]);

  const geometry = new Float32Array(geometryBuf);
  const expected = dataset.count * 7;
  if (geometry.length !== expected) {
    throw new Error(
      `hii.bin has ${geometry.length} floats, expected ${expected} ` +
        `(${dataset.count} regions x 7 components).`,
    );
  }

  return {
    count: dataset.count,
    geometry,
    meta: new Int32Array(metaBuf),
    names,
    dataset,
  };
}

async function loadClusters(dataset: ClustersDataset): Promise<ClusterData> {
  if (dataset.frame.unit !== 'pc') {
    throw new Error(`Cluster positions are in "${dataset.frame.unit}", expected parsecs.`);
  }

  const [geometryBuf, metaBuf, agesBuf, names] = await Promise.all([
    fetchBinary(dataset.files.geometry.file),
    fetchBinary(dataset.files.meta.file),
    fetchBinary(dataset.files.ages.file),
    fetchJson<ClusterName[]>(dataset.files.names.file),
  ]);

  const geometry = new Float32Array(geometryBuf);
  const expected = dataset.count * 8;
  if (geometry.length !== expected) {
    throw new Error(
      `clusters.bin has ${geometry.length} floats, expected ${expected} ` +
        `(${dataset.count} clusters x 8 components).`,
    );
  }

  return {
    count: dataset.count,
    geometry,
    meta: new Int32Array(metaBuf),
    ages: new Float32Array(agesBuf),
    names,
    dataset,
  };
}

export async function loadStarData(): Promise<StarData> {
  const manifest = await fetchJson<Manifest>('manifest.json');
  verifyContract(manifest);
  return loadStars(manifest);
}

async function loadStars(manifest: Manifest): Promise<StarData> {
  const dataset = manifest.datasets.stars;
  const [positionsBuf, idsBuf, classesBuf, consBuf, lutBuf, names] = await Promise.all([
    fetchBinary(dataset.files.positions.file),
    fetchBinary(dataset.files.ids.file),
    fetchBinary(dataset.files.classes.file),
    fetchBinary(dataset.files.constellations.file),
    fetchBinary(dataset.files.color_lut.file),
    fetchJson<StarNames>(dataset.files.names.file),
  ]);

  const positions = new Float32Array(positionsBuf);
  const expected = dataset.count * 5;
  if (positions.length !== expected) {
    throw new Error(
      `stars.bin has ${positions.length} floats, expected ${expected} ` +
        `(${dataset.count} stars x 5 components).`,
    );
  }

  return {
    count: dataset.count,
    positions,
    ids: new Int32Array(idsBuf),
    spectralClass: new Uint8Array(classesBuf),
    constellation: new Uint8Array(consBuf),
    colorLut: new Float32Array(lutBuf),
    names,
    dataset,
  };
}
