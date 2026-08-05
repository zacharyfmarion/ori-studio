import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
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
import { foldedFigureFlipState, type FoldedFigureActionDeps } from './foldedFigureActions';

/**
 * The face folding holds fixed. Oriedita lets this be chosen and the kernel still
 * takes it per fold, but the product does not offer the choice: the picker was the
 * only thing that ever set it, so every fold was already from face 1.
 */
const FOLD_STARTING_FACE_ID = 1;

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
  const canFoldSelectedModel = selectedFoldLineIds.length > 0;

  const activeFoldedFigure = useMemo(
    () =>
      oristudioCpFoldedFigures.find((figure) => figure.id === oristudioCpActiveFoldedFigureId) ??
      // Nothing selected: the toolbar acts on the most recent generated figure,
      // which is the one a just-completed fold produced.
      [...oristudioCpFoldedFigures]
        .reverse()
        .find(
          (figure) =>
            figure.sourceKind === 'generated-from-current-cp' && figure.snapshot?.wireframe
        ) ??
      null,
    [oristudioCpActiveFoldedFigureId, oristudioCpFoldedFigures]
  );

  const generatedFoldedFigures = useMemo(
    () =>
      oristudioCpFoldedFigures.filter(
        (figure) => figure.sourceKind === 'generated-from-current-cp'
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
      if (previous) recordFoldedFigureHistory([...previous], label, previousActiveId);
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
      flip: (figure) =>
        runFoldedFigureAction(
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
    }),
    [
      updateOristudioCpFoldedFigureModel,
      setOristudioCpFoldedFigureDisplayStyle,
      foldAnotherOristudioCpFigure,
      duplicateOristudioCpFoldedFigure,
      deleteOristudioCpFoldedFigure,
      refoldOristudioCpFoldedFigure,
      exportOristudioCpFoldedFigure,
      runFoldedFigureAction,
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
