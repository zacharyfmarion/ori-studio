import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldedDisplayLayers } from '../../cp-workspace/folded/foldedDisplayLayers';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { DEFAULT_DEPTH_SPREAD, DEFAULT_LAYER_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { createFoldEngineCalls, type FoldEngineCalls } from '../../fold/engine/foldEngineCalls';
import { precreasedBaseStates } from '../../fold/engine/foldPrecreasedBase.fixtures';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { flatScenePicture, type CapturedPicture } from '../capture/captureFolded';
import type { DiagramPaperFaces } from '../document/diagramDocument';
import { storedScene } from '../pictures/pictureFrame';
import { foldScenePattern } from './foldStepPicture';

/**
 * A Fold step sent to the Diagram with a spread pose draws through the same
 * shared painter as the pane, so a precrease must leave its picture as the
 * step before drew it too (the open sink report, 2026-10-11): the preliminary
 * base and the base precreased across every layer, folded by the real engine
 * in-process, each picture read for the side of the paper on top at every
 * point. Skipped when the bridge has not been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

async function engine(): Promise<FoldEngineCalls> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return createFoldEngineCalls(new wasm.FoldEngine());
}

function picture(captured: CapturedPicture): { scene: PaperScene; faces: DiagramPaperFaces } {
  if (captured.kind !== 'picture' || captured.picture.kind !== 'scene') throw new Error('a scene picture');
  return { scene: storedScene(captured.picture)!, faces: JSON.parse(captured.picture.paperFaces!) as DiagramPaperFaces };
}

/** The side of the face drawn last over a point: what the reader sees there. */
function sideAt(scene: PaperScene, [x, y]: ScenePoint): string | null {
  for (let i = scene.items.length - 1; i >= 0; i -= 1) {
    const item = scene.items[i]!;
    if (item.kind !== 'face') continue;
    const ring = item.rings[0]!;
    let inside = false;
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k, k += 1) {
      const [ax, ay] = ring[k]!;
      const [bx, by] = ring[j]!;
      if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside;
    }
    if (inside) return item.side;
  }
  return null;
}

describe.skipIf(!available)('a precreased Fold step in the Diagram', () => {
  it.each([
    ['front', 'the default affine spread', DEFAULT_LAYER_SPREAD],
    ['back', 'the default affine spread', DEFAULT_LAYER_SPREAD],
    ['front', 'a wide affine spread', { ...DEFAULT_LAYER_SPREAD, amount: 0.2 } as LayerSpreadOptions],
    ['back', 'a wide affine spread', { ...DEFAULT_LAYER_SPREAD, amount: 0.2 } as LayerSpreadOptions],
    ['front', 'the default depth spread', DEFAULT_DEPTH_SPREAD],
    ['front', 'a wide depth spread', { kind: 'depth', amount: 0.2, toward: 'up-right' } as LayerSpreadOptions],
  ] as const)('draws the %s with %s as the step before it, side for side', async (side, _label, spread) => {
    const calls = await engine();
    const states = precreasedBaseStates(calls);
    const [before, after] = [5, 6].map(
      (step) => picture(flatScenePicture(foldScenePattern(calls.scene(states[step]!), side), 0, spread)).scene
    ) as [PaperScene, PaperScene];
    const { minX, minY, maxX, maxY } = before.bounds;
    const [width, height] = [maxX - minX, maxY - minY];
    let paper = 0;
    const differs: ScenePoint[] = [];
    for (let i = 0; i <= 80; i += 1) {
      for (let j = 0; j <= 60; j += 1) {
        const at: ScenePoint = [minX - 0.05 * width + (i * 1.1 * width) / 80 + 0.0123, minY - 0.05 * height + (j * 1.1 * height) / 60 + 0.0171];
        const seen = sideAt(before, at);
        if (seen !== null) paper += 1;
        if (sideAt(after, at) !== seen) differs.push(at);
      }
    }
    expect(paper).toBeGreaterThan(1000);
    expect(differs).toEqual([]);
  });

  it('ranks the two faces of each precreased layer alike, as the layer was ranked before', async () => {
    const calls = await engine();
    const states = precreasedBaseStates(calls);
    const scenes = [calls.scene(states[5]!), calls.scene(states[6]!)];
    const [before, after] = scenes.map(
      (scene) => picture(flatScenePicture(foldScenePattern(scene, 'front'), 0, DEFAULT_LAYER_SPREAD)).faces.levels
    ) as [number[], number[]];
    const { layers } = foldedDisplayLayers(scenes[1]!);
    for (const faces of layers) expect(new Set(faces.map((face) => after[face]))).toHaveProperty('size', 1);
    expect(layers.map((faces) => after[faces[0]!]).sort()).toEqual([...before].sort());
  });
});
