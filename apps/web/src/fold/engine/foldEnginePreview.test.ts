import { describe, expect, it, vi } from 'vitest';
import type { FoldChoices } from '../document/foldSequenceDocument';
import type { FoldEngineCalls } from './foldEngineCalls';
import type { FoldOrderSelection } from './foldEngineCompoundCalls';
import {
  foldPreviewWants,
  orderResolvedStep,
  previewStep,
  resolveOrdersWithPreview,
  type FoldPreviewWants,
} from './foldEnginePreview';
import { axiomRootsWithSections, rootSectionLine } from './foldEngineRoots';
import type { FoldEngineOp, FoldIsometry, FoldScene } from './foldEngineWire';

/**
 * A preview's turn and an axiom's roots composed over the engine's calls
 * (`foldEnginePreview.ts`, `foldEngineRoots.ts`): each answer is the call's
 * own, in the order the surfaces asked them one by one; an envelope fails
 * only its own answer; a trap fails the turn, as it fails any call.
 */

const VALLEY: FoldEngineOp = {
  kind: 'valley',
  line: { via: 'free', through: [[0, 0.5], [1, 0.5]] },
  moving: [0.5, 0.75],
  seed: { scope: 'all' },
  landing: { kind: 'outer' },
};
const SUMMARY = { step: 1, faces: 2 } as never;
const SCENE = { subfaces: [], view_transform: [1, 0, 0, 0, 1, 0] } as unknown as FoldScene;
const ANALYSIS = { line: { n: [0, 1], d: 0.5 }, side: 'positive' } as never;
const BOTH: FoldPreviewWants = { analysis: true, action: true };

/** Calls that log what they were asked, in order. */
function engine(overrides: Partial<Record<keyof FoldEngineCalls, (...args: never[]) => unknown>> = {}) {
  const log: string[] = [];
  const logged = <T>(name: string, answer: (...args: never[]) => T) =>
    vi.fn((...args: never[]) => {
      log.push(name);
      return answer(...args);
    });
  const calls = {
    apply: logged('apply', overrides.apply ?? (() => ({ status: 'ok', state: 9, report: null, summary: SUMMARY }))),
    analyse: logged('analyse', overrides.analyse ?? (() => ({ status: 'ok', analysis: ANALYSIS }))),
    action: logged('action', overrides.action ?? (() => ({ status: 'ok', action: { kind: 'fold' } }))),
    scene: logged('scene', overrides.scene ?? (() => SCENE)),
    stepSummary: logged('stepSummary', overrides.stepSummary ?? (() => ({ status: 'ok', summary: { diff: { added: [1], reversed: [] } } }))),
    axiomCandidates: logged('axiomCandidates', overrides.axiomCandidates ?? (() => ({ status: 'ok', candidates: [] }))),
    crossSection: logged('crossSection', overrides.crossSection ?? (() => ({ status: 'ok', section: { flaps: [] } }))),
  } as unknown as FoldEngineCalls;
  return { calls, log };
}

