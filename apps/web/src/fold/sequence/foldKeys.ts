import { foldCanvasVerbs } from '../canvas/foldCanvasCommands';
import { useCallback, useEffect } from 'react';
import { handleMenuAction, type MenuActionId } from '../../commands/menuActions';
import { focusOwnsArrowKeys } from '../../keyboard/arrowKeyOwners';
import {
  registerConditionalScopeExecutor,
  registerViewportShortcutExecutor,
  releaseShortcutViewportSurface,
  setActiveShortcutViewportSurface,
} from '../../keyboard/shortcutRuntime';
import type { FoldShortcutId, ViewportShortcutId } from '../../keyboard/shortcuts';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { currentFoldPath } from './foldCommands';
import { foldPathMoves, type FoldPathMoves } from './foldSequencePath';

/**
 * The Fold workspace's keys, through the shortcut registry (AGENTS.md › Panel
 * components: never a `keydown` listener on the panel).
 *
 * - **One executor for the `fold` scope**, the panel's, which hands each id
 *   to the surfaces that answer Fold's keys — the step moves and the
 *   sequence verbs' keys here ({@link FOLD_MENU_KEYS}), the tools with their
 *   own handler ({@link registerFoldKeyHandler}).
 *   A scope has one executor, so surfaces that each registered their own
 *   would take the keyboard from one another.
 * - **The `fold` viewport surface**, the Diagram's route: Escape runs one
 *   cancel ladder — whatever a surface has armed, newest first
 *   ({@link registerFoldCancel}), then the step being folded — and the zoom
 *   and fit keys go to the camera of the view on screen
 *   ({@link registerFoldViewCamera}).
 */

/** Answers a Fold key: true claims it, false lets the next handler, then the next scope, have it. */
export type FoldKeyHandler = (id: FoldShortcutId) => boolean;

const handlers: FoldKeyHandler[] = [];

/** Answer Fold keys while mounted; returns the release. The newest handler is asked first. */
export function registerFoldKeyHandler(handler: FoldKeyHandler): () => void {
  handlers.push(handler);
  return () => {
    const at = handlers.lastIndexOf(handler);
    if (at >= 0) handlers.splice(at, 1);
  };
}

/** Run a Fold key through its handlers, as the scope's executor does. */
export function runFoldKey(id: FoldShortcutId): boolean {
  // A required order decision owns left/right before timeline handlers,
  // regardless of parent/child effect registration order.
  if ((id === 'fold.previousStep' || id === 'fold.nextStep') && !focusOwnsArrowKeys(document.activeElement)) {
    const canvas = foldCanvasVerbs();
    if (canvas?.choosingOrder?.()) return canvas.stepChoice(id === 'fold.nextStep' ? 1 : -1);
  }
  for (let at = handlers.length - 1; at >= 0; at -= 1) if (handlers[at]!(id)) return true;
  return false;
}

const cancels: (() => boolean)[] = [];

/** A rung of Escape's ladder: put down what it has armed and say so, or say there was nothing. Returns its release. */
export function registerFoldCancel(cancel: () => boolean): () => void {
  cancels.push(cancel);
  return () => {
    const at = cancels.lastIndexOf(cancel);
    if (at >= 0) cancels.splice(at, 1);
  };
}

/** Escape in Fold: the rungs, newest first, then the step a tool is folding. Whether it put anything down. */
export function runFoldCancel(): boolean {
  for (let at = cancels.length - 1; at >= 0; at -= 1) if (cancels[at]!()) return true;
  const session = foldSession();
  const { pending, analysis } = session.store.getState();
  if (pending.status === 'idle' && analysis.status === 'idle') return false;
  session.cancel();
  return true;
}

let viewCamera: ((id: ViewportShortcutId) => boolean) | null = null;

/** Hand Fold's viewport keys the camera of the view on screen; returns its release. */
export function registerFoldViewCamera(camera: (id: ViewportShortcutId) => boolean): () => void {
  viewCamera = camera;
  return () => {
    if (viewCamera === camera) viewCamera = null;
  };
}

/** The move each step key makes. */
const STEP_MOVES: Partial<Record<FoldShortcutId, keyof FoldPathMoves>> = {
  'fold.previousStep': 'previous',
  'fold.nextStep': 'next',
  'fold.previousBranch': 'previousBranch',
  'fold.nextBranch': 'nextBranch',
};

/**
 * Move the reader along the path or between the branches at the step on
 * screen. False where there is nowhere to go — the sheet, the tip, the last
 * branch — so the key falls through rather than doing nothing.
 */
export function moveFoldReader(move: keyof FoldPathMoves): boolean {
  const { entries, cursor } = currentFoldPath();
  const target = foldPathMoves(entries, cursor)[move];
  if (target === undefined) return false;
  useWorkspaceStore.getState().moveFoldCursor(target);
  return true;
}

/** The step moves: declined while a focused control keeps the arrows, as the Diagram's are. */
const stepKeys: FoldKeyHandler = (id) => {
  const move = STEP_MOVES[id];
  if (!move || focusOwnsArrowKeys(document.activeElement)) return false;
  return moveFoldReader(move);
};

/**
 * The sequence verbs a key runs as their menu rows do, through the
 * chokepoint (`handleMenuAction`), so the key, the Fold menu's row and the
 * header are one verb, gated as the catalog gates it (`runFoldMenuVerb`).
 */
export const FOLD_MENU_KEYS: Readonly<Partial<Record<FoldShortcutId, MenuActionId>>> = {
  'fold.toolUnfoldTo': 'fold.unfold-to',
  'fold.toolRepeat': 'fold.repeat',
};

const menuKeys: FoldKeyHandler = (id) => {
  const action = FOLD_MENU_KEYS[id];
  if (!action) return false;
  void handleMenuAction(action);
  return true;
};

/**
 * Bind Fold's keys while its panel is mounted: the scope's executor, the
 * viewport surface's, and the step moves. The panel claims the viewport
 * surface on mount and on every press inside it (`onPointerDownCapture`), and
 * releases it on unmount so the next workspace's viewport keys do not go to a
 * surface that is gone.
 */
export function useFoldKeyboard(): { onPointerDownCapture: () => void } {
  useEffect(() => {
    setActiveShortcutViewportSurface('fold');
    const offScope = registerConditionalScopeExecutor('fold', runFoldKey);
    const offViewport = registerViewportShortcutExecutor('fold', (id) =>
      id === 'viewport.cancel' ? runFoldCancel() : (viewCamera?.(id) ?? false)
    );
    const offSteps = registerFoldKeyHandler(stepKeys);
    const offMenuKeys = registerFoldKeyHandler(menuKeys);
    return () => {
      offScope();
      offViewport();
      offSteps();
      offMenuKeys();
      releaseShortcutViewportSurface('fold');
    };
  }, []);
  const onPointerDownCapture = useCallback(() => setActiveShortcutViewportSurface('fold'), []);
  return { onPointerDownCapture };
}
