/**
 * The crease-pattern panel's tool state, reachable from the app shell.
 *
 * The phone layout's Tools button lives in the shell — beside the View pill,
 * over the canvas — and it has to draw the active tool's glyph and arm whatever
 * the user picks. Neither is in a store: `cpToolState` is `useState` local to
 * `CreasePatternPanel`, and `handleCpToolAction` closes over kernel handles,
 * pending-tool state and line-colour inversion. The rail gets both as props
 * because it is mounted inside the panel; a shell-mounted button has no props to
 * get.
 *
 * So the panel publishes what it uniquely knows, and the trigger subscribes.
 * What is *not* here is as deliberate. `shortcutResolution` is store-derived, so
 * the sheet reads it directly. `editable` is not a field because it would be a
 * constant: the panel publishes nothing without an editable document, so the
 * existence of a surface *is* the answer.
 *
 * Module state with `useSyncExternalStore` rather than a store slice, the same
 * shape as `touchModifiers/shiftLatch` and `cpOverlayViewStore`: one record, one
 * subscriber, and no reason for the rest of the app to re-render when a tool
 * changes.
 */
import { useSyncExternalStore } from 'react';
import type { OristudioCpLineColor } from '../../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import type {
  OristudioCpActionDefinition,
  OristudioCpActionId,
} from '../../lib/oristudioCpActions';

export interface CpToolSurface {
  activeActionId: OristudioCpActionId | null;
  /**
   * The operation the active tool would run. For a merged tool (Extend Line,
   * Divided Line) this is the variant its mode currently names, not the action's
   * own — so the trigger draws the same glyph the rail button does.
   */
  activeOperationId: OristudioCpOperationId | null;
  activeLineColor: OristudioCpLineColor;
  onSelectAction: (action: OristudioCpActionDefinition) => void;
}

let current: CpToolSurface | null = null;
const listeners = new Set<() => void>();

/**
 * Publish the mounted panel's tool state, and return the unpublish.
 *
 * Identity-checked on the way out, like `registerCpCamera` and
 * `registerCpActionShortcutExecutor`: a panel tearing down must not clear a
 * newer panel's registration when the two overlap, which they do on every
 * workspace switch.
 */
export function publishCpToolSurface(surface: CpToolSurface): () => void {
  current = surface;
  notify();
  return () => {
    if (current !== surface) return;
    current = null;
    notify();
  };
}

/** The mounted panel's tool state, or null when no editable CP is open. */
export function cpToolSurface(): CpToolSurface | null {
  return current;
}

/** Test seam. */
export function resetCpToolSurface(): void {
  current = null;
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Reactive {@link cpToolSurface}.
 *
 * `null` is the answer whenever no editable crease pattern is mounted, which is
 * the same condition the rail is rendered under — so a surface that gates on it
 * disappears exactly when the tools do.
 */
export function useCpToolSurface(): CpToolSurface | null {
  return useSyncExternalStore(subscribe, cpToolSurface, () => null);
}
