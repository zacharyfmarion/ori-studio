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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { toolPreviewSegments } from '../tools/toolPreviewSegments';
import type { ToolPreviewSegment } from '../tools/types';
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
    payload: OristudioCpCommandPayload
  ) => Promise<OristudioCpCommandPreview | null>;
  execute: (
    operationId: OristudioCpOperationId,
    payload: OristudioCpCommandPayload
  ) => Promise<boolean>;
  /** Fills in grid width, active colour and the rest, as the panel does. */
  buildPayload: (payload: OristudioCpCommandPayload) => OristudioCpCommandPayload;
  /** Surface the kernel's reason when there is no answer. */
  onUnavailable: (reason: string | null) => void;
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
   * Creases that would complete a solvable triple with the two already picked.
   *
   * The affordance the tool needs to be usable rather than a guessing game:
   * about 62% of triples cannot close a freely-angled vertex, so an unmarked
   * third pick is a coin toss. Two picks are enough to fix the vertex, which is
   * exactly when this becomes answerable.
   */
  partners: readonly { a: Point; b: Point }[];
  /**
   * Take the tool's three-crease commit. Applies straight away when there is a
   * single isolated answer; otherwise enters review. Returns whether it handled
   * the commit, so the caller knows not to execute it itself.
   */
  begin: (lineIds: readonly number[]) => Promise<boolean>;
  /** Recompute {@link VertexSolveController.partners} for a partial pick. */
  markPartners: (lineIds: readonly number[]) => void;
  step: (delta: number) => void;
  apply: () => Promise<void>;
  cancel: () => void;
}

export function useVertexSolve(options: UseVertexSolveOptions): VertexSolveController {
  const [review, setReview] = useState<VertexSolveReview | null>(null);
  const [segments, setSegments] = useState<readonly ToolPreviewSegment[]>([]);
  const [partners, setPartners] = useState<readonly { a: Point; b: Point }[]>([]);
  // The options object is rebuilt on every panel render; keeping it in a ref
  // means the returned callbacks stay stable, so the shortcut registry is not
  // re-bound on every keystroke's worth of state change. Written in an effect
  // rather than during render — the callbacks that read it all run later (a
  // click, a keypress, an async response), so there is nothing to miss.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const payloadFor = useCallback(
    (lineIds: readonly number[], index: number): OristudioCpCommandPayload =>
      latest.current.buildPayload({ line_ids: [...lineIds], candidate_index: index }),
    []
  );

  const begin = useCallback(
    async (lineIds: readonly number[]) => {
      if (lineIds.length < 3) return false;
      const preview = await latest.current.preview(OPERATION, payloadFor(lineIds, 0));
      const outcome = outcomeForPreview(lineIds, preview);
      if (outcome.kind === 'none') {
        latest.current.onUnavailable(outcome.reason);
        setReview(null);
        return true;
      }
      if (outcome.kind === 'apply') {
        latest.current.onUnavailable(null);
        setReview(null);
        await latest.current.execute(OPERATION, payloadFor(lineIds, 0));
        return true;
      }
      latest.current.onUnavailable(null);
      setReview(outcome.review);
      return true;
    },
    [payloadFor]
  );

  // Re-preview whenever the selected answer changes, so stepping shows the
  // creases that answer would produce. Guarded by a request id because the
  // previews are async and a fast step would otherwise let an older response
  // land last.
  const request = useRef(0);
  const key = review ? `${review.lineIds.join(',')}:${review.index}` : null;
  useEffect(() => {
    if (!review) {
      request.current += 1;
      setSegments([]);
      return;
    }
    const id = ++request.current;
    void latest.current
      .preview(OPERATION, payloadFor(review.lineIds, review.index))
      .then((preview) => {
        if (id !== request.current) return;
        setSegments(toolPreviewSegments(preview?.segments, OPERATION));
        // Only the kernel knows whether the answer now shown is the one the
        // creases already hold, so the flag is refreshed from the same response
        // that produced the segments rather than guessed at step time.
        const isCurrent = preview?.candidate_is_current === true;
        setReview((current) =>
          current && current.isCurrent !== isCurrent ? { ...current, isCurrent } : current
        );
      });
    // `key` is the identity of what is being previewed; `review` itself is a new
    // object on every step even when nothing about the request changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, payloadFor]);

  const partnerRequest = useRef(0);
  const markPartners = useCallback(
    (lineIds: readonly number[]) => {
      const id = ++partnerRequest.current;
      if (lineIds.length !== 2) {
        setPartners([]);
        return;
      }
      void latest.current
        .preview(OPERATION, latest.current.buildPayload({ line_ids: [...lineIds] }))
        .then((preview) => {
          if (id !== partnerRequest.current) return;
          setPartners((preview?.segments ?? []).map((segment) => ({ a: segment.a, b: segment.b })));
        });
    },
    []
  );

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
    setPartners([]);
    partnerRequest.current += 1;
    latest.current.onUnavailable(null);
  }, []);

  return useMemo(
    () => ({
      review,
      steppable: isSteppable(review),
      segments,
      partners,
      begin,
      markPartners,
      step,
      apply,
      cancel,
    }),
    [apply, begin, cancel, markPartners, partners, review, segments, step]
  );
}
