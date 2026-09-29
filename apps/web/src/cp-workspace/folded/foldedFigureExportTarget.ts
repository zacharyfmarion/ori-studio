/**
 * A folded figure as the export dialog's target: its picture, captured when
 * the dialog opens, in whichever form the figure can give it.
 *
 * - **A 3D figure with a live kernel** builds the window's scene
 *   (`folded3dFigureScene`) from the render model, the camera and the aux
 *   lines captured at open. The scene bakes in the light and the widest pen
 *   (`folded3dSceneStyleKey`) and the hidden test, so those rebuild it; the
 *   rest repaints.
 * - **A 3D figure with only its stored scene** — reopened from a file, not yet
 *   refolded — repaints that scene, carried into the space the live path
 *   builds at (`folded3dStoredSceneInCssPx`). It was shaded when it was
 *   folded, and cannot be re-lit: the hint says so.
 * - **A flat figure with a live kernel** paints the kernel's paper scene,
 *   fetched once at open; only the hidden test rebuilds it.
 * - **Anything else** — a flat figure reopened from a file, one in a display
 *   style the paper scene has no form for, or a fold with no layer order —
 *   exports its stored render snapshot as it was drawn: a fixed picture, the
 *   format the one choice (E9).
 *
 * What a figure pins of its own style is laid over the export style and over
 * any preset picked (`pins`), as the figure draws itself.
 */
import type {
  OristudioCpFolded3dAuxLines,
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import type { Point } from '../../lib/geometry';
import type { PaperExportTarget } from '../../paperExport/paperExportTarget';
import { folded3dSceneStyleKey } from './folded3dScene';
import { folded3dFigureScene, folded3dStoredSceneInCssPx } from './folded3dStoredScene';
import { foldedFigureExportDocument } from './foldedFigureExport';
import { foldedFlatFigureScenePxPerUnit } from './foldedFlatFigureExport';
import { foldedFlatPaperScene } from './foldedFlatScene';

/** The figure's picture, in the form it can give it. */
export type FoldedFigureExportPicture =
  | {
      kind: 'live-3d';
      model: OristudioCpFolded3dRenderModel;
      aux: OristudioCpFolded3dAuxLines | null;
      cssPerUserUnit: number;
      /** The stored scene, for a model the window cannot build one from (past the mesh's budget). */
      stored: PaperScene | null;
    }
  | { kind: 'stored-3d'; scene: PaperScene }
  | { kind: 'flat'; kernel: OristudioCpFoldedPaperScene; cssPerUserUnit: number }
  | { kind: 'fixed'; svg: string; widthPx: number; heightPx: number };

export interface FoldedFigureExportCapture {
  figure: OristudioCpFoldedFigureEntry;
  picture: FoldedFigureExportPicture;
  title: string;
  fileStem: string;
  /** The Settings export style with the figure's own pins on top. */
  exportStyle: PaperStyle;
  /** The hint for a stored 3D scene, which keeps the light it was folded under. */
  storedSceneHint: string;
}

/**
 * The picture a figure can give, read at the moment of export: `null` when it
 * has none — nothing folded, nothing stored. `model`, `aux` and `kernel` are
 * what the caller read from the runtime for it.
 */
export function foldedFigureExportPicture(
  figure: OristudioCpFoldedFigureEntry,
  runtime: {
    model: OristudioCpFolded3dRenderModel | null;
    aux: OristudioCpFolded3dAuxLines | null;
    kernel: OristudioCpFoldedPaperScene | null;
    cssPerUserUnit: number;
  }
): FoldedFigureExportPicture | null {
  if (figure.folded3d) {
    // Carried into the space the live path builds at, so the same figure
    // exports at one ink-to-paper ratio whether or not it was rehydrated.
    const stored =
      figure.scene && figure.scene.items.length > 0
        ? folded3dStoredSceneInCssPx(figure.scene, figure.placement, runtime.cssPerUserUnit)
        : null;
    if (runtime.model) {
      const { model, aux, cssPerUserUnit } = runtime;
      return { kind: 'live-3d', model, aux, cssPerUserUnit, stored };
    }
    if (stored) return { kind: 'stored-3d', scene: stored };
  } else if (runtime.kernel && runtime.kernel.faces.length > 0) {
    return { kind: 'flat', kernel: runtime.kernel, cssPerUserUnit: runtime.cssPerUserUnit };
  }
  const document = foldedFigureExportDocument(figure.renderSnapshot);
  return document && { kind: 'fixed', svg: document.svg, widthPx: document.width, heightPx: document.height };
}

export function foldedFigureExportTarget({
  figure,
  picture,
  title,
  fileStem,
  exportStyle,
  storedSceneHint,
}: FoldedFigureExportCapture): PaperExportTarget {
  const surface = figure.folded3d ? 'folded-3d' : 'folded-flat';
  const policy = PAPER_STYLE_POLICIES[surface];
  const base = {
    surface,
    title,
    fileStem,
    pages: null,
    exportStyle,
    pins: figure.appearance ?? null,
    sheetAsShown: false,
    // The painter takes the style as the figure's view sees it — every
    // crease at the edge pen, the fields the policy does not apply at their
    // defaults — as the figure hands its own policy's view to the canvas.
    paintStyle: (style: PaperStyle) => surfacePaperStyle(style, policy),
    release: () => {},
  } satisfies Partial<PaperExportTarget>;

  switch (picture.kind) {
    case 'live-3d':
      return {
        ...base,
        buriesFaces: true,
        sceneKey: ({ style, markHidden }) => `${folded3dSceneStyleKey(style)}|${markHidden}`,
        buildScene: async ({ style, markHidden }) =>
          folded3dFigureScene(figure, picture.model, {
            style,
            space: picture.cssPerUserUnit,
            markHidden,
            aux: picture.aux,
          }) ?? picture.stored,
      };
    case 'stored-3d':
      return {
        ...base,
        buriesFaces: true,
        hint: storedSceneHint,
        // Shaded, and its hidden pieces marked, when it was folded: nothing
        // an option can rebuild.
        sceneKey: () => 'stored',
        buildScene: async () => picture.scene,
      };
    case 'flat': {
      const scale = foldedFlatFigureScenePxPerUnit(figure, picture.cssPerUserUnit);
      return {
        ...base,
        buriesFaces: true,
        sceneKey: ({ markHidden }) => String(markHidden),
        buildScene: async ({ markHidden }) => {
          const scene = foldedFlatPaperScene(picture.kernel, {
            markHidden,
            toScenePx: (point: Point): ScenePoint => [point.x * scale, point.y * scale],
            scale,
          });
          return scene.items.length > 0 ? scene : null;
        },
      };
    }
    case 'fixed':
      return {
        ...base,
        buriesFaces: false,
        fixedPicture: { svg: picture.svg, widthPx: picture.widthPx, heightPx: picture.heightPx },
        sceneKey: () => 'fixed',
        buildScene: async () => null,
      };
  }
}
