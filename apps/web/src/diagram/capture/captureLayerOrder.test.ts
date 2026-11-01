import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import {
  fakeCaptureRuntime,
  fakeFoldSource,
  fakeLayerOrderResolutions,
  halfFoldOnSheetKernelScene,
  ORDERED_HANDLE,
  STEP_LAYER_ORDER,
  STEP_LAYER_ORDER_IN_SOURCE,
  stepLayerOrderJson,
} from './capture.fixtures';
import {
  diagramLayerOrderFrame,
  foldAppliedOrder,
  foldWithLayerOrder,
  layerOrderDigestOf,
  layerOrderKeyOf,
  layerOrderSummaryOf,
  routed3dLayerOrder,
  stepFoldSource,
  stepLayerOrderOf,
  type CaptureLayerOrderResolve,
} from './captureLayerOrder';
import { flatPaperFaces } from './capturePaperFaces';
import { linkedFoldKey } from './poseController';

const model = DEFAULT_FOLDED_MODEL;
const layerOrder = stepLayerOrderOf(stepLayerOrderJson())!;

/** The record as the engine takes it: about the crease pattern's origin, the step's frame centred on (50, 50). */
const inSource = STEP_LAYER_ORDER_IN_SOURCE;

describe('a step’s layer order record', () => {
  it('reads what its source keeps, and reads a step with none, or one that does not read, as none', () => {
    expect(layerOrder.record).toEqual(STEP_LAYER_ORDER);
    expect(layerOrder.json).toBe(stepLayerOrderJson());
    expect(stepLayerOrderOf(undefined)).toBeNull();
    expect(stepLayerOrderOf('{"v":1,')).toBeNull();
    // A newer build's locks its step, which is never captured: none here either.
    expect(stepLayerOrderOf('{"v":2,"faces":[],"constraints":[],"order":[]}')).toBeNull();
  });

  it('waits for 3D creases with every constraint, once (D13)', () => {
    const waiting = routed3dLayerOrder(layerOrder);
    expect(waiting.record.attention).toEqual({ reason: 'route-3d', count: 1 });
    expect(routed3dLayerOrder(waiting)).toBe(waiting);
    // The record itself is kept as it was.
    expect({ ...waiting.record, attention: undefined }).toEqual({ ...STEP_LAYER_ORDER, attention: undefined });
  });

  it('is kept in the frame its faces on the paper are kept in: about the centre of the paper’s box', () => {
    const scene = halfFoldOnSheetKernelScene();
    const frame = diagramLayerOrderFrame(scene);
    const faces = flatPaperFaces(scene, ({ x, y }) => [x, y], 1)!;
    // The sheet's first corner, as the step's faces keep it and as its record would.
    expect(frame.fromSource(scene.sheet_points[0]!)).toEqual([faces.points[0]![0], faces.points[0]![1]]);
    expect(frame.toSource([0, 0])).toEqual({ x: 50, y: 50 });
  });
});

describe('a record read at rest and keyed', () => {
  const json = stepLayerOrderJson();
  const flagged = stepLayerOrderJson({ ...STEP_LAYER_ORDER, attention: { reason: 'conflict', count: 1 } });

  it('reads a source’s summary once, and again for another source', () => {
    const source = { layerOrder: json };
    const summary = layerOrderSummaryOf(source);
    expect(summary).toEqual({ constraints: 1, attention: null });
    expect(layerOrderSummaryOf(source)).toBe(summary);
    expect(layerOrderSummaryOf({ layerOrder: flagged })).toEqual({ constraints: 1, attention: { reason: 'conflict', count: 1 } });
    expect(layerOrderSummaryOf({})).toBeNull();
    expect(layerOrderSummaryOf(null)).toBeNull();
    expect(layerOrderSummaryOf({ layerOrder: '{"v":1,' })).toBeNull();
  });

  it('keys the order a record draws, not what it says of it', () => {
    expect(layerOrderKeyOf({ layerOrder: json })).toBe(layerOrderKeyOf({ layerOrder: flagged }));
    const other = stepLayerOrderJson({ ...STEP_LAYER_ORDER, order: [[0, 1, -1]] });
    expect(layerOrderKeyOf({ layerOrder: other })).not.toBe(layerOrderKeyOf({ layerOrder: json }));
    expect(layerOrderKeyOf({})).toBeNull();
    // One that does not read is its text: only the same text is the same order.
    expect(layerOrderKeyOf({ layerOrder: '{"v":1,' })).toBe(layerOrderKeyOf({ layerOrder: '{"v":1,' }));
    expect(layerOrderKeyOf({ layerOrder: '{"v":1,' })).not.toBe(layerOrderKeyOf({ layerOrder: '{"v":1, ' }));
  });

  it('digests a record’s text into a short key, the same for the same text, another for any change', () => {
    const faces = Array.from({ length: 4000 }, (_, k) => ({ at: [k, k + 0.5] as const, area: 1 + k }));
    const large = stepLayerOrderJson({ faces, constraints: [[0, 1, 1]], order: [] });
    expect(large.length).toBeGreaterThan(100_000);
    const digest = layerOrderDigestOf(large);
    expect(digest.length).toBeLessThan(24);
    expect(layerOrderDigestOf(`${large}`)).toBe(digest);
    expect(layerOrderDigestOf(json)).not.toBe(layerOrderDigestOf(flagged));
    // A step's fold key stays as short, however large its record.
    const key = linkedFoldKey('step-1', { scope: { kind: 'all' } as never, fingerprint: 'rc1:0', layerOrder: large });
    expect(key.length).toBeLessThan(100);
    expect(linkedFoldKey('step-1', { scope: { kind: 'all' } as never, fingerprint: 'rc1:0' })).not.toBe(key);
  });
});

