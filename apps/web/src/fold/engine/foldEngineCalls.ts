import { applyPleat, pleatAction, pleatFirst, pleatFirstChoices } from '../tools/pleat/pleatEngine';
import type { FoldWasmCompoundEngine } from './foldEngineCompoundCalls';
/**
 * The Fold engine's calls, over one wasm `FoldEngine`: what
 * `workers/foldSequenceWorker.ts` exposes, kept apart from the worker so the
 * wasm test drives exactly these calls in-process.
 *
 * Every argument is checked here, at the boundary, before wasm-bindgen sees
 * it: a handle that is not a whole number would be coerced to some other
 * state's handle rather than refused. The shapes inside a paper, an op,
 * choices or a line are serde's to check, in Rust; this only makes sure each
 * is an object, a point is two finite numbers and a side is a side. A
 * caller's mistake throws a `{ code, message }` envelope; a refusal is a
 * value (`foldEngineWire.ts`).
 *
 * The `fs1` fingerprint is taken here, inside the worker, from the keys the
 * engine spells, so only sixteen hex digits cross to the main thread.
 *
 * Pure: no React, no store, no wasm import (the engine is handed in).
 */

import type { WasmErrorEnvelope } from '../../engine/types';
import { createRepeatExecution } from '../repeat/repeatExecution';
import { foldStateFingerprint, type FoldStateFingerprint } from '../document/foldDigest';
import type { FoldChoices, FoldModelLine, FoldPaper, SheetPoint } from '../document/foldSequenceDocument';
import type {
  FoldActed,
  FoldAnalysed,
  FoldAxiomCandidates,
  FoldAxiomLine,
  FoldDepthChosen,
  FoldEngineOp,
  FoldEngineOutcome,
  FoldLandmarks,
  FoldModelPoint,
  FoldScene,
  FoldSectioned,
  FoldSheetLanded,
  FoldSide,
  FoldStateSummary,
  FoldStepActed,
  FoldStepFingerprinted,
  FoldStepLanded,
  FoldStepSummarised,
  FoldTopVisible,
} from './foldEngineWire';

/** The wasm class's surface, as the generated `FoldEngine` has it. */
export interface FoldWasmEngine {
  sheet(paper: unknown): unknown;
  apply(state: number, op: unknown, choices: unknown): unknown;
  return_to(current: number, target: number, history: Uint32Array): unknown;
  summary(state: number): unknown;
  canonical_keys(state: number): string[];
  release(states: Uint32Array): number;
  clear(): void;
  live(): number;
  analyse(state: number, op: unknown, choices: unknown): unknown;
  action(state: number, op: unknown, choices: unknown): unknown;
  depth_choices(state: number, op: unknown, choices: unknown, at: unknown): unknown;
  cross_section(state: number, line: unknown, side: unknown): unknown;
  axiom_candidates(state: number, line: unknown): unknown;
  step_summary(state: number): unknown;
  step_action(state: number): unknown;
  scene(state: number): unknown;
  landmarks(state: number, marks: unknown): unknown;
  top_visible_at(state: number, at: unknown): unknown;
  default_pinch_length(state: number): number;
}

/** The largest handle the engine can hand out: a `u32`. */
const MAX_HANDLE = 0xffff_ffff;

export function invalidInput(message: string): WasmErrorEnvelope {
  return { code: 'invalid_input', message };
}

export function requireHandle(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_HANDLE) {
    throw invalidInput(`${name} must be a handle (a whole number from 1), got ${String(value)}`);
  }
  return value;
}

export function requireObject<T>(name: string, value: T): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidInput(`${name} must be an object`);
  }
  return value;
}

function requireChoices(choices: FoldChoices | undefined): FoldChoices | undefined {
  return choices === undefined ? undefined : requireObject('choices', choices);
}

function requirePoint<T extends readonly [number, number]>(name: string, value: T): T {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((x) => typeof x === 'number' && Number.isFinite(x))
  ) {
    throw invalidInput(`${name} must be a point, [x, y] with both finite`);
  }
  return value;
}

function requireSide(value: FoldSide): FoldSide {
  if (value !== 'positive' && value !== 'negative') {
    throw invalidInput(`side must be 'positive' or 'negative', got ${String(value)}`);
  }
  return value;
}

