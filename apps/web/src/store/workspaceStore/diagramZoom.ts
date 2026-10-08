/**
 * Enlarged steps' captures against the store (Revision 2, Z2, Z7): the
 * Enlarged switch (Annotate's Step pane), and Update on an enlarged step and
 * Update All on its area (review fix 4), each one undo step.
 *
 * A flat step captured before steps kept their faces on the paper has none,
 * and a frame anchors nothing on it. So a capture whose source or enlarged
 * step is such a step first gives it its faces, folded again from its pattern
 * while its link is current and the fold draws its stored picture
 * (`stepWithPaperFaces`, Z11) — in the same undo step as the capture. A step
 * it cannot give them to keeps its picture as it is; its frame is copied in
 * picture units, and the Step pane says Refresh (`DiagramStepZoomStatus`).
 */
import {
  trackDiagramPicturePosed,
  trackDiagramStepEnlarged,
  type DiagramPictureKind,
  type DiagramStepEnlargedVia,
} from '../../analytics';
import { cpAuxLinesKey, NO_AUX_LINES_KEY } from '../../cp-workspace/folded/foldedAuxSource';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import { abandonOnEngineLoss } from '../../diagram/capture/engineLoss';
import { lacksPaperFaces, stepWithPaperFaces } from '../../diagram/capture/stepPaperFaces';
import {
  DEFAULT_DIAGRAM_STYLE,
  isLockedStep,
  isTurn,
  stepAsset,
  stepById,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepZoom,
} from '../../diagram/document/diagramDocument';
import { outOfDate, stepsToUpdate } from '../../diagram/zoom/areaStatus';
import { areaSource, captureSource, type ZoomCaptured } from '../../diagram/zoom/zoomCapture';
import {
  anchorInPlace,
  enlargeStep,
  unenlargeStep,
  updateEnlargedSteps,
  type LandedFirstFrame,
  type SeededStep,
} from '../../diagram/zoom/zoomFrames';
import { FOLD_RUN_NONE } from '../../lib/foldCancellation';
import { createCpCaptureRuntime } from './cpFoldRuntimeBindings';
import type { DiagramCommit, DiagramCaptureStore } from './diagramCapture';

/** The faces of older flat steps, folded again from their pattern: each step with its faces, by id, where it could be given them. */
export type PaperFacesBackfill = (steps: readonly DiagramStep[]) => Promise<ReadonlyMap<string, DiagramStep>>;

/**
 * The backfill against the store's crease pattern: nothing for a step that
 * has its faces or can have none, nor with no pattern open; a fold that
 * fails, is refused or draws another picture leaves that step to Refresh.
 */
export function storePaperFacesBackfill(store: DiagramCaptureStore): PaperFacesBackfill {
  return async (steps) => {
    const faced = new Map<string, DiagramStep>();
    const wanting = steps.filter(lacksPaperFaces);
    const cp = store.get().oristudioCpDocument;
    if (wanting.length === 0 || !cp) return faced;
    const style = store.get().diagram?.style ?? DEFAULT_DIAGRAM_STYLE;
    try {
      const segmentation = await abandonOnEngineLoss(ensureCpSegmentationArtifacts(cp.document));
      // A flat fold's faces: no 3D figure's aux lines are asked for, but the handle is the capture's own.
      const runtime = createCpCaptureRuntime(
        FOLD_RUN_NONE,
        cpAuxLinesKey(cp.geometry) === NO_AUX_LINES_KEY ? null : cp.handle
      );
      for (const step of wanting) {
        const got = await abandonOnEngineLoss(
          stepWithPaperFaces(runtime, { step, document: cp.document, segmentation, style })
        );
        if (got.status === 'faces') faced.set(step.id, got.step);
      }
    } catch {
      // Left without: the frame is copied in picture units, and the Step pane says Refresh.
    }
    return faced;
  };
}

/**
 * The faces a backfill found put on their steps — each only while its step
 * is as it was folded (its revision and picture key) and still has none. The
 * backfill runs inside another step's verb — Enlarged turned on for the step
 * after, Update — and its picture is the one it showed, so an
 * enlarged step among them shows as it did: its frame stays where it was
 * copied in picture units, its imprint made again from it on the faces
 * (`anchorInPlace`), and its marks stay on the paper they were on.
 */
export function withPaperFaces(document: DiagramDocument, faced: ReadonlyMap<string, DiagramStep>): DiagramDocument {
  if (faced.size === 0) return document;
  let steps: DiagramDocument['steps'] | null = null;
  document.steps.forEach((entry, index) => {
    const got = faced.get(entry.id);
    if (!got || isTurn(entry) || !lacksPaperFaces(entry)) return;
    if (entry.revision !== got.revision || entry.picture?.kind !== 'scene' || got.picture?.kind !== 'scene') return;
    if (entry.picture.key !== got.picture.key || got.picture.paperFaces === undefined) return;
    steps ??= document.steps.slice();
    steps[index] = anchorInPlace({ ...entry, picture: { ...entry.picture, paperFaces: got.picture.paperFaces } }, document.assets);
  });
  return steps ? { ...document, steps } : document;
}

