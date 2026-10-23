/**
 * Answers to the pure queries on landed states (`FoldSession.query`): a
 * scene, landmarks, a step's summary or picture. A state never changes under
 * its handle, so the same query on the same state always answers the same,
 * and every surface that asks it — the canvas, the strip, the Step pane, the
 * playback, the tool's preview — shares one ask of the engine and its answer.
 *
 * - **A query is its function.** Module-level or memoised, as the session's
 *   hooks already require: a new function is a new query.
 * - **One ask per state.** An answer on its way is shared; one that came is
 *   kept, the most recently used of each query last to go.
 * - **Only answers are kept.** A state no longer held, or an error, keeps
 *   nothing, so the next ask goes to the engine again.
 *
 * Pure: no React, no store, no worker.
 */

import type { FoldEngineStateHandle } from '../engine/foldEnginePort';

/** A query's answer, or word that the state is not held: what `FoldSession.withState` resolves with. */
export type FoldAnswer<T> = { readonly status: 'answered'; readonly value: T } | { readonly status: 'unavailable' };

interface Entry {
  readonly asked: Promise<FoldAnswer<unknown>>;
  answer: { value: unknown } | null;
}

export interface FoldSessionAnswers<Q extends object> {
  /** The answer already in, if any: what a surface can show on its first paint. */
  peek<T>(state: FoldEngineStateHandle, query: Q): { value: T } | null;
  /** The answer, asked through `ask` only when nobody has asked it yet. */
  get<T, A extends FoldAnswer<T>>(state: FoldEngineStateHandle, query: Q, ask: () => Promise<A>): Promise<A>;
  /**
   * Keep an answer the engine gave with another call (a preview's turn reads
   * its landed state's scene with it): what `get` would have asked for. An
   * answer already in, or on its way, stands.
   */
  put<T>(state: FoldEngineStateHandle, query: Q, value: T): void;
  /** Forget every answer: the engine that held the states is gone, or is being let go. */
  clear(): void;
}

const keyOf = (state: FoldEngineStateHandle) => `${state.generation}:${state.id}`;

/** Up to `kept` answers of each query, besides those still on their way. */
export function createFoldSessionAnswers<Q extends object>(kept: number): FoldSessionAnswers<Q> {
  // By the query's function, so a query nobody holds any more goes with its answers.
  let byQuery = new WeakMap<Q, Map<string, Entry>>();

  const entriesOf = (query: Q): Map<string, Entry> => {
    let entries = byQuery.get(query);
    if (!entries) {
      entries = new Map();
      byQuery.set(query, entries);
    }
    return entries;
  };

  /** Look an entry up, and make it the most recently used. */
  const touch = (entries: Map<string, Entry>, key: string): Entry | undefined => {
    const entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
    }
    return entry;
  };

  const trim = (entries: Map<string, Entry>) => {
    let answered = 0;
    for (const entry of entries.values()) if (entry.answer) answered += 1;
    for (const [key, entry] of entries) {
      if (answered <= kept) break;
      if (!entry.answer) continue;
      entries.delete(key);
      answered -= 1;
    }
  };

  return {
    peek<T>(state: FoldEngineStateHandle, query: Q) {
      return (touch(entriesOf(query), keyOf(state))?.answer ?? null) as { value: T } | null;
    },

    get<T, A extends FoldAnswer<T>>(state: FoldEngineStateHandle, query: Q, ask: () => Promise<A>): Promise<A> {
      const entries = entriesOf(query);
      const key = keyOf(state);
      const held = touch(entries, key);
      if (held) return held.asked as Promise<A>;
      const settle = (keep: { value: unknown } | null) => {
        // Cleared, or asked again, meanwhile: the answer is the caller's alone.
        if (entries.get(key) !== entry) return;
        if (keep) {
          entry.answer = keep;
          trim(entries);
        } else {
          entries.delete(key);
        }
      };
      const asked = ask().then(
        (answer) => {
          settle(answer.status === 'answered' ? { value: answer.value } : null);
          return answer;
        },
        (error: unknown) => {
          settle(null);
          throw error;
        }
      );
      const entry: Entry = { asked, answer: null };
      entries.set(key, entry);
      return asked;
    },

    put<T>(state: FoldEngineStateHandle, query: Q, value: T) {
      const entries = entriesOf(query);
      const key = keyOf(state);
      if (entries.has(key)) return;
      const answered: FoldAnswer<T> = { status: 'answered', value };
      entries.set(key, { asked: Promise.resolve(answered), answer: { value } });
      trim(entries);
    },

    clear() {
      byQuery = new WeakMap();
    },
  };
}
