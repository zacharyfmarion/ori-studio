/**
 * What the References sidebar says about the sheets themselves: the hint above
 * the results, and the warnings that did not stop the analysis.
 *
 * Outside the hook so the mapping from a `SheetAnalysis` to sentences is
 * unit-testable — every one of these is a signal the user only gets here, and a
 * warning the planner emits but this never reads is indistinguishable from no
 * warning at all.
 *
 * React-free; literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';
import type { PrecreaseComponent, SheetAnalysis } from './sheetFrames';

/**
 * Why the planner would not take a sheet.
 *
 * One implementation for both callers: the target hook says it about the sheet
 * around a pick, and the breakdown says it about the sheet the sidebar has
 * selected, and the two must not be able to disagree about what a refusal
 * means.
 */
export function refusalMessageFor(t: TFunction, component: PrecreaseComponent): string {
  switch (component.refused?.kind) {
    case 'non_rectangular':
      return t(
        'panels:references.nonRectangular',
        'This sheet is not a rectangle. References can only be found on rectangular sheets for now.'
      );
    case 'open_outline':
      return t(
        'panels:references.openOutline',
        'The border creases around this pick do not close into a sheet.'
      );
    default:
      return t(
        'panels:references.refusedSheet',
        'The sheet around this pick could not be read as a rectangle.'
      );
  }
}

export interface ReferencesSidebarText {
  hint: string;
  warnings: string[];
}

export function referencesSidebarText(
  t: TFunction,
  frames: SheetAnalysis | null
): ReferencesSidebarText {
  const warnings: string[] = [];
  const hint = t('panels:references.hint.pick', 'Click a vertex or crease to see how to fold it.');
  if (!frames) return { hint, warnings };

  const refused = frames.components.filter((c) => c.refused);
  for (const warning of frames.warnings) {
    switch (warning.kind) {
      case 'no_border_fallback':
        warnings.push(
          t(
            'panels:references.warning.noBorder',
            'No border creases: the default paper is taken as the sheet.'
          )
        );
        break;
      case 'unassigned_segments':
        // These creases are in no component's plan and no component's
        // exactness, so a sequence built from them is quietly incomplete.
        warnings.push(
          t(
            'panels:references.warning.unassignedSegments',
            '{{n}} crease(s) fall outside every sheet and are left out.',
            { n: warning.count }
          )
        );
        break;
      case 'overlapping_sheets':
        warnings.push(
          t(
            'panels:references.warning.overlappingSheets',
            '{{n}} crease(s) lie inside more than one sheet and were given to the first.',
            { n: warning.segments }
          )
        );
        break;
      case 'zero_length_segments':
        warnings.push(
          t(
            'panels:references.warning.zeroLengthSegments',
            '{{n}} crease(s) are too short to measure and were skipped.',
            { n: warning.count }
          )
        );
        break;
      case 'degenerate_border_segments':
        warnings.push(
          t(
            'panels:references.warning.degenerateBorderSegments',
            '{{n}} border crease(s) have coincident ends and were ignored.',
            { n: warning.count }
          )
        );
        break;
    }
  }
  if (refused.length > 0) {
    warnings.push(
      t('panels:references.warning.refusedSheets', '{{n}} sheet(s) are not rectangles and are left out.', {
        n: refused.length,
      })
    );
  }
  return { hint, warnings };
}
