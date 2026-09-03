/**
 * Entry point: load the dataset, build the star field, wire up the HUD.
 */

import * as THREE from 'three';

import { type StarData, loadAll } from './data/manifest';
import { type HistoryPlace, namedKeys } from './data/history';
import { AssociationField } from './layers/associationField';
import { ClusterField } from './layers/clusterField';
import { HiiField } from './layers/hiiField';
import { OAStarField } from './layers/oaStarField';
import { SettledField } from './layers/settledField';
import { DropLines } from './layers/dropLines';
import { PlaneGrid } from './layers/planeGrid';
import { PosterLayer } from './layers/posterLayer';
import { StarField, flatInkGain } from './layers/starField';
import { WorldField } from './layers/worldField';
import { type EpochFilter, ObjectIndex } from './scene/objects';
import { captureZoomGestures } from './scene/gestures';
import { Viewer } from './scene/viewer';
import { DetailPanel } from './ui/detail';
import {
  DEFAULT_ASSOCIATIONS_VISIBLE,
  DEFAULT_GRID_VISIBLE,
  DEFAULT_HISTORY_PANEL_VISIBLE,
  DEFAULT_ONLY_OA,
  Hud,
  type JumpTarget,
} from './ui/hud';
import { GridLabels } from './ui/gridLabels';
import { LabelOverlay } from './ui/labels';
import { type EpochState, HistoryPanel } from './ui/history';
import { DepthOfField } from './layers/dof';
import { pc } from './units';

/** Find a star's index by its proper name. */
function findByProperName(data: StarData, name: string): number | null {
  for (const [index, entry] of Object.entries(data.names)) {
    if (entry.proper === name) return Number(index);
  }
  return null;
}

function starPosition(data: StarData, index: number): THREE.Vector3 {
  const base = index * 5;
  return new THREE.Vector3(
    data.positions[base],
    data.positions[base + 1],
    data.positions[base + 2],
  );
}

