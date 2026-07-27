import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
  OristudioCpRgbColor,
} from '../../engine/oristudioCpTypes';

/**
 * Which layer-ordering solution a figure is showing, 1-based.
 *
 * Falls back to the discovered count for a figure saved before backwards
 * navigation split the two — which is exactly what the count meant then, since
 * stepping forward was the only way to move.
 */
export function foldedFigureCurrentCase(
  figure: OristudioCpFoldedFigureEntry | null | undefined
): number {
  const snapshot = figure?.snapshot;
  if (!snapshot) return 0;
  return snapshot.current_fold_case ?? snapshot.discovered_fold_cases;
}

/**
 * Toggle a folded figure between its front and back — turning the paper over.
 * This is the honest "Flip": Front ↔ Back.
 *
 * `Both` and `Transparent` are overlay view modes (front and back drawn together,
 * opaque or see-through), not sides, so a flip from either resolves to `Back` —
 * the reverse of the default `Front` view. Those overlay states are chosen from
 * the toolbar's "Side" control, which is the full four-way surface; the context
 * menu only offers the common front/back toggle.
 */
export function flipFoldedState(
  state: OristudioCpFoldedFigureState
): OristudioCpFoldedFigureState {
  return state === 'Back1' ? 'Front0' : 'Back1';
}

/**
 * Whether two folded-figure models describe the same appearance.
 *
 * Used to skip a kernel write that would change nothing. Deliberately explicit
 * rather than a generic deep-equal: the model is a fixed, flat set of fields
 * plus three colours, and if a field is added the compiler flags this function
 * instead of a structural walk silently ignoring it.
 */
export function foldedModelsEqual(
  a: OristudioCpFoldedFigureModel | undefined,
  b: OristudioCpFoldedFigureModel | undefined
): boolean {
  if (!a || !b) return false;
  return (
    rgbEqual(a.front_color, b.front_color) &&
    rgbEqual(a.back_color, b.back_color) &&
    rgbEqual(a.line_color, b.line_color) &&
    a.scale === b.scale &&
    a.rotation === b.rotation &&
    a.anti_alias === b.anti_alias &&
    a.display_shadows === b.display_shadows &&
    a.state === b.state &&
    a.folded_cases === b.folded_cases &&
    a.transparent_transparency === b.transparent_transparency &&
    a.transparency_color === b.transparency_color
  );
}

function rgbEqual(a: OristudioCpRgbColor, b: OristudioCpRgbColor): boolean {
  return a.red === b.red && a.green === b.green && a.blue === b.blue;
}
