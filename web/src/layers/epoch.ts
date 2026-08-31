/**
 * Showing the map as it stood in a given year.
 *
 * Every layer that draws a place the setting has claimed shares this, for the
 * same reason they share the depth-of-field code: the rule for whether a place
 * exists yet is one rule, and three copies of it would drift.
 *
 * Two attributes and four uniforms. `aYears` is when the place enters and
 * leaves the record; `aNamed` is whether the period currently shown names it in
 * its own history. Places with no date at all keep a separate, dimmer state of
 * their own rather than being folded into either answer — about half the map
 * has no year anywhere in its sources, and drawing those as though they were
 * absent would show a far emptier sphere than the setting has.
 */

import * as THREE from 'three';

/** Matches UNDATED and NEVER_ENDS in data/history.ts. */
const UNDATED_TEST = '-1e8';

/** The sentinel data/history.ts writes for a place that never ends. */
const NEVER_ENDS_TEST = 1e9;

export const EPOCH_PARS = /* glsl */ `
  attribute vec2 aYears;
  attribute float aNamed;

  uniform float uEpochOn;
  uniform float uYear;
  uniform float uUndatedGain;
  uniform float uUnnamedGain;

  // How much of a place is drawn in the year being shown.
  //
  // Zero before it appears and after it ends; a place that has not happened yet
  // is not faint, it is absent, and fading it in would put a colony on the map
  // centuries before anyone reached it. The two partial answers are for things
  // that are on the map but not the subject: a place whose sources give no year
  // at all, and — when the reader asks for it — a place this period's own
  // history does not mention.
  float epochGain() {
    if (uEpochOn < 0.5) return 1.0;
    if (aYears.x < ${UNDATED_TEST}) return uUndatedGain;
    if (uYear < aYears.x || uYear > aYears.y) return 0.0;
    return mix(uUnnamedGain, 1.0, aNamed);
  }
`;

export interface EpochUniforms {
  uEpochOn: { value: number };
  uYear: { value: number };
  uUndatedGain: { value: number };
  uUnnamedGain: { value: number };
}

/** Off, and showing everything, until the reader asks otherwise. */
export function epochUniforms(): EpochUniforms {
  return {
    uEpochOn: { value: 0 },
    uYear: { value: 0 },
    uUndatedGain: { value: DEFAULT_UNDATED_GAIN },
    uUnnamedGain: { value: 1 },
  };
}

/**
 * How visible a place with no recorded date is while history mode is on.
 *
 * Not zero. Half the settled systems on this map have no year in any source
 * that reaches them, and hiding them by default would answer "when was this
 * settled?" with "never" for hundreds of places the setting plainly holds. Faint
 * enough to read as a different claim, present enough to count.
 */
export const DEFAULT_UNDATED_GAIN = 0.22;

/** How visible a place is that the shown period's history does not name. */
export const DEFAULT_UNNAMED_GAIN = 0.3;

/**
 * What one place contributes to the epoch summary.
 *
 * Deliberately no affiliation. This carried one until a per-year list of
 * holdings was built on it, which could not be made true: the affiliations in
 * this project are undated, so counting today's holders among the places that
 * existed in 515 A.T. put the Sophic League on the map fifteen centuries before
 * the timeline first mentions it. What replaced it is the polities each period's
 * own history names, which the pipeline reads off the source; see
 * build/history.py. Leaving the field here would invite the same summary back.
 */
export interface EpochPlace {
  from: number;
  to: number;
  /** Distance from Sol in parsecs. */
  distancePc: number;
}

/**
 * What the map holds at a given year, for the panel to report.
 *
 * Built from the same list the rings are built from, and by the layer that
 * builds them, so the number the panel states and the marks the reader counts
 * can never disagree.
 */
export class EpochSummary {
  constructor(private readonly places: EpochPlace[]) {}

  get total(): number {
    return this.places.length;
  }

  /** How many places carry a date at all — the honest size of this view. */
  get dated(): number {
    let count = 0;
    for (const place of this.places) if (place.from > -1e8) count += 1;
    return count;
  }

  /**
   * The first and last year anything on the map is dated to.
   *
   * What the year control can usefully span. The Encyclopaedia's timeline runs
   * three thousand years further than this, into dates it labels as projections,
   * and a slider that travelled there would spend half its length on a map that
   * had stopped changing.
   */
  range(): { first: number; last: number } {
    let first = Infinity;
    let last = -Infinity;
    for (const place of this.places) {
      if (place.from <= -1e8) continue;
      first = Math.min(first, place.from);
      last = Math.max(last, place.from, place.to === NEVER_ENDS_TEST ? place.from : place.to);
    }
    return Number.isFinite(first) ? { first, last } : { first: 0, last: 0 };
  }

  /** How many are on the map in this year. */
  presentAt(year: number): number {
    let count = 0;
    for (const place of this.places) {
      if (place.from > -1e8 && year >= place.from && year <= place.to) count += 1;
    }
    return count;
  }

  /**
   * How far the places on the map extend in this year, in parsecs.
   *
   * A ninety-fifth percentile, not a maximum, because the record's outliers are
   * not expeditions at all: Beyniou is in it from 1198 AT at 7,122 light years
   * because it was *seen* then, and nobody arrives until 9462. Taking the
   * furthest would report a frontier seven thousand light years out in a
   * century when everything else on the map sat within ninety.
   */
  frontierPc(year: number): number {
    const distances: number[] = [];
    for (const place of this.places) {
      if (place.from > -1e8 && year >= place.from && year <= place.to) {
        distances.push(place.distancePc);
      }
    }
    if (!distances.length) return 0;
    distances.sort((a, b) => a - b);
    return distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))];
  }

}

/**
 * Write the year attributes onto a geometry.
 *
 * Separate from the layers so that adding a fourth of them is one call rather
 * than a copied block, and so the attribute names cannot drift from the shader
 * that reads them.
 */
export function instancedEpochAttributes(
  geometry: THREE.InstancedBufferGeometry,
  places: EpochPlace[],
): {
  years: THREE.InstancedBufferAttribute;
  named: THREE.InstancedBufferAttribute;
  yearsArray: Float32Array;
} {
  const years = yearsArray(places);
  const yearAttribute = new THREE.InstancedBufferAttribute(years.slice(), 2);
  const namedAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(places.length).fill(1),
    1,
  );
  geometry.setAttribute('aYears', yearAttribute);
  geometry.setAttribute('aNamed', namedAttribute);
  return { years: yearAttribute, named: namedAttribute, yearsArray: years };
}

/** The packed [from, to] pairs an epoch attribute is built from. */
export function yearsArray(places: EpochPlace[]): Float32Array {
  const out = new Float32Array(places.length * 2);
  places.forEach((place, index) => {
    out[index * 2] = place.from;
    out[index * 2 + 1] = place.to;
  });
  return out;
}

export function attachEpochAttributes(
  geometry: THREE.BufferGeometry,
  places: EpochPlace[],
): { years: THREE.BufferAttribute; named: THREE.BufferAttribute } {
  const yearAttribute = new THREE.BufferAttribute(yearsArray(places), 2);
  const namedAttribute = new THREE.BufferAttribute(new Float32Array(places.length), 1);
  geometry.setAttribute('aYears', yearAttribute);
  geometry.setAttribute('aNamed', namedAttribute);
  return { years: yearAttribute, named: namedAttribute };
}
