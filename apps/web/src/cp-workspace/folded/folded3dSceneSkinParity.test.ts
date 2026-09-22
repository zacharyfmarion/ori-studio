/**
 * The invariant that outlives the projector (§7 of
 * `implementation-plans/unified-paper-style-and-export.md`): at every camera
 * the parity harness sweeps, the `(face, side)` the export's scene shows are
 * exactly the skins the window's draw passes show.
 *
 * `folded3dProjectorParity.test.ts` compares the window with the projector by
 * pixel, and is left as it is until Phase 7. This test compares the window
 * with the scene *by set*, on the same fixtures over the same sweep, from the
 * one mesh both are built from — which is what makes it a statement about
 * ordering rather than about rasterisers:
 *
 * - **Forward.** Every `(face, side)` the scene leaves unhidden is a skin
 *   `folded3dDrawPasses` submits at that camera. The window submits one layer
 *   per plane per cell — the one nearest the eye — so a scene face that shows
 *   and is not in a skin would be a buried layer drawn on top.
 * - **Reverse.** Every skin the window's depth buffer shows a pixel of, the
 *   scene shows. A submitted skin can still be hidden — a nearer plane in
 *   front of it, or its own creases over a face seen nearly edge-on — and
 *   only a rasterisation of the passes with a depth buffer says which, so
 *   the passes are drawn here as the harness draws them: faces depth-tested,
 *   creases depth-tested with the window's bias and never writing depth. A
 *   pixel under the pen's ribbon is ink, not paper; the pen's half-width plus
 *   half a pixel for the two rasterisers' quantisation.
 *
 * Side is read the way the GPU reads it, from the screen winding
 * (`gl_FrontFacing`), for both — the scene's side is pinned to the payload's
 * own facts in `folded3dScene.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  projectVertices,
  type CameraUniforms,
  type PaperScene,
} from '@treemaker/origami-simulator';
import type {
  OristudioCpFold3dTolerances,
  OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { widestPenCssPx } from '../../lib/paper/paperSvg';
import { folded3dDrawPasses } from '../../simulator/foldedMeshSource';
import { folded3dMesh, type Folded3dMesh } from './folded3dMesh';
import { folded3dPaperScene, folded3dSceneCamera } from './folded3dScene';
import { FOLDED_3D_CREASE_DEPTH_BIAS } from './folded3dWindow';
import type { FoldedFigureCamera } from './foldedFigure3dProjection';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

/** The harness's fixtures. */
const NAMES = ['minimal_repro', 'hinge_90', 'spikes_small', 'pinwheel', 'box_90'] as const;

/** The kernel's shipped `Fold3dTolerances::DEFAULT`. */
const TOLERANCES: OristudioCpFold3dTolerances = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

/** The window's box in CSS px. */
const BOX = 300;

/** The harness's sweep: the whole sphere, from underneath included. */
function* sweep(): Generator<readonly [string, FoldedFigureCamera]> {
  for (let yawStep = 0; yawStep < 8; yawStep += 1) {
    for (const tiltDeg of [0, 20, 40, 60, 80, 100, 120, 140, 160, 200, 240, 280, 320]) {
      yield [
        `yaw ${yawStep} tilt ${tiltDeg}`,
        { yaw: (yawStep / 8) * Math.PI * 2, pitch: -Math.PI / 2 + (tiltDeg / 180) * Math.PI, zoom: 1 },
      ];
    }
  }
}

