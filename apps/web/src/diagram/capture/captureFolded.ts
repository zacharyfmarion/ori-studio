/**
 * A linked step's picture, captured (D2, D4, D5): the crease pattern itself,
 * the flat folded model, or the folded model in 3D — each made from the
 * creases its scope chooses today, and kept in the stored form a step holds.
 *
 * The kernel is injected ({@link CpCaptureRuntime}), so this module never
 * touches the wasm runtime or the store, and never folds anything into Edit:
 * a capture's figure is its own, freed when the picture is read.
 *
 * The primitives below are shared by the one-shot capture here (Link, Refresh)
 * and the Pose session, which holds a figure open and reads it again as it is
 * turned over, rotated or stepped to another solution.
 */
import type { FoldArtifacts } from '../../engine/types';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFold3dFoldResult,
  OristudioCpFold3dRefusal,
  OristudioCpFold3dStepResult,
  OristudioCpFolded3dAuxLines,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
} from '../../engine/oristudioCpTypes';
import {
  defaultFolded3dCamera,
  folded3dFrameRadius,
  type FoldedFigureCamera,
} from '../../cp-workspace/folded/folded3dCamera';
import { folded3dSceneStyleKey } from '../../cp-workspace/folded/folded3dScene';
import { folded3dFigureScene } from '../../cp-workspace/folded/folded3dStoredScene';
import { foldedFigureExportDocument } from '../../cp-workspace/folded/foldedFigureExport';
import { foldedFlatPaperScene } from '../../cp-workspace/folded/foldedFlatScene';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { resolveFoldRoute } from '../../cp-workspace/folded/foldRoute';
import {
  openFold,
  readFoldedPicture,
  type CpFoldRuntime,
  type FoldedFigureState,
  type FoldedPicture,
} from '../../lib/creaseExportFold';
import type { Point } from '../../lib/geometry';
import { DEFAULT_FOLDED_MODEL, foldedFigureModelFromOrieditaMetadata } from '../../lib/orieditaNativeMetadata';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import type {
  DiagramCpRender,
  DiagramCpScope,
  DiagramCpSource,
  DiagramFixedPicture,
  DiagramLayerSpread,
  DiagramScenePicture,
  DiagramSimulatedView,
  DiagramStyle,
} from '../document/diagramDocument';
import { storedCpSource, storedSceneJson } from '../document/diagramFile';
import { diagramPaperStyle } from '../pictures/diagramPaperStyle';
import { simulatorSceneStyleKey } from '../../simulator/simulatorExportTarget';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import { digest } from '../pictures/pictureKey';
import { sanitizeSvg, SVG_STORED_MAX_BYTES, type SanitizeEnv } from '../upload/svgSanitize';
import {
  chooseStepCreases,
  creasesFingerprint,
  followedScope,
  type KnownCreases,
  type StepCreases,
} from './captureCreases';
import { creasesThumbnail } from './captureThumbnail';
import { CAPTURE_PX_PER_UNIT, storableScene, turnClockwise } from './captureGeometry';
import { creasePatternScene } from './creasePatternScene';

/**
 * The kernel calls a capture makes: Edit's fold runtime for flat figures, and
 * the 3D fold beside it. Bound to one fold run, so a Stop reaches it.
 */
export interface CpCaptureRuntime extends CpFoldRuntime {
  fold3d: (
    lineIds: number[],
    model: OristudioCpFoldedFigureModel | undefined
  ) => Promise<OristudioCpFold3dFoldResult>;
  fold3dAnother: (handle: number) => Promise<OristudioCpFold3dStepResult>;
  /** The document's aux lines carried onto a 3D figure, or null when it has none. */
  aux3d: (handle: number) => Promise<OristudioCpFolded3dAuxLines | null>;
}

/** The most a stored scene may be, as the `sceneJson` string (D2's 2 MB guard). */
export const SCENE_BUDGET_BYTES = 2 * 1024 * 1024;

/**
 * A picture as a step stores it, or a scene too detailed to keep as vector,
 * which the caller turns into a bitmap (it needs a canvas, and this module
 * has none).
 */
export type CapturedPicture =
  | { kind: 'picture'; picture: DiagramScenePicture | DiagramFixedPicture }
  | { kind: 'over-budget'; scene: PaperScene; paperScale: number | null };

/**
 * The folded-figure model a capture folds with: the document's own (a reopened
 * Oriedita file keeps its colours, which a fold with no layer order is drawn
 * in), at rotation 0 and scale 1 — a step's pose is applied to the picture,
 * never to the fold — and on the side asked for.
 */
