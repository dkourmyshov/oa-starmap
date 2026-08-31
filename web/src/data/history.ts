/**
 * The setting's own history, and what it says about places on the map.
 *
 * Two different questions are answered from two different sources here, and
 * keeping them apart is most of the point of this file.
 *
 * *When did the sphere reach here?* comes from the world file: each place
 * carries the year it was first recorded and the year it was settled, read off
 * its own article. That is what draws the extent of settlement growing.
 *
 * *What was this century about?* cannot come from settlement dates at all — a
 * list of founding years cannot tell the system where a war ended from the one
 * colonised the same decade. It comes from the Encyclopaedia's own timeline,
 * whose lines link the places they name. A place the period's history names is
 * a place that period was about, and the number of times it names it is as much
 * as a link count can honestly claim.
 *
 * The two meet on the map and nowhere in the data: a place can be named by a
 * period and carry no date, or carry a date and be named by nobody.
 */

import type { FictionData, WorldEntry } from './manifest';

/** A place a timeline line links, as the build resolved it. */
export interface HistoryPlace {
  /** The Encyclopaedia article id, which is what the binding was made on. */
  article: string;
  /** Which file holds it, and so how the renderer finds it. */
  ref: 'world' | 'star' | 'oa_star' | 'landmark';
  name: string;
  world?: string;
  star_index?: number;
  oa_star?: string;
  catalogue?: string;
  located: boolean;
  /** How many of this period's lines name it. Present on a period's list only. */
  mentions?: number;
}

/** One dated line of a period's timeline, as the Encyclopaedia gives it. */
export interface HistoryEvent {
  year_at: number;
  until_at: number | null;
  precision: string;
  text: string;
  places: HistoryPlace[];
}

/**
 * A polity this period's own timeline names, and how often.
 *
 * The only temporal statement about polities the sources support. Affiliations
 * everywhere else in this project are undated — read off a political map of one
 * epoch and off articles about the setting's present — so nothing here can say
 * who *held* a system in a given year. What the Encyclopaedia's timeline can say
 * is which polities a century was about, because it writes their names down
 * while telling that century's story and dates every line it writes.
 */
export interface HistoryPolity {
  id: string;
  name: string;
  color: string;
  mentions: number;
}

export interface HistoryPeriod {
  id: string;
  name: string;
  /** The page's full heading, span and all. */
  title: string;
  kind: 'era' | 'period';
  /** The era this period belongs to, by id. Empty for an era. */
  parent: string;
  start_at: number | null;
  end_at: number | null;
  article: string;
  events: HistoryEvent[];
  places: HistoryPlace[];
  polities: HistoryPolity[];
  named_count: number;
}

export interface HistoryDataset {
  count: number;
  eras: number;
  files: { history: { file: string; bytes: number } };
  stats: {
    events: number;
    links: number;
    links_to_places: number;
    places: number;
    first_year_at: number | null;
    last_year_at: number | null;
  };
  source: { description: string; citation: string; url: string };
}

export interface HistoryData {
  /** Eras and periods in one list, in the order history runs. */
  periods: HistoryPeriod[];
  /** Only the ones that carry a timeline, which is the level a year picks. */
  dated: HistoryPeriod[];
  firstYear: number;
  lastYear: number;
  dataset: HistoryDataset;
}

/**
 * A year with no date recorded, and a place that never ended.
 *
 * Sentinels rather than nulls because these travel into vertex attributes,
 * where a null has no representation. Chosen far outside any year the setting
 * uses so that an ordinary comparison sorts them correctly without a special
 * case, and matched by the same constants in the epoch shader.
 */
export const UNDATED = -1e9;
export const NEVER_ENDS = 1e9;

export function makeHistory(
  payload: { periods: HistoryPeriod[] },
  dataset: HistoryDataset,
): HistoryData {
  const periods = payload.periods;
  const dated = periods.filter((period) => period.events.length > 0);
  const years = dated.flatMap((period) => period.events.map((event) => event.year_at));
  return {
    periods,
    dated,
    firstYear: years.length ? Math.min(...years) : 0,
    lastYear: years.length ? Math.max(...years) : 0,
    dataset,
  };
}

/**
 * The period a year falls in, or the nearest one to it.
 *
 * Periods do not tile the timeline perfectly — the Encyclopaedia's own headings
 * leave the pre-spaceflight ages undated and let the Current Era run open-ended
 * — so a year can fall in no period at all. Answering with the nearest is
 * better than answering with nothing: the control that reads this is a slider,
 * and a slider that shows no period for some of its travel reads as broken.
 */
export function periodAt(history: HistoryData, year: number): HistoryPeriod | null {
  let nearest: HistoryPeriod | null = null;
  let distance = Infinity;
  for (const period of history.dated) {
    const start = period.start_at ?? -Infinity;
    const end = period.end_at ?? Infinity;
    if (year >= start && year <= end) return period;
    const gap = year < start ? start - year : year - end;
    if (gap < distance) {
      distance = gap;
      nearest = period;
    }
  }
  return nearest;
}

/** The era a period belongs to, or the period itself if it is one. */
export function eraOf(history: HistoryData, period: HistoryPeriod): HistoryPeriod {
  if (!period.parent) return period;
  return history.periods.find((other) => other.id === period.parent) ?? period;
}

/**
 * How a period's named places reach each layer that can mark them.
 *
 * Three sets rather than one, because the three layers identify a place by
 * three different things — a ring by any name its system answers to, a world
 * marker by the world's name, an add-on star by its designation. Building them
 * here keeps the key spellings in one file instead of three.
 */