describe('a preview’s turn', () => {
  it('lands the step, then reads the parent’s analysis and picture and the landed state’s scene and step summary', () => {
    const { calls, log } = engine();
    const previewed = previewStep(calls, 3, VALLEY, undefined, BOTH);
    expect(log).toEqual(['apply', 'analyse', 'action', 'scene', 'stepSummary']);
    expect(calls.apply).toHaveBeenCalledWith(3, VALLEY, undefined);
    expect(calls.analyse).toHaveBeenCalledWith(3, VALLEY, undefined);
    expect(calls.scene).toHaveBeenCalledWith(9);
    expect(previewed).toEqual({
      op: VALLEY,
      landed: { status: 'ok', state: 9, report: null, summary: SUMMARY },
      analysis: { value: { status: 'ok', analysis: ANALYSIS } },
      action: { value: { status: 'ok', action: { kind: 'fold' } } },
      scene: { value: SCENE },
      stepSummary: { value: { summary: { diff: { added: [1], reversed: [] } } } },
    });
  });

  it('asks only what the step wants: nothing of the parent for a rotation, no analysis for a vertex fold', () => {
    expect(foldPreviewWants({ kind: 'rotate', rotate: { amount: 'half', direction: 'cw' } })).toEqual({ analysis: false, action: false });
    expect(foldPreviewWants({ kind: 'squash', flap: [0.2, 0.2], direction: 'valley' } as FoldEngineOp)).toEqual({ analysis: false, action: true });
    expect(foldPreviewWants(VALLEY)).toEqual(BOTH);
    const { calls, log } = engine();
    previewStep(calls, 3, VALLEY, { root: { n: [0, 1], d: 0.5 } } as FoldChoices, { analysis: false, action: false });
    expect(log).toEqual(['apply', 'scene', 'stepSummary']);
  });

  it('answers a step that does not land with its refusal and the parent’s answers, reading no landed state', () => {
    const refused = { status: 'refused', refusal: { code: 'near_miss' }, fixes: [], faces: [], vertices: [] };
    const { calls, log } = engine({ apply: () => refused });
    expect(previewStep(calls, 3, VALLEY, undefined, BOTH)).toMatchObject({ landed: refused, analysis: { value: {} }, action: { value: {} } });
    expect(log).toEqual(['apply', 'analyse', 'action']);
  });

  it('fails only the answer an envelope fails, and the summary of a released parent is none, as the query has it', () => {
    const { calls } = engine({
      action: () => {
        throw { code: 'invalid_input', message: 'no picture' };
      },
      stepSummary: () => {
        throw { code: 'parent_released', message: 'gone' };
      },
    });
    const previewed = previewStep(calls, 3, VALLEY, undefined, BOTH);
    expect(previewed.action).toEqual({ error: { code: 'invalid_input', message: 'no picture' } });
    expect(previewed.stepSummary).toEqual({ value: { summary: null } });
    expect(previewed.scene).toEqual({ value: SCENE });
  });

  it('throws a trap out of the turn, whichever answer it struck', () => {
    const { calls } = engine({
      scene: () => {
        throw new Error('unreachable executed');
      },
    });
    expect(() => previewStep(calls, 3, VALLEY, undefined, BOTH)).toThrow('unreachable executed');
  });
});

describe('the step a fold’s orders resolve', () => {
  const selection = (over: Partial<FoldOrderSelection> = {}): FoldOrderSelection => ({ count: { orders: 2, exact: true }, index: 0, completion: null, ...over });
  const witness = { faces: [[0.1, 0.1]], orders: [[0, 1, 1]] } as never;

  it('takes the order’s landing and completion, and none when no order is left', () => {
    const against = { kind: 'against' as const, targets: [[0.2, 0.2]] as [number, number][] };
    expect(orderResolvedStep(VALLEY, undefined, selection({ landing: against, completion: witness }))).toEqual({
      op: { ...VALLEY, landing: against },
      choices: { completion: witness },
    });
    // A completion the base step carried is the old order's: replaced, or dropped with none.
    const root = { n: [0, 1] as [number, number], d: 0.5 };
    expect(orderResolvedStep(VALLEY, { root, completion: witness } as FoldChoices, selection())).toEqual({ op: VALLEY, choices: { root } });
    expect(orderResolvedStep(VALLEY, { completion: witness } as FoldChoices, selection())).toEqual({ op: VALLEY });
    expect(orderResolvedStep(VALLEY, undefined, selection({ count: { orders: 0, exact: true } }))).toBeNull();
  });

  it('folds that step in the same turn, and only when it is wanted and the orders resolve one', async () => {
    const against = { kind: 'against' as const, targets: [[0.2, 0.2]] as [number, number][] };
    const { calls, log } = engine();
    const resolved = await resolveOrdersWithPreview(calls, () => ({ status: 'ok', ...selection({ landing: against }) }), 3, VALLEY, {}, BOTH);
    expect(log).toEqual(['apply', 'analyse', 'action', 'scene', 'stepSummary']);
    expect(calls.apply).toHaveBeenCalledWith(3, { ...VALLEY, landing: against }, undefined);
    expect(resolved.preview?.op).toEqual({ ...VALLEY, landing: against });

    const unwanted = engine();
    expect((await resolveOrdersWithPreview(unwanted.calls, () => ({ status: 'ok', ...selection() }), 3, VALLEY, undefined, null)).preview).toBeNull();
    const refused = { status: 'refused' as const, refusal: { code: 'budget_exceeded' } as never, fixes: [], faces: [], vertices: [] };
    expect(await resolveOrdersWithPreview(unwanted.calls, () => refused, 3, VALLEY, undefined, BOTH)).toEqual({ selection: refused, preview: null });
    expect(unwanted.log).toEqual([]);
  });

  it('keeps the orders when the step fails with an envelope, and throws a trap', async () => {
    const failing = engine({
      apply: () => {
        throw { code: 'invalid_input', message: 'bad' };
      },
    });
    expect((await resolveOrdersWithPreview(failing.calls, () => ({ status: 'ok', ...selection() }), 3, VALLEY, undefined, BOTH)).preview).toBeNull();
    const trapping = engine({
      apply: () => {
        throw new Error('memory access out of bounds');
      },
    });
    await expect(resolveOrdersWithPreview(trapping.calls, () => ({ status: 'ok', ...selection() }), 3, VALLEY, undefined, BOTH)).rejects.toThrow('out of bounds');
  });
});