describe('stepFoldSource', () => {
  it('folds the creases as a capture does, reads what the fold was made from and frees it', async () => {
    const runtime = fakeCaptureRuntime();
    const folded = await stepFoldSource(runtime, [1, 3, 5, 7, 8], model);
    expect(runtime.fold).toHaveBeenCalledWith(1, 'Order5', model, [1, 3, 5, 7, 8]);
    expect(runtime.source).toHaveBeenCalledWith(7);
    expect(runtime.free).toHaveBeenCalledWith(7);
    expect(folded.source).toEqual({
      segments: fakeFoldSource().segments,
      startingFaceId: 1,
      auxSegments: [],
      model,
      digest: 'fixture-digest',
    });
    // The fixture's scene names no sheet point: the frame is the box of the creases folded.
    expect(folded.frame.toSource([0, 0])).toEqual({ x: 50, y: 50 });
  });

  it('steps to the case the step shows before it reads the paper, and never at the first', async () => {
    const runtime = fakeCaptureRuntime();
    await stepFoldSource(runtime, [1], model, 2);
    expect(runtime.foldToCase).toHaveBeenCalledWith(7, 2);
    const order = (spy: unknown) => (spy as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]!;
    expect(order(runtime.foldToCase)).toBeLessThan(order(runtime.paperScene));
    const first = fakeCaptureRuntime();
    await stepFoldSource(first, [1], model, 1);
    expect(first.foldToCase).not.toHaveBeenCalled();
  });

  it('frees the fold when reading its source fails', async () => {
    const runtime = fakeCaptureRuntime({ source: vi.fn(async () => Promise.reject(new Error('gone'))) });
    await expect(stepFoldSource(runtime, [1], model)).rejects.toThrow('gone');
    expect(runtime.free).toHaveBeenCalledWith(7);
  });
});

