import { isSequenceTool } from '../tools/foldToolCatalog';
import { useFoldTools } from '../tools/foldToolState';
import { useEffect, useMemo, useState } from 'react';
import { reportError } from '../../monitoring';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { visibleMarks } from '../document/foldStepTree';
import { foldOpSteps, isLockedStep, markPoints, type FoldMark, type FoldSequenceDocument } from '../document/foldSequenceDocument';
import type { FoldLandmarks, FoldScene, FoldStateSummary } from '../engine/foldEngineWire';
import type { FoldStateCall } from '../session/foldSession';
import type { FoldSessionNode } from '../session/foldSessionState';
import { FOLD_SCENE_QUERY, foldLandmarksQuery } from '../session/foldStateQueries';
import { useFoldStateQuery, useFoldCursor, useFoldSessionState } from '../session/useFoldSession';
import { foldPickIndex, type FoldMarkPoint, type FoldPickIndex } from './foldPicking';

/** What the canvas knows about the state on screen, from the engine and the document. */
export interface FoldStateView {
  /** The step on screen; null for the sheet. */
  cursorId: string | null;
  /**
   * The summary of the state the panes show: the step number, the counts,
   * the sheet's outline. While the step on screen loads, the last one shown
   * (see {@link FoldStateView.scene}).
   */
  summary: FoldStateSummary | null;
  /**
   * How many steps led to the state the step on screen folds from, in the
   * count `summary.step` keeps: the creases made after it are the step's own
   * — every operation's of a Repeat (`foldOpSteps`). Of the same state as
   * `summary`; null with it.
   */
  since: number | null;
  /**
   * Whether an Import CP step landed the state shown: its own creases are
   * then the whole pattern, collapsed along at once, not an instruction
   * over one. Of the same state as `summary`.
   */
  imported: boolean;
  /**
   * The scene the panes show. While the step on screen has yet to land, or
   * its scene is on its way, the last one shown stays up rather than leaving
   * the panes blank; null once the step on screen can have none (broken,
   * locked) and before anything was shown.
   */
  scene: FoldScene | null;
  landmarks: FoldLandmarks | null;
  /** The Divide-line marks a reader sees there (plan D6). */
  marks: readonly FoldMark[];
  /** Their points, as the landmark query takes them, each with its mark. */
  markPoints: readonly FoldMarkPoint[];
  /**
   * Everything a pointer move over either pane reads: null until the step
   * on screen's own scene is in, so nothing is located on the one before.
   */
  index: FoldPickIndex | null;
}

/** A state the panes can show: its scene and its summary, together, the step count of the state before it, and whether an import landed it. */
interface FoldPicture {
  scene: FoldScene;
  summary: FoldStateSummary;
  since: number;
  imported: boolean;
}

const NO_MARKS: readonly FoldMark[] = [];

/** Every point each mark makes, with the mark it came from. */
export function foldMarkPoints(marks: readonly FoldMark[]): FoldMarkPoint[] {
  return marks.flatMap((mark) => markPoints(mark).map((at) => ({ at, mark: mark.id })));
}

/** The marks visible at the step on screen; empty before the first edit, when there is no sequence. */
export function foldMarksAt(sequence: FoldSequenceDocument | null, cursorId: string | null): readonly FoldMark[] {
  return sequence ? visibleMarks(sequence, cursorId) : NO_MARKS;
}

/** Whether the step on screen will have a picture once it loads: it is landing, or landed. */
const loading = (cursor: FoldSessionNode) => cursor.status !== 'broken' && cursor.status !== 'locked';

/**
 * The picture to show: the step on screen's own once it is in; while it
 * loads, the last one shown. Kept in state so it outlives the render that
 * showed it, and replaced only by a newer picture.
 */
function usePicture(fresh: FoldPicture | null, keep: boolean): FoldPicture | null {
  const [shown, setShown] = useState<FoldPicture | null>(fresh);
  if (fresh && (fresh.scene !== shown?.scene || fresh.summary !== shown.summary)) setShown(fresh);
  return fresh ?? (keep ? shown : null);
}

/**
 * The state on screen as the canvas reads it: its scene and landmarks from
 * the engine, asked once per state (and per set of marks), and the pick index
 * built from them once. Tier 1 of D14 reads only this.
 */
export function useFoldStateView(): FoldStateView {
  const cursor = useFoldCursor();
  const cursorId = useFoldSessionState((snapshot) => snapshot.cursor);
  const sequence = useFoldSessionState((snapshot) => snapshot.sequence);
  // The sequence tools show another state than the step on screen once their
  // preview lands: the pose Unfold to step returns to, or Repeat's result.
  const tool = useFoldTools((state) => state.tool);
  const pending = useFoldSessionState((s) => s.pending);
  const returned = isSequenceTool(tool) && pending.status === 'landed' && pending.request.op.kind === tool ? pending : null;
  const marks = useMemo(() => foldMarksAt(sequence, cursorId), [sequence, cursorId]);
  const points = useMemo(() => foldMarkPoints(marks), [marks]);
  // The landmarks with the marks as point landmarks: a new call when the
  // marks change, the same call (and no new ask) while they stay.
  const pointsKey = points.map(({ at }) => `${at[0]},${at[1]}`).join(';');
  const landmarksQuery = useMemo<FoldStateCall<FoldLandmarks>>(
    () => foldLandmarksQuery(points.map(({ at }) => at)),
    // `points` is read through its key: an equal list must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointsKey]
  );
  const shownState = returned?.state ?? cursor.state;
  const scene = useFoldStateQuery(shownState, FOLD_SCENE_QUERY);
  const landmarks = useFoldStateQuery(shownState, landmarksQuery);
  // A landed preview becomes the step on screen when it is committed, with
  // these marks: its landmarks are asked now, while the folder looks at it,
  // so the canvas can pick on the step the moment it is committed.
  const landedPending = pending.status === 'landed' ? pending.state : null;
  useEffect(() => {
    if (!landedPending) return;
    foldSession()
      .query(landedPending, landmarksQuery)
      .catch((error: unknown) => reportError(error, { surface: 'fold:landed-landmarks' }));
  }, [landedPending, landmarksQuery]);
  const summary = returned?.summary ?? cursor.summary;
  // The operation that landed the state shown: the sequence tool's preview, or the step on screen.
  const node = cursorId === null ? undefined : sequence?.steps.find((step) => step.id === cursorId);
  const op = returned ? returned.request.op : node && !isLockedStep(node) ? node.op : null;
  const fresh = useMemo(
    () =>
      scene && summary
        ? { scene, summary, since: summary.step - (op ? foldOpSteps(op) : 1), imported: op?.kind === 'cp-jump' }
        : null,
    [scene, summary, op]
  );
  const picture = usePicture(fresh, loading(cursor));
  const index = useMemo(() => (scene ? foldPickIndex(scene, landmarks, points) : null), [scene, landmarks, points]);
  return {
    cursorId,
    summary: picture?.summary ?? summary,
    since: picture?.since ?? null,
    imported: picture?.imported ?? false,
    scene: picture?.scene ?? null,
    landmarks,
    marks,
    markPoints: points,
    // Unfold to step takes no clicks; Repeat's axis may be drawn on its own preview, as on the step before it.
    index: tool === 'unfold-to' ? null : index,
  };
}
