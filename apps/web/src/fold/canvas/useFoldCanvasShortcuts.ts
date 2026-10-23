import { useEffect, useRef } from 'react';
import { focusOwnsArrowKeys } from '../../keyboard/arrowKeyOwners';
import type { FoldShortcutId, ViewportShortcutId } from '../../keyboard/shortcuts';
import { registerFoldCancel, registerFoldKeyHandler, registerFoldViewCamera } from '../sequence/foldKeys';
import { focusInFoldLayerPick } from '../sequence/foldLayerPickFocus';
import {
  FOLD_LINE_MODE_SHORTCUTS,
  FOLD_MODEL_TURNS,
  FOLD_TOOL_SHORTCUTS,
  type FoldLineModeId,
  type FoldToolId,
} from '../tools/foldToolCatalog';
import { foldCanvasVerbs } from './foldCanvasCommands';

/** Marks a pane of the Fold canvas: where Enter belongs to the canvas, which commits. */
export const FOLD_PANE_ATTRIBUTE = 'data-fold-pane';

/**
 * Whether Enter at this focus is the canvas's: focus on nothing, on a pane
 * (a press focuses it), or in the layer controls, the step before Enter.
 * Anything else that holds focus — a button, a tab, a field — keeps its own
 * Enter, as the Diagram's steps leave it.
 */
export function focusLeavesEnterToFold(element: Element | null): boolean {
  if (element === null || element === element.ownerDocument.body) return true;
  return element.closest(`[${FOLD_PANE_ATTRIBUTE}]`) !== null || focusInFoldLayerPick(element);
}

const TOOL_BY_SHORTCUT = new Map<FoldShortcutId, FoldToolId>(
  (Object.entries(FOLD_TOOL_SHORTCUTS) as [FoldToolId, FoldShortcutId][]).map(([tool, id]) => [id, tool])
);
const LINE_MODE_BY_SHORTCUT = new Map<FoldShortcutId, FoldLineModeId>(
  (Object.entries(FOLD_LINE_MODE_SHORTCUTS) as [FoldLineModeId, FoldShortcutId][]).map(([mode, id]) => [id, mode])
);

/**
 * The canvas's tool keys (D14 Keyboard): what each claims, or declines. Pure
 * over the verbs and the focus, so the whole table is testable without a
 * canvas.
 */
export function runFoldCanvasShortcut(id: FoldShortcutId, focus: Element | null): boolean {
  const verbs = foldCanvasVerbs();
  if (!verbs) return false;
  const tool = TOOL_BY_SHORTCUT.get(id);
  if (tool !== undefined) {
    verbs.selectTool(tool);
    return true;
  }
  const mode = LINE_MODE_BY_SHORTCUT.get(id);
  if (mode !== undefined) {
    verbs.selectLineMode(mode);
    return true;
  }
  switch (id) {
    // Rotate is a tool: R takes it in hand through the tools' table above.
    case 'fold.turnOver':
      verbs.turn(FOLD_MODEL_TURNS['turn-over']);
      return true;
    case 'fold.swapSide':
      // Nothing located, no side to swap: S falls through.
      return verbs.swapSide();
    case 'fold.cycleExtent':
      // No Precrease tool in hand, no extent to change: E falls through.
      return verbs.cycleExtent();
    case 'fold.previousCandidate':
    case 'fold.nextCandidate':
      // A control that moves with the arrows keeps them; with one candidate or none, the step keys may have them.
      if (focusOwnsArrowKeys(focus)) return false;
      return verbs.stepChoice(id === 'fold.nextCandidate' ? 1 : -1);
    case 'fold.commit':
      if (!focusLeavesEnterToFold(focus)) return false;
      // In the layer controls Enter is the fold's even while there is none
      // to commit (still landing, or refused): let through, a chip's own
      // Enter would press it and put its flap back.
      return verbs.commit() || focusInFoldLayerPick(focus);
    default:
      // Another Fold surface's key: its own handler answers it.
      return false;
  }
}

/** The camera verbs of the canvas's panes, which the viewport's zoom keys drive. */
export interface FoldCanvasCamera {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actualSize: () => void;
}

/**
 * Bind the Fold canvas's keys while it is mounted, focus-independently
 * (AGENTS.md › Panel components), through the Fold panel's one executor for
 * the `fold` scope and viewport surface (`fold/sequence/foldKeys`): its tool
 * rows as a key handler, the tool's picks as a rung of Escape's cancel
 * ladder, and the panes' cameras for the zoom keys. The panel claims the
 * viewport surface, on mount and on every press inside it.
 */
export function useFoldCanvasShortcuts(camera: FoldCanvasCamera): void {
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  });

  useEffect(() => {
    const offKeys = registerFoldKeyHandler((id) => runFoldCanvasShortcut(id, document.activeElement));
    const offCancel = registerFoldCancel(() => foldCanvasVerbs()?.cancel() ?? false);
    const offCamera = registerFoldViewCamera((id: ViewportShortcutId) => {
      switch (id) {
        case 'viewport.zoomIn':
          cameraRef.current.zoomIn();
          return true;
        case 'viewport.zoomOut':
          cameraRef.current.zoomOut();
          return true;
        case 'viewport.fit':
          cameraRef.current.fit();
          return true;
        case 'viewport.actualSize':
          cameraRef.current.actualSize();
          return true;
        default:
          return false;
      }
    });
    return () => {
      offKeys();
      offCancel();
      offCamera();
    };
  }, []);
}
