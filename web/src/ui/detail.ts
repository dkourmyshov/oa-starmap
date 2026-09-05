/**
 * The detail panel for a selected object.
 *
 * Its job is provenance as much as identification. The pipeline already records
 * which catalogue every figure came from, how uncertain it is, and — for HII
 * regions — which of two incompatible methods produced the distance. Showing the
 * name and hiding the rest would let the map imply a precision it does not have,
 * so the uncertainty band and the source citation are part of the panel, not an
 * optional extra.
 */

import type {
  AssociationData,
  ClusterData,
  FictionData,
  HiiData,
  InnerSphereData,
  OAStarData,
  StarData,
  WorldData,
  WorldEvent,
} from '../data/manifest';
import {
  KIND_ASSOCIATION,
  KIND_CLUSTER,
  KIND_HII,
  KIND_OASTAR,
  KIND_STAR,
  KIND_WORLD,
  type ObjectIndex,
  bayerLabel,
  systemLabel,
  type EpochFilter,
} from '../scene/objects';
import { type Holding, type PolitySpans, holdersAt, holdingsOf, politySpans } from '../data/history';
import { affiliationsFor } from '../data/manifest';
import { PC_TO_LY, type DistanceUnit, type Parsecs, formatDistance, pc } from '../units';
import { type Foldable, makeFoldable } from './foldable';
import { makeDraggable } from './drag';

/**
 * How an event kind reads in the panel.
 *
 * Spelled out rather than shown raw, because the stored words are a controlled
 * vocabulary chosen to be sortable and unambiguous, not to be read: "stewardship"
 * on its own does not say who took the system or that it is a Caretaker thing.
 */
const EVENT_LABEL: Record<string, string> = {
  observed: 'first observed',
  visited: 'first visited',
  settled: 'settled',
  contact: 'first contact',
  stewardship: 'taken into stewardship',
  capital: 'became a capital',
  transferred: 'changed hands',
  reported: 'discovery reported',
  abandoned: 'abandoned',
};

/**
 * The same events, where the source says which polity was involved.
 *
 * A separate table rather than a suffix bolted onto the one above, because the
 * preposition is the meaning: settled *by* the Doran Empire, passed *to* the
 * Non-Coercive Zone, capital *of* the Solar Dominion. This is the only place a
 * polity dissolved before the setting's present is ever named on the map.
 */
const EVENT_WITH_POLITY: Record<string, (name: string) => string> = {
  settled: (name) => `settled by ${name}`,
  visited: (name) => `first visited by ${name}`,
  transferred: (name) => `passed to ${name}`,
  capital: (name) => `became a capital of ${name}`,
  abandoned: (name) => `abandoned by ${name}`,
  stewardship: (name) => `taken into stewardship by ${name}`,
};

/** How an event reads, naming its polity where it has one. */
export function eventLabel(
  event: { kind: string; polity?: string },
  polityName: (id: string) => string | undefined,
): string {
  const plain = EVENT_LABEL[event.kind] ?? event.kind;
  const name = event.polity ? polityName(event.polity) ?? event.polity : '';
  if (!name) return plain;
  const worded = EVENT_WITH_POLITY[event.kind];
  return worded ? worded(name) : `${plain} (${name})`;
}

/**
 * How a hedged year reads.
 *
 * The sources hedge in several distinct ways and the panel should not flatten
 * them: "before 1644", "around 3000" and "between 1500 and 2100" are three
 * different claims and only one of the three is a date.
 */
function formatYear(event: WorldEvent): string {
  const { year_at: year, until_at: until, precision } = event;
  if (precision === 'between' && until) return `${year}–${until} A.T.`;
  if (precision === 'circa') return `c. ${year} A.T.`;
  if (precision === 'not_later_than') return `by ${year} A.T.`;
  if (precision === 'not_earlier_than') return `after ${year} A.T.`;
  // An exact year with a second one is a span: the thing took that long.
  if (until) return `${year}–${until} A.T.`;
  return `${year} A.T.`;
}

interface Row {
  label: string;
  value: string;
  warn?: boolean;
}

interface Detail {
  title: string;
  subtitle: string;
  rows: Row[];
  polities: string[];
  /** Which OA source the polity association was read from, if any. */
  associationSource: string | null;
  /** Present holders as polity ids, for the history-mode line. */
  present?: string[];
  /** Past holders on record, for the same. */
  holdings?: Holding[];
  /**
   * The object's own Encyclopaedia article, where a source names one.
   *
   * Distinct from the association source, which is the page the *affiliation*
   * was read from. For a star in the Inner Sphere table those are different
   * pages: the table is one topic listing nine hundred systems, and it links
   * each one out to its article. Reading the source alone sent every one of
   * those stars to the table.
   */
  article?: string | null;
  /** Dated history, earliest first. Years After Tranquility. */
  events?: WorldEvent[];
  /**
   * Canonical worlds in this system.
   *
   * A list, because a system is not one world — Sol has Earth and much else. The
   * panel names every one it holds rather than promoting the first to stand for
   * the system.
   */
  worlds?: { name: string; kind: string; article: string }[];
  /** What the mark on the map means, where that needs saying in words. */
  note?: string;
  citation: string;
  /** Distance from Sol in pc, for the frontier check. */
  distancePc: number;
  /** Where to fly to, and how far to stand off. */
  focus: { x: number; y: number; z: number; standoff: Parsecs };
}

