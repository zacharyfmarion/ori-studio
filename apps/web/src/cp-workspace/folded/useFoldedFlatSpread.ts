import { useCallback, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { stackDepth, xrayFaceAlpha } from '../../layer-order/panes/layerPaneFigure';
import { hasConnectedDrawing, type PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import { spreadGeometry } from '../../layer-spread/spreadGeometry';
import type { PaperScene } from '../../lib/paper/paperScene';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  foldedFigurePivot,
  foldedFigureUserAabb,
  type FoldedFigureSpreadPicture,
} from '../adapters/cpFoldedToScene';
import { userBoundsVisibleShare, type UserCamera } from '../renderer/camera';
import type { SpreadGeometry } from '../renderer/programs/spreadProgram';
import { foldedFigureGesture } from './foldedFigureGesture';
import { foldedFigureSpreadOptions } from './foldedFigureSpread';
import {
  foldedFigureSpreadFrame,
  spreadReachFromPivot,
  type FoldedFigureSpreadFrame,
} from './foldedFigureSpreadFrame';
import { foldedFigureSpreadReachIds, setFoldedFigureSpreadReach } from './foldedFigureSpreadReach';
import { setFoldedFigureSpreadStatus, type FoldedFigureSpreadStatus } from './foldedFigureSpreadStatus';
import { FoldedSpreadPreparations, type SpreadFold, type SpreadPreparationRequest } from './foldedFlatSpreadLeases';
import { foldedFigureSpreadDrawable, foldedFigureSpreadScene, foldedPaperSceneKey } from './foldedFlatSpreadScene';
import { foldedFlatPaperScene } from './foldedFlatScene';
import { foldedFlatScenes, subscribeFoldedFlatScenes, type FoldedFlatSceneTable } from './foldedFlatScenes';
import type { LayerSpreadOptions } from './foldedLayerSpread';

/** What the canvas is looking at: the camera and the drawing buffer's size, device px. */
export interface FoldedSpreadCanvasView {
  camera: UserCamera;
  width: number;
  height: number;
}

/**
 * The flat figures' spread pictures, for the canvas to draw in place of their
 * render snapshots (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * decisions 6 and 7).
 *
 * A figure whose spread is on, and that can draw it (`foldedFlatSpreadScene.ts`),
 * is drawn from its kernel paper scene — fetched beside its aux lines
 * (`useFoldedFlatAux`), or carried by its file when it was reopened without a
 * fold — through Edit's own renderer's spread pass, so its pens stay screen
 * sized and its lines crisp at every zoom and turn of the canvas:
 *
 * - **Default** holds one `prepareConnected` lease per figure, generation
 *   checked (`foldedFlatSpreadLeases.ts`), and draws once its solve lands.
 * - **Affine** and **Depth** need no solve: the painter-ordered scene is
 *   built at once and drawn on the folded channel as a stored scene is.
 * - **X-ray** draws see-through: every fill at the Layer order dialog's
 *   X-ray alpha for the figure's deepest stack, lines on top.
 *
 * The picture is built in the figure's spread frame (`foldedFigureSpreadFrame.ts`):
 * a move or a resize redraws it as it is, a turn of the figure builds it again
 * from the solve it has, and nothing on the canvas solves it again.
 *
 * Until a figure's picture is ready — or when it cannot be — the reader
 * answers null and the figure draws its snapshot, as it does with its spread
 * off. Where each figure stands is written to `foldedFigureSpreadStatus.ts`
 * for the Properties sheet; how far its picture reaches, once no edit is mid
 * gesture, to `foldedFigureSpreadReach.ts` for its chrome.
 *
 * Returns the per-figure reader `cpFoldedToScene` takes. It is stable across
 * drags and changes when a scene or a solve lands, or the style moves.
 */
export function useFoldedFlatSpread(
  figures: readonly OristudioCpFoldedFigureEntry[],
  /** Each figure's effective paper style: the display style with its own pins on top. */
  paperStyleOf: (figure: OristudioCpFoldedFigureEntry) => PaperStyle,
  /** What the canvas shows, for which figures are in view; every figure is when absent. */
  view?: () => FoldedSpreadCanvasView | null
): (figure: OristudioCpFoldedFigureEntry) => FoldedFigureSpreadPicture | null {
  const table = useSyncExternalStore(subscribeFoldedFlatScenes, foldedFlatScenes, foldedFlatScenes);
  const activeId = useWorkspaceStore((state) => state.oristudioCpActiveFoldedFigureId);
  const gesture = useSyncExternalStore(
    foldedFigureGesture.subscribe,
    foldedFigureGesture.openOwner,
    foldedFigureGesture.openOwner
  );
  // Bumped when a solve lands or fails: what redraws the figures it was for.
  const [settled, settle] = useReducer((count: number) => count + 1, 0);
  const preparations = useRef<FoldedSpreadPreparations | null>(null);
  const pictures = useRef(new Map<string, CachedSpread>());

  // Made in an effect, so a remount (StrictMode's included) starts afresh.
  useEffect(() => {
    const held = new FoldedSpreadPreparations(settle);
    const built = pictures.current;
    preparations.current = held;
    return () => {
      held.dispose();
      if (preparations.current === held) preparations.current = null;
      built.clear();
    };
  }, []);

  const requests = useMemo(
    () => spreadRequests(figures, table, (figure) => figure.id === activeId || foldedFigureInView(figure, view?.() ?? null)),
    [figures, table, activeId, view]
  );
  useEffect(() => {
    preparations.current?.sync(requests);
  }, [requests]);

  const build = useCallback(
    (figure: OristudioCpFoldedFigureEntry): BuiltSpread | null =>
      buildSpread(figure, table, preparations.current, paperStyleOf, pictures.current),
    // `settled` is the solves landing, which `preparations` answers for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, paperStyleOf, settled]
  );

  // A figure that went — deleted, or its document closed — keeps no picture.
  useEffect(() => {
    const ids = new Set(figures.map((figure) => figure.id));
    for (const id of pictures.current.keys()) if (!ids.has(id)) pictures.current.delete(id);
  }, [figures]);

  // Where each figure's spread stands, for the Properties sheet.
  const reported = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set<string>();
    for (const figure of figures) {
      const status = spreadStatus(figure, table, preparations.current);
      if (status === null) continue;
      now.add(figure.id);
      setFoldedFigureSpreadStatus(figure.id, status);
    }
    for (const id of reported.current) if (!now.has(id)) setFoldedFigureSpreadStatus(id, null);
    reported.current = now;
  }, [figures, table, settled]);
  useEffect(
    () => () => {
      for (const id of reported.current) setFoldedFigureSpreadStatus(id, null);
      reported.current = new Set();
    },
    []
  );

  // How far each spread picture reaches, for the box, the toolbar, the hit
  // area and Fit — once no edit is mid gesture, so the chrome keeps still
  // while a slider or a drag is moving the picture.
  useEffect(() => {
    if (gesture !== null) return;
    const kept = new Set<string>();
    for (const figure of figures) {
      const built = build(figure);
      if (!built || !figure.snapshot) continue;
      kept.add(figure.id);
      setFoldedFigureSpreadReach(figure.id, { snapshot: figure.snapshot, handle: figure.handle, ...built.reach });
    }
    for (const id of foldedFigureSpreadReachIds()) if (!kept.has(id)) setFoldedFigureSpreadReach(id, null);
  }, [figures, build, gesture]);
  useEffect(
    () => () => {
      for (const id of foldedFigureSpreadReachIds()) setFoldedFigureSpreadReach(id, null);
    },
    []
  );

  return useCallback((figure: OristudioCpFoldedFigureEntry) => build(figure)?.picture ?? null, [build]);
}