/** A step's picture, as the analytics events name it. */
export function enlargedPictureKind(document: DiagramDocument, step: DiagramStep): DiagramPictureKind | null {
  if (step.source?.kind === 'references-step') return 'references';
  if (step.source?.kind === 'cp') {
    switch (step.source.render.mode) {
      case 'crease-pattern':
        return 'crease_pattern';
      case 'folded-flat':
        return 'flat';
      case 'folded-3d':
        return '3d';
      case 'simulated':
        return 'simulated';
    }
  }
  return stepAsset(document, step)?.kind ?? null;
}

/** A capture that placed a frame, counted (`diagram step enlarged`): none for one that placed nothing yet. */
export function trackCaptured(
  document: DiagramDocument,
  stepId: string,
  captured: Pick<ZoomCaptured, 'placed' | 'anchor'> & { shape: ZoomCaptured['zoom']['shape'] },
  via: DiagramStepEnlargedVia
): void {
  const step = stepById(document, stepId);
  const picture = step ? enlargedPictureKind(document, step) : null;
  if (!captured.placed || !picture) return;
  trackDiagramStepEnlarged(via, captured.placed, captured.anchor, captured.shape, picture);
}

/**
 * The frames that placed nothing yet — their steps have no picture — and
 * whose first picture is the capture's to count (`trackSeeded`), with how
 * they were captured: the Enlarged toggle turned on for a step with no
 * picture yet, a linked step not captured yet (`toggle`: Pose offered it
 * there until 2026-10-08; Annotate's Step pane, which has it now, needs a
 * picture), or a step made empty after
 * an enlarged one, by Add Step or Insert Step After (`seeded`). Each
 * enlarging is counted once, by `diagram step enlarged`: the entry is the
 * step's own, so a duplicate sharing its frame counts nothing, and it is
 * dropped when its first picture counts it, so a picture removed and given
 * back counts nothing again. Held by the frame itself, which undo and redo
 * give back as it was; for the session only, so a step saved and opened
 * again before its first picture counts nothing when it gets one.
 */
const awaitingPicture = new WeakMap<DiagramStepZoom, { stepId: string; via: 'toggle' | 'seeded' }>();

/** A step's frame, as `document` holds it, waiting for its first picture to count it as `via`. */
function awaitFirstPicture(document: DiagramDocument, stepId: string, via: 'toggle' | 'seeded'): void {
  const zoom = stepById(document, stepId)?.zoom;
  if (zoom) awaitingPicture.set(zoom, { stepId, via });
}

/**
 * A step's first picture that landed the frame it was enlarged with, counted
 * — as `toggle` or `seeded`, as it was enlarged — when that frame was
 * waiting for it ({@link awaitingPicture}). Nothing when it placed none, or
 * the step started whole, its first picture of another type than its run
 * (review fix 3): dropping the frame is not the user's action. The entry
 * stays, so a link of the run's type after an Undo still counts it once.
 */
export function trackSeeded(
  document: DiagramDocument,
  stepId: string,
  landed: Pick<LandedFirstFrame, 'placed' | 'enlargedWith'>
): void {
  const zoom = stepById(document, stepId)?.zoom;
  const { placed, enlargedWith } = landed;
  const waiting = enlargedWith ? awaitingPicture.get(enlargedWith) : undefined;
  if (!zoom || !placed || !enlargedWith || waiting?.stepId !== stepId) return;
  awaitingPicture.delete(enlargedWith);
  const anchor = placed === 'picture' ? 'none' : zoom.imprint?.picked ? 'picked' : 'auto';
  trackCaptured(document, stepId, { placed, anchor, shape: zoom.shape }, waiting.via);
}

/**
 * New steps seeded enlarged as they were made, each empty — Add Step, Insert
 * Step After; uploads and References cards are not seeded since review fix 3
 * — counted when its first picture lands its frame ({@link trackSeeded}).
 */
export function trackSeededSteps(document: DiagramDocument, seeded: readonly SeededStep[]): void {
  for (const { stepId } of seeded) awaitFirstPicture(document, stepId, 'seeded');
}

/**
 * Steps being enlarged, and the areas Update and Update All are placing from:
 * a second press while the faces are folded starts nothing more, and an
 * Update and an Update All of one area never run at once, so no step is
 * placed twice (review of review fix 4).
 */
const inFlight = new Set<string>();

/**
 * Enlarged turned on, as one undo step: the source's and the step's faces
 * first, where a fold can give them, then the capture (`enlargeStep`). False
 * when nothing changed: a read-only diagram, a newer build's step, one
 * enlarged already or with nothing to capture from, or a diagram replaced
 * while the faces were folded.
 */
