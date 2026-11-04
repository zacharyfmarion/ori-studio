import { faceLineSegments, faceWeights, type Point3, type Triangle } from '@oristudio/layer-spread';
import { sourcePoint, type ConnectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import type { PaperItem, PaperLineItem } from '../lib/paper/paperScene';
interface Sample {
  ids: Triangle;
  weights: Point3;
}
interface PreparedInk {
  line: PaperLineItem;
  face: number;
  ids: Triangle;
  a: Point3;
  b: Point3;
  wholeA: Sample | null;
  wholeB: Sample | null;
  joined: [boolean, boolean];
}
const cache = new WeakMap<ConnectedSpreadSource, WeakMap<readonly PaperItem[], PreparedInk[]>>();

/** Ink's material-space interpolation never changes with amount, reveal or
 * camera. Split and locate it once, then only interpolate during a frame. */
export function preparedInk(source: ConnectedSpreadSource, items: readonly PaperItem[]): PreparedInk[] {
  let byInk = cache.get(source);
  if (!byInk) {
    byInk = new WeakMap();
    cache.set(source, byInk);
  }
  const cached = byInk.get(items);
  if (cached) return cached;
  const result: PreparedInk[] = [];
  for (const line of items) {
    if (line.kind !== 'line' || line.face === undefined) continue;
    const { face, whole } = line;
    const at = (p: readonly number[]) => faceWeights(source.input, face, sourcePoint(source, { x: p[0]!, y: p[1]! }));
    const wholeA = whole ? at(whole.a) : null,
      wholeB = whole ? at(whole.b) : null;
    const from = sourcePoint(source, { x: line.a[0], y: line.a[1] }),
      to = sourcePoint(source, { x: line.b[0], y: line.b[1] });
    for (const segment of faceLineSegments(source.input, face, from, to))
      result.push({
        line: { ...line, onBoundary: [segment.lo === 0 && line.onBoundary[0], segment.hi === 1 && line.onBoundary[1]] },
        face,
        ids: segment.ids,
        a: segment.wa,
        b: segment.wb,
        wholeA,
        wholeB,
        joined: [segment.lo > 0 || line.joined?.[0] === true, segment.hi < 1 || line.joined?.[1] === true],
      });
  }
  byInk.set(items, result);
  return result;
}
