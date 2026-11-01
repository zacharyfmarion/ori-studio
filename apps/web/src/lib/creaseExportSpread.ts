/**
 * The folded figure's layers spread beside an exported crease pattern, and on
 * the share card (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * §2): the frame a spread picture is built in, and the picture as the export
 * paints it.
 *
 * - **The setting** is `CreaseExportFoldedFigureSettings.spread`; **the
 *   picture** it settles to is `CreaseExportContent.foldedFigureSpread`, which
 *   is what the page paints, so a saved file is the preview it was saved from.
 *   Affine and Depth settle at once; Default through the one-shot pipeline
 *   (`settledSpreadPicture`): a resolved scene, or a 300 dpi bitmap of one too
 *   complex to clip.
 * - **The frame** is the figure's own, not the page's: its kernel coordinates
 *   turned as the figure is turned (the Layer order dialog's Rotate), then
 *   scaled so its sheet spans {@link SPREAD_FRAME_SHEET}. A reveal is a
 *   direction in the frame, so it is a direction on the page after the turn;
 *   the page places the frame by a scale and a shift alone. So a picture does
 *   not depend on the pattern, the layout or the card it is painted on, and
 *   the last one settled can stay up, placed as it was made, while the next
 *   is being made.
 * - **Its flat extent** goes with it: the inset is fitted by the unspread
 *   figure, so raising Amount spreads the layers apart rather than shrinking
 *   the figure beside its pattern.
 *
 * Pure.
 */
import { foldedFlatPaperScene } from '../cp-workspace/folded/foldedFlatScene';
import type { LayerSpreadOptions, SpreadKind } from '../cp-workspace/folded/foldedLayerSpread';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { PreparedConnectedSpread } from '../layer-spread/connectedScene';
import type { SettledSpreadPicture } from '../layer-spread/settledSpreadPicture';
import { bytesToBase64 } from './base64';
import { CREASE_EXPORT_FIGURE_SPAN } from './creaseExport';
import { turnClockwise, type Point } from './geometry';
import type { PaperScene, SceneBounds, ScenePoint } from './paper/paperScene';

/** How far the unfolded sheet spans in a spread picture's frame, in its units. */
export const SPREAD_FRAME_SHEET = 1000;

/** CSS px per inch, which an export's page is drawn in. */
const CSS_PX_PER_INCH = 96;

/**
 * The frame a figure's spread picture is built in: its kernel coordinates
 * turned by `turnDeg`, then scaled; and the flat figure's extent there.
 */
export interface CreaseExportSpreadFrame {
  readonly toScenePx: (point: Point) => ScenePoint;
  /** Frame units per kernel unit. */
  readonly scale: number;
  /** The figure unspread, in the frame: what the inset is fitted by. */
  readonly flat: SceneBounds;
}

/** A spread picture as the export paints it, in its frame ({@link CreaseExportSpreadFrame}). */
export type CreaseExportSpreadPicture =
  | {
      readonly kind: 'scene';
      /** The spread it was settled from, for what the file says it has. */
      readonly spread: SpreadKind;
      /** Painted through the export's painter, with no buried face kept: a Default scene's hidden rings are anchors, not paper. */
      readonly scene: PaperScene;
      /** Frame units per kernel unit. */
      readonly scale: number;
      readonly flat: SceneBounds;
    }
  | {
      readonly kind: 'raster';
      readonly spread: 'connected';
      /** The bitmap, as a `data:image/png` URL the page embeds. */
      readonly href: string;
      /** Where the bitmap lies in the frame, `[x, y, width, height]`. */
      readonly frame: readonly [number, number, number, number];
      /** The extent it draws in, in the frame: the spread figure without the bitmap's margin. */
      readonly bounds: SceneBounds;
      readonly scale: number;
      readonly flat: SceneBounds;
    };

/** The frame of `kernel`'s figure turned by `turnDeg`, clockwise on the page. */
export function creaseExportSpreadFrame(kernel: OristudioCpFoldedPaperScene, turnDeg = 0): CreaseExportSpreadFrame {
  const scale = kernel.sheet > 0 ? SPREAD_FRAME_SHEET / kernel.sheet : 1;
  const turn = turnClockwise(turnDeg);
  const toScenePx = (point: Point): ScenePoint => {
    const turned = turn(point);
    return [turned.x * scale, turned.y * scale];
  };
  const flat = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const face of kernel.faces) {
    for (const point of face.outline) {
      const [x, y] = toScenePx(point);
      flat.minX = Math.min(flat.minX, x);
      flat.minY = Math.min(flat.minY, y);
      flat.maxX = Math.max(flat.maxX, x);
      flat.maxY = Math.max(flat.maxY, y);
    }
  }
  return { toScenePx, scale, flat: Number.isFinite(flat.minX) ? flat : { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
}

/**
 * The figure's spread scene in `frame`: Affine's or Depth's, painter-ordered
 * with every layer kept; Default's, live, from its solve (`prepared`), for
 * the capture to resolve.
 */
export function creaseExportSpreadScene(
  kernel: OristudioCpFoldedPaperScene,
  spread: LayerSpreadOptions,
  frame: Pick<CreaseExportSpreadFrame, 'toScenePx' | 'scale'>,
  prepared: PreparedConnectedSpread | null
): PaperScene {
  return foldedFlatPaperScene(kernel, {
    // A covered layer can show an edge once the layers are apart: every face is kept.
    markHidden: false,
    toScenePx: frame.toScenePx,
    scale: frame.scale,
    spread,
    ...(prepared ? { connected: prepared, live: true } : {}),
  });
}

/**
 * How large a Default spread's bitmap is drawn, mm across its longer side:
 * 300 dpi on the page at the largest the inset is drawn — its flat height the
 * pattern's whole drawn span — so it is sharp on any page it is painted on.
 */
export function creaseExportSpreadRasterMm(flat: SceneBounds, drawn: SceneBounds): number {
  const flatHeight = flat.maxY - flat.minY;
  const longer = Math.max(drawn.maxX - drawn.minX, drawn.maxY - drawn.minY);
  const pageMm = (CREASE_EXPORT_FIGURE_SPAN * 25.4) / CSS_PX_PER_INCH;
  return flatHeight > 0 && longer > 0 ? (pageMm * longer) / flatHeight : pageMm;
}

/**
 * The picture a settled spread paints, in `frame`; null for one that settled
 * flat, which the figure is then drawn as.
 */
export function creaseExportSpreadPicture(
  settled: SettledSpreadPicture,
  spread: LayerSpreadOptions,
  frame: CreaseExportSpreadFrame
): CreaseExportSpreadPicture | null {
  if (settled.kind === 'flat') return null;
  if (settled.kind === 'scene') {
    return { kind: 'scene', spread: spread.kind, scene: settled.scene, scale: frame.scale, flat: frame.flat };
  }
  return {
    kind: 'raster',
    spread: 'connected',
    href: `data:image/png;base64,${bytesToBase64(new Uint8Array(settled.raster.png))}`,
    frame: settled.frame,
    bounds: settled.scene.bounds,
    scale: frame.scale,
    flat: frame.flat,
  };
}
