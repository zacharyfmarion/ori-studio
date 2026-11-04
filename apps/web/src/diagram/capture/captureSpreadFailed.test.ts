// @vitest-environment jsdom
/**
 * A step asked spread by Default whose layers can't be spread — the solve
 * over a resource limit, out of time, or its clip failing — is never refused
 * its picture: the fold is drawn unspread and marked so, its spread kept, so
 * the step can say it failed and offer another kind; the next capture solves
 * again. Over the real solve (`oristudio-layer-spread-wasm`), made to fail on
 * demand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { DEFAULT_FOLDED_3D_CAMERA } from '../../cp-workspace/folded/folded3dCamera';
import { DEFAULT_CONNECTED_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { DEFAULT_DIAGRAM_STYLE, DEFAULT_LAYER_SPREAD, type DiagramCpRender } from '../document/diagramDocument';
import { cpDocument, fakeCaptureRuntime, twoSquaresIndex } from './capture.fixtures';
import { chooseStepCreases } from './captureCreases';
import { captureStep, capturedSpreadFailed, type CaptureStepRequest, type CapturedPicture } from './captureFolded';
import { createCaptureSession, type CaptureSessionDeps } from './captureSession';
import { poseLinkedStep, type LinkedPoseRequest } from './linkedPose';

const spread = vi.hoisted(() => ({ solveFails: null as Error | null, clipFails: false, solves: 0, released: 0 }));
vi.mock('../../layer-spread/prepareConnected', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { initSync, solve_layer_spread } = await import(
    '../../generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm'
  );
  const { connectedSpreadSource } = await import('../../cp-workspace/folded/connectedSpreadSource');
  initSync({
    module: readFileSync(resolve('src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm_bg.wasm')),
  });
  return {
    prepareConnected: (scene: Parameters<typeof connectedSpreadSource>[0], yUp = false) => {
      spread.solves += 1;
      const release = () => {
        spread.released += 1;
      };
      if (spread.solveFails) {
        const promise = Promise.reject(spread.solveFails);
        void promise.catch(() => {});
        return { promise, release };
      }
      const source = connectedSpreadSource(scene, yUp);
      return { promise: Promise.resolve({ source, solution: solve_layer_spread(source.input) }), release };
    },
  };
});
vi.mock('../../layer-spread/captureConnected', async () => {
  const { connectedPaperScene } = await import('../../layer-spread/connectedScene');
  return {
    captureConnected: async (scene: import('../../layer-spread/connectedScene').ConnectedPaperScene) => {
      if (spread.clipFails) throw new Error('Spread capture worker failed');
      return connectedPaperScene(scene.connected, scene.sheet, true);
    },
  };
});

afterEach(() => {
  spread.solveFails = null;
  spread.clipFails = false;
  spread.solves = 0;
  spread.released = 0;
});

const LIMIT = new Error('Spread resource limit exceeded: overlap regions');

const sheets = twoSquaresIndex();
const [left] = sheetRegions(sheets);
const scope = { kind: 'segment', region: regionReferenceFor(left!) } as const;

const FLAT: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 30, foldCase: 1 };
const SPREAD_FLAT: DiagramCpRender = {
  ...FLAT,
  spread: DEFAULT_CONNECTED_SPREAD,
  presentation: { kind: 'perspective', camera: DEFAULT_FOLDED_3D_CAMERA, orderSide: 'front' },
};

function request(render: DiagramCpRender): CaptureStepRequest {
  return { document: cpDocument(), sheets, scope, render, style: DEFAULT_DIAGRAM_STYLE };
}

function keyOf(captured: CapturedPicture): string {
  if (captured.kind !== 'picture') throw new Error('expected a picture');
  return captured.picture.key;
}

describe('a step captured with a Default spread its layers can’t take', () => {
  it('keeps its spread, drops its presentation, and is drawn as the unspread fold, marked so', async () => {
    spread.solveFails = LIMIT;
    const result = await captureStep(fakeCaptureRuntime(), request(SPREAD_FLAT));
    if (result.status !== 'captured') throw new Error(`not captured: ${result.status}`);
    expect(capturedSpreadFailed(result.captured)).toBe(true);
    expect(result.source.render).toEqual({ ...FLAT, spread: DEFAULT_CONNECTED_SPREAD });
    // The lease is let go, as a solved one is.
    expect(spread.released).toBe(spread.solves);
    const plain = await captureStep(fakeCaptureRuntime(), request(FLAT));
    if (plain.status !== 'captured') throw new Error('not captured');
    expect(capturedSpreadFailed(plain.captured)).toBe(false);
    expect(keyOf(result.captured)).toBe(keyOf(plain.captured));
  });

  it('is marked so when the solve lands but its clip fails', async () => {
    spread.clipFails = true;
    const result = await captureStep(fakeCaptureRuntime(), request(SPREAD_FLAT));
    if (result.status !== 'captured') throw new Error(`not captured: ${result.status}`);
    expect(capturedSpreadFailed(result.captured)).toBe(true);
    expect(result.source.render).toEqual({ ...FLAT, spread: DEFAULT_CONNECTED_SPREAD });
  });

  it('keeps a spread it can take, unmarked, as it always did', async () => {
    const result = await captureStep(fakeCaptureRuntime(), request({ ...FLAT, spread: DEFAULT_CONNECTED_SPREAD }));
    if (result.status !== 'captured') throw new Error(`not captured: ${result.status}`);
    expect(capturedSpreadFailed(result.captured)).toBe(false);
    expect(result.source.render).toEqual({ ...FLAT, spread: DEFAULT_CONNECTED_SPREAD });
  });
});

describe('a step posed with a Default spread its layers can’t take', () => {
  function session() {
    const runtime = fakeCaptureRuntime();
    const deps: CaptureSessionDeps = {
      search: (work) => work(runtime),
      runtime: () => runtime,
      retain: () => {},
      release: () => {},
      epoch: () => 0,
    };
    return createCaptureSession(deps);
  }
  const document = cpDocument();
  const choice = chooseStepCreases(document, scope, sheets);
  if (choice.status !== 'found') throw new Error('the left region should be found');
  const pose = (held: ReturnType<typeof session>, render: DiagramCpRender, verb: LinkedPoseRequest) =>
    poseLinkedStep(held, { document, creases: choice.creases, render, style: DEFAULT_DIAGRAM_STYLE }, verb);
  const failed = (posed: Awaited<ReturnType<typeof pose>>) => posed.status === 'posed' && capturedSpreadFailed(posed.picture);

  it('is folded unspread, its Default spread kept, and solved again by the next pose', async () => {
    const held = session();
    spread.solveFails = LIMIT;
    // Shown folded for the first time: a new flat pose starts spread by Default (13g).
    const folded = await pose(held, { mode: 'crease-pattern', rotationDeg: 0 }, { verb: 'show-folded' });
    if (folded.status !== 'posed') throw new Error(`not posed: ${folded.status}`);
    expect(failed(folded)).toBe(true);
    expect(folded.render).toEqual({ mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1, spread: DEFAULT_LAYER_SPREAD });

    // The failed solve is not kept: the next pose of the same held fold solves again.
    spread.solveFails = null;
    const solvesBefore = spread.solves;
    const turned = await pose(held, folded.render, { verb: 'rotate-right' });
    expect(spread.solves).toBe(solvesBefore + 1);
    expect(failed(turned)).toBe(false);
    expect(turned).toMatchObject({ status: 'posed', render: { spread: DEFAULT_LAYER_SPREAD } });
  });

  it('takes another kind, which needs no solve, from a spread its layers couldn’t take', async () => {
    const held = session();
    spread.solveFails = LIMIT;
    const folded = await pose(held, { mode: 'crease-pattern', rotationDeg: 0 }, { verb: 'show-folded' });
    if (folded.status !== 'posed') throw new Error(`not posed: ${folded.status}`);
    const solvesBefore = spread.solves;
    const affine = await pose(held, folded.render, { verb: 'spread-kind', kind: 'affine' });
    expect(spread.solves).toBe(solvesBefore);
    expect(failed(affine)).toBe(false);
    expect(affine).toMatchObject({ status: 'posed', render: { spread: { kind: 'affine' } } });
  });

  it('switches a spread that works to Default, kept, when its layers can’t take it', async () => {
    const held = session();
    spread.solveFails = LIMIT;
    const affine: DiagramCpRender = {
      mode: 'folded-flat',
      side: 'front',
      rotationDeg: 0,
      foldCase: 1,
      spread: { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 },
    };
    const switched = await pose(held, affine, { verb: 'spread-kind', kind: 'connected' });
    expect(failed(switched)).toBe(true);
    expect(switched).toMatchObject({ status: 'posed', render: { spread: DEFAULT_CONNECTED_SPREAD } });
  });

  it('turns Spread layers on, kept on, when its layers still can’t be spread', async () => {
    const held = session();
    spread.solveFails = LIMIT;
    const unspread: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };
    const on = await pose(held, unspread, { verb: 'spread-layers' });
    expect(failed(on)).toBe(true);
    expect(on).toMatchObject({ status: 'posed', render: { ...unspread, spread: DEFAULT_LAYER_SPREAD } });
  });
});
