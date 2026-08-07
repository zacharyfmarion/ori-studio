import { DockviewReact, type DockviewApi, type SerializedDockview } from 'dockview';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { designKind, type DesignKindDescriptor, type DesignPaneSpec } from '../../designKinds';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { activeDesignTab } from '../../store/workspaceStore/designTabs';
import { DesignMethodChooser } from './DesignMethodChooser';
import { FixedDockTab } from './FixedDockTab';
import { panelComponents } from './PanelComponents';

/**
 * The panes of one design, inside one design tab.
 *
 * These panes used to live in the *workspace* dock beside Edit's and Simulate's,
 * which worked while one design could be open and stops working the moment two
 * can: the workspace layout would have to be torn down and rebuilt on every tab
 * switch, and "which layout is mounted" had to be inferred from which panels
 * happened to exist. A design's panes belong to the design.
 *
 * A nested dock rather than the plan's `GridviewReact`. Gridview gives resizable
 * panes and serialization, which is what the plan wanted it for, but it has no
 * concept of a tab group — and Inspector / Diagnostics / Conditions are one
 * tabbed column today. Under Gridview they would become three stacked rows, so
 * the library that already does this is the cheaper answer.
 *
 * Mounted for the active tab only, and keyed by it, so a switch is an unmount
 * rather than a reconciliation: two designs never share a dock, a canvas, or a
 * pane's scroll position.
 */
