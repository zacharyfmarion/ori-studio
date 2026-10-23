/**
 * A Diagram step's capture from a Fold step, run against the store (plan
 * D17): the step marked capturing, its picture captured from the Fold
 * session's replay (`captureFoldStep`), and committed to the step by id as
 * one undo step — or folded into an entry already made (Refresh all, a pull
 * that captures as it adds).
 *
 * The same guard as every capture's (`beginCaptureRun`): a result is dropped
 * when the diagram was replaced while it ran, or the step is gone or its
 * source changed under it. Nothing is folded here — the session lands every
 * state — so there is no fold run to show or stop.
 *
 * The capture and the session are Fold's code, loaded the first time a step
 * is captured from Fold (`foldGateway`): the store holds every workspace's
 * slices, and Diagram's capture from Fold is not a reason for all of them to
 * download it.
 */
import i18n from '../../i18n';
import type { FoldStepCaptureRequest } from '../../diagram/fold/foldStepCapture';
import type { DiagramCpRender } from '../../diagram/document/diagramDocument';
import type { FoldSession } from '../../fold/session/foldSession';
import { loadFold } from '../../workspaces/foldGateway';
import {
  beginCaptureRun,
  commitStepCapture,
  endStepCapture,
  type DiagramCaptureStore,
  type DiagramCommit,
} from './diagramCapture';

export interface DiagramFoldCaptureRequest extends FoldStepCaptureRequest {
  /** The undo step's name. */
  label: string;
  /** An undo entry to fold this capture into while it is still the newest (Refresh all's). */
  joinEntry?: object;
}

export type DiagramFoldCaptureOutcome =
  | {
      status: 'captured';
      /** False when the capture changed nothing, and no undo step was recorded. */
      changed: boolean;
      render: DiagramCpRender;
      /** Too detailed to keep as vector; kept as a bitmap. */
      tooDetailed: boolean;
      /** Marks the fold brought that the author had edited, swapped for its own (RM6). */
      replaced: number;
    }
  | { status: 'missing' }
  | { status: 'unknown'; why: 'not-shown' | 'locked' | 'unavailable' }
  | { status: 'discarded' }
  | { status: 'busy' }
  | { status: 'read-only' }
  | { status: 'failed'; code: string; message: string };

/** Capture a step's picture from its Fold step as it is now, and commit it. `session` defaults to the app's. */
export async function runDiagramFoldCapture(
  store: DiagramCaptureStore,
  commit: DiagramCommit,
  stepId: string,
  request: DiagramFoldCaptureRequest,
  session?: FoldSession
): Promise<DiagramFoldCaptureOutcome> {
  const start = beginCaptureRun(store, stepId);
  if ('status' in start) return start;
  try {
    const fold = await loadFold();
    const result = await fold.captureFoldStep(session ?? fold.foldSession(), request, { t: i18n.t.bind(i18n) });
    if (result.status !== 'captured') return result;
    const committed = await commitStepCapture(
      store,
      commit,
      start,
      { source: result.source, picture: result.captured, marks: result.marks },
      request.label,
      request.joinEntry
    );
    if (!committed) return { status: 'discarded' };
    return {
      status: 'captured',
      changed: committed.changed,
      render: result.source.render,
      tooDetailed: committed.tooDetailed,
      replaced: committed.replaced ?? 0,
    };
  } catch (error) {
    // The worker rejects with a plain envelope, `{ code, message }`.
    const envelope = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : {};
    return {
      status: 'failed',
      code: typeof envelope.code === 'string' ? envelope.code : 'fold_capture',
      message: typeof envelope.message === 'string' ? envelope.message : String(error),
    };
  } finally {
    endStepCapture(store, stepId);
  }
}
