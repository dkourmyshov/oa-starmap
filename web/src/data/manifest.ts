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
  beyond_frontier_count: number;
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

export interface FictionData {
  polities: PolityInfo[];
  bindings: FictionBinding[];
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

export interface LoadedData {
  stars: StarData;
  clusters: ClusterData | null;
  hii: HiiData | null;
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
  const fiction = manifest.datasets.fiction ? await loadFiction(manifest.datasets.fiction) : null;

  return { stars, clusters, hii, fiction };
}

async function loadFiction(dataset: FictionDataset): Promise<FictionData> {
  const hiiPolityFile = dataset.files.hii_polity?.file;
  const [payload, polityBuf, hiiPolityBuf] = await Promise.all([
    fetchJson<{
      polities: PolityInfo[];
      bindings: FictionBinding[];
      notes: Record<string, string>;
    }>(dataset.files.bindings.file),
    fetchBinary(dataset.files.cluster_polity.file),
    hiiPolityFile ? fetchBinary(hiiPolityFile) : Promise.resolve(null),
  ]);

  return {
    polities: payload.polities,
    bindings: payload.bindings,
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
