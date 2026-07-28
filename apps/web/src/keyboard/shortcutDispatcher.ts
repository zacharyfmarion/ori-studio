import {
  getResolvedShortcuts,
  keyChordEquals,
  keyChordFromKeyboardEvent,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
  type ShortcutOverrides,
  type ShortcutScope,
  type ShortcutTarget,
  type SimulatorShortcutId,
  type ViewportShortcutId,
} from './shortcuts';
import type { MenuActionId } from '../commands/menuActions';
import type { OristudioCpActionId } from '../lib/oristudioCpActions';

export interface ShortcutExecutors {
  menu?: (id: MenuActionId) => unknown;
  cpAction?: (id: OristudioCpActionId) => unknown;
  viewport?: (id: ViewportShortcutId) => unknown;
  /**
   * Registered only while a simulation owns the keyboard. Absent means the
   * `simulator` scope resolves nothing and the chord falls through to the next
   * scope, which is what keeps F, C, R, L and Space on the CP tools the rest of
   * the time.
   */
  simulator?: (id: SimulatorShortcutId) => unknown;
}

export interface ShortcutDispatchOptions {
  scopeStack: ShortcutScope[];
  overrides?: ShortcutOverrides;
  executors: ShortcutExecutors;
}

export function isShortcutEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export function handleShortcutKeyDown(
  event: KeyboardEvent,
  options: ShortcutDispatchOptions
): boolean {
  if (event.defaultPrevented || event.isComposing || isShortcutEditingTarget(event.target)) {
    return false;
  }

  const chord = keyChordFromKeyboardEvent(event);
  if (!chord) return false;

  for (const scope of options.scopeStack) {
    const definition = SHORTCUT_DEFINITIONS.find((candidate) => {
      if (candidate.scope !== scope) return false;
      return getResolvedShortcuts(candidate.id, options.overrides).some((shortcut) =>
        keyChordEquals(shortcut, chord)
      );
    });

    if (!definition) continue;
    // A scope whose executor is not registered must not swallow the chord: fall
    // through and let a lower scope claim it. This matters most for `simulator`,
    // which shares Space, F, C and R with the crease-pattern tools -- a moment
    // where the scope is in the stack but nothing has claimed it would otherwise
    // leave those keys dead rather than merely un-shadowed.
    if (!executeShortcut(definition.id, definition.target, options.executors)) continue;
    event.preventDefault();
    return true;
  }

  return false;
}

function executeShortcut(
  id: ShortcutActionId,
  target: ShortcutTarget,
  executors: ShortcutExecutors
): boolean {
  switch (target) {
    case 'menu':
      if (!executors.menu) return false;
      void executors.menu(id as MenuActionId);
      return true;
    case 'cp-action':
      if (!executors.cpAction) return false;
      void executors.cpAction(id as OristudioCpActionId);
      return true;
    case 'viewport':
      if (!executors.viewport) return false;
      void executors.viewport(id as ViewportShortcutId);
      return true;
    case 'simulator':
      if (!executors.simulator) return false;
      void executors.simulator(id as SimulatorShortcutId);
      return true;
  }
}
