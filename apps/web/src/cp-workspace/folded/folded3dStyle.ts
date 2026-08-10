/**
 * How a 3D folded figure looks, independent of how it is drawn.
 *
 * Extracted from `foldedFigure3dProjection.ts` for the same reason
 * `folded3dModelReader.ts` was: two renderers now draw one figure — the CPU
 * projector (which becomes the vector-export path) and the GPU mesh in its
 * window — and a figure's colours and its display style have to mean the *same
 * thing* in both or the same figure looks different depending on which path drew
 * it. One module rather than two copies.
 *
 * Bodies are verbatim from the projector; the only change is that `stylePlan` is
 * exported under a qualified name.
 */

import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';

/** Colour and lighting, in the projector's units. `[r, g, b]` in `0..1`. */
export interface Folded3dPaperStyle {
  front: readonly [number, number, number];
  back: readonly [number, number, number];
  line: readonly [number, number, number];
  /** Fill opacity, `0..1`. Below 1 disables hidden-piece culling. */
  faceAlpha: number;
  /**
   * Face opacity for the X-ray style, `0..1` — the model's own
   * `transparent_transparency` rather than a constant of ours.
   *
   * Oriedita uses that field directly as the fill alpha and defaults it to
   * `16/255`, which is faint on purpose: a single layer is barely there and the
   * picture is built from where layers *stack*. Substituting a value that reads
   * well for one layer would throw that away, so the number comes from the
   * model.
   */
  transparentAlpha: number;
  /** Java2D stroke width, in the same convention the flat kernel emits. */
  lineWidth: number;
  antiAlias: boolean;
  lighting: boolean;
  /** Light direction in **view** space, as the simulator's shader takes it. */
  lightDir: readonly [number, number, number];
}

/** Alpha a cell's fills drop to when the solver could not order it. */
export const UNDETERMINED_FACE_ALPHA = 0.45;

/** Alpha every cell drops to under `Transparent3`. */
export const TRANSPARENT_FACE_ALPHA = 0.45;

/** Paper style from a kernel figure model, so a 3D figure honours its colours. */
export function folded3dPaperStyle(model: OristudioCpFoldedFigureModel): Folded3dPaperStyle {
  return {
    front: [model.front_color.red / 255, model.front_color.green / 255, model.front_color.blue / 255],
    back: [model.back_color.red / 255, model.back_color.green / 255, model.back_color.blue / 255],
    line: [model.line_color.red / 255, model.line_color.green / 255, model.line_color.blue / 255],
    faceAlpha: 1,
    transparentAlpha: model.transparent_transparency / 255,
    lineWidth: model.anti_alias ? 1.200000048 : 1.0,
    antiAlias: model.anti_alias,
    lighting: true,
    lightDir: [0, 0, 1],
  };
}

export interface StylePlan {
  fills: boolean;
  strokes: boolean;
  /** Multiplied into every fill's alpha. */
  faceAlpha: number;
  /** Whether an undecided cell also gets its red annotation. */
  annotateUndetermined: boolean;
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
   * Defaulted so `folded3dBspItems` — which only wants to know *whether* fills
   * and strokes are drawn — does not have to carry a style it never reads.
   */
  transparentAlpha: number = TRANSPARENT_FACE_ALPHA
): StylePlan {
  switch (style) {
    case 'None0':
      return { fills: false, strokes: false, faceAlpha: 1, annotateUndetermined: false };
    case 'Wire2':
    case 'Development1':
    case 'Development4':
      return { fills: false, strokes: true, faceAlpha: 1, annotateUndetermined: false };
    case 'Transparent3':
      return {
        fills: true,
        strokes: true,
        faceAlpha: transparentAlpha,
        annotateUndetermined: false,
      };
    case 'Paper5':
    default:
      return { fills: true, strokes: true, faceAlpha: 1, annotateUndetermined: true };
  }
}
