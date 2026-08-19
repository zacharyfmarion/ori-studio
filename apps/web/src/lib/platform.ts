/**
 * Platform detection and the primary ("accel") modifier.
 *
 * The accel modifier is Cmd on Apple platforms and Ctrl everywhere else. Every
 * app shortcut goes through it (the `primary` flag on a `KeyChord`), which keeps
 * Ctrl free on macOS as a distinct third modifier.
 *
 * Direct `metaKey` / `ctrlKey` tests in pointer handlers should use
 * {@link isPrimaryModifier} instead of testing both, so a bare Ctrl press on
 * macOS is not mistaken for the accel.
 */

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/u.test(navigator.platform);
}

/**
 * True when the event carries the platform's accel modifier: Cmd on Apple,
 * Ctrl elsewhere.
 */
export function isPrimaryModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

/**
 * Display name of the accel modifier, for prose in tooltips and help text.
 * Matches the spelling `formatKeyChord` uses for chords.
 */
export function primaryModifierLabel(): string {
  return isApplePlatform() ? 'Cmd' : 'Ctrl';
}
