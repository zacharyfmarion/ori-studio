import {
  getResolvedShortcuts,
  keyChordEquals,
  keyChordFromKeyboardEvent,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
  type ShortcutDefaultsSource,
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
  /**
   * `true` claims the chord; `false` declines it and dispatch continues to the
   * next scope.
   *
   * Declining is what lets a viewport bind a chord a broader scope also owns.
   * Delete is the case it exists for -- the viewport deletes the selected canvas
   * object when there is one, and otherwise hands the key back to `edit.delete`,
   * which deletes creases. Without a decline the viewport binding would shadow
   * crease deletion outright, which is why that verb used to live in a raw
   * `keydown` listener on the panel instead.
   *
   * The return type is `boolean` rather than `boolean | void` because the two
   * viewports that don't implement Delete used to fall out of their `switch`
   * and return `undefined`, which the old `!== false` check read as a claim --
   * so Delete died on the BP and design canvases with nothing to show for it.
   * A required boolean makes that a compile error rather than a dead key.
   *
   * Only viewport executors can decline, because only they are synchronous. A
   * menu action returns a promise, so whether it handled the chord is not known
   * until well after the keydown has to be preventDefault'd or not.
   */
  viewport?: (id: ViewportShortcutId) => boolean;
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
  /**
   * Which defaults the unoverridden bindings resolve against. It has to reach
   * the dispatcher, not just the settings list, or the toggle would rename the
   * keys on screen without moving the ones that actually fire.
   */
  defaultsSource?: ShortcutDefaultsSource;
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

  const resolution = {
    overrides: options.overrides,
    defaultsSource: options.defaultsSource,
  };

  for (const scope of options.scopeStack) {
    const definition = SHORTCUT_DEFINITIONS.find((candidate) => {
      if (candidate.scope !== scope) return false;
      return getResolvedShortcuts(candidate.id, resolution).some((shortcut) =>
        keyChordEquals(shortcut, chord)
      );
    });

    if (!definition) continue;
    // A scope that does not claim the chord must not swallow it: fall through
    // and let a lower scope have it. Two ways that happens -- the scope's
    // executor is not registered at all, or (viewport only) it ran and declined.
    //
    // The first matters most for `simulator`, which shares Space, F, C and R
    // with the crease-pattern tools: a moment where the scope is in the stack
    // but nothing has claimed it would otherwise leave those keys dead rather
    // than merely un-shadowed.
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
      // Only an explicit claim counts. Anything else falls through to the next
      // scope, so the worst a mis-typed executor can do is fail to handle a
      // chord -- never silently eat one on the way past.
      return executors.viewport(id as ViewportShortcutId) === true;
    case 'simulator':
      if (!executors.simulator) return false;
      void executors.simulator(id as SimulatorShortcutId);
      return true;
  }
}