export function captureModel(
  document: OristudioCpDocumentSnapshot,
  side: 'front' | 'back'
): OristudioCpFoldedFigureModel {
  const base = foldedFigureModelFromOrieditaMetadata(document.metadata) ?? DEFAULT_FOLDED_MODEL;
  return { ...base, scale: 1, rotation: 0, state: sideState(side) };
}

export function sideState(side: 'front' | 'back'): OristudioCpFoldedFigureState {
  return side === 'back' ? 'Back1' : 'Front0';
}

/** A scene in stored form, or over the budget. */
export function storeScene(
  scene: PaperScene,
  paperScale: number | null,
  styleKey: string | null
): CapturedPicture {
  const stored = storableScene(scene);
  const sceneJson = storedSceneJson(stored);
  if (sceneJson === null || stored.items.length === 0) {
    throw new Error('The capture produced nothing to draw');
  }
  if (sceneJson.length > SCENE_BUDGET_BYTES) return { kind: 'over-budget', scene: stored, paperScale };
  return {
    kind: 'picture',
    picture: { kind: 'scene', sceneJson, paperScale, styleKey, key: `scene-${digest(sceneJson)}` },
  };
}

/**
 * The simulator's model of a step's region from a camera, in a style's light:
 * at rest (a {@link SimulateFlat} bound to the region, {@link flatStill}) or
 * where Pose's solver holds it now. Null when there is no model to draw.
 */
export type StillScene = (view: DiagramSimulatedView, style: PaperStyle) => Promise<PaperScene | null>;

/** The flat sheet of a step's region, as a {@link StillScene}; absent with no simulator to ask. */
export function flatStill(simulateFlat: SimulateFlat | undefined, creases: StepCreases): StillScene | undefined {
  return simulateFlat && ((view, style) => simulateFlat(creases.segment, view, style));
}

/**
 * A step shown as Simulated: the simulator's model from the step's camera, as
 * a stored scene that records the simulator's light (D19) — one body for the
 * headless 0% and Pose's live solver, so the two cannot drift. Null when there
 * is no simulator to ask or the region has no model.
 */
export async function captureSimulated(
  still: StillScene | undefined,
  view: DiagramSimulatedView,
  style: DiagramStyle
): Promise<CapturedPicture | null> {
  if (!still) return null;
  const drawn = diagramPaperStyle(style);
  const scene = await still(view, drawn);
  return scene ? storeScene(scene, null, simulatorSceneStyleKey(drawn)) : null;
}

/** A crease-pattern picture, from the document alone: no fold. */
export function captureCreasePattern(
  document: OristudioCpDocumentSnapshot,
  creases: StepCreases,
  rotationDeg: number
): CapturedPicture {
  return storeScene(creasePatternScene(document, creases, rotationDeg), CAPTURE_PX_PER_UNIT, null);
}

/**
 * A held flat figure's picture, turned clockwise by `rotationDeg`: the
 * kernel's paper scene in whole faces, or — for a fold the kernel could not
 * order (`NoSolutions`, `Contradiction`), which it leaves at its transparent
 * development — that development as our own SVG, sanitized like an upload.
 * With a `spread` the paper scene's layers step apart on the turned picture,
 * every face kept, since a layer the drawer covers may now show an edge; the
 * development has no layers to spread and is drawn as it is.
 */
export async function readFlatPicture(
  runtime: CpFoldRuntime,
  handle: number,
  state: Pick<FoldedFigureState, 'displayStyle'>,
  rotationDeg: number,
  env?: SanitizeEnv,
  spread?: LayerSpreadOptions
): Promise<CapturedPicture> {
  return flatPicture(await readFoldedPicture(runtime, handle, state.displayStyle), rotationDeg, env, spread);
}

/**
 * {@link readFlatPicture} of a figure already read: the turn and the spread
 * are the picture's, applied here with no call to the kernel, so a Pose
 * session that keeps what it read turns and spreads it again for nothing.
 */
export function flatPicture(
  { snapshot, scene }: FoldedPicture,
  rotationDeg: number,
  env?: SanitizeEnv,
  spread?: LayerSpreadOptions
): CapturedPicture {
  if (scene && scene.faces.length > 0) {
    const turn = turnClockwise(rotationDeg);
    const toScenePx = (point: Point): ScenePoint => {
      const turned = turn(point);
      return [turned.x * CAPTURE_PX_PER_UNIT, turned.y * CAPTURE_PX_PER_UNIT];
    };
    const flat = foldedFlatPaperScene(scene, {
      markHidden: !spread,
      toScenePx,
      scale: CAPTURE_PX_PER_UNIT,
      ...(spread ? { spread } : {}),
    });
    return storeScene(flat, CAPTURE_PX_PER_UNIT, null);
  }
  const page = foldedFigureExportDocument(snapshot, { showBackgroundColor: false, rotationDeg });
  if (!page) throw new Error('The folded figure produced nothing to draw');
  return { kind: 'picture', picture: fixedPicture(page.svg, env) };
}

