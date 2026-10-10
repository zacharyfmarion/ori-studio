import type { IDockviewPanel } from 'dockview';
import { runAfterPointerGesture } from '../lib/pointerGesture';
import { isCoarsePointerSurface } from '../platform/pointerSurface';
import { useLayoutStore } from './layoutStore';

/**
 * A side pane that shows what is selected, brought forward by a selection and
 * giving its tab back when the selection is released: Edit's Properties (the
 * selected canvas object) and the Diagram's Layers (the selected annotation).
 * One rule for both, so the two cannot drift.
 */
export interface SelectionPaneReveal {
  /**
   * Bring the pane forward, if it is docked and not already showing.
   *
   * `setActive()` moves no DOM focus (verified against dockview 4.13), so the
   * only guard is the gesture deferral: activating a dock panel reflows its
   * group, and doing that inside the click or drag that made the selection
   * drops the rest of the gesture. Under a coarse pointer the pane is in the
   * drawer, which never opens on a tap-select (it is modal); nothing to do.
   *
   * A tab the user already had on top is left alone, and is then theirs: the
   * release that follows leaves it too. A tab this reveal displaced is
   * remembered for {@link SelectionPaneReveal.restore}.
   */
  reveal(): void;
  /**
   * Put back the tab {@link SelectionPaneReveal.reveal} displaced, once
   * nothing is selected and the pane would show its empty line. Only while the
   * reveal is still the reason the pane is on top — the same panel, still
   * showing, its group's tab untouched since — and only if the displaced tab
   * is still docked. Deferred like the reveal: a deselect is a press on empty
   * canvas.
   */
  restore(): void;
  /** Forget a reveal: tests only. */
  reset(): void;
}

/**
 * A reveal made, and what it displaced: the tab that was on top of the pane's
 * group. Held until the selection is released, when that tab comes back — or
 * until the user changes that group's tab themselves, after which their choice
 * stands and a release flips nothing.
 */
interface AutoReveal {
  /** The panel as activated; a rebuilt dock hands out a different object. */
  panel: IDockviewPanel;
  displaced: string;
  dispose: () => void;
}

/** The reveal rule for the pane `paneId`, whose subject is selected while `selected()` says so. */
export function selectionPaneReveal(paneId: string, selected: () => boolean): SelectionPaneReveal {
  let autoReveal: AutoReveal | null = null;
  const disarm = () => {
    autoReveal?.dispose();
    autoReveal = null;
  };
  const pane = () => useLayoutStore.getState().dockviewApi?.getPanel(paneId) ?? null;

  return {
    reveal() {
      if (isCoarsePointerSurface()) return;
      const docked = pane();
      if (!docked || docked.api.isVisible) return;
      runAfterPointerGesture(() => {
        // Re-resolved: the gesture may have outlived the selection, or the dock.
        const panel = pane();
        if (!panel || panel.api.isVisible) return;
        if (!selected()) return;
        const displaced = panel.group.activePanel?.id ?? null;
        disarm();
        useLayoutStore.getState().activatePanel(paneId);
        if (displaced === null || displaced === paneId) return;
        // Subscribed after the activation, whose own change has already fired:
        // the next change of this group's tab is the user's, and ends the reveal.
        const subscription = panel.group.api.onDidActivePanelChange(disarm);
        autoReveal = { panel, displaced, dispose: () => subscription.dispose() };
      });
    },
    restore() {
      const armed = autoReveal;
      if (!armed) return;
      disarm();
      runAfterPointerGesture(() => {
        if (selected()) return;
        const api = useLayoutStore.getState().dockviewApi;
        const panel = api?.getPanel(paneId);
        if (!panel || panel !== armed.panel || !panel.api.isVisible) return;
        if (!api?.getPanel(armed.displaced)) return;
        useLayoutStore.getState().activatePanel(armed.displaced);
      });
    },
    reset: disarm,
  };
}
