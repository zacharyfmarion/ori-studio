import { useCallback, useRef, useState } from 'react';
import { reportError } from '../../../monitoring';
import type { FoldVertexOp } from '../../document/foldSequenceDocument';
import type { FoldVertexAnalysis } from '../../engine/foldEngineSquashWire';
import type { FoldSessionSurface } from '../../session/useFoldSession';

/** What the engine said of the flap at a key: being asked, a flap it describes, or none. */
export type FoldFlapAnswer<A> = { status: 'asking' } | { status: 'flap'; analysis: A } | { status: 'none' };

interface Answers<A> {
  /** The state and what the tool has named, as they were asked for. */
  scope: string;
  byKey: Readonly<Record<string, FoldFlapAnswer<A>>>;
}

/** The engine's answers about the flaps under the pointer, and how to ask about another. */
export interface FoldFlapAnswers<A> {
  byKey: Readonly<Record<string, FoldFlapAnswer<A>>>;
  /** Ask about the flap a key names, by the op that folds it: once per key in the scope; none for no op. */
  ask: (key: string, op: FoldVertexOp | null) => void;
}

/**
 * A vertex tool's flaps under the pointer, before one is clicked
 * (`useFoldPetalMarks`, `useFoldSquashMarks`): each key — the layer the
 * pointer is over, and whatever else makes it another flap — is asked of the
 * engine once in its `scope` (the compound question), and `read` keeps the
 * answer when it describes a flap of the tool's kind. A new scope — another
 * state, another hinge, another way — asks anew. Null scope asks nothing.
 */
export function useFoldFlapAnswers<A>(
  session: FoldSessionSurface,
  scope: string | null,
  read: (analysis: FoldVertexAnalysis) => A | null,
  surface: string
): FoldFlapAnswers<A> {
  const { withCursor } = session;
  const [answers, setAnswers] = useState<Answers<A>>({ scope: '', byKey: {} });
  // The keys asked in this scope: read and written as the pointer moves, never rendered.
  const asked = useRef<{ scope: string | null; keys: Set<string> }>({ scope: null, keys: new Set() });
  const ask = useCallback(
    (key: string, op: FoldVertexOp | null) => {
      if (!scope) return;
      if (asked.current.scope !== scope) asked.current = { scope, keys: new Set() };
      if (asked.current.keys.has(key)) return;
      asked.current.keys.add(key);
      const settle = (answer: FoldFlapAnswer<A>) =>
        setAnswers((current) => {
          const known = current.scope === scope ? current.byKey : {};
          return { scope, byKey: { ...known, [key]: answer } };
        });
      if (!op) {
        settle({ status: 'none' });
        return;
      }
      settle({ status: 'asking' });
      void withCursor((engine, handle) => engine.compoundAnalysis(handle, op)).then(
        (reply) => {
          if (reply.status !== 'answered') return;
          const value = reply.value;
          const analysis = value.status === 'ok' && value.family === 'vertex' ? read(value.analysis) : null;
          settle(analysis ? { status: 'flap', analysis } : { status: 'none' });
        },
        (error: unknown) => reportError(error, { surface })
      );
    },
    [scope, withCursor, read, surface]
  );
  return { byKey: answers.scope === scope ? answers.byKey : NO_ANSWERS, ask };
}

const NO_ANSWERS: Readonly<Record<string, never>> = {};
