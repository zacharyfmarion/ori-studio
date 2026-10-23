import { useEffect, useState } from 'react';
import { reportError } from '../../monitoring';
import { canonicalJson } from '../document/foldDigest';
import type { FoldChoices, FoldCompletionChoice } from '../document/foldSequenceDocument';
import type { FoldEngineCrimpOp, FoldEngineTuckOp } from '../engine/foldEngineCrimpTuckWire';
import {
  compoundFamilyOf,
  isFoldCompoundOp,
  type FoldCompoundAnalysis,
  type FoldCompoundAnalysisOf,
  type FoldCompoundFamily,
} from '../engine/foldEngineCompoundWire';
import type { FoldEngineOp, FoldEngineRefused } from '../engine/foldEngineWire';
import type { FoldSessionSurface } from '../session/useFoldSession';
import type { FoldStepBuild } from '../tools/foldStepBuilder';

/** What the engine said of a compound fold before it lands, for the ask it was given. */
export interface FoldCompoundAnswer<F extends FoldCompoundFamily> {
  /** The state and the ask it answers. */
  key: string;
  /** Its family's answer; null when it was refused. */
  asked: FoldCompoundAnalysisOf<F> | null;
  /** Why it cannot be asked about: nothing stays, a flap with no opening, lines that meet, … */
  refused: FoldEngineRefused | null;
}

/** An ask of the engine: an op and its choices, from the state on screen. */
export interface FoldCompoundAsk {
  op: FoldEngineOp;
  choices?: FoldChoices;
}

/** What every compound tool's step hook answers the preview with (`useFoldToolPreview`). */
export interface FoldCompoundStepAnswer {
  build: FoldStepBuild;
  /** Why it cannot be asked about, or folded: the family's refusal before its step lands. */
  refused: FoldEngineRefused | null;
  /**
   * A fold whose layers the picker shows while the step is refused before it
   * is built (a tuck no layer takes): asked for its layers only.
   */
  layers?: FoldCompoundAsk | null;
}

/** Whether an answer is the family's a tool asked of: a compound op's answer is always its own family's. */
function ofFamily<F extends FoldCompoundFamily>(
  answer: FoldCompoundAnalysis,
  family: F
): answer is FoldCompoundAnalysisOf<F> {
  return answer.family === family;
}

/**
 * The tools' one question about a compound fold (the compound question,
 * `compoundAnalysis`, D14 tier 2), once per ask on a state: a reverse fold's
 * tip and the kinds that land, a crimp's tip and kinds, a tuck's targets, a
 * vertex fold's rays. An equal ask never asks again, so neither a choice the
 * answer does not depend on nor a re-render asks twice. Null until the answer
 * for this ask is in; an answer of another family is dropped, as a stale one
 * is; `surface` names the tool in a failure's report.
 */
export function useFoldCompoundAsk<F extends FoldCompoundFamily>(
  session: FoldSessionSurface,
  stateKey: string | null,
  ask: FoldCompoundAsk | null,
  family: F,
  surface: string
): FoldCompoundAnswer<F> | null {
  const { withCursor } = session;
  const key = ask && stateKey ? `${stateKey}|${canonicalJson(ask)}` : null;
  const [answer, setAnswer] = useState<FoldCompoundAnswer<F> | null>(null);
  useEffect(() => {
    if (!ask || key === null || answer?.key === key) return undefined;
    const { op, choices } = ask;
    if (!isFoldCompoundOp(op) || compoundFamilyOf(op) !== family) return undefined;
    let current = true;
    void withCursor((engine, at) => engine.compoundAnalysis(at, op, choices)).then(
      (reply) => {
        if (!current || reply.status !== 'answered') return;
        const value = reply.value;
        if (value.status !== 'ok') setAnswer({ key, asked: null, refused: value });
        else if (ofFamily(value, family)) setAnswer({ key, asked: value, refused: null });
      },
      (error: unknown) => reportError(error, { surface })
    );
    return () => {
      current = false;
    };
    // The ask is read through its key: an equal ask must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withCursor, key, answer?.key, family, surface]);
  return answer && answer.key === key ? answer : null;
}

/** The orders a crimp's or a tuck's completion leaves, for the ask it was given. */
export interface FoldCompoundOrders {
  key: string;
  /** Each the `completion` that picks it; empty when the fold lands with one, or is refused. */
  orders: readonly FoldCompletionChoice[];
}

/** A crimp or a tuck as its own call folds it. */
export interface FoldCrimpTuckAsk {
  op: FoldEngineCrimpOp | FoldEngineTuckOp;
  choices?: FoldChoices;
}

/**
 * The orders a crimp or a tuck leaves (plan D4, D6), asked of its family's
 * own call once per ask on a state, as the reverse fold's question lists
 * its own: the call lands every order (up to sixteen), each under a handle,
 * and what each stores is kept — the completion that picks it — while every
 * state it landed is let go at once, since the preview lands the one chosen
 * again through the session. A fold that lands with one order, or is
 * refused, lists none: the preview says the rest.
 */
export function useFoldCompoundOrders(
  session: FoldSessionSurface,
  stateKey: string | null,
  ask: FoldCrimpTuckAsk | null,
  surface: string
): FoldCompoundOrders | null {
  const { withCursor } = session;
  const key = ask && stateKey ? `${stateKey}|${canonicalJson(ask)}` : null;
  const [answer, setAnswer] = useState<FoldCompoundOrders | null>(null);
  useEffect(() => {
    if (!ask || key === null || answer?.key === key) return undefined;
    let current = true;
    const { op, choices } = ask;
    void withCursor(async (engine, at) => {
      const outcome = op.kind === 'crimp' ? await engine.crimp(at, op, choices) : await engine.tuck(at, op, choices);
      if (outcome.status === 'ok') {
        const held =
          outcome.outcome === 'landed'
            ? [outcome.state]
            : outcome.outcome === 'choose_order'
              ? outcome.candidates.map((candidate) => candidate.state)
              : [];
        if (held.length > 0) await engine.release(held);
      }
      return outcome;
    }).then(
      (reply) => {
        if (!current || reply.status !== 'answered') return;
        const outcome = reply.value;
        const orders =
          outcome.status === 'ok' && outcome.outcome === 'choose_order'
            ? outcome.candidates.flatMap((candidate) => (candidate.stored.completion ? [candidate.stored.completion] : []))
            : [];
        setAnswer({ key, orders });
      },
      (error: unknown) => reportError(error, { surface })
    );
    return () => {
      current = false;
    };
    // The ask is read through its key: an equal ask must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withCursor, key, answer?.key, surface]);
  return answer && answer.key === key ? answer : null;
}
