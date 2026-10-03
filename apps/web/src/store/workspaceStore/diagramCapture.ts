/**
 * A linked Diagram step's capture, run against the store (D4): choose the
 * step's creases from the crease pattern as it stands, fold them if its
 * render folds — a visible, stoppable run in the fold-run registry, so the
 * global "Folding…" toast and Stop reach it from any workspace — and commit
 * the picture to the step by id, as one undo step.
 *
 * A capture outlives nothing it was not meant for: its result is dropped when
 * the diagram was replaced while it ran, the step is gone, or the step's
 * source changed under it (its `revision`). Opening a diagram never captures.
 */
import { captureStep, type CapturedPicture } from '../../diagram/capture/captureFolded';
import {
  DEFAULT_DIAGRAM_STYLE,
  isLockedStep,
  randomDiagramId,
  setLinkedPicture,
  stepIndex,
  type DiagramCpRender,
  type DiagramCpScope,
  type DiagramDocument,
  type DiagramPicture,
  type DiagramStyle,
  type KnownDiagramAsset,
} from '../../diagram/document/diagramDocument';
import { diagramSurfaceStyle } from '../../diagram/pictures/diagramPaperStyle';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import { cpAuxLinesKey, NO_AUX_LINES_KEY } from '../../cp-workspace/folded/foldedAuxSource';
import type { OristudioCpFold3dRefusal } from '../../engine/oristudioCpTypes';
import { FOLD_RUN_NONE } from '../../lib/foldCancellation';
import { paperPngSize, paperSvgToPng } from '../../lib/paper/paperPng';
import type { PaperPage } from '../../lib/paper/paperPage';
import { pagePtPerPx, paperSceneToSvg } from '../../lib/paper/paperSvg';
import { createCpCaptureRuntime } from './cpFoldRuntimeBindings';
import { stopFoldRun, withFoldInFlight } from './foldRuns';
import { isFoldCancellation, oristudioCpError } from './oristudioCpRuntime';
import type { WorkspaceState } from './types';

export interface DiagramCaptureRequest {
  scope: DiagramCpScope;
  render: DiagramCpRender;
  /** Which run it is in the fold-run registry: a Pose or a link, or a Refresh. */
  kind: 'diagram-capture' | 'diagram-refresh';
  /** The undo step's name. */
  label: string;
}

export type DiagramCaptureOutcome =
  | {
      status: 'captured';
      /** False when the capture changed nothing, and no undo step was recorded. */
      changed: boolean;
      /** The render as captured: the folder the creases need may not be the one asked for. */
      render: DiagramCpRender;
      /** The fold found no layer order; the picture is its transparent development. */
      noLayerOrder: boolean;
      /** Too detailed to keep as vector; kept as a bitmap. */
      tooDetailed: boolean;
    }
  | { status: 'no-pattern' }
  | { status: 'missing' }
  | { status: 'unknown' }
  | { status: 'refused'; refusal: OristudioCpFold3dRefusal }
  | { status: 'stopped' }
  | { status: 'discarded' }
  | { status: 'busy' }
  | { status: 'read-only' }
  | { status: 'failed'; message: string };

/** One capture in flight, by step: what a card shows progress and a Stop for. */
export interface DiagramCaptureRun {
  /** The fold run a Stop names; null while the creases are being chosen, or for a picture with no fold. */
  runId: number | null;
}

/** The store as a capture uses it. */
export interface DiagramCaptureStore {
  get: () => WorkspaceState;
  set: (partial: Partial<WorkspaceState>) => void;
}

/**
 * The box a picture too detailed to keep as vector is drawn in, and how
 * finely (D2): a bitmap, at 300 dpi, of an 80 mm picture.
 */
export const CAPTURE_RASTER_BOX_MM = 80;
const CAPTURE_RASTER_DPI = 300;

/**
 * Capture a step's picture and commit it. `commit` is the slice's: one undo
 * step, the project dirty, nothing for an edit that changes nothing.
 */
