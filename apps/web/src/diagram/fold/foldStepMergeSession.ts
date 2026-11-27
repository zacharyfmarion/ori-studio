/**
 * The merges along a Fold path, told by the Fold session from the scenes it
 * holds (`foldStepMerge.ts`, `foldPrecreaseMerge.ts`): what the From Fold…
 * browser lays out and Send steps to Diagram sends. Each step is read once
 * its replay lands it, its two states' scenes asked of the session
 * (`FOLD_SCENE_QUERY`), so the engine is asked nothing new.
 *
 * What is told of two states is kept by their fingerprints
 * (`sharedFoldMergeCache`), so the same states group alike whichever
 * sequence, browser, send or capture asks.
 *
 * React-free and store-free: the session is injected.
 */

import type { FoldStepNode } from '../../fold/document/foldSequenceDocument';
import type { FoldScene } from '../../fold/engine/foldEngineWire';
import { foldStepReady } from '../../fold/io/foldSessionWaits';
import type { FoldSession } from '../../fold/session/foldSession';
import { FOLD_SCENE_QUERY } from '../../fold/session/foldStateQueries';
import { foldMergeLayout } from './foldMergeLayout';
import { precreaseRepeatRuns } from './foldPrecreaseMerge';
import {
  createFoldMergeCache,
  foldStepGroupsAsync,
  isMergeableStep,
  type FoldMergeCache,
  type FoldMergedRun,
  type FoldMergeStep,
  type FoldStepGroup,
} from './foldStepMerge';

/** What has been told of states, by their fingerprints. */
const cache = createFoldMergeCache();
/** How much is kept before it is let go, all at once: a long sequence's, several times over. */
const KEPT = 4096;

/** The cache every asker shares: the browser's grouping, a send's, and a capture checking a stored run. */
export function sharedFoldMergeCache(): FoldMergeCache {
  if (cache.relations.size + cache.footprints.size > KEPT) {
    cache.relations.clear();
    cache.footprints.clear();
  }
  return cache;
}

/** What a path offers to merge. */
export interface FoldPathMerges {
  /** Steps that may be drawn as one, each a mirror image or turned copy of one before it. */
  readonly groups: readonly FoldStepGroup[];
  /** Precreases and a Repeat of them, each drawn whole. */
  readonly repeats: readonly FoldMergedRun[];
}

/**
 * `path`'s steps as the merge reads them: each that may be drawn with others
 * with its two states' scenes once landed. A step of a Repeat run is drawn
 * with its run, so in no group.
 */
async function mergeSteps(session: FoldSession, sequence: string, path: readonly FoldStepNode[]): Promise<FoldMergeStep[]> {
  const taken = new Set(precreaseRepeatRuns(path).flatMap((run) => run.steps));
  const scenes = new Map<string, Promise<FoldScene | null>>();
  // One question per state: a step's state is the next one's parent.
  const sceneOf = (state: Parameters<FoldSession['query']>[0], fingerprint: string) => {
    let asked = scenes.get(fingerprint);
    if (!asked) {
      asked = session.query(state, FOLD_SCENE_QUERY).then((answer) => (answer.status === 'answered' ? answer.value : null));
      scenes.set(fingerprint, asked);
    }
    return asked;
  };
  return Promise.all(
    path.map(async (node): Promise<FoldMergeStep> => {
      const blank = { id: node.id, before: null, after: null };
      if (!isMergeableStep(node) || taken.has(node.id)) return { ...blank, mergeable: false };
      const ready = await foldStepReady(session, sequence, node.id);
      if (ready.status !== 'ready') return { ...blank, mergeable: true };
      const [before, after] = await Promise.all([
        sceneOf(ready.parentState, ready.parentFingerprint),
        sceneOf(ready.state, ready.fingerprint),
      ]);
      return { id: node.id, mergeable: true, before, after, key: `${ready.parentFingerprint}|${ready.fingerprint}` };
    })
  );
}

/**
 * What `path` — the shown sequence's steps in order, turns included — offers
 * to merge, once every step has landed: told while `live`, null once it is
 * not. The grouping shares the thread (`foldStepGroupsAsync`).
 */
export async function foldPathGroups(
  session: FoldSession,
  sequence: string,
  path: readonly FoldStepNode[],
  live: () => boolean = () => true
): Promise<FoldPathMerges | null> {
  const repeats = precreaseRepeatRuns(path);
  const steps = await mergeSteps(session, sequence, path);
  if (!live()) return null;
  const groups = await foldStepGroupsAsync(steps, { cache: sharedFoldMergeCache(), live });
  return groups ? { groups, repeats } : null;
}

/**
 * The runs Send steps to Diagram draws as one along `path` with Merge
 * symmetric steps on: every Repeat of precreases and mirrored run, never a
 * turned copy — the browser offers those, and starts them apart.
 */
export async function foldPathMerges(
  session: FoldSession,
  sequence: string,
  path: readonly FoldStepNode[]
): Promise<FoldMergedRun[]> {
  const merges = await foldPathGroups(session, sequence, path);
  if (!merges) return [];
  const at = new Map(path.map((node, index) => [node.id, index]));
  return [...foldMergeLayout(merges.groups, merges.repeats, (_, kind) => kind !== 'turn').runs].sort(
    (a, b) => (at.get(a.steps[0]!) ?? 0) - (at.get(b.steps[0]!) ?? 0)
  );
}

/** Forget everything told: for a test. */
export function forgetFoldMergesForTest(): void {
  cache.relations.clear();
  cache.footprints.clear();
}
