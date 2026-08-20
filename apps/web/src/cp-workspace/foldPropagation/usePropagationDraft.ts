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
 * and waits for an explicit Apply.
 *
 * Same shape and same reasoning as `foldAngleSolve/useVertexSolve`, which holds
 * its answers for a different reason (it has several and cannot choose between
 * them). The two share `CpToolOptionWindow`, which is React-free and knows about
 * neither.
 *
 * # A draft is a claim about *which document creases change*
 *
 * That is the whole difference between a draft and a picture of one. The kernel
 * names them — `propagation_creases`, one-based ids index-aligned with the
 * previewed geometry — so the surface can stop drawing the creases the draft
 * stands in for. Without the names the draft can only be painted *over* the
 * originals, which reads as though it had already been applied, and then Cancel
 * looks like it does nothing because the thing it removed was never
 * distinguishable from what was underneath.
 *
 * So `replacedLineIds` is not decoration. It is what makes the held draft a
 * proposal rather than a fait accompli, and it is why the ids and the geometry
 * live in **one** piece of state: they have to appear and disappear in the same
 * render, or creases would blink out for a frame.
 *
 * # Pins
 *
 * The kernel takes `pinned_angles` — angles the user fixed by hand, treated as
 * known before its first solve and never re-derived — so that adjusting a crease
 * and re-propagating is a conversation rather than a retry. Nothing on this side
 * collects one yet; the seam is `payloadFor`, which is the only place the
 * request is built.
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

/** One crease the draft would set. */
export interface PropagationDraftCrease {
  /**
   * The document crease, as a **one-based** line id — the same space
   * `toolReplacedLineIds` and the kernel's `line_ids` use. The kernel converts
   * from its own zero-based indices, so nothing here adds or subtracts one.
   */
  readonly lineId: number;
  /** The angle it would take, in signed degrees; negative is a mountain. */
  readonly degrees: number;
}

/** One place the draft stopped, and why. */
export interface PropagationStall {
  readonly point: Point;
  readonly reason: string;
  readonly unknowns: number;
}

/** What the kernel worked out, held uncommitted. */
export interface PropagationDraft {
  /** Where the user asked propagation to start. */
  readonly seed: Point;
  /** The creases it would set, named so the document can stop drawing them. */
  readonly creases: readonly PropagationDraftCrease[];
  /**
   * The same creases as the kernel would leave them, **index-aligned with
   * `creases`** — carrying their solved mountain/valley and fold angle, so the
   * canvas ramp and the angle badges show what applying would do.
   */
  readonly segments: readonly OristudioCpLineSegment[];
  /** How many creases are still unassigned after it. */
  readonly free: number;
  /** Vertices propagation stopped at, and why. */
  readonly stalls: readonly PropagationStall[];
  /** Vertices that ended fully known and do not close. */
  readonly conflicts: readonly Point[];
}

export interface PropagationDraftController {
  draft: PropagationDraft | null;
  /** The draft creases as they would become, for the canvas. */
  segments: readonly ToolPreviewSegment[];
  /**
   * The creases whose place the draft has taken, as 1-based ids — so the
   * document stops drawing them and the draft stands on its own.
   *
   * Read straight off the held draft, which carries its ids and its geometry
   * together: the two must appear and disappear in the same render, or the
   * originals would show through under the draft.
   */
  replacedLineIds: readonly number[];
  /** The on-canvas Apply/Cancel window, or null when no draft is held. */
  option: CpToolOptionWindow | null;
  /**
   * Take the tool's seed click — **the whole point of the hook**, which is that
   * nothing is executed until the draft has been looked at.
   *
   * The hook always takes the commit: there is no fallback that could apply a
   * propagation without showing it first. So the boolean reports whether a draft
   * is now held, not whether the caller should act. `false` means the kernel
   * refused the preview, which the hook has already reported.
   */
  begin: (seed: Point) => Promise<boolean>;
  apply: () => Promise<void>;
  cancel: () => void;
}

