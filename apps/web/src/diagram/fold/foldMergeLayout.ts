/**
 * How the From Fold… browser lays out a path's merges
 * (`implementation-plans/diagram-merge-symmetric-folds.md`): which runs of
 * steps are one card, and where it offers to join two cards — from the
 * groups (`foldStepMerge.ts`), the Repeats of precreases, and whether each
 * place between two steps is joined.
 *
 * A place is joined as the reader chose; else as the diagram already draws
 * those steps; else a mirror image or a Repeat is joined while Merge
 * symmetric steps is on, and a turned copy never is — it is offered.
 *
 * Pure: no React, no store, no engine.
 */

import { joinRelation, runRelation, type FoldMergedRun, type FoldStepGroup } from './foldStepMerge';

/** How two cards would be one: a mirror image, a turned copy, precreases and their Repeat. */
export type FoldMergeKind = FoldMergedRun['kind'];

/** A place between two steps of the path, by their ids. */
export function boundaryKey(before: string, after: string): string {
  return `${before}|${after}`;
}

/** The offer to join a card with the next one. */
export interface FoldJoinOffer {
  /** The place between them. */
  readonly key: string;
  /** What joining makes. */
  readonly kind: FoldMergeKind;
}

export interface FoldMergeLayout {
  /** The runs drawn as one card, in no particular order: two or more steps each. */
  readonly runs: readonly FoldMergedRun[];
  /** By the last step of a card: the offer to join it with the card after it. */
  readonly offers: ReadonlyMap<string, FoldJoinOffer>;
}

/**
 * The layout of `groups` and `repeats` — each Repeat run drawn whole or step
 * by step — every place joined as `joined` says, given how it would join. A
 * group's run grows while its next place is joined and the run stays one
 * step (`runRelation`); where two of its runs could be one, the first offers
 * to join. A Repeat run is one card while its last place is joined, and
 * offers that place while it is not.
 */
export function foldMergeLayout(
  groups: readonly FoldStepGroup[],
  repeats: readonly FoldMergedRun[],
  joined: (key: string, kind: FoldMergeKind) => boolean
): FoldMergeLayout {
  const runs: FoldMergedRun[] = [];
  const offers = new Map<string, FoldJoinOffer>();
  for (const group of groups) {
    const parts: [number, number][] = [];
    let first = 0;
    for (let k = 1; k <= group.steps.length; k += 1) {
      if (k < group.steps.length) {
        const key = boundaryKey(group.steps[k - 1]!, group.steps[k]!);
        const kind = joinRelation(group, first, k);
        if (kind && joined(key, kind)) continue;
      }
      parts.push([first, k - 1]);
      first = k;
    }
    for (const [a, b] of parts) {
      const kind = runRelation(group, a, b);
      if (kind) runs.push({ steps: group.steps.slice(a, b + 1), kind });
    }
    for (let p = 1; p < parts.length; p += 1) {
      const [a, b] = parts[p - 1]!;
      const [, c] = parts[p]!;
      const kind = runRelation(group, a, c);
      if (kind) offers.set(group.steps[b]!, { key: boundaryKey(group.steps[b]!, group.steps[b + 1]!), kind });
    }
  }
  for (const run of repeats) {
    const last = run.steps.length - 1;
    if (last < 1) continue;
    const key = boundaryKey(run.steps[last - 1]!, run.steps[last]!);
    if (joined(key, 'repeat')) runs.push(run);
    else offers.set(run.steps[last - 1]!, { key, kind: 'repeat' });
  }
  return { runs, offers };
}

/** A Diagram step drawn from the sequence: the Fold step it shows, or the run it draws as one. */
export interface FoldDrawnSource {
  readonly step: string;
  readonly through?: string;
  readonly moment: 'before' | 'after';
}

/**
 * How the diagram already draws the path's steps, by place: every place
 * inside a run it made one step joined, every place between two steps it
 * made apart split. A place it says nothing of is absent.
 */
export function diagramJoins(sources: readonly FoldDrawnSource[], path: readonly string[]): Map<string, boolean> {
  const at = new Map(path.map((id, index) => [id, index]));
  const alone = new Set<number>();
  const joins = new Map<string, boolean>();
  for (const source of sources) {
    if (source.moment !== 'before') continue;
    const first = at.get(source.step);
    if (first === undefined) continue;
    if (source.through === undefined) {
      alone.add(first);
      continue;
    }
    const last = at.get(source.through);
    if (last === undefined || last <= first) continue;
    for (let k = first + 1; k <= last; k += 1) joins.set(boundaryKey(path[k - 1]!, path[k]!), true);
  }
  for (const k of alone) {
    if (alone.has(k + 1) && !joins.has(boundaryKey(path[k]!, path[k + 1]!))) joins.set(boundaryKey(path[k]!, path[k + 1]!), false);
  }
  return joins;
}