function fixture(name: string): OristudioCpFolded3dRenderModel {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.rendermodel.json`), 'utf8'));
}

function meshOf(model: OristudioCpFolded3dRenderModel): Folded3dMesh {
  const result = folded3dMesh(model);
  if (result.kind !== 'mesh') throw new Error(`expected a mesh, got ${result.kind}`);
  return result.mesh;
}

/** `face:side`, the identity a paper item has on either surface. */
type Key = `${number}:${'front' | 'back'}`;

/** What the window shows at a camera, by set. */
interface WindowSkins {
  /** Every `(face, side)` the passes submit, edge-on triangles aside. */
  submitted: Set<Key>;
  /** Those the depth buffer shows at least one pixel of, outside the window's own ink. */
  shown: Set<Key>;
}

function windowSkins(mesh: Folded3dMesh, camera: CameraUniforms): WindowSkins {
  const projected = projectVertices(mesh.positions, camera);
  const ndcZ = (v: number): number =>
    Math.max(-1, Math.min(1, -(projected.view[v * 3 + 2] ?? 0) / camera.depthRange));
  const sx = (v: number): number => projected.screen[v * 2]!;
  const sy = (v: number): number => projected.screen[v * 2 + 1]!;
  // Skins repeat slot triangles at their own offsets; a triangle's face is
  // its first vertex's, which every copy shares.
  const faceOfVertex = new Int32Array(Math.floor(mesh.positions.length / 3)).fill(-1);
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    for (let v = mesh.slots.vertexStart[slot]!; v < mesh.slots.vertexStart[slot + 1]!; v += 1) {
      faceOfVertex[v] = mesh.slots.face[slot]!;
    }
  }

  const passes = folded3dDrawPasses(
    { ...mesh, undeterminedFaceAlpha: 0.45 },
    { showFaces: true, showEdges: true, faceAlpha: 1 },
    camera
  );
  const submitted = new Set<Key>();
  const depth = new Float32Array(BOX * BOX).fill(Infinity);
  const owner = new Array<Key | null>(BOX * BOX).fill(null);
  const ink = new Uint8Array(BOX * BOX);
  const idx = mesh.topology.faceIndices;
  const half = widestPenCssPx(DEFAULT_PAPER_STYLE) / 2 + 0.5;

  for (const pass of passes) {
    if (pass.faceRange) {
      const end = pass.faceRange.start + pass.faceRange.count;
      for (let t = pass.faceRange.start; t + 2 < end; t += 3) {
        const [ia, ib, ic] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        const [ax, ay, bx, by, cx, cy] = [sx(ia), sy(ia), sx(ib), sy(ib), sx(ic), sy(ic)];
        const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        // Nothing rasterises for a triangle seen edge-on.
        if (Math.abs(area) < 1e-9) continue;
        // `gl_FrontFacing` from the screen winding, negated for y-down.
        const key: Key = `${faceOfVertex[ia]!}:${-area >= 0 ? 'front' : 'back'}`;
        submitted.add(key);
        const [az, bz, cz] = [ndcZ(ia), ndcZ(ib), ndcZ(ic)];
        const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
        const y1 = Math.min(BOX - 1, Math.ceil(Math.max(ay, by, cy)));
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        const x1 = Math.min(BOX - 1, Math.ceil(Math.max(ax, bx, cx)));
        for (let py = y0; py <= y1; py += 1) {
          for (let px = x0; px <= x1; px += 1) {
            const [qx, qy] = [px + 0.5, py + 0.5];
            const w0 = ((bx - ax) * (qy - ay) - (by - ay) * (qx - ax)) / area;
            const w1 = ((qx - ax) * (cy - ay) - (qy - ay) * (cx - ax)) / area;
            if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
            const at = py * BOX + px;
            const z = az + w1 * (bz - az) + w0 * (cz - az);
            if (z > depth[at]!) continue;
            depth[at] = z;
            owner[at] = key;
          }
        }
      }
    }
    if (pass.edgeRange) {
      const end = pass.edgeRange.start + pass.edgeRange.count;
      for (let e = pass.edgeRange.start; e < end; e += 1) {
        const ia = mesh.topology.edgeIndices[e * 2]!;
        const ib = mesh.topology.edgeIndices[e * 2 + 1]!;
        const [ax, ay, bx, by] = [sx(ia), sy(ia), sx(ib), sy(ib)];
        const [az, bz] = [ndcZ(ia), ndcZ(ib)];
        const length = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.ceil(length * 2));
        for (let s = 0; s <= steps; s += 1) {
          const u = s / steps;
          const [x, y, z] = [ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u];
          for (let oy = -Math.ceil(half); oy <= Math.ceil(half); oy += 1) {
            for (let ox = -Math.ceil(half); ox <= Math.ceil(half); ox += 1) {
              if (ox * ox + oy * oy > half * half + 0.5) continue;
              const [px, py] = [Math.floor(x + ox), Math.floor(y + oy)];
              if (px < 0 || py < 0 || px >= BOX || py >= BOX) continue;
              const at = py * BOX + px;
              // Creases test but do not write depth, exactly like the real pass.
              if (z - FOLDED_3D_CREASE_DEPTH_BIAS > depth[at]!) continue;
              ink[at] = 1;
            }
          }
        }
      }
    }
  }

  const shown = new Set<Key>();
  owner.forEach((key, at) => {
    if (key && !ink[at]) shown.add(key);
  });
  return { submitted, shown };
}

/** The `(face, side)` the scene leaves unhidden. */
function sceneShown(scene: PaperScene): Set<Key> {
  const shown = new Set<Key>();
  for (const item of scene.items) {
    if (item.kind === 'face' && !item.hidden) shown.add(`${item.face}:${item.side}`);
  }
  return shown;
}

interface Disagreement {
  camera: string;
  /** Scene faces that show and are not a skin the window submits. */
  notASkin: Key[];
  /** Skins the window shows a pixel of that the scene hides. */
  hiddenByScene: Key[];
}

describe('the scene’s visible faces are the window’s skins', () => {
  it.each(NAMES)('%s, at every camera of the harness sweep', (name) => {
    const model = fixture(name);
    const mesh = meshOf(model);
    const found: Disagreement[] = [];
    let cameras = 0;
    let blank = 0;
    for (const [label, orbit] of sweep()) {
      const camera = folded3dSceneCamera(orbit, mesh, BOX);
      const scene = folded3dPaperScene(mesh, model, camera, {
        style: DEFAULT_PAPER_STYLE,
        markHidden: true,
        tolerances: TOLERANCES,
      });
      const shown = sceneShown(scene);
      const window = windowSkins(mesh, camera);
      if (shown.size === 0) blank += 1;
      const notASkin = [...shown].filter((key) => !window.submitted.has(key));
      const hiddenByScene = [...window.shown].filter((key) => !shown.has(key));
      if (notASkin.length > 0 || hiddenByScene.length > 0) {
        found.push({ camera: label, notASkin, hiddenByScene });
      }
      cameras += 1;
    }
    expect(found).toEqual([]);
    expect(cameras).toBe(104);
    // Not vacuous: a flat model seen exactly edge-on shows nothing on either
    // surface, which the sweep's `tilt 0` row is for a flat pinwheel; every
    // other camera shows paper.
    expect(blank).toBeLessThanOrEqual(8);
  });
});
