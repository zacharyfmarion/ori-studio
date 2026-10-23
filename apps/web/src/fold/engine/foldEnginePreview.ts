/**
 * A tool's preview in one turn of the worker (plan D14 tier 3): the step
 * landed, and what every surface then asks of it — its scene, its summary,
 * what it moves and its picture — answered together, so the canvas waits on
 * one round trip rather than a chain of them.
 *
 * - {@link previewStep}: land a step, and read the landed state.
 * - {@link resolveOrdersWithPreview}: a fold's layer orders
 *   (`orderSelection`), then the step those orders resolve
 *   ({@link orderResolvedStep}) previewed as above. The tool would ask for
 *   that step the moment the orders came back; this asks for it in the same
 *   turn.
 *
 * Nothing here is computed differently from the calls it composes: each
 * answer is the call's own, asked of the same state with the same arguments
 * that the surfaces ask it with one by one (`FOLD_SCENE_QUERY`,
 * `FOLD_STEP_SUMMARY_QUERY`, `analyse`, `action`).
 *
 * A failure that is an envelope belongs to the one answer it failed — the
 * asker asks that one again, alone, and hears it there. Anything else is the
 * engine trapping, and is thrown as the call's own failure, so the worker
 * treats it as it treats any trap (`foldEngineTrap.ts`).
 *
 * Pure: no React, no store, no wasm import (the calls are handed in).
 */

import type { WasmErrorEnvelope } from '../../engine/types';
import { isVertexOp, type FoldChoices, type FoldOp } from '../document/foldSequenceDocument';
import type { FoldEngineCalls } from './foldEngineCalls';
import type { FoldOrderQuery, FoldOrderSelection } from './foldEngineCompoundCalls';
import { foldEngineTrapOf } from './foldEngineTrap';
import {
  isFoldParentReleased,
  type FoldActed,
  type FoldAnalysed,
  type FoldEngineOp,
  type FoldEngineOutcome,
  type FoldScene,
  type FoldStepLanded,
  type FoldStepSummarised,
} from './foldEngineWire';

/** What a preview needs besides the landed state itself. */
export interface FoldPreviewWants {
  /** What the fold moves, analysed on the parent: not for a rotation, an unfold to a step, a repeat or a vertex fold. */
  analysis: boolean;
  /** The fold's picture on the parent: not for a rotation, an unfold to a step or a repeat. */
  action: boolean;
}

/**
 * What a tool asks of the step it previews, besides landing it: one
 * predicate, read by the tool's preview and the session alike.
 */
export function foldPreviewWants(op: FoldEngineOp): FoldPreviewWants {
  // A rotation moves no paper; an unfold to an earlier step and a repeat fold along no one line.
  const lineless = op.kind === 'rotate' || op.kind === 'unfold-to' || op.kind === 'repeat';
  return { analysis: !lineless && !isVertexOp(op as FoldOp), action: !lineless };
}

/** One answer of a preview: the call's value, or the envelope it failed with. */
export type FoldPreviewAnswer<T> = { readonly value: T } | { readonly error: WasmErrorEnvelope };

/** A step landed for a preview, and what was read of it in the same turn. */
export interface FoldPreviewed {
  /** The step asked for, as it was asked. */
  readonly op: FoldEngineOp;
  readonly choices?: FoldChoices;
  readonly landed: FoldEngineOutcome<FoldStepLanded>;
  /** The landed state's scene; absent when it did not land. */
  readonly scene?: FoldPreviewAnswer<FoldScene>;
  /** As `FOLD_STEP_SUMMARY_QUERY` answers it; absent when it did not land. */
  readonly stepSummary?: FoldPreviewAnswer<FoldStepSummarised>;
  readonly analysis?: FoldPreviewAnswer<FoldEngineOutcome<FoldAnalysed>>;
  readonly action?: FoldPreviewAnswer<FoldEngineOutcome<FoldActed>>;
}

/** A fold's orders, and the step they resolve previewed when they resolve one. */
export interface FoldOrdersPreviewed {
  readonly selection: FoldEngineOutcome<FoldOrderSelection>;
  /** Null when the orders resolve no step, or none was wanted. */
  readonly preview: FoldPreviewed | null;
}

