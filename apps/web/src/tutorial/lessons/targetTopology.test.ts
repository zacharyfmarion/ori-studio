import { describe, expect, it } from 'vitest';
import { LESSON_TARGETS } from '../targets';

/**
 * `.cp` cannot express a vertex.
 *
 * It is a flat list of segments, so two creases written as whole lines *cross*
 * without meeting: no vertex is created where they intersect, and the paper's
 * boundary is not split where a crease reaches it. The engine loads that exactly
 * as written, and the foldability checker then reports violations at those
 * points — errors that have nothing to do with the pattern the lesson is
 * teaching, sitting in red on the canvas while the user tries to follow along.
 *
 * A pattern drawn in the editor never has this problem, because drawing splits
 * as it goes. So the rule is: any target with an interior crossing must be
 * authored as `.fold`, by drawing it and exporting.
 *
 * This checks the geometry directly rather than through the engine, so it runs
 * without wasm and fails at the point the bad file is added.
 */

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function segmentsOf(cp: string): Segment[] {
  return cp
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [, ax, ay, bx, by] = line.split(/\s+/).map(Number);
      return { ax, ay, bx, by };
    });
}

const EPSILON = 1e-6;

function sharesEndpoint(p: Segment, q: Segment): boolean {
  const points: Array<[number, number]> = [
    [p.ax, p.ay],
    [p.bx, p.by],
  ];
  const others: Array<[number, number]> = [
    [q.ax, q.ay],
    [q.bx, q.by],
  ];
  return points.some(([x, y]) =>
    others.some(([ox, oy]) => Math.abs(x - ox) < EPSILON && Math.abs(y - oy) < EPSILON)
  );
}

/**
 * True when the two segments meet at a point interior to at least one of them —
 * the case `.cp` cannot represent. Segments that merely touch end-to-end are
 * fine, and so is a T-junction only if the crossed segment is already split
 * there, which is what `.fold` records and `.cp` cannot.
 */
function crossesAwayFromEndpoints(p: Segment, q: Segment): boolean {
  const rx = p.bx - p.ax;
  const ry = p.by - p.ay;
  const sx = q.bx - q.ax;
  const sy = q.by - q.ay;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < EPSILON) return false; // parallel or collinear

  const t = ((q.ax - p.ax) * sy - (q.ay - p.ay) * sx) / denominator;
  const u = ((q.ax - p.ax) * ry - (q.ay - p.ay) * rx) / denominator;
  const within = (v: number) => v > EPSILON && v < 1 - EPSILON;
  const onSegment = (v: number) => v > -EPSILON && v < 1 + EPSILON;
  // Interior to p, or interior to q — either way a vertex is needed there.
  return (within(t) && onSegment(u)) || (within(u) && onSegment(t));
}

/**
 * Targets known to predate this rule, with the foldability errors each currently
 * shows on the canvas (measured in the running app, not guessed). They should be
 * redrawn in the editor and exported as `.fold`; this list must only ever shrink.
 *
 * `both-diagonals` reports no errors despite being degenerate — there is no
 * vertex at its crossing, so the checker has nothing to check. It still belongs
 * here: it is the reason that lesson's target and the user's own drawing differ
 * in structure.
 */
const PENDING_REDRAW = new Set([
  'both-diagonals', // 0 errors, but no centre vertex
  'inscribed-square', // 4
  'perpendicular-start', // 2
  'perpendicular-done', // 4
  'bisector-start', // 3
  'bisector-done', // 3
  'parallel-done', // 2
  'mirror-start', // 1
  'mirror-done', // 2
  'maekawa-broken', // 4 — deliberate, this one is the diagnostics lesson
]);

describe('target topology', () => {
  it('has no .cp target with an interior crossing, except those pending a redraw', () => {
    const offenders: string[] = [];
    for (const target of LESSON_TARGETS) {
      if (target.format !== 'cp') continue;
      const segments = segmentsOf(target.text);
      const crossing = segments.some((p, i) =>
        segments.some((q, j) => j > i && !sharesEndpoint(p, q) && crossesAwayFromEndpoints(p, q))
      );
      if (crossing && !PENDING_REDRAW.has(target.id)) offenders.push(target.id);
    }
    expect(
      offenders,
      'these .cp targets cross without a vertex — draw them in the editor and export .fold'
    ).toEqual([]);
  });

  it('keeps the pending-redraw list honest', () => {
    const ids = new Set(LESSON_TARGETS.map((target) => target.id));
    const stale = [...PENDING_REDRAW].filter((id) => !ids.has(id));
    expect(stale, 'listed as pending redraw but no longer a target').toEqual([]);
  });
});
