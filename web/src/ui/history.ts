/**
 * The map as it stood in a year, and what that year's history was about.
 *
 * Three controls, because the reader is asking three different questions and
 * the sources answer them with different authority.
 *
 * The **year** decides what is on the map, from dates read off each place's own
 * article. That is the strongest claim here and the one the map draws directly.
 *
 * The **period** decides what is emphasised, from the Encyclopaedia's own
 * timeline: a place its history names is a place that century was about, and
 * nothing derivable from settlement dates could have said so.
 *
 * The **basis** decides which date counts — first known, or settled. Two
 * different questions with two different answers, and roughly a hundred places
 * carry the first with no settlement year ever given, so the choice changes the
 * map by more than a detail. First *known* is deliberately not "first reached":
 * Beyniou is in the record from 1198 AT at 7,122 light years and nobody went
 * until 9462, and a control labelled "reached" would have made the map say so.
 *
 * What this panel will not do is fill a gap. About half the systems drawn here
 * carry no year in any source, and they are shown faintly with their number
 * stated rather than assigned a plausible one — an invented settlement date
 * would be indistinguishable on screen from a read one, and there would be no
 * way back from it.
 */

import type { EpochBasis, HistoryData, HistoryPeriod, HistoryPlace } from '../data/history';
import { eraOf, periodAt } from '../data/history';
import type { EpochSummary } from '../layers/epoch';
import { type DistanceUnit, formatDistance, pc } from '../units';
import { makeDraggable } from './drag';
import { makeFoldable } from './foldable';

export interface EpochState {
  year: number;
  basis: EpochBasis;
  /** Keep places whose sources give no year at all, drawn faintly. */
  showUndated: boolean;
  /** Dim everything the chosen period's own history does not name. */
  emphasise: boolean;
  period: HistoryPeriod | null;
}

export interface HistoryCallbacks {
  /** The whole state, or null when history mode is switched off. */
  onEpoch(state: EpochState | null): void;
  /** Fly to a place the timeline names. */
  onFocusPlace(place: HistoryPlace): void;
  /** Frame everything a polity holds, as the legend's own rows do. */
  onFocusPolity(polityId: string): void;
}

/** How many of a period's named places to list before the reader scrolls. */
const LISTED_PLACES = 40;

/** And how many polities. The busiest period names twenty-four. */
const LISTED_POLITIES = 12;

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

/** "4450 AT", and "before Tranquility" for the handful of negative years. */
export function formatYear(year: number): string {
  return year < 0 ? `${-year} BT` : `${year} AT`;
}

/**
 * What a timeline line's date claims, where it is not a bare year.
 *
 * The Encyclopaedia hedges in the forms its own pages use, and the difference
 * between "4450" and "4450s" is the difference between a date and a decade.
 */
export function formatEventYear(year: number, until: number | null, precision: string): string {
  if (precision === 'circa') return `${year}s`;
  if (precision === 'not_earlier_than') return `${year}+`;
  if (until !== null) return `${year}–${until}`;
  return String(year);
}

export class HistoryPanel {
  private readonly panel: HTMLElement;
  private readonly yearInput: HTMLInputElement;
  private readonly periodSelect: HTMLSelectElement;
  private readonly readout: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly polities: HTMLElement;
  private readonly places: HTMLElement;
  private readonly events: HTMLElement;
  private readonly body: HTMLElement;
  /** Everything below the scrubber, which is what makes the panel tall. */
  private readonly details: HTMLElement;
  private readonly modeToggle: HTMLButtonElement;

  private enabled = false;
  private collapsed = false;
  private shown = false;
  private year: number;
  /**
   * Settlement by default.
   *
   * "Extent of colonisation" is the question this view is mostly asked, and it
   * is the stricter of the two: a place merely seen from a long way off is not
   * a place anyone lives. The wider record is one button away.
   */
  private basis: EpochBasis = 'settled';
  /**
   * Off by default.
   *
   * Half the map has no date, and a historical view that opens with all of it
   * showing opens looking almost exactly like the ordinary map — which is the
   * one state in which the year control appears to do nothing. Shown, they are
   * faint and counted; hidden, the reader sees only what the sources date.
   */
  private showUndated = false;
  private emphasise = true;
  private unit: DistanceUnit;

