import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ANALYTICS_EVENTS, track } from '../analytics';
import { isShortcutEditingTarget } from '../keyboard/shortcutDispatcher';
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
import { useTranslation } from 'react-i18next';

const NO_PANES: readonly SidePaneSpec[] = [];

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
  // The one thing the sheet knows about what it shows: a canvas object being
  // selected is what makes Properties the pane to open on. The dock's pane
  // reveals itself on that transition (`usePropertiesPaneActivation`); the
  // sheet is modal and never opens on a tap, so it asks at open time instead.
  const canvasObjectSelected = useWorkspaceStore(
    (state) => selectedCanvasObjectIdOf(state) !== null
  );
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
    if (!openRef.current) return;
    close();
  }, [coarsePointer, activeWorkspace, close]);

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

  // Escape, the way both existing modals do it (`HelpModal`, `SettingsModal`): a
  // capture-phase listener on `window`, so it works wherever focus happens to be
  // inside the sheet.
  //
  // With two additions, both cases where something inside the sheet owns Escape
  // and a capture listener on `window` would otherwise beat it to the key.
  //
  // The drawer's body is the view-controls pane, which is full of `NumberField`s
  // whose own Escape reverts the half-typed draft before blurring — a React
  // bubble handler. Without the bail, Escape in a mid-edit grid size would commit
  // the number and close the drawer. `isShortcutEditingTarget` is the repo's one
  // answer to "does this target own its keystrokes", and reusing it is why there
  // is no private copy.
  //
  // The pane also has `Select`s, and Radix portals an open dropdown *outside* the
  // sheet, so neither the target check nor a listener scoped to the sheet sees
  // it. Radix mounts `[data-radix-popper-content-wrapper]` only while a layer is
  // open, so its presence is the question "is a layer above me holding Escape"
  // asked directly. Without this, Escape aimed at a dropdown closed the whole
  // drawer — one keystroke discarding the wrong thing.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isShortcutEditingTarget(event.target)) return;
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, close]);

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
        const preferred = paneId ?? (canvasObjectSelected ? 'cp-properties' : undefined);
        const pane = panes.find((candidate) => candidate.id === preferred) ?? activePane;
        if (pane) setActivePaneId(pane.id);
        setOpen(true);
        track(ANALYTICS_EVENTS.viewDrawerOpened, {
          workspace: activeWorkspace,
          pane: pane?.id ?? null,
        });
      },
      [open, panes, activePane, activeWorkspace, canvasObjectSelected]
    ),
    close,
    triggerRef,
  };
}
