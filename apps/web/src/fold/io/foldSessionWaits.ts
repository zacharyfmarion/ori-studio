/**
 * Waiting for the Fold session to have the states a hand-off needs: the step
 * on screen, for an import after it or Send to Edit, and the whole active
 * path for the sequence exports.
 *
 * A hold on the session starts a replay; these resolve once it has landed
 * what they ask for, or as soon as it cannot: the session is not held, the
 * step is broken or locked, or the replay stopped (`error`). Every replay
 * ends by publishing, so neither waits for ever while the session is held.
 *
 * Pure: no React, no store.
 */

import type { FoldPathDigest, FoldStateFingerprint } from '../document/foldDigest';
import type { FoldOp, FoldPaper } from '../document/foldSequenceDocument';
import { foldedLineOf, type FoldedLine } from '../engine/foldEngineCompoundWire';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';
import type { FoldSession } from '../session/foldSession';
import { selectFoldCursorNode, type FoldSessionNode, type FoldSessionSnapshot } from '../session/foldSessionState';

export type FoldWaitUnavailable = { readonly status: 'unavailable'; readonly reason: 'not-live' | 'read-only' | 'no-state' };

/** The step on screen, landed: where an import is added or Send to Edit reads from. */
export interface FoldCursorReady {
  readonly status: 'ready';
  readonly state: FoldEngineStateHandle;
  /** The step's id; null for the sheet. */
  readonly cursor: string | null;
  /** The sequence has no step yet: an import adopts its sheet (plan D16). */
  readonly empty: boolean;
  readonly paper: FoldPaper;
}

/** A step of the active path, landed. */
export interface FoldPathStep {
  readonly id: string;
  readonly op: FoldOp;
  readonly state: FoldEngineStateHandle;
}

/** The active path, landed: the sheet's state, then each step's, the first first. */
export interface FoldPathReady {
  readonly status: 'ready';
  readonly sheet: FoldEngineStateHandle;
  readonly steps: readonly FoldPathStep[];
}

/** The first answer `read` gives, now or once the session publishes one. */
function untilAnswered<T>(session: FoldSession, read: (snapshot: FoldSessionSnapshot) => T | undefined): Promise<T> {
  const now = read(session.store.getState());
  if (now !== undefined) return Promise.resolve(now);
  return new Promise((resolve) => {
    const unsubscribe = session.store.subscribe((snapshot) => {
      const answer = read(snapshot);
      if (answer === undefined) return;
      unsubscribe();
      resolve(answer);
    });
  });
}

const unavailable = (reason: FoldWaitUnavailable['reason']): FoldWaitUnavailable => ({ status: 'unavailable', reason });

/** A node's state, `null` when it settled without one, or undefined while the replay may still land it. */
function landedState(node: FoldSessionNode, snapshot: FoldSessionSnapshot): FoldEngineStateHandle | null | undefined {
  if (node.state) return node.state;
  if (node.status !== 'pending') return null;
  // Pending with the replay stopped short: nothing more will land until a retry.
  return snapshot.error ? null : undefined;
}

/** The selected state once replay lands it. Read access also accepts a read-only sequence. */
export function foldCursorReady(
  session: FoldSession,
  at?: string | null,
  access: 'edit' | 'read' = 'edit'
): Promise<FoldCursorReady | FoldWaitUnavailable> {
  return untilAnswered(session, (snapshot) => {
    if (!snapshot.live) return unavailable('not-live');
    if (access === 'edit' && snapshot.readOnly) return unavailable('read-only');
    const node = at === undefined ? selectFoldCursorNode(snapshot) : at === null ? snapshot.sheet : snapshot.nodes.get(at);
    if (!node) return unavailable('no-state');
    const state = landedState(node, snapshot);
    if (state === undefined) return undefined;
    if (state === null) return unavailable('no-state');
    return {
      status: 'ready',
      state,
      cursor: at === undefined ? snapshot.cursor : at,
      empty: (snapshot.sequence?.steps.length ?? 0) === 0,
      paper: snapshot.paper,
    };
  });
}

