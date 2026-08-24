import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ANALYTICS_EVENTS, track } from '../analytics';
import { designKind, type DesignKindDescriptor, type DesignPaneSpec } from '../designKinds';
import { useIsPhoneLayout } from '../platform/phoneLayout';
import { registerDesignPaneValidator, useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { activeDesignTab } from '../store/workspaceStore/designTabs';

/** How a pane switch was asked for. An enum property; never free text. */
export type DesignPaneSwitchSource = 'switcher' | 'command';

export interface DesignPaneOption {
  /** The kind's own pane id (`tree`, `packing`, `results`, …). What analytics reports. */
  id: string;
  /** The panel component id, which is also what `activatePanel` is keyed on. */
  component: string;
  title: string;
}

export interface DesignPaneSwitcherState {
  /**
   * The panes to switch between, or `null` where there is nothing to switch:
   * any layout but the phone one, any workspace but Design, and a tab with no
   * kind (the chooser has no panes at all).
   *
   * Non-null is also the test for "this is the phone Design layout", which is
   * what an in-pane back button gates on — see `ExploriResultsPanel`.
   */
  panes: DesignPaneOption[] | null;
  /** The one on screen. Null exactly when `panes` is. */
  active: DesignPaneOption | null;
  /**
   * Whether to offer the floating switcher pill.
   *
   * False for a kind whose panes are a *flow* rather than a split — ExplOri is
   * a search that produces results, so its navigation is a Search button and a
   * Back button inside the panes, and a second floating control saying the same
   * thing is one too many. See `DesignKindDescriptor.phonePaneSwitcher`.
   */
  floating: boolean;
  show: (component: string, source: DesignPaneSwitchSource) => void;
}

function toOption(pane: DesignPaneSpec, t: TFunction): DesignPaneOption {
  return { id: pane.id, component: pane.component, title: pane.title(t) };
}

function primaryPane(kind: DesignKindDescriptor): DesignPaneSpec {
  return kind.panes.find((pane) => pane.placement.kind === 'primary') ?? kind.panes[0];
}

/**
 * The pane a phone shows, given every pane the kind declares.
 *
 * `designPaneId` is the phone layout's own state — not a read of
 * `activePanelId`, which is a cache of what Dockview owns and gets re-reported
 * by `activateWorkspace` on paths that have nothing to do with navigation. What
 * it is *not* guaranteed to be is a pane of *this* kind: switching design tabs
 * leaves the previous tab's pane in it until something re-reports. Falling back
 * to the primary pane is what keeps that from rendering nothing.
 */
export function visibleDesignPane(
  kind: DesignKindDescriptor,
  designPaneId: string | null
): DesignPaneSpec {
  return kind.panes.find((pane) => pane.component === designPaneId) ?? primaryPane(kind);
}

/**
 * One design pane at a time, on a phone.
 *
 * A box-pleat design is a tree editor beside a packing editor, and ExplOri is a
 * tree beside its results. At 440pt that is ~220pt each, which is not a design
 * surface — so the phone layout mounts one pane and reaches the rest through a
 * pill in the canvas lane.
 *
 * `useIsPhoneLayout` and not `useIsCoarsePointerSurface`: a tablet has the width
 * for the split and keeps it. That is the same line the CP tool picker draws.
 *
 * Shared by the pill and by the layout that renders the pane, because they are
 * one question — *which pane is on screen* — and two copies of the fallback
 * above would be two answers to it.
 */
export function useDesignPaneSwitcher(): DesignPaneSwitcherState {
  const { t } = useTranslation();
  const phoneLayout = useIsPhoneLayout();
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const designPaneId = useLayoutStore((state) => state.designPaneId);
  const setDesignPaneId = useLayoutStore((state) => state.setDesignPaneId);
  const tab = useWorkspaceStore(activeDesignTab);
  const setActivePanelId = useWorkspaceStore((state) => state.setActivePanelId);

  const kind = tab.kind === null ? null : (designKind(tab.kind) ?? null);
  const available = phoneLayout && activeWorkspace === 'design' && kind !== null;

  const show = useCallback(
    (component: string, source: DesignPaneSwitchSource) => {
      const pane = kind?.panes.find((candidate) => candidate.component === component);
      if (!pane) return;
      setDesignPaneId(component);
      // Reported as well as stored: `activePanelId` is what drives
      // `activeEditingContext`, and therefore the menus, the undo stack and the
      // shortcut scope.
      setActivePanelId(component);
      // `pane.id` and not the component: the id is the kind's own vocabulary
      // (`tree`, `packing`, `results`) and stays stable if a panel component is
      // ever renamed, which is what an analytics enum needs.
      track(ANALYTICS_EVENTS.designPaneSwitched, { pane: pane.id, source });
    },
    [kind, setActivePanelId, setDesignPaneId]
  );

  const panes = useMemo(
    () => (available && kind ? kind.panes.map((pane) => toOption(pane, t)) : null),
    [available, kind, t]
  );

  return {
    panes,
    active: available && kind ? toOption(visibleDesignPane(kind, designPaneId), t) : null,
    floating: kind?.phonePaneSwitcher !== false,
    show,
  };
}

/**
 * Own the phone layout's pane selection while mounted.
 *
 * Two halves of one job. It seeds `designPaneId` with the pane actually being
 * rendered — so `activePanelId()` has something better than the workspace
 * default to answer with — and it lends the layout store a way to ask whether an
 * id belongs to this design, so `activatePanel` can move the visible pane
 * without the store learning what a design kind is.
 *
 * Clearing on unmount matters: a stale `designPaneId` left behind by a rotation
 * into the tablet layout would make `activePanelId()` answer with a pane that is
 * no longer how this device shows anything.
 */
export function useOwnDesignPane(
  panes: DesignPaneOption[] | null,
  visibleComponent: string
): void {
  const setDesignPaneId = useLayoutStore((state) => state.setDesignPaneId);

  useEffect(() => {
    setDesignPaneId(visibleComponent);
    return () => setDesignPaneId(null);
  }, [setDesignPaneId, visibleComponent]);

  useEffect(() => {
    if (!panes) return undefined;
    return registerDesignPaneValidator((panelId) =>
      panes.some((pane) => pane.component === panelId)
    );
  }, [panes]);
}
