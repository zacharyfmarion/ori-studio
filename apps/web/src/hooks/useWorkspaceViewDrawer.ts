import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ANALYTICS_EVENTS, track } from '../analytics';
import { useSheetEscape } from '../components/ui/useSheetEscape';
import { useIsCoarsePointerSurface } from '../platform/pointerSurface';
import {
  reconcileSidePanes,
  sidePanesFor,
  useLayoutStore,
  type SidePaneId,
  type SidePaneSpec,
} from '../store/layoutStore';
import { subscribeSidePaneRequests } from '../store/sidePaneRequests';
import { useWorkspaceStore } from '../store/workspaceStore';
import { selectedCanvasObjectIdOf } from '../cp-workspace/canvasObjects/canvasObjectKinds';
import {
  activeAnchorPick,
  anchorPickEndedInPlace,
  annotatingSelectionId,
  escapePutsPickDown,
} from '../store/workspaceStore/diagramState';
import type { DiagramAnchorPick } from '../store/workspaceStore/types';
import { useTranslation } from 'react-i18next';

const NO_PANES: readonly SidePaneSpec[] = [];

/**
 * The pane that shows what is selected, when this workspace's `panes` have it
 * and something is: Edit's Properties for a canvas object, the Diagram's
 * Layers for a mark on the step open in Annotate. Each selection is the
 * workspace's own, and outlives a switch away from it, so the pane must be
 * one of these panes.
 */
export function selectionPaneIn(
  panes: readonly SidePaneSpec[],
  selected: { canvasObject: boolean; layer: boolean }
): SidePaneId | undefined {
  const wanted: SidePaneId[] = [];
  if (selected.canvasObject) wanted.push('cp-properties');
  if (selected.layer) wanted.push('diagram-layers');
  return wanted.find((id) => panes.some((pane) => pane.id === id));
}

