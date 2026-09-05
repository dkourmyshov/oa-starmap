import { describe, expect, it } from 'vitest';

import type { FictionData, WorldEntry } from './manifest';
import {
  type HistoryData,
  type HistoryPeriod,
  NEVER_ENDS,
  UNDATED,
  combinedYears,
  holdersAt,
  holdingsOf,
  politySpans,
  eraOf,
  landmarkYears,
  makeHistory,
  namedKeys,
  periodAt,
  presentAt,
  worldYears,
} from './history';
import { EpochSummary } from '../layers/epoch';

function world(over: Partial<WorldEntry>): WorldEntry {
  return {
    name: 'Somewhere',
    kind: 'planet',
    system: '',
    parent: '',
    also: [],
    affiliations: [],
    uncertain: false,
    article: '',
    note: '',
    method: 'star',
    star_index: null,
    oa_star: '',
    in_world: '',
    within: '',
    contains: [],
    constellation: '',
    x: null,
    y: null,
    z: null,
    distance_pc: null,
    direction_error_deg: null,
    estimated: '',
    direction_error_ly: null,
    distance_error_ly: null,
    radius_pc: null,
    events: [],
    known_from_at: null,
    settled_at: null,
    ended_at: null,
    ...over,
  };
}

function period(over: Partial<HistoryPeriod>): HistoryPeriod {
  return {
    id: 'p',
    name: 'A period',
    title: 'A period',
    kind: 'period',
    parent: '',
    start_at: null,
    end_at: null,
    article: '',
    events: [],
    places: [],
    polities: [],
    named_count: 0,
    ...over,
  };
}

describe("a place's years", () => {
  it('keeps reached and settled apart', () => {
    // The two claims differ across most of the record: a hundred places are
    // recorded as reached with no settlement year ever given, and reading one
    // for the other would put a colony on the map at the date of a flyby.
    const surveyed = world({ known_from_at: 2200, settled_at: null });
    expect(worldYears(surveyed, 'known').from).toBe(2200);
    expect(worldYears(surveyed, 'settled').from).toBe(UNDATED);
  });

  it('never invents a date for a place that has none', () => {
    // The whole point of the sentinel. A default of zero would put every
    // undated place at Tranquility, which is both a date and a wrong one.
    const years = worldYears(world({}), 'known');
    expect(years.from).toBe(UNDATED);
    expect(presentAt(years, 5000)).toBe(false);
  });

  it('ends a place that ended', () => {
    const gone = world({ known_from_at: 3000, ended_at: 10580 });
    expect(presentAt(worldYears(gone, 'known'), 10000)).toBe(true);
    expect(presentAt(worldYears(gone, 'known'), 10600)).toBe(false);
  });

  it('dates a system by the earliest of the worlds in it', () => {
    // One marker stands for a system, and a system is not one world. Sol
    // carries Earth and much else; the marker has to appear when the first of
    // them does rather than when whichever happens to be listed first does.
    const years = combinedYears(
      [
        world({ name: 'Later', known_from_at: 4000 }),
        world({ name: 'Earlier', known_from_at: 2400 }),
        world({ name: 'Undated' }),
      ],
      'known',
    );
    expect(years.from).toBe(2400);
    expect(years.to).toBe(NEVER_ENDS);
  });

  it('leaves a system undated when nothing in it is dated', () => {
    expect(combinedYears([world({}), world({})], 'known').from).toBe(UNDATED);
  });
});

