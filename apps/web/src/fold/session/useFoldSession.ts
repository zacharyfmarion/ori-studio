import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { WasmErrorEnvelope } from '../../engine/types';
import { reportError } from '../../monitoring';
import { foldSession } from '../../store/workspaceStore/foldSession';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';
import type { FoldSession, FoldStateCall } from './foldSession';
import {
  sameFoldState,
  selectFoldActivePath,
  selectFoldCursorNode,
  selectFoldNode,
  selectFoldReplayProgress,
  type FoldPendingAnalysis,
  type FoldPendingStep,
  type FoldSessionNode,
  type FoldSessionProgress,
  type FoldSessionSnapshot,
} from './foldSessionState';

export interface UseFoldSessionOptions {
  /**
   * Hold the engine while mounted: true (the default) for the workspace's
   * composition site, which keeps the worker running and the sequence
   * replayed while Fold is open; false for a surface inside it that only
   * reads and folds.
   */
  retain?: boolean;
}

export interface FoldSessionSurface {
  /** The step on screen: its status, state and summary. */
  cursor: FoldSessionNode;
  /** Its id; null for the sheet. */
  cursorId: string | null;
  /** The shown sequence is a newer build's: nothing can be committed to it. */
  readOnly: boolean;
  /** The step a tool is folding, before it is committed. */
  pending: FoldPendingStep;
  /** What a fold along the tool's line would move. */
  analysis: FoldPendingAnalysis;
  /** Why the replay stopped short, if it did; {@link FoldSessionSurface.retry} tries again. */
  error: WasmErrorEnvelope | null;
  analyse: FoldSession['analyse'];
  preview: FoldSession['preview'];
  resolveOrders: FoldSession['resolveOrders'];
  axiomRoots: FoldSession['axiomRoots'];
  commitStep: FoldSession['commitStep'];
  cancel: FoldSession['cancel'];
  cancelSearch: FoldSession['cancelSearch'];
  withState: FoldSession['withState'];
  withNode: FoldSession['withNode'];
  withCursor: FoldSession['withCursor'];
  query: FoldSession['query'];
  peek: FoldSession['peek'];
  retry: FoldSession['retry'];
}

/**
 * The Fold session for a surface: the step on screen, the step a tool is
 * folding, and the verbs that fold, commit and query
 * (`fold/session/foldSession.ts`).
 *
 * Every Fold surface reads one session, so the canvas, the strip and the
 * panes never disagree about which state is on screen. The verbs are the
 * session's own and keep their identity across renders. A surface that needs
 * more of the snapshot selects it ({@link useFoldSessionState} and the hooks
 * below), so it re-renders only when that part changes.
 */
export function useFoldSession({ retain = true }: UseFoldSessionOptions = {}): FoldSessionSurface {
  const session = foldSession();
  useEffect(() => (retain ? session.retain() : undefined), [session, retain]);
  const cursor = useStore(session.store, selectFoldCursorNode);
  const cursorId = useStore(session.store, (snapshot) => snapshot.cursor);
  const readOnly = useStore(session.store, (snapshot) => snapshot.readOnly);
  const pending = useStore(session.store, (snapshot) => snapshot.pending);
  const analysis = useStore(session.store, (snapshot) => snapshot.analysis);
  const error = useStore(session.store, (snapshot) => snapshot.error);
  return useMemo(
    () => ({
      cursor,
      cursorId,
      readOnly,
      pending,
      analysis,
      error,
      analyse: session.analyse,
      preview: session.preview,
      resolveOrders: session.resolveOrders,
      axiomRoots: session.axiomRoots,
      commitStep: session.commitStep,
      cancel: session.cancel,
      cancelSearch: session.cancelSearch,
      withState: session.withState,
      withNode: session.withNode,
      withCursor: session.withCursor,
      query: session.query,
      peek: session.peek,
      retry: session.retry,
    }),
    [session, cursor, cursorId, readOnly, pending, analysis, error]
  );
}

/** Any part of the session's snapshot. The selector must return what the snapshot holds, not a new object. */
export function useFoldSessionState<T>(selector: (snapshot: FoldSessionSnapshot) => T): T {
  return useStore(foldSession().store, selector);
}

/** A step of the shown sequence — the sheet for null — or null for none. */
export function useFoldNode(id: string | null): FoldSessionNode | null {
  return useFoldSessionState(useCallback((snapshot: FoldSessionSnapshot) => selectFoldNode(snapshot, id), [id]));
}

/** The step on screen. */
export function useFoldCursor(): FoldSessionNode {
  return useFoldSessionState(selectFoldCursorNode);
}

/** How far the replay of the shown sequence has come. */
export function useFoldReplayProgress(): FoldSessionProgress {
  return useFoldSessionState(selectFoldReplayProgress);
}

/** The active path's step ids, the first step first. */
export function useFoldActivePath(): readonly string[] {
  return useFoldSessionState(selectFoldActivePath);
}

/**
 * The answer to a query on a step's state — the sheet's for null — asked
 * again whenever that state changes: null until it answers, and while the
 * step has no state. The query should be a module-level function or
 * memoised; a new one asks again.
 *
 * ```ts
 * const summary = useFoldNodeQuery(stepId, (engine, state) => engine.summary(state));
 * ```
 */
export function useFoldNodeQuery<T>(id: string | null, call: FoldStateCall<T>): T | null {
  return useFoldStateQuery(useFoldNode(id)?.state ?? null, call);
}

/**
 * The answer to a query on a landed state — a step's, or the one a tool is
 * folding — asked again whenever the state changes: null until it answers,
 * and for no state. As {@link useFoldNodeQuery}, the query should be a
 * module-level function or memoised, and pure: the session asks it once per
 * state for every surface (`FoldSession.query`), so an answer another
 * surface already has is there on the first render.
 */
export function useFoldStateQuery<T>(state: FoldEngineStateHandle | null, call: FoldStateCall<T>): T | null {
  const session = foldSession();
  const [answer, setAnswer] = useState<{ state: FoldEngineStateHandle; call: FoldStateCall<T>; value: T } | null>(
    null
  );
  const held = state ? session.peek(state, call) : null;
  useEffect(() => {
    if (!state || session.peek(state, call)) return undefined;
    let current = true;
    void session.query(state, call).then(
      (result) => {
        if (current && result.status === 'answered') setAnswer({ state, call, value: result.value });
      },
      // Not the user's to act on: the surface shows nothing for it, and the
      // next state asks again. A loss never gets here (it is unavailable).
      (error: unknown) => reportError(error, { surface: 'fold:session-query' })
    );
    return () => {
      current = false;
    };
  }, [session, state, call]);
  if (held) return held.value;
  // An answer about another state, or to another query, is not this one's.
  return answer && answer.call === call && sameFoldState(answer.state, state) ? answer.value : null;
}
