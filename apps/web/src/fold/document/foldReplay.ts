/**
 * Replaying a Fold sequence: every node's state, derived from its path, and
 * every node's status (plan D6, research §10).
 *
 * States are never stored. Opening a sequence, undoing, redoing or committing
 * replays it against the engine through a {@link FoldEnginePort} —
 * `fold/engine/foldEnginePort.ts` adapts the wasm bridge's worker to it; tests
 * mock it — and caches what landed in
 * memory, keyed by the path's `fh1` with the engine version beside it. Replay
 * is deterministic, so a cached path is never asked of the engine twice: undo
 * recomputes nothing, and a sequence reopened in the same session replays
 * from the cache.
 *
 * - **The active path first**, step by step, reporting progress, so the step
 *   on screen is ready before the branches nobody is looking at; then the
 *   rest of the tree, breadth-first.
 * - **Latest wins.** A run stops at its next engine call once another run
 *   starts or the replayer is cancelled, and reports nothing more. Which run
 *   is latest is the order they start in, never their `loadId`: a load id
 *   names a document, and a failed open puts back one with an older id than
 *   the discard it undid.
 * - **Status is derived, never stored** ({@link FoldStepStatus}).
 *
 * Pure orchestration: no React, no store, no wasm.
 */

import { resolveFoldReturn } from './foldReturn';
import {
  foldDrift,
  foldPathDigest,
  type FoldPathDigest,
  type FoldStateFingerprint,
} from './foldDigest';
import {
  isLockedStep,
  type FoldChoices,
  type FoldOp,
  type FoldPaper,
  type FoldSequenceDocument,
} from './foldSequenceDocument';
import {
  activePath,
  foldStepTree,
  lockedIds,
  pathTo,
  replayOrder,
  type FoldActiveChildren,
} from './foldStepTree';
import type { FoldCap } from '../foldCaps';

/** What the engine made of one step, or of the sheet. */
export type FoldEngineOutcome<S> =
  | { landed: true; state: S; fingerprint: FoldStateFingerprint }
  /**
   * The inputs no longer resolve, or a stored choice conflicts or is
   * ambiguous: the engine's refusal code, and its counts when the state would
   * have been over one of Fold's caps (too many faces, or stacked too deep).
   */
  | { landed: false; code: string; cap?: FoldCap };

/**
 * The engine as replay drives it: the one declaration of the port, which
 * `createFoldEnginePort` implements over the wasm bridge. The paper, ops and
 * choices are the document's own, and cross to the engine unchanged. `S` is
 * whatever names a landed state to the engine — a handle into a worker, or
 * the state itself.
 */
export interface FoldEnginePort<S> {
  /** The engine's `FOLD_ENGINE_VERSION`, stored beside every cached state. */
  readonly engineVersion: number;
  /** The flat sheet a sequence starts from. */
  sheet(paper: FoldPaper): Promise<FoldEngineOutcome<S>>;
  /** One step, from its parent's landed state. */
  step(parent: S, step: { op: FoldOp; choices?: FoldChoices }): Promise<FoldEngineOutcome<S>>;
  /** A resolved historical return; step is supplied for preview adoption. */
  returnTo?(parent: S, target: S, history: readonly S[], step: { op: FoldOp; choices?: FoldChoices }): Promise<FoldEngineOutcome<S>>;
  /** Let go of a state the cache no longer holds. */
  release?(state: S): void;
}

/**
 * A node's status:
 *
 * - `pending`: not replayed yet;
 * - `ok`: it landed, at the state it was committed at, or it holds no
 *   fingerprint to compare;
 * - `changed`: it landed, with the same inputs, at a different state than its
 *   `expect` — drift, usually after an engine change, not breakage;
 * - `broken`: its inputs no longer resolve, or a stored choice no longer
 *   resolves to exactly one result; so is its whole subtree, and its
 *   siblings are unaffected;
 * - `locked`: this build cannot read it, or it folds from one it cannot; so
 *   is its whole subtree. Nothing locked is replayed.
 *
 * The first node on a path that is broken or locked decides for everything
 * below it.
 */
export type FoldStepStatus = 'pending' | 'ok' | 'changed' | 'broken' | 'locked';

/** Where and why a node broke: the engine's code, and the node that refused — null for the sheet. */
export interface FoldReplayRefusal {
  at: string | null;
  code: string;
  /** Over one of Fold's caps: its counts, for the step's notice to name. */
  cap?: FoldCap;
}

/** A node's replay, or the sheet's. */
export interface FoldNodeReplay<S> {
  status: FoldStepStatus;
  /** Its path's identity. */
  path: FoldPathDigest;
  /** The landed state, when ok or changed. */
  state: S | null;
  fingerprint: FoldStateFingerprint | null;
  /** Set when broken. */
  refusal: FoldReplayRefusal | null;
}

export interface FoldReplayProgress<S> {
  loadId: number;
  sequenceId: string;
  /** The flat sheet: `pending`, `ok`, or `broken` — and then so is every node. */
  sheet: FoldNodeReplay<S>;
  /** Every node of the sequence, by id. */
  steps: ReadonlyMap<string, FoldNodeReplay<S>>;
  /** Every node has its status. */
  done: boolean;
}