/** A figure's spread picture, and how far it reaches from the pivot along the figure's own axes. */
interface BuiltSpread {
  picture: FoldedFigureSpreadPicture;
  reach: { halfWidth: number; halfHeight: number };
}

/**
 * What one figure's picture was built from, so a figure redrawn for anything
 * else — a move, a resize, another figure's drag — is handed the very
 * geometry it had, and the renderer uploads nothing.
 */
interface CachedSpread {
  kernel: OristudioCpFoldedPaperScene;
  prepared: PreparedConnectedSpread | null;
  key: string;
  geometry: SpreadGeometry | null;
  scene: PaperScene | null;
  reach: { halfWidth: number; halfHeight: number };
}

/** A Default-spread lease per figure that can draw one now: its scene, at its priority. */
export function spreadRequests(
  figures: readonly OristudioCpFoldedFigureEntry[],
  table: FoldedFlatSceneTable,
  urgent: (figure: OristudioCpFoldedFigureEntry) => boolean
): SpreadPreparationRequest[] {
  const requests: SpreadPreparationRequest[] = [];
  for (const figure of figures) {
    if (foldedFigureSpreadOptions(figure)?.kind !== 'connected' || !foldedFigureSpreadDrawable(figure)) continue;
    const scene = foldedFigureSpreadScene(figure, table);
    if (!scene) continue;
    requests.push({ id: figure.id, fold: spreadFold(figure, scene), scene, priority: urgent(figure) ? 1 : 0 });
  }
  return requests;
}

