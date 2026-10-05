/**
 * Annotations carried through a spread on a real woven fold: Oriedita's own
 * `glitch.cp` seen from the back, where a cycle of thirty-odd faces is on top
 * of nearly every subface, so most of what shows is a woven patch — a piece
 * of its face drawn over the faces it lies on there. Folded by the real
 * kernel and captured as a step captures it (`flatPicture`), so the stored
 * scene is the one the carry reads in the app: a patch in it has no group,
 * and is told from its face only by coming after it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { meanValueWeights } from '../../cp-workspace/folded/foldedLayerSpread';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import type { OristudioCpFoldedFigureResult, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import {
  folded_figure_fold,
  folded_figure_paper_scene,
  folded_figure_set_model,
  free_document,
  free_folded_figure,
  load_cp,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import type { FoldedPicture } from '../../lib/creaseExportFold';
import type { PaperFaceItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { flatPicture } from '../capture/captureFolded';
import {
  createDiagram,
  insertSteps,
  setLinkedPicture,
  type DiagramCpRender,
  type DiagramScenePicture,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { cpSource, cpStep } from '../document/diagramSteps.fixtures';
import { storedScene } from '../pictures/pictureFrame';

const ORIEDITA_TEST_RESOURCES = resolve(process.cwd(), '../../third_party/oriedita/oriedita-data/src/test/resources');

let back: OristudioCpFoldedPaperScene | null = null;

beforeAll(async () => {
  await initCpWasm();
  const document = load_cp(readFileSync(resolve(ORIEDITA_TEST_RESOURCES, 'glitch.cp'), 'utf8'), 'glitch');
  const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
  folded_figure_set_model(result.handle, { ...result.snapshot.model, state: 'Back1' });
  back = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  free_folded_figure(result.handle);
  free_document(document);
});

/** `glitch.cp` from the back, captured at a depth spread of `amount` up and to the left. */
function captured(amount: number): DiagramScenePicture {
  if (!back) throw new Error('the kernel drew nothing');
  // A fold with a paper scene is captured from it alone; the render snapshot is the fallback for one without.
  const read: FoldedPicture = { snapshot: null as unknown as FoldedPicture['snapshot'], scene: back };
  const result = flatPicture(read, 0, undefined, { kind: 'depth', amount, toward: 'up-left' });
  if (result.kind !== 'picture' || result.picture.kind !== 'scene') throw new Error('no scene');
  return result.picture;
}

const render = (amount: number): DiagramCpRender => ({
  mode: 'folded-flat',
  side: 'back',
  rotationDeg: 0,
  foldCase: 1,
  spread: { kind: 'depth', amount, toward: 'up-left' },
});

function picturePoint({ bounds }: PaperScene, [x, y]: ScenePoint): [number, number] {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return [(x - bounds.minX) / span, (y - bounds.minY) / span];
}

describe('a woven fold spread otherwise', () => {
  it('carries a mark on a woven patch with the patch, its face moved as a whole (review)', () => {
    const [before, after] = [captured(0.025), captured(0.1)];
    const [sceneBefore, sceneAfter] = [storedScene(before)!, storedScene(after)!];
    const faces = (scene: PaperScene) =>
      scene.items.filter((item): item is PaperFaceItem => item.kind === 'face' && item.rings.length === 1);
    const [facesBefore, facesAfter] = [faces(sceneBefore), faces(sceneAfter)];
    // The same items in the same order: a spread moves them, and draws nothing else.
    expect(facesAfter.map((item) => item.face)).toEqual(facesBefore.map((item) => item.face));
    // A patch is a face drawn again, after itself.
    const patches = facesBefore
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => facesBefore.slice(0, index).some((earlier) => earlier.face === item.face));
    expect(patches.length).toBeGreaterThan(20);

    // A circle at the middle of each patch, and on each of its corners.
    const points: { at: ScenePoint; index: number; what: string }[] = [];
    for (const { item, index } of patches) {
      const ring = item.rings[0]!;
      const middle: ScenePoint = [
        ring.reduce((sum, [x]) => sum + x, 0) / ring.length,
        ring.reduce((sum, [, y]) => sum + y, 0) / ring.length,
      ];
      points.push({ at: middle, index, what: `patch ${index} middle` });
      ring.forEach((corner, k) => points.push({ at: corner, index, what: `patch ${index} corner ${k}` }));
    }
    const marks = points.map(({ at }, k): KnownDiagramAnnotation => {
      const from = picturePoint(sceneBefore, at);
      return { id: `m-${k}`, kind: 'circle', from, to: from };
    });
    const step: DiagramStep = { ...cpStep('step-1', render(0.025), before), annotations: marks, annotatedPictureKey: before.key };
    const moved = setLinkedPicture(insertSteps(createDiagram(), [step], 0), 'step-1', {
      source: cpSource(render(0.1)),
      picture: after,
    }).steps[0] as DiagramStep;
    expect(moved.annotatedPictureKey).toBe(after.key);

    // Each where its patch went: its place over the patch's outline, on the patch's outline after.
    let worst = 0;
    points.forEach(({ at, index, what }, k) => {
      const ringBefore = facesBefore[index]!.rings[0]!;
      const ringAfter = facesAfter[index]!.rings[0]!;
      const weights = meanValueWeights(
        ringBefore.map(([x, y]) => ({ x, y })),
        { x: at[0], y: at[1] },
        1e-9
      )!;
      const goal = weights.reduce<ScenePoint>(
        ([x, y], weight, corner) => [x + weight * ringAfter[corner]![0], y + weight * ringAfter[corner]![1]],
        [0, 0]
      );
      const expected = picturePoint(sceneAfter, goal);
      const carried = (moved.annotations[k] as KnownDiagramAnnotation).from;
      const off = Math.hypot(carried[0] - expected[0], carried[1] - expected[1]);
      worst = Math.max(worst, off);
      // Within the stored grid's rounding.
      expect(off, what).toBeLessThan(1e-4);
    });
    expect(worst).toBeLessThan(1e-4);
  });
});
