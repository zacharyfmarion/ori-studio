import { useSyncExternalStore } from 'react';
import { readHeldModifiers, subscribeHeldModifiers } from '../../keyboard/heldModifiers';
import { toggledCpLineColor } from '../../lib/oristudioCpPalette';
import type { OristudioCpLineColor } from '../../engine/oristudioCpTypes';

/**
 * Is the crease-colour inversion modifier held right now?
 *
 * Control, on every platform, matching upstream: Oriedita binds `VK_CONTROL`
 * and reads `isControlDown()` with no platform branching anywhere (its single
 * `hotkey.properties` is literal `ctrl` throughout, and the only `os.name`
 * check near key handling swaps a tooltip glyph). So Control does double duty
 * as accelerator and inversion modifier upstream on Windows, and Ori Studio is
 * if anything cleaner on macOS, where our accelerators live on Cmd.
 *
 * This is the single place the platform rule lives; nothing else should read
 * `readHeldModifiers().ctrl` for this purpose.
 */
export function isLineColorInversionModifierHeld(): boolean {
  return readHeldModifiers().ctrl;
}

export interface CpLineColorInversion {
  /** The colour to draw, preview and highlight with. */
  effectiveLineColor: OristudioCpLineColor;
  /** Whether the effective colour differs from the chosen one. */
  inverted: boolean;
}

/**
 * Derive the active crease colour from the chosen one plus the held modifier.
 *
 * This mirrors upstream's split exactly: `CanvasModel.lineColor` is the base
 * the user picked and is never written by the modifier, while
 * `calculateLineColor()` -- `toggleLineColor ? lineColor.changeMV() : lineColor`
 * (`CanvasModel.java:128-130`) -- is what every consumer reads. Deriving rather
 * than mutating is the whole reason releasing the key restores cleanly, with no
 * state to unwind.
 *
 * The snapshot is deliberately a **boolean**, not a modifiers object: a
 * primitive compares by value, so `getSnapshot` may compute fresh on every call
 * and React's "the result of getSnapshot should be cached" guard cannot fire.
 * It also means the coarse subscription (which fires on any modifier change)
 * costs nothing -- React bails out of the re-render unless this particular
 * answer flipped. An object snapshot would give up both properties for nothing.
 */
export function useCpLineColorInversion(
  base: OristudioCpLineColor,
  enabled = true,
): CpLineColorInversion {
  const held = useSyncExternalStore(subscribeHeldModifiers, isLineColorInversionModifierHeld);
  const swapped = toggledCpLineColor(base);
  // `swapped === base` for Edge, Auxiliary and the rest, so those report
  // `inverted: false` rather than claiming an inversion that changes nothing.
  const inverted = enabled && held && swapped !== base;

  return { effectiveLineColor: inverted ? swapped : base, inverted };
}
