import { describe, expect, it } from 'vitest';

/**
 * Static checks over the panels, in the spirit of layers/shaders.test.ts.
 *
 * There is no DOM in this suite, so what `makeFoldable` does to an element
 * cannot be exercised here. What can be checked is the thing most likely to go
 * wrong as the map grows: a sixth panel arriving without a fold control, or
 * with one of its own that looks and behaves almost but not quite like the
 * other five. Both are silent — the panel works, it simply cannot be got out
 * of the way — and both are exactly what a reader notices first.
 */

const SOURCES = import.meta.glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const files = Object.entries(SOURCES)
  .filter(([path]) => !path.endsWith('.test.ts'))
  .map(([path, source]) => ({ name: path.replace('./', ''), source }));

/** Files that build a panel of their own, by the class they give it. */
const PANEL_CLASSES = ['panel-stats', 'panel-jump', 'panel-polity', 'panel-detail', 'panel-history'];

describe('every panel can be got out of the way', () => {
  it('finds the panels at all', () => {
    // A glob that matched nothing would make every check below vacuous.
    expect(files.length).toBeGreaterThan(4);
    const declared = files.flatMap(({ source }) =>
      PANEL_CLASSES.filter((name) => source.includes(name)),
    );
    expect(new Set(declared).size).toBe(PANEL_CLASSES.length);
  });

  it('gives a fold control to every file that builds one', () => {
    const missing = files
      .filter(({ source }) => PANEL_CLASSES.some((name) => source.includes(`panel ${name}`)))
      .filter(({ source }) => !source.includes('makeFoldable'))
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it('gives a grip to every file that builds one', () => {
    // Folding and dragging answer the same complaint from opposite ends — the
    // panel is in the way — and a panel with one and not the other is an odd
    // thing to have to explain.
    const missing = files
      .filter(({ source }) => PANEL_CLASSES.some((name) => source.includes(`panel ${name}`)))
      .filter(({ source }) => !source.includes('makeDraggable'))
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it('has exactly one implementation of folding', () => {
    // The caret must mean the same thing on all five. A panel that hid its own
    // body with its own button would drift in appearance and in behaviour, and
    // the reader would have to learn each panel separately.
    const carets = files
      .filter(({ name }) => name !== 'foldable.ts')
      .filter(({ source }) => source.includes('▸') || source.includes('▾'))
      .map(({ name }) => name);
    expect(carets).toEqual([]);
  });
});
