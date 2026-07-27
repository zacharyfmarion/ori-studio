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
    return registerSimulatorShortcutExecutor((id: SimulatorShortcutId) => {
      const handlers = handlersRef.current;
      switch (id) {
        case 'simulator.playPause':
          return handlers.playPause();
        case 'simulator.foldForward':
          return handlers.nudgeFold(stepRef.current);
        case 'simulator.foldBackward':
          return handlers.nudgeFold(-stepRef.current);
        case 'simulator.foldEnd':
          return handlers.setFoldPercent(100);
        case 'simulator.foldStart':
          return handlers.setFoldPercent(0);
        case 'simulator.replay':
          return handlers.replay();
        case 'simulator.resetView':
          return handlers.resetView();
        case 'simulator.zoomIn':
          return handlers.zoomBy(ZOOM_STEP);
        case 'simulator.zoomOut':
          return handlers.zoomBy(1 / ZOOM_STEP);
        case 'simulator.toggleFaces':
          return handlers.toggleSetting?.('showFaces');
        case 'simulator.toggleCreases':
          return handlers.toggleSetting?.('showEdges');
        case 'simulator.toggleHiddenLines':
          return handlers.toggleSetting?.('showHiddenLines');
        case 'simulator.toggleLighting':
          return handlers.toggleSetting?.('lighting');
      }
    });
  }, [active]);
}
