import { useMemo } from 'react';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { diagramInkColors } from './diagram/diagramColors';
import { diagramToScene, type DiagramScene } from './diagram/diagramToScene';
import { canvasDiagramInk, canvasDiagramPens } from './diagram/diagramInk';
import { seenFromTheBack } from './diagram/diagramModel';
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
}

const EMPTY: ReferencesDiagramScene = { strokes: null, symbols: null };

export function useReferencesDiagramScene(
  diagram: StepDiagramModel | null,
  lineWidth: number,
  mirrored: boolean,
  paper: Pick<ReferencesPaperStyle, 'root' | 'tokens' | 'arrowWidth' | 'inks'>
): ReferencesDiagramScene {
  const { root, tokens, arrowWidth, inks } = paper;
  return useMemo(() => {
    if (!diagram) return EMPTY;
    // A mountain seen from the front is a valley seen from the back.
    const primitives = mirrored ? seenFromTheBack(diagram.primitives) : diagram.primitives;
    // The theme's own tokens are on `:root`, so before the workspace root has
    // mounted the document reads the same; the style's travel as values.
    const element = root ?? document.documentElement;
    // The same pen the layer over the canvas uses, so the lines and the symbols
    // are one drawing. It scales the dash runs, which the stroke program reads
    // in screen pixels — and it deliberately excludes the zoom-dependent boost
    // the creases carry, or every zoom frame would have to re-upload them.
    // The existing creases in the style's aux pen, shown or not and pulled
    // back from the sheet's edge as it says.
    const scene = diagramToScene(
      primitives,
      diagramInkColors(element, tokens),
      canvasDiagramInk(lineWidth),
      {
        pens: canvasDiagramPens(lineWidth, arrowWidth, inks.aux),
        sheet: diagram.sheet,
        creases: { visible: inks.auxVisible, erode: inks.erode },
      }
    );
    return {
      strokes: scene.strokes,
      symbols: { sheet: diagram.sheet, primitives: scene.symbols },
    };
    // `tokens` is a fresh object on a theme change too, which is what makes the
    // theme's own tokens (read off the DOM) a dependency.
  }, [diagram, lineWidth, mirrored, root, tokens, arrowWidth, inks]);
}