export interface WorkspaceViewDrawerState {
  /**
   * The side panes the active workspace would dock, or empty where the drawer
   * has nothing to offer — the Design workspace, or any fine-pointer session,
   * where the panes are docked and reachable already.
   */
  panes: readonly SidePaneSpec[];
  /** The pane the sheet is showing; one of `panes`. */
  activePane: SidePaneSpec | null;
  setActivePane: (id: SidePaneId) => void;
  open: boolean;
  /** DOM id the trigger points `aria-controls` at, and the dialog wears. */
  drawerId: string;
  /** Open, on `paneId` if given, else on the pane last shown. */
  openDrawer: (paneId?: SidePaneId) => void;
  /** Close, and hand focus back to the trigger the user opened it from. */
  close: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Make the dock's View pane agree with the pointer, for as long as the caller is
 * mounted.
 *
 * The other half of the same decision as {@link useWorkspaceViewDrawer} — *is the
 * View pane docked, or drawered?* — and it used to live in that hook, on the
 * reasoning that one question should have one owner. It cannot any more: the
 * drawer is a pill inside `CanvasPillLane`, which renders nothing at all under a
 * fine pointer, so the drawer's hooks stop running exactly when this repair is
 * needed. `WorkspaceShell` calls it instead, because the shell is mounted for
 * every workspace on every pointer.
 *
 * The pointer can change under a live app, and the dock keeps whatever panel set
 * `addPanel`/`fromJSON` last gave it — nothing re-runs on its own. Without this,
 * a flip to fine leaves the workspace with no View pane *and* no trigger, and the
 * only way back is View -> Reset Layout. A null api (before `onReady`, and
 * throughout any test that mocks dockview away) is a no-op.
 */
export function useViewPanelReconcile(): void {
  const coarsePointer = useIsCoarsePointerSurface();
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const dockviewApi = useLayoutStore((state) => state.dockviewApi);

  // The language is a dep so a change re-runs the retitle pass the reconcile
  // carries; dockview persists the title it was given, and a tab restored under
  // another language would otherwise keep it. `useTranslation` is what makes
  // the shell re-render for it.
  const language = useTranslation().i18n.language;
  useEffect(() => {
    if (!dockviewApi) return;
    reconcileSidePanes(dockviewApi, activeWorkspace, coarsePointer);
  }, [dockviewApi, activeWorkspace, coarsePointer, language]);
}

/**
 * The touch-only View drawer: which pane it offers, and whether it is open.
 *
 * The dock reconcile that pairs with it is {@link useViewPanelReconcile}, called
 * by `WorkspaceShell`; see the note there for why the two are no longer one hook.
 */
export function useWorkspaceViewDrawer(): WorkspaceViewDrawerState {
  const coarsePointer = useIsCoarsePointerSurface();
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerId = useId();
  const panes = coarsePointer ? sidePanesFor(activeWorkspace) : NO_PANES;
  const [activePaneId, setActivePaneId] = useState<SidePaneId | null>(null);
  // The one thing the sheet knows about what it shows: something selected — a
  // canvas object in Edit, a mark in the Diagram — makes the pane that shows
  // it the one to open on. The dock's pane reveals itself on that transition
  // (`usePropertiesPaneActivation`, `useDiagramPaneReveal`); the sheet is modal
  // and never opens on a tap, so it asks at open time instead.
  const canvasObjectSelected = useWorkspaceStore(
    (state) => selectedCanvasObjectIdOf(state) !== null
  );
  const layerSelected = useWorkspaceStore((state) => annotatingSelectionId(state) !== null);
  // A request from `activatePanel` — View ▸ Properties, the phone overflow row
  // — parked until this workspace's panes include it. Latched because a request
  // raised from another workspace lands in the same commit as the workspace
  // switch, whose force-close below would otherwise shut the sheet it opened.
  const [pendingPane, setPendingPane] = useState<string | null>(null);

  /**
   * `open`, readable from an effect that must not re-run when it changes.
   *
   * Synced in its own effect rather than during render — writing a ref while
   * rendering is what `react-hooks/refs` forbids, and it declared first so that
   * the force-close below, which runs in the same commit, reads the value this
   * render committed.
   */
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  /**
   * The pick the sheet is closed for while it is made on the canvas under it
   * — its step and the area or frame it anchors — to come back when it ends
   * there; null when the sheet is not stepped aside. Opened again meanwhile,
   * by hand or by a request, the sheet is the user's, and so is closing it.
   */
  const steppedAside = useRef<DiagramAnchorPick | null>(null);
  useEffect(() => {
    if (open) steppedAside.current = null;
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Anything that removes or replaces the drawer's subject closes it. A flip to
  // fine unmounts the trigger, and an open dialog outliving it would be holding
  // focus with nothing to hand it back to; a workspace switch changes which
  // controls the sheet is showing, which is not a change to make under the user.
  //
  // Focus goes back to the trigger *when there still is one*. On a workspace
  // switch the trigger is the same surviving node, and leaving focus on the
  // unmounting sheet drops it to `<body>` — a keyboard user's next Tab restarts
  // from the top of the document. On a flip to fine `triggerRef` is already null
  // and `close`'s optional call correctly does nothing, because there is nothing
  // to return to.
  //
  // The open state is read through a ref so that closing is not itself a reason
  // to re-run: this effect fires on a change of *subject*, and putting `open` in
  // its deps would make every open re-close the drawer immediately.
  useEffect(() => {
    steppedAside.current = null;
    if (!openRef.current) return;
    close();
  }, [coarsePointer, activeWorkspace, close]);

  // A pick armed from the sheet is made on the canvas the sheet covers: the
  // Diagram's anchor pick, armed from the Layers pane (Revision 2), whose next
  // tap landed on the sheet, not the face under it (an iPad, 18e). The sheet
  // steps aside while it is armed and comes back, on the same pane, when it
  // ends where it was made — anchored, or put down — and not when it ends
  // because the user went somewhere else: Pose, the step list, another step,
  // another mark (review of 18f), or another workspace (the effect above, run
  // first). A sheet opened while one is armed stays: the runtime leaves Escape
  // to the pick, then to it (below).
  const picking = useWorkspaceStore(escapePutsPickDown);
  useEffect(() => {
    if (picking && openRef.current) {
      steppedAside.current = activeAnchorPick(useWorkspaceStore.getState());
      setOpen(false);
    } else if (!picking && steppedAside.current) {
      const armed = steppedAside.current;
      steppedAside.current = null;
      if (anchorPickEndedInPlace(useWorkspaceStore.getState(), armed)) setOpen(true);
    }
  }, [picking]);

  useEffect(() => subscribeSidePaneRequests(setPendingPane), []);

  // After the force-close above, so a request that arrived with a workspace
  // switch opens the sheet rather than being closed by it.
  useEffect(() => {
    if (pendingPane === null) return;
    const pane = panes.find((candidate) => candidate.id === pendingPane);
    if (!pane) return;
    setPendingPane(null);
    setActivePaneId(pane.id);
    setOpen(true);
    track(ANALYTICS_EVENTS.viewDrawerOpened, { workspace: activeWorkspace, pane: pane.id });
  }, [pendingPane, panes, activeWorkspace]);

  // Escape: the one listener every touch sheet shares, and the cases in which
  // the key is another's — a field's, an open Select's, an armed pick's, a
  // dialog's over the sheet (`useSheetEscape`).
  useSheetEscape(open, drawerId, close);

  const activePane =
    panes.find((candidate) => candidate.id === activePaneId) ?? panes[0] ?? null;

  return {
    panes,
    activePane,
    setActivePane: setActivePaneId,
    open,
    drawerId,
    // Instrumented here rather than at the button, because opening is the
    // measurable thing and the button is only one way to ask for it.
    //
    // Guarded, because activating the trigger again while the sheet is already
    // open is reachable: the backdrop stops a *tap*, but the trigger is still in
    // the tab order behind it, so a keyboard reaches it and fires this twice for
    // one visit. `view drawer opened` is meant to count sessions that went
    // looking for the view options — an inflated count is the one failure that
    // would make the number answer the wrong question.
    openDrawer: useCallback(
      (paneId?: SidePaneId) => {
        if (open) return;
        const preferred =
          paneId ?? selectionPaneIn(panes, { canvasObject: canvasObjectSelected, layer: layerSelected });
        const pane = panes.find((candidate) => candidate.id === preferred) ?? activePane;
        if (pane) setActivePaneId(pane.id);
        setOpen(true);
        track(ANALYTICS_EVENTS.viewDrawerOpened, {
          workspace: activeWorkspace,
          pane: pane?.id ?? null,
        });
      },
      [open, panes, activePane, activeWorkspace, canvasObjectSelected, layerSelected]
    ),
    close,
    triggerRef,
  };
}
