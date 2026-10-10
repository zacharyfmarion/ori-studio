import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { annotationDrawing } from '../../diagram/annotate/annotationPrimitives';
import { DEFAULT_DIAGRAM_STYLE, type KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { DiagramAnnotationLayer } from './DiagramAnnotationLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The marks drawn live (D8): a halo across a References sheet's edge (rf6) is
 * painted with a pattern of the sheet, which each layer names for itself —
 * the canvas shares one document with every other surface, and a `url(#…)`
 * takes the first element of its id there.
 */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** 'A' at 9 pt on a grey back's right edge, at 1000 px: its halo reaches either side of it. */
const ACROSS: KnownDiagramAnnotation = { id: 'a', kind: 'label', from: [1, 0.5], to: [1, 0.5], text: 'A', halo: true, sizePt: 9 };

describe('DiagramAnnotationLayer', () => {
  it('paints a halo across the sheet’s edge with a pattern of its own, in each layer that draws it', () => {
    const drawing = annotationDrawing([ACROSS], { width: 1, height: 1 }, 1000, DEFAULT_DIAGRAM_STYLE, null, {
      outline: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      back: true,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    // Two layers of one drawing in one document, as the canvas and a close-up's inside draw a step's marks.
    act(() =>
      root?.render(
        <svg>
          <g data-layer="one">
            <DiagramAnnotationLayer drawing={drawing} style={DEFAULT_DIAGRAM_STYLE} />
          </g>
          <g data-layer="two">
            <DiagramAnnotationLayer drawing={drawing} style={DEFAULT_DIAGRAM_STYLE} named={false} />
          </g>
        </svg>
      )
    );
    const patterns = (layer: string) => [...host!.querySelectorAll(`[data-layer="${layer}"] pattern`)].map((pattern) => pattern.id);
    const strokes = (layer: string) =>
      [...host!.querySelectorAll(`[data-layer="${layer}"] text`)].map((text) => text.getAttribute('stroke'));
    const [one, two] = [patterns('one'), patterns('two')];
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(1);
    expect(one[0]).not.toBe(two[0]);
    expect(one[0]!.startsWith(`${drawing.labels[0]!.halo!.across!.id}-`)).toBe(true);
    // Each layer's one text, its halo painted with its own layer's pattern.
    expect(strokes('one')).toEqual([`url(#${one[0]})`]);
    expect(strokes('two')).toEqual([`url(#${two[0]})`]);
  });
});
