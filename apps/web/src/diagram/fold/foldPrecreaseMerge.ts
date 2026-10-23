/**
 * Precreases and their mirror images, merged into one Diagram step: the
 * Merge symmetric precreases option of the From Fold… browser and of Send
 * steps to Diagram (`implementation-plans/diagram-merge-symmetric-precreases.md`).
 *
 * A book draws a precrease and its mirror image as one step ("fold and
 * unfold on both sides"); Fold records them as two. Only precreases merge —
 * a whole line, a segment or a pinch: they fold and unfold, so the folded
 * form is as it was and every crease belongs on the one picture before the
 * first. Nothing that moves paper is ever merged.
 *
 * - **A Repeat of precreases** (`repeat`): a run of precreases, and straight
 *   after it a Repeat whose source range is exactly that run and whose every
 *   step is a precrease. Told from the document alone: the Repeat verified
 *   its mirror when it was prepared.
 * - **A mirrored pair** (`mirror`): two precreases one after the other, the
 *   second the first mirrored across a symmetry of the state before them.
 *   The document only offers the pair; the scenes say whether it mirrors
 *   (`foldPrecreaseMirrors.ts`, over Repeat's own check).
 *
 * A step is in one merge at most, Repeats first, then the pairs left over,
 * the path's earliest first.
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

/** A run of a path's steps one Diagram step draws, first to last: precreases, the last of them the mirror. */
export interface FoldPrecreaseMerge {
  readonly steps: readonly string[];
  readonly kind: 'repeat' | 'mirror';
}

/** What a path offers to merge: the Repeats of precreases, and the pairs of precreases the scenes are still to tell. */
export interface FoldPrecreaseMergeCandidates {
  readonly repeats: readonly FoldPrecreaseMerge[];
  /** Two precreases one after the other, in no Repeat's merge: merged when the second mirrors the first. */
  readonly pairs: readonly (readonly [string, string])[];
}

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

/**
 * Whether a run of steps, first to last on one path, is one this build draws
 * as one step: precreases, the last a precrease or a Repeat of precreases.
 */
export function isMergeableRun(run: readonly FoldStepNode[]): boolean {
  const last = run.at(-1);
  return (
    run.length >= 2 &&
    !!last &&
    run.slice(0, -1).every(isPrecreaseStep) &&
    (isPrecreaseStep(last) || repeatsPrecreases(last))
  );
}

/** What can merge along `path` — its steps in order, turns included, which no merge spans. */
export function precreaseMergeCandidates(path: readonly FoldStepNode[]): FoldPrecreaseMergeCandidates {
  const at = new Map(path.map((node, index) => [node.id, index]));
  const taken = new Set<number>();
  const repeats: FoldPrecreaseMerge[] = [];
  path.forEach((node, index) => {
    if (!repeatsPrecreases(node)) return;
    const first = at.get(node.op.source.first);
    const last = at.get(node.op.source.last);
    // The run it repeats is the one just before it, whole, and only precreases.
    if (first === undefined || last !== index - 1 || first > last) return;
    const run = path.slice(first, index);
    if (!run.every(isPrecreaseStep) || run.some((_, k) => taken.has(first + k))) return;
    for (let k = first; k <= index; k += 1) taken.add(k);
    repeats.push({ steps: [...run, node].map((step) => step.id), kind: 'repeat' });
  });
  const pairs: (readonly [string, string])[] = [];
  for (let index = 0; index + 1 < path.length; index += 1) {
    if (taken.has(index) || taken.has(index + 1)) continue;
    const [first, second] = [path[index]!, path[index + 1]!];
    if (isPrecreaseStep(first) && isPrecreaseStep(second) && second.parent === first.id) pairs.push([first.id, second.id]);
  }
  return { repeats, pairs };
}

/**
 * The merges along a path, in its order: every Repeat of precreases, and of
 * the pairs, each whose second mirrors its first (`mirrors`), the earliest
 * first — a step in one pair only.
 */
export function resolvePrecreaseMerges(
  candidates: FoldPrecreaseMergeCandidates,
  mirrors: (pair: readonly [string, string]) => boolean,
  order: readonly string[]
): FoldPrecreaseMerge[] {
  const used = new Set<string>();
  const pairs: FoldPrecreaseMerge[] = [];
  for (const pair of candidates.pairs) {
    if (used.has(pair[0]) || !mirrors(pair)) continue;
    used.add(pair[0]).add(pair[1]);
    pairs.push({ steps: pair, kind: 'mirror' });
  }
  const place = new Map(order.map((id, index) => [id, index]));
  return [...candidates.repeats, ...pairs].sort(
    (a, b) => (place.get(a.steps[0]!) ?? 0) - (place.get(b.steps[0]!) ?? 0)
  );
}

/**
 * `targets` with each merge's steps, sent one after another as the states
 * before them, made one target naming the run (`through`): what Send steps
 * to Diagram sends with the option on. A merge only some of whose steps are
 * sent, or not one after another, is sent as its steps.
 */
export function mergedPullTargets(
  targets: readonly FoldPullTarget[],
  merges: readonly FoldPrecreaseMerge[]
): FoldPullTarget[] {
  const out: FoldPullTarget[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    const merge =
      target.kind === 'step' && target.moment === 'before'
        ? merges.find((candidate) => candidate.steps[0] === target.step)
        : undefined;
    const run = merge ? targets.slice(index, index + merge.steps.length) : [];
    const whole =
      merge !== undefined &&
      run.length === merge.steps.length &&
      run.every((sent, k) => sent.kind === 'step' && sent.moment === 'before' && sent.step === merge.steps[k]);
    if (!merge || !whole) {
      out.push(target);
      continue;
    }
    out.push({ kind: 'step', step: merge.steps[0]!, through: merge.steps.at(-1)!, moment: 'before' });
    index += merge.steps.length - 1;
  }
  return out;
}
