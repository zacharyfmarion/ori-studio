import { useMemo, useState } from 'react';
import type { FoldPaper, FoldSequenceDocument } from '../document/foldSequenceDocument';
import { foldedLineOf } from '../engine/foldEngineCompoundWire';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';
import type { FoldEngineOp, FoldReport } from '../engine/foldEngineWire';
import { useFoldSessionState } from '../session/useFoldSession';
import { sameFoldState, type FoldPendingStep, type FoldSessionProgress } from '../session/foldSessionState';
import type { FoldSentenceStep } from '../stepSentence';
import { useFoldTools } from '../tools/foldToolState';
import { foldNodeSentenceStep, foldSentenceStepOf } from './foldSentenceStep';
import type { FoldPathEntry } from './foldSequencePath';
import type { FoldStateFrame } from './foldStateFrame';
import { useFoldPath } from './useFoldPath';
import { useFoldStateFrames } from './useFoldStateFrames';

/** The step a tool is folding, as the sequence chrome shows it. */
export interface FoldSequencePending {
  /** Landed and ready to commit, or refused; a step still folding or failed is not shown. */
  status: 'landed' | 'refused';
  op: FoldEngineOp;
  words: FoldSentenceStep;
  /** Its state, while landed. */
  state: FoldEngineStateHandle | null;
  frame: FoldStateFrame | null;
  report: FoldReport | null;
  /** It folds from a step that is not the path's tip: committing it starts a branch. */
  branch: boolean;
}

/** The sequence on screen as the strip, the Step pane and the Diagram's From Fold… read it. */
export interface FoldSequenceView {
  /** The shown sequence, or the blank square before the first edit. */
  document: FoldSequenceDocument;
  /** There is a sequence in the project: the blank square is not one. */
  exists: boolean;
  paper: FoldPaper;
  readOnly: boolean;
  /** The sheet and the active path. */
  entries: readonly FoldPathEntry[];
  /** Each entry's state, once landed; aligned with `entries`. */
  frames: readonly (FoldStateFrame | null)[];
  /** Each entry's words; aligned with `entries` (the sheet's is unused). */
  words: readonly FoldSentenceStep[];
  /** The step on screen, by entry index. */
  cursor: number;
  pending: FoldSequencePending | null;
  progress: FoldSessionProgress;
  /** The replay stopped short, and a retry is offered. */
  failed: boolean;
}

/**
 * The shown sequence, its active path, each step's picture and words, and the
 * step a tool is folding (plan D14). Every Fold surface that lists steps reads
 * this, so a step is numbered, pictured and worded alike wherever it appears.
 */
export function useFoldSequenceView(): FoldSequenceView {
  const { sequence, document, entries, cursor } = useFoldPath();
  const readOnly = useFoldSessionState((snapshot) => snapshot.readOnly);
  const pendingStep = useAnsweredPendingStep(useFoldSessionState((snapshot) => snapshot.pending));
  // A step rebuilt in place — an unfold's, a repeat's — replaces its step: it starts no branch.
  const rebuilding = useFoldTools((state) => state.rebuild?.tool ?? null);
  const progress = useFoldSessionState((snapshot) => snapshot.progress);
  const failed = useFoldSessionState((snapshot) => snapshot.error !== null);
  const pendingState = pendingStep.status === 'landed' ? pendingStep.state : null;
  const states = useMemo(
    () => [...entries.map((entry) => entry.session.state), pendingState],
    [entries, pendingState]
  );
  const allFrames = useFoldStateFrames(states);
  const frames = useMemo(() => allFrames.slice(0, entries.length), [allFrames, entries.length]);
  const pendingFrame = allFrames[entries.length] ?? null;

  const words = useMemo(
    () =>
      entries.map((entry, index): FoldSentenceStep =>
        entry.node
          ? foldNodeSentenceStep(entry.node, {
              returnStep: entry.node.op?.kind === 'unfold-to' ? entries.find((e) => entry.node?.op?.kind === 'unfold-to' && e.id === entry.node.op.target)?.number : null,
              parent: frames[index - 1] ?? null,
              child: frames[index] ?? null,
              report: foldedLineOf(entry.session),
            })
          : { op: 'unknown' }
      ),
    [entries, frames]
  );

  const pending = useMemo((): FoldSequencePending | null => {
    if (pendingStep.status !== 'landed' && pendingStep.status !== 'refused') return null;
    const op = pendingStep.request.op;
    const report = pendingStep.status === 'landed' ? pendingStep.report : null;
    const folded = pendingStep.status === 'landed' ? foldedLineOf(pendingStep) : null;
    return {
      status: pendingStep.status,
      op,
      words: foldSentenceStepOf(op, { returnStep: op.kind === 'unfold-to' ? entries.find((e) => e.id === op.target)?.number : null, parent: frames[cursor] ?? null, child: pendingFrame, report: folded }),
      state: pendingStep.status === 'landed' ? pendingStep.state : null,
      frame: pendingFrame,
      report,
      branch: cursor !== entries.length - 1 && op.kind !== rebuilding,
    };
  }, [pendingStep, frames, cursor, pendingFrame, entries, rebuilding]);

  return {
    document,
    exists: sequence !== null,
    paper: document.paper,
    readOnly,
    entries,
    frames,
    words,
    cursor,
    pending,
    progress,
    failed,
  };
}

type AnsweredPendingStep = Extract<FoldPendingStep, { status: 'landed' | 'refused' }>;

/**
 * The session's pending step, or — while the next is folding from the same
 * state, a new seed's or another order's — the last one answered: the
 * strip's card, the sentence over the canvas and the Step pane's pending
 * fold stay as they were until the new one lands, rather than going and
 * coming back under the folder's click. Let go the moment nothing is folding.
 */
export function useAnsweredPendingStep(pending: FoldPendingStep): FoldPendingStep {
  const [answered, setAnswered] = useState<AnsweredPendingStep | null>(null);
  const settled = pending.status === 'landed' || pending.status === 'refused' ? pending : null;
  // Adjusted during render, so the frame that brings the new answer shows it.
  if (settled ? answered !== settled : pending.status !== 'working' && answered !== null) setAnswered(settled);
  return pending.status === 'working' && answered && sameFoldState(answered.parent, pending.parent) ? answered : pending;
}
