/**
 * The two digests of a Fold sequence, one role each (plan D17, research §10):
 *
 * - **`fh1`, a path's identity**: the canonical paper and, for each node from
 *   the sheet to this one, its op and choices — everything that decides the
 *   state, and nothing else. Marks, notes, a step's layer spread, `expect`
 *   and anything carried are left out, so annotating a step, or spreading
 *   its picture, never changes it. It is the in-memory
 *   replay cache's key (the engine version sits beside it there, as a field
 *   of its own) and guards a Diagram link against an id that now names a
 *   different path.
 * - **`fs1`, a state's fingerprint**: a digest of the state itself, as the
 *   engine spells it with no face, vertex or edge numbers in it. It alone
 *   decides drift (a step's `expect`) and a Diagram link's staleness, so an
 *   engine bump that lands the same states marks nothing changed.
 *
 * Both go through `keyDigest`, the digest the project file's other
 * fingerprints share, prefixed with the algorithm's name so a stored value
 * can be told apart from one a later build would produce.
 *
 * Pure: no React, no store, no engine.
 */

import { isRecord } from '../../lib/documentFile';
import { keyDigest } from '../../lib/keyDigest';
import {
  isLockedStep,
  type FoldPaper,
  type FoldSequenceDocument,
  type FoldStepNode,
} from './foldSequenceDocument';
import { writeFoldChoices, writeFoldOp, writeFoldPaper } from './foldSequenceFile';
import { foldStepTree, pathTo } from './foldStepTree';
import { foldHistoryOp } from './foldLandingMigration';

/** A path's identity: `fh1:` and 16 hex digits. */
export type FoldPathDigest = `fh1:${string}`;

/** A state's fingerprint: `fs1:` and 16 hex digits. */
export type FoldStateFingerprint = `fs1:${string}`;

const PATH_PREFIX = 'fh1:';
const STATE_PREFIX = 'fs1:';

/**
 * One spelling per value: JSON with every object's keys sorted, numbers as
 * JSON writes them — the shortest form that round-trips, `-0` as `0` — and
 * `undefined` fields left out.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    isRecord(entry)
      ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
      : entry
  );
}

/** The paper as `fh1` spells it: the written form, canonical. */
export function foldPaperKey(paper: FoldPaper): string {
  return canonicalJson(writeFoldPaper(paper));
}

const STEP_KEYS = new WeakMap<FoldStepNode, string>();

/**
 * A node as `fh1` spells it: its op and choices in their written form,
 * canonical. A locked node is spelled from the op and choices it came with,
 * which is what the newer build that wrote it spells, under the same `fh1`.
 * Memoised on the node, which a document never mutates.
 */
export function foldStepKey(node: FoldStepNode): string {
  const known = STEP_KEYS.get(node);
  if (known !== undefined) return known;
  const step = isLockedStep(node)
    ? { op: foldHistoryOp(node.unknown.op), choices: node.unknown.choices }
    : { op: foldHistoryOp(writeFoldOp(node.op)), choices: (node.choices && writeFoldChoices(node.choices)) ?? undefined };
  const key = canonicalJson(step);
  STEP_KEYS.set(node, key);
  return key;
}

/** The `fh1` of a path from the sheet — the sheet's own for an empty one — on `paper`. */
export function foldPathDigest(paper: FoldPaper, path: readonly FoldStepNode[]): FoldPathDigest {
  return keyDigest([foldPaperKey(paper), ...path.map(foldStepKey)], PATH_PREFIX) as FoldPathDigest;
}

/** The `fh1` of node `id` of `document`; null for no such node. */
export function foldNodeDigest(document: FoldSequenceDocument, id: string): FoldPathDigest | null {
  const path = pathTo(foldStepTree(document.steps), id);
  return path && foldPathDigest(document.paper, path);
}

/**
 * A state as the engine spells it for its fingerprint: one key per fact of
 * the state — the sheet, each crease by its sheet end points and letter, each
 * ordered pair of overlapping faces by interior sheet-point witnesses, the
 * view — none naming a face, vertex or edge by its number, which a replay is
 * free to change (research §10). The keys may come in any order.
 */
export interface FoldCanonicalState {
  readonly keys: readonly string[];
}

/** The `fs1` of a state: its keys sorted, so the order the engine enumerates them in does not matter. */
export function foldStateFingerprint(state: FoldCanonicalState): FoldStateFingerprint {
  return keyDigest([...state.keys].sort(), STATE_PREFIX) as FoldStateFingerprint;
}

/**
 * What a step's `expect` says of the state it landed on replay:
 *
 * - `same`: the fingerprints agree;
 * - `changed`: the same inputs landed a different state, usually after an
 *   engine change — drift, not breakage;
 * - `unknown`: there is no `expect`, or it was made by another algorithm,
 *   which this build cannot compare.
 */
export type FoldDrift = 'same' | 'changed' | 'unknown';

export function foldDrift(expect: string | undefined, fingerprint: FoldStateFingerprint): FoldDrift {
  if (expect === undefined || !expect.startsWith(STATE_PREFIX)) return 'unknown';
  return expect === fingerprint ? 'same' : 'changed';
}
