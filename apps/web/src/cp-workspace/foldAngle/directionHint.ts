import { HINT_DASH_SLOT } from '../../lib/oristudioCpLineStyle';
import type { Rgba } from '../renderer/types';
import { HINT_MOUNTAIN, HINT_NONE, HINT_VALLEY } from '../../lib/foldAngle';

/**
 * The transport's hint codes, re-exported so render code has one import for
 * "everything about drawing a hint". They are *defined* in `lib/foldAngle`
 * beside the rest of the fold-state mirror, because the engine decoder needs
 * them too and cannot import from `cp-workspace/`.
 */
export { HINT_NONE, HINT_MOUNTAIN, HINT_VALLEY };

/** The line-colour name a hint's direction would paint with. */
export function hintColorName(code: number): string | null {
  if (code === HINT_MOUNTAIN) return 'Red1';
  if (code === HINT_VALLEY) return 'Blue2';
  return null;
}

/** Whether a transport hint code names a direction at all. */
export function isHinted(code: number): boolean {
  return hintColorName(code) !== null;
}

/**
 * The stroke buffers a hint's coloured dash is appended to — the same arrays the
 * creases themselves are written into, one instance further along.
 */
export interface HintDashTarget {
  a: Float32Array;
  b: Float32Array;
  color: Float32Array;
  dashSlot: Float32Array;
}

/**
 * Draw the crease a second time, in its direction's full-strength colour, on the
 * alternate marks of the dash it already has.
 *
 * **Two strokes rather than one washed one.** A hint has two things to say and
 * they are not the same thing: the dash says the fold angle is undecided, the
 * colour says which way it leaned. Blending them into a single ink said both at
 * once and neither clearly — it made the crease look *faded*, which is a third
 * claim nobody made, and it was not even even-handed between the directions,
 * since the neutral it washed toward is itself blue-ish (a mountain kept 43.6%
 * of its chroma at the old wash, a valley 53.0%). Alternating marks costs no
 * saturation on either side, so the asymmetry goes away rather than being
 * balanced.
 *
 * The second stroke is one extra **instance in the same batch**, not a second
 * draw call: same buffers, same program, same uniforms, ten more floats. It is
 * appended after every crease, so painter order puts it over the grey mark it
 * replaces — the two are exactly congruent, so this is a repaint and not a
 * fringe.
 *
 * Returns whether it wrote anything. It declines when the active line style
 * resolves the direction to the very ink the crease already has, which is what
 * the two black-dot styles do to everything: there the overlay would be an exact
 * repaint of the same colour, and the honest outcome is the one those styles
 * always had — shape carries the undecidedness, nothing carries the direction.
 */
export function appendDirectionHintDash(
  target: HintDashTarget,
  at: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  direction: Rgba,
  own: Rgba
): boolean {
  if (
    direction[0] === own[0] &&
    direction[1] === own[1] &&
    direction[2] === own[2] &&
    direction[3] === own[3]
  ) {
    return false;
  }
  target.a[at * 2] = ax;
  target.a[at * 2 + 1] = ay;
  target.b[at * 2] = bx;
  target.b[at * 2 + 1] = by;
  target.color[at * 4] = direction[0];
  target.color[at * 4 + 1] = direction[1];
  target.color[at * 4 + 2] = direction[2];
  target.color[at * 4 + 3] = direction[3];
  target.dashSlot[at] = HINT_DASH_SLOT;
  return true;
}
