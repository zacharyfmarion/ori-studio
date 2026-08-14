import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  IDENTITY_FOLDED_PLACEMENT,
  isFoldedFromCurrentCpSourceKind,
} from '../../engine/oristudioCpTypes';
import type {
  OristudioCpDocumentState,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  FoldedFigurePlacement,
} from '../../engine/oristudioCpTypes';
import type { CanvasObjectBoxUpdate } from '../CanvasObjectOverlay';
import { foldedFigureAsTransformable } from '../canvasObjects/transformableObject';
import type { TransformableCanvasObject } from '../canvasObjects/transformableObject';
import { foldedFigureBox } from '../adapters/cpFoldedToScene';
import { isFoldedFigureStale } from './foldedFigureStaleness';
import {
  foldedFigureFlipState,
  isFoldedFigureReady,
  type FoldedFigureActionDeps,
} from './foldedFigureActions';
import { foldedFigureListsEqual } from './foldedFigureState';
import { isFolded3dFigure } from './foldedFigureCapabilities';
import { canWindowFolded3dFigure, folded3dWindowIds } from './folded3dWindow';
import { webglRenderSupported } from '../../simulator/useSimulatorRuntime';
import {
  DEFAULT_FOLDED_3D_CAMERA,
  foldedFigureOtherSideCamera,
  type FoldedFigureCamera,
} from './foldedFigure3dProjection';
import {
  advanceFoldedFigureOrbit,
  beginFoldedFigureOrbit,
  foldedFigureOrbitChanged,
  foldedFigureOrbitClaimsPress,
} from './foldedFigureOrbitGesture';
import {
  clearFolded3dOrbit,
  getFolded3dOrbit,
  publishFolded3dOrbit,
} from './folded3dRuntime';
import { reproject3dFigureAt } from './folded3dReproject';
import { useFolded3dRehydration } from './useFolded3dRehydration';
import type { Vec2 } from '../annotations/annotationTransform';
import {
  clampSimulatorZoom,
  simulatorWheelZoomFactor,
  type SimulatorOrbitDrag,
} from '../../lib/simulatorOrbit';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { ANALYTICS_EVENTS, COUNT_BUCKETS, bucketCount } from '../../analytics/events';
import { track } from '../../analytics';

/**
 * The face folding holds fixed. Oriedita lets this be chosen and the kernel still
 * takes it per fold, but the product does not offer the choice: the picker was the
 * only thing that ever set it, so every fold was already from face 1.
 */
const FOLD_STARTING_FACE_ID = 1;

/**
 * How long a wheel must go quiet before a figure's zoom is written to the
 * document.
 *
 * A wheel gesture has no release, so this is what ends it. Long enough that a
 * trackpad's coast does not split into several undo entries, short enough that
 * letting go and pressing undo does what you expect.
 */
const FOLDED_3D_ZOOM_SETTLE_MS = 220;

/**
 * The camera a figure is currently drawn at.
 *
 * `camera` is absent on a figure folded before orbit existed and on one restored
 * from a file that never stored one, and the fold camera is the same default in
 * both cases — so this is the accessor rather than a `??` at each call site.
 */
function figureCamera(figure: OristudioCpFoldedFigureEntry): FoldedFigureCamera {
  return figure.camera ?? DEFAULT_FOLDED_3D_CAMERA;
}

/**
 * Where the figure is being drawn *right now*: the live orbit frame while a drag
 * is in flight, and the stored camera otherwise.
 *
 * The distinction is the whole of Phase 1. The store is written once per drag,
 * on release, so during a drag `figure.camera` is still the camera the press
 * started from — reading it as "the current camera" would make every move after
 * the first measure its change against the anchor rather than against the last
 * frame, and `foldedFigureOrbitChanged` would stop meaning "this move turned
 * something".
 */
function liveFigureCamera(figure: OristudioCpFoldedFigureEntry): FoldedFigureCamera {
  return getFolded3dOrbit(figure.id)?.camera ?? figureCamera(figure);
}

export interface UseFoldedFiguresOptions {
  /** The live CP document, for the staleness check. */
  cpDocument: OristudioCpDocumentState | null | undefined;
  /** Crease ids the Fold command should fold, from the CP selection. */
  selectedFoldLineIds: number[];
}

/**
 * The folded-figure binding layer: derived state, the undo-gesture protocol, and
 * the store-bound verbs that `foldedFigureActions` turns into a toolbar and a
 * context menu.
 *
 * The catalog itself is deliberately React-free and store-free; this is the
 * other half — the part that knows which store action each verb calls and that
 * every one of them must be bracketed by `runFoldedFigureAction` so it lands as
 * exactly one undo entry. Keeping it beside the catalog rather than in the panel
 * is what stops the panel accumulating a deps-memo per concern.
 */
