/**
 * Which appearance options mean anything for a given folded figure.
 *
 * The Folded models controls were written for the flat figure. A 3D one honours
 * some of `FoldedFigureModel` and silently ignores the rest, so a control could
 * be on screen, enabled, and inert — which is the state this module exists to
 * make unreachable.
 *
 * # Why this is a function and not a flag on the entry
 *
 * The answer is a property of the *kind* of figure, not of the figure. Putting
 * it on the entry would mean persisting it, and a stored figure would then
 * disagree with the build that opened it the first time support changed.
 *
 * # The seam this protects
 *
 * `FoldedFigureModel` is **Oriedita's** type — its field set, defaults and wire
 * codes are parity surface, and a new upstream field is added there and nowhere
 * else. This module is **ours**: it says what our 3D renderer can do with those
 * fields. Keeping the two apart is what lets the next upstream feature be ported
 * without first untangling which behaviour was theirs. See `PORTING.md`.
 */

import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { isFolded3dFigure } from './foldedFigureCapabilities';

/**
 * The appearance options a folded figure can offer.
 *
 * Deliberately **not** every field of `FoldedFigureModel`: this names the
 * *controls*, and two of that type's fields (`scale`, `rotation`) are not
 * controls at all — see {@link foldedAppearanceSupport}.
 */
export type FoldedAppearanceOption =
  | 'frontColor'
  | 'backColor'
  | 'lineColor'
  | 'antiAlias'
  | 'side'
  | 'displayStyle'
  | 'shadow'
  | 'transparency'
  | 'scale'
  | 'rotation';

export type FoldedAppearanceSupport =
  /** Works on this figure. Show it, enabled. */
  | 'supported'
  /** Meaningful for this kind of figure, but this renderer cannot do it yet. */
  | 'unsupported'
  /** Not a control on any figure — see the note on `scale`/`rotation`. */
  | 'not-applicable';

/** Every option, so a caller can iterate without restating the union. */
export const FOLDED_APPEARANCE_OPTIONS: readonly FoldedAppearanceOption[] = [
  'frontColor',
  'backColor',
  'lineColor',
  'antiAlias',
  'side',
  'displayStyle',
  'shadow',
  'transparency',
  'scale',
  'rotation',
];

/**
 * Whether `option` does anything on `figure`.
 *
 * `scale` and `rotation` are `not-applicable` on **every** figure, and that is
 * the one answer worth explaining. `FoldedFigureModel.scale` / `.rotation` are
 * Oriedita's own display transform, seeded only from imported Oriedita metadata.
 * Ori Studio scales and rotates a figure through `FoldedFigurePlacement`, driven
 * by the canvas handles and stored in the `.osf`. Wiring the model fields to a
 * control would give one figure two transforms that disagree — so there is no
 * control, the fields stay on the ported type untouched, and `.ori` round-trips
 * are unaffected.
 *
 * That is emphatically *not* "you cannot scale or rotate a folded figure". You
 * can, with the handles, on a focused figure as much as an unfocused one.
 */
export function foldedAppearanceSupport(
  figure: OristudioCpFoldedFigureEntry,
  option: FoldedAppearanceOption,
): FoldedAppearanceSupport {
  switch (option) {
    case 'scale':
    case 'rotation':
      return 'not-applicable';
    case 'frontColor':
    case 'backColor':
    case 'lineColor':
    case 'antiAlias':
    case 'side':
    case 'displayStyle':
      // The projector reads all of these — colours and anti-alias through
      // `folded3dPaperStyle`, side as a camera, display style as its style plan.
      return 'supported';
    case 'transparency':
      // The amount is the flat renderer's, and it does not transfer. Oriedita
      // uses `transparent_transparency` directly as a fill alpha, defaulted to
      // 16/255 — a number calibrated for a flat stack's ply, where ten to
      // fourteen layers land on one pixel. A 3D pixel has one to three faces
      // behind it, so the same value reads as almost nothing and X-ray becomes
      // Wireframe. 3D uses its own constant; see `TRANSPARENT_FACE_ALPHA`.
      return isFolded3dFigure(figure) ? 'unsupported' : 'supported';
    case 'shadow':
      // Oriedita's shadow is an offset band along a subface boundary, derived
      // from the subface arrangement and the layer hierarchy. The 3D path keeps
      // that machinery in the kernel and the projector never sees it, so there
      // is nothing to sweep a band from yet. A flat figure has it.
      return isFolded3dFigure(figure) ? 'unsupported' : 'supported';
  }
}

/** Whether a control should be offered at all. `not-applicable` never is. */
export function foldedAppearanceVisible(
  figure: OristudioCpFoldedFigureEntry,
  option: FoldedAppearanceOption,
): boolean {
  return foldedAppearanceSupport(figure, option) !== 'not-applicable';
}

/** Whether an offered control should be interactive. */
export function foldedAppearanceEnabled(
  figure: OristudioCpFoldedFigureEntry,
  option: FoldedAppearanceOption,
): boolean {
  return foldedAppearanceSupport(figure, option) === 'supported';
}
