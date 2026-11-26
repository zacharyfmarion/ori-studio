/**
 * The merges the document alone can tell
 * (`implementation-plans/diagram-merge-symmetric-precreases.md`): a run of
 * precreases, and straight after it a Repeat whose source range is exactly
 * that run and whose every step is a precrease — one Diagram step, drawn
 * whole. The Repeat verified its mirror when it was prepared. Every other
 * merge — precreases or folds that mirror or turn each other — is told from
 * the scenes (`foldStepMerge.ts`).
 *
 * Also how a send of a path's steps becomes the steps the merges draw
 * (`mergedPullTargets`).
 *
 * Pure: no React, no store, no engine.
 */

import {
  isLockedStep,
  type FoldPrecreaseOp,
  type FoldRepeatOp,
  type FoldStep,
  type FoldStepNode,
} from '../../fold/document/foldSequenceDocument';
import type { FoldPullTarget } from './foldPull';
import type { FoldMergedRun } from './foldStepMerge';

/** Whether a step only creases: a precrease of its whole line, a segment or a pinch. */
export function isPrecreaseStep(node: FoldStepNode | null | undefined): node is FoldStep & { op: FoldPrecreaseOp } {
  return !!node && !isLockedStep(node) && node.op.kind === 'precrease';
}

/** Whether a step is a Repeat whose every step only creases. */
function repeatsPrecreases(node: FoldStepNode): node is FoldStep & { op: FoldRepeatOp } {
  return (
    !isLockedStep(node) &&
    node.op.kind === 'repeat' &&
    node.op.steps.length > 0 &&
    node.op.steps.every((entry) => entry.op.kind === 'precrease')
  );
}

/** Whether a run of steps, first to last on one path, is precreases and, last, a Repeat of precreases. */
export function isRepeatRun(run: readonly FoldStepNode[]): boolean {
  const last = run.at(-1);
  return run.length >= 2 && !!last && run.slice(0, -1).every(isPrecreaseStep) && repeatsPrecreases(last);
}

/**
 * The Repeats of precreases along `path` — its steps in order, turns
 * included — each with the run it repeats: the run just before it, whole,
 * and only precreases. A step is in one at most, the path's earliest first.
 */
export function precreaseRepeatRuns(path: readonly FoldStepNode[]): FoldMergedRun[] {
  const at = new Map(path.map((node, index) => [node.id, index]));
  const taken = new Set<number>();
  const runs: FoldMergedRun[] = [];
  path.forEach((node, index) => {
    if (!repeatsPrecreases(node)) return;
    const first = at.get(node.op.source.first);
    const last = at.get(node.op.source.last);
    if (first === undefined || last !== index - 1 || first > last) return;
    const run = path.slice(first, index);
    if (!run.every(isPrecreaseStep) || run.some((_, k) => taken.has(first + k))) return;
    for (let k = first; k <= index; k += 1) taken.add(k);
    runs.push({ steps: [...run, node].map((step) => step.id), kind: 'repeat' });
  });
  return runs;
}

/**
 * `targets` with each run's steps, sent one after another as the states
 * before them, made one target naming the run (`through`): what Send steps
 * to Diagram sends with Merge symmetric steps on. A run only some of whose
 * steps are sent, or not one after another, is sent as its steps.
 */
export function mergedPullTargets(targets: readonly FoldPullTarget[], runs: readonly FoldMergedRun[]): FoldPullTarget[] {
  const out: FoldPullTarget[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    const run =
      target.kind === 'step' && target.moment === 'before'
        ? runs.find((candidate) => candidate.steps[0] === target.step)
        : undefined;
    const sent = run ? targets.slice(index, index + run.steps.length) : [];
    const whole =
      run !== undefined &&
      sent.length === run.steps.length &&
      sent.every((each, k) => each.kind === 'step' && each.moment === 'before' && each.step === run.steps[k]);
    if (!run || !whole) {
      out.push(target);
      continue;
    }
    out.push({ kind: 'step', step: run.steps[0]!, through: run.steps.at(-1)!, moment: 'before' });
    index += run.steps.length - 1;
  }
  return out;
}