/**
 * Our own SVG as a step keeps it: sanitized as an upload is (D7), its ids
 * prefixed with its key, so the file's validator reads back the same bytes.
 */
export function fixedPicture(svg: string, env?: SanitizeEnv): DiagramFixedPicture {
  const key = `fixed-${digest(svg)}`;
  const result = sanitizeSvg(svg, { idPrefix: key, mode: 'load', env });
  if (!result.ok) throw new Error(`The folded figure's drawing did not sanitize: ${result.error}`);
  if (result.svg.length > SVG_STORED_MAX_BYTES) throw new Error('The folded figure is too detailed to keep');
  return { kind: 'fixed', svg: result.svg, widthPx: result.widthPx, heightPx: result.heightPx, key };
}

/**
 * A 3D figure's picture at a camera, in the diagram's light: the window's
 * scene (`folded3dFigureScene`), built at the space Edit stores a figure in.
 * Its scale is approximate — the camera has perspective — so it carries no
 * paper scale, and is fitted to its cell (D10). It records the light it was
 * built under, so a change of style can say it needs refreshing (D5).
 */
export function capture3dPicture(
  fold: { snapshot: OristudioCpFold3dStepResult['snapshot']; render: OristudioCpFold3dStepResult['render'] },
  camera: FoldedFigureCamera,
  style: DiagramStyle,
  aux: OristudioCpFolded3dAuxLines | null
): CapturedPicture {
  const drawn = diagramPaperStyle(style);
  const scene = folded3dFigureScene(
    {
      camera,
      displayStyle: 'Paper5',
      folded3d: fold.snapshot,
      frameRadius: folded3dFrameRadius(fold.render),
    },
    fold.render,
    { style: drawn, space: 'document', markHidden: true, aux }
  );
  if (!scene) throw new Error('The folded figure produced nothing to draw');
  return storeScene(scene, null, folded3dSceneStyleKey(drawn));
}

/**
 * The 3D render a flat request turns into when its creases fold in 3D, and
 * back: a flat fold started so has its layers spread by `spread` (13g).
 */
function renderForRoute(
  render: DiagramCpRender,
  route: 'flat' | 'spatial',
  spread: DiagramLayerSpread | undefined
): DiagramCpRender {
  if (render.mode === 'crease-pattern' || render.mode === 'simulated') return render;
  if (route === 'flat') {
    return render.mode === 'folded-flat'
      ? render
      : { mode: 'folded-flat', side: render.side, rotationDeg: 0, foldCase: 1, ...(spread ? { spread } : {}) };
  }
  if (render.mode === 'folded-3d') return render;
  return { mode: 'folded-3d', side: render.side, camera: defaultCaptureCamera(render.side) };
}

/** The camera a new 3D picture is taken from: Edit's, from the side asked for. */
export function defaultCaptureCamera(side: 'front' | 'back'): FoldedFigureCamera {
  return defaultFolded3dCamera(undefined, sideState(side));
}

/**
 * The simulator's flat sheet for a region, from a camera, in a style's light
 * (`SimulatorWorkerApi.flatScene`), bound to the store's simulator artifacts
 * and worker; null when the region has no model to simulate (D19).
 */
export type SimulateFlat = (
  segment: CpSegment,
  view: DiagramSimulatedView,
  style: PaperStyle
) => Promise<PaperScene | null>;

export interface CaptureStepRequest {
  /** The document snapshot the capture starts from, and is fingerprinted against. */
  document: OristudioCpDocumentSnapshot;
  /** Kernel-space segmentation, for a segment scope; null while it is not ready. */
  segmentation: FoldArtifacts | null;
  scope: DiagramCpScope;
  /**
   * What the step remembers of its creases, so its sheet is found after a
   * move; absent for a link made now, to a sheet in its place.
   */
  known?: KnownCreases | null;
  render: DiagramCpRender;
  style: DiagramStyle;
  /** The simulator, for a step shown as Simulated; absent, it cannot be captured. */
  simulateFlat?: SimulateFlat;
  /**
   * The spread a flat fold started here takes — one asked as 3D whose creases
   * now fold flat (13g: on by default, `spreadStartsFor`); absent, none.
   */
  spreadStart?: DiagramLayerSpread;
  env?: SanitizeEnv;
}

