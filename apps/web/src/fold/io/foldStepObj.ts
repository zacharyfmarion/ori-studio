/**
 * A Fold sequence's steps as OBJ (`implementation-plans/folded-model-obj-export.md`):
 * each numbered step's folded state, its layers spread as its picture spreads
 * them (`foldStepSpread`), for the steps' paper export.
 *
 * A step's page is its crease pattern, but its mesh is the paper folded, so
 * while OBJ is chosen the dialog previews what the folded pane draws of the
 * state (`foldedPaneScene`), not the page — a spread one settled as every
 * exported spread picture is (`spreadPictureExport`), never painted in the
 * order the pane's depth test sorts. The mesh is the flat figure's
 * (`foldedFlatFigureObjExport`) read y up, as the Fold pane reads a state:
 * flat with no spread, lifted by a Default one, and refused, with the reason,
 * for an Affine or Depth spread, which moves the picture alone.
 *
 * A Default spread's solve is cached by the solver, so the preview's and the
 * file's are one; closing the dialog lets go of whatever is still running.
 */

import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { foldedFlatFigureObjExport } from '../../cp-workspace/folded/foldedFigureObj';
import { spreadPictureExport, type FoldedFigureSpreadExport } from '../../cp-workspace/folded/foldedFigureSpreadExport';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { PaperExportView, PaperObjExport } from '../../paperExport/paperExportTarget';
import { foldedPaneScene, type FoldPaneDisplay } from '../canvas/foldPaneScenes';
import type { FoldScene } from '../engine/foldEngineWire';

/** A numbered step's folded state, and the spread its picture shows. */
export interface FoldStepFoldedState {
  scene: FoldScene;
  spread: LayerSpreadOptions | null;
}

/** The steps' meshes for the export dialog. */
export interface FoldStepsObj {
  /** Each step's, in the steps' order. */
  objs: PaperObjExport[];
  /** The preview while OBJ is chosen: each step folded, as the folded pane draws it. */
  view: PaperExportView;
  /** Let go of every solve, capture and bitmap still running. */
  release(): void;
}

/** The style as the folded pane reads it. */
const paneStyle = (style: PaperStyle) => surfacePaperStyle(style, PAPER_STYLE_POLICIES.fold);

/**
 * The meshes of `states`, one per numbered step, and their preview, drawn
 * with the pane's `display` switches as they stood when the dialog opened.
 */
export function foldStepsObj(states: readonly FoldStepFoldedState[], display: FoldPaneDisplay): FoldStepsObj {
  const closed = new AbortController();
  const pictures = new Map<number, FoldedFigureSpreadExport>();
  const spreadPicture = (page: number, { scene, spread }: FoldStepFoldedState & { spread: LayerSpreadOptions }) => {
    let picture = pictures.get(page);
    if (!picture) {
      picture = spreadPictureExport(scene, spread, {
        build: (prepared, spreads) => foldedPaneScene(scene, display, undefined, spreads ? spread : null, prepared ?? undefined),
        policy: 'fold',
        yUp: true,
      });
      pictures.set(page, picture);
    }
    return picture;
  };
  return {
    objs: states.map(({ scene, spread }) => foldedFlatFigureObjExport(scene, spread, closed.signal, true)),
    view: {
      buriesFaces: true,
      // The folded figure, as a folded figure's export measures it.
      sizeMeasures: 'figure',
      // A flat state reads neither the style nor the page; a spread one may
      // settle as a bitmap, drawn in the page's pens and at its size.
      sceneKey: ({ page, style, sheet }) =>
        states[page]?.spread ? `${page}|${sheet.mm}|${JSON.stringify(style)}` : String(page),
      buildScene: async ({ page, style, sheet }) => {
        const state = states[page];
        if (!state) return null;
        if (state.spread) return spreadPicture(page, { ...state, spread: state.spread }).scene({ style: paneStyle(style), mm: sheet.mm });
        const scene = foldedPaneScene(state.scene, display, undefined, null);
        return scene.items.length > 0 ? scene : null;
      },
      paintStyle: paneStyle,
    },
    release: () => {
      closed.abort();
      for (const picture of pictures.values()) picture.release();
      pictures.clear();
    },
  };
}
