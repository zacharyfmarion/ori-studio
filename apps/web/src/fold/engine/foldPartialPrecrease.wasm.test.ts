import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFoldReplayer } from '../document/foldReplay';
import type { FoldOp, FoldPaper, FoldPrecreaseExtent, FoldPrecreaseOp } from '../document/foldSequenceDocument';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEnginePort, type FoldEngineSource } from './foldEnginePort';
import { FOLD_REFUSAL_CODES, type FoldEngineOutcome, type FoldEngineRefused } from './foldEngineWire';

/**
 * Partial precreases over the real bridge, in-process: a precrease with an
 * `extent` written and read by the document, crossing the wasm boundary as
 * the Rust wire types expect, replayed by the document's replayer, and its
 * crease marks coming back in every shape `foldEngineWire.ts` declares.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

const SQUARE: FoldPaper = { shape: { kind: 'square' }, startSide: 'front' };

/** A precrease along x = 0.5, the right side moving, of `extent` of the line. */
function precrease(extent?: FoldPrecreaseExtent): FoldPrecreaseOp {
  return {
    kind: 'precrease',
    line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
    direction: 'valley',
    moving: [0.9, 0.5],
    seed: { scope: 'all' },
    ...(extent ? { extent } : {}),
  };
}

const pinchAt = (at: readonly [number, number], length = 1 / 16): FoldPrecreaseExtent => ({
  kind: 'pinch',
  at: { kind: 'point', at },
  length,
});

async function engine(): Promise<{ calls: FoldEngineCalls; version: number }> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return { calls: createFoldEngineCalls(new wasm.FoldEngine()), version: wasm.fold_engine_version() };
}