/** A step of the shown sequence and the state it folds from, both landed: what a Diagram step is drawn from (plan D17). */
export interface FoldStepReady {
  readonly status: 'ready';
  /** The step's own state, and its `fs1`. */
  readonly state: FoldEngineStateHandle;
  readonly fingerprint: FoldStateFingerprint;
  /** The state it folds from — its parent's, or the sheet's — and its `fs1`. */
  readonly parentState: FoldEngineStateHandle;
  readonly parentFingerprint: FoldStateFingerprint;
  /** Its parent's id; null when it folds from the sheet. */
  readonly parent: string | null;
  /** Its path's identity. */
  readonly path: FoldPathDigest;
  readonly op: FoldOp;
  /**
   * The line it folded along and the side that moved, a plain fold's or a
   * compound fold's, and whether a plain fold only unfolded, as Fold's strip
   * reads them (`foldedLineOf`); null for a turn, a rotation, an import and a
   * vertex fold.
   */
  readonly folded: FoldedLine | null;
}

/**
 * Why a step cannot be drawn from: the session is not held, the step is not
 * in the sequence Fold shows (`not-shown` — it shows one, plan D7), there is
 * no such step (`missing`), it no longer folds (`broken`), or a newer build
 * made it or a step above it (`locked`).
 */
export type FoldStepWaitRefusal = {
  readonly status: 'unavailable';
  readonly reason: 'not-live' | 'not-shown' | 'missing' | 'broken' | 'locked';
};

const refused = (reason: FoldStepWaitRefusal['reason']): FoldStepWaitRefusal => ({ status: 'unavailable', reason });

/** A step of sequence `sequenceId` once it and the state it folds from have landed, or why it cannot be drawn from. */
export function foldStepReady(
  session: FoldSession,
  sequenceId: string,
  stepId: string
): Promise<FoldStepReady | FoldStepWaitRefusal> {
  return untilAnswered(session, (snapshot): FoldStepReady | FoldStepWaitRefusal | undefined => {
    if (!snapshot.live) return refused('not-live');
    if (snapshot.sequence?.id !== sequenceId) return refused('not-shown');
    const held = snapshot.sequence.steps.find((node) => node.id === stepId);
    const node = snapshot.nodes.get(stepId);
    if (!held || !node) return refused('missing');
    if (node.status === 'broken') return refused('broken');
    if (node.status === 'locked' || held.op === undefined) return refused('locked');
    const parentNode = held.parent === null ? snapshot.sheet : snapshot.nodes.get(held.parent);
    if (!parentNode) return refused('missing');
    const state = landedState(node, snapshot);
    const parentState = landedState(parentNode, snapshot);
    if (state === undefined || parentState === undefined) return undefined;
    // Pending with the replay stopped short is the engine's failing, not the step's.
    if (state === null || parentState === null) {
      return refused(node.status === 'pending' || parentNode.status === 'pending' ? 'not-live' : 'broken');
    }
    // One engine's handles: a loss mid-wait renumbers them, and the replay then lands them again.
    if (state.generation !== parentState.generation) return undefined;
    if (!node.fingerprint || !parentNode.fingerprint || !node.path) return undefined;
    return {
      status: 'ready',
      state,
      fingerprint: node.fingerprint,
      parentState,
      parentFingerprint: parentNode.fingerprint,
      parent: held.parent,
      path: node.path,
      op: held.op,
      folded: foldedLineOf(node),
    };
  });
}

/** The active path once every step of it has landed, or why it cannot be handed off. */
export function foldPathReady(session: FoldSession): Promise<FoldPathReady | FoldWaitUnavailable> {
  return untilAnswered(session, (snapshot) => {
    if (!snapshot.live) return unavailable('not-live');
    const sheet = landedState(snapshot.sheet, snapshot);
    if (sheet === undefined) return undefined;
    if (sheet === null) return unavailable('no-state');
    const byId = new Map((snapshot.sequence?.steps ?? []).map((node) => [node.id, node]));
    const steps: FoldPathStep[] = [];
    for (const id of snapshot.activePath) {
      const node = snapshot.nodes.get(id);
      const held = byId.get(id);
      if (!node || !held) return unavailable('no-state');
      const state = landedState(node, snapshot);
      if (state === undefined) return undefined;
      // A broken or locked step: the path cannot be followed past it.
      if (state === null || held.op === undefined) return unavailable('no-state');
      steps.push({ id, op: held.op, state });
    }
    // One engine's handles: a loss mid-wait renumbers them, and the replay then lands them again.
    if (steps.some((step) => step.state.generation !== sheet.generation)) return undefined;
    return { status: 'ready', sheet, steps };
  });
}
