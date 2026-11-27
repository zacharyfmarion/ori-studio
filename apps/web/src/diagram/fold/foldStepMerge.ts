/**
 * Fold steps a book would draw as one Diagram step
 * (`implementation-plans/diagram-merge-symmetric-folds.md`): the cupboard
 * fold's two edges, a square's four corners. Steps may be drawn as one when
 * both hold:
 *
 * - **Independent.** Each step moves paper no other step of the group
 *   touches, and lands it clear of theirs (`stepFootprint`): they fold the
 *   same in any order, so every one can be drawn on the picture before the
 *   first. Landing counts — two corners folded past the centre overlap once
 *   down, and the order decides which lies on top.
 * - **The same fold.** Each step after the first repeats one before it in
 *   the group (`stepRelation`): its mirror image, or the same fold turned.
 *
 * A mirror image starts merged; a turned copy is offered, and starts apart
 * (`startingRuns`). Any run of a group's steps may be drawn as one while each
 * of its steps repeats one before it in the run (`runRelation`).
 *
 * Pure: no React, no store, no engine. The states' scenes are given.
 */

import { applyIsometry, polygonArea } from '../../fold/canvas/foldCanvasGeometry';
import { isLockedStep, type FoldStepNode } from '../../fold/document/foldSequenceDocument';
import type { FoldScene } from '../../fold/engine/foldEngineWire';
import { modelMap, overlap, sheetRing } from '../../fold/repeat/repeatGeometry';
import { changedFaces, stepRelation, type StepRelation } from '../../fold/repeat/repeatVerification';
import type { Point } from '../../lib/geometry';

/**
 * The steps that are not one move of paper the reader could make beside
 * another: a turn or rotation of the whole model, a collapse into a crease
 * pattern, an unfold back to an earlier step, a Repeat (its own steps are
 * the moves), a new order of the layers (no crease, so nothing to mirror).
 */
const ENDS_A_GROUP = new Set(['turn', 'rotate', 'cp-jump', 'unfold-to', 'repeat', 'adjust-order']);

/** Whether a path step may be drawn with others: a fold, precrease, unfold or compound move, in this build's terms. */
export function isMergeableStep(node: FoldStepNode | null | undefined): boolean {
  return !!node && !isLockedStep(node) && !ENDS_A_GROUP.has(node.op.kind);
}

/** A run of a path's steps one Diagram step draws, first to last: two or more. */
export interface FoldMergedRun {
  readonly steps: readonly string[];
  /**
   * How it is one step: precreases and a Repeat of them (`repeat`), or each
   * step after the first the mirror image or turned copy of one before it.
   */
  readonly kind: 'repeat' | StepRelation;
}

/** A step of the path as the merge reads it. */
export interface FoldMergeStep {
  readonly id: string;
  /** It may be drawn with others (`isMergeableStep`): a step that is not ends any group. */
  readonly mergeable: boolean;
  /** The state it folds from and the one it lands, once both have landed. */
  readonly before: FoldScene | null;
  readonly after: FoldScene | null;
  /**
   * What names its two states whatever the engine's handles (their
   * fingerprints), so a cache can keep what was told of them; absent,
   * nothing is kept.
   */
  readonly key?: string;
}

/** Steps one after another on the path, each independent of the others and each after the first repeating one before it. */
export interface FoldStepGroup {
  /** The path's steps, first to last: two or more. */
  readonly steps: readonly string[];
  /** How each step repeats each one before it in the group: `related[k][j]`, j < k. */
  readonly related: readonly (readonly (StepRelation | null)[])[];
}

/** What has been told of steps by their states (`FoldMergeStep.key`): how one repeats another, where each moves paper. */
export interface FoldMergeCache {
  readonly relations: Map<string, StepRelation | null>;
  readonly footprints: Map<string, Point[][]>;
}

export function createFoldMergeCache(): FoldMergeCache {
  return { relations: new Map(), footprints: new Map() };
}

/** Less shared area than this is a touch along a boundary, not shared paper. */
const SHARED = 1e-9;

/**
 * Where the paper the step from `before` to `after` moves lies, in the model
 * frame: where it was and where it lands. Empty for a step that moves none —
 * a precrease folds and unfolds, and leaves every layer where it was.
 */
export function stepFootprint(before: FoldScene, after: FoldScene): Point[][] {
  const regions: Point[][] = [];
  for (const i of changedFaces(before, after)) {
    const ring = sheetRing(after, i);
    regions.push(ring.map((p) => applyIsometry(modelMap(after, i), p)));
    for (let j = 0; j < before.faces.length; j += 1) {
      const part = overlap(ring, sheetRing(before, j));
      if (Math.abs(polygonArea(part)) > SHARED) regions.push(part.map((p) => applyIsometry(modelMap(before, j), p)));
    }
  }
  return regions;
}

/** Whether two footprints share paper, beyond touching along a boundary. */
export function footprintsMeet(a: readonly Point[][], b: readonly Point[][]): boolean {
  let shared = 0;
  for (const p of a) for (const q of b) shared += Math.abs(polygonArea(overlap(p, q)));
  return shared > SHARED;
}

/**
 * The grouping (`foldStepGroups`), a piece of work at a time: it yields after
 * each pair or footprint it tells, so a caller can share the thread, and
 * returns the groups. Whether a step repeats a member is asked first — most
 * pairs fail its cheap filter — and only then whether it shares paper.
 */
