import { describe, expect, it } from 'vitest';

import { encyclopaediaArticle, eventLabel, hasOrionsArmBlock, heldInYear } from './detail';

/**
 * The Orion's Arm block has failed to appear twice, both times because
 * something that should have opened it was not counted. Each reason gets a case
 * here, and the article gets two: it is the one that has been missed.
 */
describe('hasOrionsArmBlock', () => {
  const bare = { polities: [] as string[] };

  it('opens for a place with a holder', () => {
    expect(hasOrionsArmBlock({ polities: ['metasoft'] }, false)).toBe(true);
  });

  it('opens for a place beyond the frontier, which is worth saying alone', () => {
    expect(hasOrionsArmBlock(bare, true)).toBe(true);
  });

  it('opens for a place with dated history', () => {
    expect(hasOrionsArmBlock({ ...bare, events: [{ year_at: 4010 }] }, false)).toBe(true);
  });

  it('opens for a system with worlds inside it', () => {
    expect(hasOrionsArmBlock({ ...bare, worlds: [{ name: 'Equinoxe' }] }, false)).toBe(true);
  });

  it('opens for an article and nothing else, which is the Utmig case', () => {
    // In Auriga at 4,010 ly: no holder, no dates, nothing inside it, and a
    // source a reader should be able to open.
    expect(
      hasOrionsArmBlock(
        { ...bare, associationSource: 'https://www.orionsarm.com/eg-article/531296c9de242' },
        false,
      ),
    ).toBe(true);
  });

  it('stays shut for a real object the setting says nothing about', () => {
    expect(hasOrionsArmBlock(bare, false)).toBe(false);
    expect(hasOrionsArmBlock({ ...bare, associationSource: null }, false)).toBe(false);
    expect(hasOrionsArmBlock({ ...bare, events: [], worlds: [] }, false)).toBe(false);
  });
});

/**
 * The Encyclopaedia link is lifted to the top of the panel, where it can be
 * read without scrolling. It reaches the panel by two different routes
 * depending on what was clicked, and the catalogue's own citation must not be
 * mistaken for it: ADS and VizieR say where the numbers came from, which is a
 * different claim and has its own place at the foot.
 */
describe('encyclopaediaArticle', () => {
  const ARTICLE = 'https://www.orionsarm.com/eg-article/4ce';

  it('takes the association source, which is how a landmark carries it', () => {
    expect(encyclopaediaArticle({ associationSource: ARTICLE })).toBe(ARTICLE);
  });

  it("takes a world's own article, which is how a settled system carries it", () => {
    expect(encyclopaediaArticle({ worlds: [{ article: ARTICLE }] })).toBe(ARTICLE);
  });

  it("prefers the object's own article to the page the affiliation came from", () => {
    // The Inner Sphere table is one topic page for nine hundred systems, and
    // each row links out to the system's article. The reader who clicked a
    // star wants the second; the first was where its polity was read from,
    // and it stays on the panel as that citation.
    const TOPIC = 'https://www.orionsarm.com/eg-topic/45bcbcab90032';
    expect(
      encyclopaediaArticle({ article: ARTICLE, associationSource: `The Stars of the Inner Sphere. ${TOPIC}` }),
    ).toBe(ARTICLE);
  });

  it("keeps a host's own page ahead of its guests'", () => {
    // On a world's panel the association source is that world's article and
    // the worlds are the ones it hosts. Earth was clicked for Earth, not for
    // whatever orbits it. A star with no row in the table promotes a world
    // drawn there into `article` itself, so this order costs it nothing.
    const HOST = 'https://www.orionsarm.com/eg-article/host';
    expect(
      encyclopaediaArticle({ article: null, associationSource: HOST, worlds: [{ article: ARTICLE }] }),
    ).toBe(HOST);
  });

  it('reads an address out of a citation that is mostly prose', () => {
    expect(encyclopaediaArticle({ associationSource: `Table 3, ${ARTICLE}` })).toBe(ARTICLE);
  });

  it('passes over an address that is not the Encyclopaedia', () => {
    expect(
      encyclopaediaArticle({
        associationSource: 'https://ui.adsabs.harvard.edu/abs/2021A%26A...646A.104H',
        worlds: [{ article: ARTICLE }],
      }),
    ).toBe(ARTICLE);
  });

  it('has nothing to say about a star the setting never mentions', () => {
    expect(encyclopaediaArticle({})).toBe(null);
    expect(encyclopaediaArticle({ associationSource: null, worlds: [] })).toBe(null);
  });
});

/**
 * A past holder is only ever named through an event, so the wording is what
 * carries the claim. "Settled by the Doran Empire" says who; "settled" beside
 * a Non-Coercive Zone affiliation would say the wrong who.
 */
describe('eventLabel', () => {
  const names: Record<string, string> = { 'doran-empire': 'Doran Empire' };
  const named = (id: string) => names[id];

  it('reads as before when the source names no polity', () => {
    expect(eventLabel({ kind: 'settled' }, named)).toBe('settled');
    expect(eventLabel({ kind: 'settled', polity: '' }, named)).toBe('settled');
  });

  it('puts the preposition the kind wants in front of the name', () => {
    expect(eventLabel({ kind: 'settled', polity: 'doran-empire' }, named)).toBe('settled by Doran Empire');
    expect(eventLabel({ kind: 'transferred', polity: 'doran-empire' }, named)).toBe('passed to Doran Empire');
  });

  it('falls back to the id rather than dropping a polity the file does not name', () => {
    // The build refuses an unknown id, so this is belt and braces — but a
    // silent drop would turn "settled by X" back into "settled", which is a
    // different claim, and a quiet one.
    expect(eventLabel({ kind: 'settled', polity: 'lost-polity' }, named)).toBe('settled by lost-polity');
  });

  it('brackets the name for a kind with no wording of its own', () => {
    expect(eventLabel({ kind: 'observed', polity: 'doran-empire' }, named)).toBe('first observed (Doran Empire)');
  });
});

/**
 * The line history mode adds above the fold: who held the place in the year
 * shown, and who holds it now. The colour on the map has just changed to the
 * first, and the second is the claim the rest of the panel is still making.
 */
describe('heldInYear', () => {
  const names: Record<string, string> = {
    'penglai-empire': 'Penglai Empire',
    'sophic-league': 'Sophic League',
  };
  const nameOf = (id: string) => names[id] ?? id;
  const spans = { founded: new Map([['sophic-league', 2345]]), dissolved: new Map<string, number>() };
  const penglai = {
    present: ['sophic-league'],
    holdings: [{ from: 1205, polities: ['penglai-empire'] }],
  };

  it('says who held it then and who holds it now', () => {
    expect(heldInYear(penglai, 1500, spans, nameOf)).toEqual({
      then: ['Penglai Empire'],
      now: ['Sophic League'],
    });
  });

  it('says nobody named for a year before any holder existed', () => {
    // 1000 AT: before the Hsien revolt, and before the Sophic League was
    // founded, so the present holder does not stand in either.
    expect(heldInYear(penglai, 1000, spans, nameOf)).toEqual({ then: [], now: ['Sophic League'] });
  });

  it('has nothing to say about a place nobody has ever held', () => {
    expect(heldInYear({ present: [], holdings: [] }, 1500, spans, nameOf)).toBe(null);
    expect(heldInYear({}, 1500, spans, nameOf)).toBe(null);
  });
});
