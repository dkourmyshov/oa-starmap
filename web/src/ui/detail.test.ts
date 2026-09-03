import { describe, expect, it } from 'vitest';

import { encyclopaediaArticle, hasOrionsArmBlock } from './detail';

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