export function namedKeys(period: HistoryPeriod | null): {
  settled: Set<string>;
  worlds: Set<string>;
  oaStars: Set<string>;
} {
  const settled = new Set<string>();
  const worlds = new Set<string>();
  const oaStars = new Set<string>();
  for (const place of period?.places ?? []) {
    if (place.world) {
      settled.add(`world:${place.world}`);
      worlds.add(place.world);
    }
    if (place.star_index !== undefined) settled.add(`star:${place.star_index}`);
    if (place.oa_star) {
      settled.add(`oa:${place.oa_star}`);
      oaStars.add(place.oa_star);
    }
    if (place.catalogue) settled.add(`cat:${place.catalogue}`);
  }
  return { settled, worlds, oaStars };
}

/**
 * Which of a place's two dates the map is going by.
 *
 * They are different claims and both are worth having. `known` is the first
 * year the record mentions the place at all, by any means — and that includes
 * being seen from a long way off: Beyniou enters the record in 1198 AT at 7,122
 * light years, and the first ship arrives in 9462. So it is the reach of what
 * the Terragen Sphere *knows about*, which is a real and much wider thing than
 * where it has been. `settled` is the year it became inhabited, which is what
 * "extent of colonisation" means literally, and is the sparser of the two
 * because a hundred places carry no settlement year at all.
 */
export type EpochBasis = 'known' | 'settled';

export interface PlaceYears {
  /** First year on the map, or UNDATED. */
  from: number;
  /** Last year on the map, or NEVER_ENDS. */
  to: number;
}

/** When a world enters and leaves the map, under one basis. */
export function worldYears(world: WorldEntry, basis: EpochBasis): PlaceYears {
  const from = basis === 'settled' ? world.settled_at : world.known_from_at;
  return {
    from: from === null || from === undefined ? UNDATED : from,
    to: world.ended_at === null || world.ended_at === undefined ? NEVER_ENDS : world.ended_at,
  };
}

/**
 * The earliest date among several worlds at one position, and the latest end.
 *
 * A star is one marker and a system is not one world: Sol carries Earth, Luna
 * and much else. The marker should appear when the first of them does and stay
 * while any of them lasts, because it stands for the system rather than for any
 * one world in it.
 */
export function combinedYears(worlds: WorldEntry[] | undefined, basis: EpochBasis): PlaceYears {
  let from = UNDATED;
  let to = UNDATED;
  for (const world of worlds ?? []) {
    const years = worldYears(world, basis);
    if (years.from === UNDATED) continue;
    from = from === UNDATED ? years.from : Math.min(from, years.from);
    to = to === UNDATED ? years.to : Math.max(to, years.to);
  }
  return { from, to: from === UNDATED ? NEVER_ENDS : to };
}

/**
 * When a real catalogued object the setting names enters and leaves the map.
 *
 * Three sources of a year, in descending strength.
 *
 * Its own dated history, where the landmark file gives it one: Aleph Absolute
 * was settled around 3000 and the Enigma Cluster in 7222, and those are claims
 * about the place.
 *
 * Failing that, the year the *evidence* for its polity depicts. The political
 * maps draw the Middle Regions in 8000 A.T. and say so, so a landmark read off
 * them and off nothing else is attested in 8000. That is a weaker statement —
 * about the source, not the object — and `attested` says which kind it is so
 * the panel can count them apart.
 *
 * Failing both, nothing. Most of the cluster and HII catalogues are ordinary
 * astronomy that the setting never mentions, and they have no year because
 * there is no year to have.
 */
export function landmarkYears(
  fiction: FictionData | null,
  kind: string,
  index: number,
  basis: EpochBasis,
): PlaceYears & { attested: boolean } {
  const named = fiction?.landmarkNames.get(`${kind}:${index}`);
  const own = basis === 'settled' ? named?.settled_at : named?.known_from_at;
  if (own !== null && own !== undefined) {
    return {
      from: own,
      to: named?.ended_at ?? NEVER_ENDS,
      attested: false,
    };
  }

  // The evidence's own epoch dates a *presence*, which is not a settlement, so
  // it answers only the weaker question. Under the settlement basis a landmark
  // with no settlement year of its own stays undated rather than borrowing one.
  const attested = basis === 'known' ? attestedYears(fiction).get(`${kind}:${index}`) : undefined;
  if (attested !== undefined) return { from: attested, to: NEVER_ENDS, attested: true };
  return { from: UNDATED, to: NEVER_ENDS, attested: false };
}

/**
 * Every bound object's attested epoch, by catalogue slot.
 *
 * Built once per dataset and kept. The alternative — scanning the binding list
 * per object — is a hundred and eighty comparisons for each of four thousand
 * clusters, done twice, to answer a question whose answer never changes.
 */
const attestedCache = new WeakMap<FictionData, Map<string, number>>();

function attestedYears(fiction: FictionData | null): Map<string, number> {
  if (!fiction) return new Map();
  const held = attestedCache.get(fiction);
  if (held) return held;
  const built = new Map<string, number>();
  for (const binding of fiction.bindings) {
    if (binding.index === null || binding.attested_at === null) continue;
    const key = `${binding.kind}:${binding.index}`;
    const at = built.get(key);
    if (at === undefined || binding.attested_at < at) built.set(key, binding.attested_at);
  }
  attestedCache.set(fiction, built);
  return built;
}

/** Whether a place with these years is on the map in this year. */
export function presentAt(years: PlaceYears, year: number): boolean {
  if (years.from === UNDATED) return false;
  return year >= years.from && year <= years.to;
}

