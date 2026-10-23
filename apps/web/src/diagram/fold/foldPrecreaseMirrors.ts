/**
 * Whether two precreases one after the other mirror each other, as the Fold
 * session's replay landed them (`foldPrecreaseMerge.ts`'s pairs): Repeat's
 * own check of a mirrored step (`mirroredStepAxis`), asked of the scenes of
 * the state before them and the two they land — the scenes every Fold
 * surface reads (`FOLD_SCENE_QUERY`), so the engine is asked nothing new.
 * Only an axis that takes one step's creases onto the other's is checked,
 * so a pair that plainly does not mirror costs next to nothing.
 *
 * Told once per three states, by their fingerprints, and remembered: the
 * same states mirror alike whichever sequence, browser or send asks.
 *
 * React-free and store-free: the session is injected.
 */

import type { FoldStepNode } from '../../fold/document/foldSequenceDocument';
import { foldStepReady } from '../../fold/io/foldSessionWaits';
import { mirroredStepAxis } from '../../fold/repeat/repeatVerification';
import type { FoldSession } from '../../fold/session/foldSession';
import { FOLD_SCENE_QUERY } from '../../fold/session/foldStateQueries';
import {
  precreaseMergeCandidates,
  resolvePrecreaseMerges,
  type FoldPrecreaseMerge,
} from './foldPrecreaseMerge';

/** What has been told, by {@link precreasePairKey}. */
const told = new Map<string, boolean>();
/** What is being told, so two askers share one answer. */
const telling = new Map<string, Promise<boolean | null>>();
/** How many pairs are remembered: a long sequence's, twice over. */
const TOLD_KEPT = 256;

/** A pair by its states — the one before it, then after each step — or null until all three have landed. */
export function precreasePairKey(before: string | null, first: string | null, second: string | null): string | null {
  return before && first && second ? `${before}|${first}|${second}` : null;
}

/** What is known of a pair by its key: whether its second mirrors its first, or undefined until told. */
export function knownPrecreaseMirror(key: string): boolean | undefined {
  return told.get(key);
}

/**
 * Whether the second step of `pair` mirrors the first: once both have
 * landed, from the scenes the session holds. False when it cannot be told —
 * the steps are not the shown sequence's, not one after the other, or the
 * engine could not say (which is not remembered, so a later ask tries again).
 */
export async function precreasePairMirrors(
  session: FoldSession,
  sequence: string,
  pair: readonly [string, string]
): Promise<boolean> {
  const [first, second] = await Promise.all(pair.map((id) => foldStepReady(session, sequence, id)));
  if (first?.status !== 'ready' || second?.status !== 'ready' || second.parent !== pair[0]) return false;
  const key = precreasePairKey(first.parentFingerprint, first.fingerprint, second.fingerprint)!;
  const known = told.get(key);
  if (known !== undefined) return known;
  let asking = telling.get(key);
  if (!asking) {
    asking = (async () => {
      const scenes = await Promise.all(
        [first.parentState, first.state, second.state].map((state) => session.query(state, FOLD_SCENE_QUERY))
      );
      const [before, after, next] = scenes;
      if (before?.status !== 'answered' || after?.status !== 'answered' || next?.status !== 'answered') return null;
      return mirroredStepAxis(before.value, after.value, next.value) !== null;
    })().finally(() => telling.delete(key));
    telling.set(key, asking);
  }
  const mirrors = await asking;
  if (mirrors === null) return false;
  // The oldest let go first: a Map keeps the order its keys came in.
  if (told.size >= TOLD_KEPT) told.delete(told.keys().next().value!);
  told.set(key, mirrors);
  return mirrors;
}

/**
 * The merges along `path` — the shown sequence's steps in order, turns
 * included — every pair told: what Send steps to Diagram merges.
 */
export async function foldPrecreaseMerges(
  session: FoldSession,
  sequence: string,
  path: readonly FoldStepNode[]
): Promise<FoldPrecreaseMerge[]> {
  const candidates = precreaseMergeCandidates(path);
  const mirrors = await Promise.all(candidates.pairs.map((pair) => precreasePairMirrors(session, sequence, pair)));
  return resolvePrecreaseMerges(
    candidates,
    (pair) => mirrors[candidates.pairs.indexOf(pair)] === true,
    path.map((node) => node.id)
  );
}

/** Forget every pair told: for a test. */
export function forgetPrecreaseMirrorsForTest(): void {
  told.clear();
  telling.clear();
}
