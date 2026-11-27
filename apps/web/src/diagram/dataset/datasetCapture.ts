/**
 * A step captured again the way Refresh captures it, and the 3D window check
 * on what an unspread 3D step folds into. Test-only.
 *
 * The request is the one `runDiagramCapture` builds: the step's scope and
 * render, what it remembers of its creases (`knownCreasesOf`), the diagram's
 * style, the sheet's paper and the spread a flat fold starts with. What this
 * Phase cannot capture headless is skipped and says so; it never passes.
 */
import type { PaperScene } from '@treemaker/origami-simulator';
import { folded3dPaperScene, folded3dSceneCamera } from '../../cp-workspace/folded/folded3dScene';
import { WINDOW_PARITY_BOX, compareWithWindow } from '../../cp-workspace/folded/folded3dWindowParity.testSupport';
import { UnmodeledShaderError } from '../../simulator/meshRendererReplay.testSupport';
import { captureStep, type CaptureStepResult } from '../capture/captureFolded';
import { knownCreasesOf } from '../capture/captureCreases';
import { spreadStartsFor, type DiagramCpSource, type DiagramDocument, type DiagramStep } from '../document/diagramDocument';
import { diagramPaperStyle } from '../pictures/diagramPaperStyle';
import type { SanitizeEnv } from '../upload/svgSanitize';
import { sha256 } from './datasetCorpus';
import type { LoadedPattern } from './datasetKernel';
import { withFolded3d } from './datasetPose';
import type { CaptureRecord, WindowRecord } from './datasetResults';
import { orderFreeDigest, sceneCounts } from './sceneCompare';

/** The app's capture limits (prepare and clip workers, 12 s each) are not run here; a step over this is not compared exactly. */
export const TIMING_SENSITIVE_MS = 10_000;

/** Why this Phase does not capture a step headless, or null when it does. */
export function captureSkipReason(step: DiagramStep): string | null {
  if (step.unknown) return "locked: a newer build's step";
  const source = step.source;
  if (!source) return 'an empty step';
  if (source.kind === 'fold-step') return 'a Fold-linked step (Phase 2)';
  if (source.kind === 'references-step') return 'a References card, which is never refreshed';
  if (source.kind !== 'cp') return `a ${source.kind} step`;
  if (source.layerOrder) return 'a layer-order record (Phase 2)';
  const { render } = source;
  if (render.mode === 'folded-3d' && render.spread?.kind === 'spatial' && render.spread.amount > 0) {
    return 'a spatial spread (Phase 2)';
  }
  if (render.mode === 'simulated' && render.foldPercent === 0) return 'Simulated at 0%, which needs the simulator (Phase 2)';
  return null;
}

export interface Captured {
  record: CaptureRecord;
  /** What Refresh would store as the step's new source; set when captured. */
  source?: DiagramCpSource;
  scene?: PaperScene;
}

function notCaptured(result: Exclude<CaptureStepResult, { status: 'captured' }>, ms: number): CaptureRecord {
  const detail =
    result.status === 'refused'
      ? JSON.stringify(result.refusal)
      : result.status === 'layer-order-lost'
        ? result.cause
        : undefined;
  return { outcome: 'not-captured', status: result.status, ...(detail ? { detail } : {}), ms };
}

/**
 * Captures `step` on `pattern`, as Refresh would. `source` stands in for the
 * step's own, as the aux probe's refreshed link does.
 */
export async function captureForRefresh(
  pattern: LoadedPattern,
  diagram: DiagramDocument,
  step: DiagramStep,
  options: { env?: SanitizeEnv; source?: DiagramCpSource } = {}
): Promise<{ result: CaptureStepResult | null; error?: string; ms: number }> {
  const source = options.source ?? (step.source as DiagramCpSource);
  const started = performance.now();
  try {
    const result = await captureStep(pattern.runtime, {
      document: pattern.document,
      sheets: pattern.sheets,
      scope: source.scope,
      known: knownCreasesOf(source),
      render: source.render,
      style: diagram.style,
      sheetPaper: pattern.sheetPaper,
      spreadStart: spreadStartsFor(diagram, step.id).any,
      ...(options.env ? { env: options.env } : {}),
    });
    return { result, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { result: null, error: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started) };
  }
}

/** A step's capture as the results record it; `write` stores its scene and returns where. */
export async function captureRecord(
  pattern: LoadedPattern,
  diagram: DiagramDocument,
  step: DiagramStep,
  write: (sceneJson: string) => string,
  env?: SanitizeEnv
): Promise<Captured> {
  const skip = captureSkipReason(step);
  if (skip) return { record: { outcome: 'skipped', reason: skip } };
  const { result, error, ms } = await captureForRefresh(pattern, diagram, step, env ? { env } : {});
  if (!result) return { record: { outcome: 'threw', error: error ?? 'unknown error', ms } };
  if (result.status !== 'captured') return { record: notCaptured(result, ms) };
  const { captured } = result;
  if (captured.kind === 'over-budget') {
    return { record: { outcome: 'over-budget', spreadFailed: captured.spreadFailed === true, ms }, source: result.source };
  }
  const { picture } = captured;
  if (picture.kind !== 'scene') {
    return {
      record: { outcome: 'not-captured', status: 'captured', detail: `a ${picture.kind} picture, not compared in Phase 1`, ms },
      source: result.source,
    };
  }
  const scene = JSON.parse(picture.sceneJson) as PaperScene;
  return {
    record: {
      outcome: 'captured',
      key: picture.key,
      paperFacesSha256: sha256(JSON.stringify(picture.paperFaces ?? null)),
      sourceSha256: sha256(JSON.stringify(result.source)),
      fingerprint: result.source.fingerprint ?? 'none',
      orderFreeSha256: orderFreeDigest(scene),
      counts: sceneCounts(scene),
      spreadFailed: picture.spreadFailed === true,
      noLayerOrder: result.noLayerOrder,
      ms,
      timingSensitive: ms > TIMING_SENSITIVE_MS,
      scene: write(picture.sceneJson),
    },
    source: result.source,
    scene,
  };
}

/**
 * The 3D window check on an unspread 3D step: its fold, its own aux lines and
 * camera, the scene built for the window's box and compared with the
 * window's draw passes. Null for a step that does not fold in 3D now;
 * `refused` when the window draws with shaders the replay does not read,
 * which the window model takes its depth mode from.
 */
export async function windowCheck(
  pattern: LoadedPattern,
  diagram: DiagramDocument,
  step: DiagramStep
): Promise<WindowRecord | { refused: string } | null> {
  const source = step.source;
  if (source?.kind !== 'cp' || source.render.mode !== 'folded-3d') return null;
  const savedCamera = source.render.camera;
  return withFolded3d(pattern, step, ({ mesh, render, tolerances }) => {
    const camera = folded3dSceneCamera(savedCamera, mesh, WINDOW_PARITY_BOX);
    const scene = folded3dPaperScene(mesh, render, camera, {
      style: diagramPaperStyle(diagram.style),
      markHidden: true,
      tolerances,
      displayStyle: 'Paper5',
    });
    let result: ReturnType<typeof compareWithWindow>;
    try {
      result = compareWithWindow(mesh, scene, camera);
    } catch (error) {
      if (error instanceof UnmodeledShaderError) return { refused: error.reason };
      throw error;
    }
    return {
      painted: result.painted,
      paper: result.paper,
      missingInk: result.missingInk,
      strayInk: result.spuriousInkByRole,
      strayLines: result.linesWithSpuriousInk,
    };
  });
}