describe('foldWithLayerOrder', () => {
  const resolving = (answer: (source: LayerOrderSource) => ReturnType<CaptureLayerOrderResolve>) =>
    vi.fn<CaptureLayerOrderResolve>(async (source) => answer(source));

  it('restores the record in the crease pattern’s coordinates, then folds its relations into a new figure', async () => {
    const runtime = fakeCaptureRuntime();
    const resolve = resolving((source) => Promise.resolve(fakeLayerOrderResolutions.applied(inSource, source)));
    const stop = new AbortController().signal;
    const shown = await foldWithLayerOrder(runtime, [1, 3, 5, 7, 8], model, layerOrder, resolve, stop);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ digest: 'fixture-digest' }), inSource, stop);
    expect(runtime.foldWithOrder).toHaveBeenCalledWith(fakeFoldSource(), new Uint32Array([1, 0]), model);
    expect(shown.kind).toBe('shown');
    if (shown.kind !== 'shown') return;
    expect(shown.state.handle).toBe(ORDERED_HANDLE);
    // The engine's save of the order shown, back in the step's frame.
    expect(shown.layerOrder.record.faces.map((face) => face.at)).toEqual([
      [-24, 25],
      [26, -25],
    ]);
    expect(shown.attention).toBeNull();
    // The first fold is freed; the new one is the caller's.
    expect(runtime.free).toHaveBeenCalledWith(7);
    expect(runtime.free).not.toHaveBeenCalledWith(ORDERED_HANDLE);
  });

  it('carries what an edit left out as the summary the step shows at rest', async () => {
    const attention = { reason: 'unresolved' as const, count: 1 };
    const shown = await foldWithLayerOrder(
      fakeCaptureRuntime(),
      [1],
      model,
      layerOrder,
      resolving((source) => Promise.resolve(fakeLayerOrderResolutions.applied(inSource, source, attention)))
    );
    expect(shown).toMatchObject({ kind: 'shown', attention });
    if (shown.kind === 'shown') expect(shown.layerOrder.record.attention).toEqual(attention);
  });

  it.each(['clash', 'timed_out', 'refused'] as const)(
    'on %s keeps the step’s record as it was, its points untouched, flagged; folds nothing more (D10)',
    async (outcome) => {
      const runtime = fakeCaptureRuntime();
      const shown = await foldWithLayerOrder(
        runtime,
        [1],
        model,
        layerOrder,
        resolving(() => Promise.resolve(fakeLayerOrderResolutions.kept(outcome, inSource)))
      );
      expect(shown.kind).toBe('kept');
      if (shown.kind !== 'kept') return;
      expect(shown.outcome).toBe(outcome);
      expect(shown.layerOrder.record.faces).toEqual(STEP_LAYER_ORDER.faces);
      expect(shown.layerOrder.record.attention).toEqual(shown.attention);
      expect(runtime.foldWithOrder).not.toHaveBeenCalled();
    }
  );

  it.each(['load', 'crashed', 'unavailable'] as const)(
    'with no host engine (%s) keeps nothing: no flag to store, nothing folded, the cause to say',
    async (cause) => {
      const runtime = fakeCaptureRuntime();
      const shown = await foldWithLayerOrder(
        runtime,
        [1],
        model,
        layerOrder,
        resolving(() => Promise.resolve(fakeLayerOrderResolutions.lost(inSource, cause)))
      );
      expect(shown).toEqual({ kind: 'lost', cause });
      expect(runtime.foldWithOrder).not.toHaveBeenCalled();
    }
  );

  it('answers a Stop with nothing to keep', async () => {
    const runtime = fakeCaptureRuntime();
    const shown = await foldWithLayerOrder(runtime, [1], model, layerOrder, resolving(() => Promise.resolve({ outcome: 'cancelled' })));
    expect(shown).toEqual({ kind: 'cancelled' });
    expect(runtime.foldWithOrder).not.toHaveBeenCalled();
  });

  it('keeps the step’s picture when the kernel cannot draw the order, every constraint flagged', async () => {
    const runtime = fakeCaptureRuntime({
      foldWithOrder: vi.fn(async () => ({ status: 'refused' as const, refusal: { code: 'not_found' as const } })),
    });
    const shown = await foldWithLayerOrder(
      runtime,
      [1],
      model,
      layerOrder,
      resolving((source) => Promise.resolve(fakeLayerOrderResolutions.applied(inSource, source)))
    );
    expect(shown).toMatchObject({ kind: 'kept', outcome: 'refused', attention: { reason: 'unresolved', count: 1 } });
    if (shown.kind === 'kept') expect(shown.layerOrder.record.faces).toEqual(STEP_LAYER_ORDER.faces);
  });
});

describe('foldAppliedOrder', () => {
  it('folds what the dialog analysed, as it is, and saves its record in the step’s frame with no summary', async () => {
    const runtime = fakeCaptureRuntime();
    const source: LayerOrderSource = { segments: [], startingFaceId: 1, auxSegments: [], model, digest: 'd' };
    const frame = diagramLayerOrderFrame({ sheet_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });
    const shown = await foldAppliedOrder(runtime, { record: inSource, relations: new Uint32Array([0, 1]), source }, model, frame);
    expect(runtime.fold).not.toHaveBeenCalled();
    expect(runtime.foldWithOrder).toHaveBeenCalledWith({ segments: [], starting_face_id: 1, aux_segments: [], digest: 'd' }, new Uint32Array([0, 1]), model);
    expect(shown).toMatchObject({ kind: 'shown', attention: null });
    if (shown.kind === 'shown') expect(shown.layerOrder.record).toEqual(STEP_LAYER_ORDER);
  });

  it('encodes the record before it folds: one it cannot save leaves no figure behind', async () => {
    const runtime = fakeCaptureRuntime();
    const source: LayerOrderSource = { segments: [], startingFaceId: 1, auxSegments: [], model, digest: 'd' };
    const frame = diagramLayerOrderFrame({ sheet_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });
    const unsaveable = { ...inSource, faces: [{ at: [Number.NaN, 0] as const, area: 1 }, ...inSource.faces.slice(1)] };
    await expect(
      foldAppliedOrder(runtime, { record: unsaveable, relations: new Uint32Array([0, 1]), source }, model, frame)
    ).rejects.toThrow('cannot be saved');
    expect(runtime.foldWithOrder).not.toHaveBeenCalled();
  });
});
