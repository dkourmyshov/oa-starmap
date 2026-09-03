/**
 * On-screen readout and controls.
 *
 * Every distance shown here goes through `formatDistance`, so nothing reaches the
 * screen without its unit attached. The unit toggle defaults to light years,
 * matching Orion's Arm usage, but the underlying values are always parsecs.
 */

import type { HistoryDataset } from '../data/history';
import type {
  AssociationsDataset,
  ClustersDataset,
  FictionData,
  HiiDataset,
  OAStarsDataset,
  StarsDataset,
  Poster,
} from '../data/manifest';
import { DEFAULT_OPACITY as DEFAULT_CLUSTER_OPACITY } from '../layers/clusterField';
import { DEFAULT_OPACITY as DEFAULT_HII_OPACITY } from '../layers/hiiField';
import { DEFAULT_OPACITY as DEFAULT_ASSOCIATION_OPACITY } from '../layers/associationField';
import { DEFAULT_OPACITY as DEFAULT_GRID_OPACITY } from '../layers/planeGrid';
import { DEFAULT_OPACITY as DEFAULT_DROP_LINES_OPACITY } from '../layers/dropLines';
import { DEFAULT_MAX_LABELS } from './labels';
import { type Foldable, makeFoldable } from './foldable';
import { makeDraggable } from './drag';
import type { NameMode } from '../scene/objects';
import {
  type ControlMode,
  CONTROL_MODES,
  type Projection,
  PROJECTIONS,
  type Viewpoint,
  VIEWPOINTS,
} from '../scene/viewer';
import { type DistanceUnit, DEFAULT_UNIT, type Parsecs, formatDistance, pc } from '../units';
import { registrationNote } from '../layers/posterLayer';

/** Enough to read the sheet, little enough that the live map stays on top. */
export const DEFAULT_POSTER_OPACITY = 0.85;

/**
 * What the map opens as. Held here rather than in main so the switch and the
 * thing it switches cannot start out disagreeing.
 */
export const DEFAULT_ONLY_OA: boolean = true;
export const DEFAULT_ASSOCIATIONS_VISIBLE: boolean = false;
export const DEFAULT_HISTORY_PANEL_VISIBLE: boolean = false;
export const DEFAULT_GRID_VISIBLE: boolean = true;

/**
 * What the zoom slider spans, in parsecs of standoff.
 *
 * The same bounds the wheel is held to in scene/viewer.ts. Stated again here
 * rather than imported because they are the *slider's* ends and want to be
 * readable next to it, and a test pins them to the viewer's so the two cannot
 * drift into disagreeing about how far out the map goes.
 */
export const ZOOM_MIN_PC = 1e-3;
export const ZOOM_MAX_PC = 1e5;

/** Where the map opens. Matches DEFAULT_RANGE in scene/viewer.ts. */
export const DEFAULT_RANGE_PC = 65;
export const DEFAULT_GRID_MESH_VISIBLE: boolean = false;
export const DEFAULT_DROP_LINES_VISIBLE: boolean = false;

export interface HudCallbacks {
  onMagnitudeLimit(value: number): void;
  onExposure(value: number): void;
  onClustersVisible(value: boolean): void;
  onClusterOpacity(value: number): void;
  onHiiVisible(value: boolean): void;
  onHiiOpacity(value: number): void;
  onHiiKinematic(enabled: boolean): void;
  onAssociationsVisible(value: boolean): void;
  onAssociationOpacity(value: number): void;
  /** Show or hide the history panel itself, not the year it is set to. */
  onHistoryPanel(visible: boolean): void;
  /** Frame this much map: the standoff in parsecs. See Viewer.range. */
  onZoom(rangePc: number): void;
  onGridVisible(value: boolean): void;
  onGridOpacity(value: number): void;
  onGridMeshVisible(value: boolean): void;
  onDropLinesVisible(value: boolean): void;
  onDropLinesOpacity(value: number): void;
  onOAStarsVisible(value: boolean): void;
  onOnlyOA(enabled: boolean): void;
  onDepthOfField(strength: number): void;
  onDepthOfFieldDim(amount: number): void;
  onLabelsVisible(value: boolean): void;
  onLabelDensity(value: number): void;
  onNameMode(mode: NameMode): void;
  onPolityMode(enabled: boolean): void;
  onFocusPolity(polityId: string): void;
  onJump(target: JumpTarget): void;
  onViewpoint(name: Viewpoint): void;
  onControlMode(mode: ControlMode): void;
  onUnitChange(unit: DistanceUnit): void;
  onProjection(projection: Projection): void;
  onPoster(index: number): void;
  onPosterOpacity(value: number): void;
}

export interface JumpTarget {
  label: string;
  /** Star proper name to look up. */
  starName?: string;
  /** Cluster primary name to look up. */
  clusterName?: string;
  /** HII region Sharpless designation to look up. */
  hiiName?: string;
  /** Otherwise, pull back this far from Sol along the current view direction. */
  distancePc?: number;
}