function* grouping(path: readonly FoldMergeStep[], cache?: FoldMergeCache): Generator<void, FoldStepGroup[], void> {
  const ready = (step: FoldMergeStep | undefined): step is FoldMergeStep & { before: FoldScene; after: FoldScene } =>
    !!step && step.mergeable && step.before !== null && step.after !== null;
  const footprint = (k: number) => {
    const step = path[k]!;
    let print = step.key ? cache?.footprints.get(step.key) : undefined;
    if (!print) {
      print = stepFootprint(step.before!, step.after!);
      if (step.key) cache?.footprints.set(step.key, print);
    }
    return print;
  };
  const relate = (j: number, k: number) => {
    const [source, target] = [path[j]!, path[k]!];
    const key = source.key && target.key ? `${source.key}>${target.key}` : undefined;
    if (key && cache?.relations.has(key)) return cache.relations.get(key)!;
    const relation = stepRelation(source.before!, source.after!, target.before!, target.after!);
    if (key) cache?.relations.set(key, relation);
    return relation;
  };
  const groups: FoldStepGroup[] = [];
  let start = 0;
  while (start < path.length) {
    if (!ready(path[start])) {
      start += 1;
      continue;
    }
    const members = [start];
    const related: (StepRelation | null)[][] = [[]];
    let next = start + 1;
    for (; ready(path[next]); next += 1) {
      const row: (StepRelation | null)[] = [];
      for (const member of members) {
        row.push(relate(member, next));
        yield;
      }
      if (row.every((relation) => relation === null)) break;
      let meets = false;
      for (const member of members) {
        meets = footprintsMeet(footprint(member), footprint(next));
        yield;
        if (meets) break;
      }
      if (meets) break;
      members.push(next);
      related.push(row);
    }
    if (members.length > 1) {
      groups.push({ steps: members.map((member) => path[member]!.id), related });
      start = next;
    } else {
      start += 1;
    }
  }
  return groups;
}

/**
 * The groups along `path`, its steps in order, turns included, which no group
 * spans. Greedy from the start: a step joins the group before it when it
 * repeats one of its steps and is independent of every one; otherwise it may
 * start the next. A step not landed, or not mergeable, ends a group.
 */
export function foldStepGroups(path: readonly FoldMergeStep[], cache?: FoldMergeCache): FoldStepGroup[] {
  const work = grouping(path, cache);
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
  }
}

/**
 * `foldStepGroups`, sharing the thread: it gives way whenever it has worked
 * `slice` ms, and stops — null — once `live` says the answer is no longer
 * wanted. A dense model's grouping takes up to a second or so.
 */
export async function foldStepGroupsAsync(
  path: readonly FoldMergeStep[],
  { cache, live = () => true, slice = 8 }: { cache?: FoldMergeCache; live?: () => boolean; slice?: number } = {}
): Promise<FoldStepGroup[] | null> {
  const work = grouping(path, cache);
  let since = performance.now();
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
    if (performance.now() - since < slice) continue;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!live()) return null;
    since = performance.now();
  }
}

/**
 * How the run of `group`'s steps `first` through `last` (indices into its
 * steps) would be drawn as one: `mirror` when each step after the first
 * mirrors one before it in the run, `turn` when one only turns one before
 * it, null when one repeats none of them — or the run is one step.
 */
export function runRelation(group: FoldStepGroup, first: number, last: number): StepRelation | null {
  if (first < 0 || last >= group.steps.length || last <= first) return null;
  let relation: StepRelation = 'mirror';
  for (let k = first + 1; k <= last; k += 1) {
    const before = group.related[k]!.slice(first, k);
    if (before.includes('mirror')) continue;
    if (!before.includes('turn')) return null;
    relation = 'turn';
  }
  return relation;
}

/**
 * How step `k` of `group` joins a run that starts at `first`: as a mirror
 * image when it mirrors a step of the run, else as a turned copy — or null
 * when it repeats none of them.
 */
export function joinRelation(group: FoldStepGroup, first: number, k: number): StepRelation | null {
  const before = group.related[k]?.slice(first, k) ?? [];
  return before.includes('mirror') ? 'mirror' : before.includes('turn') ? 'turn' : null;
}

/**
 * The runs `group` starts as, first to last, as [first, last] indices into
 * its steps: a step joins the run before it while it mirrors a step of that
 * run, and `mirrors` is on; a turned copy starts a run of its own — offered,
 * not merged.
 */
export function startingRuns(group: FoldStepGroup, mirrors: boolean): (readonly [number, number])[] {
  const runs: (readonly [number, number])[] = [];
  let first = 0;
  for (let k = 1; k <= group.steps.length; k += 1) {
    const joins = mirrors && k < group.steps.length && joinRelation(group, first, k) === 'mirror';
    if (joins) continue;
    runs.push([first, k - 1]);
    first = k;
  }
  return runs;
}

/**
 * How the steps of `run` — consecutive on a path, as a stored Diagram step
 * names them — are drawn as one: null when they cannot be, one not mergeable
 * or not landed, two sharing paper, or one repeating none before it.
 */
export function runMergeRelation(run: readonly FoldMergeStep[], cache?: FoldMergeCache): StepRelation | null {
  const group = foldStepGroups(run, cache)[0];
  return group && group.steps.length === run.length ? runRelation(group, 0, run.length - 1) : null;
}
