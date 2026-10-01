/**
 * One figure, one picture — and the two spaces it can be asked for in.
 *
 * What matters here is not the geometry (`folded3dScene.test.ts` pins that
 * against the window's own draw passes) but *where it lands*: a stored scene
 * has to sit in the figure's local user space, at the size the placement will
 * scale, or the canvas draws it in the wrong place or at the square of the
 * figure's scale.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PaperScene, ScenePoint } from '@treemaker/origami-simulator';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import {
  FOLDED_3D_LOCAL_CENTER,
  folded3dLocalFrameSide,
  foldedFigureBox,
} from '../adapters/cpFoldedToScene';
import {
  IDENTITY_FOLDED_PLACEMENT,
  type OristudioCpFold3dTolerances,
  type OristudioCpFolded3dRenderModel,
  type OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import { folded3dFigureScene } from './folded3dStoredScene';
import { DEFAULT_FOLDED_3D_CAMERA, folded3dFrameRadius } from './folded3dCamera';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const MODEL: OristudioCpFolded3dRenderModel = JSON.parse(
  readFileSync(join(FIXTURES, 'box_90.rendermodel.json'), 'utf8')
);

/** The kernel's shipped `Fold3dTolerances::DEFAULT`. */
const TOLERANCES: OristudioCpFold3dTolerances = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

const FRAME_RADIUS = folded3dFrameRadius(MODEL);

function figure(
  overrides: Partial<OristudioCpFoldedFigureEntry> = {}
): OristudioCpFoldedFigureEntry {
  return {
    id: 'folded-1',
    title: 'Folded model 1',
    handle: 7,
    sourceKind: 'generated-3d',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d: { model: { state: 'Front0' }, diagnostics: { tolerances: TOLERANCES } },
    renderSnapshot: null,
    scene: null,
    placement: IDENTITY_FOLDED_PLACEMENT,
    camera: DEFAULT_FOLDED_3D_CAMERA,
    frameRadius: FRAME_RADIUS,
    error: null,
    ...overrides,
  } as unknown as OristudioCpFoldedFigureEntry;
}

function build(
  entry = figure(),
  space: 'document' | number = 'document'
): PaperScene {
  const scene = folded3dFigureScene(entry, MODEL, { style: DEFAULT_PAPER_STYLE, space });
  if (!scene) throw new Error('expected a scene');
  return scene;
}

function points(scene: PaperScene): ScenePoint[] {
  return scene.items.flatMap((item) =>
    item.kind === 'face' ? item.rings.flat() : item.kind === 'line' ? [item.a, item.b] : []
  );
}

describe('a 3D figure’s stored picture', () => {
  it('lands in the figure’s local user space, inside the frame it is drawn in', () => {
    const scene = build();
    const side = folded3dLocalFrameSide(FRAME_RADIUS);
    // The box `cameraUniforms` centres the model in, moved onto the pivot: the
    // canvas then draws the scene through the placement affine and nothing
    // else, and nothing can escape the frame the chrome is drawn around — at
    // any camera, which is what sizing the frame to the bounding sphere buys.
    expect(points(scene).length).toBeGreaterThan(0);
    for (const [x, y] of points(scene)) {
      expect(Math.abs(x - FOLDED_3D_LOCAL_CENTER.x)).toBeLessThanOrEqual(side / 2 + 1e-6);
      expect(Math.abs(y - FOLDED_3D_LOCAL_CENTER.y)).toBeLessThanOrEqual(side / 2 + 1e-6);
    }
    // Non-vacuous: the pivot is not the origin, so an unshifted picture — one
    // left in the camera's own `[0, side]` box — fails the containment above.
    expect(FOLDED_3D_LOCAL_CENTER.x).toBeGreaterThan(side / 2);
  });

  it('fills the box the canvas draws its chrome around', () => {
    const entry = figure();
    const scene = build(entry);
    const box = foldedFigureBox({ ...entry, scene })!;
    // Not merely inside it: the perspective silhouette of the bounding sphere
    // is exactly the frame, so a model that filled the sphere fills the box.
    expect(Math.max(box.width, box.height)).toBeCloseTo(
      folded3dLocalFrameSide(FRAME_RADIUS),
      9
    );
    expect(box.center).toEqual(FOLDED_3D_LOCAL_CENTER);
  });

  it('is the same picture whatever the figure has been scaled to', () => {
    // The placement scales the stored picture every time it is drawn. A picture
    // built at the placed size would be scaled twice — a figure at 2× would
    // draw at 4× the moment it was turned.
    const scaled = build(
      figure({ placement: { ...IDENTITY_FOLDED_PLACEMENT, scale: 3 } })
    );
    expect(scaled).toEqual(build());
  });

  it('sizes a page scene by the figure’s on-screen box instead', () => {
    // The export's space (D3): the default sheet is what the figure measures on
    // screen, so here the placement and the canvas zoom do count. A page scene
    // is asked of a figure that is already on the canvas, so it has its stored
    // picture — which is what its box is measured from.
    const placed = figure({ placement: { ...IDENTITY_FOLDED_PLACEMENT, scale: 2 } });
    const entry = { ...placed, scene: build(placed) };
    const extent = (scene: PaperScene) => scene.bounds.maxX - scene.bounds.minX;
    expect(extent(build(entry, 1))).toBeCloseTo(extent(entry.scene) * 2, 6);
  });

  it('answers null for a figure there is nothing to build from', () => {
    const options = { style: DEFAULT_PAPER_STYLE, space: 'document' as const };
    // Not a 3D figure at all.
    expect(folded3dFigureScene(figure({ folded3d: null }), MODEL, options)).toBeNull();
    // A page scene wants the figure's box, and a figure that has never drawn
    // has none.
    expect(folded3dFigureScene(figure(), MODEL, { ...options, space: 1 })).toBeNull();
  });

  it('falls back to the model’s own frame for a figure that has not recorded one', () => {
    // A figure is given `frameRadius` at fold time from this very number, so
    // the two agree — but the picture is built before the entry exists.
    expect(build(figure({ frameRadius: null }))).toEqual(build());
  });
});