/**
 * Preset viewpoints. The far ones exist to make the no-edge requirement easy to
 * check by eye: pull back to 7000 ly and beyond and look for a sphere surface.
 */
export const JUMP_TARGETS: JumpTarget[] = [
  { label: 'Sol', starName: 'Sol' },
  { label: 'Vega', starName: 'Vega' },
  { label: 'Wezen', starName: 'Wezen' },
  { label: 'Deneb', starName: 'Deneb' },
  { label: 'Hyades', clusterName: 'Melotte_25' },
  { label: 'Pleiades', clusterName: 'Melotte_22' },
  { label: 'Praesepe', clusterName: 'NGC_2632' },
  { label: 'Double Cluster', clusterName: 'NGC_869' },
  // The zeta Ophiuchi HII region: the nearest Sharpless region on the map, and
  // the one whose kinematic distance is most spectacularly wrong.
  { label: 'S27 (ζ Oph)', hiiName: 'S27' },
  { label: '1 000 ly out', distancePc: 1000 / 3.261563777 },
  { label: '7 000 ly out', distancePc: 7000 / 3.261563777 },
];

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

export class Hud {
  private unit: DistanceUnit = DEFAULT_UNIT;

  /** The viewpoint and drag controls, greyed out while the plan view is up. */
  private orientationControls: HTMLElement[] = [];

  /** Every panel's fold control, so they can be closed together. */
  private readonly folds: Foldable[] = [];

  private zoomInput: HTMLInputElement | null = null;
  private zoomReadout: HTMLElement | null = null;
  /** True while the reader has hold of the zoom slider; see setZoom. */
  private zoomDragging = false;

  /** Greyed out while the grid is off, being about a thing that is not drawn. */
  private gridControls: HTMLElement[] = [];

  /** The same, for the threads to the plane, which start hidden. */
  private guidelineControls: HTMLElement[] = [];

  /** The polity legend, so the row whose holdings are ringed can be marked. */
  private polityList: HTMLElement | null = null;

  /** Caption of the magnitude slider, which the plan view renames. */
  private magnitudeLabel: HTMLElement | null = null;

  /** The unit everything user-facing is currently shown in. */
  get currentUnit(): DistanceUnit {
    return this.unit;
  }

  private readonly distanceValue: HTMLElement;
  private readonly fpsValue: HTMLElement;
  private readonly unitButtons: HTMLButtonElement[] = [];

  private frameCount = 0;
  private frameTime = 0;