export function DesignPaneLayout() {
  const { t } = useTranslation();
  const tab = useWorkspaceStore(activeDesignTab);
  const setActivePanelId = useWorkspaceStore((state) => state.setActivePanelId);
  const setDesignPaneLayout = useWorkspaceStore((state) => state.setDesignPaneLayout);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Registered so `activatePanel('conditions')` and friends still find a design
  // pane now that it lives here rather than in the workspace dock. Cleared on
  // unmount, so a stale api can never be asked to activate a dead panel — and
  // the pending save with it, since dockview disposes the api it would call.
  useEffect(
    () => () => {
      useLayoutStore.getState().setDesignPaneApi(null);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const kind = tab.kind === null ? null : (designKind(tab.kind) ?? null);
  const savedLayout = tab.paneLayout;

  const onReady = useCallback(
    ({ api }: { api: DockviewApi }) => {
      if (!kind) return;
      useLayoutStore.getState().setDesignPaneApi(api);
      if (!restoreLayout(api, kind, savedLayout)) buildLayout(api, kind, t);

      api.onDidActivePanelChange((panel) => {
        // The same signal the workspace dock used to provide. Keeping the panel
        // ids app-scoped (`design`, `inspector`, `bp-editor`, …) rather than
        // tab-scoped is what lets `resolveEditingContext` stay untouched.
        if (panel) setActivePanelId(panel.id);
      });

      api.onDidLayoutChange(() => {
        // Debounced, like the workspace dock's own save: a drag emits a change
        // per animation frame, and each one would mark the project dirty.
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => setDesignPaneLayout(tab.id, api.toJSON()), 250);
      });
    },
    // `savedLayout` is deliberately absent: it is the *initial* layout, read once
    // per mount. Re-running on every save would restore over the user's drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, setActivePanelId, setDesignPaneLayout, t, tab.id]
  );

  // A tab that has not chosen a kind has no panes to lay out — its kind is what
  // declares them. The chooser is the design workspace's state *before* a kind
  // exists, so it belongs to the host rather than to any kind's pane list.
  if (!kind) return <DesignMethodChooser />;

  return (
    <DockviewReact
      // Keyed by the design **and its kind**. The pane set is chosen once, in
      // `onReady`, from the kind — so a tab that changes kind in place (the
      // chooser resolving, a file loading into an open tab) would otherwise keep
      // the previous kind's panes: a box-pleat design with no BP Editor.
      key={`${tab.id}:${tab.kind}`}
      components={panelComponents}
      defaultTabComponent={FixedDockTab}
      onReady={onReady}
      className="dockview-theme-treemaker design-pane-layout"
      // A pane dragged out of here would land in the *workspace* dock, beside
      // Edit and Simulate, orphaned from the design that owns it. Resizing —
      // the thing this nesting exists for — does not go through drag-and-drop.
      disableDnd
      disableFloatingGroups
    />
  );
}

/**
 * Rebuild a saved layout, or report that it cannot be used.
 *
 * A layout is only restorable if it names exactly the panes the kind declares
 * today. Anything else — a file written before a pane was added, a design whose
 * kind gained or lost one — restores a dock with a missing or unknown panel,
 * which dockview renders as an empty group rather than an error.
 */
export function restoreLayout(
  api: DockviewApi,
  kind: DesignKindDescriptor,
  saved: SerializedDockview | null
): boolean {
  if (!saved) return false;
  const expected = new Set(kind.panes.map((pane) => pane.component));
  const found = Object.keys(saved.panels ?? {});
  if (found.length !== expected.size || !found.every((id) => expected.has(id))) return false;
  try {
    api.fromJSON(saved);
    return true;
  } catch (error) {
    console.error('[ori-studio] could not restore the design pane layout', error);
    api.clear();
    return false;
  }
}

/** The kind's declared default arrangement. */
export function buildLayout(api: DockviewApi, kind: DesignKindDescriptor, t: TFunction): void {
  const primary = kind.panes.find((pane) => pane.placement.kind === 'primary');
  if (!primary) {
    console.error(`[ori-studio] design kind "${kind.id}" declares no primary pane`);
    return;
  }

  // No tab headers on a design's canvases, split or not.
  //
  // The earlier rule gave the primary a header whenever it had a peer canvas, on
  // the reasoning that two side by side need naming. In use they do not — which
  // pane is the tree and which the results is obvious from what is drawn in
  // them — and the header only costs vertical space and reads as a tab that
  // could be closed or dragged, neither of which it can be. The sash between
  // them is what was actually wanted, and that belongs to the group boundary
  // rather than to the header.
  const group = api.addGroup({ direction: 'right', hideHeader: true });
  api.addPanel({
    id: primary.component,
    component: primary.component,
    title: primary.title(t),
    position: { referenceGroup: group },
  });

  // Grouped side panes are added against the first of their group, so a group's
  // members become tabs of one column rather than columns of their own.
  const sideGroupLead = new Map<string, string>();
  for (const pane of kind.panes) {
    if (pane === primary) continue;
    addSecondaryPane(api, pane, primary.component, sideGroupLead, t);
  }
  api.getPanel(primary.component)?.api.setActive();
}

function addSecondaryPane(
  api: DockviewApi,
  pane: DesignPaneSpec,
  primaryId: string,
  sideGroupLead: Map<string, string>,
  t: TFunction
): void {
  const base = { id: pane.component, component: pane.component, title: pane.title(t) };

  if (pane.placement.kind === 'split') {
    // Its own header-hidden group, so the sash survives but the tab strip does
    // not — `hideHeader` is a property of the group, not of the panel.
    const group = api.addGroup({
      direction: 'right',
      referenceGroup: api.getPanel(primaryId)?.group,
      hideHeader: true,
    });
    api.addPanel({ ...base, position: { referenceGroup: group } });
    return;
  }
  if (pane.placement.kind !== 'side') return;

  const lead = sideGroupLead.get(pane.placement.group);
  if (lead === undefined) {
    sideGroupLead.set(pane.placement.group, pane.component);
    api.addPanel({
      ...base,
      position: { referencePanel: primaryId, direction: 'right' },
      ...(pane.placement.initialWidth ? { initialWidth: pane.placement.initialWidth } : {}),
    });
    return;
  }
  const leadGroup = api.getPanel(lead)?.group;
  if (!leadGroup) return;
  api.addPanel({
    ...base,
    position: { referenceGroup: leadGroup.id },
    inactive: pane.placement.inactive ?? false,
  });
}
