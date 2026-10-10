/**
 * Marks behind the flaps of a real fold (15e): Oriedita's bird base, folded
 * flat by the kernel and captured as a step's picture is — its layers spread,
 * and not, when only the faces that show are kept — read through the layers
 * Annotate reads (`pictureGeometry`).
 * Synthetic squares say what the rule is (`behindFlaps.test.ts`); this says
 * it holds on the faces a fold makes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
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
import { flatPicture } from '../capture/captureFolded';
import type { DiagramCpRender, DiagramScenePicture } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import type { PicturePoint } from './annotationModel';
import { facesAt, facesOverEnd, hiddenStretches } from './behindFlaps';
import { pictureGeometry, type PictureCover, type PictureLayers } from './pictureGeometry';

const ORIEDITA_TEST_RESOURCES = resolve(process.cwd(), '../../third_party/oriedita/oriedita-data/src/test/resources');
const SPREAD = { kind: 'depth', amount: 0.025, toward: 'up-left' } as const;

let scene: OristudioCpFoldedPaperScene | null = null;

beforeAll(async () => {
  await initCpWasm();
  const document = load_cp(readFileSync(resolve(ORIEDITA_TEST_RESOURCES, 'birdbase.cp'), 'utf8'), 'birdbase');
  const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
  folded_figure_set_model(result.handle, { ...result.snapshot.model, state: 'Back1' });
  scene = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  free_folded_figure(result.handle);
  free_document(document);
});

/** The bird base's layers as a step reads them: captured with its layers spread, or not. */
function birdBase(spread: boolean): PictureLayers {
  if (!scene) throw new Error('the kernel folded nothing');
  const read: FoldedPicture = { snapshot: null as unknown as FoldedPicture['snapshot'], scene };
  const captured = flatPicture(read, 0, undefined, spread ? SPREAD : undefined);
  if (captured.kind !== 'picture' || captured.picture.kind !== 'scene') throw new Error('no scene');
  const render: DiagramCpRender = {
    mode: 'folded-flat',
    side: 'back',
    rotationDeg: 0,
    foldCase: 1,
    ...(spread ? { spread: SPREAD } : {}),
  };
  const layers = pictureGeometry(cpStep('step-1', render, captured.picture as DiagramScenePicture), {}).layers;
  if (!layers) throw new Error('a flat fold with no layers');
  return layers;
}

const middle = ({ ring }: PictureCover): PicturePoint => [
  ring.reduce((sum, [x]) => sum + x, 0) / ring.length,
  ring.reduce((sum, [, y]) => sum + y, 0) / ring.length,
];

/** The middle of the last face painted that lies over another: under a flap. */
function underAFlap(layers: PictureLayers): { flap: PictureCover; start: PicturePoint } {
  const flap = [...layers.covers].reverse().find((cover) => facesAt(layers, middle(cover)).length >= 2)!;
  return { flap, start: middle(flap) };
}

describe('a mark behind the bird base’s flaps', () => {
  it('comes out where the flap over its end, and every face over that, end', () => {
    const layers = birdBase(true);
    // Its layers, every one: the bird base is seven or eight deep at a face's middle.
    expect(Math.max(...layers.covers.map((cover) => facesAt(layers, middle(cover)).length))).toBeGreaterThanOrEqual(7);
    const { flap, start } = underAFlap(layers);
    expect(facesAt(layers, start)[0]).toBe(flap);
    // Out to the right, well past the paper.
    const out: PicturePoint = [start[0] + 3, start[1]];
    const [[from, to]] = hiddenStretches([start, out], { from: 1 }, layers) as [readonly [number, number]];
    expect(from).toBe(0);
    expect(to).toBeGreaterThan(0);
    expect(to).toBeLessThan(1);
    const over = facesOverEnd(layers, start, out, 1);
    expect(over).toContain(flap);
    const at = (share: number): PicturePoint => [start[0] + (out[0] - start[0]) * share, start[1]];
    const underOver = (point: PicturePoint) => facesAt(layers, point).some((face) => over.includes(face));
    // Under them just before it comes out; under none of them just after.
    expect(underOver(at(to - 1e-4))).toBe(true);
    expect(underOver(at(to + 1e-4))).toBe(false);
  });

  it('knows only the faces that show on a fold captured without a spread: under the top one, to the paper’s edge', () => {
    // Its covered faces culled and not stored: from the back, one face shows, the whole of it.
    const layers = birdBase(false);
    expect(layers.covers).toHaveLength(1);
    const start = middle(layers.covers[0]!);
    const out: PicturePoint = [start[0] + 3, start[1]];
    const [[, to]] = hiddenStretches([start, out], { from: 1 }, layers) as [readonly [number, number]];
    const at = (share: number): PicturePoint => [start[0] + (out[0] - start[0]) * share, start[1]];
    expect(facesAt(layers, at(to - 1e-4))).toHaveLength(1);
    expect(facesAt(layers, at(to + 1e-4))).toEqual([]);
  });

  it('goes on further under every layer at its end than under the flap alone', () => {
    const layers = birdBase(true);
    const { start } = underAFlap(layers);
    const out: PicturePoint = [start[0] + 3, start[1]];
    const deepest = facesAt(layers, start).length;
    const [[, to]] = hiddenStretches([start, out], { from: deepest }, layers) as [readonly [number, number]];
    const [[, flapOnly]] = hiddenStretches([start, out], { from: 1 }, layers) as [readonly [number, number]];
    expect(to).toBeGreaterThanOrEqual(flapOnly);
    // Out past where it comes out: under none of the faces over its end.
    const over = facesOverEnd(layers, start, out, deepest);
    expect(over.length).toBeGreaterThanOrEqual(deepest);
    const at = (share: number): PicturePoint => [start[0] + (out[0] - start[0]) * share, start[1]];
    expect(facesAt(layers, at(to + 1e-4)).some((face) => over.includes(face))).toBe(false);
  });
});
