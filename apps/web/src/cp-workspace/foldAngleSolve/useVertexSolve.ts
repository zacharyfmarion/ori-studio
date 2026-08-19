/**
 * Review state for the three-angle vertex solve.
 *
 * The tool's engine is the ordinary `line-entity` one: it picks three creases
 * and emits a commit. What happens to that commit is the difference — closing a
 * vertex generally admits more than one set of fold angles, so instead of
 * applying, the hook holds the answers, previews whichever one is selected, and
 * waits.
 *
 * The state lives here rather than in the `ToolEngine` reducer because stepping
 * and applying are driven by keys and buttons, not by pointers; widening
 * `ToolInput['kind']` would touch every engine's exhaustive switch for one
 * tool's benefit. See vertexSolveReview.ts and the implementation plan.
 *
 * What it renders through is generic: the hook produces a
 * {@link CpToolOptionWindow} descriptor and nothing about the window knows what
 * a fold angle is.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { cpToolUnavailableMessage } from '../tools/toolUnavailable';
import { toolPreviewSegments } from '../tools/toolPreviewSegments';
import type { ToolPreviewSegment } from '../tools/types';
import { boundsOfPoints, type CpToolOptionWindow } from '../toolOptions/toolOptionWindow';
import {
  isSteppable,
  outcomeForPreview,
  stepReview,
  type VertexSolveReview,
} from './vertexSolveReview';

const OPERATION: OristudioCpOperationId = 'VertexSolveFoldAngles';

export interface UseVertexSolveOptions {
  preview: (
    operationId: OristudioCpOperationId,
    payload: OristudioCpCommandPayload,
  ) => Promise<OristudioCpCommandPreview | null>;
  execute: (
    operationId: OristudioCpOperationId,
    payload: OristudioCpCommandPayload,
  ) => Promise<boolean>;
  /** Fills in grid width, active colour and the rest, as the panel does. */
  buildPayload: (payload: OristudioCpCommandPayload) => OristudioCpCommandPayload;
  /**
   * Anything whose identity changes when the document's creases do — the
   * segment array will do. See the effect that watches it.
   */
  documentVersion: unknown;
}

export interface VertexSolveController {
  review: VertexSolveReview | null;
  /** Whether back/forward should be offered — more than one answer to see. */
  steppable: boolean;
  /**
   * The three creases as the selected answer would leave them, carrying their
   * solved mountain/valley and fold angle — so the canvas ramp and the angle
   * badges show what applying would do, in the channel they already use.
   */
  segments: readonly ToolPreviewSegment[];
  /**
   * The creases whose place the preview has taken, as 1-based ids — so the
   * document stops drawing them and the answer stands on its own.
   *
   * Driven by the *preview*, not by the review: they must appear and disappear
   * in the same render, or the creases would vanish for the length of a kernel
   * round trip and come back as the preview arrived.
   */
  replacedLineIds: readonly number[];
  /** The on-canvas window, or null when the tool has no question open. */
  option: CpToolOptionWindow | null;
  /**
   * Take the tool's three-crease commit. Applies straight away when there is a
   * single isolated answer; otherwise enters review. Returns whether it handled
   * the commit, so the caller knows not to execute it itself.
   */
  begin: (lineIds: readonly number[]) => Promise<boolean>;
  step: (delta: number) => void;
  apply: () => Promise<void>;
  cancel: () => void;
}

/** What the kernel said about the answer currently being shown. */
interface SolvedPreview {
  /**
   * The three creases as they would become, **in the order they were picked** —
   * the kernel re-orders them out of its own fan order for exactly this, so
   * these zip against `review.lineIds` with no geometry matching.
   */
  segments: readonly OristudioCpLineSegment[];
  /** The vertex, named by the kernel rather than re-derived here. */
  anchor: Point | null;
}