export async function runDiagramCapture(
  store: DiagramCaptureStore,
  commit: (label: string, edit: (document: DiagramDocument) => DiagramDocument) => DiagramDocument | null,
  stepId: string,
  request: DiagramCaptureRequest
): Promise<DiagramCaptureOutcome> {
  const state = store.get();
  if (state.diagramReadOnly) return { status: 'read-only' };
  if (Object.hasOwn(state.diagramCaptures, stepId)) return { status: 'busy' };
  const cp = state.oristudioCpDocument;
  if (!cp) return { status: 'no-pattern' };
  const step = state.diagram?.steps[stepIndex(state.diagram, stepId)];
  if (!step || isLockedStep(step)) return { status: 'discarded' };
  const { diagramLoadId: loadId } = state;
  const { revision } = step;
  const style = state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE;
  const document = cp.document;
  // A 3D figure carries the document's aux lines; a document with none asks nothing.
  const auxHandle = cpAuxLinesKey(cp.geometry) === NO_AUX_LINES_KEY ? null : cp.handle;

  setRun(store, stepId, { runId: null });
  try {
    const segmentation =
      request.scope.kind === 'segment' ? await ensureCpSegmentationArtifacts(document) : null;
    const capture = (runId: number) =>
      captureStep(createCpCaptureRuntime(runId, auxHandle), {
        document,
        segmentation,
        scope: request.scope,
        render: request.render,
        style,
      });
    const result =
      request.render.mode === 'crease-pattern'
        ? // Nothing is folded: there is no run to show or stop.
          await capture(FOLD_RUN_NONE)
        : await withFoldInFlight(store, request.kind, (runId) => {
            if (Object.hasOwn(store.get().diagramCaptures, stepId)) setRun(store, stepId, { runId });
            return capture(runId);
          });
    if (result.status !== 'captured') return result;

    const kept = await keptPicture(result.captured, result.source.render, style);
    const now = store.get();
    const current = now.diagram?.steps[stepIndex(now.diagram, stepId)];
    if (now.diagramLoadId !== loadId || !current || current.revision !== revision) {
      return { status: 'discarded' };
    }
    const next = commit(request.label, (diagram) =>
      setLinkedPicture(diagram, stepId, { source: result.source, ...kept })
    );
    return {
      status: 'captured',
      changed: next !== null,
      render: result.source.render,
      noLayerOrder: result.noLayerOrder,
      tooDetailed: kept.asset !== undefined,
    };
  } catch (error) {
    if (isFoldCancellation(error)) return { status: 'stopped' };
    return { status: 'failed', message: oristudioCpError(error).message };
  } finally {
    clearRun(store, stepId);
  }
}

/** Stop a step's capture, if it is folding. */
export function stopDiagramCapture(store: DiagramCaptureStore, stepId: string): boolean {
  const run = store.get().diagramCaptures[stepId];
  return run?.runId != null && stopFoldRun(store, run.runId);
}

function setRun(store: DiagramCaptureStore, stepId: string, run: DiagramCaptureRun): void {
  store.set({ diagramCaptures: { ...store.get().diagramCaptures, [stepId]: run } });
}

function clearRun(store: DiagramCaptureStore, stepId: string): void {
  const runs = store.get().diagramCaptures;
  if (!Object.hasOwn(runs, stepId)) return;
  const { [stepId]: _finished, ...rest } = runs;
  store.set({ diagramCaptures: rest });
}

/**
 * The picture a step keeps: the capture's own, or — for a scene past the
 * budget — a bitmap of it in the diagram's pens, kept as an asset.
 */
async function keptPicture(
  captured: CapturedPicture,
  render: DiagramCpRender,
  style: DiagramStyle
): Promise<{ picture: DiagramPicture; asset?: KnownDiagramAsset }> {
  if (captured.kind === 'picture') return { picture: captured.picture };
  const pagePaper: PaperPage = {
    sheet: { mm: CAPTURE_RASTER_BOX_MM },
    paddingMm: 1,
    background: null,
    keepHiddenFaces: false,
  };
  const measure = render.mode === 'crease-pattern' ? 'sheet' : 'figure';
  const page = paperSceneToSvg(captured.scene, diagramSurfaceStyle(style), pagePaper, measure);
  const png = await paperSvgToPng(page, CAPTURE_RASTER_DPI);
  const { width, height } = paperPngSize(page, CAPTURE_RASTER_DPI);
  const src = `data:image/png;base64,${base64(png)}`;
  const id = randomDiagramId('asset');
  // The bitmap's own px per pattern unit: the scene's, through the page's scale.
  const pxPerScenePx = (pagePtPerPx(captured.scene, pagePaper, measure) * CAPTURE_RASTER_DPI) / 72;
  const paperScale = captured.paperScale === null ? null : captured.paperScale * pxPerScenePx;
  return {
    picture: { kind: 'asset', assetId: id, paperScale, key: `raster-${id}` },
    asset: { id, kind: 'raster', src, widthPx: width, heightPx: height, bytes: src.length },
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}