  constructor(
    root: HTMLElement,
    dataset: StarsDataset,
    clusters: ClustersDataset | null,
    hii: HiiDataset | null,
    associations: AssociationsDataset | null,
    history: HistoryDataset | null,
    oaStars: OAStarsDataset | null,
    fiction: FictionData | null,
    private readonly callbacks: HudCallbacks,
    posters: Poster[] = [],
  ) {
    const panel = el('div', 'panel panel-stats');

    const title = el('div', 'title', 'OA Starmap');
    panel.appendChild(title);

    const starLine = el('div', 'row');
    starLine.appendChild(el('span', 'label', 'Stars'));
    starLine.appendChild(el('span', 'value', dataset.count.toLocaleString('en-US')));
    panel.appendChild(starLine);

    if (clusters) {
      panel.appendChild(
        this.countRow('Clusters', clusters.count, (on) => this.callbacks.onClustersVisible(on)),
      );
    }

    if (hii) {
      panel.appendChild(
        this.countRow('H II regions', hii.count, (on) => this.callbacks.onHiiVisible(on), true,
          'Clouds of interstellar hydrogen ionised by nearby hot young stars — ' +
            'star-forming regions, and the brightest things in the plane'),
      );
    }

    if (associations) {
      panel.appendChild(
        this.countRow(
          'OB associations',
          associations.count,
          (on) => this.callbacks.onAssociationsVisible(on),
          // Off to begin with. Fifty-six ellipsoids a hundred parsecs across,
          // overlapping each other and everything inside them, is a great deal
          // of ink over the part of the map most worth reading. They are a
          // reference frame to switch on when wanted, not scenery.
          DEFAULT_ASSOCIATIONS_VISIBLE,
        ),
      );
    }

    if (oaStars) {
      panel.appendChild(
        this.countRow("OA stars", oaStars.count, (on) => this.callbacks.onOAStarsVisible(on)),
      );
    }

    const distanceRow = el('div', 'row');
    distanceRow.appendChild(el('span', 'label', 'Camera from Sol'));
    this.distanceValue = el('span', 'value', '—');
    distanceRow.appendChild(this.distanceValue);
    panel.appendChild(distanceRow);

    const fpsRow = el('div', 'row');
    fpsRow.appendChild(el('span', 'label', 'FPS'));
    this.fpsValue = el('span', 'value', '—');
    fpsRow.appendChild(this.fpsValue);
    panel.appendChild(fpsRow);

    // Units
    const unitRow = el('div', 'row');
    unitRow.appendChild(el('span', 'label', 'Units'));
    const unitGroup = el('span', 'group');
    for (const unit of ['ly', 'pc'] as DistanceUnit[]) {
      const button = el('button', 'toggle', unit);
      button.addEventListener('click', () => this.setUnit(unit));
      if (unit === this.unit) button.classList.add('active');
      this.unitButtons.push(button);
      unitGroup.appendChild(button);
    }
    unitRow.appendChild(unitGroup);
    panel.appendChild(unitRow);

    // Zoom, as a control rather than only a gesture. Asked for directly, and
    // it is also the accessible way in: a trackpad pinch is not available to
    // everyone, and on a mouse without a wheel there was no way to zoom at all.
    //
    // Logarithmic, because the map spans five orders of magnitude and a linear
    // slider would spend nine tenths of its travel outside the galaxy. Left is
    // close in, right is far out — reading as a range rather than a zoom
    // factor, so the number beside it is a distance the reader can check
    // against the rings on the plane grid.
    const zoomRow = this.slider(
      'Zoom',
      Math.log10(ZOOM_MIN_PC),
      Math.log10(ZOOM_MAX_PC),
      Math.log10(DEFAULT_RANGE_PC),
      0.01,
      (v) => {
        const range = 10 ** v;
        this.callbacks.onZoom(range);
        return formatDistance(pc(range), this.unit);
      },
    );
    this.zoomInput = zoomRow.querySelector('.slider') as HTMLInputElement;
    this.zoomReadout = zoomRow.querySelector('.value') as HTMLElement;
    // Held so the wheel can move the slider without the slider answering back.
    this.zoomInput.addEventListener('pointerdown', () => (this.zoomDragging = true));
    for (const event of ['pointerup', 'pointercancel', 'blur'] as const) {
      this.zoomInput.addEventListener(event, () => (this.zoomDragging = false));
    }
    panel.appendChild(zoomRow);

    const magnitudeRow = this.slider('Magnitude limit', 3, 16, 7.5, 0.1, (v) => {
      this.callbacks.onMagnitudeLimit(v);
      return v.toFixed(1);
    });
    // Held because the same slider means two different things. In perspective
    // it is a limit on apparent magnitude, which depends on where the camera
    // is; on the plan view there is no camera to be apparent from, so it limits
    // absolute magnitude and the caption has to say so.
    this.magnitudeLabel = magnitudeRow.querySelector('.label') as HTMLElement;
    panel.appendChild(magnitudeRow);

    panel.appendChild(this.slider('Exposure', 0.1, 4, 1, 0.05, (v) => {
      this.callbacks.onExposure(v);
      return `${v.toFixed(2)}x`;
    }));

    // Reduces the sky to what the setting has claimed: settled systems, OA
    // stars, and the clusters and regions carrying an association.
    //
    // On to begin with, because this is a map of Orion's Arm before it is a map
    // of the sky. The whole HYG catalogue underneath it is 120,000 stars the
    // setting says nothing about, and a reader opening the map is looking for
    // the few hundred it does.
    const onlyRow = el('div', 'row');
    onlyRow.appendChild(el('span', 'label', "Orion's Arm only"));
    const onlyToggle = el(
      'button',
      `toggle${DEFAULT_ONLY_OA ? ' active' : ''}`,
      DEFAULT_ONLY_OA ? 'on' : 'off',
    );
    onlyToggle.addEventListener('click', () => {
      const on = onlyToggle.classList.toggle('active');
      onlyToggle.textContent = on ? 'on' : 'off';
      this.callbacks.onOnlyOA(on);
    });
    onlyRow.appendChild(onlyToggle);
    panel.appendChild(onlyRow);

    // Depth of field. Not how a telescope behaves — every star is at infinity
    // and all of them are equally in focus — but the flat sky is exactly the
    // problem: a projection of four decades of depth onto a screen gives the eye
    // no way to tell a near star from a far one. Blurring by distance from
    // whatever the camera is looking at restores the one depth cue the medium
    // can carry. Off by default, because it is an aid and not the data.
    panel.appendChild(
      this.slider('Depth of field', 0, 12, 0, 0.5, (v) => {
        this.callbacks.onDepthOfField(v);
        return v === 0 ? 'off' : `${v.toFixed(1)} px/decade`;
      }),
    );

    // How much the out-of-focus half dims as well as blurs. Separate from the
    // blur because they do different jobs: blur says how far away a thing is,
    // dimming decides how much of the far field is there at all. Wound up, it
    // thins a dense view down to the shell in focus, which is the only way to
    // see into the Inner Sphere.
    panel.appendChild(
      this.slider('Out-of-focus dimming', 0, 1, 0, 0.05, (v) => {
        this.callbacks.onDepthOfFieldDim(v);
        if (v === 0) return 'none';
        // What the number means in the only terms that matter at the eyepiece:
        // how far from the focus something can be before it is gone.
        const decades = Math.sqrt(Math.log(20) / (v * 12));
        return `${v.toFixed(2)}  (${(10 ** decades).toFixed(1)}x)`;
      }),
    );

    if (history) {
      // Not a layer, so it sits with the switches rather than the counts: the
      // history panel is a second window onto the same map and takes up a good
      // deal of the screen, so it is opened rather than dismissed.
      const historyRow = el('div', 'row');
      const caption = el('span', 'label', 'History panel');
      caption.title =
        `The Encyclopaedia's timeline, and the map set to a year — ` +
        `${history.stats.events.toLocaleString('en-US')} dated events across ` +
        `${history.count} eras and periods`;
      historyRow.appendChild(caption);
      // Labelled with the state it is in, not the action it performs, because
      // every other switch on this panel is: "show" over a hidden panel would
      // read as an instruction beside seven captions that read as facts.
      const historyToggle = el(
        'button',
        `toggle${DEFAULT_HISTORY_PANEL_VISIBLE ? ' active' : ''}`,
        DEFAULT_HISTORY_PANEL_VISIBLE ? 'show' : 'hide',
      );
      historyToggle.addEventListener('click', () => {
        const on = historyToggle.classList.toggle('active');
        historyToggle.textContent = on ? 'show' : 'hide';
        this.callbacks.onHistoryPanel(on);
      });
      historyRow.appendChild(historyToggle);
      panel.appendChild(historyRow);
    }

    // The graticule. On to begin with, because a navigation aid nobody can
    // find is not one: the whole job of this layer is to answer "which way am
    // I looking and how far across is this", and a reader who does not know to
    // ask for it is exactly the reader who needs it.
    panel.appendChild(
      this.countRow('Plane grid', null, (on) => {
        this.callbacks.onGridVisible(on);
        for (const control of this.gridControls) control.classList.toggle('disabled', !on);
      }, DEFAULT_GRID_VISIBLE),
    );
    const gridOpacity = this.slider(
      'Grid opacity',
      0,
      1,
      DEFAULT_GRID_OPACITY,
      0.02,
      (v) => {
        this.callbacks.onGridOpacity(v);
        return v === 0 ? 'off' : `${Math.round(v * 100)}%`;
      },
    );
    // The square mesh, apart from the rings. The two are the same scale drawn
    // two ways and answer different questions — distance from Sol, and distance
    // from anywhere to anywhere — so wanting one is no reason to get both.
    panel.appendChild(
      this.countRow(
        'Square grid',
        null,
        (on) => this.callbacks.onGridMeshVisible(on),
        DEFAULT_GRID_MESH_VISIBLE,
        'A square mesh at the same spacing as the rings, for reading a distance ' +
          'between two places when neither of them is Sol',
      ),
    );

    // Threads to the plane. The oldest cure for the oldest problem with a 3D
    // scatter: on screen a dot has two coordinates and the third is a guess.
    panel.appendChild(
      this.countRow(
        'Plane guidelines',
        null,
        (on) => {
          this.callbacks.onDropLinesVisible(on);
          for (const control of this.guidelineControls) control.classList.toggle('disabled', !on);
        },
        DEFAULT_DROP_LINES_VISIBLE,
        'A thread from each system Orion’s Arm names down to the galactic ' +
          'plane: the foot says where it lies, the length says how far off the plane',
      ),
    );

    // How loud the threads are. There is no right answer to set once and be
    // done with: a hundred threads over the Inner Sphere at the weight that
    // makes one readable is a curtain, and the weight that keeps the curtain
    // thin loses the single thread the reader was following. It depends on how
    // many are on screen, which is to say on where the reader is looking, so it
    // is theirs to set.
    const guidelineOpacity = this.slider(
      'Guideline opacity',
      0,
      1,
      DEFAULT_DROP_LINES_OPACITY,
      0.02,
      (v) => {
        this.callbacks.onDropLinesOpacity(v);
        return v === 0 ? 'off' : `${Math.round(v * 100)}%`;
      },
    );

    this.gridControls = [gridOpacity];
    this.guidelineControls = [guidelineOpacity];
    guidelineOpacity.classList.toggle('disabled', !DEFAULT_DROP_LINES_VISIBLE);
    panel.appendChild(gridOpacity);
    panel.appendChild(guidelineOpacity);

    panel.appendChild(this.countRow('Labels', null, (on) => this.callbacks.onLabelsVisible(on)));
    panel.appendChild(
      this.slider('Label density', 0, 160, DEFAULT_MAX_LABELS, 5, (v) => {
        this.callbacks.onLabelDensity(v);
        return v === 0 ? 'off' : `${v}`;
      }),
    );

    // Which of an object's two names to show. Lambda Aurigae is New Gaia and
    // Blanco 1 is the Blenke Cluster; neither name is the true one, and which
    // is wanted depends on whether the reader is checking the map against the
    // sky or reading the setting.
    const nameRow = el('div', 'row');
    nameRow.appendChild(el('span', 'label', 'Names'));
    const nameGroup = el('div', 'toggle-group');
    const modes: { id: NameMode; label: string; title: string }[] = [
      { id: 'oa', label: "OA", title: "Orion's Arm names, falling back to the catalogue" },
      { id: 'real', label: 'real', title: 'Catalogue names, falling back to the setting' },
      { id: 'both', label: 'both', title: "Orion's Arm name with the catalogue name after it" },
    ];
    for (const mode of modes) {
      const button = el('button', 'toggle', mode.label);
      button.title = mode.title;
      if (mode.id === 'oa') button.classList.add('active');
      button.addEventListener('click', () => {
        for (const other of nameGroup.children) other.classList.remove('active');
        button.classList.add('active');
        this.callbacks.onNameMode(mode.id);
      });
      nameGroup.appendChild(button);
    }
    nameRow.appendChild(nameGroup);
    panel.appendChild(nameRow);

    if (clusters) {
      panel.appendChild(
        this.slider('Cluster opacity', 0, 1, DEFAULT_CLUSTER_OPACITY, 0.02, (v) => {
          this.callbacks.onClusterOpacity(v);
          return v === 0 ? 'off' : `${Math.round(v * 100)}%`;
        }),
      );
    }

    if (hii) {
      panel.appendChild(
        this.slider('H II region opacity', 0, 1, DEFAULT_HII_OPACITY, 0.02, (v) => {
          this.callbacks.onHiiOpacity(v);
          return v === 0 ? 'off' : `${Math.round(v * 100)}%`;
        }),
      );

      // Kinematic distances are the weak half of this catalogue, so let them be
      // switched off rather than only warned about. The counts come straight from
      // the build, so the button states how much of the layer it would remove.
      const kinematic = hii.stats.methods.kinematic ?? 0;
      const stellar = hii.stats.methods.stellar ?? 0;
      const row = el('div', 'row');
      row.appendChild(el('span', 'label', 'Kinematic distances'));
      const group = el('span', 'group');
      group.appendChild(el('span', 'value', `${kinematic}`));
      const toggle = el('button', 'toggle active', 'show');
      toggle.addEventListener('click', () => {
        const on = toggle.classList.toggle('active');
        toggle.textContent = on ? 'show' : 'hide';
        this.callbacks.onHiiKinematic(on);
      });
      group.appendChild(toggle);
      row.appendChild(group);
      panel.appendChild(row);
      // What the layer is, before what is wrong with it. "HII" is a hundred
      // years of astronomical shorthand — H for hydrogen, II for singly
      // ionised — and a reader who does not already know it is looking at a
      // toggle for something unnamed.
      panel.appendChild(
        el(
          'div',
          'note-line',
          'H II regions are clouds of interstellar hydrogen ionised by the hot ' +
            'young stars inside them: nurseries, and the brightest features of ' +
            'the plane. Orion’s Arm names sixteen of them.',
        ),
      );
      // What the layer *is*, before what is wrong with it. "HII" is a century
      // of astronomical shorthand — H for hydrogen, II for singly ionised — and
      // a reader who does not already know it is being offered a switch for
      // something the map never names.
      panel.appendChild(
        el(
          'div',
          'note-line',
          'An H II region is interstellar hydrogen ionised by the hot young ' +
            'stars within it: a star-forming cloud, and among the brightest ' +
            "things in the plane. Orion's Arm names sixteen of them.",
        ),
      );
      panel.appendChild(
        el(
          'div',
          'note-line note-warn',
          `${stellar} regions placed by stellar distance, ${kinematic} kinematic — ` +
            `the latter are unreliable toward the galactic centre and anticentre.`,
        ),
      );
    }

    if (associations) {
      panel.appendChild(
        this.slider(
          'OB association opacity',
          0,
          1,
          DEFAULT_ASSOCIATION_OPACITY,
          0.02,
          (v) => {
            this.callbacks.onAssociationOpacity(v);
            return v === 0 ? 'off' : `${Math.round(v * 100)}%`;
          },
        ),
      );
      panel.appendChild(
        el(
          'div',
          'note-line',
          `Drawn as a broken one-sigma ellipsoid, not a boundary: an OB ` +
            `association is unbound and has no edge, and much of it lies outside ` +
            `the outline. The census reaches 1 kpc, so Cyg OB2 and the rest of the ` +
            `arm are absent rather than nonexistent.`,
        ),
      );
    }

    // Provenance — the map mixes measured data with derived quantities, so say so.
    const note = el('div', 'note');
    note.appendChild(el('div', 'note-line', dataset.selection.rule));
    note.appendChild(el('div', 'note-line', dataset.source.citation));
    if (clusters) note.appendChild(el('div', 'note-line', clusters.source.citation));
    if (hii) note.appendChild(el('div', 'note-line', hii.source.citation));
    if (associations) {
      note.appendChild(el('div', 'note-line', associations.source.citation));
    }
    if (oaStars) {
      // The one layer whose positions are not measurements; say so where the
      // other provenance lines are, not somewhere it can be missed.
      note.appendChild(
        el(
          'div',
          'note-line note-warn',
          `${oaStars.count} OA stars are placed by the setting, not observed — ` +
            `drawn as open diamonds.`,
        ),
      );
    }
    note.appendChild(
      el(
        'div',
        'note-line note-warn',
        `Distances beyond ${Math.round(
          dataset.selection.reliability.unreliable_beyond_pc * 3.261563777,
        ).toLocaleString('en-US')} ly are indicative only.`,
      ),
    );
    panel.appendChild(note);

    root.appendChild(panel);
    this.dressPanel(panel, 'the controls');

    if (fiction) this.buildPolityPanel(root, fiction);

    // Where to look from, and where to look at. Two different questions, so two
    // rows: the viewpoints change the angle and keep the range, the jumps change
    // the target and keep the angle.
    const jumpPanel = el('div', 'panel panel-jump');
    // Not "view from": only `top` says where the camera is. `spin` and `core`
    // name what it is pointed at, which is the useful thing about them.
    jumpPanel.appendChild(el('div', 'title', 'Viewpoint'));

    // Perspective or plan, above the viewpoints because it decides whether the
    // viewpoints mean anything: the plan view has exactly one.
    const projectionRow = el('div', 'row');
    projectionRow.appendChild(el('span', 'label', 'Projection'));
    const projectionGroup = el('div', 'toggle-group');
    for (const projection of PROJECTIONS) {
      const button = el('button', 'toggle', projection.label);
      button.title = projection.title;
      if (projection.id === '3d') button.classList.add('active');
      button.addEventListener('click', () => {
        for (const other of projectionGroup.children) other.classList.remove('active');
        button.classList.add('active');
        this.setProjection(projection.id);
      });
      projectionGroup.appendChild(button);
    }
    projectionRow.appendChild(projectionGroup);
    jumpPanel.appendChild(projectionRow);

    const viewGrid = el('div', 'jump-grid jump-grid-wide');
    for (const viewpoint of VIEWPOINTS) {
      const button = el('button', 'jump', viewpoint.label);
      button.title = viewpoint.title;
      button.addEventListener('click', () => {
        for (const other of viewGrid.children) other.classList.remove('active');
        button.classList.add('active');
        this.callbacks.onViewpoint(viewpoint.id);
      });
      if (viewpoint.id === 'top') button.classList.add('active');
      viewGrid.appendChild(button);
    }
    jumpPanel.appendChild(viewGrid);

    const dragRow = el('div', 'row');
    dragRow.appendChild(el('span', 'label', 'Drag'));
    const dragGroup = el('div', 'toggle-group');
    for (const mode of CONTROL_MODES) {
      const button = el('button', 'toggle', mode.label);
      button.title = mode.title;
      if (mode.id === 'orbit') button.classList.add('active');
      button.addEventListener('click', () => {
        for (const other of dragGroup.children) other.classList.remove('active');
        button.classList.add('active');
        this.callbacks.onControlMode(mode.id);
      });
      dragGroup.appendChild(button);
    }
    dragRow.appendChild(dragGroup);
    jumpPanel.appendChild(dragRow);

    if (posters.length) this.buildPosterRow(jumpPanel, posters);

    // Held so the plan view can grey them out. Both answer questions it does
    // not have — which way to look from, and which axis to turn about — and a
    // control that silently does nothing is worse than one visibly switched off.
    this.orientationControls = [viewGrid, dragGroup];

    jumpPanel.appendChild(el('div', 'title', 'Jump to'));
    const jumpGrid = el('div', 'jump-grid');
    for (const target of JUMP_TARGETS) {
      const button = el('button', 'jump', target.label);
      button.addEventListener('click', () => this.callbacks.onJump(target));
      jumpGrid.appendChild(button);
    }
    jumpPanel.appendChild(jumpGrid);
    root.appendChild(jumpPanel);
    this.dressPanel(jumpPanel, 'the viewpoints');
  }