export interface DetailSources {
  stars: StarData;
  clusters: ClusterData | null;
  hii: HiiData | null;
  associations: AssociationData | null;
  oaStars: OAStarData | null;
  innerSphere: InnerSphereData | null;
  worlds: WorldData | null;
  fiction: FictionData | null;
  objects: ObjectIndex;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A line carrying a URL, with the URL itself as the link.
 *
 * Any leading prose stays plain text and only the address is clickable, so it
 * is obvious what will open. The address is shown whole: an Encyclopaedia
 * article hash carries no meaning, but eliding it hid the one part that tells
 * two links apart, and a reader who wants to copy or compare one should not
 * have to hover for it. Only the scheme and any "www." come off.
 */
function linkLine(className: string, url: string, prefix = ''): HTMLElement {
  const line = el('div', className);
  if (prefix) line.appendChild(document.createTextNode(`${prefix} `));
  const anchor = el('a', 'link');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.textContent = url.replace(/^https?:\/\/(?:www\.)?/, '');
  line.appendChild(anchor);
  return line;
}

/**
 * Whether a selection has anything from Orion's Arm worth a block of its own.
 *
 * Pulled out as a predicate because it has been wrong twice, both times by
 * omission. First the article link hung inside the polity branch, so a place
 * with no holder showed no source. Then the link moved out of that branch but
 * this gate still did not mention it, so a place with a source and nothing else
 * — no holder, no dates, nothing inside it — opened no block at all and the
 * link had nowhere to render. Twenty-seven entries were in that state, Utmig
 * among them.
 *
 * Every reason to open the block belongs here, and nowhere else.
 */
export function hasOrionsArmBlock(
  detail: {
    polities: string[];
    worlds?: unknown[];
    events?: unknown[];
    associationSource?: string | null;
  },
  beyondFrontier: boolean,
): boolean {
  return Boolean(
    detail.polities.length > 0 ||
      beyondFrontier ||
      detail.worlds?.length ||
      detail.events?.length ||
      detail.associationSource,
  );
}

/** Everything in the string that looks like an address, in order. */
const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * A citation, which may be prose, a bare address, or prose ending in one.
 * Splitting on the address rather than testing the whole string means a
 * citation like "Table 3, https://…" still gets a working link.
 */
function citationLine(className: string, text: string): HTMLElement {
  const urls = text.match(URL_PATTERN);
  if (!urls || urls.length !== 1) return el('div', className, text);
  const [url] = urls;
  return linkLine(className, url, text.slice(0, text.indexOf(url)).trim());
}

/**
 * The Encyclopaedia article behind a selection, if there is one.
 *
 * Gathered from what the panel was already going to print rather than carried
 * separately by every `describe*`: the article reaches the panel as an
 * association source on some kinds and as a world's own link on others, and a
 * second field would be a second thing to forget to fill in. `hasOrionsArmBlock`
 * above is a note about exactly that failure happening twice.
 *
 * Only orionsarm.com counts. The other addresses on this panel are ADS and
 * VizieR — the catalogue's citation, which is a different claim and has its own
 * place at the foot.
 *
 * The object's own article leads, where a source names one apart from the page
 * the affiliation came from. That order matters for the Inner Sphere: its
 * source is a topic page listing every system within a hundred light years,
 * and reading it first sent a reader who clicked Tau Ceti to that list rather
 * than to Tau Ceti. The worlds come last because on a host's panel they are
 * its guests, and the host's own page is the one that was clicked for.
 */
export function encyclopaediaArticle(detail: {
  article?: string | null;
  associationSource?: string | null;
  worlds?: { article: string }[];
}): string | null {
  const texts = [
    detail.article ?? '',
    detail.associationSource ?? '',
    ...(detail.worlds ?? []).map((w) => w.article),
  ];
  for (const text of texts) {
    const found = text.match(URL_PATTERN)?.find((url) => url.includes('orionsarm.com'));
    if (found) return found;
  }
  return null;
}

/**
 * A citation with an address that is already on the panel taken back out.
 *
 * Returns null when nothing but the address was left, so the caller can drop
 * the line rather than print an empty one.
 */
function withoutLink(text: string, shown: string | null): string | null {
  if (!shown || !text.includes(shown)) return text;
  const rest = text.replace(shown, '').trim().replace(/[,;]$/, '').trim();
  return rest || null;
}

/** "1 200 ly (940 – 1 500)" — the band is the honest part. */
function distanceWithBand(
  distance: number,
  lo: number,
  hi: number,
  unit: DistanceUnit,
): string {
  const main = formatDistance(pc(distance), unit);
  if (!(hi > lo) || (lo <= 0 && hi <= 0)) return main;
  const spread = Math.max(distance - lo, hi - distance);
  if (spread / Math.max(distance, 1e-9) < 0.02) return main;
  return `${main}  (${formatDistance(pc(lo), unit)} – ${formatDistance(pc(hi), unit)})`;
}

/**
 * Who held a place in a year, beside who holds it now, as names.
 *
 * The map in history mode colours the place by the first; the panel is where
 * the second is still said. Both are given so a reader can see which claim
 * the colour is making — a holder an event names, or the present one standing
 * in — and a place held by nobody named in that year says so.
 */
export function heldInYear(
  detail: { present?: string[]; holdings?: Holding[] },
  year: number,
  spans: PolitySpans,
  nameOf: (id: string) => string,
): { then: string[]; now: string[] } | null {
  const present = detail.present ?? [];
  if (!present.length && !detail.holdings?.length) return null;
  return {
    then: holdersAt(detail.holdings, present, year, spans).map(nameOf),
    now: present.map(nameOf),
  };
}

export class DetailPanel {
  private readonly panel: HTMLElement;
  /** Set while history mode is on, so the panel can say who held the place then. */
  epoch: EpochFilter | undefined = undefined;
  /** Made on the first selection and re-pointed at each rebuilt body. */
  private fold: Foldable | null = null;
  private current: number | null = null;