  constructor(
    root: HTMLElement,
    private readonly history: HistoryData,
    /**
     * Read afresh each time, never held.
     *
     * The summary depends on which date is counting, and the ring layer swaps
     * it when the basis changes. Capturing one at construction left the panel
     * reporting settlement counts under the wrong basis — the map changed and
     * the number below it did not.
     */
    private readonly epochOf: () => EpochSummary,
    private readonly callbacks: HistoryCallbacks,
    unit: DistanceUnit,
  ) {
    this.unit = unit;
    const range = epochOf().range();
    this.year = range.last;

    this.panel = el('div', 'panel panel-history');

    const head = el('div', 'row panel-grip');
    head.appendChild(el('span', 'title', 'History'));
    this.modeToggle = el('button', 'toggle', 'off') as HTMLButtonElement;
    this.modeToggle.title =
      'Show the map as it stood in one year, from the dates in each place’s own article';
    this.modeToggle.addEventListener('click', () => this.setEnabled(!this.enabled));
    head.appendChild(this.modeToggle);
    this.panel.appendChild(head);

    // Everything below the switch, hidden while it is off: the controls all
    // describe a year, and there is no year until history mode is on.
    this.body = el('div', 'history-body');
    this.body.hidden = true;
    this.panel.appendChild(this.body);

    const periodRow = el('div', 'row');
    periodRow.appendChild(el('span', 'label', 'Period'));
    this.periodSelect = el('select', 'select') as HTMLSelectElement;
    this.buildPeriodOptions();
    this.periodSelect.addEventListener('change', () => {
      const period = this.history.dated.find((p) => p.id === this.periodSelect.value);
      if (!period) return;
      // Land at the start of the period, which is where its history begins.
      // Landing in the middle would show the period's own opening years as
      // already past on a map that has just been told to show them.
      this.setYear(period.start_at ?? this.year, { keepSelection: true });
    });
    periodRow.appendChild(this.periodSelect);
    this.body.appendChild(periodRow);

    this.readout = el('div', 'history-year', '');
    this.body.appendChild(this.readout);

    this.yearInput = el('input', 'slider') as HTMLInputElement;
    this.yearInput.type = 'range';
    this.yearInput.min = String(range.first);
    this.yearInput.max = String(range.last);
    this.yearInput.step = '1';
    this.yearInput.value = String(this.year);
    this.yearInput.addEventListener('input', () => this.setYear(Number(this.yearInput.value)));
    this.body.appendChild(this.yearInput);

    // The year opens at the end of the record, so the period has to as well.
    // Without this the panel opened saying "10600 AT - The Information Age":
    // the select showed whatever option happened to be first, and the caption
    // named a century of the Solsys Era over a map of the present.
    const opening = periodAt(this.history, this.year);
    if (opening) this.periodSelect.value = opening.id;

    // Below the scrubber, and foldable: this is the part that fills a laptop
    // screen, and the year is useful without it.
    this.details = el('div', 'history-details');
    this.body.appendChild(this.details);

    this.stats = el('div', 'note');
    this.details.appendChild(this.stats);

    const basisRow = el('div', 'row');
    basisRow.appendChild(el('span', 'label', 'Dated by'));
    const basisGroup = el('div', 'toggle-group');
    const bases: { id: EpochBasis; label: string; title: string }[] = [
      {
        id: 'known',
        label: 'known',
        title:
          'The first year the record mentions the place at all — including ones observed ' +
          'from far off millennia before anyone went',
      },
      {
        id: 'settled',
        label: 'settled',
        title: 'The year it became inhabited — a stricter and sparser record',
      },
    ];
    for (const option of bases) {
      const button = el('button', 'toggle', option.label);
      button.title = option.title;
      if (option.id === this.basis) button.classList.add('active');
      button.addEventListener('click', () => {
        for (const other of basisGroup.children) other.classList.remove('active');
        button.classList.add('active');
        this.basis = option.id;
        // Emit first: the layers are told the new basis, and the summary this
        // panel then reads is the one they are drawing.
        this.emit();
        this.render();
      });
      basisGroup.appendChild(button);
    }
    basisRow.appendChild(basisGroup);
    this.details.appendChild(basisRow);

    this.details.appendChild(
      this.switchRow(
        'Undated places',
        'show',
        'hide',
        false,
        'Places no source dates. Shown faintly, because hiding them would draw a far emptier sphere than the setting has',
        (on) => {
          this.showUndated = on;
          this.emit();
        },
      ),
    );

    this.details.appendChild(
      this.switchRow(
        'Emphasise period',
        'on',
        'off',
        true,
        'Dim everything the chosen period’s own timeline does not name',
        (on) => {
          this.emphasise = on;
          this.emit();
        },
      ),
    );

    this.details.appendChild(el('div', 'title', 'Polities of this period'));
    this.polities = el('div', 'legend history-polities');
    this.details.appendChild(this.polities);

    this.details.appendChild(el('div', 'title', 'Places named this period'));
    this.places = el('div', 'legend history-places');
    this.details.appendChild(this.places);

    this.details.appendChild(el('div', 'title', 'Timeline'));
    this.events = el('div', 'history-events');
    this.details.appendChild(this.events);

    root.appendChild(this.panel);
    // The same fold control every other panel has, pointed at the details
    // rather than at everything: this one folds to its year and its scrubber,
    // because a reader who has set the map to 4450 A.T. wants that number to
    // stay in front of them while the six hundred lines of timeline go away.
    // Not held: `collapsed` below is the state anything here needs, and the
    // control keeps it in step through onChange.
    makeFoldable(this.panel, {
      body: this.details,
      title: 'the timeline',
      onChange: (folded) => {
        this.collapsed = folded;
        if (!folded) this.render();
      },
    });
    makeDraggable(this.panel, head);
    // Closed to begin with. It is opened from the main panel, and until then it
    // should not be taking up the bottom of the screen.
    this.panel.hidden = true;
    this.render();
  }