/** The answer, or the envelope it failed with; a trap is rethrown. */
export function foldEngineAnswer<T>(read: () => T): FoldPreviewAnswer<T> {
  try {
    return { value: read() };
  } catch (error) {
    if (foldEngineTrapOf(error)) throw error;
    return { error: error as WasmErrorEnvelope };
  }
}

/** `FOLD_STEP_SUMMARY_QUERY`'s answer, from the call it wraps. */
export function foldStepSummaryAnswer(read: () => FoldEngineOutcome<FoldStepSummarised>): FoldStepSummarised {
  try {
    const summarised = read();
    return summarised.status === 'ok' ? { summary: summarised.summary } : { summary: null };
  } catch (error) {
    if (isFoldParentReleased(error)) return { summary: null };
    throw error;
  }
}

/**
 * Land `op` from `state` (`apply`, as a preview always has) and read what the
 * preview shows of it: the parent's analysis and picture, then the landed
 * state's scene and step summary. A step that does not land is answered with
 * its refusal and the parent's two answers.
 */
export function previewStep(
  calls: Pick<FoldEngineCalls, 'apply' | 'analyse' | 'action' | 'scene' | 'stepSummary'>,
  state: number,
  op: FoldEngineOp,
  choices: FoldChoices | undefined,
  wants: FoldPreviewWants
): FoldPreviewed {
  const landed = calls.apply(state, op, choices);
  const asked = choices ? { op, choices } : { op };
  const parent = {
    ...(wants.analysis ? { analysis: foldEngineAnswer(() => calls.analyse(state, op, choices)) } : {}),
    ...(wants.action ? { action: foldEngineAnswer(() => calls.action(state, op, choices)) } : {}),
  };
  if (landed.status !== 'ok') return { ...asked, landed, ...parent };
  return {
    ...asked,
    landed,
    ...parent,
    scene: foldEngineAnswer(() => calls.scene(landed.state)),
    stepSummary: foldEngineAnswer(() => foldStepSummaryAnswer(() => calls.stepSummary(landed.state))),
  };
}

/**
 * The step a fold's orders resolve: the base step with the order's
 * completion, a plain fold's landing or a pleat's resolution — what the tool
 * folds once the orders have come back. Null when no order resolves it.
 * `choices` are the base step's.
 */
export function orderResolvedStep<Op extends FoldEngineOp>(
  op: Op,
  choices: FoldChoices | undefined,
  value: FoldOrderSelection
): { op: Op; choices?: FoldChoices } | null {
  if (value.count.orders === 0) return null;
  const resolved: FoldChoices = { ...choices };
  delete resolved.completion;
  if (value.completion) resolved.completion = value.completion;
  const stored = Object.keys(resolved).length ? resolved : undefined;
  const folded: Op =
    (op.kind === 'valley' || op.kind === 'mountain') && value.landing
      ? { ...op, landing: value.landing }
      : op.kind === 'pleat' && value.pleat
        ? { ...op, resolved: value.pleat }
        : op;
  return { op: folded, ...(stored ? { choices: stored } : {}) };
}

/**
 * A fold's orders, as `orderSelection` answers them (`select`, which runs a
 * pleat's search), then — when `wants` is given and the orders resolve a
 * step — that step previewed ({@link previewStep}). A step that fails to
 * land with an envelope is no preview: the tool asks for it again, alone.
 */
export async function resolveOrdersWithPreview(
  calls: Pick<FoldEngineCalls, 'apply' | 'analyse' | 'action' | 'scene' | 'stepSummary'>,
  select: () => FoldEngineOutcome<FoldOrderSelection> | Promise<FoldEngineOutcome<FoldOrderSelection>>,
  state: number,
  op: FoldEngineOp,
  choices: FoldChoices | undefined,
  wants: FoldPreviewWants | null
): Promise<FoldOrdersPreviewed> {
  const selection = await select();
  const step = wants && selection.status === 'ok' ? orderResolvedStep(op, choices, selection) : null;
  if (!step || !wants) return { selection, preview: null };
  try {
    return { selection, preview: previewStep(calls, state, step.op, step.choices, wants) };
  } catch (error) {
    if (foldEngineTrapOf(error)) throw error;
    return { selection, preview: null };
  }
}

export type { FoldOrderQuery };
