/**
 * The primary ("accel") modifier.
 *
 * The accel modifier is Cmd on Apple platforms and Ctrl everywhere else. Every
 * app shortcut goes through it (the `primary` flag on a `KeyChord`), which keeps
 * Ctrl free on macOS as a distinct third modifier.
 *
 * Direct `metaKey` / `ctrlKey` tests in pointer handlers should use
 * {@link isPrimaryModifier} instead of testing both, so a bare Ctrl press on
 * macOS is not mistaken for the accel.
 */

import { isApplePlatform } from '../platform/runtime';

/**
 * Re-exported so the accel modifier and the shell's menu gating cannot disagree
 * about what an Apple platform is. This module used to test `navigator.platform`
 * alone, which is deprecated and, on iPadOS, reports the same `MacIntel` a Mac
 * does — the same answer as `platform/runtime` by luck rather than by agreement.
 *
 * The dependency points this way because `platform/` owns "what host is this"
 * and `lib/` consumes it: `platform/runtime` answers for every surface (it also
 * reads the user agent, and explains there why `userAgentData` is not consulted),
 * where the accel modifier is one caller that happens to need the answer.
 *
 * The answer stays "Apple" on an iPad, which is what the accel wants — an iPad
 * with a Magic Keyboard sends Cmd, not Ctrl. Only the menu bar cares that iPadOS
 * is not macOS, and that is a separate predicate.
 */
export { isApplePlatform };

/**
 * True when the event carries the platform's accel modifier: Cmd on Apple,
 * Ctrl elsewhere.
 */
export function isPrimaryModifier(event: {
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

/**
 * Display name of the accel modifier, for prose in tooltips and help text.
 * Matches the spelling `formatKeyChord` uses for chords.
 */
export function primaryModifierLabel(): string {
  return isApplePlatform() ? 'Cmd' : 'Ctrl';
}
