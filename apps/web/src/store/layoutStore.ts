import { create } from 'zustand';
import type { DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview';
import { isCoarsePointerSurface } from '../platform/pointerSurface';
import type { WorkspaceId } from '../workspaces/workspaces';
import { primaryPanelIdFor, workspaceForPanelId } from '../workspaces/workspaces';
import { readJson, readString, removeKey, storageKey, STORAGE_KEYS, writeJson, writeString } from '../lib/storage';

// v18: the Design workspace collapsed to one panel — every design pane moved
// into the per-tab dock inside it — so any stored Design layout is a layout of
// panels that no longer live at this level.
// v17: the Simulate workspace gained its options pane; a layout persisted before
// it existed restores a lone simulator panel and never picks the pane up.
// v16: the box-pleat tree pane gained a tab header (draggable/rearrangeable), so
// invalidate persisted box-pleat layouts that still have it in a headerless group.
// v15: workspace routing rebuilt the layout lifecycle; invalidate any layouts
// persisted by the racy pre-routing/interim builds (e.g. a vertically stacked BP
// split, an Edit layout missing the View pane).
export const LAYOUT_VERSION = 18;

/**
 * Drop the active design's saved pane arrangement.
 *
 * Registered by the workspace store rather than imported, for the same reason as
 * the other seams here: this module sits under it. A no-op outside Design.
 */
let clearActiveDesignPaneLayout: () => void = () => {};

export function registerDesignPaneLayoutReset(reset: () => void): void {
  clearActiveDesignPaneLayout = reset;
}

/**
 * Report the dock's active panel to whoever owns `activePanelId`.
 *
 * Same seam as above, and for the same reason. Dockview's own
 * `onDidActivePanelChange` reports *changes*, so it cannot correct a value
 * written behind its back — this is the pull to pair with that push.
 */
let reportActivePanel: (panelId: string | null) => void = () => {};

export function registerActivePanelSink(sink: (panelId: string | null) => void): void {
  reportActivePanel = sink;
}

/**
 * Show a design pane where there is no dock to activate it in.
 *
 * The phone Design layout mounts one pane and puts the rest behind a switcher
 * (see `useDesignPaneSwitcher`), so `activatePanel('inspector')` — the BP
 * long-press, and the View menu — has no `IDockviewPanel` to call `setActive`
 * on and would silently do nothing.
 *
 * Returns whether it recognised the id, and that answer is the point: this store
 * has no business knowing which panes a design kind declares, so the id is
 * validated by whoever is rendering them. An unregistered selector answers
 * `false`, which is exactly right on a desktop where the dock already handled it.
 */
let selectDesignPane: (panelId: string) => boolean = () => false;

export function registerDesignPaneSelector(select: (panelId: string) => boolean): () => void {
  selectDesignPane = select;
  // Identity-checked, so a remount that registers before the old one cleans up
  // cannot leave the seam pointing at nothing.
  return () => {
    if (selectDesignPane === select) selectDesignPane = () => false;
  };
}

/**
 * Persisted-layout scope — one per workspace, and nothing else.
 *
 * The Design workspace used to have three (`design`, `design:box-pleat`,
 * `design:nux`) because its dock layout changed with the design's kind. It no
 * longer has a dock layout worth varying: the workspace holds one panel, and the
 * panes inside it belong to a design tab, which persists its own arrangement in
 * the `.osf` rather than in local storage.
 */
function currentLayoutScope(workspace: WorkspaceId): string {
  return workspace;
}

function layoutStorageKey(scope: string): string {
  return storageKey(STORAGE_KEYS.layout, scope);
}

function layoutVersionKey(scope: string): string {
  return storageKey(STORAGE_KEYS.layoutVersion, scope);
}

/** Remove the persisted layout (and its version) for a workspace. */
export function clearPersistedLayout(workspace: WorkspaceId): void {
  const scope = currentLayoutScope(workspace);
  removeKey(layoutStorageKey(scope));
  removeKey(layoutVersionKey(scope));
}

/**
 * Every scope that has ever been written, including the two the Design
 * workspace's old per-variant scoping produced. Kept in the *clear* list so an
 * upgrade does not strand them in local storage forever.
 */
const ALL_LAYOUT_SCOPES = ['design', 'design:box-pleat', 'design:nux', 'edit', 'simulate'];

/**
 * Drop every persisted layout, for the app-level error recovery path: when the
 * whole shell has failed to render we cannot know which workspace's stored
 * layout is at fault, and a corrupt one would survive an ordinary reload.
 *
 * Unlike `clearPersistedLayout` this reads no store state (no design variant, no
 * active workspace) — it is called from an error fallback, where any store may
 * be the thing that is broken.
 */
export function clearAllPersistedLayouts(): void {
  for (const scope of ALL_LAYOUT_SCOPES) {
    removeKey(layoutStorageKey(scope));
    removeKey(layoutVersionKey(scope));
  }
}

interface PrimaryPanelOptions {
  id: string;
  component: string;
  title: string;
}

/**
 * The shape of a workspace's View pane, in the form `addPanel` wants it.
 *
 * It exists because the pane is no longer built in exactly one place: under a
 * coarse pointer it is not docked at all, and the drawer that replaces it has to
 * name the same panel. The default build, the reconcile and the drawer all read
 * this one record, which is what keeps "which pane is the View pane" from being
 * answered by three hand-written literals that can drift — which is how the id,
 * component, title and width used to live.
 */
interface ViewPanelDefinition {
  id: string;
  component: string;
  title: string;
  initialWidth: number;
  /** The primary pane it docks to the right of. */
  referencePanelId: string;
}

const WORKSPACE_VIEW_PANELS = {
  edit: {
    id: 'cp-view-controls',
    component: 'cp-view-controls',
    title: 'View',
    initialWidth: 260,
    referencePanelId: 'crease-pattern',
  },
  simulate: {
    id: 'simulator-view-controls',
    component: 'simulator-view-controls',
    title: 'View',
    initialWidth: 260,
    referencePanelId: 'simulator',
  },
} as const satisfies Partial<Record<WorkspaceId, ViewPanelDefinition>>;

export type ViewPanelSpec = (typeof WORKSPACE_VIEW_PANELS)[keyof typeof WORKSPACE_VIEW_PANELS];

/**
 * The ids in the table, as a union rather than `string`.
 *
 * The drawer keys its content map on this, so a workspace that gains a View pane
 * without gaining a drawer body is a compile error rather than an empty sheet.
 */
export type ViewPanelId = ViewPanelSpec['id'];

export function viewPanelFor(workspace: WorkspaceId): ViewPanelSpec | null {
  return workspace in WORKSPACE_VIEW_PANELS
    ? WORKSPACE_VIEW_PANELS[workspace as keyof typeof WORKSPACE_VIEW_PANELS]
    : null;
}

function addViewPanel(api: DockviewApi, spec: ViewPanelSpec): void {
  // Dockview throws when a `referencePanel` is not in the dock, and reconciling
  // runs against layouts we did not build (a restored `fromJSON`, an error path
  // that left the dock empty). Nothing to dock beside is a reason to leave the
  // dock alone, not to take the workspace down.
  if (!api.getPanel(spec.referencePanelId)) return;
  api.addPanel({
    id: spec.id,
    component: spec.component,
    title: spec.title,
    position: { referencePanel: spec.referencePanelId, direction: 'right' },
    initialWidth: spec.initialWidth,
  });
}

/**
 * Make the dock's View pane agree with the pointer, in either direction.
 *
 * Under a coarse pointer the pane is not docked: a 260px column beside the
 * canvas is most of an iPad's width in portrait, and the same controls are one
 * tap away in the drawer (see `WorkspaceViewDrawer`). Removing it rather than
 * hiding it is the point — `removePanel` takes the emptied group with it, so the
 * canvas gets the width back instead of dockview holding an invisible column.
 *
 * Total and idempotent, because it has to run at several unrelated moments:
 * after each of the two `fromJSON` restores, once more at the end of `onReady`
 * whichever way that went, and again whenever the primary pointer changes under
 * a live app. A default build needs none of it — `applyDefaultLayout` is handed
 * the pointer and builds the right set — so that call is the free no-op.
 *
 * **Why this instead of a pointer-scoped storage bucket.** A separate
 * `…:edit:coarse` key would not touch the dock that is already built, so the
 * live flip needs this function regardless — and once it exists, the second
 * bucket buys nothing while doubling the scopes to invalidate. Repairing also
 * beats discarding: the difference between the two layouts is exactly one panel
 * whose full options this module owns, so there is nothing here that a version
 * bump's throw-it-away semantics would be the right tool for.
 *
 * The cost, stated: a device that really does flip (a convertible, devtools
 * emulation) gets the pane back at `initialWidth` rather than at whatever width
 * the user had dragged it to, because the debounced save will have overwritten
 * the stored sash position while the pane was gone. An iPad does not flip —
 * `pointer` stays `coarse` with a Magic Keyboard attached — so this is not the
 * case the feature is for.
 */
export function reconcileViewPanel(
  api: DockviewApi,
  workspace: WorkspaceId,
  coarsePointer: boolean = isCoarsePointerSurface()
): void {
  // The Design workspace is deliberately not in the table. Its panes live in the
  // active tab's own dock and persist into the `.osf`, so reconciling there would
  // write a pane-less layout into a document that travels to other devices and
  // other users — a much worse bug than the local one this fixes.
  const spec = viewPanelFor(workspace);
  if (!spec) return;
  const panel = api.getPanel(spec.id);
  if (coarsePointer) {
    if (panel) api.removePanel(panel);
    return;
  }
  if (!panel) addViewPanel(api, spec);
}

export function applyDefaultLayout(
  api: DockviewApi,
  workspace: WorkspaceId = 'design',
  coarsePointer: boolean = isCoarsePointerSurface()
): void {
  switch (workspace) {
    case 'design':
      applyDesignLayout(api);
      return;
    case 'edit':
      applyEditLayout(api, coarsePointer);
      return;
    case 'simulate':
      applySimulateLayout(api, coarsePointer);
      return;
  }
}

function addHeaderlessPanel(api: DockviewApi, options: PrimaryPanelOptions): IDockviewPanel {
  const group = api.addGroup({ direction: 'right', hideHeader: true });
  return api.addPanel({ ...options, position: { referenceGroup: group } });
}

/**
 * One headerless panel, always.
 *
 * The Design workspace's panes — the canvas, the inspector, the BP packing
 * editor — moved inside it, into a dock owned by the active design tab. What is
 * left at this level does not vary with anything, which is what removed
 * `DesignLayoutVariant`, `mountedDesignVariant`, and the tear-down-and-rebuild
 * that ran on every tab switch.
 */
function applyDesignLayout(api: DockviewApi): void {
  addHeaderlessPanel(api, {
    id: 'design-workspace',
    component: 'design-workspace',
    title: 'Design',
  }).api.setActive();
}

function applyEditLayout(api: DockviewApi, coarsePointer: boolean): void {
  addHeaderlessPanel(api, {
    id: 'crease-pattern',
    component: 'crease-pattern',
    title: 'Crease Pattern',
  });
  // Built rather than built-and-reconciled, so a touch device never mounts the
  // pane's controls for the one frame it would take to remove them again.
  if (!coarsePointer) addViewPanel(api, WORKSPACE_VIEW_PANELS.edit);
}

function applySimulateLayout(api: DockviewApi, coarsePointer: boolean): void {
  const simulator = addHeaderlessPanel(api, {
    id: 'simulator',
    component: 'simulator',
    title: 'Simulator',
  });
  if (!coarsePointer) addViewPanel(api, WORKSPACE_VIEW_PANELS.simulate);
  simulator.api.setActive();
}

interface LayoutState {
  dockviewApi: DockviewApi | null;
  /**
   * The active design tab's own dock, registered by it while mounted.
   *
   * The design panes live one level down now, so `activatePanel('conditions')`
   * would find nothing at the workspace level. Rather than make every caller ask
   * which dock a pane is in — a question they have no business answering — the
   * layout store looks in both.
   */
  designPaneApi: DockviewApi | null;
  activeWorkspace: WorkspaceId;
  setDockviewApi: (api: DockviewApi | null) => void;
  setDesignPaneApi: (api: DockviewApi | null) => void;
  setActiveWorkspace: (workspace: WorkspaceId) => void;
  activateWorkspace: (workspace: WorkspaceId) => void;
  /**
   * Which pane the active workspace is on, asking the dock and falling back to
   * the workspace's primary pane. The one place that question is answered, so a
   * caller can never invent an answer that disagrees with the workspace.
   */
  activePanelId: () => string;
  activatePanel: (id: string) => void;
  saveLayout: (workspace?: WorkspaceId) => void;
  loadLayout: (workspace?: WorkspaceId) => SerializedDockview | null;
  resetLayout: (workspace?: WorkspaceId) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  dockviewApi: null,
  designPaneApi: null,
  activeWorkspace: 'design',
  setDockviewApi: (api) => set({ dockviewApi: api }),
  setDesignPaneApi: (api) => set({ designPaneApi: api }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),
  /**
   * Navigate to a workspace, and settle which pane is active in it.
   *
   * Every exit reconciles, including the two that do no work: a no-op switch and
   * a headless call still have to answer "which pane", because `activePanelId`
   * is a cache of what Dockview owns and `onDidActivePanelChange` reports only
   * *changes*. Anything that wrote the field behind Dockview's back stays
   * uncorrected otherwise — which is how opening a design bundled with a crease
   * pattern, while Edit was already on screen, left the pane reading `design`
   * and killed every Edit shortcut.
   *
   * Reconciling here rather than at the call sites is deliberate: navigating is
   * what decides the pane, so no caller has to remember to say it.
   */
  activateWorkspace: (workspace) => {
    const { dockviewApi, activeWorkspace } = get();
    if (!dockviewApi) {
      set({ activeWorkspace: workspace });
      reportActivePanel(get().activePanelId());
      return;
    }
    if (workspace === activeWorkspace) {
      reportActivePanel(get().activePanelId());
      return;
    }

    get().saveLayout(activeWorkspace);
    dockviewApi.clear();
    set({ activeWorkspace: workspace });

    const saved = get().loadLayout(workspace);
    if (saved) {
      try {
        dockviewApi.fromJSON(saved);
        // A restored layout is a panel set from whenever it was captured, which
        // need not be the panel set this pointer wants. See `reconcileViewPanel`.
        reconcileViewPanel(dockviewApi, workspace);
        reportActivePanel(get().activePanelId());
        return;
      } catch (error) {
        console.warn('Failed to restore layout', error);
        clearPersistedLayout(workspace);
      }
    }

    applyDefaultLayout(dockviewApi, workspace);
    reportActivePanel(get().activePanelId());
  },
  activePanelId: () => {
    const active = get().dockviewApi?.activePanel?.id;
    // A pane from the outgoing workspace means the dock has not caught up yet
    // (or never will, on the no-op path). The workspace's own primary pane is
    // the honest answer for that moment, and the answer headless has always.
    if (active && workspaceForPanelId(active) === get().activeWorkspace) return active;
    return primaryPanelIdFor(get().activeWorkspace);
  },
  activatePanel: (id) => {
    const targetWorkspace = workspaceForPanelId(id);
    if (targetWorkspace) get().activateWorkspace(targetWorkspace);
    const { dockviewApi, designPaneApi } = get();
    const panel = dockviewApi?.getPanel(id) ?? designPaneApi?.getPanel(id);
    if (panel) {
      panel.api.setActive();
      return;
    }
    // No dock holds it. On a phone that is the ordinary case for a design pane —
    // the layout mounts one and switches rather than docking them side by side —
    // so ask whoever is rendering them. Everywhere else this is a no-op, which
    // is the same nothing the bare `panel?.api.setActive()` used to do.
    selectDesignPane(id);
  },
  saveLayout: (workspace = get().activeWorkspace) => {
    const { dockviewApi } = get();
    if (!dockviewApi) return;
    const scope = currentLayoutScope(workspace);
    writeJson(layoutStorageKey(scope), dockviewApi.toJSON());
    writeString(layoutVersionKey(scope), String(LAYOUT_VERSION));
  },
  loadLayout: (workspace = get().activeWorkspace) => {
    const scope = currentLayoutScope(workspace);
    const version = readString(layoutVersionKey(scope));
    if (version !== String(LAYOUT_VERSION)) {
      clearPersistedLayout(workspace);
      return null;
    }
    return readJson<SerializedDockview | null>(layoutStorageKey(scope), null);
  },
  resetLayout: (workspace = get().activeWorkspace) => {
    clearPersistedLayout(workspace);
    // The design's panes live in the *tab's* dock, which restores the tab's saved
    // arrangement on every mount — so rebuilding the workspace dock alone puts
    // the same layout straight back and "Reset Layout" appears to do nothing in
    // the Design workspace. Dropping the saved arrangement is what reaches it.
    if (workspace === 'design') clearActiveDesignPaneLayout();
    const { dockviewApi } = get();
    if (!dockviewApi || workspace !== get().activeWorkspace) return;
    dockviewApi.clear();
    applyDefaultLayout(dockviewApi, workspace);
    get().saveLayout(workspace);
  },
}));