function showError(message: string): void {
  const overlay = document.getElementById('overlay');
  if (!overlay) return;
  overlay.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'panel panel-error';
  box.appendChild(Object.assign(document.createElement('div'), {
    className: 'title',
    textContent: 'Could not load the map',
  }));
  box.appendChild(Object.assign(document.createElement('div'), {
    className: 'note-line',
    textContent: message,
  }));
  box.appendChild(Object.assign(document.createElement('div'), {
    className: 'note-line',
    textContent: 'Run `uv run oastarmap fetch && uv run oastarmap build` in pipeline/.',
  }));
  overlay.appendChild(box);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  const overlay = document.getElementById('overlay');
  if (!canvas || !overlay) throw new Error('Missing #scene or #overlay in the document');

  let data: StarData;
  let clusterField: ClusterField | null = null;
  let hiiField: HiiField | null = null;
  let associationField: AssociationField | null = null;
  let dropLines: DropLines | null = null;
  // Declared with the layers so the HUD callback that opens it can close over
  // it: the panel itself is built after the HUD, because it borrows its unit.
  let historyPanel: HistoryPanel | null = null;
  let oaStarField: OAStarField | null = null;
  let settledField: SettledField | null = null;
  let worldField: WorldField | null = null;
  let loaded;
  try {
    loaded = await loadAll();
    data = loaded.stars;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    return;
  }

  const loading = document.getElementById('loading');
  loading?.remove();

  const viewer = new Viewer(canvas);
  // Before anything else takes a wheel event. See scene/gestures.ts: without
  // this a pinch over a HUD panel zooms the browser instead of the map. The
  // canvas goes with it, so a wheel that landed on an overlay can be handed to
  // the controls listening there rather than converted to a zoom twice over.
  captureZoomGestures(viewer, window, canvas);
  const starField = new StarField(data, {}, loaded.innerSphere?.byStar ?? null, loaded.worlds);
  viewer.scene.add(starField.points);

  // Polity rings around the settled systems, from both sources: Inner Sphere
  // colonies on real stars and the add-on's own stars. The star inside keeps its
  // own colour; the ring is the annotation.
  if (loaded.innerSphere || loaded.oaStars) {
    settledField = new SettledField(
      data,
      loaded.innerSphere?.byStar ?? new Map(),
      loaded.fiction,
      loaded.oaStars,
      loaded.worlds,
    );
    viewer.scene.add(settledField.points);

    // Built from the ring layer's own list, so the threads and the rings can
    // never disagree about which systems the setting claims.
    dropLines = new DropLines(settledField.placements);
    viewer.scene.add(dropLines.lines);
  }

  // HII regions go in before clusters so the cluster rings draw over the glow.
  if (loaded.hii) {
    hiiField = new HiiField(loaded.hii, loaded.fiction);
    hiiField.setPolityMode(true);
    viewer.scene.add(hiiField.mesh);
  }

  // Under the cluster rings and over the nebulae: an OB association is the
  // largest thing on the map and contains most of what is drawn inside it.
  if (loaded.associations) {
    associationField = new AssociationField(loaded.associations, loaded.fiction);
    // Off to begin with: fifty-six overlapping hundred-parsec ellipsoids bury
    // the part of the map most worth reading. See the HUD row.
    associationField.visible = DEFAULT_ASSOCIATIONS_VISIBLE;
    viewer.scene.add(associationField.mesh);
  }

  // After the real field so an asserted star is never buried inside it.
  if (loaded.oaStars) {
    oaStarField = new OAStarField(loaded.oaStars, loaded.worlds);
    viewer.scene.add(oaStarField.points);
  }

  // Last of the point layers: a world the setting names should never be buried
  // under a star it does not mention.
  if (loaded.worlds) {
    worldField = new WorldField(loaded.worlds);
    viewer.scene.add(worldField.points);
    viewer.scene.add(worldField.circles);
  }

  // First into the scene, and drawn first: a borrowed sky map is the sheet the
  // rest is laid over, not another object in it.
  const posterLayer = new PosterLayer();
  viewer.scene.add(posterLayer.mesh);

  // The graticule goes with it. Both are the paper rather than the map.
  const planeGrid = new PlaneGrid();
  planeGrid.visible = DEFAULT_GRID_VISIBLE;
  viewer.scene.add(planeGrid.group);
  const gridLabels = new GridLabels(document.body);
  gridLabels.visible = DEFAULT_GRID_VISIBLE;

  if (loaded.clusters) {
    clusterField = new ClusterField(loaded.clusters, loaded.fiction);
    clusterField.setPolityMode(true);
    viewer.scene.add(clusterField.mesh);
  }

  // Labelling and picking both need to know what is currently drawn, because
  // neither should ever offer an object the renderer is not showing.
  const view = {
    magnitudeLimit: 7.5,
    /** The plan view plots absolute magnitude; perspective, apparent. */
    absoluteMagnitudes: false,
    /** Set while history mode is on; see EpochFilter in scene/objects.ts. */
    epoch: undefined as EpochFilter | undefined,
    visible: {
      star: true,
      cluster: Boolean(clusterField),
      hii: Boolean(hiiField),
      association: Boolean(associationField) && DEFAULT_ASSOCIATIONS_VISIBLE,
      oastar: Boolean(oaStarField),
      world: Boolean(worldField),
      oaOnly: DEFAULT_ONLY_OA,
    },
  };

  const objects = new ObjectIndex(
    data,
    loaded.clusters,
    loaded.hii,
    loaded.fiction,
    loaded.oaStars,
    loaded.innerSphere?.byStar ?? null,
    loaded.worlds,
    loaded.associations,
  );

  const detail = new DetailPanel(
    overlay,
    {
      stars: data,
      clusters: loaded.clusters,
      hii: loaded.hii,
      associations: loaded.associations,
      oaStars: loaded.oaStars,
      innerSphere: loaded.innerSphere,
      worlds: loaded.worlds,
      fiction: loaded.fiction,
      objects,
    },
    (x, y, z, standoff) => viewer.focusOn(new THREE.Vector3(x, y, z), standoff),
  );

  // Whichever panel is touched draws over its neighbours. Delegated from the
  // overlay so it covers panels built after this runs — the detail panel is
  // created and destroyed as the selection changes.
  overlay.addEventListener(
    'pointerdown',
    (event) => {
      const panel = (event.target as HTMLElement | null)?.closest('.panel');
      if (!panel) return;
      for (const other of overlay.querySelectorAll('.panel-front')) {
        other.classList.remove('panel-front');
      }
      panel.classList.add('panel-front');
    },
    true,
  );

  const select = (id: number): void => detail.show(id, hud.currentUnit);
  const labels = new LabelOverlay(document.body, objects, select);

  const handleJump = (target: JumpTarget): void => {
    if (target.starName) {
      const index = findByProperName(data, target.starName);
      if (index === null) return;
      const position = starPosition(data, index);
      // Stand off proportionally to how far out we are, so the destination has
      // context around it rather than filling the screen.
      const standoff = Math.max(position.length() * 0.12, 2);
      viewer.focusOn(position, pc(standoff));
    } else if (target.clusterName && loaded.clusters) {
      const clusters = loaded.clusters;
      const index = clusters.names.findIndex((c) => c.name === target.clusterName);
      if (index < 0) return;
      const base = index * 8;
      const position = new THREE.Vector3(
        clusters.geometry[base],
        clusters.geometry[base + 1],
        clusters.geometry[base + 2],
      );
      // Frame the cluster by its own radius so it fills a consistent share of
      // the view whether it is 47 pc away or 2 kpc.
      const radius = clusters.geometry[base + 3];
      viewer.focusOn(position, pc(Math.max(radius * 4.5, 5)));
    } else if (target.hiiName && loaded.hii) {
      const hii = loaded.hii;
      const index = hii.names.findIndex((h) => h.name === target.hiiName);
      if (index < 0) return;
      const base = index * 7;
      const position = new THREE.Vector3(
        hii.geometry[base],
        hii.geometry[base + 1],
        hii.geometry[base + 2],
      );
      viewer.focusOn(position, pc(Math.max(hii.geometry[base + 3] * 4.5, 5)));
    } else if (target.distancePc !== undefined) {
      // Pull back from Sol along the current viewing direction. Through focusOn
      // rather than by moving the camera directly, because moving an
      // orthographic camera back frames nothing differently — the plan view
      // reframes by zoom, and focusOn is where that conversion lives.
      viewer.focusOn(new THREE.Vector3(0, 0, 0), pc(target.distancePc));
    }
  };

  /**
   * Where a binding points, whichever catalogue it landed in. Each catalogue packs a
   * different stride, so the position cannot be read without knowing the kind.
   */
  const bindingPosition = (kind: string | null, index: number): THREE.Vector3 | null => {
    const source =
      kind === 'cluster'
        ? { array: loaded.clusters?.geometry, stride: 8 }
        : kind === 'hii'
          ? { array: loaded.hii?.geometry, stride: 7 }
          : kind === 'star'
            ? { array: data.positions, stride: 5 }
            : null;
    if (!source?.array) return null;
    const base = index * source.stride;
    return new THREE.Vector3(source.array[base], source.array[base + 1], source.array[base + 2]);
  };

  /** Whose holdings are currently picked out, so a second click puts it back. */
  let focusedPolity: string | null = null;

  /**
   * Pick out one polity by taking the other thirty-nine down.
   *
   * Every layer that draws a polity colour is told the same thing, and none of
   * them hides anything: an unheld object is dimmed, not dropped, because a
   * polity's holdings mean nothing without the sphere around them.
   *
   * The camera does not move. Answering "where is this polity" by flying to it
   * throws away the view the reader had arranged, and the answer is legible
   * from wherever they were standing — which is the point of dimming rather
   * than marking. A second click on the same row restores the map.
   */
  const focusPolity = (polityId: string): void => {
    focusedPolity = focusedPolity === polityId ? null : polityId;
    settledField?.setFocusPolity(focusedPolity);
    clusterField?.setFocusPolity(focusedPolity);
    hiiField?.setFocusPolity(focusedPolity);
  };

  /**
   * Show the map as it stood in one year, or stop.
   *
   * Every layer that draws a claimed place is told the same thing, and so is
   * the picker: a marker the reader cannot see should not be clickable, and a
   * label for a colony three centuries early would be the one part of the map
   * still asserting it.
   */
  const applyEpoch = (state: EpochState | null): void => {
    const year = state ? state.year : null;
    const undated = state ? state.showUndated : true;
    settledField?.setEpoch(year, undated);
    worldField?.setEpoch(year, undated);
    oaStarField?.setEpoch(year, undated);
    // The two catalogues of real objects follow too. A cluster is there in any
    // year, but a map of the sphere in 2400 should not be strewn with seven
    // thousand rings the setting never mentions — and the handful it does
    // mention have dates, so they arrive when the record says.
    clusterField?.setEpoch(year, undated);
    hiiField?.setEpoch(year, undated);
    associationField?.setEpoch(year, undated);
    dropLines?.setEpoch(year, undated);
    if (state) {
      settledField?.setEpochBasis(state.basis);
      worldField?.setEpochBasis(state.basis);
      oaStarField?.setEpochBasis(state.basis);
      clusterField?.setEpochBasis(state.basis);
      hiiField?.setEpochBasis(state.basis);
      associationField?.setEpochBasis(state.basis);
      dropLines?.setEpochBasis(state.basis);
      const named = state.emphasise ? namedKeys(state.period) : null;
      settledField?.setNamedPlaces(named?.settled ?? null);
      worldField?.setNamedPlaces(named?.worlds ?? null);
      oaStarField?.setNamedPlaces(named?.oaStars ?? null);
      clusterField?.setNamedPlaces(named?.settled ?? null);
      hiiField?.setNamedPlaces(named?.settled ?? null);
      associationField?.setNamedPlaces(named?.settled ?? null);
    } else {
      settledField?.setNamedPlaces(null);
      worldField?.setNamedPlaces(null);
      oaStarField?.setNamedPlaces(null);
      clusterField?.setNamedPlaces(null);
      hiiField?.setNamedPlaces(null);
      associationField?.setNamedPlaces(null);
    }
    view.epoch = state
      ? { year: state.year, showUndated: state.showUndated, basis: state.basis }
      : undefined;
    labels.epoch = view.epoch;
  };

  /**
   * Fly to a place the timeline names, wherever it is recorded.
   *
   * The build binds a timeline line to whichever file holds that article, and
   * the four files place a thing four different ways — so the reference says
   * which, and this is where that is turned back into a position.
   */
  const focusPlace = (place: HistoryPlace): void => {
    let position: THREE.Vector3 | null = null;
    if (place.world) {
      const world = loaded.worlds?.worlds.find((entry) => entry.name === place.world);
      if (world?.x !== null && world?.x !== undefined) {
        position = new THREE.Vector3(world.x, world.y as number, world.z as number);
      } else if (world?.star_index !== null && world?.star_index !== undefined) {
        position = starPosition(data, world.star_index);
      } else if (world?.oa_star) {
        position = oaStarPosition(world.oa_star);
      }
    }
    if (!position && place.star_index !== undefined) position = starPosition(data, place.star_index);
    if (!position && place.oa_star) position = oaStarPosition(place.oa_star);
    if (!position && place.catalogue) {
      const binding = loaded.fiction?.bindings.find(
        (entry) => entry.matched_name === place.catalogue || entry.landmark === place.catalogue,
      );
      if (binding?.index !== null && binding?.index !== undefined) {
        position = bindingPosition(binding.kind, binding.index);
      }
    }
    if (!position) return;
    viewer.focusOn(position, pc(Math.max(position.length() * 0.12, 2)));
  };

  const oaStarPosition = (designation: string): THREE.Vector3 | null => {
    const stars = loaded.oaStars;
    if (!stars) return null;
    const index = stars.names.findIndex((entry) => entry.name === designation);
    if (index < 0) return null;
    const base = index * 5;
    return new THREE.Vector3(
      stars.positions[base],
      stars.positions[base + 1],
      stars.positions[base + 2],
    );
  };

  // Every layer that draws at a position shares one focus. Registering rather
  // than being fetched by name means a new sprite layer joins with one line and
  // cannot be left sharp by an update loop that forgot it.
  const dof = new DepthOfField();
  dof.register(starField.dof);
  if (oaStarField) dof.register(oaStarField.dof);
  if (settledField) dof.register(settledField.dof);
  if (worldField) dof.register(worldField.dof);
  if (clusterField) dof.register(clusterField.dof);
  if (associationField) dof.register(associationField.dof);

  const hud = new Hud(
    overlay,
    data.dataset,
    loaded.clusters?.dataset ?? null,
    loaded.hii?.dataset ?? null,
    loaded.associations?.dataset ?? null,
    loaded.history?.dataset ?? null,
    loaded.oaStars?.dataset ?? null,
    loaded.fiction,
    {
      onMagnitudeLimit: (value) => {
        starField.magnitudeLimit = value;
        view.magnitudeLimit = value;
      },
      onExposure: (value) => {
        starField.exposure = value;
      },
      onClustersVisible: (value) => {
        if (clusterField) clusterField.visible = value;
        view.visible.cluster = value;
      },
      onClusterOpacity: (value) => {
        if (clusterField) clusterField.opacity = value;
      },
      onHiiVisible: (value) => {
        if (hiiField) hiiField.visible = value;
        view.visible.hii = value;
      },
      onHiiOpacity: (value) => {
        if (hiiField) hiiField.opacity = value;
      },
      onHiiKinematic: (enabled) => {
        hiiField?.setShowKinematic(enabled);
      },
      onAssociationsVisible: (value) => {
        if (associationField) associationField.visible = value;
        view.visible.association = value;
      },
      onAssociationOpacity: (value) => {
        if (associationField) associationField.opacity = value;
      },
      onHistoryPanel: (visible) => {
        if (historyPanel) historyPanel.visible = visible;
      },
      onGridVisible: (value) => {
        planeGrid.visible = value;
        gridLabels.visible = value;
      },
      onGridMeshVisible: (value) => {
        planeGrid.meshVisible = value;
      },
      onDropLinesOpacity: (value) => {
        if (dropLines) dropLines.opacity = value;
      },
      onDropLinesVisible: (value) => {
        if (dropLines) dropLines.visible = value;
      },
      onZoom: (rangePc) => {
        viewer.range = pc(rangePc);
      },
      onGridOpacity: (value) => {
        planeGrid.opacity = value;
        // The numbers go with the lines. A grid faded to nothing that still
        // had "2 000 ly" written across it would be labelling the void.
        gridLabels.visible = planeGrid.visible && value > 0;
      },
      onDepthOfField: (strength) => {
        dof.strength = strength;
      },
      onDepthOfFieldDim: (amount) => {
        dof.dim = amount;
      },
      onOnlyOA: (enabled) => {
        view.visible.oaOnly = enabled;
        starField.setOnlyOA(enabled);
        clusterField?.setOnlyOA(enabled);
        hiiField?.setOnlyOA(enabled);
      },
      onOAStarsVisible: (value) => {
        if (oaStarField) oaStarField.visible = value;
        view.visible.oastar = value;
        // The canonical worlds are the same kind of statement as the add-on
        // stars — a place the setting asserts — so they follow the same toggle.
        if (worldField) worldField.visible = value;
        view.visible.world = value;
      },
      onLabelsVisible: (value) => {
        labels.visible = value;
      },
      onLabelDensity: (value) => {
        labels.maxLabels = value;
      },
      onNameMode: (mode) => {
        labels.nameMode = mode;
      },
      onPolityMode: (enabled) => {
        clusterField?.setPolityMode(enabled);
        hiiField?.setPolityMode(enabled);
        settledField?.setPolityMode(enabled);
      },
      onFocusPolity: focusPolity,
      onJump: handleJump,
      onViewpoint: (name) => viewer.setViewpoint(name),
      onControlMode: (mode) => viewer.setControlMode(mode),
      onUnitChange: (unit) => {
        // The HUD readout re-renders on the next frame, but the detail panel is
        // static once drawn, so it has to be told.
        detail.refresh(unit);
        labels.unit = unit;
        historyPanel?.setUnit(unit);
        // The grid re-spaces itself on the next frame — its rings are round
        // numbers of whichever unit is on screen, so switching unit moves them.
        unitOnScreen = unit;
      },
      onPoster: (index) => {
        void posterLayer.show(loaded.posters[index] ?? null);
      },
      onPosterOpacity: (value) => {
        posterLayer.opacity = value;
      },
      onProjection: (projection) => {
        const flat = projection === '2d';
        viewer.setProjection(projection);
        // The plan view discards z, so the labels print it; and it has no
        // camera for an apparent magnitude to be apparent from, so the shader,
        // the picker and the labels switch to absolute together. The blur's own
        // axis is read off the viewer each frame, because the wheel changes its
        // scale without changing the mode.
        labels.showAltitude = flat;
        labels.absoluteMagnitudes = flat;
        starField.absoluteMagnitudes = flat;
        view.absoluteMagnitudes = flat;
        hud.setMagnitudeMeaning(flat);
      },
    },
    loaded.posters,
  );

  // The setting's own history, as a year the map can be set to. Built after
  // the HUD so the unit toggle can reach it, and only when the pipeline has
  // written a history file — a clone without the source pages builds every
  // other layer as usual.
  if (loaded.history && settledField) {
    const rings = settledField;
    historyPanel = new HistoryPanel(
      overlay,
      loaded.history,
      () => rings.epoch,
      {
        onEpoch: (state) => applyEpoch(state),
        onFocusPlace: (place) => focusPlace(place),
        onFocusPolity: focusPolity,
      },
      hud.currentUnit,
    );
  }

  // What the grid spaces itself by. Read from the HUD once and kept in step
  // through the unit callback, because the grid updates every frame and asking
  // the HUD each time would be a DOM read in the render loop.
  let unitOnScreen = hud.currentUnit;

  // Click to select, but only if the pointer did not travel — otherwise every
  // orbit drag that happens to end over a star would select it.
  let pressX = 0;
  let pressY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    pressX = event.clientX;
    pressY = event.clientY;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 4) return;

    const rect = canvas.getBoundingClientRect();
    const id = objects.pick(viewer.camera, event.clientX - rect.left, event.clientY - rect.top, {
      width: rect.width,
      height: rect.height,
      magnitudeLimit: view.magnitudeLimit,
      visible: view.visible,
      epoch: view.epoch,
      absoluteMagnitudes: view.absoluteMagnitudes,
    });

    if (id === null) detail.clear();
    else select(id);
  });

  // The layers are built before the HUD declares what the map opens as, so the
  // one that starts filtered is told here rather than being trusted to have
  // been constructed that way.
  if (DEFAULT_ONLY_OA) {
    starField.setOnlyOA(true);
    clusterField?.setOnlyOA(true);
    hiiField?.setOnlyOA(true);
  }
  if (historyPanel) historyPanel.visible = DEFAULT_HISTORY_PANEL_VISIBLE;

  viewer.addFrameCallback((dt) => {
    // The extent layers size their quads in device pixels, so they need both
    // axes of the drawing buffer: the height sets the scale and the width
    // converts a pixel offset into clip space.
    const { width, height } = viewer.renderer.domElement;
    clusterField?.setViewport(width, height);
    hiiField?.setViewport(width, height);
    associationField?.setViewport(width, height);
    worldField?.setViewport(width, height);

    // The plane held sharp is whatever the camera is orbiting, so focus follows
    // the eye rather than being a second thing to aim, and flying towards
    // something keeps it in focus the whole way in. This has to run every
    // frame: it spent one commit inside the click handler, where the focus only
    // moved when the reader happened to click and the labels never learned the
    // settings at all.
    dof.focus = viewer.focusDistance;

    // Which axis is depth. Under perspective it is distance from the camera; in
    // the plan view that number means nothing, so the blur takes z instead —
    // see Projection in scene/viewer.ts. Read every frame rather than set at
    // the switch, because the wheel changes the scale without changing the mode.
    //
    // Blur reaching full strength one screen-height off the plane. Tied to the
    // view rather than fixed in parsecs, so zooming into the Inner Sphere
    // separates a few parsecs of altitude the way zooming out separates
    // hundreds. Brightness deliberately is *not*: see the star shader.
    const halfHeight = viewer.flatHalfHeight as number;
    dof.setFlat(halfHeight, viewer.focusTarget.z);
    // Pulling a map out packs more stars into every pixel, and they are drawn
    // additively, so the sheet saturates unless each one lays down less. Read
    // each frame, from the scale rather than from the mode.
    starField.flatInk = flatInkGain(halfHeight);
    // Handed over whenever either control is doing something: dimming works
    // without blur, and the labels have to thin out with the sky.
    labels.depthOfField = dof.strength > 0 || dof.dim > 0 ? dof : null;

    // The grid is spaced from how much map is on screen, which changes with
    // every scroll and every jump, so it is re-derived per frame rather than
    // pushed from the controls that happen to alter it.
    planeGrid.update(viewer.viewHalfHeight, unitOnScreen);

    const rect = canvas.getBoundingClientRect();
    gridLabels.update(
      viewer.camera,
      rect.width,
      rect.height,
      planeGrid.radiiInUnit,
      planeGrid.reachPc,
      unitOnScreen,
    );

    // Read each frame rather than pushed on select, so closing the panel from
    // its own button releases the label without a callback between the two.
    labels.selected = detail.currentId;
    labels.update(
      viewer.camera,
      rect.width,
      rect.height,
      view.magnitudeLimit,
      view.visible,
      performance.now(),
    );

    // The slider follows the wheel. Pushed rather than polled by the HUD so
    // that dragging the slider does not fight the frame that reads it back.
    hud.setZoom(viewer.range);

    hud.update(viewer.distanceFromSol, dt);
  });

  viewer.start();
}

void main();
