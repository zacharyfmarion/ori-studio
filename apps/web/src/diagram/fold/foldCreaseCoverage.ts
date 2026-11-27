import { alongLine, lineThrough, sideOf } from '../../fold/canvas/foldCanvasGeometry';
import type { FoldScene, FoldSceneCreaseMark } from '../../fold/engine/foldEngineWire';
import type { FoldStateFrame } from '../../fold/sequence/foldStateFrame';
import { uncoveredSpans } from '../../lib/uncoveredSpans';

type Pattern = Pick<FoldScene | FoldStateFrame, 'creases' | 'crease_marks'>;
type Segment = Pick<FoldSceneCreaseMark, 'from' | 'to' | 'made_at'>;
const TOL = 1e-6; // Fold's tolerance in sheet coordinates.

function coveredByMarks({ from, to }: Segment, marks: readonly Segment[]): boolean {
  const line = lineThrough(from, to);
  if (!line) return true;
  const start = alongLine(line, from);
  const length = alongLine(line, to) - start;
  const intervals: [number, number][] = [];
  for (const mark of marks) {
    if (Math.abs(sideOf(line, mark.from)) > TOL || Math.abs(sideOf(line, mark.to)) > TOL) continue;
    intervals.push([(alongLine(line, mark.from) - start) / length, (alongLine(line, mark.to) - start) / length]);
  }
  return uncoveredSpans(intervals, TOL / length).length === 0;
}

/** Splitting or refolding a crease preserves its creation step. A new edge or mark
 * can also take the place of older partial marks along the same stretch of paper. */
export function entirelyPrecreased(before: Pattern, after: Pattern): boolean {
  const marks = before.crease_marks ?? [];
  let latest = 0;
  for (const crease of before.creases.values()) latest = Math.max(latest, crease.made_at);
  for (const mark of marks) latest = Math.max(latest, mark.made_at);
  const isNew = (segment: Segment) => segment.made_at > latest && (marks.length === 0 || !coveredByMarks(segment, marks));
  for (const crease of after.creases.values()) {
    if (crease.kind !== 'border' && isNew(crease)) return false;
  }
  return !after.crease_marks?.some(isNew);
}