describe('an axiom’s roots, with the layers at the one taken', () => {
  const TURNED: FoldIsometry = [-1, 0, 1, 0, 1, 0];
  const line = { via: 'axiom', axiom: 2, inputs: [] } as never;
  const roots = (side: 'positive' | 'negative' | null) => ({
    status: 'ok',
    candidates: [
      { root: 0, line: { n: [1, 0], d: 0.25 }, side },
      { root: 1, line: { n: [0, 1], d: 0.75 }, side },
    ],
  });

  it('asks the root’s section at the line the tool asks it at, on the side it moves, the other side when swapped', () => {
    const { calls } = engine({ axiomCandidates: () => roots('positive') });
    const answered = axiomRootsWithSections(calls, 3, line, { viewTransform: TURNED, root: 1, swapped: false });
    expect(answered.sections).toEqual([{ line: rootSectionLine(TURNED, { n: [0, 1], d: 0.75 }), side: 'positive', section: { value: { status: 'ok', section: { flaps: [] } } } }]);
    expect(calls.crossSection).toHaveBeenCalledWith(3, rootSectionLine(TURNED, { n: [0, 1], d: 0.75 }), 'positive');
    const swapped = axiomRootsWithSections(calls, 3, line, { viewTransform: TURNED, root: 1, swapped: true });
    expect(swapped.sections.map((s) => s.side)).toEqual(['negative']);
  });

  it('asks both sides of a root that names none, the first root for one out of range, and nothing without a hint', () => {
    const { calls, log } = engine({ axiomCandidates: () => roots(null) });
    const both = axiomRootsWithSections(calls, 3, line, { viewTransform: TURNED, root: 7, swapped: false });
    expect(both.sections.map((s) => [s.line, s.side])).toEqual([
      [rootSectionLine(TURNED, { n: [1, 0], d: 0.25 }), 'positive'],
      [rootSectionLine(TURNED, { n: [1, 0], d: 0.25 }), 'negative'],
    ]);
    log.length = 0;
    expect(axiomRootsWithSections(calls, 3, line, null).sections).toEqual([]);
    expect(log).toEqual(['axiomCandidates']);
  });

  it('fails only the section an envelope fails', () => {
    const { calls } = engine({
      axiomCandidates: () => roots('negative'),
      crossSection: () => {
        throw { code: 'invalid_input', message: 'no line' };
      },
    });
    const answered = axiomRootsWithSections(calls, 3, line, { viewTransform: TURNED, root: 0, swapped: false });
    expect(answered.candidates).toEqual(roots('negative'));
    expect(answered.sections[0]?.section).toEqual({ error: { code: 'invalid_input', message: 'no line' } });
  });
});