  constructor(
    root: HTMLElement,
    private readonly sources: DetailSources,
    private readonly onFocus: (x: number, y: number, z: number, standoff: Parsecs) => void,
  ) {
    this.panel = el('div', 'panel panel-detail');
    this.panel.style.display = 'none';
    root.appendChild(this.panel);
  }

  /** The selected object, so the map can keep its label on screen. */
  get currentId(): number | null {
    return this.current;
  }

  /** Re-render with the same selection, e.g. after the unit toggle changes. */
  refresh(unit: DistanceUnit): void {
    if (this.current !== null) this.show(this.current, unit);
  }

  clear(): void {
    this.current = null;
    this.panel.style.display = 'none';
  }

  show(id: number, unit: DistanceUnit): void {
    const detail = this.describe(id, unit);
    if (!detail) {
      this.clear();
      return;
    }

    this.current = id;
    this.panel.innerHTML = '';
    this.panel.style.display = '';

    const head = el('div', 'row');
    head.appendChild(el('span', 'title', detail.title));
    const close = el('button', 'toggle', '×');
    close.title = 'Close, and clear the selection';
    close.addEventListener('click', () => this.clear());
    head.appendChild(close);
    this.panel.appendChild(head);

    // Everything below the heading, so it can be folded as one. This panel is
    // rebuilt on every selection, so the wrapper is made here rather than by
    // the fold control, which is then pointed at the new one — otherwise the
    // panel would spring open again every time the reader clicked a star.
    const body = el('div', 'panel-body');
    this.panel.appendChild(body);
    if (this.fold) this.fold.rebind(body);
    else {
      this.fold = makeFoldable(this.panel, { body, title: 'the details' });
      makeDraggable(this.panel, head);
    }

    body.appendChild(el('div', 'note-line', detail.subtitle));

    // The Encyclopaedia article, at the top where it can be seen without
    // scrolling. It used to sit in the Orion's Arm block below the measurements,
    // which on a 46vh panel is under the fold for anything with more than a few
    // rows — so the one link a reader most wants after clicking a place, the one
    // that says what the place *is*, was the one thing they had to go looking
    // for. The catalogue citation stays at the foot: that is a statement about
    // where the numbers came from, and it is not what anyone clicked for.
    const article = encyclopaediaArticle(detail);
    if (article) body.appendChild(linkLine('note-line note-article', article, 'Encyclopaedia'));

    // In history mode, who held it in the year shown and who holds it now,
    // here rather than in the Orion's Arm block below, because the colour on
    // the map has just changed and this is what it changed to.
    const fictionData = this.sources.fiction;
    if (this.epoch && fictionData) {
      const names = new Map(fictionData.polities.map((p) => [p.id, p.name]));
      const held = heldInYear(
        detail,
        this.epoch.year,
        politySpans(fictionData),
        (id) => names.get(id) ?? id,
      );
      if (held) {
        const then = el('div', 'row');
        then.appendChild(el('span', 'label', `${this.epoch.year} AT`));
        then.appendChild(el('span', 'value', held.then.join(', ') || 'held by nobody named'));
        body.appendChild(then);
        const now = el('div', 'row');
        now.appendChild(el('span', 'label', 'now'));
        now.appendChild(el('span', 'value', held.now.join(', ') || 'no holder recorded'));
        body.appendChild(now);
      }
    }

    for (const row of detail.rows) {
      const line = el('div', 'row');
      line.appendChild(el('span', 'label', row.label));
      line.appendChild(el('span', row.warn ? 'value value-warn' : 'value', row.value));
      body.appendChild(line);
    }

    const fiction = this.sources.fiction;
    const beyond = fiction ? detail.distancePc > fiction.frontierPc : false;

    // Whatever the address at the top already said is not said again below.
    // Where the source was nothing but that address, the line goes entirely —
    // and with it, on a place whose only Orion's Arm content *was* that link,
    // the whole block: a heading over nothing is worse than no heading.
    const source = detail.associationSource
      ? withoutLink(detail.associationSource, article)
      : null;

    if (hasOrionsArmBlock({ ...detail, associationSource: source }, beyond)) {
      const note = el('div', 'note');
      note.appendChild(el('div', 'note-line', "Orion's Arm"));
      if (detail.polities.length > 0) {
        note.appendChild(el('div', 'note-line note-polity', detail.polities.join(', ')));
        if (source) note.appendChild(citationLine('note-line', `after ${source}`));
      } else if (source) {
        // Bare rather than "after …", which would claim the source backs an
        // affiliation when there is no affiliation to back.
        note.appendChild(citationLine('note-line', source));
      }
      for (const event of detail.events ?? []) {
        const line = el('div', 'row');
        // The year leads. It is what the reader came to this block for, and
        // what a run of them has to be scannable by. A span shows both ends,
        // and an approximate year is hedged rather than presented as a date.
        line.appendChild(el('span', 'label', formatYear(event)));
        line.appendChild(
          el(
            'span',
            'value',
            eventLabel(event, (id) => fiction?.polities.find((p) => p.id === id)?.name),
          ),
        );
        note.appendChild(line);
        if (event.note) note.appendChild(el('div', 'note-line', event.note));
      }
      for (const world of detail.worlds ?? []) {
        const line = el('div', 'row');
        line.appendChild(el('span', 'label', world.kind));
        line.appendChild(el('span', 'value', world.name));
        note.appendChild(line);
        // A system with several worlds gets a link each; the one already at the
        // top is not repeated.
        if (world.article && world.article !== article) {
          note.appendChild(linkLine('note-line', world.article));
        }
      }
      if (beyond && fiction) {
        // Stated on the panel rather than only implied by the missing colour,
        // because "no polity colour" and "beyond the frontier" look identical
        // on the map otherwise.
        note.appendChild(
          el(
            'div',
            'note-line note-warn',
            `Beyond the ${fiction.frontierLy.toLocaleString('en-US')} ly Terragen ` +
              `frontier${
                detail.polities.length > 0
                  ? ' — the association marks a direction, not a territorial claim, ' +
                    'so no polity colour is drawn.'
                  : '.'
              }`,
          ),
        );
      }
      body.appendChild(note);
    }

    const actions = el('div', 'note');
    const fly = el('button', 'jump', 'Fly here');
    fly.addEventListener('click', () => {
      const { x, y, z, standoff } = detail.focus;
      this.onFocus(x, y, z, standoff);
    });
    actions.appendChild(fly);
    // What the mark means, where the mark is not self-explanatory. Above the
    // citation because it is about this map's drawing rather than the source's
    // measurement — an OB association's outline is a contour and not an edge,
    // and a reader who takes it for one has been misled by us, not by Quintana.
    if (detail.note) {
      actions.appendChild(el('div', 'note-line note-warn', detail.note));
    }
    actions.appendChild(citationLine('note-line', detail.citation));
    body.appendChild(actions);
  }

