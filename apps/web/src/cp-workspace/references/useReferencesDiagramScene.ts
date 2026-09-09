import { useMemo } from 'react';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { diagramInkColors } from './diagram/diagramColors';
import { diagramToScene, type DiagramScene } from './diagram/diagramToScene';
import { DIAGRAM_INK_PER_SHEET } from './diagram/diagramInk';

/**
 * A step's picture, split between the renderer and the layer over it.
 *
 * The straight lines are packed once here and handed to the canvas as one
 * buffer; the symbols go to the DOM. Both come off the one primitive list the
 * filmstrip card is built from, which is the whole point — the two pictures of
 * a step cannot disagree about what it contains, because there is only one
 * description of it.
 *
 * `themeKey` is in the deps because the colours are read from the stylesheet:
 * a theme change has to repack, and nothing else about the step has changed.
 */
export interface ReferencesDiagramScene {
  strokes: DiagramScene['strokes'];
  /** The symbols, wrapped with the sheet they were measured against. */
  symbols: StepDiagramModel | null;
}

const EMPTY: ReferencesDiagramScene = { strokes: null, symbols: null };

export function useReferencesDiagramScene(
  diagram: StepDiagramModel | null,
  themeKey: string | undefined
): ReferencesDiagramScene {
  return useMemo(() => {
    if (!diagram) return EMPTY;
    // The pen, in model units. The canvas's own ink is settled per frame from
    // the camera at fit; this one only has to be the same *ratio*, because it
    // is scaling a dash pattern the program then reads in screen pixels.
    const paper = Math.max(diagram.sheet.width, diagram.sheet.height);
    const scene = diagramToScene(
      diagram.primitives,
      diagramInkColors(document.documentElement),
      paper * DIAGRAM_INK_PER_SHEET
    );
    return {
      strokes: scene.strokes,
      symbols: { sheet: diagram.sheet, primitives: scene.symbols },
    };
    // `themeKey` is a real dependency: the colours above are read from the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram, themeKey]);
}