  /**
   * The era hierarchy, as the Encyclopaedia has it.
   *
   * Only the periods that carry a timeline are selectable; the eras are the
   * groups they sit in. That matches the source, where an era page is an essay
   * and its periods carry the dated lines.
   */
  private buildPeriodOptions(): void {
    const byEra = new Map<string, HistoryPeriod[]>();
    for (const period of this.history.dated) {
      const era = eraOf(this.history, period);
      const at = byEra.get(era.id);
      if (at) at.push(period);
      else byEra.set(era.id, [period]);
    }
    for (const [eraId, periods] of byEra) {
      const era = this.history.periods.find((p) => p.id === eraId);
      const group = document.createElement('optgroup');
      group.label = era?.name ?? eraId;
      for (const period of periods) {
        const option = document.createElement('option');
        option.value = period.id;
        option.textContent = period.title;
        group.appendChild(option);
      }
      this.periodSelect.appendChild(group);
    }
  }

  private switchRow(
    label: string,
    onText: string,
    offText: string,
    initial: boolean,
    title: string,
    onToggle: (on: boolean) => void,
  ): HTMLElement {
    const row = el('div', 'row');
    const caption = el('span', 'label', label);
    caption.title = title;
    row.appendChild(caption);
    const toggle = el('button', `toggle${initial ? ' active' : ''}`, initial ? onText : offText);
    toggle.addEventListener('click', () => {
      const on = toggle.classList.toggle('active');
      toggle.textContent = on ? onText : offText;
      onToggle(on);
    });
    row.appendChild(toggle);
    return row;
  }