  private politiesFor(kind: string, index: number): string[] {
    const fiction = this.sources.fiction;
    if (!fiction) return [];
    const names = new Map(fiction.polities.map((p) => [p.id, p.name]));
    const out: string[] = [];
    for (const binding of fiction.bindings) {
      if (binding.kind !== kind || binding.index !== index) continue;
      for (const id of binding.polities) out.push(names.get(id) ?? id);
    }
    return out;
  }

  /**
   * Where the polity associations for this object were read from.
   *
   * The association is a reading of a particular map at a particular epoch, not
   * a fact about the object, so the panel says which map — otherwise a colour
   * and a catalogue measurement read as equally authoritative.
   */
  /** The polities the landmark bindings attach to an object, as ids. */
  private polityIdsFor(kind: string, index: number): string[] {
    const out: string[] = [];
    for (const binding of this.sources.fiction?.bindings ?? []) {
      if (binding.kind !== kind || binding.index !== index) continue;
      for (const id of binding.polities) if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  private sourceLineFor(kind: string, index: number): string | null {
    const fiction = this.sources.fiction;
    if (!fiction) return null;

    const byId = new Map(fiction.polities.map((p) => [p.id, p]));
    const keys = new Set<string>();
    for (const binding of fiction.bindings) {
      if (binding.kind !== kind || binding.index !== index) continue;
      for (const id of binding.polities) {
        const key = byId.get(id)?.source;
        if (key) keys.add(key);
      }
    }

    const parts: string[] = [];
    for (const key of [...keys].sort()) {
      const source = fiction.sources[key];
      if (!source) continue;
      parts.push(source.epoch_at ? `${source.title} (${source.epoch_at} A.T.)` : source.title);
    }
    return parts.length ? parts.join('; ') : null;
  }

  private describe(id: number, unit: DistanceUnit): Detail | null {
    const { kind, index } = this.sources.objects.ref(id);
    if (kind === KIND_STAR) return this.describeStar(index, unit);
    if (kind === KIND_CLUSTER) return this.describeCluster(index, unit);
    if (kind === KIND_HII) return this.describeHii(index, unit);
    if (kind === KIND_OASTAR) return this.describeOAStar(index, unit);
    if (kind === KIND_WORLD) return this.describeWorld(index, unit);
    if (kind === KIND_ASSOCIATION) return this.describeAssociation(index, unit);
    return null;
  }

  /**
   * A canonical world, positioned from a distance and a direction.
   *
   * Only the ones carrying their own coordinates reach here. A world bound to a
   * star is described by that star's panel, which is the object the reader
   * clicked.
   *
   * The panel leads with how the position was arrived at, because for most of
   * these the answer is "a distance and a constellation" and the direction is
   * good to something like a thousand light years. A reader who takes the dot
   * literally has been misled by the map, and this row is where the map says so.
   */
  private describeWorld(index: number, unit: DistanceUnit): Detail | null {
    const worlds = this.sources.worlds;
    const world = worlds?.worlds[index];
    if (!worlds || !world || world.x === null) return null;

    const x = world.x;
    const y = world.y as number;
    const z = world.z as number;
    const distance = world.distance_pc ?? Math.sqrt(x * x + y * y + z * z);

    const rows: Row[] = [
      { label: 'Distance from Sol', value: formatDistance(pc(distance), unit) },
    ];

    if (world.method === 'constellation') {
      rows.push({
        label: 'Position',
        // The distance is the precise half of it, and saying so is not a
        // hedge — it is the more useful of the two facts.
        value: 'distance exact, direction only to the constellation',
        warn: true,
      });
      if (world.direction_error_ly !== null) {
        rows.push({
          label: 'Direction uncertain by',
          value: `${formatDistance(pc(world.direction_error_ly / PC_TO_LY), unit)} across`,
          warn: true,
        });
      }
    } else if (world.method === 'direction') {
      rows.push({ label: 'Position', value: 'direction exact, distance as given' });
    }
    if (world.constellation) rows.push({ label: 'Constellation', value: world.constellation });

    if (world.kind) rows.push({ label: 'Kind', value: world.kind });
    // A system and a world inside it are one place, not two: Penglai is a moon
    // of Shenjing rather than its neighbour.
    if (world.within) rows.push({ label: 'Within', value: world.within });
    if (world.contains.length) {
      rows.push({ label: 'Contains', value: world.contains.join(', ') });
    }
    if (world.system && world.system !== world.name) {
      rows.push({ label: 'System', value: world.system });
    }
    if (world.parent && world.parent !== world.system) {
      rows.push({ label: 'Orbits', value: world.parent });
    }
    if (world.also.length) rows.push({ label: 'Also called', value: world.also.join(', ') });
    if (world.radius_pc) {
      rows.push({
        label: 'Extent',
        value: `${formatDistance(pc(world.radius_pc * 2), unit)} across`,
      });
    }
    // Ahead of the note, and warned, because it is the one thing that
    // distinguishes this dot from every other world drawn at coordinates:
    // nobody published these, we worked them out.
    if (world.estimated) {
      rows.push({ label: 'Position', value: 'estimated, not stated by a source', warn: true });
      rows.push({ label: 'Derivation', value: world.estimated });
    }
    if (world.note) rows.push({ label: 'Note', value: world.note });

    const held = (world.affiliations ?? [])
      .map((id) => this.sources.fiction?.polities.find((p) => p.id === id)?.name ?? id)
      .map((name) => (world.uncertain ? `${name} (uncertain)` : name));

    return {
      title: world.name,
      subtitle: "Orion's Arm world",
      rows,
      polities: held,
      associationSource: world.article || null,
      present: world.affiliations,
      holdings: holdingsOf([world, ...(worlds.byHost.get(world.name) ?? [])]),
      // The host's own events and its guests', interleaved by year.
      events: [world, ...(worlds.byHost.get(world.name) ?? [])]
        .flatMap((w) => w.events)
        .sort((a, b) => a.year_at - b.year_at || a.kind.localeCompare(b.kind)),
      worlds: (worlds.byHost.get(world.name) ?? []).map((w) => ({
        name: w.name,
        kind: w.kind,
        article: w.article,
      })),
      citation: worlds.dataset.source.citation,
      distancePc: distance,
      focus: { x, y, z, standoff: pc(Math.max(distance * 0.12, 2)) },
    };
  }

  /**
   * An Orion's Arm star.
   *
   * The panel leads with the fact that this position is asserted rather than
   * measured, because that is the one thing distinguishing it from every other
   * object the map draws.
   */
  private describeOAStar(index: number, unit: DistanceUnit): Detail | null {
    const oaStars = this.sources.oaStars;
    if (!oaStars) return null;

    const base = index * 5;
    const [x, y, z] = [
      oaStars.positions[base],
      oaStars.positions[base + 1],
      oaStars.positions[base + 2],
    ];
    const absMag = oaStars.positions[base + 3];
    const entry = oaStars.names[index];
    const distance = Math.sqrt(x * x + y * y + z * z);

    const rows: Row[] = [
      { label: 'Distance from Sol', value: formatDistance(pc(distance), unit) },
      entry.real
        ? { label: 'Position', value: 'measured — this is a real object' }
        : { label: 'Position', value: 'asserted by the setting', warn: true },
      { label: 'Absolute magnitude', value: absMag.toFixed(2) },
    ];
    // Named before the add-on's own designation: for these entries the real
    // identification is the more useful of the two.
    if (entry.real) rows.push({ label: 'Real object', value: entry.real });
    // The curated name takes the title, so the add-on's own identifier still
    // has to be findable — "Hiederia" is a name it chose, not a catalogue number.
    if (entry.label && entry.label !== entry.name) {
      rows.push({ label: entry.oa_designation ? 'Designation' : 'Star', value: entry.name });
    }
    if (entry.system && entry.system !== entry.label) {
      // What the add-on's comment called it, which is often the planet or the
      // species rather than the system.
      rows.push({ label: 'Add-on calls it', value: entry.system });
    }
    if (entry.spectral_type) {
      rows.push({ label: 'Spectral type', value: entry.spectral_type });
    }
    if (entry.comment) rows.push({ label: 'Note', value: entry.comment });
    // Which add-on file it came from. Ordinarily incidental, but the add-on
    // reuses "JD 518791" for two different stars, and this is what tells them
    // apart in the panel.
    if (entry.source_file) rows.push({ label: 'Add-on file', value: entry.source_file });

    const affiliation = this.sources.fiction?.polities.find(
      (p) => p.id === entry.affiliation,
    );
    const here = this.sources.worlds?.byOAStar.get(entry.name) ?? [];

    if (entry.note) rows.push({ label: 'Note', value: entry.note });

    return {
      title: (here.length ? systemLabel(here) : '') || entry.label || entry.name,
      subtitle: "Orion's Arm system",
      worlds: here.map((w) => ({ name: w.name, kind: w.kind, article: w.article })),
      // Merged across every world in the system and re-sorted: the history of a
      // system is one sequence, even where two of its worlds each contribute to
      // it, and interleaving by year is the only way it reads as one.
      events: here
        .flatMap((w) => w.events)
        .sort((a, b) => a.year_at - b.year_at || a.kind.localeCompare(b.kind)),
      rows,
      polities: affiliation
        ? [entry.uncertain ? `${affiliation.name} (uncertain)` : affiliation.name]
        : [],
      associationSource: entry.article || null,
      present: [
        ...(entry.affiliation ? [entry.affiliation] : []),
        ...affiliationsFor(undefined, here).filter((id) => id !== entry.affiliation),
      ],
      holdings: holdingsOf(here),
      citation: oaStars.dataset.source.citation,
      distancePc: distance,
      focus: { x, y, z, standoff: pc(Math.max(distance * 0.12, 2)) },
    };
  }

  private describeStar(index: number, unit: DistanceUnit): Detail {
    const stars = this.sources.stars;
    const base = index * 5;
    const x = stars.positions[base];
    const y = stars.positions[base + 1];
    const z = stars.positions[base + 2];
    const absMag = stars.positions[base + 3];
    const colorIndex = stars.positions[base + 4];
    const distance = Math.sqrt(x * x + y * y + z * z);

    const names = stars.names[String(index)] ?? {};
    const classes = stars.dataset.layout.classes.values;
    const constellations = stars.dataset.layout.constellations.values;
    const spectral = classes[stars.spectralClass[index]] ?? '';
    const constellation = constellations[stars.constellation[index]] ?? '';

    // A bare "Alp" names nothing — there are 88 of them. Same reconstruction the
    // labels use, so the panel and the map agree on what a star is called.
    // Deduplicated, because HYG's fields overlap and often agree. 64 Serpentis
    // has no Bayer letter, so its Flamsteed form and its combined
    // Bayer-Flamsteed field are both "64 Ser", and the panel read
    // "64 Ser · 64 Ser · 64 Ser" once the title was added to the list.
    const designations = [
      ...new Set(
        [
          names.bayer ? bayerLabel(names.bayer, constellation) : '',
          names.flam ? `${names.flam} ${constellation}`.trim() : '',
          names.gl,
          // The combined field restates the other two — "57Zet Ser" for Zeta
          // Serpentis — so it only earns its place when neither is there.
          names.bayer || names.flam ? '' : names.bf,
        ].filter(Boolean),
      ),
    ];
    const title = names.proper || designations[0] || `Star #${index}`;
    // Whatever the title did not already use.
    const otherNames = designations.filter((name) => name !== title);

    const hip = stars.ids[index * 2];
    const hd = stars.ids[index * 2 + 1];
    const absentId = stars.dataset.layout.ids.absent_sentinel;
    const catalogIds = [
      hip !== absentId ? `HIP ${hip}` : null,
      hd !== absentId ? `HD ${hd}` : null,
    ].filter(Boolean);

    const colony = this.sources.innerSphere?.byStar.get(index);
    const here = this.sources.worlds?.byStar.get(index) ?? [];

    const rows: Row[] = [
      { label: 'Distance from Sol', value: formatDistance(pc(distance), unit) },
      { label: 'Absolute magnitude', value: absMag.toFixed(2) },
      {
        label: 'Apparent from Earth',
        value: (absMag + 5 * Math.log10(Math.max(distance, 1e-6) / 10)).toFixed(2),
      },
    ];
    if (spectral) rows.push({ label: 'Spectral class', value: spectral });
    if (colorIndex !== stars.dataset.layout.positions.ci_unknown_sentinel) {
      rows.push({ label: 'Colour index B−V', value: colorIndex.toFixed(2) });
    }
    if (constellation) rows.push({ label: 'Constellation', value: constellation });
    if (catalogIds.length) rows.push({ label: 'Catalogue', value: catalogIds.join(', ') });

    const unreliable = stars.dataset.selection.reliability.unreliable_beyond_pc;
    if (distance > unreliable) {
      rows.push({
        label: 'Distance quality',
        value: 'indicative only',
        warn: true,
      });
    }

    if (colony?.status) {
      rows.push({ label: 'Status', value: colony.status, warn: colony.status !== 'special' });
    }
    // What the table says the place is, where it gave no name for it. Shown as
    // a row of its own, because it is not a name and reads wrongly as one.
    if (colony?.described) rows.push({ label: "Orion's Arm", value: colony.described });
    if (colony?.note) rows.push({ label: 'Note', value: colony.note });
    if (colony?.distance_disagrees) {
      rows.push({
        label: "Orion's Arm distance",
        value: `${colony.distance_ly.toFixed(1)} ly stated`,
        warn: true,
      });
    }

    // The system's name, never a world's: labelling Sol "Earth" would misname
    // the system the moment a second world is recorded there.
    const systemName = here.length ? systemLabel(here) : '';

    return {
      title: systemName || colony?.colony || title,
      subtitle:
        systemName || colony?.colony
          ? [`Orion's Arm system`, title, ...otherNames].filter(Boolean).join(' · ')
          : designations.length
            ? designations.join(' · ')
            : 'star',
      rows,
      polities: [
        ...this.politiesFor('star', index),
        ...(colony?.affiliations ?? []).map(
          (id) => this.sources.fiction?.polities.find((p) => p.id === id)?.name ?? id,
        ),
        ...here
          .flatMap((w) => w.affiliations)
          .map((id) => this.sources.fiction?.polities.find((p) => p.id === id)?.name)
          .filter((name): name is string => Boolean(name)),
      ].filter((name, i, all) => all.indexOf(name) === i),
      worlds: here.map((w) => ({ name: w.name, kind: w.kind, article: w.article })),
      // Merged across every world in the system and re-sorted: a system's
      // history is one sequence even where two of its worlds contribute to it.
      events: here
        .flatMap((w) => w.events)
        .sort((a, b) => a.year_at - b.year_at || a.kind.localeCompare(b.kind)),
      associationSource:
        this.sourceLineFor('star', index) ??
        (colony?.affiliations.length ? this.sources.innerSphere?.dataset.source.citation ?? null : null),
      present: [
        ...affiliationsFor(colony, here),
        ...this.polityIdsFor('star', index).filter((id) => !affiliationsFor(colony, here).includes(id)),
      ],
      holdings: holdingsOf(here),
      // The table's own link for the system, then the page of a world drawn
      // here. Neither is the topic page the affiliation was read from, which
      // stays below as the citation for that claim and is not what a reader
      // clicking a star is after.
      article: colony?.article || here.find((w) => w.article)?.article || null,
      citation: stars.dataset.source.citation,
      distancePc: distance,
      focus: { x, y, z, standoff: pc(Math.max(distance * 0.12, 2)) },
    };
  }

  private describeCluster(index: number, unit: DistanceUnit): Detail | null {
    const clusters = this.sources.clusters;
    if (!clusters) return null;

    const base = index * 8;
    const [x, y, z] = [
      clusters.geometry[base],
      clusters.geometry[base + 1],
      clusters.geometry[base + 2],
    ];
    const radiusTotal = clusters.geometry[base + 3];
    const radiusCore = clusters.geometry[base + 4];
    const distance = clusters.geometry[base + 5];
    const lo = clusters.geometry[base + 6];
    const hi = clusters.geometry[base + 7];

    const entry = clusters.names[index];
    const typeIndex = clusters.meta[index * 2];
    const members = clusters.meta[index * 2 + 1];
    const typeCode = clusters.dataset.layout.types.order[typeIndex];
    const typeLabel = clusters.dataset.layout.types.labels[typeCode] ?? 'unknown';

    const rows: Row[] = [
      { label: 'Distance from Sol', value: distanceWithBand(distance, lo, hi, unit) },
      { label: 'Radius', value: formatDistance(pc(radiusTotal), unit) },
      { label: 'Core radius', value: formatDistance(pc(radiusCore), unit) },
    ];
    if (members > 0) rows.push({ label: 'Members', value: members.toLocaleString('en-US') });

    const logAge = clusters.ages[index];
    if (Number.isFinite(logAge)) {
      const myr = 10 ** logAge / 1e6;
      rows.push({
        label: 'Age',
        value: myr >= 1000 ? `${(myr / 1000).toFixed(1)} Gyr` : `${myr.toPrecision(2)} Myr`,
      });
    }
    if (entry?.quality) rows.push({ label: 'CMD class', value: entry.quality });

    const aliases = (entry?.aliases ?? '').split(',').filter(Boolean);

    return {
      title: (entry?.name ?? `Cluster #${index}`).replace(/_/g, ' '),
      subtitle: [typeLabel, ...aliases.slice(0, 3).map((a) => a.replace(/_/g, ' '))].join(' · '),
      rows,
      polities: this.politiesFor('cluster', index),
      associationSource: this.sourceLineFor('cluster', index),
      citation: clusters.dataset.source.citation,
      distancePc: distance,
      focus: { x, y, z, standoff: pc(Math.max(radiusTotal * 4.5, 5)) },
    };
  }

  private describeAssociation(index: number, unit: DistanceUnit): Detail | null {
    const associations = this.sources.associations;
    if (!associations) return null;

    const base = index * 7;
    const x = associations.geometry[base];
    const y = associations.geometry[base + 1];
    const z = associations.geometry[base + 2];
    const sigma: [number, number, number] = [
      associations.geometry[base + 3],
      associations.geometry[base + 4],
      associations.geometry[base + 5],
    ];
    const distance = associations.geometry[base + 6];
    const entry = associations.names[index];

    const rows: Row[] = [
      { label: 'Distance from Sol', value: distanceWithBand(distance, distance, distance, unit) },
      {
        label: 'Spread (x, y, z)',
        // All three, because the shape is the point. A single figure would say
        // the association is round, and none of them is.
        value: sigma.map((value) => formatDistance(pc(value), unit)).join(' · '),
      },
      { label: 'Members', value: `${entry.members}` },
    ];
    if (entry.o_stars !== null || entry.b_stars !== null) {
      rows.push({
        label: 'O / B systems',
        value: `${entry.o_stars ?? '—'} / ${entry.b_stars ?? '—'}`,
      });
    }
    if (entry.mass_sol !== null) {
      rows.push({
        label: 'Initial stellar mass',
        value: `${Math.round(entry.mass_sol).toLocaleString('en-US')} M☉`,
      });
    }
    if (entry.age_max_myr !== null) {
      rows.push({ label: 'Maximum age', value: `${entry.age_max_myr.toFixed(1)} Myr` });
    }
    if (entry.extinction_av !== null) {
      rows.push({ label: 'Extinction A_V', value: `${entry.extinction_av.toFixed(1)} mag` });
    }

    return {
      title: entry.name,
      subtitle: ['OB association', entry.alt_name].filter(Boolean).join(' · '),
      rows,
      polities: [],
      associationSource: null,
      note:
        'The outline is a one-sigma ellipsoid, not a boundary. An OB association ' +
        'is unbound and dissolving; a good deal of it lies outside the line, and ' +
        'there is no edge anywhere to draw.',
      citation: associations.dataset.source.citation,
      distancePc: distance,
      focus: {
        x,
        y,
        z,
        standoff: pc(Math.max(Math.max(...sigma) * 6, 20)),
      },
    };
  }

  private describeHii(index: number, unit: DistanceUnit): Detail | null {
    const hii = this.sources.hii;
    if (!hii) return null;

    const base = index * 7;
    const [x, y, z] = [hii.geometry[base], hii.geometry[base + 1], hii.geometry[base + 2]];
    const radius = hii.geometry[base + 3];
    const distance = hii.geometry[base + 4];
    const lo = hii.geometry[base + 5];
    const hi = hii.geometry[base + 6];

    const entry = hii.names[index];
    const methodIndex = hii.meta[index * 2];
    const method = hii.dataset.layout.methods.order[methodIndex] ?? 'unknown';

    const rows: Row[] = [
      { label: 'Distance from Sol', value: distanceWithBand(distance, lo, hi, unit) },
      {
        label: 'Distance method',
        value: method,
        // The whole point of recording the method is that one of them is weak.
        warn: method === 'kinematic',
      },
      { label: 'Radius', value: formatDistance(pc(radius), unit) },
      { label: 'Angular diameter', value: `${entry.diameter_arcmin.toFixed(0)}′` },
    ];
    if (entry.complex) rows.push({ label: 'Parent complex', value: `G${entry.complex}` });
    if (entry.brightness) rows.push({ label: 'Brightness class', value: entry.brightness });

    return {
      title: entry.name,
      subtitle: ['HII region', ...entry.aliases.split(',').slice(0, 1)].join(' · '),
      rows,
      polities: this.politiesFor('hii', index),
      associationSource: this.sourceLineFor('hii', index),
      citation: hii.dataset.source.citation,
      distancePc: distance,
      focus: { x, y, z, standoff: pc(Math.max(radius * 4.5, 5)) },
    };
  }
}
