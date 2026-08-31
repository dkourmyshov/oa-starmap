/**
 * A fold control for a panel.
 *
 * Five panels line the edges of this map, and between them they can take most
 * of a laptop screen. Every one of them earns its space while you are reading
 * it and none of them does while you are looking at the map — which is the
 * whole reason to have a map on screen at all.
 *
 * Written once rather than five times, so the control looks and behaves the
 * same everywhere. A caret that means "fold" on one panel and something subtly
 * different on the next is worse than no caret: the reader has to learn each
 * panel separately, and the thing they were promised was one gesture.
 *
 * It is applied to a panel that has already been built. Rather than making
 * every panel restructure itself around a body element, this finds the header —
 * the first thing carrying a title — and takes everything after it as the part
 * that folds. A panel written without any thought of folding therefore folds
 * correctly, which is the point: the next panel someone adds gets this for one
 * line and no rearrangement.
 */

const FOLDED = '▸';
const OPEN = '▾';

export interface Foldable {
  readonly folded: boolean;
  setFolded(folded: boolean): void;
  /**
   * Re-attach to a body that has been replaced since.
   *
   * The detail panel rebuilds its whole contents every time the selection
   * changes. Without this the fold control would be left holding a node that is
   * no longer in the document, and the panel would spring open on every click.
   */
  rebind(body: HTMLElement): void;
}

export interface FoldOptions {
  /**
   * What disappears. Defaults to everything after the header.
   *
   * Given explicitly where a panel folds to something more than its title — the
   * history panel keeps its year and its scrubber, because a reader who has set
   * the map to 4450 A.T. wants that number to stay in front of them.
   */
  body?: HTMLElement;
  folded?: boolean;
  title?: string;
  /** Called after each change, for a panel that must re-render when it opens. */
  onChange?: (folded: boolean) => void;
}

/** The row a fold button can sit in, making one if the header is a bare title. */
function headerRow(panel: HTMLElement): HTMLElement {
  const first = panel.firstElementChild as HTMLElement | null;
  if (!first) {
    const made = document.createElement('div');
    made.className = 'row';
    panel.appendChild(made);
    return made;
  }
  // Already a row with a title in it — the polity legend and the history panel
  // both look like this, having a switch beside their heading.
  if (first.classList.contains('row') && first.querySelector('.title')) return first;
  // A bare heading. Wrap it, so the button has a right-hand end to sit at.
  if (first.classList.contains('title')) {
    const row = document.createElement('div');
    row.className = 'row';
    panel.insertBefore(row, first);
    row.appendChild(first);
    return row;
  }
  const row = document.createElement('div');
  row.className = 'row';
  panel.insertBefore(row, first);
  return row;
}

/** Everything after the header, gathered so it can be hidden as one. */
function wrapBody(panel: HTMLElement, header: HTMLElement): HTMLElement {
  const body = document.createElement('div');
  body.className = 'panel-body';
  let node = header.nextSibling;
  while (node) {
    const next = node.nextSibling;
    body.appendChild(node);
    node = next;
  }
  panel.appendChild(body);
  return body;
}

export function makeFoldable(panel: HTMLElement, options: FoldOptions = {}): Foldable {
  const header = headerRow(panel);
  let body = options.body ?? wrapBody(panel, header);
  let folded = options.folded ?? false;

  const button = document.createElement('button');
  button.className = 'toggle toggle-fold';
  const apply = (): void => {
    button.textContent = folded ? FOLDED : OPEN;
    button.title = folded ? `Unfold ${options.title ?? 'this panel'}` : 'Fold this panel away';
    // `hidden` rather than a display rule, so a panel that sets its own display
    // on the body — as the detail panel does — cannot fight it.
    body.hidden = folded;
    panel.classList.toggle('panel-folded', folded);
  };
  button.addEventListener('click', () => {
    folded = !folded;
    apply();
    options.onChange?.(folded);
  });
  // First in the header's right-hand end, so it lands in the same place on
  // every panel whether or not that panel already had a switch of its own.
  header.appendChild(button);
  apply();

  return {
    get folded() {
      return folded;
    },
    setFolded(value: boolean) {
      folded = value;
      apply();
      options.onChange?.(folded);
    },
    rebind(next: HTMLElement) {
      body = next;
      apply();
    },
  };
}
