import {
  type ConditionalShortcutIds,
  type ConditionalShortcutTarget,
  getResolvedShortcuts,
  keyChordEquals,
  keyChordFromKeyboardEvent,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
  type ShortcutDefaultsSource,
  type ShortcutOverrides,
  type ShortcutScope,
  type ShortcutTarget,
  type ViewportShortcutId,
} from './shortcuts';
import type { MenuActionId } from '../commands/menuActions';
import type { OristudioCpActionId } from '../lib/oristudioCpActions';

/**
 * A conditional surface's executor: `true` claims the chord, `false` declines
 * it and dispatch continues to the next scope, as a viewport's does. Each
 * surface's reason to decline, or never to, is in `CONDITIONAL_SHORTCUT_SCOPES`.
 */
export type ConditionalScopeExecutor<T extends ConditionalShortcutTarget> = (
  id: ConditionalShortcutIds[T]
) => boolean;

/**
 * One per conditional surface, present only while that surface owns the
 * keyboard. Absent means its scopes resolve nothing and the chord falls through
 * to the next scope, which is what keeps F, C, R, L and Space on the CP tools
 * the rest of the time.
 */
export type ConditionalScopeExecutors = {
  [T in ConditionalShortcutTarget]?: ConditionalScopeExecutor<T>;
};

export interface ShortcutExecutors extends ConditionalScopeExecutors {
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
   * Only the viewport and the conditional surfaces' executors can decline,
   * because only they are synchronous. A menu action returns a promise, so
   * whether it handled the chord is not known until well after the keydown has
   * to be preventDefault'd or not.
   */
  viewport?: (id: ViewportShortcutId) => boolean;
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

/**
 * Inputs that take no typing. Each keeps the plain keys it moves or toggles
 * with, but has no ⌘/Ctrl chord of its own: no text to undo, copy or select.
 */
const UNTYPED_INPUT_TYPES: ReadonlySet<string> = new Set(['range', 'checkbox', 'radio']);

/**
 * Does the target own the ⌘/Ctrl chords that edit text, so the app may take
 * only those declared `inFormControls`? A field you type in, not a slider: a
 * slider keeps focus after a drag, and ⌘Z there used to undo nothing.
 */
function ownsPrimaryChords(target: EventTarget | null): boolean {
  if (!isShortcutEditingTarget(target)) return false;
  return !(target instanceof HTMLInputElement && UNTYPED_INPUT_TYPES.has(target.type));
}

/**
 * Does the target sit inside an open layer — a menu, a Select's listbox, a
 * popover — which owns the keys aimed at it?
 *
 * The other half of {@link isShortcutEditingTarget}'s question. An input owns
 * its keystrokes because it is typing; an open layer owns them because it is
 * navigating — Escape dismisses it, arrows and typeahead move through it, Enter
 * and Space choose. Radix answers all of those *after* the app's capture
 * listener (its Escape listener is capture-phase on the document too, but
 * registered when the layer opens, and it stands down once the chord is
 * `defaultPrevented`), so a runtime that claims the chord first leaves the menu
 * open while the selection under it goes away.
 *
 * Asked of the target's ancestry, not of the document. Radix mounts
 * `[data-radix-popper-content-wrapper]` for every open layer, so querying the
 * document for it answers "is any layer open" — and a tooltip is a layer too,
 * one that holds no focus and owns nothing. The global form stands the runtime
 * down whenever the pointer happens to rest on a toolbar button; the ancestry
 * form only while focus is actually inside the layer, which is the only time
 * the layer is what the user is typing at. `[role="menu"]` is the ARIA
 * contract and outlives Radix's private attribute; the popper wrapper is what
 * reaches the layers that are not menus.
 */
export function isOpenLayerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[role="menu"], [data-radix-popper-content-wrapper]') !== null;
}

/**
 * Does the target sit inside a dialog that owns every key aimed at it — one
 * marked `data-shortcut-barrier`?
 *
 * A modal is a layer too, but one that holds focus across ordinary buttons and
 * switches, so the question the two predicates above ask of a key does not
 * cover it: Space on its focused Export button is not typing and not a menu,
 * and the workspace behind would take it — References plays its fold on Space,
 * steps on the arrows. Opt-in by marker rather than by `aria-modal`, which the
 * app also puts on drawers and sheets that do want the workspace's keys.
 */
export function isShortcutBarrierTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[data-shortcut-barrier]') !== null;
}

/**
 * Is a modal dialog that owns every key open? Then no key acts on the
 * workspace behind it, wherever it was aimed: a dialog keeps focus inside it,
 * but a key that slipped out with focus must still find nothing to act on.
 */
export function isShortcutBarrierOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[role="dialog"][aria-modal="true"][data-shortcut-barrier]') !== null;
}

export function handleShortcutKeyDown(
  event: KeyboardEvent,
  options: ShortcutDispatchOptions
): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    isOpenLayerTarget(event.target) ||
    isShortcutBarrierTarget(event.target)
  ) {
    return false;
  }

  const chord = keyChordFromKeyboardEvent(event);
  if (!chord) return false;
  // A form control keeps its keys, except a chord declared `inFormControls`
  // and held with ⌘/Ctrl — so a Save rebound to a bare letter still types it.
  // One that takes no typing has no ⌘/Ctrl chord to keep.
  if (isShortcutEditingTarget(event.target) && !chord.primary) return false;
  const ownsChords = ownsPrimaryChords(event.target);

  const resolution = {
    overrides: options.overrides,
    defaultsSource: options.defaultsSource,
  };

  for (const scope of options.scopeStack) {
    const definition = SHORTCUT_DEFINITIONS.find((candidate) => {
      if (candidate.scope !== scope) return false;
      if (ownsChords && !candidate.inFormControls) return false;
      return getResolvedShortcuts(candidate.id, resolution).some((shortcut) =>
        keyChordEquals(shortcut, chord)
      );
    });

    if (!definition) continue;
    // A scope that does not claim the chord must not swallow it: fall through
    // and let a lower scope have it. Two ways that happens -- the scope's
    // executor is not registered at all, or (a viewport's or a conditional
    // surface's only) it ran and declined.
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
    default:
      return executeConditionalShortcut(target, id, executors);
  }
}

function executeConditionalShortcut<T extends ConditionalShortcutTarget>(
  target: T,
  id: ShortcutActionId,
  executors: ConditionalScopeExecutors
): boolean {
  const executor = executors[target];
  if (!executor) return false;
  // A binding's `target` is the surface whose ids it carries, so `id` is one
  // this executor answers. An explicit claim only, for the viewport's reason.
  return executor(id as ConditionalShortcutIds[T]) === true;
}
