/**
 * What a 3D folded figure's *display style* means, independent of how it is
 * drawn.
 *
 * Extracted from the CPU projector for the same reason `folded3dModelReader.ts`
 * was: two renderers drew one figure, and a display style has to mean the same
 * thing in both or the same figure looks different depending on which path drew
 * it. The projector has retired (D5) and the window and the scene are now built
 * from one mesh, but the split still earns its keep — the window submits draw
 * passes and the scene orders items, so "wireframe draws no paper" is stated
 * once, here, rather than in each.
 *
 * Colour is **not** here. Every surface resolves the figure's effective
 * `PaperStyle` through `resolvePaperStyle` — the window in
 * `folded3dWindowRenderSettings`, the scene and the painter through the
 * `folded-3d` policy — so there is one ink vocabulary and this module carries
 * only the two alphas the kernel's own semantics fix.
 */

import type { OristudioCpFoldedFigureDisplayStyle } from '../../engine/oristudioCpTypes';

/** Alpha a cell's fills drop to when the solver could not order it. */
export const UNDETERMINED_FACE_ALPHA = 0.45;

/**
 * Alpha every cell drops to under `Transparent3`, in **3D**.
 *
 * Deliberately not `FoldedFigureModel.transparent_transparency`, which the flat
 * renderer uses directly as its fill alpha and which defaults to `16/255`.
 * That number is calibrated for the flat renderer's *ply*: a flat stack lands
 * ten to fourteen layers on one pixel, and 6% each accumulates to about 59%. In
 * 3D a pixel typically has one to three faces behind it, so the same number
 * reads as almost nothing — X-ray became indistinguishable from Wireframe, which
 * is how this was found.
 *
 * Wiring the model field through bought nothing either way: there is no
 * transparency control in the UI, so the only value it could ever take was the
 * default. Same conclusion as `transparency_color`, for the same reason — see
 * `foldedFigureAppearance`.
 */
export const TRANSPARENT_FACE_ALPHA = 0.45;

export interface StylePlan {
  fills: boolean;
  strokes: boolean;
  /** Multiplied into every fill's alpha. */
  faceAlpha: number;
}

/**
 * What a display style means in 3D.
 *
 * `Transparent3` is deliberately **not** the kernel's meaning: the flat path's
 * transparency pass needs the whole-document subface arrangement
 * (`needs_subfaces`), which does not exist here. In 3D it is the honest
 * analogue — every cell translucent — which keeps the "downgrade when the layers
 * cannot be ordered" idiom expressible.
 *
 * `Development1` / `Development4` are inherited no-ops on the flat path too:
 * `push_folded_display_style_pass_primitives` has arms only for `Transparent3`
 * and `Paper5`. They draw the wireframe and no paper.
 */
export function folded3dStylePlan(
  style: OristudioCpFoldedFigureDisplayStyle,
  /**
   * The X-ray alpha, when the caller has a model to take it from.
   *
   * Defaulted so a caller that only wants to know *whether* fills and strokes
   * are drawn — the scene producer — does not have to carry an alpha it never
   * reads.
   */
  transparentAlpha: number = TRANSPARENT_FACE_ALPHA
): StylePlan {
  switch (style) {
    case 'None0':
      return { fills: false, strokes: false, faceAlpha: 1 };
    case 'Wire2':
    case 'Development1':
    case 'Development4':
      return { fills: false, strokes: true, faceAlpha: 1 };
    case 'Transparent3':
      return { fills: true, strokes: true, faceAlpha: transparentAlpha };
    case 'Paper5':
    default:
      return { fills: true, strokes: true, faceAlpha: 1 };
  }
}
