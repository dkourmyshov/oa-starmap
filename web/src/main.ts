/**
 * Entry point: load the dataset, build the star field, wire up the HUD.
 */

import * as THREE from 'three';

import { type StarData, loadAll } from './data/manifest';
import { ClusterField } from './layers/clusterField';
import { HiiField } from './layers/hiiField';
import { OAStarField } from './layers/oaStarField';
import { SettledField } from './layers/settledField';
import { StarField } from './layers/starField';
import { WorldField } from './layers/worldField';
import { ObjectIndex } from './scene/objects';
import { Viewer } from './scene/viewer';
import { DetailPanel } from './ui/detail';
import { Hud, type JumpTarget } from './ui/hud';
import { LabelOverlay } from './ui/labels';
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
  }

  // HII regions go in before clusters so the cluster rings draw over the glow.
  if (loaded.hii) {
    hiiField = new HiiField(loaded.hii, loaded.fiction);
    hiiField.setPolityMode(true);
    viewer.scene.add(hiiField.points);
  }

  // After the real field so an asserted star is never buried inside it.
  if (loaded.oaStars) {
    oaStarField = new OAStarField(loaded.oaStars);
    viewer.scene.add(oaStarField.points);
  }

  // Last of the point layers: a world the setting names should never be buried
  // under a star it does not mention.
  if (loaded.worlds) {
    worldField = new WorldField(loaded.worlds);
    viewer.scene.add(worldField.points);
    viewer.scene.add(worldField.circles);
  }

  if (loaded.clusters) {
    clusterField = new ClusterField(loaded.clusters, loaded.fiction);
    clusterField.setPolityMode(true);
    viewer.scene.add(clusterField.points);
  }

  // Labelling and picking both need to know what is currently drawn, because
  // neither should ever offer an object the renderer is not showing.
  const view = {
    magnitudeLimit: 7.5,
    visible: {
      star: true,
      cluster: Boolean(clusterField),
      hii: Boolean(hiiField),
      oastar: Boolean(oaStarField),
      world: Boolean(worldField),
      oaOnly: false,
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
  );

  const detail = new DetailPanel(
    overlay,
    {
      stars: data,
      clusters: loaded.clusters,
      hii: loaded.hii,
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
      // Pull back from Sol along the current viewing direction.
      viewer.controls.target.set(0, 0, 0);
      const direction = viewer.camera.position.clone().normalize();
      if (direction.lengthSq() === 0) direction.set(0, -1, 0.4).normalize();
      viewer.camera.position.copy(direction.multiplyScalar(target.distancePc));
      viewer.controls.update();
    }
  };

  /**
   * Where a binding points, whichever catalog it landed in. Each catalog packs a
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

  /** Frame every bound landmark of one polity, so its territory reads as a whole. */
  const focusPolity = (polityId: string): void => {
    if (!loaded.fiction) return;

    const points: THREE.Vector3[] = [];
    for (const binding of loaded.fiction.bindings) {
      if (binding.index === null || !binding.polities.includes(polityId)) continue;
      const position = bindingPosition(binding.kind, binding.index);
      if (position) points.push(position);
    }
    if (points.length === 0) return;

    const centre = new THREE.Vector3();
    for (const point of points) centre.add(point);
    centre.divideScalar(points.length);

    let extent = 0;
    for (const point of points) {
      extent = Math.max(extent, point.distanceTo(centre));
    }

    viewer.focusOn(centre, pc(Math.max(extent * 2.2, 50)));
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

  const hud = new Hud(
    overlay,
    data.dataset,
    loaded.clusters?.dataset ?? null,
    loaded.hii?.dataset ?? null,
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
      },
    },
  );

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
    });

    if (id === null) detail.clear();
    else select(id);
  });

  viewer.addFrameCallback((dt) => {
    // Both volumetric layers project a true angular size, so they depend on
    // viewport height.
    const height = viewer.renderer.domElement.height;
    clusterField?.setViewportHeight(height);
    hiiField?.setViewportHeight(height);
    worldField?.setViewportHeight(height);

    // The plane held sharp is whatever the camera is orbiting, so focus follows
    // the eye rather than being a second thing to aim, and flying towards
    // something keeps it in focus the whole way in. This has to run every
    // frame: it spent one commit inside the click handler, where the focus only
    // moved when the reader happened to click and the labels never learned the
    // settings at all.
    dof.focus = viewer.focusDistance;
    labels.depthOfField = dof.strength > 0 ? dof : null;

    const rect = canvas.getBoundingClientRect();
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

    hud.update(viewer.distanceFromSol, dt);
  });

  viewer.start();
}

void main();
