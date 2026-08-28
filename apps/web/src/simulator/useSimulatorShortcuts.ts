import { useEffect, useRef } from 'react';
import { registerSimulatorShortcutExecutor } from '../keyboard/shortcutRuntime';
import type { SimulatorShortcutId } from '../keyboard/shortcuts';

/**
 * Bind the simulator keymap while a simulation owns the keyboard.
 *
 * These bindings used to be a bare `window` keydown listener in the Simulate
 * panel. That was justified by the panel only ever mounting in its own
 * workspace, so nothing else could be listening — an assumption inline
 * simulation windows on the Edit canvas break outright. There, Space is
 * space-to-pan and F, C, R and L are Fold, a colour convert, Mirror Line and the
 * Line tool.
 *
 * Registering with the dispatcher instead pushes a `simulator` scope ahead of
 * `crease-pattern` for exactly as long as `active` holds, so the same chord
 * reaches the simulation while it is in hand and the CP tools the rest of the
 * time. It also means these finally honour the user's shortcut overrides, which
 * the ad-hoc listener bypassed.
 */
export interface SimulatorShortcutHandlers {
  playPause: () => void;
  /** Scrub the fold by a signed percentage. */
  nudgeFold: (deltaPercent: number) => void;
  setFoldPercent: (percent: number) => void;
  replay: () => void;
  resetView: () => void;
  zoomBy: (factor: number) => void;
  /** Toggle a render setting. Optional: an inline window has no options pane. */
  toggleSetting?: (key: 'showFaces' | 'showEdges' | 'showHiddenLines' | 'lighting') => void;
}

/** Zoom step, matching the wheel's feel. */
const ZOOM_STEP = 1.1;

/**
 * Run one simulator verb.
 *
 * Extracted from the executor below so the context menu can dispatch through the
 * *same* switch rather than re-deriving which handler each id means. Two copies
 * of this mapping is how a menu row and its own key binding end up doing
 * different things — and the ids are the only names these verbs have, so there
 * would be nothing to catch it.
 */
export function runSimulatorShortcut(
  id: SimulatorShortcutId,
  handlers: SimulatorShortcutHandlers,
  foldStepPercent: number
): void {
  switch (id) {
    case 'simulator.playPause':
      handlers.playPause();
      return;
    case 'simulator.foldForward':
      handlers.nudgeFold(foldStepPercent);
      return;
    case 'simulator.foldBackward':
      handlers.nudgeFold(-foldStepPercent);
      return;
    case 'simulator.foldEnd':
      handlers.setFoldPercent(100);
      return;
    case 'simulator.foldStart':
      handlers.setFoldPercent(0);
      return;
    case 'simulator.replay':
      handlers.replay();
      return;
    case 'simulator.resetView':
      handlers.resetView();
      return;
    case 'simulator.zoomIn':
      handlers.zoomBy(ZOOM_STEP);
      return;
    case 'simulator.zoomOut':
      handlers.zoomBy(1 / ZOOM_STEP);
      return;
    case 'simulator.toggleFaces':
      handlers.toggleSetting?.('showFaces');
      return;
    case 'simulator.toggleCreases':
      handlers.toggleSetting?.('showEdges');
      return;
    case 'simulator.toggleHiddenLines':
      handlers.toggleSetting?.('showHiddenLines');
      return;
    case 'simulator.toggleLighting':
      handlers.toggleSetting?.('lighting');
      return;
  }
}

export function useSimulatorShortcuts(options: {
  /** Whether this simulation currently owns the keyboard. */
  active: boolean;
  /** Fold percentage per arrow press. */
  foldStepPercent: number;
  handlers: SimulatorShortcutHandlers;
}): void {
  const { active, foldStepPercent } = options;
  // Held in a ref so the registration is not torn down and rebuilt whenever the
  // caller passes fresh closures, which is every render.
  const handlersRef = useRef(options.handlers);
  useEffect(() => {
    handlersRef.current = options.handlers;
  });
  const stepRef = useRef(foldStepPercent);
  useEffect(() => {
    stepRef.current = foldStepPercent;
  }, [foldStepPercent]);

  useEffect(() => {
    if (!active) return;
    return registerSimulatorShortcutExecutor((id: SimulatorShortcutId) =>
      runSimulatorShortcut(id, handlersRef.current, stepRef.current)
    );
  }, [active]);
}