/**
 * The fold a figure's scene is of, which its lease is held for: a live
 * figure's handle and the paper scene its snapshot shows
 * (`foldedPaperSceneKey`), which a refold, another solution or a side flip
 * changes and a write of its colours or an aux-line refetch keeps; the
 * snapshot, or the scene itself, for a reopened figure.
 */
function spreadFold(figure: OristudioCpFoldedFigureEntry, scene: OristudioCpFoldedPaperScene): SpreadFold {
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  if (figure.handle != null && figure.snapshot) return `${figure.handle} ${foldedPaperSceneKey(figure.snapshot)}`;
  return figure.snapshot ?? scene;
}

/**
 * Where a figure's spread stands: null with nothing to report — its spread is
 * off, it cannot draw one (the Properties sheet says why from the figure), or
 * it was reopened with no scene to draw one from.
 */
export function spreadStatus(
  figure: OristudioCpFoldedFigureEntry,
  table: FoldedFlatSceneTable,
  preparations: Pick<FoldedSpreadPreparations, 'state'> | null
): FoldedFigureSpreadStatus | null {
  const spread = foldedFigureSpreadOptions(figure);
  if (!spread || !foldedFigureSpreadDrawable(figure)) return null;
  const kernel = foldedFigureSpreadScene(figure, table);
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  if (!kernel) return figure.handle != null ? 'preparing' : null;
  if (spread.kind !== 'connected') return 'ready';
  return preparations?.state(figure.id, spreadFold(figure, kernel)).status ?? 'preparing';
}

/**
 * Whether a figure shows on the canvas, for its solve's priority. Every
 * figure does while there is no view to ask.
 */
export function foldedFigureInView(
  figure: OristudioCpFoldedFigureEntry,
  view: FoldedSpreadCanvasView | null
): boolean {
  if (!view || view.width <= 0 || view.height <= 0) return true;
  const bounds = foldedFigureUserAabb(figure);
  if (!bounds) return false;
  return userBoundsVisibleShare(bounds, view.camera, { width: view.width, height: view.height, dpr: 1 }) > 0;
}

const depths = new WeakMap<OristudioCpFoldedPaperScene, number>();

/** X-ray's alpha for the scene's deepest stack, as the Layer order dialog's X-ray draws it. */
function xrayAlphaOf(kernel: OristudioCpFoldedPaperScene): number {
  let depth = depths.get(kernel);
  if (depth === undefined) {
    depth = stackDepth(kernel);
    depths.set(kernel, depth);
  }
  return xrayFaceAlpha(depth);
}

