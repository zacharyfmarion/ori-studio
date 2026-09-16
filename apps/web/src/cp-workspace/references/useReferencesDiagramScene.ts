import { useMemo } from 'react';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { diagramInkColors } from './diagram/diagramColors';
import { diagramToScene, type DiagramScene } from './diagram/diagramToScene';
import { canvasDiagramInk } from './diagram/diagramInk';
import { seenFromTheBack } from './diagram/diagramModel';

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
  lineWidth: number,
  mirrored: boolean,
  themeKey: string | undefined
): ReferencesDiagramScene {
  return useMemo(() => {
    if (!diagram) return EMPTY;
    // A mountain seen from the front is a valley seen from the back.
    const primitives = mirrored ? seenFromTheBack(diagram.primitives) : diagram.primitives;
    // The same pen the layer over the canvas uses, so the lines and the symbols
    // are one drawing. It scales the dash runs, which the stroke program reads
    // in screen pixels — and it deliberately excludes the zoom-dependent boost
    // the creases carry, or every zoom frame would have to re-upload them.
    const scene = diagramToScene(
      primitives,
      diagramInkColors(document.documentElement),
      canvasDiagramInk(lineWidth)
    );
    return {
      strokes: scene.strokes,
      symbols: { sheet: diagram.sheet, primitives: scene.symbols },
    };
    // `themeKey` is a real dependency: the colours above are read from the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram, lineWidth, mirrored, themeKey]);
}
