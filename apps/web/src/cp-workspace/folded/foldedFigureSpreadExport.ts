/**
 * A spread Edit figure's own Export…: its picture as the canvas draws it
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * "The figure's own Export…").
 *
 * - **The same frame as the canvas.** The picture is built where the canvas
 *   builds it (`foldedFigureSpreadFrame`): the paper map, then the figure's
 *   turn about its pivot, so its reveal points the way it does on the page —
 *   then scaled by the figure's size on the canvas, as its flat export is.
 *   A turned figure exports turned, as it is drawn.
 * - **Settled once** (`settledSpreadPicture`): Affine and Depth at once; a
 *   Default spread solved and clipped as the dialog asks for its first page,
 *   and — too complex to clip — drawn as a 300 dpi bitmap at the page's size,
 *   in the page's pens, which another style or size draws again from the
 *   scene it kept, with no new solve or capture.
 * - **Every face once.** A Default scene's hidden anchor rings are left out
 *   of the picture, so no option of the page can write a face twice.
 * - **Unspread when it cannot be.** A spread that does not settle exports
 *   the figure as the canvas then draws it: unspread, in the same frame.
 *
 * The paper scene is the one the export reads at open: the figure's live
 * fold's, or, reopened with no fold, the scene its file carried.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import {
  rasterSpreadScene,
  settledSpreadPicture,
  type SettledSpreadPicture,
  type SpreadRasterPicture,
} from '../../layer-spread/settledSpreadPicture';
import { bytesToBase64 } from '../../lib/base64';
import type { Point } from '../../lib/geometry';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { foldedFlatPaperScene } from './foldedFlatScene';
import type { LayerSpreadOptions } from './foldedLayerSpread';

/** Where a figure's spread picture is built for its export: kernel coordinates to scene px, and its scale. */
export interface FoldedFigureSpreadExportFrame {
  readonly toScenePx: (point: Point) => ScenePoint;
  readonly scale: number;
}

export interface FoldedFigureSpreadExport {
  /** The picture for a page in `style` (the surface's read of it), `mm` across: null when there is nothing to draw. */
  scene(page: { style: PaperStyle; mm: number }): Promise<PaperScene | null>;
  /** Let go of the solve and any capture or bitmap still running: the dialog closed. */
  release(): void;
}

/** How many bitmaps drawn again for other pages are kept: a few styles and sizes to go back to. */
const KEPT_BITMAPS = 4;

/** A frame scaled after it is built: the canvas's frame (`foldedFigureSpreadFrame`) in the export's scene px. */
export function scaledSpreadFrame(frame: FoldedFigureSpreadExportFrame, by: number): FoldedFigureSpreadExportFrame {
  return {
    toScenePx: (point) => {
      const [x, y] = frame.toScenePx(point);
      return [x * by, y * by];
    },
    scale: frame.scale * by,
  };
}

/** A resolved scene with its anchor rings left out: they are hidden marks, not paper. */
function withoutAnchors(scene: PaperScene): PaperScene {
  return { ...scene, items: scene.items.filter((item) => !(item.kind === 'face' && item.hidden)) };
}

/** A bitmap as a picture: one `<image>` at its frame, which a page places by a scale and a shift. */
function rasterScene(picture: SpreadRasterPicture, sheet: number): PaperScene {
  const [x, y, width, height] = picture.frame;
  const href = `data:image/png;base64,${bytesToBase64(new Uint8Array(picture.raster.png))}`;
  const bounds = { minX: x, minY: y, maxX: x + width, maxY: y + height };
  return {
    sheet,
    bounds,
    items: [
      {
        kind: 'markup',
        svg: `<image x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none" href="${href}"/>`,
        bounds,
        hidden: false,
      },
    ],
  };
}

export function foldedFigureSpreadExport(
  kernel: OristudioCpFoldedPaperScene,
  spread: LayerSpreadOptions,
  frame: FoldedFigureSpreadExportFrame
): FoldedFigureSpreadExport {
  const controller = new AbortController();
  const build = (prepared: PreparedConnectedSpread | null, spreads = true) =>
    foldedFlatPaperScene(kernel, {
      // A covered layer can show an edge once the layers are apart: every face is kept.
      markHidden: false,
      toScenePx: frame.toScenePx,
      scale: frame.scale,
      ...(spreads ? { spread } : {}),
      ...(prepared ? { connected: prepared, live: true } : {}),
    });
  let settling: Promise<SettledSpreadPicture> | null = null;
  // The page the settle drew its bitmap for, if it needed one; others are drawn again.
  let firstPage: string | null = null;
  const bitmaps = new Map<string, Promise<SpreadRasterPicture>>();
  return {
    async scene({ style, mm }) {
      const page = JSON.stringify([mm, style]);
      if (!settling) {
        firstPage = page;
        settling = settledSpreadPicture(kernel, spread, {
          live: (prepared) => build(prepared),
          raster: { style, policy: 'folded-flat', mm },
          signal: controller.signal,
        });
      }
      const settled = await settling;
      if (settled.kind === 'flat') {
        const unspread = build(null, false);
        return unspread.items.length > 0 ? unspread : null;
      }
      if (settled.kind === 'scene') {
        const picture = withoutAnchors(settled.scene);
        return picture.items.length > 0 ? picture : null;
      }
      if (page === firstPage) return rasterScene(settled, settled.scene.sheet);
      let bitmap = bitmaps.get(page);
      if (!bitmap) {
        const drawing = rasterSpreadScene(settled.scene, { style, policy: 'folded-flat', mm }, controller.signal);
        bitmap = drawing;
        bitmaps.set(page, drawing);
        // A bitmap that fails is not kept, so asking for its page again draws it again.
        drawing.catch(() => {
          if (bitmaps.get(page) === drawing) bitmaps.delete(page);
        });
        for (const oldest of bitmaps.keys()) {
          if (bitmaps.size <= KEPT_BITMAPS) break;
          bitmaps.delete(oldest);
        }
      }
      return rasterScene(await bitmap, settled.scene.sheet);
    },
    release: () => controller.abort(),
  };
}