function buildSpread(
  figure: OristudioCpFoldedFigureEntry,
  table: FoldedFlatSceneTable,
  preparations: Pick<FoldedSpreadPreparations, 'state'> | null,
  paperStyleOf: (figure: OristudioCpFoldedFigureEntry) => PaperStyle,
  cache: Map<string, CachedSpread>
): BuiltSpread | null {
  const spread = foldedFigureSpreadOptions(figure);
  const kernel = spread && foldedFigureSpreadDrawable(figure) ? foldedFigureSpreadScene(figure, table) : null;
  let prepared: PreparedConnectedSpread | null = null;
  if (spread?.kind === 'connected' && kernel) {
    // By its fold: the canvas reads this in the render a refetched scene
    // lands in, before the lease is told of the scene.
    const state = preparations?.state(figure.id, spreadFold(figure, kernel));
    if (state?.status === 'ready') prepared = state.prepared;
  }
  // A figure that draws no spread now keeps no picture: its spread is off or
  // cannot draw, its scene is not here, or its solve has not landed.
  if (!spread || !kernel || (spread.kind === 'connected' && !prepared)) {
    cache.delete(figure.id);
    return null;
  }
  const frame = foldedFigureSpreadFrame(foldedFigurePivot(figure), figure.placement.rotation);
  // The style inks a Default picture's geometry; the folded channel inks a scene.
  const style = spread.kind === 'connected' ? paperStyleOf(figure) : null;
  const key = JSON.stringify([spread, frame.pivot.x, frame.pivot.y, frame.rotation, style]);
  let cached = cache.get(figure.id);
  if (!cached || cached.kernel !== kernel || cached.prepared !== prepared || cached.key !== key) {
    const built = prepared ? connectedSpread(kernel, prepared, spread, frame, style!) : paintedSpread(kernel, spread, frame);
    if (!built) {
      cache.delete(figure.id);
      return null;
    }
    cached = { kernel, prepared, key, ...built };
    cache.set(figure.id, cached);
  }
  const xray = figure.displayStyle === 'Transparent3' ? xrayAlphaOf(kernel) : null;
  const picture: FoldedFigureSpreadPicture = cached.geometry
    ? { kind: 'connected', geometry: cached.geometry, xray: xray === null ? null : { faceAlpha: xray }, pivot: frame.pivot }
    : { kind: 'scene', scene: cached.scene!, faceAlpha: xray ?? 1, pivot: frame.pivot };
  return { picture, reach: cached.reach };
}

/** A Default spread's geometry for the spread pass, in the figure's spread frame. */
function connectedSpread(
  kernel: OristudioCpFoldedPaperScene,
  prepared: PreparedConnectedSpread,
  spread: LayerSpreadOptions,
  frame: FoldedFigureSpreadFrame,
  style: PaperStyle
): Pick<CachedSpread, 'geometry' | 'scene' | 'reach'> | null {
  const scene = foldedFlatPaperScene(kernel, {
    markHidden: false,
    live: true,
    connected: prepared,
    spread,
    toScenePx: frame.toScenePx,
    scale: frame.scale,
  });
  if (!hasConnectedDrawing(scene)) return null;
  const geometry = spreadGeometry(scene, style, { policy: PAPER_STYLE_POLICIES['folded-flat'] });
  const reach = spreadReachFromPivot(frame, (visit) => {
    for (const [x, y] of scene.connected.mesh.positions) visit(x, y);
  });
  return { geometry, scene: null, reach };
}

/** An Affine or Depth spread: the painter-ordered scene, every layer kept, in the figure's spread frame. */
function paintedSpread(
  kernel: OristudioCpFoldedPaperScene,
  spread: LayerSpreadOptions,
  frame: FoldedFigureSpreadFrame
): Pick<CachedSpread, 'geometry' | 'scene' | 'reach'> {
  const scene = foldedFlatPaperScene(kernel, {
    markHidden: false,
    spread,
    toScenePx: frame.toScenePx,
    scale: frame.scale,
  });
  const reach = spreadReachFromPivot(frame, (visit) => {
    for (const item of scene.items) {
      if (item.kind === 'face') for (const ring of item.rings) for (const [x, y] of ring) visit(x, y);
      else if (item.kind === 'line') {
        visit(item.a[0], item.a[1]);
        visit(item.b[0], item.b[1]);
      }
    }
  });
  return { geometry: null, scene, reach };
}
