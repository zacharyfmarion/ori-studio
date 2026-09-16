import { useEffect, useRef } from 'react';
import { registerReferencesShortcutExecutor } from '../../keyboard/shortcutRuntime';
import type { ReferencesShortcutId } from '../../keyboard/shortcuts';
import { runReferencesShortcut, type ReferencesShortcutActions } from './referencesShortcuts';

/**
 * Bind the References keymap while the panel is mounted.
 *
 * Registering with the dispatcher pushes the `references` scope for exactly as
 * long as the executor is registered (`shortcutScopeStackForContext`), so the
 * arrow and zoom keys reach this workspace and the CP tools the rest of the
 * time — and every chord honours the user's overrides. Never a `keydown`
 * listener (AGENTS.md > Panel components): the dispatcher is focus-independent,
 * a container listener is not.
 *
 * `toggleLandmarksFirst` is wired but a no-op until Phase 5 gives the sidebar a
 * whole-pattern breakdown to hoist; the panel passes it as such.
 */
export function useReferencesShortcuts(actions: ReferencesShortcutActions, active = true): void {
  // Held in a ref so the registration is not torn down and rebuilt whenever the
  // panel passes fresh closures, which is every render.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    if (!active) return;
    return registerReferencesShortcutExecutor((id: ReferencesShortcutId) =>
      runReferencesShortcut(id, actionsRef.current)
    );
  }, [active]);
}
