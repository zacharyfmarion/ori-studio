import { useMemo } from 'react';
import { paperSceneToFoldedGeometry } from '../../cp-workspace/adapters/cpFoldedToScene';
import type { StrokeGeometry } from '../../cp-workspace/renderer/types';
import type { Point } from '../../lib/geometry';
import type { PaperLineItem, PaperLineRole, PaperSide } from '../../lib/paper/paperScene';
import { ptToDevicePx, type PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { boundsOf } from './foldCanvasGeometry';
import type { FoldCreasePatternLines } from './foldCreasePatternLines';
import { foldCpViewedColor } from './foldCreasePatternView';

/** The crease-pattern pane's strokes, in sheet coordinates with widths in points. */
export interface FoldCreasePatternStrokes {
  creases: StrokeGeometry;
  /** The step's or preview's instruction, under the tool's feedback. */
  instruction: StrokeGeometry | null;
}

/** Paper pens have fixed point widths, independent of Edit's line width and zoom. */
export function foldPaneStrokeWidthPx(
  creases: FoldCreasePatternStrokes | null,
  frame: { ratio: number; widthBoost: number }
): number {
  return creases ? ptToDevicePx(1, frame.ratio) : 1.2 * frame.ratio * frame.widthBoost;
}

function paperLine(a: Point, b: Point, role: PaperLineRole): PaperLineItem {
  return { kind: 'line', a: [a.x, a.y], b: [b.x, b.y], role, onBoundary: [false, false], hidden: false };
}

/**
 * Draw every crease with its paper pen through the shared painter, including
 * its color, width, centered dashes and auxiliary visibility. The geometry
 * stays in sheet coordinates: the pane's camera mirrors it and its picks.
 * Assignments are reversed before choosing a pen when the back faces us.
 */
export function useFoldCreasePatternStrokes(
  lines: FoldCreasePatternLines | null,
  style: PaperStyle,
  side: PaperSide = 'front'
): FoldCreasePatternStrokes | null {
  return useMemo(() => {
    if (!lines) return null;
    const bounds = boundsOf(lines.creases.flatMap(({ a, b }) => [a, b]))
      ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const strokes = (items: PaperLineItem[]) =>
      paperSceneToFoldedGeometry(
        { bounds, sheet: Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY), items },
        style,
        { policy: PAPER_STYLE_POLICIES.fold }
      ).strokes;
    const creases = strokes(
      lines.creases.map(({ a, b, color }) => {
        const viewed = foldCpViewedColor(color, side);
        const role = viewed === 'Red1' ? 'mountain' : viewed === 'Blue2' ? 'valley' : viewed === 'Black0' ? 'edge' : 'aux';
        return paperLine(a, b, role);
      })
    );
    const instruction = lines.instruction.length
      ? strokes(lines.instruction.map(({ a, b, letter }) => {
          const mountain = (letter === 'mountain') !== (side === 'back');
          return paperLine(a, b, mountain ? 'diagram-mountain' : 'diagram-valley');
        }))
      : null;
    return { creases, instruction };
  }, [lines, style, side]);
}
