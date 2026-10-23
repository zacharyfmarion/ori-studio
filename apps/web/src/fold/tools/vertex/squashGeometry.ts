/**
 * A squash's flap on the folded pane, from the engine's description of it
 * (`FoldSquashAnalysis`, the compound question's answer for a squash op):
 * both of its layers — and about a drawn hinge only the end on the flap's
 * side of it, the part that squashes. The canvas lights it under the pointer
 * before the flap is clicked (`useFoldSquashMarks`).
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../../lib/geometry';
import type { FoldModelLine } from '../../document/foldSequenceDocument';
import type { FoldSquashAnalysis } from '../../engine/foldEngineSquashWire';
import { flipLine, lineThrough, sideOf, toPoint } from '../../canvas/foldCanvasGeometry';
import type { FoldPickIndex } from '../../canvas/foldPicking';
import { facesRegionOnFolded } from './petalGeometry';

/** A drawn hinge on the folded pane, its positive side the flap's: where the spine runs from the vertex. */
function flapSide(index: FoldPickIndex, analysis: FoldSquashAnalysis): FoldModelLine | null {
  const at = (p: readonly [number, number], d: readonly [number, number] = [0, 0]) =>
    index.toScene(toPoint([p[0] + d[0], p[1] + d[1]]));
  const line = lineThrough(at(analysis.vertex), at(analysis.vertex, analysis.hinge_direction));
  if (!line) return null;
  return sideOf(line, at(analysis.vertex, analysis.spine_direction)) >= 0 ? line : flipLine(line);
}

/** The flap's layers on the folded pane; about a drawn hinge (`drawn`), cut to its side of it. */
export function squashRegionOnFolded(index: FoldPickIndex, analysis: FoldSquashAnalysis, drawn: boolean): Point[][] {
  const side = drawn ? flapSide(index, analysis) : null;
  if (drawn && !side) return [];
  return facesRegionOnFolded(index, [...analysis.upper, ...analysis.lower], side ? [side] : []);
}

/** Two answers naming one flap: the same layers about the same vertex. */
export function sameSquashFlap(a: FoldSquashAnalysis, b: FoldSquashAnalysis): boolean {
  const same = (x: readonly number[], y: readonly number[]) => x.length === y.length && x.every((f, k) => f === y[k]);
  return (
    same(a.upper, b.upper) &&
    same(a.lower, b.lower) &&
    Math.hypot(a.vertex[0] - b.vertex[0], a.vertex[1] - b.vertex[1]) < 1e-9
  );
}