export function useFoldedFigures({ cpDocument, selectedFoldLineIds }: UseFoldedFiguresOptions) {
  const { t } = useTranslation();
  const oristudioCpFoldedFigures = useWorkspaceStore((state) => state.oristudioCpFoldedFigures);
  const oristudioCpActiveFoldedFigureId = useWorkspaceStore(
    (state) => state.oristudioCpActiveFoldedFigureId
  );
  const oristudioCpFocusedFoldedFigureId = useWorkspaceStore(
    (state) => state.oristudioCpFocusedFoldedFigureId
  );
  const focusOristudioCpFoldedFigure = useWorkspaceStore(
    (state) => state.focusOristudioCpFoldedFigure
  );
  const recordFoldedFigureHistory = useWorkspaceStore((state) => state.recordFoldedFigureHistory);
  const foldOristudioCpDocument = useWorkspaceStore((state) => state.foldOristudioCpDocument);
  const foldAnotherOristudioCpFigure = useWorkspaceStore(
    (state) => state.foldAnotherOristudioCpFigure
  );
  const setOristudioCpFoldedFigurePlacement = useWorkspaceStore(
    (state) => state.setOristudioCpFoldedFigurePlacement
  );
  const setOristudioCpFoldedFigureDisplayStyle = useWorkspaceStore(
    (state) => state.setOristudioCpFoldedFigureDisplayStyle
  );
  const setOristudioCpFolded3dCamera = useWorkspaceStore(
    (state) => state.setOristudioCpFolded3dCamera
  );
  const updateOristudioCpFoldedFigureModel = useWorkspaceStore(
    (state) => state.updateOristudioCpFoldedFigureModel
  );
  const duplicateOristudioCpFoldedFigure = useWorkspaceStore(
    (state) => state.duplicateOristudioCpFoldedFigure
  );
  const refoldOristudioCpFoldedFigure = useWorkspaceStore(
    (state) => state.refoldOristudioCpFoldedFigure
  );
  const exportOristudioCpFoldedFigure = useWorkspaceStore(
    (state) => state.exportOristudioCpFoldedFigure
  );
  const deleteOristudioCpFoldedFigure = useWorkspaceStore(
    (state) => state.deleteOristudioCpFoldedFigure
  );
  const setOristudioCpViewportOption = useWorkspaceStore(
    (state) => state.setOristudioCpViewportOption
  );
  const requestOristudioCpAction = useWorkspaceStore((state) => state.requestOristudioCpAction);
  const setOristudioCpSelection = useWorkspaceStore((state) => state.setOristudioCpSelection);
  const simulateOristudioCpCreaseRegion = useWorkspaceStore(
    (state) => state.simulateOristudioCpCreaseRegion
  );
  const canFoldSelectedModel = selectedFoldLineIds.length > 0;

  const activeFoldedFigure = useMemo(
    () =>
      oristudioCpFoldedFigures.find((figure) => figure.id === oristudioCpActiveFoldedFigureId) ??
      // Nothing selected: the toolbar acts on the most recent generated figure,
      // which is the one a just-completed fold produced. Tested through
      // `isFoldedFigureReady` rather than `snapshot?.wireframe`, which is the
      // flat witness and would skip every 3D figure — leaving the toolbar and
      // the menu acting on some older flat one.
      [...oristudioCpFoldedFigures]
        .reverse()
        .find(
          (figure) =>
            isFoldedFromCurrentCpSourceKind(figure.sourceKind) && isFoldedFigureReady(figure)
        ) ??
      null,
    [oristudioCpActiveFoldedFigureId, oristudioCpFoldedFigures]
  );

  const generatedFoldedFigures = useMemo(
    () =>
      oristudioCpFoldedFigures.filter((figure) =>
        isFoldedFromCurrentCpSourceKind(figure.sourceKind)
      ),
    [oristudioCpFoldedFigures]
  );

  /**
   * The figure the canvas has *selected*, for the floating toolbar.
   *
   * Deliberately not `activeFoldedFigure`: that memo falls back to the most
   * recent generated figure when nothing is selected, which is right for the
   * viewport toolbar (it acts on "the fold you just made") but would leave the
   * floating bar parked over that figure forever.
   */
  const selectedFoldedFigure = useMemo(
    () =>
      generatedFoldedFigures.find((figure) => figure.id === oristudioCpActiveFoldedFigureId) ??
      null,
    [generatedFoldedFigures, oristudioCpActiveFoldedFigureId]
  );

  /**
   * Which figures no longer match the creases they were folded from. Computed
   * here, once per document revision, rather than stamped onto every figure
   * during the edit — see `lib/foldedFigureStaleness.ts` for the ported test and
   * why the old always-stale flag was both wrong and unusable for refolding.
   */
  const staleFoldedFigureIds = useMemo(() => {
    const stale = new Set<string>();
    for (const figure of generatedFoldedFigures) {
      if (isFoldedFigureStale(cpDocument?.document, figure)) stale.add(figure.id);
    }
    return stale;
  }, [generatedFoldedFigures, cpDocument?.document]);

  /**
   * Give reopened 3D figures their geometry back, in the background.
   *
   * Here rather than in the panel because it is the same two derived values the
   * rest of this hook already owns — which figures came from these creases, and
   * which of them have drifted — and because a panel that mounted it would be
   * accumulating behaviour rather than composing it.
   *
   * The figure the user is working with goes first: focused if anything is,
   * otherwise selected.
   */
  useFolded3dRehydration({
    figures: generatedFoldedFigures,
    staleIds: staleFoldedFigureIds,
    priorityId: oristudioCpFocusedFoldedFigureId ?? oristudioCpActiveFoldedFigureId,
  });

  // Folded-figure state captured at the start of a gesture, so a whole drag
  // records one undo entry — the same shape the annotation layer uses.
  const preGestureFoldedFiguresRef = useRef<readonly OristudioCpFoldedFigureEntry[] | null>(null);

  const preGestureActiveFoldedIdRef = useRef<string | null>(null);

  const beginFoldedFigureGesture = useCallback(() => {
    preGestureFoldedFiguresRef.current = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    preGestureActiveFoldedIdRef.current =
      useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId;
  }, []);

  const commitFoldedFigureGesture = useCallback(
    (label: string) => {
      const previous = preGestureFoldedFiguresRef.current;
      const previousActiveId = preGestureActiveFoldedIdRef.current;
      preGestureFoldedFiguresRef.current = null;
      if (!previous) return;
      const state = useWorkspaceStore.getState();
      // A verb that changed nothing earns no undo entry. This bracket owns both
      // ends of the gesture, so it is the one place that can tell — and the case
      // is not rare: a fold that is refused, fails, or is *stopped* runs this
      // `finally` having put the list back exactly as it found it, and would
      // otherwise leave a step that undoes nothing on a project it just marked
      // dirty.
      if (
        foldedFigureListsEqual(previous, state.oristudioCpFoldedFigures) &&
        previousActiveId === state.oristudioCpActiveFoldedFigureId
      ) {
        return;
      }
      recordFoldedFigureHistory([...previous], label, previousActiveId);
    },
    [recordFoldedFigureHistory]
  );

  /**
   * Run a discrete folded-figure action as one undo step: snapshot, act, record.
   * Every entry point that mutates a folded figure goes through this, so none of
   * them can quietly skip the undo stack the way they all used to.
   */
  const runFoldedFigureAction = useCallback(
    (label: string, action: () => void | Promise<unknown>) => {
      beginFoldedFigureGesture();
      void Promise.resolve(action()).finally(() => commitFoldedFigureGesture(label));
    },
    [beginFoldedFigureGesture, commitFoldedFigureGesture]
  );

  const foldedGestureLabel = useCallback(
    (kind: 'move' | 'resize' | 'rotate' | 'crop') => {
      switch (kind) {
        case 'move':
          return t('panels:creasePattern.moveFoldedForm', 'Move folded form');
        case 'rotate':
          return t('panels:creasePattern.rotateFoldedForm', 'Rotate folded form');
        default:
          // A folded figure has no crop affordance, so any handle drag resizes.
          return t('panels:creasePattern.resizeFoldedForm', 'Resize folded form');
      }
    },
    [t]
  );

  // Folded figures are the third canvas-object kind. They keep their own
  // kernel-backed state, so only the box is shared with annotations; gestures
  // write back through the figure's web-side placement.
  const foldedFigureObjects = useMemo(
    () =>
      generatedFoldedFigures
        .map(foldedFigureAsTransformable)
        .filter((object): object is TransformableCanvasObject => object !== null),
    [generatedFoldedFigures]
  );

  /**
   * Which 3D figures are drawn as live GPU windows rather than as primitives in
   * the crease-pattern scene.
   *
   * One set, three consumers, and they must agree exactly: the window layer
   * mounts these, the canvas stops drawing these, and the orbit gesture stops
   * re-projecting these. A figure in two of the three is drawn twice or not at
   * all.
   *
   * Memoized on the figure list, which is also when a render model can first
   * appear — a fold adds the entry and the geometry together.
   */
  const folded3dWindowFigureIds = useMemo(
    () => folded3dWindowIds(generatedFoldedFigures, { gpuAvailable: webglRenderSupported() }),
    [generatedFoldedFigures]
  );

  const folded3dWindowFigures = useMemo(
    () => generatedFoldedFigures.filter((figure) => folded3dWindowFigureIds.has(figure.id)),
    [generatedFoldedFigures, folded3dWindowFigureIds]
  );

  /**
   * The focused figure's body takes no overlay gestures: its interior orbits the
   * camera, and the overlay polygon sits above it, so leaving it live means every
   * drag aimed at turning the model moves it instead. Handles are untouched, so a
   * focused figure can still be resized and rotated.
   *
   * The same shape inline simulations use, for the same reason — see
   * `useInlineSimulations`.
   */
  const foldedInertBodyIds = useMemo(
    () => new Set(oristudioCpFocusedFoldedFigureId ? [oristudioCpFocusedFoldedFigureId] : []),
    [oristudioCpFocusedFoldedFigureId]
  );

  /** The focused figure's transformable box, for the canvas' hit test. */
  const focusedFoldedBox = useMemo(() => {
    if (!oristudioCpFocusedFoldedFigureId) return null;
    return (
      foldedFigureObjects.find((object) => object.id === oristudioCpFocusedFoldedFigureId)?.box ??
      null
    );
  }, [foldedFigureObjects, oristudioCpFocusedFoldedFigureId]);

  const orbitDragRef = useRef<{
    id: string;
    drag: SimulatorOrbitDrag;
    /**
     * Whether this figure is drawn by the window layer, decided once at the
     * press. A windowed figure needs no re-projection, and asking again on every
     * move would walk the render model's cell table sixty times a second to
     * arrive at the same answer — the press is what fixes it, since a figure
     * cannot gain or lose its render model mid-drag.
     */
    windowed: boolean;
    /** Whether an undo snapshot has been taken for this drag yet. */
    recording: boolean;
  } | null>(null);

  /** The live figure, read from the store rather than from a render-time list. */
  const figureById = useCallback(
    (id: string) =>
      useWorkspaceStore
        .getState()
        .oristudioCpFoldedFigures.find((candidate) => candidate.id === id),
    []
  );

  /**
   * Whether a canvas press at `point` (SVG user space, the space a folded
   * figure's box lives in) should turn the focused figure rather than reach the
   * tool under it.
   */
  const orbitClaimsPress = useCallback(
    (point: Vec2) =>
      oristudioCpFocusedFoldedFigureId !== null &&
      foldedFigureOrbitClaimsPress(
        oristudioCpFocusedFoldedFigureId,
        oristudioCpFocusedFoldedFigureId,
        focusedFoldedBox,
        point
      ),
    [focusedFoldedBox, oristudioCpFocusedFoldedFigureId]
  );

  const beginOrbit = useCallback(
    (point: Vec2) => {
      const id = oristudioCpFocusedFoldedFigureId;
      if (!id) return false;
      const figure = figureById(id);
      if (!figure) return false;
      orbitDragRef.current = {
        id,
        drag: beginFoldedFigureOrbit(liveFigureCamera(figure), point),
        windowed: canWindowFolded3dFigure(figure, { gpuAvailable: webglRenderSupported() }),
        // The undo snapshot is deliberately NOT taken here. A press and release
        // that never moves is a click, and snapshotting on press would put a
        // no-op entry on the stack that the user has to undo past. Taken on the
        // first move that actually turns the figure instead.
        recording: false,
      };
      return true;
    },
    [figureById, oristudioCpFocusedFoldedFigureId]
  );

  /**
   * A move of the drag. Publishes to the side table, and deliberately **not** to
   * the store: a store write here produces a new `oristudioCpFoldedFigures`
   * array on every pointermove, which invalidates `staleFoldedFigureIds` (a walk
   * over every crease in the document), `foldedFigureObjects` and
   * `canvasObjects`, and re-renders the crease-pattern panel. See
   * `folded3dRuntime.ts`.
   */
  const advanceOrbit = useCallback(
    (point: Vec2) => {
      const session = orbitDragRef.current;
      if (!session) return;
      const figure = figureById(session.id);
      if (!figure) return;
      const before = liveFigureCamera(figure);
      const next = advanceFoldedFigureOrbit(before, session.drag, point);
      if (!foldedFigureOrbitChanged(before, next)) return;
      if (!session.recording) {
        session.recording = true;
        beginFoldedFigureGesture();
      }
      // A windowed figure is drawn by its mesh at the camera alone, so the CPU
      // projection would be built and then thrown away — `earcut` over every cell
      // ring plus a BSP build, per pointer move, for a picture nobody draws.
      //
      // Otherwise projected here rather than in a render pass, because React's
      // commit is the wrong place for that work. Null when the figure has no
      // render model (reopened from a file), which the side table carries through
      // as "keep the picture you have".
      publishFolded3dOrbit(session.id, {
        camera: next,
        snapshot: session.windowed
          ? null
          : reproject3dFigureAt(figure, figure.displayStyle, next),
      });
    },
    [beginFoldedFigureGesture, figureById]
  );

  /**
   * The release. One store write, one undo entry, one analytics event — and the
   * live frame goes, so the store is the only camera again.
   */
  const commitOrbit = useCallback(() => {
    const session = orbitDragRef.current;
    orbitDragRef.current = null;
    if (!session) return;
    const live = getFolded3dOrbit(session.id);
    // `recording` is set by the first move that changed the camera, and that
    // same move publishes the frame — so neither is ever set without the other,
    // and a press and release that never turned anything writes nothing at all.
    if (session.recording && live) {
      // Synchronous up to its `set`, so the store carries the drag's final
      // camera before the history entry is recorded against the pre-drag one.
      void setOristudioCpFolded3dCamera(session.id, live.camera);
      commitFoldedFigureGesture(t('panels:creasePattern.orbitFoldedForm', 'Turn folded form'));
      // Once per drag, and only for a drag that turned something. No properties:
      // the only numbers here are yaw and pitch, and an angle is a measured
      // value about someone's design, which the privacy contract keeps out of
      // analytics.
      track(ANALYTICS_EVENTS.foldedFigureOrbited);
    }
    // Dropped last, so the store already holds the camera the live frame was
    // drawing at: the canvas sees one change rather than a frame at the pre-drag
    // camera followed by a frame at the new one.
    clearFolded3dOrbit(session.id);
  }, [commitFoldedFigureGesture, setOristudioCpFolded3dCamera, t]);

  /**
   * A drag that never got its release — the surface unmounted mid-gesture. The
   * live frame would otherwise outlive the pointer that owns it and keep
   * shadowing the stored camera.
   */
  useEffect(
    () => () => {
      const session = orbitDragRef.current;
      orbitDragRef.current = null;
      if (session) clearFolded3dOrbit(session.id);
    },
    []
  );

  /**
   * A wheel burst over a focused window, in flight.
   *
   * A wheel has no release, so the burst is bounded by an idle timer instead —
   * the same shape as the drag, for the same two reasons: writing the store per
   * event would produce a new figures array sixty times a second, and it would
   * leave the user an undo entry per notch to press back through.
   */
  const zoomBurstRef = useRef<{ id: string; timer: number } | null>(null);

  /**
   * The store write that ends a zoom burst: one entry, one event, live frame
   * dropped. Mirrors {@link commitOrbit}, and deliberately not merged with it —
   * a drag ends when the pointer says so and a burst ends when it goes quiet.
   */
  const commitZoomRef = useRef(() => {});
  useEffect(() => {
    commitZoomRef.current = () => {
      const burst = zoomBurstRef.current;
      zoomBurstRef.current = null;
      if (!burst) return;
      window.clearTimeout(burst.timer);
      const live = getFolded3dOrbit(burst.id);
      if (live) {
        void setOristudioCpFolded3dCamera(burst.id, live.camera);
        commitFoldedFigureGesture(t('panels:creasePattern.zoomFoldedForm', 'Zoom folded form'));
        // Once per burst. No properties: a zoom factor is a measured value about
        // someone's design, which the privacy contract keeps out of analytics.
        track(ANALYTICS_EVENTS.foldedFigureZoomed);
      }
      clearFolded3dOrbit(burst.id);
    };
  });

  /**
   * Whether a wheel at `point` should zoom the focused figure rather than the
   * crease pattern.
   *
   * The same hit test the orbit uses, and additionally only for a figure drawn
   * as a **window**: zoom is honoured by the mesh and by nothing else, so on a
   * figure still drawn from its stored picture the wheel would appear to do
   * nothing at all while also not panning the canvas.
   */
  const zoomClaimsWheel = useCallback(
    (point: Vec2) =>
      oristudioCpFocusedFoldedFigureId !== null &&
      folded3dWindowFigureIds.has(oristudioCpFocusedFoldedFigureId) &&
      foldedFigureOrbitClaimsPress(
        oristudioCpFocusedFoldedFigureId,
        oristudioCpFocusedFoldedFigureId,
        focusedFoldedBox,
        point
      ),
    [focusedFoldedBox, folded3dWindowFigureIds, oristudioCpFocusedFoldedFigureId]
  );

  /**
   * One wheel event, as the simulator's own zoom: same curve, same clamps, from
   * the module both surfaces read them from.
   *
   * Publishes to the side table, never to the store — this is transport, and it
   * is the identical argument the orbit records at length.
   */
  const zoomFocusedFigure = useCallback(
    (deltaY: number) => {
      const id = oristudioCpFocusedFoldedFigureId;
      if (!id) return;
      const figure = figureById(id);
      if (!figure) return;
      const before = liveFigureCamera(figure);
      const zoom = clampSimulatorZoom(before.zoom * simulatorWheelZoomFactor(deltaY));
      if (zoom === before.zoom) return;
      const burst = zoomBurstRef.current;
      if (burst?.id !== id) {
        // A wheel that lands on a different figure ends the previous burst
        // properly rather than abandoning its live frame.
        if (burst) commitZoomRef.current();
        beginFoldedFigureGesture();
      } else {
        window.clearTimeout(burst.timer);
      }
      zoomBurstRef.current = {
        id,
        timer: window.setTimeout(() => commitZoomRef.current(), FOLDED_3D_ZOOM_SETTLE_MS),
      };
      // No snapshot: only a windowed figure can be zoomed, and a window draws
      // from the camera alone.
      publishFolded3dOrbit(id, { camera: { ...before, zoom }, snapshot: null });
    },
    [beginFoldedFigureGesture, figureById, oristudioCpFocusedFoldedFigureId]
  );

  /** A burst that never went quiet, because the surface went away. */
  useEffect(() => () => commitZoomRef.current(), []);

  const foldedOrbit = useMemo(
    () => ({
      focusedId: oristudioCpFocusedFoldedFigureId,
      focus: focusOristudioCpFoldedFigure,
      claimsPress: orbitClaimsPress,
      begin: beginOrbit,
      advance: advanceOrbit,
      commit: commitOrbit,
      claimsWheel: zoomClaimsWheel,
      zoom: zoomFocusedFigure,
    }),
    [
      advanceOrbit,
      beginOrbit,
      commitOrbit,
      focusOristudioCpFoldedFigure,
      orbitClaimsPress,
      oristudioCpFocusedFoldedFigureId,
      zoomClaimsWheel,
      zoomFocusedFigure,
    ]
  );

  const handleFoldedFigureBoxUpdate = useCallback(
    (id: string, patch: CanvasObjectBoxUpdate) => {
      const figure = useWorkspaceStore
        .getState()
        .oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      if (!figure) return;
      const base = foldedFigureBox({ ...figure, placement: IDENTITY_FOLDED_PLACEMENT });
      if (!base) return;
      const next: Partial<FoldedFigurePlacement> = {};
      if (patch.center) {
        // The overlay reports an absolute centre; placement stores the offset
        // from where the fold put the figure.
        next.offset = {
          x: patch.center.x - base.center.x,
          y: patch.center.y - base.center.y,
        };
      }
      if (patch.width !== undefined && base.width > 0) {
        // Resize is always proportional for a folded figure, so either extent
        // recovers the same scalar.
        next.scale = patch.width / base.width;
      }
      if (patch.rotation !== undefined) next.rotation = patch.rotation;
      setOristudioCpFoldedFigurePlacement(id, next);
    },
    [setOristudioCpFoldedFigurePlacement]
  );

  const handleFoldModel = useCallback(() => {
    if (!canFoldSelectedModel) return;
    runFoldedFigureAction(t('panels:creasePattern.foldModelAction', 'Fold model'), () =>
      foldOristudioCpDocument({
        startingFaceId: FOLD_STARTING_FACE_ID,
        lineIds: selectedFoldLineIds,
      })
    );
  }, [
    canFoldSelectedModel,
    foldOristudioCpDocument,
    selectedFoldLineIds,
    runFoldedFigureAction,
    t,
  ]);

  const handleFoldedDisplayStyle = useCallback(
    (displayStyle: OristudioCpFoldedFigureDisplayStyle) => {
      if (!activeFoldedFigure) return;
      const id = activeFoldedFigure.id;
      runFoldedFigureAction(
        t('panels:creasePattern.changeFoldedDisplayStyle', 'Change folded display style'),
        () => setOristudioCpFoldedFigureDisplayStyle(id, displayStyle)
      );
    },
    [activeFoldedFigure, setOristudioCpFoldedFigureDisplayStyle, runFoldedFigureAction, t]
  );

  /**
   * Model changes from the folded-figure menu. The colour pickers and the alpha
   * slider fire a change per pointer move, so a single drag would otherwise push
   * dozens of undo entries. `scope` marks the run of changes belonging to one
   * gesture: the first change snapshots, and the matching
   * {@link endFoldedModelGesture} (pointer-up / blur) records exactly one entry.
   * Discrete controls pass no scope and record immediately.
   */
  const foldedModelGestureScopeRef = useRef<string | null>(null);

  const handleFoldedModelUpdate = useCallback(
    (update: Partial<OristudioCpFoldedFigureModel>, scope?: string) => {
      if (!activeFoldedFigure) return;
      const id = activeFoldedFigure.id;
      if (!scope) {
        runFoldedFigureAction(
          t('panels:creasePattern.changeFoldedModel', 'Change folded model'),
          () => updateOristudioCpFoldedFigureModel(id, update)
        );
        return;
      }
      if (foldedModelGestureScopeRef.current !== scope) {
        foldedModelGestureScopeRef.current = scope;
        beginFoldedFigureGesture();
      }
      void updateOristudioCpFoldedFigureModel(id, update);
    },
    [
      activeFoldedFigure,
      updateOristudioCpFoldedFigureModel,
      runFoldedFigureAction,
      beginFoldedFigureGesture,
      t,
    ]
  );

  const endFoldedModelGesture = useCallback(
    (scope: string, label: string) => {
      if (foldedModelGestureScopeRef.current !== scope) return;
      foldedModelGestureScopeRef.current = null;
      commitFoldedFigureGesture(label);
    },
    [commitFoldedFigureGesture]
  );

  const handleDuplicateFoldedFigure = useCallback(() => {
    if (!activeFoldedFigure) return;
    const id = activeFoldedFigure.id;
    runFoldedFigureAction(
      t('panels:creasePattern.duplicateFoldedModelAction', 'Duplicate folded model'),
      () => duplicateOristudioCpFoldedFigure(id)
    );
  }, [activeFoldedFigure, duplicateOristudioCpFoldedFigure, runFoldedFigureAction, t]);

  /** Delete a folded figure by id, defaulting to the one the menu is acting on. */
  const handleDeleteFoldedFigure = useCallback(
    (figureId?: string) => {
      const id = figureId ?? activeFoldedFigure?.id;
      if (!id) return;
      runFoldedFigureAction(
        t('panels:creasePattern.deleteFoldedModelAction', 'Delete folded model'),
        () => deleteOristudioCpFoldedFigure(id)
      );
    },
    [activeFoldedFigure, deleteOristudioCpFoldedFigure, runFoldedFigureAction, t]
  );

  /**
   * The folded-figure verbs, shared by the floating toolbar and the right-click
   * menu (see `buildFoldedFigureActions`). Every call goes through
   * `runFoldedFigureAction` so each verb lands as exactly one undo entry.
   */
  const foldedFigureActionDeps = useMemo<Omit<FoldedFigureActionDeps, 't'>>(
    () => ({
      // One verb, two mechanisms. A flat figure turns the paper over, which is a
      // kernel model write; a 3D figure moves the eye to the antipodal camera,
      // which is a re-projection and reaches no kernel at all. Branching here
      // rather than in the catalog keeps the catalog store-free.
      // The fold camera, not the identity: a figure opens at the isometric the
      // simulator opens at, and "reset" means the view you were given, not a
      // view nobody chose.
      resetView: (figure) =>
        runFoldedFigureAction(
          t('panels:creasePattern.resetFoldedModelView', 'Reset folded model view'),
          () => setOristudioCpFolded3dCamera(figure.id, DEFAULT_FOLDED_3D_CAMERA)
        ),
      flip: (figure) =>
        isFolded3dFigure(figure)
          ? runFoldedFigureAction(
              t('panels:creasePattern.viewFoldedModelOtherSide', 'View from the other side'),
              () =>
                setOristudioCpFolded3dCamera(
                  figure.id,
                  foldedFigureOtherSideCamera(figure.camera)
                )
            )
          : runFoldedFigureAction(
              t('panels:creasePattern.flipFoldedModel', 'Flip folded model'),
              () =>
                updateOristudioCpFoldedFigureModel(figure.id, {
                  state: foldedFigureFlipState(figure),
                })
            ),
      setDisplayStyle: (figure, style) =>
        runFoldedFigureAction(
          t('panels:creasePattern.changeFoldedDisplayStyle', 'Change folded display style'),
          () => setOristudioCpFoldedFigureDisplayStyle(figure.id, style)
        ),
      foldAnother: (figure) =>
        runFoldedFigureAction(
          t('panels:creasePattern.anotherSolutionAction', 'Show another solution'),
          () => foldAnotherOristudioCpFigure(figure.id)
        ),
      duplicate: (figure) =>
        runFoldedFigureAction(
          t('panels:creasePattern.duplicateFoldedModelAction', 'Duplicate folded model'),
          () => duplicateOristudioCpFoldedFigure(figure.id)
        ),
      remove: (figure) =>
        runFoldedFigureAction(
          t('panels:creasePattern.deleteFoldedModelAction', 'Delete folded model'),
          () => deleteOristudioCpFoldedFigure(figure.id)
        ),
      refold: (figure) =>
        runFoldedFigureAction(
          t('panels:creasePattern.refoldFoldedModelAction', 'Refold folded model'),
          () => refoldOristudioCpFoldedFigure(figure.id)
        ),
      // Derived, not stamped: an edit outside a figure's source region leaves it
      // alone, which is the whole point of porting Oriedita's box + content
      // check. Memoized on the document so a pan or a selection does not re-run
      // it, and never touched on the edit path.
      isStale: (figure) => staleFoldedFigureIds.has(figure.id),
      // Not wrapped in runFoldedFigureAction: saving a file changes nothing
      // about the document, so it is not an undo step.
      exportAs: (figure, format) => {
        void exportOristudioCpFoldedFigure(format, figure.id);
      },
      // What a 3D verdict offers to do about itself. None of the three is an
      // undo step: two only change what is shown, and the third opens a
      // simulation window, which records its own.
      runNoticeAction: (figure, notice) => {
        switch (notice.action?.id) {
          case 'show-issues':
            // The crossing's own vertices are exactly what CheckCamv reports as
            // `SpatialSelfIntersection`, already worded in every locale — so
            // this reveals an existing overlay rather than adding a second one.
            setOristudioCpViewportOption('camvIssuesVisible', true);
            requestOristudioCpAction('CheckCamv');
            return;
          case 'select-creases':
            setOristudioCpSelection({
              ...emptyOristudioCpSelection(),
              lines: [...notice.action.lineIds],
            });
            return;
          case 'simulate-instead': {
            // The **scoped** ids, exactly as the refusal dialog uses them: a
            // region is matched by every crease inside it, aux lines included,
            // so handing `sourceLineIds` — which is colour-filtered — to
            // `resolveInlineSimulationRegion` makes any region containing one
            // construction line resolve to null and fall through to the panel.
            // That is the one outcome the "simulate inline" decision exists to
            // prevent, and both doors have to honour it.
            const lineIds = notice.action.lineIds;
            if (lineIds.length === 0) return;
            track(ANALYTICS_EVENTS.foldSimulationRun, {
              source: 'fold-3d-no-layer-order',
              crease_count_bucket: bucketCount(lineIds.length, COUNT_BUCKETS),
            });
            void simulateOristudioCpCreaseRegion(lineIds);
            return;
          }
          case undefined:
            return;
        }
      },
    }),
    [
      updateOristudioCpFoldedFigureModel,
      setOristudioCpFoldedFigureDisplayStyle,
      setOristudioCpFolded3dCamera,
      foldAnotherOristudioCpFigure,
      duplicateOristudioCpFoldedFigure,
      deleteOristudioCpFoldedFigure,
      refoldOristudioCpFoldedFigure,
      exportOristudioCpFoldedFigure,
      runFoldedFigureAction,
      setOristudioCpViewportOption,
      requestOristudioCpAction,
      setOristudioCpSelection,
      simulateOristudioCpCreaseRegion,
      staleFoldedFigureIds,
      t,
    ]
  );

  return {
    figures: oristudioCpFoldedFigures,
    generated: generatedFoldedFigures,
    active: activeFoldedFigure,
    selected: selectedFoldedFigure,
    staleIds: staleFoldedFigureIds,
    transformableObjects: foldedFigureObjects,
    /** 3D figures drawn as GPU windows — see `folded3dWindowFigureIds`. */
    windowIds: folded3dWindowFigureIds,
    windowFigures: folded3dWindowFigures,
    /** Bodies the overlay must not take gestures for — see `foldedInertBodyIds`. */
    inertBodyIds: foldedInertBodyIds,
    /**
     * The orbit gesture, for the canvas to consult on a press that fell through
     * an inert body. `claimsPress` first; the other three only mean anything
     * once it has said yes.
     *
     * Memoised because it is passed straight through as a canvas prop, and the
     * canvas is the most render-sensitive surface in the app — a fresh object
     * every render would defeat memoising it later, at the point where someone
     * is memoising it precisely because it got slow.
     */
    orbit: foldedOrbit,
    actionDeps: foldedFigureActionDeps,
    canFoldSelectedModel,
    beginGesture: beginFoldedFigureGesture,
    commitGesture: commitFoldedFigureGesture,
    gestureLabel: foldedGestureLabel,
    applyBoxUpdate: handleFoldedFigureBoxUpdate,
    foldModel: handleFoldModel,
    setDisplayStyle: handleFoldedDisplayStyle,
    updateModel: handleFoldedModelUpdate,
    endModelGesture: endFoldedModelGesture,
    duplicate: handleDuplicateFoldedFigure,
    remove: handleDeleteFoldedFigure,
  };
}
