import type { FoldedFigureStyleOption } from '../../analytics/events';
import type { OristudioCpFoldedFigureModel } from '../../engine/oristudioCpTypes';

/**
 * Which Style rows a model patch came from, for `folded figure styled`.
 *
 * Only the fields the menu edits have a name here; anything else a patch
 * carries (an import seeding `scale`, say) is not a row anyone used and sends
 * nothing. Pure, so the mapping is the tested piece and the hook only fires.
 */
export function foldedFigureStyleOptions(
  update: Partial<OristudioCpFoldedFigureModel>
): FoldedFigureStyleOption[] {
  const options: FoldedFigureStyleOption[] = [];
  if ('state' in update) options.push('side');
  if ('front_color' in update) options.push('front_color');
  if ('back_color' in update) options.push('back_color');
  if ('line_color' in update) options.push('line_color');
  if ('display_shadows' in update) options.push('shadow');
  return options;
}
