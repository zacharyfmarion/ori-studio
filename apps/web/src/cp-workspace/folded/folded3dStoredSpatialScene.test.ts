import { expect, it, vi } from 'vitest';
import type { PaperScene } from '@treemaker/origami-simulator';
import type { OristudioCpFolded3dRenderModel } from '../../engine/oristudioCpTypes';
import fixture from '../../../../../tests/fixtures/fold-angle-3d/spread-strip.render.json';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import {
  FOLDED_3D_LOCAL_CENTER,
  folded3dLocalFrameSide,
} from '../adapters/cpFoldedToScene';
import { folded3dFrameRadius } from './folded3dCamera';
import { folded3dMesh } from './folded3dMesh';
import {
  folded3dFigureScene,
  folded3dStoredSceneInCssPx,
  settledFolded3dFigureScene,
  type Folded3dSceneFigure,
} from './folded3dStoredScene';

const mock = vi.hoisted(() => ({
  capture: vi.fn(),
  posed: vi.fn(),
  ensure: vi.fn(),
}));
vi.mock('../../layer-spread/spatialCapture', () => ({
  captureSpatialScene: mock.capture,
}));
vi.mock('./folded3dSpread', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./folded3dSpread')>()),
  ensureSpatialSpread: mock.ensure,
  posedSpatialMesh: mock.posed,
}));

it('positions a generated raster with its bounds, caches the settled result and scales both for export', async () => {
  const model = structuredClone(fixture) as OristudioCpFolded3dRenderModel;
  const built = folded3dMesh(model);
  if (built.kind !== 'mesh') throw new Error('fixture mesh');
  mock.posed.mockReturnValue(built.mesh);
  const raster: PaperScene = {
    sheet: 10,
    bounds: { minX: 1, minY: 2, maxX: 31, maxY: 22 },
    items: [
      {
        kind: 'markup',
        hidden: false,
        bounds: { minX: 1, minY: 2, maxX: 31, maxY: 22 },
        svg: '<image x="1" y="2" width="30" height="20" href="data:image/png;base64,AAAA"/>',
      },
    ],
  };
  mock.capture.mockResolvedValue(raster);
  const figure = {
    displayStyle: 'Paper5',
    spread: { kind: 'spatial', version: 1, amount: 2 },
    folded3d: { verdict: { verdict: 'folded' } },
  } as Folded3dSceneFigure;
  const options = { style: DEFAULT_PAPER_STYLE, space: 'document' as const };
  expect(folded3dFigureScene(figure, model, options)).toBeNull();
  const scene = (await settledFolded3dFigureScene(figure, model, options))!;
  const half = folded3dLocalFrameSide(folded3dFrameRadius(model)) / 2;
  const dx = FOLDED_3D_LOCAL_CENTER.x - half,
    dy = FOLDED_3D_LOCAL_CENTER.y - half;
  expect(scene.bounds.minX).toBe(1 + dx);
  expect(scene.bounds.minY).toBe(2 + dy);
  expect(scene.items[0]).toMatchObject({
    svg: `<g transform="translate(${dx} ${dy})">${raster.items[0]!.kind === 'markup' ? raster.items[0]!.svg : ''}</g>`,
  });
  expect(folded3dFigureScene(figure, model, options)).toBe(scene);
  const scaled = folded3dStoredSceneInCssPx(
    scene,
    { offset: { x: 0, y: 0 }, rotation: 0, scale: 2 },
    1
  );
  expect(scaled.bounds.minX).toBe(2 * scene.bounds.minX);
  expect(scaled.items[0]).toMatchObject({
    svg: expect.stringContaining('<g transform="scale(2)">'),
  });
});

it('refuses a positive spread when a refold no longer has a determined, closed source', async () => {
  const figure = {
    displayStyle: 'Paper5',
    spread: { kind: 'spatial', version: 1, amount: 1 },
    folded3d: { verdict: { verdict: 'local_crossing', vertices: 1 } },
  } as Folded3dSceneFigure;
  await expect(
    settledFolded3dFigureScene(
      figure,
      fixture as OristudioCpFolded3dRenderModel,
      { style: DEFAULT_PAPER_STYLE, space: 'document' }
    )
  ).rejects.toThrow('determined, closed fold');
});