describe('the era hierarchy', () => {
  const history: HistoryData = makeHistory(
    {
      periods: [
        period({
          id: 'interstellar-era',
          name: 'Interstellar Era',
          kind: 'era',
          start_at: 900,
          end_at: 3200,
        }),
        period({
          id: 'age-of-expansion',
          name: 'The Age of Expansion',
          parent: 'interstellar-era',
          start_at: 2100,
          end_at: 2600,
          events: [{ year_at: 2100, until_at: null, precision: 'exact', text: 'x', places: [] }],
        }),
        period({
          id: 'age-of-establishment',
          name: 'Age of Establishment',
          parent: 'interstellar-era',
          start_at: 2600,
          end_at: 3200,
          events: [{ year_at: 2700, until_at: null, precision: 'exact', text: 'y', places: [] }],
        }),
      ],
    },
    {} as HistoryData['dataset'],
  );

  it('offers only the periods that carry a timeline', () => {
    // An era page is an essay and its periods carry the dated lines. Offering
    // the era as a choice would offer a level with nothing to show.
    expect(history.dated.map((p) => p.id)).toEqual(['age-of-expansion', 'age-of-establishment']);
  });

  it('finds the period a year falls in', () => {
    expect(periodAt(history, 2300)?.id).toBe('age-of-expansion');
    expect(periodAt(history, 2700)?.id).toBe('age-of-establishment');
  });

  it('answers with the nearest period for a year in none', () => {
    // The Encyclopaedia's headings do not tile the timeline, so a slider can
    // reach years no period covers. Answering with nothing reads as broken.
    expect(periodAt(history, 100)?.id).toBe('age-of-expansion');
    expect(periodAt(history, 9000)?.id).toBe('age-of-establishment');
  });

  it('names the era a period belongs to', () => {
    expect(eraOf(history, history.dated[0]).name).toBe('Interstellar Era');
  });
});

describe('the places a period names', () => {
  it('reaches each layer by the name that layer knows', () => {
    // Three layers identify a place three ways, and a ring answers to every
    // name its system has. Sending only the world name would leave the ring
    // around a star unmarked while the marker beside it lit up.
    const keys = namedKeys(
      period({
        places: [
          { article: 'a', ref: 'world', name: 'Nova Terra', world: 'Nova Terra', located: true },
          { article: 'b', ref: 'star', name: 'Ross 128', star_index: 41, located: true },
          { article: 'c', ref: 'oa_star', name: 'Cantor', oa_star: 'JD 12345', located: true },
          { article: 'd', ref: 'landmark', name: 'Hyades', catalogue: 'Melotte_25', located: true },
        ],
      }),
    );
    expect([...keys.settled].sort()).toEqual([
      'cat:Melotte_25',
      'oa:JD 12345',
      'star:41',
      'world:Nova Terra',
    ]);
    expect([...keys.worlds]).toEqual(['Nova Terra']);
    expect([...keys.oaStars]).toEqual(['JD 12345']);
  });

  it('marks nothing when no period is chosen', () => {
    expect(namedKeys(null).settled.size).toBe(0);
  });
});

describe('what the map holds in a year', () => {
  const summary = new EpochSummary([
    { from: 500, to: NEVER_ENDS, distancePc: 4 },
    { from: 2200, to: NEVER_ENDS, distancePc: 40 },
    { from: 2200, to: 3000, distancePc: 60 },
    { from: UNDATED, to: NEVER_ENDS, distancePc: 900 },
  ]);

  it('counts only the places that exist by then', () => {
    expect(summary.presentAt(400)).toBe(0);
    expect(summary.presentAt(2500)).toBe(3);
    expect(summary.presentAt(4000)).toBe(2);
  });

  it('says how much of the map is dated at all', () => {
    // The number that keeps the view honest: an undated place is not a place
    // settled in year zero, and the panel states how many there are.
    expect(summary.total).toBe(4);
    expect(summary.dated).toBe(3);
  });

  it('keeps an undated place out of the reach', () => {
    // It sits at 900 pc. Counting it would report a frontier a hundred times
    // too far out on the strength of a place with no date at all.
    expect(summary.frontierPc(2500)).toBeLessThan(100);
  });

  it('spans only the years the map is dated to', () => {
    // Not the timeline's own span, which runs three thousand years further
    // into dates the Encyclopaedia labels as projections.
    expect(summary.range()).toEqual({ first: 500, last: 3000 });
  });
});

