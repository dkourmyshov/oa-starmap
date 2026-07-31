/**
 * Entry point: load the dataset, build the star field, wire up the HUD.
 */

import * as THREE from 'three';

import { type StarData, loadAll } from './data/manifest';
import { ClusterField } from './layers/clusterField';
import { HiiField } from './layers/hiiField';
import { StarField } from './layers/starField';
import { Viewer } from './scene/viewer';
import { Hud, type JumpTarget } from './ui/hud';
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
  const starField = new StarField(data);
  viewer.scene.add(starField.points);

  // HII regions go in before clusters so the cluster rings draw over the glow.
  if (loaded.hii) {
    hiiField = new HiiField(loaded.hii, loaded.fiction);
    hiiField.setPolityMode(true);
    viewer.scene.add(hiiField.points);
  }

  if (loaded.clusters) {
    clusterField = new ClusterField(loaded.clusters, loaded.fiction);
    clusterField.setPolityMode(true);
    viewer.scene.add(clusterField.points);
  }

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

  const hud = new Hud(
    overlay,
    data.dataset,
    loaded.clusters?.dataset ?? null,
    loaded.hii?.dataset ?? null,
    loaded.fiction,
    {
      onMagnitudeLimit: (value) => {
        starField.magnitudeLimit = value;
      },
      onExposure: (value) => {
        starField.exposure = value;
      },
      onClustersVisible: (value) => {
        if (clusterField) clusterField.visible = value;
      },
      onClusterOpacity: (value) => {
        if (clusterField) clusterField.opacity = value;
      },
      onHiiVisible: (value) => {
        if (hiiField) hiiField.visible = value;
      },
      onHiiOpacity: (value) => {
        if (hiiField) hiiField.opacity = value;
      },
      onHiiKinematic: (enabled) => {
        hiiField?.setShowKinematic(enabled);
      },
      onPolityMode: (enabled) => {
        clusterField?.setPolityMode(enabled);
        hiiField?.setPolityMode(enabled);
      },
      onFocusPolity: focusPolity,
      onJump: handleJump,
      onUnitChange: () => {
        /* HUD re-renders distances on the next frame. */
      },
    },
  );

  viewer.addFrameCallback((dt) => {
    // Both volumetric layers project a true angular size, so they depend on
    // viewport height.
    const height = viewer.renderer.domElement.height;
    clusterField?.setViewportHeight(height);
    hiiField?.setViewportHeight(height);
    hud.update(viewer.distanceFromSol, dt);
  });

  viewer.start();
}

void main();