export interface FoldEngineCalls {
  /** The flat sheet a sequence starts from, with its fingerprint. */
  sheet(paper: FoldPaper): FoldEngineOutcome<FoldSheetLanded>;
  /** One step, for a preview: no fingerprint. The parent stays held. */
  apply(state: number, op: FoldEngineOp, choices?: FoldChoices): FoldEngineOutcome<FoldStepLanded>;
  /** One step with the landed state's fingerprint: what a replay and a commit take. */
  step(state: number, op: FoldEngineOp, choices?: FoldChoices): FoldEngineOutcome<FoldStepFingerprinted>;
  summary(state: number): FoldStateSummary;
  fingerprint(state: number): FoldStateFingerprint;
  returnTo(current: number, target: number, history: readonly number[]): FoldEngineOutcome<FoldStepFingerprinted>;
  /** Let states go; how many were held. */
  release(states: readonly number[]): number;
  clear(): void;
  /** How many states are held. */
  live(): number;

  // Queries on a handle (plan D12, D14). `choices` carries an axiom op's root, as `step`'s does.
  /** What a fold along a line would move, without folding (D14 tier 2). */
  analyse(state: number, op: FoldEngineOp, choices?: FoldChoices): FoldEngineOutcome<FoldAnalysed>;
  /** That fold's picture on `state`, before it lands. */
  action(state: number, op: FoldEngineOp, choices?: FoldChoices): FoldEngineOutcome<FoldActed>;
  /** The moving sets a depth seed at the sheet point `at` can pick; the op's seed is replaced. */
  depthChoices(
    state: number,
    op: FoldEngineOp,
    at: SheetPoint,
    choices?: FoldChoices
  ): FoldEngineOutcome<FoldDepthChosen>;
  /** The layers along a model line on one side of it (against its normal as given), with their joins. */
  crossSection(state: number, line: FoldModelLine, side: FoldSide): FoldEngineOutcome<FoldSectioned>;
  /** An axiom line's folds here, for the candidate chooser. */
  axiomCandidates(state: number, line: FoldAxiomLine): FoldEngineOutcome<FoldAxiomCandidates>;
  /** The summary of the step that landed `state`; its parent must still be held. */
  stepSummary(state: number): FoldEngineOutcome<FoldStepSummarised>;
  /** The picture of the step that landed `state`; its parent must still be held. */
  stepAction(state: number): FoldEngineOutcome<FoldStepActed>;
  scene(state: number): FoldScene;
  /** Landmarks with provenance and visibility; Divide-line marks are passed in as sheet points. */
  landmarks(state: number, marks: readonly SheetPoint[]): FoldLandmarks;
  /** The face the viewer sees at a model-frame point, and the sheet point there; null off the paper or on a crease. */
  topVisibleAt(state: number, at: FoldModelPoint): FoldTopVisible | null;
  /**
   * The pinch length a partial precrease's tool offers on the state's sheet
   * (sheet units): a sixteenth of its shorter side. The op stores the length
   * it was made with.
   */
  defaultPinchLength(state: number): number;
}