describe('a real object the setting names', () => {
  const fiction = {
    landmarkNames: new Map([
      [
        'cluster:10',
        {
          kind: 'cluster',
          index: 10,
          catalogue: 'Melotte_186',
          name: 'Aleph Absolute',
          article: '',
          note: '',
          events: [],
          known_from_at: 3000,
          settled_at: 3000,
          ended_at: null,
        },
      ],
    ]),
    bindings: [
      { kind: 'star', index: 4456, landmark: 'Gamma Cas', matched_name: 'Cih',
        polities: ['solar-dominion'], resolved: true, distance_pc: 168,
        beyond_frontier: false, attested_at: 8000 },
      { kind: 'cluster', index: 10, landmark: 'Aleph Absolute', matched_name: 'Melotte_186',
        polities: ['keter-dominion'], resolved: true, distance_pc: 540,
        beyond_frontier: false, attested_at: 8000 },
      { kind: 'hii', index: 7, landmark: 'S27', matched_name: 'S27',
        polities: ['solar-dominion'], resolved: true, distance_pc: 200,
        beyond_frontier: false, attested_at: null },
    ],
  } as unknown as FictionData;

  it('prefers a dated history to the epoch of the evidence', () => {
    // Aleph Absolute was settled around 3000 and appears on the 8000 A.T.
    // political map. The settlement date is a claim about the place; the map's
    // epoch is a claim about the map, and the stronger one wins.
    expect(landmarkYears(fiction, 'cluster', 10, 'known').from).toBe(3000);
    expect(landmarkYears(fiction, 'cluster', 10, 'known').attested).toBe(false);
  });

  it('falls back to the year the evidence depicts', () => {
    // Cih, Mebsuta and Almaaz are read off a map of 8000 A.T. and off nothing
    // else. Without this they had no year at all, so a historical view put them
    // on the map through the Interplanetary Age — three thousand years before
    // the only source that mentions them depicts.
    const years = landmarkYears(fiction, 'star', 4456, 'known');
    expect(years.from).toBe(8000);
    expect(years.attested).toBe(true);
  });

  it('will not read an epoch as a settlement date', () => {
    // "This was in Metasoft's volume in 8000" is not "this was colonised in
    // 8000". Under the settlement basis the object stays undated.
    expect(landmarkYears(fiction, 'star', 4456, 'settled').from).toBe(UNDATED);
  });

  it('leaves ordinary astronomy undated', () => {
    // Seven thousand clusters the setting never mentions have no year because
    // there is no year to have — which is not the same as "always there".
    expect(landmarkYears(fiction, 'cluster', 999, 'known').from).toBe(UNDATED);
    expect(landmarkYears(fiction, 'hii', 7, 'known').from).toBe(UNDATED);
  });

  it('survives having no fictional layer at all', () => {
    expect(landmarkYears(null, 'cluster', 10, 'known').from).toBe(UNDATED);
  });
});

/**
 * Who held a place in a given year, read off its events.
 *
 * The map already had a year; this is what colours a ring in it. The claims
 * to keep apart: a holder an event names, a holder that had dissolved by then,
 * and a past the sources do not name at all.
 */