export interface FoldReplayRequest {
  /** The load of the document this replays, reported back with its progress so the caller can match the two. */
  loadId: number;
  sequence: FoldSequenceDocument;
  /** The reader's active children, which decide the path replayed first. */
  activeChild?: FoldActiveChildren;
}

export interface FoldReplayer<S> {
  /**
   * Replay a sequence. `onProgress` hears after each state the engine
   * computed, and once more when done, so a run served wholly from the cache
   * reports once. Resolves with the final progress, or null when the run was
   * superseded or cancelled. Rejects only when the port does, and only for a
   * run still current.
   */
  run(
    request: FoldReplayRequest,
    onProgress?: (progress: FoldReplayProgress<S>) => void
  ): Promise<FoldReplayProgress<S> | null>;
  /** Stop the current run, if any, without starting another. */
  cancel(): void;
  /**
   * Stop the current run and forget every state, releasing each: for when the
   * engine behind the port lost them (a respawned worker).
   */
  clear(): void;
}

export interface FoldReplayerOptions {
  /**
   * How many states the cache keeps beyond those of the newest finished run,
   * least recently used out first: the states undo and redo come back to.
   * 256 by default.
   */
  capacity?: number;
}

const DEFAULT_CAPACITY = 256;

type Outcome<S> = FoldEngineOutcome<S> | Promise<FoldEngineOutcome<S>>;

export function createFoldReplayer<S>(port: FoldEnginePort<S>, options: FoldReplayerOptions = {}): FoldReplayer<S> {
  const capacity = Math.max(0, options.capacity ?? DEFAULT_CAPACITY);
  const cache = new ReplayCache(port);
  /** Engine calls under way, by path, so a run that supersedes another waits on its call rather than repeating it. */
  const inFlight = new Map<FoldPathDigest, Promise<FoldEngineOutcome<S>>>();
  let generation = 0;
  let running = 0;
  /** Bumped by `clear`, so an answer to a call made before it is never cached after it. */
  let epoch = 0;

  const outcomeOf = (path: FoldPathDigest, compute: () => Promise<FoldEngineOutcome<S>>): Outcome<S> => {
    const cached = cache.get(path);
    if (cached) return cached;
    const pending = inFlight.get(path);
    if (pending) return pending;
    const callEpoch = epoch;
    const settle = () => {
      if (callEpoch === epoch) inFlight.delete(path);
    };
    const call = compute().then(
      (outcome) => {
        settle();
        if (callEpoch === epoch) cache.set(path, outcome);
        return outcome;
      },
      (error: unknown) => {
        settle();
        throw error;
      }
    );
    inFlight.set(path, call);
    return call;
  };

  const run = async (
    request: FoldReplayRequest,
    onProgress?: (progress: FoldReplayProgress<S>) => void
  ): Promise<FoldReplayProgress<S> | null> => {
    const ticket = ++generation;
    const current = () => ticket === generation;
    const touched = new Set<FoldPathDigest>();
    running += 1;
    try {
      const done = await replay(request, port, current, (path, compute) => {
        touched.add(path);
        return outcomeOf(path, compute);
      }, onProgress);
      if (done) cache.pin(touched);
      return done;
    } catch (error) {
      if (!current()) return null;
      throw error;
    } finally {
      running -= 1;
      if (running === 0) cache.trim(capacity);
    }
  };

  return {
    run,
    cancel: () => {
      generation += 1;
    },
    clear: () => {
      generation += 1;
      epoch += 1;
      inFlight.clear();
      cache.clear();
    },
  };
}