  /**
   * The polity legend.
   *
   * Also states how many landmarks are still unbound. That number is the honest
   * status of the fictional layer, and burying it would let the map imply more
   * coverage than it has.
   */
  private buildPolityPanel(root: HTMLElement, fiction: FictionData): void {
    const panel = el('div', 'panel panel-polity');

    const head = el('div', 'row');
    head.appendChild(el('span', 'title', "Orion's Arm"));
    const modeToggle = el('button', 'toggle active', 'polity');
    modeToggle.addEventListener('click', () => {
      const on = modeToggle.classList.toggle('active');
      modeToggle.textContent = on ? 'polity' : 'type';
      this.callbacks.onPolityMode(on);
    });
    head.appendChild(modeToggle);
    panel.appendChild(head);

    const list = el('div', 'legend');
    for (const polity of fiction.polities) {
      // Every polity that holds anything at all. Filtering on resolved_count
      // hid seventeen of them, because that counts only landmarks read off the
      // political maps — most polities are here through colonies, add-on
      // systems and worlds instead, and the Caretaker Gods held eighteen
      // objects without appearing at all.
      if (polity.member_count === 0) continue;
      const row = el('button', 'legend-row');
      const swatch = el('span', 'swatch');
      swatch.style.background = polity.color;
      row.appendChild(swatch);
      row.appendChild(el('span', 'legend-name', polity.name));
      // Landmarks are shown as a fraction because the denominator is knowable:
      // the political maps name a fixed list. Everything else has no total to
      // count against, so the member tally stands alone.
      const count = polity.landmark_count
        ? `${polity.resolved_count}/${polity.landmark_count}`
        : String(polity.member_count);
      row.appendChild(el('span', 'legend-count', count));
      // The row shows which polity is currently ringed on the map, because the
      // second click that takes the rings off has to be predictable: a switch
      // that looks the same on and off is a switch nobody trusts. Clearing the
      // others first — one polity is picked out at a time, and two rows both
      // looking picked would be a lie about what is on screen.
      row.addEventListener('click', () => {
        const wasOn = row.classList.contains('legend-active');
        this.clearPolityFocus();
        row.classList.toggle('legend-active', !wasOn);
        this.callbacks.onFocusPolity(polity.id);
      });
      list.appendChild(row);
    }
    this.polityList = list;
    panel.appendChild(list);

    const pending = fiction.pending.length;
    if (pending > 0 || fiction.frontierFlagged > 0) {
      const note = el('div', 'note');
      if (fiction.frontierFlagged > 0) {
        note.appendChild(
          el(
            'div',
            'note-line note-warn',
            `${fiction.frontierFlagged} landmarks lie past the ` +
              `${fiction.frontierLy.toLocaleString('en-US')} ly Terragen frontier and are ` +
              `left uncoloured — the source places them in a polity's direction, not its ` +
              `volume.`,
          ),
        );
      }
      if (pending > 0) {
        note.appendChild(
          el(
            'div',
            'note-line note-warn',
            `${pending} landmarks not yet bound — planetary nebulae, legacy open ` +
              `clusters, SNRs and dark clouds are not loaded yet.`,
          ),
        );
      }
      panel.appendChild(note);
    }

    root.appendChild(panel);
    this.dressPanel(panel, "the Orion's Arm legend");
  }

