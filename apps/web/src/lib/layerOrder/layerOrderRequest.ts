/**
 * What every host hands the Layer order dialog, and what the dialog hands
 * back (`implementation-plans/layer-order-dialog.md`, "The shape of the
 * system"). The dialog reads no store and no host's document: an Edit figure,
 * an Edit selection, a Diagram step and Pose each build one request, and each
 * commits the one result through its own undo and its own kernel.
 *
 * Types only.
 */
import type {
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedPaperScene,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { OristudioCpLineStyle } from '../creasePatternViewport';
import type { Point } from '../geometry';
import type { PaperStyle } from '../paper/paperStyle';
import type { SurfaceStylePolicy } from '../paper/paperStyleResolve';
import type { LayerOrderRecord } from './layerOrderRecord';

/**
 * The fold the dialog analyses: exactly what the host handed its crease
 * kernel, so the dialog's faces are the host's faces, one for one (approach
 * 2). Given back at Apply and folded again as it is, never reselected from the
 * document, whose order can renumber faces.
 */
export interface LayerOrderSource {
  /** The creases folded, in the crease pattern's coordinates, in the order the kernel took them. */
  readonly segments: readonly OristudioCpLineSegment[];
  /** The face the fold starts from, as the kernel numbers it: the one that stays put, front up. */
  readonly startingFaceId: number;
  /** The auxiliary lines carried onto the folded paper. They fold nothing. */
  readonly auxSegments: readonly OristudioCpLineSegment[];
  /** The kernel's model the host folds with: its scale and rotation place the folded paper. */
  readonly model: OristudioCpFoldedFigureModel;
  /**
   * The face-ring digest of the fold: over its ring vertex indices and the
   * input coordinates, never a folded or derived float, so the host's kernel
   * and the dialog's agree on it. Checked when the dialog opens and again on
   * the new fold at Apply.
   */
  readonly digest: string;
}

/**
 * The crease pattern a fold came from, out of a document that may hold many:
 * the sheet its creases lie on, as a Diagram step links one
 * (`cp-workspace/regions/regionCreases.ts`). What the crease-pattern pane
 * draws besides the source's creases, and what it frames. The host finds it
 * (`cp-workspace/regions/layerOrderRegion.ts`); the dialog never sees the
 * document.
 */
export interface LayerOrderRegion {
  /** The sheet's paper, its rings in the crease pattern's coordinates: what the pane fits. */
  readonly paper: readonly (readonly Point[])[];
  /**
   * The sheet's lines that fold nothing, its aux lines: drawn under the
   * source's creases in place of the whole document's, which the source
   * carries for the folded paper to clip.
   */
  readonly auxSegments: readonly OristudioCpLineSegment[];
}

/**
 * The paper the dialog paints its panes with, resolved by the host (approach
 * 3): each host picks its paper its own way, and the dialog never sees a
 * figure's pins or a Diagram's style.
 */
export interface LayerOrderLook {
  /** The effective style: the host's display style with whatever it pins applied. */
  readonly style: PaperStyle;
  /** The surface the style is read through. */
  readonly policy: SurfaceStylePolicy;
  /**
   * How far the host turns the folded paper on screen, in degrees, as a
   * Diagram step's `rotationDeg` does: the step's own, or an Edit figure's
   * on-canvas rotation in those terms. One map turns the scene and the pane.
   */
  readonly turnDeg: number;
  /**
   * The side of the folded paper the host's picture shows: a Diagram step's
   * `side`, or an Edit figure's front or back pass. The dialog opens on it,
   * and its turn is {@link turnDeg} from this side, the other way round from
   * the other.
   */
  readonly side: 'front' | 'back';
  /** Open with the hidden layers showing through, as an Edit figure in Transparent3 does. */
  readonly xray: boolean;
  /**
   * Edit's view's line style and width: the crease-pattern pane draws as
   * Edit's canvas does in them, whatever the host (D18), as Fold's crease
   * pattern pane does from the same view.
   */
  readonly lineStyle: OristudioCpLineStyle;
  readonly lineWidth: number;
}

/**
 * Which host asked (spec §10). An analytics enum, sent as the dialog's
 * events' `surface`, and never shown:
 *
 * - `edit_figure`: Layer order… on an Edit folded figure;
 * - `edit_pattern`: Fold with layer order… on an Edit selection, before any figure exists;
 * - `diagram_step`: a Diagram step's Layer order row;
 * - `pose`: the Pose toolbar;
 * - `fold_import`: Fold's Import CP, choosing an imported crease pattern's order (H10).
 */
export type LayerOrderRequestSurface = 'edit_figure' | 'edit_pattern' | 'diagram_step' | 'pose' | 'fold_import';

export interface LayerOrderRequest {
  /** Which host asked, for the dialog's analytics (`LayerOrderRequestSurface`). */
  readonly surface?: LayerOrderRequestSurface;
  readonly source: LayerOrderSource;
  /**
   * The sheet the source's creases lie on, which the crease-pattern pane
   * shows alone. Left out when they lie on no one sheet: the pane then frames
   * the source's creases.
   */
  readonly region?: LayerOrderRegion | null;
  /** What is saved, if anything, with its points in the crease pattern's coordinates (`paperFrame.ts`). */
  readonly record: LayerOrderRecord | null;
  readonly look: LayerOrderLook;
  /**
   * The paper scene the host shows for this fold now, from either side: its
   * kernel's scene, over the same faces as `source` (the digest holds them
   * to it). With no record, the dialog opens on the order it draws, or the
   * fitting order closest to it (`layer_open_showing`, D19), and it letters
   * the faces from it before the engine answers, so a refusal can name one.
   * Left out, the dialog opens on the solver's first order.
   */
  readonly shown?: OristudioCpFoldedPaperScene | null;
  /** What the host calls the fold, after the dialog's title: a figure's name, "Selection", a step's. */
  readonly name?: string;
  /**
   * The host's picture was folded from creases that have changed since, and
   * the source is the creases as they are now: its Apply also refolds it, as
   * the dialog's foot says beside Apply (D12). Left out otherwise.
   */
  readonly applyRefolds?: boolean;
  /**
   * Opened from the host's Review… on its flag (D14): the dialog opens on
   * the saved rows that need attention. Never set by the dialog itself; left
   * out for every other way in.
   */
  readonly review?: boolean;
  /** Quieter, after the name: the design's credit when there is one ("Traditional", "by Birb"). */
  readonly byline?: string;
}

/**
 * What Apply hands the host to commit: one fold with the chosen order
 * (approach 4), one undo step, and the record to save.
 */
export interface LayerOrderApplied {
  /** The record to save, with its points in the crease pattern's coordinates. */
  readonly record: LayerOrderRecord;
  /**
   * The whole chosen order, for the kernel's seeded fold: flat pairs of the
   * kernel's face indices, `[upper, lower, upper, lower, …]`, the upper face
   * nearer a viewer of the starting face's front.
   */
  readonly relations: Uint32Array;
  /** The fold the dialog analysed, as the request gave it: what the host folds again. */
  readonly source: LayerOrderSource;
}