export function createFoldEngineCalls(engine: FoldWasmEngine): FoldEngineCalls {
  // A native state remembers only the last leg. Keep the composite's original
  // input so queries describe the whole saved step, just as its preview does.
  const pleats = new Map<number, { parent: number; op: Extract<FoldEngineOp, { kind: 'pleat' }>; choices?: FoldChoices }>();
  const fingerprint = (state: number): FoldStateFingerprint =>
    foldStateFingerprint({ keys: engine.canonical_keys(state) });
  const apply = (state: number, op: FoldEngineOp, choices?: FoldChoices) => {
    const handle = requireHandle('state', state);
    requireObject('op', op);
    if (op.kind === 'repeat') {
      const result = repeats.apply(handle, op);
      if (result.status === 'ok') pleats.delete(result.state);
      return result;
    }
    if (op.kind === 'pleat') {
      const result = applyPleat(engine as FoldWasmEngine & FoldWasmCompoundEngine, handle, op, choices, repeats.hold);
      if (result.status === 'ok') pleats.set(result.state, { parent: handle, op, choices });
      return result;
    }
    return engine.apply(handle, op, requireChoices(choices)) as FoldEngineOutcome<FoldStepLanded>;
  };
  const repeats = createRepeatExecution(engine, fingerprint, apply, (states) => states.forEach((state) => pleats.delete(state)));

  return {
    sheet(paper) {
      requireObject('paper', paper);
      const made = engine.sheet(paper) as FoldEngineOutcome<Omit<FoldSheetLanded, 'fingerprint'>>;
      return made.status === 'ok' ? { ...made, fingerprint: fingerprint(made.state) } : made;
    },

    apply,

    step(state, op, choices) {
      const landed = apply(state, op, choices);
      return landed.status === 'ok' ? { ...landed, fingerprint: fingerprint(landed.state) } : landed;
    },

    returnTo(current, target, history) {
      const landed = engine.return_to(requireHandle('current', current), requireHandle('target', target),
        Uint32Array.from(history.flatMap((id) => repeats.history(requireHandle('history', id))))) as FoldEngineOutcome<FoldStepLanded>;
      return landed.status === 'ok' ? { ...landed, fingerprint: fingerprint(landed.state) } : landed;
    },

    summary(state) {
      return engine.summary(requireHandle('state', state)) as FoldStateSummary;
    },

    fingerprint(state) {
      return fingerprint(requireHandle('state', state));
    },

    release(states) {
      if (!Array.isArray(states)) throw invalidInput('states must be an array of handles');
      const handles = states.map((state, k) => requireHandle(`states[${k}]`, state));
      return handles.length === 0 ? 0 : repeats.release(handles);
    },

    clear() {
      pleats.clear();
      repeats.clear();
      engine.clear();
    },

    live() {
      return engine.live();
    },

    analyse(state, op, choices) {
      const handle = requireHandle('state', state);
      requireObject('op', op);
      return engine.analyse(handle, op.kind === 'pleat' ? pleatFirst(op) : op, requireChoices(op.kind === 'pleat' ? pleatFirstChoices(choices, op) : choices)) as FoldEngineOutcome<FoldAnalysed>;
    },

    action(state, op, choices) {
      const handle = requireHandle('state', state);
      requireObject('op', op);
      if (op.kind === 'pleat') return pleatAction(engine as FoldWasmEngine & FoldWasmCompoundEngine, handle, op, choices);
      return engine.action(handle, op, requireChoices(choices)) as FoldEngineOutcome<FoldActed>;
    },

    depthChoices(state, op, at, choices) {
      const handle = requireHandle('state', state);
      requireObject('op', op);
      return engine.depth_choices(
        handle,
        op.kind === 'pleat' ? pleatFirst(op) : op,
        requireChoices(op.kind === 'pleat' ? pleatFirstChoices(choices, op) : choices),
        requirePoint('at', at)
      ) as FoldEngineOutcome<FoldDepthChosen>;
    },

    crossSection(state, line, side) {
      const handle = requireHandle('state', state);
      requireObject('line', line);
      return engine.cross_section(handle, line, requireSide(side)) as FoldEngineOutcome<FoldSectioned>;
    },

    axiomCandidates(state, line) {
      const handle = requireHandle('state', state);
      requireObject('line', line);
      return engine.axiom_candidates(handle, line) as FoldEngineOutcome<FoldAxiomCandidates>;
    },

    stepSummary(state) {
      if (repeats.has(state)) return { status: 'ok', summary: null };
      return engine.step_summary(requireHandle('state', state)) as FoldEngineOutcome<FoldStepSummarised>;
    },

    stepAction(state) {
      const composite = pleats.get(requireHandle('state', state));
      if (composite) return pleatAction(engine as FoldWasmEngine & FoldWasmCompoundEngine, composite.parent, composite.op, composite.choices);
      if (repeats.has(state)) return { status: 'ok', action: null };
      return engine.step_action(requireHandle('state', state)) as FoldEngineOutcome<FoldStepActed>;
    },

    scene(state) {
      return engine.scene(requireHandle('state', state)) as FoldScene;
    },

    landmarks(state, marks) {
      const handle = requireHandle('state', state);
      if (!Array.isArray(marks)) throw invalidInput('marks must be an array of sheet points');
      marks.forEach((mark, k) => requirePoint(`marks[${k}]`, mark));
      return engine.landmarks(handle, marks) as FoldLandmarks;
    },

    topVisibleAt(state, at) {
      const handle = requireHandle('state', state);
      return engine.top_visible_at(handle, requirePoint('at', at)) as FoldTopVisible | null;
    },

    defaultPinchLength(state) {
      return engine.default_pinch_length(requireHandle('state', state));
    },
  };
}