  /**
   * Unmark every polity row.
   *
   * Called from outside when something else takes the rings off the map — the
   * epoch moving, above all. A legend still claiming a polity is picked out
   * when nothing on the map is ringed would be worse than no mark at all.
   */
  clearPolityFocus(): void {
    for (const row of this.polityList?.querySelectorAll('.legend-active') ?? []) {
      row.classList.remove('legend-active');
    }
  }

  /**
   * Give a panel a fold control and a grip, once it is built.
   *
   * Applied after the fact rather than woven through each panel's assembly:
   * every panel here was written without a thought for folding, and not one of
   * them needed changing. The next one gets both for a line.
   *
   * Dragging comes with folding because they answer the same complaint from
   * opposite ends — the panel is in the way. Folding is for when you want it
   * gone; dragging is for when you want it somewhere else. Having only one of
   * the two, on some panels, would be an odd thing to have to explain.
   */
  private dressPanel(panel: HTMLElement, title: string): void {
    this.folds.push(makeFoldable(panel, { title }));
    const header = panel.firstElementChild as HTMLElement | null;
    if (header) makeDraggable(panel, header);
  }

  /**
   * A "<label>  <count>  [show/hide]" row, one per toggleable layer.
   *
   * `initial` is the layer's starting state and must match what main.ts
   * actually built, not what looks tidy here: a switch reading "show" over a
   * layer that is not drawn is worse than no switch at all.
   */
  private countRow(
    label: string,
    count: number | null,
    onToggle: (visible: boolean) => void,
    initial = true,
    title?: string,
  ): HTMLElement {
    const row = el('div', 'row');
    const caption = el('span', 'label', label);
    if (title) caption.title = title;
    row.appendChild(caption);
    const right = el('span', 'group');
    if (count !== null) right.appendChild(el('span', 'value', count.toLocaleString('en-US')));
    const toggle = el('button', `toggle${initial ? ' active' : ''}`, initial ? 'show' : 'hide');
    toggle.addEventListener('click', () => {
      const on = toggle.classList.toggle('active');
      toggle.textContent = on ? 'show' : 'hide';
      onToggle(on);
    });
    right.appendChild(toggle);
    row.appendChild(right);
    return row;
  }