/** One run: the sheet, the active path, then the rest of the tree, each node after its parent. */
async function replay<S>(
  { loadId, sequence, activeChild = {} }: FoldReplayRequest,
  port: FoldEnginePort<S>,
  current: () => boolean,
  outcomeOf: (path: FoldPathDigest, compute: () => Promise<FoldEngineOutcome<S>>) => Outcome<S>,
  onProgress: ((progress: FoldReplayProgress<S>) => void) | undefined
): Promise<FoldReplayProgress<S> | null> {
  const { paper } = sequence;
  const tree = foldStepTree(sequence.steps);
  const locked = lockedIds(tree);
  const steps = new Map<string, FoldNodeReplay<S>>();
  for (const node of sequence.steps) {
    const path = foldPathDigest(paper, pathTo(tree, node.id) ?? [node]);
    steps.set(node.id, unlanded(locked.has(node.id) ? 'locked' : 'pending', path, null));
  }
  let sheet: FoldNodeReplay<S> = unlanded('pending', foldPathDigest(paper, []), null);
  const progress = (done: boolean): FoldReplayProgress<S> => ({
    loadId,
    sequenceId: sequence.id,
    sheet,
    steps: new Map(steps),
    done,
  });

  const sheetAnswer = outcomeOf(sheet.path, () => port.sheet(paper));
  const sheetOutcome = await sheetAnswer;
  if (!current()) return null;
  sheet = landing(sheet.path, sheetOutcome, undefined, null);
  if (sheetAnswer instanceof Promise) onProgress?.(progress(false));

  for (const node of replayOrder(tree, activePath(tree, activeChild))) {
    const parent = node.parent === null ? sheet : steps.get(node.parent);
    const own = steps.get(node.id);
    if (!parent || !own) continue;
    const inherited = inheritedStatus(parent, node.id, locked);
    if (inherited) {
      steps.set(node.id, unlanded(inherited, own.path, inherited === 'broken' ? parent.refusal : null));
      continue;
    }
    const parentState = parent.state;
    if (isLockedStep(node) || parentState === null) continue;
    const { op, choices } = node;
    const request = choices ? { op, choices } : { op };
    const dependency = op.kind === 'unfold-to' ? resolveFoldReturn(sequence, node.parent, op, sheet, steps) : null;
    // Validate dependencies even before serving a cached result.
    if (dependency && 'code' in dependency) {
      steps.set(node.id, unlanded('broken', own.path, { at: node.id, code: dependency.code }));
      continue;
    }
    const answer = outcomeOf(own.path, () => dependency
      ? port.returnTo?.(parentState, dependency.target, dependency.history, request)
        ?? Promise.resolve({ landed: false, code: 'return_unavailable' })
      : port.step(parentState, request));
    const outcome = await answer;
    if (!current()) return null;
    steps.set(node.id, landing(own.path, outcome, node.expect, node.id));
    if (answer instanceof Promise) onProgress?.(progress(false));
  }

  const done = progress(true);
  onProgress?.(done);
  return done;
}

/**
 * The status a node takes from above it, if any: the first broken or locked
 * node on its path decides; a node this build cannot read locks itself.
 */
function inheritedStatus<S>(
  parent: FoldNodeReplay<S>,
  id: string,
  locked: ReadonlySet<string>
): 'broken' | 'locked' | null {
  if (parent.status === 'broken' || parent.status === 'locked') return parent.status;
  return locked.has(id) ? 'locked' : null;
}

function unlanded<S>(
  status: FoldStepStatus,
  path: FoldPathDigest,
  refusal: FoldReplayRefusal | null
): FoldNodeReplay<S> {
  return { status, path, state: null, fingerprint: null, refusal };
}

/** A node's replay from what the engine made of it; `at` is the node, null for the sheet. */
function landing<S>(
  path: FoldPathDigest,
  outcome: FoldEngineOutcome<S>,
  expect: string | undefined,
  at: string | null
): FoldNodeReplay<S> {
  if (!outcome.landed) {
    return unlanded('broken', path, { at, code: outcome.code, ...(outcome.cap ? { cap: outcome.cap } : {}) });
  }
  const { state, fingerprint } = outcome;
  const status = foldDrift(expect, fingerprint) === 'changed' ? 'changed' : 'ok';
  return { status, path, state, fingerprint, refusal: null };
}

/**
 * What the engine made of each path, keyed by `fh1` and kept with the engine
 * version that made it: an entry another version made is never served.
 * Least recently used first, by the map's own order.
 *
 * Trimmed only between runs, never during one, and never of the states the
 * newest finished run landed — the ones the reader is looking at — so a state
 * a run or the reader still holds is never released under it.
 */
class ReplayCache<S> {
  private readonly entries = new Map<FoldPathDigest, { engine: number; outcome: FoldEngineOutcome<S> }>();
  private pinned: ReadonlySet<FoldPathDigest> = new Set();

  constructor(private readonly port: FoldEnginePort<S>) {}

  get(path: FoldPathDigest): FoldEngineOutcome<S> | undefined {
    const entry = this.entries.get(path);
    if (!entry || entry.engine !== this.port.engineVersion) return undefined;
    this.entries.delete(path);
    this.entries.set(path, entry);
    return entry.outcome;
  }

  set(path: FoldPathDigest, outcome: FoldEngineOutcome<S>): void {
    const old = this.entries.get(path);
    this.entries.delete(path);
    if (old && !(old.outcome.landed && outcome.landed && old.outcome.state === outcome.state)) {
      this.release(old.outcome);
    }
    this.entries.set(path, { engine: this.port.engineVersion, outcome });
  }

  /** Keep these paths through every trim, until the next pin. */
  pin(paths: ReadonlySet<FoldPathDigest>): void {
    this.pinned = paths;
  }

  /** Release the least recently used entries until at most `capacity` beyond the pinned ones remain. */
  trim(capacity: number): void {
    let held = 0;
    for (const path of this.pinned) if (this.entries.has(path)) held += 1;
    let excess = this.entries.size - held - capacity;
    for (const [path, entry] of this.entries) {
      if (excess <= 0) break;
      if (this.pinned.has(path)) continue;
      this.entries.delete(path);
      this.release(entry.outcome);
      excess -= 1;
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) this.release(entry.outcome);
    this.entries.clear();
    this.pinned = new Set();
  }

  private release(outcome: FoldEngineOutcome<S>): void {
    if (outcome.landed) this.port.release?.(outcome.state);
  }
}
