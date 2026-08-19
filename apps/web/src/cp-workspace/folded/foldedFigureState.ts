import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
  OristudioCpRgbColor,
} from '../../engine/oristudioCpTypes';
import type { FoldedFigureSide } from '../../lib/foldedFigureSides';

/** Where a figure sits in its stream of layer-ordering solutions. */
export interface FoldedFigureCycling {
  /** Another solution is reachable without wrapping. */
  hasNext: boolean;
  /** Forward-only high-water mark of solutions reached. Never a total: the
   *  kernel does not know one, so no "k of N" is expressible. */
  discovered: number;
  /** 1-based index of the solution being shown; 0 when there is no figure. */
  current: number;
  /** Pressing the verb again would restart at solution 1. */
  wrapsToFirst: boolean;
}

const NO_CYCLING: FoldedFigureCycling = {
  hasNext: false,
  discovered: 0,
  current: 0,
  wrapsToFirst: false,
};

/**
 * Read a figure's solution stream, whichever kind of figure it is.
 *
 * This is the **only** place that knows a folded figure has two kinds. A 3D
 * figure carries `folded3d` and no `snapshot`; a flat one the reverse. Both
 * spell the four cycling fields the same way and mean the same thing by them,
 * which is what lets the one solution verb bind to either without branching.
 */
export function foldedFigureCycling(
  figure: OristudioCpFoldedFigureEntry | null | undefined,
): FoldedFigureCycling {
  const source = figure?.folded3d ?? figure?.snapshot;
  if (!source) return NO_CYCLING;
  const discovered = source.discovered_fold_cases;
  const hasNext = source.find_another_overlap_valid;
  return {
    hasNext,
    discovered,
    // Absent on figures saved before backwards navigation split the two, which
    // is exactly what the discovered count meant then: stepping forward was the
    // only way to move.
    current: source.current_fold_case ?? discovered,
    // The kernel wraps by restarting the enumeration, so wrapping only makes
    // sense once more than one solution is known to exist.
    wrapsToFirst: !hasNext && discovered > 1,
  };
}

/**
 * Which layer-ordering solution a figure is showing, 1-based.
 */
export function foldedFigureCurrentCase(
  figure: OristudioCpFoldedFigureEntry | null | undefined,
): number {
  return foldedFigureCycling(figure).current;
}

/**
 * Toggle a folded figure between its front and back — turning the paper over.
 *
 * `Both` and `Transparent` are overlay view modes (front and back drawn together,
 * opaque or see-through), not sides. The UI does not offer them (see
 * `FOLDED_FIGURE_SIDES`), but a figure loaded from an Oriedita file can still
 * arrive in one, and a flip from either resolves to `Back` — the reverse of the
 * default `Front` view.
 */
export function flipFoldedState(state: OristudioCpFoldedFigureState): FoldedFigureSide {
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
  b: OristudioCpFoldedFigureModel | undefined,
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

/**
 * Whether a folded-figure list is untouched — the same entries, in the same
 * order.
 *
 * Reference equality, deliberately: every verb that changes a figure rebuilds
 * the entry it changes, so "same objects" is exactly "nothing happened". A
 * structural comparison would be slower and would answer a different, weaker
 * question.
 *
 * Used by the gesture bracket to decide whether a verb earned an undo entry. A
 * fold that was refused, failed, or stopped leaves this list as it found it, and
 * the entry it would otherwise push undoes nothing while marking the project
 * dirty.
 */
export function foldedFigureListsEqual(
  before: readonly OristudioCpFoldedFigureEntry[],
  after: readonly OristudioCpFoldedFigureEntry[],
): boolean {
  return before.length === after.length && before.every((entry, index) => entry === after[index]);
}
