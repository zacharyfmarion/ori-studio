import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ANALYTICS_EVENTS, track } from '../analytics';
import { designKind, type DesignKindDescriptor, type DesignPaneSpec } from '../designKinds';
import { useIsPhoneLayout } from '../platform/phoneLayout';
import { registerDesignPaneSelector, useLayoutStore } from '../store/layoutStore';
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
   */
  panes: DesignPaneOption[] | null;
  /** The one on screen. Null exactly when `panes` is. */
  active: DesignPaneOption | null;
  show: (component: string, source: DesignPaneSwitchSource) => void;
}

function toOption(pane: DesignPaneSpec, t: TFunction): DesignPaneOption {
  return { id: pane.id, component: pane.component, title: pane.title(t) };
}

/**
 * The pane a phone shows, given every pane the kind declares.
 *
 * `activePanelId` is the app-wide "which pane has focus", written by the dock on
 * a desktop and by this switcher on a phone — so it is already the right source
 * of truth and the phone layout needs no second one. What it is *not* is
 * guaranteed to name a pane of this kind: switching design tabs leaves the
 * previous tab's pane in it until something re-reports, and a kind that changes
 * in place (the chooser resolving) can invalidate it outright. Falling back to
 * the primary pane is what keeps that from rendering nothing.
 */
export function visibleDesignPane(
  kind: DesignKindDescriptor,
  activePanelId: string | null
): DesignPaneSpec {
  const named = kind.panes.find((pane) => pane.component === activePanelId);
  if (named) return named;
  return kind.panes.find((pane) => pane.placement.kind === 'primary') ?? kind.panes[0];
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
  const tab = useWorkspaceStore(activeDesignTab);
  const activePanelId = useWorkspaceStore((state) => state.activePanelId);
  const setActivePanelId = useWorkspaceStore((state) => state.setActivePanelId);

  const kind = tab.kind === null ? null : (designKind(tab.kind) ?? null);
  const available = phoneLayout && activeWorkspace === 'design' && kind !== null;

  const show = useCallback(
    (component: string, source: DesignPaneSwitchSource) => {
      const pane = kind?.panes.find((candidate) => candidate.component === component);
      if (!pane) return;
      setActivePanelId(component);
      // `pane.id` and not the component: the id is the kind's own vocabulary
      // (`tree`, `packing`, `results`) and stays stable if a panel component is
      // ever renamed, which is what an analytics enum needs.
      track(ANALYTICS_EVENTS.designPaneSwitched, { pane: pane.id, source });
    },
    [kind, setActivePanelId]
  );

  const panes = useMemo(
    () => (available && kind ? kind.panes.map((pane) => toOption(pane, t)) : null),
    [available, kind, t]
  );

  return {
    panes,
    active: available && kind ? toOption(visibleDesignPane(kind, activePanelId), t) : null,
    show,
  };
}

/**
 * Let `activatePanel` reach a pane that is not docked.
 *
 * Registered by whoever is rendering the phone panes, so the layout store never
 * has to know which panes a kind declares — it asks, and an id this design does
 * not own is declined. See `registerDesignPaneSelector`.
 */
export function useDesignPaneSelectorSeam(
  show: DesignPaneSwitcherState['show'],
  panes: DesignPaneOption[] | null
): void {
  useEffect(() => {
    if (!panes) return undefined;
    return registerDesignPaneSelector((panelId) => {
      if (!panes.some((pane) => pane.component === panelId)) return false;
      show(panelId, 'command');
      return true;
    });
  }, [panes, show]);
}
