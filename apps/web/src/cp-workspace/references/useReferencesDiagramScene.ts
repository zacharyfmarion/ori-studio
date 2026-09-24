import { useMemo } from 'react';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { diagramGroundInk, diagramInkColors } from './diagram/diagramColors';
import { diagramToScene, type DiagramScene } from './diagram/diagramToScene';
import { canvasDiagramInk } from './diagram/diagramInk';
import { seenFromTheBack } from './diagram/diagramModel';
import { sheetOutline } from './referencesViewGeometry';
import type { SheetPoint } from './stepDiagramGeometry';
import type { ReferencesPaperStyle } from './usePaperStyleTokens';

/**
 * A step's picture, split between the renderer and the layer over it.
 *
 * The straight lines are packed once here and handed to the canvas as one
 * buffer; the symbols go to the DOM. Both come off the one primitive list the
 * filmstrip card is built from, which is the whole point — the two pictures of
 * a step cannot disagree about what it contains, because there is only one
 * description of it.
 *
 * The colours are the workspace's: the theme's tokens read off the workspace
 * root, with the paper style's own on top (`usePaperStyleTokens`). The tokens
 * are a dependency because a new theme or a restyled pen has to repack, and
 * nothing else about the step has changed.
 */
export interface ReferencesDiagramScene {
  strokes: DiagramScene['strokes'];
  /** The symbols, wrapped with the sheet they were measured against. */
  symbols: StepDiagramModel | null;
  /**
   * The outline the canvas fills the paper inside, in model space — where a
   * mark that can leave the paper takes the style's ink rather than the
   * ground's. Empty with no sheet in scope, when nothing is paper.
   */
  outline: readonly SheetPoint[];
}

/** The sheet the workspace answers for: the document, and its border's crease ids. */
export interface ReferencesSheetInScope {
  geometry: CpGeometryTransport | null;
  border: ReadonlySet<number> | null;
}

const NO_PAPER: readonly SheetPoint[] = [];

export function useReferencesDiagramScene(
  diagram: StepDiagramModel | null,
  mirrored: boolean,
  paper: Pick<ReferencesPaperStyle, 'root' | 'tokens' | 'inks' | 'canvasPens'>,
  sheet: ReferencesSheetInScope
): ReferencesDiagramScene {
  const { root, tokens, inks, canvasPens } = paper;
  const { geometry, border } = sheet;
  // The one reading of where the paper is: the hull the canvas fills
  // (`sheetFillGeometry`), so an arrow changes ink exactly at the paper's edge.
  const outline = useMemo<readonly SheetPoint[]>(
    () =>
      geometry
        ? sheetOutline(geometry, border).map(({ x, y }): SheetPoint => [x, y])
        : NO_PAPER,
    [geometry, border]
  );
  return useMemo(() => {
    if (!diagram) return { strokes: null, symbols: null, outline };
    // A mountain seen from the front is a valley seen from the back.
    const primitives = mirrored ? seenFromTheBack(diagram.primitives) : diagram.primitives;
    // The theme's own tokens are on `:root`, so before the workspace root has
    // mounted the document reads the same; the style's travel as values.
    const element = root ?? document.documentElement;
    // The same pen the layer over the canvas uses, so the lines and the symbols
    // are one drawing. It scales the dash runs, which the stroke program reads
    // in screen pixels — and it deliberately excludes the zoom-dependent boost
    // the creases carry, or every zoom frame would have to re-upload them.
    // Every line in the style's pens (`referencesCanvasPens`): a fold in its
    // direction's, and in the aux pen the creases an earlier step made and the
    // pattern's own aux lines when they are shown — pulled back from the
    // sheet's edge as it says. A line in the arrow's pen takes the theme's ink
    // where it leaves the paper, as the layer's marks do.
    const scene = diagramToScene(
      primitives,
      diagramInkColors(element, tokens),
      canvasDiagramInk(canvasPens.lineWidth),
      {
        pens: canvasPens.pens,
        sheet: diagram.sheet,
        creases: { showAux: inks.showAux, erode: inks.erode },
        paper: { outline, ground: diagramGroundInk(element) },
      }
    );
    return {
      strokes: scene.strokes,
      symbols: { sheet: diagram.sheet, primitives: scene.symbols },
      outline,
    };
    // `tokens` is a fresh object on a theme change too, which is what makes the
    // theme's own tokens (read off the DOM) a dependency.
  }, [diagram, mirrored, root, tokens, inks, canvasPens, outline]);
}