export function useVertexSolve(options: UseVertexSolveOptions): VertexSolveController {
  const { t } = useTranslation(['tools']);
  const [review, setReview] = useState<VertexSolveReview | null>(null);
  const [solved, setSolved] = useState<SolvedPreview | null>(null);
  // The options object is rebuilt on every panel render; keeping it in a ref
  // means the returned callbacks stay stable, so the shortcut registry is not
  // re-bound on every keystroke's worth of state change. Written in an effect
  // rather than during render — the callbacks that read it all run later (a
  // click, a keypress, an async response), so there is nothing to miss.
  const latest = useRef({ ...options, t });
  useEffect(() => {
    latest.current = { ...options, t };
  });
  /** The document the open review was solved against. */
  const documentAtReview = useRef<unknown>(null);

  const payloadFor = useCallback(
    (lineIds: readonly number[], index: number): OristudioCpCommandPayload =>
      latest.current.buildPayload({ line_ids: [...lineIds], candidate_index: index }),
    [],
  );

  const begin = useCallback(
    async (lineIds: readonly number[]) => {
      if (lineIds.length < 3) return false;
      const preview = await latest.current.preview(OPERATION, payloadFor(lineIds, 0));
      const outcome = outcomeForPreview(lineIds, preview);
      if (outcome.kind === 'none') {
        // A toast rather than the context panel's inline line.
        //
        // The panel's version is for a *continuous* state — the completion tool
        // recomputes it on every pointer move, so it reads as a running
        // commentary on wherever the cursor is. This is a discrete answer to a
        // question the user just finished asking, and it landed there for a
        // fraction of a second before the next preview wiped it, which is worse
        // than not saying anything.
        const message = cpToolUnavailableMessage(latest.current.t, outcome.reason);
        if (message) toast.info(message);
        setReview(null);
        return true;
      }
      if (outcome.kind === 'apply') {
        setReview(null);
        await latest.current.execute(OPERATION, payloadFor(lineIds, 0));
        return true;
      }
      documentAtReview.current = latest.current.documentVersion;
      setReview(outcome.review);
      return true;
    },
    [payloadFor],
  );

  // Drop the review if the document changes under it.
  //
  // Line ids are *indices*, so an undo or a parallel edit leaves both the solve
  // and the replaced set pointing at whatever now occupies those slots. The
  // answers were already stale at that point; what makes it worth guarding is
  // that the creases are hidden, so a stale set would blank geometry that has
  // nothing to do with the solve.
  //
  // `apply` clears the review before it commits, so its own mutation never
  // reaches here.
  const { documentVersion } = options;
  useEffect(() => {
    if (!review || documentVersion === documentAtReview.current) return;
    setReview(null);
  }, [documentVersion, review]);

  // Re-preview whenever the selected answer changes, so stepping shows the
  // creases that answer would produce. Guarded by a request id because the
  // previews are async and a fast step would otherwise let an older response
  // land last.
  const request = useRef(0);
  const key = review ? `${review.lineIds.join(',')}:${review.index}` : null;
  useEffect(() => {
    if (!review) {
      request.current += 1;
      setSolved(null);
      return;
    }
    const id = ++request.current;
    void latest.current
      .preview(OPERATION, payloadFor(review.lineIds, review.index))
      .then((preview) => {
        if (id !== request.current) return;
        setSolved({
          segments: preview?.segments ?? [],
          anchor: preview?.points?.[0] ?? null,
        });
        // Only the kernel knows whether the answer now shown is the one the
        // creases already hold, so the flag is refreshed from the same response
        // that produced the segments rather than guessed at step time.
        const isCurrent = preview?.candidate_is_current === true;
        setReview((current) =>
          current && current.isCurrent !== isCurrent ? { ...current, isCurrent } : current,
        );
      });
    // `key` is the identity of what is being previewed; `review` itself is a new
    // object on every step even when nothing about the request changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, payloadFor]);

  const step = useCallback((delta: number) => {
    setReview((current) => (current ? stepReview(current, delta) : current));
  }, []);

  const apply = useCallback(async () => {
    const current = review;
    if (!current) return;
    // Clear first: the commit changes the document, and a stale review pointing
    // at solutions of the *previous* geometry would preview creases that are no
    // longer the answer.
    setReview(null);
    await latest.current.execute(OPERATION, payloadFor(current.lineIds, current.index));
  }, [payloadFor, review]);

  const cancel = useCallback(() => {
    setReview(null);
  }, []);

  const segments = useMemo(() => toolPreviewSegments(solved?.segments, OPERATION), [solved]);

  const replacedLineIds = useMemo(
    () => (review && solved ? [...review.lineIds] : []),
    [review, solved],
  );

  const option = useMemo((): CpToolOptionWindow | null => {
    if (!review || !solved) return null;
    // The three creases, plus the vertex — so a solve whose creases all run one
    // way still frames the point they meet at rather than sitting off it.
    const bounds = boundsOfPoints([
      ...solved.segments.flatMap((segment) => [segment.a, segment.b]),
      ...(solved.anchor ? [solved.anchor] : []),
    ]);
    if (!bounds) return null;
    const note = review.isFamily
      ? t(
          'tools:cpContext.solveAngles.family',
          'These three creases leave one degree of freedom, so this is one of infinitely many answers — pick a different third crease for a definite one.',
        )
      : review.isCurrent
        ? t(
            'tools:cpContext.solveAngles.current',
            'This is what the vertex already does — step to see the alternative.',
          )
        : null;
    return {
      bounds,
      title: t('tools:cpContext.solveAngles.title', 'Fold angles'),
      index: review.index,
      count: review.count,
      note,
      onStep: step,
      onApply: () => void apply(),
      onCancel: cancel,
    };
  }, [apply, cancel, review, solved, step, t]);

  return useMemo(
    () => ({
      review,
      steppable: isSteppable(review),
      segments,
      replacedLineIds,
      option,
      begin,
      step,
      apply,
      cancel,
    }),
    [apply, begin, cancel, option, replacedLineIds, review, segments, step],
  );
}