describe('holdersAt', () => {
  const ended = { founded: new Map<string, number>(), dissolved: new Map([['doran-empire', 5855]]) };
  const sesharia = holdingsOf([
    world({
      affiliations: ['nocozo'],
      events: [
        { year_at: 1102, kind: 'settled', polity: 'doran-empire', note: '', source: '', until_at: null, precision: 'exact' },
        { year_at: 1599, kind: 'visited', polity: '', note: '', source: '', until_at: null, precision: 'exact' },
      ],
    }),
  ]);

  it('names the polity that settled the place, from the year it did', () => {
    expect(holdersAt(sesharia, ['nocozo'], 1102, ended)).toEqual(['doran-empire']);
    expect(holdersAt(sesharia, ['nocozo'], 3000, ended)).toEqual(['doran-empire']);
  });

  it('gives an unknown past to the present holders, not to nobody', () => {
    // Before the settlement the sources say nothing about who held it, and
    // drawing that as unheld would strip the colour off every dated system
    // whose article gives a year but not a founder.
    expect(holdersAt(sesharia, ['nocozo'], 900, ended)).toEqual(['nocozo']);
    expect(holdersAt(undefined, ['nocozo'], 3000, ended)).toEqual(['nocozo']);
  });

  it('falls back to the present holders once the past one has dissolved', () => {
    // The Doran Empire's last remnants entered the Terragen Federation in
    // 5855. Sesharia is NoCoZo now and its article does not say when; the one
    // thing certain is that it was not Doran in 9000.
    expect(holdersAt(sesharia, ['nocozo'], 5855, ended)).toEqual(['nocozo']);
    expect(holdersAt(sesharia, ['nocozo'], 9000, ended)).toEqual(['nocozo']);
  });

  it('follows a change of hands, and an abandonment to nobody', () => {
    const dorangloon = holdingsOf([
      world({
        events: [
          { year_at: 3890, kind: 'transferred', polity: 'solar-dominion', note: '', source: '', until_at: null, precision: 'exact' },
          { year_at: 929, kind: 'settled', polity: 'doran-empire', note: '', source: '', until_at: null, precision: 'exact' },
          { year_at: 7000, kind: 'abandoned', polity: '', note: '', source: '', until_at: null, precision: 'exact' },
        ],
      }),
    ]);
    // Sorted by year whatever order the file had them in.
    expect(dorangloon.map((h) => h.from)).toEqual([929, 3890, 7000]);
    expect(holdersAt(dorangloon, ['terragen-federation'], 2000, ended)).toEqual(['doran-empire']);
    expect(holdersAt(dorangloon, ['terragen-federation'], 3890, ended)).toEqual(['solar-dominion']);
    expect(holdersAt(dorangloon, ['terragen-federation'], 8000, ended)).toEqual([]);
  });

  it('does not draw a present holder before it was founded', () => {
    // The Keter Dominion was set up in 2388. A system settled in 1200 whose
    // article does not say who by is Keterist now and was not then; and
    // nobody else is named, so in 1200 it is held by nobody named.
    const spans = { founded: new Map([['keter-dominion', 2388]]), dissolved: new Map<string, number>() };
    expect(holdersAt([], ['keter-dominion'], 1200, spans)).toEqual([]);
    expect(holdersAt([], ['keter-dominion'], 2388, spans)).toEqual(['keter-dominion']);
    // A shared holding keeps whichever partners existed.
    expect(holdersAt([], ['keter-dominion', 'nocozo'], 1200, spans)).toEqual(['nocozo']);
  });

  it('shows a colony a source calls Keterist before the Dominion was founded', () => {
    // The exception, and the reason it is an event and not a rule: a source
    // that names the polity is making a claim about the colony, and the map
    // shows what the sources say rather than what the founding year implies.
    const spans = { founded: new Map([['keter-dominion', 2388]]), dissolved: new Map<string, number>() };
    const proto = [{ from: 2100, polities: ['keter-dominion'] }];
    expect(holdersAt(proto, ['keter-dominion'], 2200, spans)).toEqual(['keter-dominion']);
  });

  it('reads both years off the polity file', () => {
    const fiction = {
      polities: [
        { id: 'a', founded_at: 100, dissolved_at: null },
        { id: 'b', founded_at: null, dissolved_at: 900 },
      ],
    } as unknown as FictionData;
    const spans = politySpans(fiction);
    expect([...spans.founded]).toEqual([['a', 100]]);
    expect([...spans.dissolved]).toEqual([['b', 900]]);
  });

  it('ends a holding when the place breaks away and joins nobody', () => {
    // Huanghua: the Federation's from 986, the Penglai Evolution's from
    // 1683, and by 2000 "broke away from both the Penglai Empire and the
    // SecureSpace interstellar hegemony" — nobody's, and still inhabited.
    const huanghua = holdingsOf([
      world({
        events: [
          { year_at: 986, kind: 'transferred', polity: 'first-federation', note: '', source: '', until_at: null, precision: 'exact' },
          { year_at: 1683, kind: 'transferred', polity: 'penglai-empire', note: '', source: '', until_at: null, precision: 'exact' },
          { year_at: 2000, kind: 'independent', polity: '', note: '', source: '', until_at: null, precision: 'not_later_than' },
        ],
      }),
    ]);
    expect(holdersAt(huanghua, [], 1300, ended)).toEqual(['first-federation']);
    expect(holdersAt(huanghua, [], 1800, ended)).toEqual(['penglai-empire']);
    expect(holdersAt(huanghua, [], 2500, ended)).toEqual([]);
  });

  it('does not make a visitor a holder', () => {
    const callisto = holdingsOf([
      world({
        events: [
          { year_at: 1770, kind: 'visited', polity: 'first-federation', note: '', source: '', until_at: null, precision: 'exact' },
        ],
      }),
    ]);
    expect(callisto).toEqual([]);
  });
});
