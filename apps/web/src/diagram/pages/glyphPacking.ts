import type { Lane, LanePoint } from './flowLane';
import { curvePoint, curveStart } from './flowLane';
import { partBox, type PageBox } from './pagePlacement';
import type { LayoutCell } from './diagramPageLayout';

/** Find clear room on the actual ribbon; hand placements may leave no clear point. */
export function glyphSpot(input: {
  preferred: LanePoint;
  before?: LayoutCell;
  after?: LayoutCell;
  cells: readonly LayoutCell[];
  lane: Lane | null;
  paper: { w: number; h: number };
  occupied: readonly PageBox[];
  sizeAt: (point: LanePoint) => { w: number; h: number };
}): LanePoint {
  const { preferred, before, after, paper } = input;
  const boxes = [
    ...input.occupied,
    ...input.cells.flatMap((cell) => (['number', 'picture', 'text'] as const).map((part) => partBox(cell, part))),
  ];
  const candidates = input.lane && before && after ? [] : [preferred];
  if (input.lane && before && after) {
    const centre = (cell: LayoutCell) => ({
      x: cell.drawMm.x + cell.drawMm.w / 2,
      y: cell.drawMm.y + cell.drawMm.h / 2,
    });
    const a = centre(before),
      b = centre(after);
    const lane = input.lane;
    let between = false;
    lane.curves.forEach((curve, index) => {
      const from = curveStart(lane, index);
      if (Math.hypot(from.x - a.x, from.y - a.y) < 0.01) between = true;
      if (between) for (let n = 1; n < 40; n++) candidates.push(curvePoint(from, curve, n / 40));
      if (Math.hypot(curve.to.x - b.x, curve.to.y - b.y) < 0.01) between = false;
    });
  }
  const score = (point: LanePoint) => {
    const size = input.sizeAt(point),
      x = point.x - size.w / 2,
      y = point.y - size.h / 2;
    let overlap =
      Math.max(0, -x) + Math.max(0, -y) + Math.max(0, x + size.w - paper.w) + Math.max(0, y + size.h - paper.h);
    for (const box of boxes) {
      if (!box.w || !box.h) continue;
      const w = Math.min(x + size.w + 1, box.x + box.w) - Math.max(x - 1, box.x);
      const h = Math.min(y + size.h + 1, box.y + box.h) - Math.max(y - 1, box.y);
      if (w > 0 && h > 0) overlap += w * h;
    }
    return overlap * 10000 + Math.hypot(point.x - preferred.x, point.y - preferred.y);
  };
  let best = preferred,
    bestScore = Infinity;
  for (const point of candidates) {
    const value = score(point);
    if (value < bestScore) {
      best = point;
      bestScore = value;
    }
  }
  // A leading/trailing symbol has no connecting segment. Move along its edge
  // until a tall stack clears the number/caption while staying on the paper.
  if (!before || !after)
    for (let offset = 2; offset <= 40; offset += 2)
      for (const sign of [-1, 1]) {
        const point = { x: preferred.x, y: preferred.y + sign * offset },
          value = score(point);
        if (value < bestScore) {
          best = point;
          bestScore = value;
        }
      }
  const size = input.sizeAt(best);
  return {
    x: Math.max(size.w / 2, Math.min(paper.w - size.w / 2, best.x)),
    y: Math.max(size.h / 2, Math.min(paper.h - size.h / 2, best.y)),
  };
}
