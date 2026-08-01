/**
 * The detail panel for a selected object.
 *
 * Its job is provenance as much as identification. The pipeline already records
 * which catalog every figure came from, how uncertain it is, and — for HII
 * regions — which of two incompatible methods produced the distance. Showing the
 * name and hiding the rest would let the map imply a precision it does not have,
 * so the uncertainty band and the source citation are part of the panel, not an
 * optional extra.
 */

import type {
  ClusterData,
  FictionData,
  HiiData,
  InnerSphereData,
  OAStarData,
  StarData,
} from '../data/manifest';
import {
  KIND_CLUSTER,
  KIND_HII,
  KIND_OASTAR,
  KIND_STAR,
  type ObjectIndex,
  bayerLabel,
} from '../scene/objects';
import { type DistanceUnit, type Parsecs, formatDistance, pc } from '../units';

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
  oaStars: OAStarData | null;
  innerSphere: InnerSphereData | null;
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

export class DetailPanel {
  private readonly panel: HTMLElement;
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
    close.addEventListener('click', () => this.clear());
    head.appendChild(close);
    this.panel.appendChild(head);

    this.panel.appendChild(el('div', 'note-line', detail.subtitle));

    for (const row of detail.rows) {
      const line = el('div', 'row');
      line.appendChild(el('span', 'label', row.label));
      line.appendChild(el('span', row.warn ? 'value value-warn' : 'value', row.value));
      this.panel.appendChild(line);
    }

    const fiction = this.sources.fiction;
    const beyond = fiction ? detail.distancePc > fiction.frontierPc : false;

    if (detail.polities.length > 0 || beyond) {
      const note = el('div', 'note');
      note.appendChild(el('div', 'note-line', "Orion's Arm"));
      if (detail.polities.length > 0) {
        note.appendChild(el('div', 'note-line note-polity', detail.polities.join(', ')));
        if (detail.associationSource) {
          note.appendChild(el('div', 'note-line', `after ${detail.associationSource}`));
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
      this.panel.appendChild(note);
    }

    const actions = el('div', 'note');
    const fly = el('button', 'jump', 'Fly here');
    fly.addEventListener('click', () => {
      const { x, y, z, standoff } = detail.focus;
      this.onFocus(x, y, z, standoff);
    });
    actions.appendChild(fly);
    actions.appendChild(el('div', 'note-line', detail.citation));
    this.panel.appendChild(actions);
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
    return null;
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
      { label: 'Position', value: 'asserted by the setting', warn: true },
      { label: 'Absolute magnitude', value: absMag.toFixed(2) },
    ];
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

    if (entry.note) rows.push({ label: 'Note', value: entry.note });

    return {
      title: entry.label || entry.name,
      subtitle: "Orion's Arm system",
      rows,
      polities: affiliation
        ? [entry.uncertain ? `${affiliation.name} (uncertain)` : affiliation.name]
        : [],
      associationSource: entry.article || null,
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
    const designations = [
      names.bayer ? bayerLabel(names.bayer, constellation) : '',
      names.flam ? `${names.flam} ${constellation}`.trim() : '',
      names.gl,
      names.bf,
    ].filter(Boolean);
    const title = names.proper || designations[0] || `Star #${index}`;

    const hip = stars.ids[index * 2];
    const hd = stars.ids[index * 2 + 1];
    const absentId = stars.dataset.layout.ids.absent_sentinel;
    const catalogIds = [
      hip !== absentId ? `HIP ${hip}` : null,
      hd !== absentId ? `HD ${hd}` : null,
    ].filter(Boolean);

    const colony = this.sources.innerSphere?.byStar.get(index);

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

    if (colony?.distance_disagrees) {
      rows.push({
        label: "Orion's Arm distance",
        value: `${colony.distance_ly.toFixed(1)} ly stated`,
        warn: true,
      });
    }

    return {
      title: colony?.colony || title,
      subtitle: colony?.colony
        ? [`Orion's Arm system`, title, ...designations].filter(Boolean).join(' · ')
        : designations.length
          ? designations.join(' · ')
          : 'star',
      rows,
      polities: this.politiesFor('star', index),
      associationSource: this.sourceLineFor('star', index),
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