export async function enlargeInStore(
  store: DiagramCaptureStore,
  commit: DiagramCommit,
  backfill: PaperFacesBackfill,
  stepId: string
): Promise<boolean> {
  const { diagram, diagramReadOnly, diagramLoadId } = store.get();
  const step = diagram && !diagramReadOnly ? stepById(diagram, stepId) : null;
  const source = diagram && step ? captureSource(diagram, stepId) : null;
  if (!step || isLockedStep(step) || step.zoom || !source || inFlight.has(stepId)) return false;
  inFlight.add(stepId);
  try {
    const faced = await backfill([source.step, step]);
    if (store.get().diagramLoadId !== diagramLoadId) return false;
    let captured: ZoomCaptured | null = null;
    const next = commit('Enlarge step', (document) => {
      if (stepById(document, stepId)?.zoom) return document;
      const result = enlargeStep(withPaperFaces(document, faced), stepId, document.assets);
      captured = result.captured;
      return captured ? result.document : document;
    });
    if (!next || !captured) return false;
    const made = captured as ZoomCaptured;
    // A step with no picture yet places nothing: its first picture counts the toggle (`trackSeeded`).
    if (made.placed === null) awaitFirstPicture(next, stepId, 'toggle');
    else trackCaptured(next, stepId, { ...made, shape: made.zoom.shape }, 'toggle');
    return true;
  } finally {
    inFlight.delete(stepId);
  }
}

/** Enlarged turned off, as one undo step: the frame dropped, the marks carried to the whole picture. */
export function unenlargeInStore(store: DiagramCaptureStore, commit: DiagramCommit, stepId: string): boolean {
  const next = commit('Show whole step', (document) => unenlargeStep(document, stepId, document.assets));
  if (!next) return false;
  const step = stepById(next, stepId);
  const picture = step ? enlargedPictureKind(next, step) : null;
  if (picture) trackDiagramPicturePosed('enlarge_off', picture);
  return true;
}

/**
 * What an update places again (review fix 4): one enlarged step, from its
 * area (Update: in the Step pane beside "Step N's area changed", and the
 * card's menu), or the steps enlarged from these areas that are out of date
 * (Update All, on the area's step and its row in Layers; `stepsToUpdate`).
 */
export type EnlargedUpdate = { stepId: string } | { areaIds: readonly string[] };

/**
 * The areas an update captures from, and the steps it places, from the
 * diagram as it is: only steps out of date (`outOfDate`), so an Update of a
 * step that is not records no undo step that changes nothing.
 */
function updateTargets(document: DiagramDocument, request: EnlargedUpdate): { areaIds: string[]; stepIds: string[] } {
  if ('stepId' in request) {
    const from = stepById(document, request.stepId)?.zoom?.from;
    return from !== undefined && outOfDate(document, request.stepId)
      ? { areaIds: [from], stepIds: [request.stepId] }
      : { areaIds: [], stepIds: [] };
  }
  const areaIds = request.areaIds.filter((areaId) => areaSource(document, areaId) !== null);
  return { areaIds, stepIds: stepsToUpdate(document, areaIds) };
}

/**
 * Update or Update All, as one undo step: the areas' steps' faces and every
 * step's it places first, where a fold can give them, then each captured
 * again from its area as it is now, which it records (review fix 4). How
 * many steps it placed: none on a read-only diagram, with the area gone,
 * with nothing out of date, or while an update of the same area runs.
 */
export async function updateInStore(
  store: DiagramCaptureStore,
  commit: DiagramCommit,
  backfill: PaperFacesBackfill,
  request: EnlargedUpdate
): Promise<number> {
  const { diagram, diagramReadOnly, diagramLoadId } = store.get();
  const { areaIds, stepIds: targets } = diagram && !diagramReadOnly ? updateTargets(diagram, request) : { areaIds: [], stepIds: [] };
  // Keyed by its areas too: one Update and one Update All of the same area refuse each other.
  const keys = 'stepId' in request ? [request.stepId, ...areaIds] : areaIds;
  if (!diagram || targets.length === 0 || keys.some((key) => inFlight.has(key))) return 0;
  keys.forEach((key) => inFlight.add(key));
  try {
    const sources = areaIds.flatMap((areaId) => areaSource(diagram, areaId)?.step ?? []);
    const steps = targets.flatMap((id) => stepById(diagram, id) ?? []);
    const faced = await backfill([...new Set([...sources, ...steps])]);
    if (store.get().diagramLoadId !== diagramLoadId) return 0;
    let placed: ZoomCaptured[] = [];
    let ids: string[] = [];
    const one = 'stepId' in request;
    const next = commit(one ? 'Update enlarged step' : 'Update enlarged steps', (document) => {
      let edited = withPaperFaces(document, faced);
      placed = [];
      ids = [];
      // The steps out of date when it was asked, still enlarged from their areas: the faces given them first
      // anchor a copied frame where it is, which says nothing of where the area puts it.
      for (const areaId of areaIds) {
        const result = updateEnlargedSteps(edited, areaId, document.assets, targets);
        edited = result.document;
        placed.push(...result.captured);
        ids.push(...result.stepIds);
      }
      return ids.length > 0 ? edited : document;
    });
    if (!next) return 0;
    placed.forEach((captured, index) => {
      const id = ids[index];
      if (id) trackCaptured(next, id, { ...captured, shape: captured.zoom.shape }, one ? 'update_step' : 'update');
    });
    return placed.length;
  } finally {
    keys.forEach((key) => inFlight.delete(key));
  }
}