function sourceOf(calls: FoldEngineCalls): FoldEngineSource {
  return {
    generation: () => 0,
    sheet: async (paper) => calls.sheet(paper),
    step: async (state, op, choices) => calls.step(state, op, choices),
    release: async (states) => calls.release(states),
  };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

function refused<T>(outcome: FoldEngineOutcome<T>): FoldEngineRefused {
  if (outcome.status !== 'refused') throw new Error('landed');
  return outcome;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('did not throw');
}

describe.skipIf(!available)('partial precreases over the real bridge', () => {
  it('reverses an existing segment, then folds it as M or V and replays the saved document', async () => {
    const { calls, version } = await engine();
    for (const kind of ['mountain', 'valley'] as const) {
      const reverse: FoldPrecreaseOp = {
        ...precrease(pinchAt([0.5, 0.5], 0.6)), direction: 'mountain',
        line: { via: 'crease', at: [0.5, 0.4] },
      };
      const refold: FoldOp = { kind, line: { via: 'crease', at: [0.5, 0.4] }, moving: [0.9, 0.5], seed: { scope: 'all' } };
      const ops: FoldOp[] = [precrease(), reverse, refold];
      let state = landed(calls.sheet(SQUARE)).state;
      const nodes = ops.map((op, i) => {
        const result = landed(calls.step(state, op));
        state = result.state;
        if (i === 1) {
          expect(result.summary.faces).toBe(2);
          expect(result.summary.crease_marks).toBeUndefined();
          expect(landed(calls.stepSummary(state)).summary?.diff.reversed).toHaveLength(1);
        }
        if (i === 2) {
          expect(result.report?.created).toEqual([]);
          expect(result.report?.refolded).toHaveLength(3);
          expect(result.report?.refolded.every(r => r.letter === kind)).toBe(true);
        }
        return step(`fstep-${i + 1}`, i ? `fstep-${i}` : null, op, { expect: result.fingerprint });
      });
      const document = sequenceOf(nodes);
      const held = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence({ document, readOnlyRaw: null }))))!;
      const replay = await createFoldReplayer(createFoldEnginePort(sourceOf(calls), version)).run({ loadId: 1, sequence: held.document });
      expect([...replay!.steps.values()].every(s => s.status === 'ok')).toBe(true);
      expect(replay?.steps.get('fstep-3')?.fingerprint).toBe(nodes[2].expect);
    }
  });

  it('accepts the exact Witch Hat source-7 request without moving its material', async () => {
    const { calls } = await engine();
    const fixture = JSON.parse(readFileSync(resolve(ROOT, '../../tests/fixtures/fold-examples/witch-hat-existing-precrease.json'), 'utf8'));
    let state = landed(calls.sheet(fixture.paper)).state;
    for (const node of fixture.steps) state = landed(calls.step(state, node.op, node.choices)).state;
    const before = calls.scene(state);
    const after = landed(calls.step(state, fixture.op));
    const scene = calls.scene(after.state);
    expect(scene.faces).toEqual(before.faces);
    expect(scene.face_transforms).toEqual(before.face_transforms);
    expect(scene.subfaces).toEqual(before.subfaces);
    expect(scene.crease_marks).toBeUndefined();
    expect(landed(calls.stepSummary(after.state)).summary?.diff.reversed).toHaveLength(2);
  });

  it('lands a pinch whose marks every query carries', async () => {
    const { calls } = await engine();
    const sheet = landed(calls.sheet(SQUARE));
    const length = calls.defaultPinchLength(sheet.state);
    expect(length).toBe(1 / 16);
    const pinched = landed(calls.step(sheet.state, precrease(pinchAt([0.5, 0.5], length))));
    expect(pinched.report?.created).toEqual([]);
    expect(pinched.summary.crease_marks).toBe(1);
    expect(pinched.summary.faces).toBe(1);
    expect(pinched.fingerprint).not.toBe(sheet.fingerprint);

    const summary = landed(calls.stepSummary(pinched.state)).summary;
    expect(summary?.diff.marks_added).toBe(1);
    expect(summary?.diff.added).toEqual([]);

    const scene = calls.scene(pinched.state);
    expect(scene.crease_marks).toHaveLength(1);
    const [mark] = scene.crease_marks ?? [];
    expect(mark?.letter).toBe('valley');
    expect(Math.abs((mark?.from.y ?? 0) - (mark?.to.y ?? 0))).toBeCloseTo(length, 12);
    expect(mark?.pieces.map((piece) => piece.seen)).toEqual(['valley']);
    expect(scene.aux_lines).toHaveLength(1);

    const landmarks = calls.landmarks(pinched.state, []);
    expect(landmarks.crease_marks).toHaveLength(1);
    const ends = landmarks.points.flatMap((point) => point.sources).filter((s) => s.kind === 'crease_mark_end');
    expect(ends).toHaveLength(2);

    // The picture is the pinch.
    const action = landed(calls.stepAction(pinched.state)).action;
    const [a, b] = action?.line ?? [];
    expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeCloseTo(length, 12);

    // A whole precrease is as it was: no marks anywhere.
    const whole = landed(calls.step(sheet.state, precrease()));
    expect(whole.summary.crease_marks).toBeUndefined();
    expect(whole.report?.created).toHaveLength(1);
    expect(calls.scene(whole.state).crease_marks).toBeUndefined();
    expect(landed(calls.stepSummary(whole.state)).summary?.diff.marks_added).toBeUndefined();
  });

  it('replays a partial precrease the document wrote and read back, to the fingerprint it committed', async () => {
    const { calls, version } = await engine();
    const segment: FoldPrecreaseExtent = {
      kind: 'segment',
      from: { kind: 'mark', at: [0.5, 0.2], mark: 'fmark-1' },
      to: { kind: 'point', at: [0.6, 0.7] },
    };
    const committed = landed(calls.step(landed(calls.sheet(SQUARE)).state, precrease(segment)));
    const document = sequenceOf([step('fstep-1', null, precrease(segment), { expect: committed.fingerprint })]);
    // Through the file and back.
    const held = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence({ document, readOnlyRaw: null }))))!;
    expect(held.document.steps[0]).toEqual(document.steps[0]);

    const replayer = createFoldReplayer(createFoldEnginePort(sourceOf(calls), version));
    const done = await replayer.run({ loadId: 1, sequence: held.document });
    const node = done?.steps.get('fstep-1');
    expect(node?.status).toBe('ok');
    expect(node?.fingerprint).toBe(committed.fingerprint);

    // A pinch off the paper breaks its step, by the engine's code.
    const off = await createFoldReplayer(createFoldEnginePort(sourceOf(calls), version)).run({
      loadId: 1,
      sequence: sequenceOf([step('fstep-1', null, precrease(pinchAt([1.5, 0.5])))]),
    });
    expect(off?.steps.get('fstep-1')?.status).toBe('broken');
    expect(off?.steps.get('fstep-1')?.refusal).toEqual({ at: 'fstep-1', code: 'extent_off_paper' });
  });

  it('refuses an extent that does not resolve by codes this side knows, and throws a malformed one', async () => {
    const { calls } = await engine();
    const sheet = landed(calls.sheet(SQUARE)).state;
    const codes: string[] = FOLD_REFUSAL_CODES.slice();
    for (const [extent, code] of [
      [pinchAt([1.5, 0.5]), 'extent_off_paper'],
      [pinchAt([0.5, 0.5], 1e-4), 'extent_too_short'],
    ] as const) {
      const refusal = refused(calls.apply(sheet, precrease(extent)));
      expect(refusal.refusal.code).toBe(code);
      expect(codes).toContain(refusal.refusal.code);
      // `analyse` and `action` answer it the same way, before anything lands.
      expect(refused(calls.analyse(sheet, precrease(extent))).refusal.code).toBe(code);
      expect(refused(calls.action(sheet, precrease(extent))).refusal.code).toBe(code);
    }
    const analysis = landed(calls.analyse(sheet, precrease(pinchAt([0.5, 0.5])))).analysis;
    expect(analysis.moving).toEqual([0]);

    const edge = {
      ...precrease(),
      extent: { kind: 'segment', from: { kind: 'edge', a: [0, 0], b: [1, 0] }, to: { kind: 'point', at: [0.5, 0.5] } },
    } as unknown as FoldPrecreaseOp;
    expect(thrown(() => calls.apply(sheet, edge))).toMatchObject({ code: 'invalid_input' });
    const unknown = { ...precrease(), extent: { kind: 'arc' } } as unknown as FoldPrecreaseOp;
    expect(thrown(() => calls.apply(sheet, unknown))).toMatchObject({ code: 'invalid_input' });
  });
});