  private setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.modeToggle.classList.toggle('active', enabled);
    this.modeToggle.textContent = enabled ? 'on' : 'off';
    this.body.hidden = !enabled;
    // A reader who folds the timeline, switches history off, then switches it
    // back on has not asked for it unfolded — the fold is left exactly as they
    // left it, and only the panel body follows the switch.
    this.emit();
    this.render();
  }

  private setYear(year: number, options: { keepSelection?: boolean } = {}): void {
    this.year = year;
    this.yearInput.value = String(year);
    if (!options.keepSelection) {
      const period = periodAt(this.history, year);
      if (period && this.periodSelect.value !== period.id) this.periodSelect.value = period.id;
    }
    this.emit();
    this.render();
  }

  /**
   * Show or hide the whole panel.
   *
   * Deliberately not the same as switching history mode off, and it does not
   * touch it: a reader who set the map to 4450 A.T. and then closed the panel
   * asked for the panel to go away, not for the map to jump back to the
   * present. Closing it is a change to the furniture and nothing else.
   */
  set visible(value: boolean) {
    this.shown = value;
    this.panel.hidden = !value;
    if (value) this.render();
  }

  get visible(): boolean {
    return this.shown;
  }

  /** The period the panel is showing, which the year keeps in step with. */
  get period(): HistoryPeriod | null {
    return this.history.dated.find((p) => p.id === this.periodSelect.value) ?? null;
  }

  get state(): EpochState | null {
    if (!this.enabled) return null;
    return {
      year: this.year,
      basis: this.basis,
      showUndated: this.showUndated,
      emphasise: this.emphasise,
      period: this.period,
    };
  }

  /** Re-render the distances after the unit toggle changes. */
  setUnit(unit: DistanceUnit): void {
    this.unit = unit;
    this.render();
  }

  private emit(): void {
    this.callbacks.onEpoch(this.state);
  }

  private render(): void {
    if (!this.enabled) return;
    // The readout and the scrubber stay; the rest is not in the document.
    const period = this.periodLine();
    if (this.collapsed) return;
    this.renderDetails(period);
  }

  private periodLine(): HistoryPeriod | null {
    const period = this.period;
    this.readout.textContent = period
      ? `${formatYear(this.year)} · ${period.name}`
      : formatYear(this.year);
    return period;
  }

  private renderDetails(period: HistoryPeriod | null): void {
    this.stats.replaceChildren();
    const epoch = this.epochOf();
    const present = epoch.presentAt(this.year);
    const dated = epoch.dated;
    const reach = epoch.frontierPc(this.year);
    this.stats.appendChild(
      el(
        'div',
        'note-line',
        `${present.toLocaleString('en-US')} of ${dated.toLocaleString('en-US')} dated systems ` +
          `are on the map in ${formatYear(this.year)}, 95% of them within ` +
          `${formatDistance(pc(reach), this.unit)} of Sol.`,
      ),
    );
    const undated = epoch.total - dated;
    if (undated > 0) {
      this.stats.appendChild(
        el(
          'div',
          'note-line note-warn',
          `${undated.toLocaleString('en-US')} more systems carry no date in any source and are ` +
            `${this.showUndated ? 'drawn faintly' : 'hidden'} — not placed in time by guesswork.`,
        ),
      );
    }

    this.renderPolities(period);
    this.renderPlaces(period);
    this.renderEvents(period);
  }

  /**
   * The polities this period's own history names.
   *
   * What replaced a per-year list of holdings, which could not be made true.
   * This map records one affiliation per place and no date for it — read off a
   * political map of 8000 A.T. and off articles about the setting's present —
   * so counting today's holders among the places that existed in 515 A.T. put
   * the Sophic League on the map a millennium and a half before the timeline
   * first mentions it. A mention is a smaller claim and an honest one: the
   * Encyclopaedia wrote the name down while telling that century's story.
   *
   * It also shows the gap rather than hiding it. Polities that rose and fell
   * inside the setting's history are not in this map's data at all — the
   * timeline dates the Conver Ambi from 1984 to 3943 and the map cannot colour
   * a single system for it — so the centuries before 1200 A.T. name nobody and
   * the note says why.
   */
  private renderPolities(period: HistoryPeriod | null): void {
    this.polities.replaceChildren();
    if (!period) return;

    if (!period.polities.length) {
      this.polities.appendChild(
        el(
          'div',
          'note-line',
          `The history of ${period.name} names no polity this map holds.`,
        ),
      );
    }
    for (const polity of period.polities.slice(0, LISTED_POLITIES)) {
      const row = el('button', 'legend-row');
      const swatch = el('span', 'swatch');
      swatch.style.background = polity.color;
      row.appendChild(swatch);
      row.appendChild(el('span', 'legend-name', polity.name));
      row.appendChild(el('span', 'legend-count', `×${polity.mentions}`));
      row.title = `Named ${polity.mentions} time(s) in ${period.name} — show what it holds`;
      row.addEventListener('click', () => this.callbacks.onFocusPolity(polity.id));
      this.polities.appendChild(row);
    }

    this.polities.appendChild(
      el(
        'div',
        'note-line note-warn',
        'Named by this period, not holding in it. Affiliations on this map carry no ' +
          'date, and polities that ended before the present — the Conver Ambi, 1984 to ' +
          '3943 — are not in its data at all, so the map colours no system by the year.',
      ),
    );
  }

  private renderPlaces(period: HistoryPeriod | null): void {
    this.places.replaceChildren();
    if (!period) return;
    if (!period.places.length) {
      this.places.appendChild(
        el('div', 'note-line', 'This period’s timeline names no place the map holds.'),
      );
      return;
    }
    for (const place of period.places.slice(0, LISTED_PLACES)) {
      const row = el('button', 'legend-row');
      row.appendChild(el('span', 'legend-name', place.name));
      row.appendChild(el('span', 'legend-count', `×${place.mentions ?? 1}`));
      row.title = place.located
        ? `Named ${place.mentions ?? 1} time(s) in ${period.name}`
        : `Named in ${period.name}; the map has no position for it`;
      if (!place.located) row.classList.add('legend-row-weak');
      row.addEventListener('click', () => this.callbacks.onFocusPlace(place));
      this.places.appendChild(row);
    }
    if (period.places.length > LISTED_PLACES) {
      this.places.appendChild(
        el(
          'div',
          'note-line',
          `${period.places.length - LISTED_PLACES} more named less often.`,
        ),
      );
    }
  }

  private renderEvents(period: HistoryPeriod | null): void {
    this.events.replaceChildren();
    if (!period) return;
    for (const event of period.events) {
      const row = el('div', 'history-event');
      // Past events are the history of the year shown; later ones are its
      // future. Both belong in a period's timeline — the reader is reading a
      // century, not only its first day — but they should not look alike.
      if (event.year_at > this.year) row.classList.add('history-event-ahead');
      row.appendChild(
        el(
          'span',
          'history-event-year',
          formatEventYear(event.year_at, event.until_at, event.precision),
        ),
      );
      const text = el('span', 'history-event-text', event.text);
      row.appendChild(text);
      for (const place of event.places) {
        const link = el('button', 'history-place', place.name);
        link.title = place.located
          ? `Show ${place.name} on the map`
          : `${place.name} — no position on the map`;
        if (!place.located) link.disabled = true;
        link.addEventListener('click', () => this.callbacks.onFocusPlace(place));
        row.appendChild(link);
      }
      this.events.appendChild(row);
    }
  }
}