  private slider(
    label: string,
    min: number,
    max: number,
    initial: number,
    step: number,
    onInput: (value: number) => string,
  ): HTMLElement {
    const wrapper = el('div', 'slider-row');
    const head = el('div', 'row');
    head.appendChild(el('span', 'label', label));
    const readout = el('span', 'value', onInput(initial));
    head.appendChild(readout);
    wrapper.appendChild(head);

    const input = el('input', 'slider');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initial);
    input.addEventListener('input', () => {
      readout.textContent = onInput(Number(input.value));
    });
    wrapper.appendChild(input);
    return wrapper;
  }

  private setUnit(unit: DistanceUnit): void {
    this.unit = unit;
    for (const button of this.unitButtons) {
      button.classList.toggle('active', button.textContent === unit);
    }
    this.callbacks.onUnitChange(unit);
  }

  /**
   * Say which magnitude the limit slider is limiting.
   *
   * Called by main rather than from setProjection, so that the caption follows
   * what the star field is actually doing rather than being a second, separate
   * claim about it.
   */
  setMagnitudeMeaning(absolute: boolean): void {
    if (!this.magnitudeLabel) return;
    this.magnitudeLabel.textContent = absolute ? 'Absolute magnitude' : 'Magnitude limit';
    this.magnitudeLabel.title = absolute
      ? 'Plot stars brighter than this absolute magnitude — a luminosity cut, the same wherever the map is looked at'
      : 'Plot stars brighter than this apparent magnitude, seen from the camera';
  }

  /**
   * Someone else's map of the same sky, laid into the plane.
   *
   * A dropdown rather than toggles: the series is eight nested views of one
   * volume, so exactly one is meaningful at a time, and eight buttons would
   * suggest otherwise. The note underneath names the author and says how well
   * the sheet is placed, because a borrowed map is a source like any other and
   * a registration good to a fifth of a light year at 100 pc is good to
   * seventy at three kiloparsecs.
   */
  private buildPosterRow(panel: HTMLElement, posters: Poster[]): void {
    panel.appendChild(el('div', 'title', 'Sky map'));

    const row = el('div', 'row');
    row.appendChild(el('span', 'label', 'Overlay'));
    const select = el('select', 'select') as HTMLSelectElement;
    const none = document.createElement('option');
    none.value = '-1';
    none.textContent = 'none';
    select.appendChild(none);
    posters.forEach((poster, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = poster.name;
      option.title = `${poster.title ?? poster.series} — ${registrationNote(poster)}`;
      select.appendChild(option);
    });
    const note = el('div', 'note-line', '');
    select.addEventListener('change', () => {
      const index = Number(select.value);
      this.callbacks.onPoster(index);
      const poster = posters[index];
      note.textContent = poster
        ? `${poster.credit ?? ''}${poster.licence ? `, ${poster.licence}` : ''} · ` +
          registrationNote(poster)
        : '';
    });
    row.appendChild(select);
    panel.appendChild(row);
    panel.appendChild(
      this.slider('Overlay opacity', 0, 1, DEFAULT_POSTER_OPACITY, 0.02, (v) => {
        this.callbacks.onPosterOpacity(v);
        return v === 0 ? 'off' : `${Math.round(v * 100)}%`;
      }),
    );
    panel.appendChild(note);
  }

  private setProjection(projection: Projection): void {
    const flat = projection === '2d';
    for (const group of this.orientationControls) {
      for (const button of group.children) {
        (button as HTMLButtonElement).disabled = flat;
      }
      group.classList.toggle('disabled', flat);
    }
    this.callbacks.onProjection(projection);
  }

  /**
   * Move the zoom slider to where the map actually is.
   *
   * Called every frame, because the wheel, the viewpoint buttons and every
   * "fly to" all change the range without going through the slider, and a
   * control that shows a stale number is worse than no control.
   *
   * Not while it is being dragged, though: writing the value back under the
   * reader's finger is how a slider comes to fight the hand holding it.
   */
  setZoom(range: Parsecs): void {
    if (!this.zoomInput || this.zoomDragging) return;
    const value = Math.log10(
      Math.min(Math.max(range as number, ZOOM_MIN_PC), ZOOM_MAX_PC),
    );
    this.zoomInput.value = String(value);
    if (this.zoomReadout) this.zoomReadout.textContent = formatDistance(range, this.unit);
  }

  update(distanceFromSol: Parsecs, dt: number): void {
    this.distanceValue.textContent = formatDistance(distanceFromSol, this.unit);

    this.frameCount += 1;
    this.frameTime += dt;
    if (this.frameTime >= 0.5) {
      this.fpsValue.textContent = (this.frameCount / this.frameTime).toFixed(0);
      this.frameCount = 0;
      this.frameTime = 0;
    }
  }
}
