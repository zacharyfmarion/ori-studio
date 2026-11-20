/**
 * The inks a pattern drawn small is drawn in — the one rule for both of its
 * painters, the pattern pickers' canvas (`paintSheetThumbnail`) and the rails'
 * SVG cards (`SheetGrid`).
 *
 * Each role takes the theme's crease ink (the `--sheet-thumb-*` aliases), and
 * a crease that folds short of a full fold is shaded on top of it as Edit's
 * canvas shades it, through the same encoder (`foldAngleCssInks`) and in the
 * View panel's mode — so a 3D pattern reads as 3D wherever it is listed, and
 * a pattern with no such crease is inked exactly as before.
 */
import type { OristudioCpFoldAngleDisplay } from '../../lib/creasePatternViewport';
import { degreesToFoldMagnitude } from '../../lib/foldAngle';
import {
  FOLD_ANGLE_ANCHOR_FALLBACK,
  FOLD_ANGLE_ANCHOR_VAR,
  foldAngleCssInks,
  type FoldAngleCssInk,
} from '../foldAngle/foldAngleRamp';
import { parseCssColor } from '../renderer/cssColor';
import type { SheetStroke, SheetStrokeRole } from './sheetThumbnail';

/** What a thumbnail's strokes are drawn in, read off the element it is drawn in. */
export interface SheetThumbnailInks {
  /** Each role's ink as the theme gives it: a full fold, the edge, an aux line. */
  colors: Record<SheetStrokeRole, string>;
  /** Edit's fold-angle encoding over those inks, in the View panel's mode. */
  partialFold: (ink: string, magnitudeUnits: number | undefined) => FoldAngleCssInk;
}

/**
 * The ink an aux line is drawn in: the unassigned grey, as a sheet card draws
 * one, or Edit's own aux-line ink — Fold's precreases, which its
 * crease-pattern pane draws as aux lines.
 */
export type SheetAuxInk = 'unassigned' | 'aux';

/** The inks off `element`, which inherits the theme's tokens. */
export function readSheetThumbnailInks(
  element: Element,
  { auxInk, display }: { auxInk: SheetAuxInk; display: OristudioCpFoldAngleDisplay }
): SheetThumbnailInks {
  const css = getComputedStyle(element);
  const unassigned = css.getPropertyValue('--sheet-thumb-unassigned');
  return {
    colors: {
      edge: css.getPropertyValue('--sheet-thumb-border'),
      mountain: css.getPropertyValue('--sheet-thumb-mountain'),
      valley: css.getPropertyValue('--sheet-thumb-valley'),
      unassigned,
      aux: auxInk === 'aux' ? css.getPropertyValue('--fold-flat') : unassigned,
    },
    partialFold: foldAngleCssInks({
      display,
      anchor: parseCssColor(css.getPropertyValue(FOLD_ANGLE_ANCHOR_VAR)) ?? FOLD_ANGLE_ANCHOR_FALLBACK,
    }),
  };
}

/**
 * The ink `stroke` is drawn in: its role's, at full opacity — or, for a crease
 * that folds short of a full fold, that ink shaded by its angle.
 */
export function sheetStrokeInk(stroke: SheetStroke, inks: SheetThumbnailInks): FoldAngleCssInk {
  const ink = inks.colors[stroke.role];
  if (stroke.foldDegrees === undefined) return { stroke: ink, opacity: 1 };
  return inks.partialFold(ink, degreesToFoldMagnitude(stroke.foldDegrees) ?? undefined);
}