export function usePropagationDraft(
  options: UsePropagationDraftOptions
): PropagationDraftController {
  const { t } = useTranslation(['tools', 'panels']);
  const [draft, setDraft] = useState<PropagationDraft | null>(null);

  // The options object is rebuilt on every panel render; keeping it in a ref
  // means the returned callbacks stay stable, so the shortcut registry is not
  // re-bound on every keystroke's worth of state change. Written in an effect
  // rather than during render — the callbacks that read it all run later (a
  // click, a keypress, an async response), so there is nothing to miss.
  const latest = useRef({ ...options, t });
  useEffect(() => {
    latest.current = { ...options, t };
  });

  /** The document the held draft was computed against. */
  const documentAtDraft = useRef<unknown>(null);

  /**
   * Which preview request is the current one.
   *
   * Previews are async and the tool stays armed after a seed click, so a second
   * click — or a Cancel — can land while the first solve is still running. An
   * older response arriving last would install a draft for a seed the user has
   * moved on from, and because the draft *hides* the creases it names, that is
   * not merely a wrong picture: it blanks geometry with nothing standing in for
   * it. Bumped on teardown as well as on request, so a cancelled flight can
   * never re-open the window.
   */
  const request = useRef(0);

  const payloadFor = useCallback(
    (seed: Point): OristudioCpCommandPayload => latest.current.buildPayload({ points: [seed] }),
    []
  );

  const cancel = useCallback(() => {
    request.current += 1;
    setDraft(null);
    documentAtDraft.current = null;
  }, []);

  const begin = useCallback(
    async (seed: Point) => {
      const id = ++request.current;
      const response = await latest.current.preview(OPERATION, payloadFor(seed));
      // Superseded. The click was still ours, so the caller must not execute it.
      if (id !== request.current) return true;
      if (!response) {
        // The kernel refused, and unlike every other command's failure this one
        // has no tool-state transition to report through — the hook swallowed
        // the commit. Say so rather than leaving the click silent.
        toast.error(latest.current.t('panels:creasePattern.commandFailed', 'Command failed'));
        return false;
      }
      if (response.unavailable) {
        // An expected answer rather than a complaint — "nothing could be worked
        // out from what you have set" is a conversation, not an error.
        const message = cpToolUnavailableMessage(latest.current.t, response.unavailable);
        if (message) toast.info(message);
        return true;
      }
      const creases = (response.propagation_creases ?? []).map((crease) => ({
        lineId: crease.line_id,
        degrees: crease.degrees,
      }));
      // Defensive: the kernel sets `unavailable` whenever it worked nothing out,
      // so this is unreachable. An empty draft would open a window framing
      // nothing and hiding nothing, which is worse than staying shut.
      if (creases.length === 0) return true;
      documentAtDraft.current = latest.current.documentVersion;
      setDraft({
        seed,
        creases,
        segments: response.segments ?? [],
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
    },
    [payloadFor]
  );

  const apply = useCallback(async () => {
    const held = draft;
    if (!held) return;
    // Cleared first, and deliberately: the commit changes the document, so a
    // draft still held across the round trip would go on hiding creases while
    // the ones replacing them landed. It also keeps `apply`'s own mutation from
    // reaching the staleness effect below.
    cancel();
    // Recomputed kernel-side from the same payload rather than sent back, so
    // the draft that was shown and the commit that lands cannot disagree.
    await latest.current.execute(OPERATION, payloadFor(held.seed));
  }, [cancel, draft, payloadFor]);

  // A draft is an answer about a document. When the creases change underneath
  // it — an undo, another tool, a hand edit — it is an answer about a document
  // that no longer exists. Line ids are indices, so a stale draft would both
  // apply to and hide whatever now sits at those positions.
  const { documentVersion } = options;
  useEffect(() => {
    if (!draft || documentVersion === documentAtDraft.current) return;
    cancel();
  }, [cancel, draft, documentVersion]);

  const segments = useMemo(() => toolPreviewSegments(draft?.segments, OPERATION), [draft]);

  const replacedLineIds = useMemo(
    () => (draft ? draft.creases.map((crease) => crease.lineId) : []),
    [draft]
  );

  const option = useMemo<CpToolOptionWindow | null>(() => {
    if (!draft) return null;
    // Frame what would change, plus the seed so a one-crease draft still frames
    // the point it started from. Not the stalls and conflicts: nothing draws
    // them, so they would grow the frame around geometry that is not there.
    //
    // A draft that reaches the whole sheet therefore gets a whole-sheet frame,
    // and the header rides its top-right corner — off-screen when zoomed in.
    // Accepted: Enter and Escape reach the window wherever it sits, and a frame
    // that fits the screen by not framing the change is the bug being fixed.
    const bounds = boundsOfPoints([
      draft.seed,
      ...draft.segments.flatMap((segment) => [segment.a, segment.b]),
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
      title: t('tools:cpContext.propagation.title', 'Fold angles — {{creases}} solved', {
        creases: draft.creases.length,
      }),
      index: 0,
      // Nothing to step through: a draft is one answer, not a menu. `0` rather
      // than `1` because "1 of 1" would claim a set with a second member to
      // reach; the layer renders the title instead of a stepper for both, so
      // this is about the descriptor staying honest.
      count: 0,
      note,
      // Unreachable, and provably so: the layer only offers a stepper above a
      // count of one.
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
