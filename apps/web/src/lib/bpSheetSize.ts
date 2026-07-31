import type { OristudioBpFlap, OristudioBpSheet } from '../engine/oristudioBpTypes';
import type { Point } from './geometry';

/**
 * The `+` / `−` sheet controls step the grid size by one unit in each
 * dimension — literally the sheet-size edit the width/height inputs make, so
 * they go through the same `setOristudioBpLayoutSheet` path. Nothing on the
 * sheet is rescaled, so growing the sheet leaves the flaps smaller relative to
 * the paper.
 *
 * They are not Box Pleating Studio's `sheet.ts:subdivide`, which doubles the
 * sheet and scales the whole design with it. That operation is still ported
 * (`BpProjectSession::subdivide_layout_sheet`); it is just no longer on a
 * button.
 */

/** Sheet-size bounds the engine enforces (`crates/oristudio-bp/src/shared.rs`). */
export const BP_MAX_SHEET_SIZE = 8192;
export const BP_MIN_RECT_SIZE = 4;
export const BP_MIN_DIAG_SIZE = 6;

export interface BpSheetSize {
  width: number;
  height: number;
}

function minSheetSize(sheet: OristudioBpSheet): number {
  return sheet.kind === 'diagonal' ? BP_MIN_DIAG_SIZE : BP_MIN_RECT_SIZE;
}

/** The four corner dots of a flap, matching the engine's `get_dots`. */
function flapDots(flap: OristudioBpFlap): Point[] {
  const { x, y } = flap.anchor;
  return [
    { x, y },
    { x: x + flap.width, y },
    { x, y: y + flap.height },
    { x: x + flap.width, y: y + flap.height },
  ];
}

function span(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

/**
 * Whether the flaps still fit a sheet of `size`, given that only translation is
 * available to keep them on it — which is what the engine's checked resize does
 * when the sheet shrinks.
 *
 * A diagonal sheet is the square rotated into a diamond, so it is the spans
 * along the two diagonals that have to fit rather than the spans in x and y.
 * The engine can also refuse a diagonal shrink that no *integer* translation
 * centers, so this is the necessary condition rather than the exact one; the
 * button is never enabled for a resize the engine would take, only occasionally
 * enabled for one it declines.
 */
function flapsFitSheet(sheet: OristudioBpSheet, flaps: OristudioBpFlap[], size: BpSheetSize) {
  const dots = flaps.flatMap(flapDots);
  if (sheet.kind === 'diagonal') {
    return (
      span(dots.map((dot) => dot.x + dot.y)) <= size.width &&
      span(dots.map((dot) => dot.y - dot.x)) <= size.width
    );
  }
  return (
    span(dots.map((dot) => dot.x)) <= size.width && span(dots.map((dot) => dot.y)) <= size.height
  );
}

/**
 * The sheet size one grid unit larger (`grow`) or smaller, or `null` when the
 * engine would refuse it: either dimension leaving the size bounds, or the
 * flaps no longer fitting the smaller sheet.
 *
 * Both dimensions have to be able to take the step. The engine resizes width
 * and height independently and keeps whichever one took, which is right for the
 * sheet-size inputs but would leave the grid lopsided from a single button, so
 * disabling the button is what keeps that from happening.
 */
export function bpSteppedSheetSize(
  sheet: OristudioBpSheet,
  flaps: OristudioBpFlap[],
  grow: boolean
): BpSheetSize | null {
  const delta = grow ? 1 : -1;
  const size = { width: sheet.width + delta, height: sheet.height + delta };
  if (grow) {
    return size.width > BP_MAX_SHEET_SIZE || size.height > BP_MAX_SHEET_SIZE ? null : size;
  }
  const min = minSheetSize(sheet);
  if (size.width < min || size.height < min) return null;
  return flapsFitSheet(sheet, flaps, size) ? size : null;
}
