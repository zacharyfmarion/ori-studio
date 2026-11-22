import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PaperLineItem, PaperScene } from '@treemaker/origami-simulator';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { OristudioCpFolded3dRenderModel } from '../../engine/oristudioCpTypes';
import { DEFAULT_FOLDED_3D_CAMERA } from './folded3dCamera';
import { folded3dMesh } from './folded3dMesh';
import { folded3dPaperScene, folded3dSceneCamera } from './folded3dScene';
import {
  BACKGROUND,
  INK,
  WINDOW_PARITY_BOX as BOX,
  compareWithWindow,
  inkMask,
  windowPicture,
} from './folded3dWindowParity.testSupport';

/**
 * The comparison itself: a line the scene draws over paper the window shows
 * bare is counted, and put down to the role of the line that drew it, which is
 * how the diagram corpus tells a buried aux line drawn on top from the concave
 * creases the window loses.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const model = JSON.parse(readFileSync(join(FIXTURES, 'box_90.rendermodel.json'), 'utf8')) as OristudioCpFolded3dRenderModel;

function setup() {
  const built = folded3dMesh(model);
  if (built.kind !== 'mesh') throw new Error(`expected a mesh, got ${built.kind}`);
  const camera = folded3dSceneCamera(DEFAULT_FOLDED_3D_CAMERA, built.mesh, BOX);
  const scene = folded3dPaperScene(built.mesh, model, camera, {
    style: DEFAULT_PAPER_STYLE,
    markHidden: true,
    // The kernel's shipped `Fold3dTolerances::DEFAULT`, as folded3dScene.test.ts uses.
    tolerances: { angle_radians: 1e-7, distance_relative: 1e-6, flat_snap_degrees: 1e-6, overlap_area_relative: 1e-9 },
  });
  return { mesh: built.mesh, camera, scene };
}

/** A pixel whose neighbourhood the window shows as bare paper, far from any of its ink. */
function bareInterior(window: ReturnType<typeof windowPicture>): [number, number] {
  const ink = inkMask(window, 14);
  for (let y = 0; y < BOX; y += 1) {
    for (let x = 0; x < BOX; x += 1) {
      const at = y * BOX + x;
      const id = window.id[at]!;
      if (id !== BACKGROUND && id < INK && !ink[at]) return [x, y];
    }
  }
  throw new Error('the window shows no bare paper');
}

describe('the window comparison', () => {
  it('puts ink drawn over bare paper down to the line that drew it', () => {
    const { mesh, camera, scene } = setup();
    const before = compareWithWindow(mesh, scene, camera);
    expect(before.spuriousInkByRole.aux).toBeUndefined();

    const [x, y] = bareInterior(windowPicture(mesh, camera, 1.5));
    const stray: PaperLineItem = {
      kind: 'line',
      role: 'aux',
      a: [x - 6, y + 0.5],
      b: [x + 6, y + 0.5],
      onBoundary: [false, false],
    };
    const drawnOnTop: PaperScene = { ...scene, items: [...scene.items, stray] };
    const after = compareWithWindow(mesh, drawnOnTop, camera);

    expect(after.spuriousInkByRole.aux).toBeGreaterThan(0);
    expect(after.linesWithSpuriousInk.aux).toBe(1);
    expect(after.spuriousInk - before.spuriousInk).toBe(after.spuriousInkByRole.aux);
    expect(after.missingInk).toBe(before.missingInk);
  });
});
