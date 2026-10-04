import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  hasSimulatorExecutor,
  registerSimulatorShortcutExecutor,
  subscribeSimulatorExecutor,
} from '../keyboard/shortcutRuntime';
import type { SimulatorShortcutId } from '../keyboard/shortcuts';
import type { SimulatorToolId } from './tools/types';

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
  /** Back to the beginning of the fold — paper flat, solver at rest — with the camera left alone. */
  rewind: () => void;
  /** Start over: {@link rewind}, and the view back to its opening transform. */
  restart: () => void;
  resetView: () => void;
  zoomBy: (factor: number) => void;
  /** Toggle a render setting. Optional: an inline window has no options pane. */
  toggleSetting?: (key: 'showFaces' | 'showEdges' | 'lighting') => void;
  /**
   * Open the export dialog on the view, and take the direction now pointing up
   * as the model's up. Optional, and only the Simulate workspace answers them:
   * they are its rail's buttons, and an inline window keeps its own on its
   * toolbar.
   */
  exportView?: () => void;
  setUpright?: () => void;
  /**
   * The tool verbs. Optional, and only the Simulate workspace answers them: an
   * inline window on the Edit canvas has no tools, and declines their chords so
   * that O, P and Escape reach the canvas beneath it.
   */
  tools?: SimulatorToolShortcutHandlers;
}

/** Where a verb was asked for, for the analytics of the verbs that report it. */
export type SimulatorVerbSource = 'shortcut' | 'context-menu';

export interface SimulatorToolShortcutHandlers {
  selectTool: (tool: SimulatorToolId, source: SimulatorVerbSource) => void;
  /**
   * Escape: cancel a gesture in flight, else leave the tool for Orbit. Answers
   * whether it did either; `false` hands Escape on to the next scope.
   */
  exitTool: () => boolean;
  clearPins: (source: SimulatorVerbSource) => void;
  togglePinThroughLayers: (source: SimulatorVerbSource) => void;
}

/** Zoom step, matching the wheel's feel. */
const ZOOM_STEP = 1.1;

/**
 * Run one simulator verb, and say whether this surface took it.
 *
 * Extracted from the executor below so the context menu can dispatch through the
 * *same* switch rather than re-deriving which handler each id means. Two copies
 * of this mapping is how a menu row and its own key binding end up doing
 * different things — and the ids are the only names these verbs have, so there
 * would be nothing to catch it.
 *
 * `false` declines the chord, and the dispatcher hands it to the next scope.
 * Only the tool verbs ever decline. The rest claim even on a surface that has
 * no handler for them — F on an inline window toggles nothing, and still must
 * not reach the Fold tool beneath it — which is how they behaved before there
 * was a way to decline.
 */
export function runSimulatorShortcut(
  id: SimulatorShortcutId,
  handlers: SimulatorShortcutHandlers,
  foldStepPercent: number,
  source: SimulatorVerbSource = 'shortcut'
): boolean {
  switch (id) {
    case 'simulator.playPause':
      handlers.playPause();
      return true;
    case 'simulator.foldForward':
      handlers.nudgeFold(foldStepPercent);
      return true;
    case 'simulator.foldBackward':
      handlers.nudgeFold(-foldStepPercent);
      return true;
    case 'simulator.foldEnd':
      handlers.setFoldPercent(100);
      return true;
    case 'simulator.foldStart':
      // A rewind rather than a settle to 0: "the beginning" is flat paper at
      // rest, not wherever relaxing back from the current fold happens to stop.
      handlers.rewind();
      return true;
    case 'simulator.replay':
      handlers.restart();
      return true;
    case 'simulator.resetView':
      handlers.resetView();
      return true;
    case 'simulator.zoomIn':
      handlers.zoomBy(ZOOM_STEP);
      return true;
    case 'simulator.zoomOut':
      handlers.zoomBy(1 / ZOOM_STEP);
      return true;
    case 'simulator.toggleFaces':
      handlers.toggleSetting?.('showFaces');
      return true;
    case 'simulator.toggleCreases':
      handlers.toggleSetting?.('showEdges');
      return true;
    case 'simulator.toggleLighting':
      handlers.toggleSetting?.('lighting');
      return true;
    case 'simulator.exportView':
      handlers.exportView?.();
      return true;
    case 'simulator.setUpright':
      handlers.setUpright?.();
      return true;
    case 'simulator.tool.orbit':
      if (!handlers.tools) return false;
      handlers.tools.selectTool('orbit', source);
      return true;
    case 'simulator.tool.pin':
      if (!handlers.tools) return false;
      handlers.tools.selectTool('pin', source);
      return true;
    case 'simulator.tool.exit':
      return handlers.tools?.exitTool() ?? false;
    case 'simulator.pins.clear':
      if (!handlers.tools) return false;
      handlers.tools.clearPins(source);
      return true;
    case 'simulator.pins.throughLayers':
      if (!handlers.tools) return false;
      handlers.tools.togglePinThroughLayers(source);
      return true;
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

/**
 * Whether a simulation is in hand — ready, and holding the keyboard — so a
 * control outside its view, the Simulate rail, knows its verbs will land.
 */
export function useSimulationInHand(): boolean {
  return useSyncExternalStore(subscribeSimulatorExecutor, hasSimulatorExecutor);
}