export type CaptureStepResult =
  | {
      status: 'captured';
      /** The step's new source: its fingerprint, thumbnail and render as captured. */
      source: DiagramCpSource;
      captured: CapturedPicture;
      /** The fold found no layer order, and the picture is its transparent development. */
      noLayerOrder: boolean;
    }
  | { status: 'missing' }
  | { status: 'unknown' }
  | { status: 'refused'; refusal: OristudioCpFold3dRefusal }
  /** Shown as Simulated above 0%: settled by the solver Pose holds, never headless. */
  | { status: 'needs-pose' }
  /** Shown as Simulated, and the region has no model the simulator can fold. */
  | { status: 'unavailable' };

/**
 * Capture a step's picture once, start to finish: choose its creases, fold
 * them if its render folds, read the picture, free the figure.
 *
 * The render follows the creases: a flat request whose creases now have a
 * partial fold is captured in 3D at the default camera, and a 3D one whose
 * creases are all full folds is captured flat — each folder refuses the
 * other's input. A flat request for a solution past the last one found keeps
 * the last.
 */
export async function captureStep(
  runtime: CpCaptureRuntime,
  request: CaptureStepRequest
): Promise<CaptureStepResult> {
  const { document, style, env, segmentation } = request;
  // A region cannot be looked for before the segmentation is ready.
  if (!segmentation) return { status: 'unknown' };
  const choice = chooseStepCreases(document, request.scope, segmentation, request.known ?? null);
  if (choice.status !== 'found') return choice;
  const { creases } = choice;
  const thumbnail = creasesThumbnail(creases, segmentation);
  // Found where it moved to, the link follows it.
  const scope = followedScope(request.scope, creases);
  const source = (render: DiagramCpRender): DiagramCpSource => {
    const stored = storedCpSource({
      kind: 'cp',
      scope,
      fingerprint: creasesFingerprint(creases, render),
      thumbnail,
      render,
    });
    if (!stored) throw new Error('The capture made a link the file cannot read');
    return stored;
  };

  if (request.render.mode === 'crease-pattern') {
    const captured = captureCreasePattern(document, creases, request.render.rotationDeg);
    return { status: 'captured', source: source(request.render), captured, noLayerOrder: false };
  }

  if (request.render.mode === 'simulated') {
    // A fold % above 0 is a solver's settling, which only a Pose holds (D19).
    if (request.render.foldPercent > 0) return { status: 'needs-pose' };
    const captured = await captureSimulated(flatStill(request.simulateFlat, creases), request.render.view, style);
    return captured
      ? { status: 'captured', source: source(request.render), captured, noLayerOrder: false }
      : { status: 'unavailable' };
  }

  const route = resolveFoldRoute(document, creases.foldLineIds);
  if (route.kind === 'none') return { status: 'missing' };
  const render = renderForRoute(request.render, route.kind, request.spreadStart);

  if (render.mode === 'folded-3d') {
    // Folded front up: a 3D figure's side is where the camera stands, and the
    // camera is the render's (`antipodalCamera`), as in Edit.
    const result = await runtime.fold3d(route.lineIds, captureModel(document, 'front'));
    if (result.status === 'refused') return { status: 'refused', refusal: result.refusal };
    try {
      const aux = await runtime.aux3d(result.handle);
      const captured = capture3dPicture(result, render.camera, style, aux);
      return { status: 'captured', source: source(render), captured, noLayerOrder: false };
    } finally {
      await runtime.free(result.handle);
    }
  }

  if (render.mode !== 'folded-flat') throw new Error('unreachable: the render was routed');
  const folded = await openFold(runtime, route.lineIds, captureModel(document, render.side));
  try {
    let state: Omit<FoldedFigureState, 'handle'> = folded;
    let foldCase = 1;
    if (render.foldCase > 1) {
      state = await runtime.foldToCase(folded.handle, render.foldCase);
      foldCase = Math.max(1, Math.min(render.foldCase, state.discoveredCases));
    }
    const captured = await readFlatPicture(runtime, folded.handle, state, render.rotationDeg, env, render.spread);
    const noLayerOrder = state.outcome === 'NoSolutions' || state.outcome === 'Contradiction';
    return { status: 'captured', source: source({ ...render, foldCase }), captured, noLayerOrder };
  } finally {
    await runtime.free(folded.handle);
  }
}
