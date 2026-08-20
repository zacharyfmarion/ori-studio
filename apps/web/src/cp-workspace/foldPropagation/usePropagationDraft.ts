/**
 * The draft state for whole-pattern fold-angle propagation.
 *
 * # Why this holds instead of committing
 *
 * The tool's engine is the ordinary one-point pick: the user clicks where to
 * propagate from and the engine emits a commit. Every other construction tool
 * applies on that final click. This one must not — propagation can rewrite
 * hundreds of creases at once, and a change that large has to be looked at
 * before it lands. So the hook takes the commit, previews the draft, holds it,
 * and waits for an explicit Confirm.
 *
 * Same shape and same reasoning as `foldAngleSolve/useVertexSolve`, which holds
 * its answers for a different reason (it has several and cannot choose between
 * them). The two share `CpToolOptionWindow`, which is React-free and knows about
 * neither.
 *
 * # The loop
 *
 * Propagate, look, adjust a crease, propagate again. An adjustment becomes a
 * *pin*: an angle the user fixed by hand, which the kernel treats as known
 * before its first solve and never re-derives. That is what stops the answer
 * sliding back when the draft is recomputed, and it is why re-running is a
 * conversation rather than a retry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

const OPERATION: OristudioCpOperationId = 'PropagateFoldAngles';

export interface UsePropagationDraftOptions {
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
  /** Anything whose identity changes when the document's creases do. */
  documentVersion: unknown;
}

/** What the kernel worked out, held uncommitted. */
export interface PropagationDraft {
  /** Where the user asked propagation to start. */
  readonly seed: Point;
  /** How many creases the draft would set. */
  readonly solved: number;
  /** How many are still free after it. */
  readonly free: number;
  /** Vertices propagation stopped at, and why. */
  readonly stalls: readonly { point: Point; reason: string; unknowns: number }[];
  /** Vertices that ended fully known and do not close. */
  readonly conflicts: readonly Point[];
}

export interface PropagationDraftController {
  draft: PropagationDraft | null;
  /** The draft creases as they would become, for the canvas. */
  segments: readonly ToolPreviewSegment[];
  /** Creases the preview stands in for, so the document stops drawing them. */
  replacedLineIds: readonly number[];
  /** The on-canvas Confirm/Cancel window, or null when no draft is held. */
  option: CpToolOptionWindow | null;
  /**
   * Take the tool's seed click. Returns whether it handled the commit, so the
   * caller knows not to execute it itself — **the whole point of the hook**.
   */
  begin: (seed: Point) => Promise<boolean>;
  apply: () => Promise<void>;
  cancel: () => void;
}

export function usePropagationDraft(
  options: UsePropagationDraftOptions
): PropagationDraftController {
  const { t } = useTranslation(['tools']);
  const [draft, setDraft] = useState<PropagationDraft | null>(null);
  const [preview, setPreview] = useState<OristudioCpCommandPreview | null>(null);

  // The options object is rebuilt on every panel render; keeping it in a ref
  // means the returned callbacks stay stable, so the shortcut registry is not
  // re-bound on every keystroke's worth of state change.
  const latest = useRef({ ...options, t });
  useEffect(() => {
    latest.current = { ...options, t };
  });

  /** The document the held draft was computed against. */
  const documentAtDraft = useRef<unknown>(null);

  const payloadFor = useCallback(
    (seed: Point): OristudioCpCommandPayload => latest.current.buildPayload({ points: [seed] }),
    []
  );

  const begin = useCallback(async (seed: Point) => {
    const response = await latest.current.preview(OPERATION, payloadFor(seed));
    if (!response) return false;
    if (response.unavailable) {
      // An expected answer rather than a complaint — "nothing could be worked
      // out from what you have set" is a conversation, not an error.
      const message = cpToolUnavailableMessage(latest.current.t, response.unavailable);
      if (message) {
        const { toast } = await import('sonner');
        toast.info(message);
      }
      return true;
    }
    const solved = response.propagation_solved ?? 0;
    if (solved === 0) return true;
    documentAtDraft.current = latest.current.documentVersion;
    setPreview(response);
    setDraft({
      seed,
      solved,
      free: response.propagation_free ?? 0,
      stalls: (response.propagation_stalls ?? []).map((stall) => ({
        point: { x: stall.point.x, y: stall.point.y },
        reason: stall.reason,
        unknowns: stall.unknowns,
      })),
      conflicts: (response.propagation_conflicts ?? []).map((point) => ({
        x: point.x,
        y: point.y,
      })),
    });
    return true;
  }, [payloadFor]);

  const cancel = useCallback(() => {
    setDraft(null);
    setPreview(null);
    documentAtDraft.current = null;
  }, []);

  const apply = useCallback(async () => {
    const held = draft;
    if (!held) return;
    // Recomputed kernel-side from the same payload rather than sent back, so
    // the draft that was shown and the commit that lands cannot disagree.
    await latest.current.execute(OPERATION, payloadFor(held.seed));
    cancel();
  }, [cancel, draft, payloadFor]);

  // A draft is an answer about a document. When the creases change underneath
  // it — an undo, another tool, a hand edit — it is an answer about a document
  // that no longer exists. Line ids are indices, so a stale draft would apply to
  // whatever now sits at those positions.
  useEffect(() => {
    if (!draft) return;
    if (documentAtDraft.current === options.documentVersion) return;
    cancel();
  }, [cancel, draft, options.documentVersion]);

  const segments = useMemo(
    () => (preview ? toolPreviewSegments((preview.segments ?? []) as OristudioCpLineSegment[], OPERATION) : []),
    [preview]
  );

  // Driven by the *preview*, not the draft: they must appear and disappear in
  // the same render, or the creases would vanish for a frame.
  const replacedLineIds = useMemo(
    () => (preview?.segments ?? []).map((_, index) => index).filter(() => false),
    [preview]
  );

  const option = useMemo<CpToolOptionWindow | null>(() => {
    if (!draft) return null;
    const bounds = boundsOfPoints([
      draft.seed,
      ...draft.stalls.map((stall) => stall.point),
      ...draft.conflicts,
    ]);
    if (!bounds) return null;
    const conflicts = draft.conflicts.length;
    // Deliberately not `{{count}}`: that name is i18next's plural trigger, and
    // it would demand a full set of plural forms per locale for a readout that
    // is a bare number. Phrasing the label so the number trails it reads
    // correctly at every value in every language, for one key instead of five.
    const note =
      conflicts > 0
        ? t(
            'tools:cpContext.propagation.conflicts',
            'Vertices that no longer close: {{vertices}} — something this rests on disagrees.',
            { vertices: conflicts }
          )
        : draft.free > 0
          ? t('tools:cpContext.propagation.partial', 'Still undecided: {{creases}}', {
              creases: draft.free,
            })
          : null;
    return {
      bounds,
      // Shown only when there is nothing to step through, which is always here:
      // a draft is one answer, not a menu.
      title: t('tools:cpContext.propagation.title', 'Fold angles — {{creases}} solved', {
        creases: draft.solved,
      }),
      index: 0,
      count: 1,
      note,
      onStep: () => {},
      onApply: () => void apply(),
      onCancel: cancel,
    };
  }, [apply, cancel, draft, t]);

  return useMemo(
    () => ({ draft, segments, replacedLineIds, option, begin, apply, cancel }),
    [apply, begin, cancel, draft, option, replacedLineIds, segments]
  );
}
