import { create } from 'zustand';
import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
  Position,
  SerializedDockview,
} from 'dockview';
import i18n from '../i18n';
import { isCoarsePointerSurface } from '../platform/pointerSurface';
import { requestSidePane } from './sidePaneRequests';
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
 * Whether a panel id is a pane of the design currently on screen.
 *
 * Asked by {@link LayoutState.activatePanel} before it moves the phone layout's
 * visible pane, because this store has no business knowing which panes a design
 * kind declares. An unregistered validator answers `false`, which is right on a
 * desktop where the dock already handled the activation.
 */
let isDesignPaneOfActiveKind: (panelId: string) => boolean = () => false;

export function registerDesignPaneValidator(isPane: (panelId: string) => boolean): () => void {
  isDesignPaneOfActiveKind = isPane;
  // Identity-checked, so a remount that registers before the old one cleans up
  // cannot leave the seam pointing at nothing.
  return () => {
    if (isDesignPaneOfActiveKind === isPane) isDesignPaneOfActiveKind = () => false;
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
 * A workspace's side panes — the View pane, and beside it the Properties pane —
 * in the form `addPanel` wants them.
 *
 * One table rather than literals at each build site, because a pane is built
 * in more than one place: the default build, the reconcile that repairs a
 * restored layout, and the touch drawer that replaces the docked column under a
 * coarse pointer. All of them read this one record, which is what keeps "which
 * panes does this workspace dock" from drifting between three hand-written
 * copies.
 *
 * `placement` is where a pane lands: the lead of a column docks beside the
 * primary pane (`beside-primary`) and a later pane joins the lead's group as a
 * tab (`tab-of`). A list is ordered lead first so the group exists before the
 * tab that needs it.
 */
interface SidePaneDefinition {
  id: string;
  component: string;
  initialWidth?: number;
  /** The primary pane the column docks to the right of. */
  referencePanelId: string;
  placement: { kind: 'beside-primary' } | { kind: 'tab-of'; leadId: string };
}

const WORKSPACE_SIDE_PANES = {
  edit: [
    {
      id: 'cp-view-controls',
      component: 'cp-view-controls',
      initialWidth: 260,
      referencePanelId: 'crease-pattern',
      placement: { kind: 'beside-primary' },
    },
    {
      id: 'cp-properties',
      component: 'cp-properties',
      referencePanelId: 'crease-pattern',
      placement: { kind: 'tab-of', leadId: 'cp-view-controls' },
    },
  ],
  simulate: [
    {
      id: 'simulator-view-controls',
      component: 'simulator-view-controls',
      initialWidth: 260,
      referencePanelId: 'simulator',
      placement: { kind: 'beside-primary' },
    },
  ],
} as const satisfies Partial<Record<WorkspaceId, readonly SidePaneDefinition[]>>;

export type SidePaneSpec = (typeof WORKSPACE_SIDE_PANES)[keyof typeof WORKSPACE_SIDE_PANES][number];

/**
 * The ids in the table, as a union rather than `string`.
 *
 * The drawer keys its content map on this, so a workspace that gains a side
 * pane without gaining a drawer body is a compile error rather than an empty
 * sheet.
 */
export type SidePaneId = SidePaneSpec['id'];

export function sidePanesFor(workspace: WorkspaceId): readonly SidePaneSpec[] {
  return workspace in WORKSPACE_SIDE_PANES
    ? WORKSPACE_SIDE_PANES[workspace as keyof typeof WORKSPACE_SIDE_PANES]
    : [];
}

/** The pane that leads a workspace's side column, or null for a workspace without one. */
export function leadSidePaneFor(workspace: WorkspaceId): SidePaneSpec | null {
  return sidePanesFor(workspace)[0] ?? null;
}

/**
 * A side pane's tab title, localised.
 *
 * A render-site switch with literal keys — the extractor only sees literals —
 * called through `i18n.t` rather than a hook because the callers are the
 * layout builders, which run from the store. Dockview persists the title it
 * was given, so a restored layout is retitled on reconcile and on language
 * change (`retitleSidePanes`); before that, tab titles were English literals.
 */
export function sidePaneTitle(spec: SidePaneSpec): string {
  switch (spec.id) {
    case 'cp-view-controls':
    case 'simulator-view-controls':
      return i18n.t('panels:sidePane.view', 'View');
    case 'cp-properties':
      return i18n.t('panels:sidePane.properties', 'Properties');
  }
}

function addSidePane(api: DockviewApi, spec: SidePaneSpec): void {
  // Dockview throws when a reference is not in the dock, and reconciling runs
  // against layouts we did not build (a restored `fromJSON`, an error path
  // that left the dock empty). Nothing to dock beside is a reason to leave the
  // dock alone, not to take the workspace down.
  if (spec.placement.kind === 'tab-of') {
    const lead = api.getPanel(spec.placement.leadId);
    if (!lead) return;
    api.addPanel({
      id: spec.id,
      component: spec.component,
      title: sidePaneTitle(spec),
      position: { referenceGroup: lead.group },
      // Added behind the lead: the tab exists, the lead stays on top.
      inactive: true,
    });
    return;
  }
  if (!api.getPanel(spec.referencePanelId)) return;
  const initialWidth = 'initialWidth' in spec ? spec.initialWidth : undefined;
  api.addPanel({
    id: spec.id,
    component: spec.component,
    title: sidePaneTitle(spec),
    position: { referencePanel: spec.referencePanelId, direction: 'right' },
    ...(initialWidth ? { initialWidth } : {}),
  });
}

/**
 * Give every present side pane the title the current language says, so a tab
 * restored from a layout persisted under another language does not keep it.
 */
export function retitleSidePanes(api: DockviewApi, workspace: WorkspaceId): void {
  for (const spec of sidePanesFor(workspace)) {
    const panel = api.getPanel(spec.id);
    if (!panel) continue;
    const title = sidePaneTitle(spec);
    if (panel.title !== title) panel.api.setTitle(title);
  }
}

/**
 * Make the dock's side panes agree with the pointer and the table, in either
 * direction.
 *
 * Under a coarse pointer the panes are not docked: a 260px column beside the
 * canvas is most of an iPad's width in portrait, and the same controls are one
 * tap away in the drawer (see `WorkspaceViewDrawer`). Removing rather than
 * hiding is the point — `removePanel` takes the emptied group with it, so the
 * canvas gets the width back instead of dockview holding an invisible column.
 *
 * On a fine pointer every listed pane that is missing is added, in table order
 * so a tab's lead exists first. That is what carries a persisted layout across
 * a table change: dockview's `fromJSON` restores exactly the panel set it was
 * given, so a layout saved before a pane existed would never show it. Adding
 * the missing pane keeps the user's sash widths; bumping `LAYOUT_VERSION` would
 * discard them. This is the rung the View pane already had, generalised.
 *
 * Total and idempotent, because it has to run at several unrelated moments:
 * after each of the two `fromJSON` restores, once more at the end of `onReady`
 * whichever way that went, and again whenever the primary pointer changes under
 * a live app. A default build needs none of it — `applyDefaultLayout` is handed
 * the pointer and builds the right set — so that call is the free no-op.
 *
 * The cost, stated: a device that really does flip (a convertible, devtools
 * emulation) gets the column back at `initialWidth` rather than at whatever
 * width the user had dragged it to, because the debounced save will have
 * overwritten the stored sash position while the panes were gone. An iPad does
 * not flip — `pointer` stays `coarse` with a Magic Keyboard attached — so this
 * is not the case the feature is for.
 */
export function reconcileSidePanes(
  api: DockviewApi,
  workspace: WorkspaceId,
  coarsePointer: boolean = isCoarsePointerSurface()
): void {
  // The Design workspace is deliberately not in the table. Its panes live in the
  // active tab's own dock and persist into the `.osf`, so reconciling there would
  // write a pane-less layout into a document that travels to other devices and
  // other users — a much worse bug than the local one this fixes.
  const specs = sidePanesFor(workspace);
  if (specs.length === 0) return;
  if (coarsePointer) {
    // Tabs before their lead, so the lead's removal is what empties the group.
    for (const spec of [...specs].reverse()) {
      const panel = api.getPanel(spec.id);
      if (panel) api.removePanel(panel);
    }
    return;
  }
  for (const spec of specs) {
    const panel = api.getPanel(spec.id);
    // Found inside the headerless primary group — a drop that a build without
    // `refuseDropsIntoHeaderlessGroups` accepted, persisted as it was — the
    // pane covers the canvas with no tab to bring it back. Re-adding through
    // the one placement path puts it where the table says; the lead goes first
    // in table order, so a tab lands in the lead's new group, not the old one.
    if (panel?.group.header.hidden) api.removePanel(panel);
    if (!api.getPanel(spec.id)) addSidePane(api, spec);
  }
  retitleSidePanes(api, workspace);
}

/**
 * Refuse a drop that would make a panel a tab of a headerless group.
 *
 * A primary group hides its header so the canvas fills the pane — and a panel
 * dropped onto the canvas, the centre position, joins a tab strip nobody can
 * see. It comes up active, covers the canvas, and there is no tab to switch
 * back; the only way out was View ▸ Reset Layout. Reachable by dragging the
 * View or Properties tab onto the canvas. Edge drops split the group instead,
 * and the new group has a header, so those stay allowed. Vetoed at the
 * overlay so the drop target never lights up, and again at the drop, which is
 * the one dockview honours when the overlay did not run.
 */
export function refuseDropsIntoHeaderlessGroups(api: DockviewApi): void {
  const intoHiddenTabStrip = (event: {
    group: DockviewGroupPanel | undefined;
    position: Position;
  }): boolean => event.group?.header.hidden === true && event.position === 'center';
  api.onWillShowOverlay((event) => {
    if (intoHiddenTabStrip(event)) event.preventDefault();
  });
  api.onWillDrop((event) => {
    if (intoHiddenTabStrip(event)) event.preventDefault();
  });
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
  const creasePattern = addHeaderlessPanel(api, {
    id: 'crease-pattern',
    component: 'crease-pattern',
    title: 'Crease Pattern',
  });
  // Built rather than built-and-reconciled, so a touch device never mounts the
  // panes' controls for the one frame it would take to remove them again.
  if (!coarsePointer) for (const spec of sidePanesFor('edit')) addSidePane(api, spec);
  creasePattern.api.setActive();
}

function applySimulateLayout(api: DockviewApi, coarsePointer: boolean): void {
  const simulator = addHeaderlessPanel(api, {
    id: 'simulator',
    component: 'simulator',
    title: 'Simulator',
  });
  if (!coarsePointer) for (const spec of sidePanesFor('simulate')) addSidePane(api, spec);
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
  /**
   * The design pane the **phone** layout is showing, and null on every layout
   * that has a dock to answer for itself.
   *
   * Its own field rather than a read of `activePanelId`, and that is the whole
   * of a bug worth not repeating. `activePanelId` is a *cache of what Dockview
   * owns*, and `activateWorkspace` re-reports it on every call — including the
   * no-op path that `activatePanel` takes on the way to a design pane. The
   * Design workspace's one dock panel is `design-workspace`, which is not in
   * `WORKSPACE_BY_PANEL_ID`, so that reconcile answers `primaryPanelIdFor(
   * 'design')` = `design`. On a desktop the design-pane dock corrects it a
   * moment later and nobody notices; with no dock it stuck, so selecting a flap
   * in the BP editor — which activates a panel to move dock focus — threw the
   * user back to the tree editor.
   *
   * Kept here rather than in the workspace store because it is a layout fact,
   * and because `activePanelId` below has to consult it.
   */
  designPaneId: string | null;
  activeWorkspace: WorkspaceId;
  setDockviewApi: (api: DockviewApi | null) => void;
  setDesignPaneApi: (api: DockviewApi | null) => void;
  setDesignPaneId: (panelId: string | null) => void;
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
  designPaneId: null,
  activeWorkspace: 'design',
  setDockviewApi: (api) => set({ dockviewApi: api }),
  setDesignPaneApi: (api) => set({ designPaneApi: api }),
  setDesignPaneId: (panelId) => set({ designPaneId: panelId }),
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
        // need not be the panel set this pointer wants. See `reconcileSidePanes`.
        reconcileSidePanes(dockviewApi, workspace);
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
    // Except where the phone layout is showing a design pane. There is no dock
    // to have caught up, so "primary pane" is not a stale answer that will be
    // corrected — it is a wrong one that sticks, and it would drag the user back
    // to the tree editor on every activation. See `designPaneId`.
    const designPane = get().designPaneId;
    if (designPane && workspaceForPanelId(designPane) === get().activeWorkspace) return designPane;
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
    // A side pane the table lists but the dock does not hold is one a coarse
    // pointer keeps in the drawer instead; ask the drawer to open on it rather
    // than doing nothing.
    if (sidePanesFor(get().activeWorkspace).some((spec) => spec.id === id)) {
      requestSidePane(id);
      return;
    }
    // No dock holds it. On a phone that is the ordinary case for a design pane —
    // the layout mounts one and switches rather than docking them side by side.
    // Everywhere else the validator answers `false` and this is the same nothing
    // the bare `panel?.api.setActive()` used to do.
    if (isDesignPaneOfActiveKind(id)) {
      set({ designPaneId: id });
      reportActivePanel(id);
    }
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
