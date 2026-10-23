/** Presentation of both pleat creases on the starting paper; no folding or order decisions. */
import type { FoldModelLine } from '../../document/foldSequenceDocument';
import type { FoldActionGeometry, FoldLineSpan, FoldScene } from '../../engine/foldEngineWire';
import { chordOfConvex, clipConvex, pointOnLine, sideOf, transformLine } from '../../canvas/foldCanvasGeometry';

/** The valley's stretches on selected material, classified by the starting pose's visible layers. */
export function pleatValleySpans(
  scene: FoldScene,
  moving: readonly number[],
  first: FoldModelLine,
  second: FoldModelLine,
  side: 1 | -1,
): FoldLineSpan[] {
  const a = transformLine(scene.view_transform, first);
  const b = transformLine(scene.view_transform, second);
  const selected = new Set(moving);
  const moves = (face: number) => selected.has(scene.lineage[face]!.id);
  const runs = scene.subfaces.flatMap((cell) => {
    if (!cell.faces_top_to_bottom.some(moves)) return [];
    const chord = chordOfConvex(clipConvex(cell.polygon, a, side), b);
    return chord ? [{ lo: chord[0], hi: chord[1], hidden: !moves(cell.faces_top_to_bottom[0]!) }] : [];
  });
  // Cells touching along the line can overlap in parameter space. Split at
  // their endpoints, give visible ink priority, then join adjacent equal runs.
  const ends = [...new Set(runs.flatMap((run) => [run.lo, run.hi]))].sort((x, y) => x - y);
  const merged: { lo: number; hi: number; hidden: boolean }[] = [];
  for (let i = 1; i < ends.length; i++) {
    const lo = ends[i - 1]!, hi = ends[i]!;
    if (hi - lo < 1e-9) continue;
    const mid = (lo + hi) / 2;
    const covering = runs.filter((run) => run.lo <= mid && run.hi >= mid);
    if (!covering.length) continue;
    const hidden = covering.every((run) => run.hidden);
    const last = merged.at(-1);
    if (last && last.hidden === hidden && Math.abs(last.hi - lo) < 1e-9) last.hi = hi;
    else merged.push({ lo, hi, hidden });
  }
  return merged.map(({ lo, hi, hidden }) => ({ from: pointOnLine(b, lo), to: pointOnLine(b, hi), hidden, direction: 'valley' }));
}

/** A local normal bisector, oriented from mountain to valley, independent of line endpoint order. */
export function pleatArrow(
  first: FoldModelLine,
  second: FoldModelLine,
  spans: readonly FoldLineSpan[],
): FoldActionGeometry['pleat'] {
  const length = (span: FoldLineSpan) => Math.hypot(span.to.x - span.from.x, span.to.y - span.from.y);
  const visible = spans.filter((span) => !span.hidden);
  const span = [...(visible.length ? visible : spans)].sort((a, b) => length(b) - length(a))[0];
  if (!span) return undefined;
  // Off-centre keeps the arrow clear of a common central seam. Anchor on the
  // narrower valley span so the annotation stays over the pleated flap.
  const at = { x: span.from.x * 0.38 + span.to.x * 0.62, y: span.from.y * 0.38 + span.to.y * 0.62 };
  const aligned = first.n[0] * second.n[0] + first.n[1] * second.n[1] < 0 ? -1 : 1;
  const nx = first.n[0] + aligned * second.n[0], ny = first.n[1] + aligned * second.n[1];
  const norm = Math.hypot(nx, ny);
  if (norm < 1e-9) return undefined;
  const sign = sideOf(first, at) < 0 ? -1 : 1;
  const direction = { x: sign * nx / norm, y: sign * ny / norm };
  const gap = sideOf(first, at) / (first.n[0] * direction.x + first.n[1] * direction.y);
  if (!(gap > 1e-9)) return undefined;
  const margin = Math.max(gap * 0.75, length(span) * 0.08);
  return {
    from: { x: at.x - direction.x * (gap + margin), y: at.y - direction.y * (gap + margin) },
    to: { x: at.x + direction.x * margin, y: at.y + direction.y * margin },
    kinks: 1,
  };
}
