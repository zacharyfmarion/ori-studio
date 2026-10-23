/** Compare material effects, including flat precreases and internal layer order. */
import type { Point } from '../../lib/geometry';
import { applyIsometry, polygonArea, polygonCentroid, toPair } from '../canvas/foldCanvasGeometry';
import type { FoldModelLine } from '../document/foldSequenceDocument';
import type { FoldIsometry, FoldScene } from '../engine/foldEngineWire';
import {
  compose,
  correspondingFrame,
  faceAt,
  mappedPoint,
  modelMap,
  orderPairs,
  overlap,
  reflection,
  REPEAT_TOL,
  RepeatFailure,
  sameImages,
  sheetRing,
  sideSign,
  verifiedSymmetry,
  type RepeatSide,
  type RepeatSymmetry,
} from './repeatGeometry';

const AREA = 1e-12;
/** The native operations refine faces; import/history operations need their own adapter. */
export function changedFaces(before: FoldScene, after: FoldScene): number[] {
  return after.faces.flatMap((_, i) => {
    const ring = sheetRing(after, i);
    return before.faces.some((__, j) => {
      const part = overlap(ring, sheetRing(before, j));
      return polygonArea(part) > AREA && !sameImages(modelMap(after, i), modelMap(before, j), part);
    })
      ? [i]
      : [];
  });
}

/**
 * Repeat's test of a mirrored step, whatever its family: the step that
 * landed `ta` from `tb` did to the mirrored paper what the source step did
 * from `before` to `after`, reflected by the sheet map `map`.
 *
 * - **Pose**: the paper the source moved lands where its mirror says, and no
 *   other paper moves.
 * - **Layer order**: every pair the source's moved paper takes part in is
 *   ordered among the mirrored faces as the source's, kept on the same side
 *   and reversed behind (`side`), as the viewer sees each state.
 * - **Creases**: the step's new creases are the source's reflected through
 *   the axis, each with the same assignment on the paper, and it changes no
 *   other crease.
 *
 * A mirrored step that lands any other way is refused.
 */
export function verifyMaterial(
  before: FoldScene,
  after: FoldScene,
  tb: FoldScene,
  ta: FoldScene,
  map: FoldIsometry,
  side: RepeatSide = 'same',
): void {
  const changed = new Set(changedFaces(before, after));
  for (const i of changed) {
    const ring = sheetRing(after, i);
    for (let old = 0; old < before.faces.length; old++) {
      const sourcePart = overlap(ring, sheetRing(before, old));
      if (polygonArea(sourcePart) < AREA) continue;
      const mapped = sourcePart.map((p) => applyIsometry(map, p));
      for (let t = 0; t < tb.faces.length; t++) {
        const targetPart = overlap(mapped, sheetRing(tb, t));
        if (polygonArea(targetPart) < AREA) continue;
        const at = mappedPoint(map, toPair(polygonCentroid(targetPart)));
        const expected = compose(correspondingFrame(before, tb, map, at), compose(modelMap(after, i), map));
        for (let j = 0; j < ta.faces.length; j++) {
          const part = overlap(targetPart, sheetRing(ta, j));
          if (polygonArea(part) > AREA && !sameImages(expected, modelMap(ta, j), part))
            throw new RepeatFailure('repeat_material');
        }
      }
    }
  }
  for (const j of changedFaces(tb, ta)) {
    const inverse = sheetRing(ta, j).map((p) => applyIsometry(map, p));
    for (let i = 0; i < after.faces.length; i++) {
      if (!changed.has(i) && polygonArea(overlap(inverse, sheetRing(after, i))) > AREA)
        throw new RepeatFailure('repeat_extra_material');
    }
  }
  // Compare ordered material patches, not face numbers or silhouette.
  const pairs = orderPairs(ta);
  const owners = after.faces.map((_, i) => {
    const polygon = sheetRing(after, i).map((p) => applyIsometry(map, p));
    return ta.faces.flatMap((__, j) => (polygonArea(overlap(polygon, sheetRing(ta, j))) > AREA ? [j] : []));
  });
  const flip = (after.view.flipped === ta.view.flipped ? 1 : -1) * sideSign(side);
  for (const [key, sign] of orderPairs(after)) {
    const [a, b] = key.split(':').map(Number) as [number, number];
    if (!changed.has(a) && !changed.has(b)) continue;
    for (const x of owners[a]!)
      for (const y of owners[b]!) {
        const actual = pairs.get(`${Math.min(x, y)}:${Math.max(x, y)}`);
        if (actual !== undefined && actual !== sign * flip * (x < y ? 1 : -1))
          throw new RepeatFailure('repeat_order');
      }
  }
  verifyCreases(before, after, tb, ta, map);
}

interface Segment {
  a: Point;
  b: Point;
  value: string;
}
function segments(s: FoldScene): Segment[] {
  return [
    ...s.creases.map((c) => ({ a: c.from, b: c.to, value: `${c.kind}:${c.letter}` })),
    ...(s.crease_marks ?? []).map((c) => ({ a: c.from, b: c.to, value: `flat:${c.letter}` })),
  ];
}
function parameter(s: Segment, p: Point): number | null {
  const x = s.b.x - s.a.x,
    y = s.b.y - s.a.y,
    length = Math.hypot(x, y);
  if (length < 1e-10 || Math.abs(x * (p.y - s.a.y) - y * (p.x - s.a.x)) > 1e-7 * length) return null;
  return ((p.x - s.a.x) * x + (p.y - s.a.y) * y) / (length * length);
}
function valueAt(all: Segment[], p: Point): string {
  return [
    ...new Set(
      all
        .filter((s) => {
          const t = parameter(s, p);
          return t !== null && t > -1e-7 && t < 1 + 1e-7;
        })
        .map((s) => s.value),
    ),
  ]
    .sort()
    .join('|');
}
/**
 * A crease's fold angle on the paper, front-relative, from its value at a
 * point (`valueAt`): +180 folded valley, −180 folded mountain, 0 flat or no
 * crease; null for anything else (an edge, or several creases at once).
 */
function foldAngle(value: string): number | null {
  if (value === '' || value === 'flat:valley' || value === 'flat:mountain') return 0;
  if (value === 'fold:valley') return 180;
  if (value === 'fold:mountain') return -180;
  return null;
}

function verifyCreases(before: FoldScene, after: FoldScene, tb: FoldScene, ta: FoldScene, map: FoldIsometry) {
  const mapped = (scene: FoldScene) =>
    segments(scene).map((s) => ({ ...s, a: applyIsometry(map, s.a), b: applyIsometry(map, s.b) }));
  const sb = mapped(before),
    sa = mapped(after),
    b = segments(tb),
    a = segments(ta);
  const all = [...sb, ...sa, ...b, ...a];
  if (all.length > 2400) throw new RepeatFailure('repeat_limit');
  // Refine each supporting line once. Rechecking every overlapping segment
  // independently makes a dense precrease history cubic in its subdivisions.
  const groups: { basis: Segment; sets: Segment[][] }[] = [];
  for (const [setIndex, set] of [sb, sa, b, a].entries())
    for (const segment of set) {
      let group = groups.find(
        (g) => parameter(g.basis, segment.a) !== null && parameter(g.basis, segment.b) !== null,
      );
      if (!group) {
        group = { basis: segment, sets: [[], [], [], []] };
        groups.push(group);
      }
      group.sets[setIndex]!.push(segment);
    }
  // A crease on the axis is its own mirror, the hinge between the two sides:
  // the source step turns the paper on its side about it and the repeated
  // step the paper on the other, so where the source changed it, the
  // repeated step changes it again — a squash beside the axis lays it flat,
  // its mirror folds it the other way. What carries over is the change of
  // its fold angle (`foldAngle`): the repeated step must turn it as far, and
  // the same way, as the source did (a valley folded flat, then folded on to
  // a mountain). A fold the source made along the axis cannot be turned as
  // far again, so its mirror — its own paper folded back over — is refused;
  // a precrease the source made along it is its own mirror, left as it is.
  const onAxis = (p: Point) => {
    const q = applyIsometry(map, p);
    return Math.hypot(q.x - p.x, q.y - p.y) < 1e-7;
  };
  for (const { basis, sets } of groups) {
    const ts = sets
      .flatMap((set) => set.flatMap((s) => [parameter(basis, s.a)!, parameter(basis, s.b)!]))
      .sort((x, y) => x - y);
    for (let i = 1; i < ts.length; i++) {
      if (ts[i]! - ts[i - 1]! < 1e-7) continue;
      const t = (ts[i]! + ts[i - 1]!) / 2;
      const p = { x: basis.a.x + t * (basis.b.x - basis.a.x), y: basis.a.y + t * (basis.b.y - basis.a.y) };
      const [old, next, was, now] = sets.map((set) => valueAt(set, p)) as [string, string, string, string];
      if (old !== next && onAxis(p)) {
        const turned = [old, next, was, now].map(foldAngle);
        if (turned.some((angle) => angle === null)) throw new RepeatFailure('repeat_creases');
        const [o, n, w, a] = turned as [number, number, number, number];
        // Not turned, only made or relettered flat: its own mirror, left as it is.
        if (n === o ? now !== was : a - w !== n - o) throw new RepeatFailure('repeat_creases');
        continue;
      }
      if (old !== next ? was !== old || now !== next : was !== now) throw new RepeatFailure('repeat_creases');
    }
  }
}

/** The creases the step that landed `scene` made — the newest — as sheet segments. */
function newestCreases(scene: FoldScene): Segment[] {
  const all = [...scene.creases.filter((crease) => crease.kind !== 'border'), ...(scene.crease_marks ?? [])];
  const newest = all.reduce((latest, crease) => Math.max(latest, crease.made_at), 0);
  return newest > 0
    ? all.filter((crease) => crease.made_at === newest).map((crease) => ({ a: crease.from, b: crease.to, value: '' }))
    : [];
}

/**
 * The reflections that could take line `a` onto line `b`, in sheet
 * coordinates: across either bisector where they cross; across the line
 * midway between them where they are parallel; across the perpendicular
 * midway between the two where they are one line (two pinches on it).
 */
function axesBetween(a: Segment, b: Segment): FoldModelLine[] {
  const unit = (s: Segment): Point => {
    const x = s.b.x - s.a.x,
      y = s.b.y - s.a.y,
      l = Math.hypot(x, y);
    return { x: x / l, y: y / l };
  };
  const u = unit(a),
    v = unit(b);
  const across = u.x * v.y - u.y * v.x;
  const through = (n: Point, p: Point): FoldModelLine => ({ n: [n.x, n.y], d: n.x * p.x + n.y * p.y });
  if (Math.abs(across) < REPEAT_TOL) {
    const n = { x: -u.y, y: u.x };
    const da = n.x * a.a.x + n.y * a.a.y,
      db = n.x * b.a.x + n.y * b.a.y;
    if (Math.abs(da - db) > REPEAT_TOL) return [{ n: [n.x, n.y], d: (da + db) / 2 }];
    const mid = (s: Segment): Point => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });
    const [ma, mb] = [mid(a), mid(b)];
    return [through(u, { x: (ma.x + mb.x) / 2, y: (ma.y + mb.y) / 2 })];
  }
  // Where the lines cross: a.a + s·u, solved against b's line.
  const s = ((b.a.x - a.a.x) * v.y - (b.a.y - a.a.y) * v.x) / across;
  const at = { x: a.a.x + s * u.x, y: a.a.y + s * u.y };
  return [
    { x: u.x + v.x, y: u.y + v.y },
    { x: u.x - v.x, y: u.y - v.y },
  ].map((direction) => {
    const l = Math.hypot(direction.x, direction.y);
    return through({ x: -direction.y / l, y: direction.x / l }, at);
  });
}

/** Whether every segment of `from`, reflected by `map`, lies along `onto`'s: its middle on one of them. */
function liesAlong(from: readonly Segment[], onto: readonly Segment[], map: FoldIsometry): boolean {
  return from.every((segment) => {
    const middle = applyIsometry(map, { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 });
    return onto.some((target) => {
      const t = parameter(target, middle);
      return t !== null && t > -1e-7 && t < 1 + 1e-7;
    });
  });
}

/**
 * The symmetry a step mirrors the one before it across, both landed one
 * after the other from `before` (`first`, then `second`): Repeat's own test
 * of a mirrored step, asked of two steps the author made by hand. The axes
 * tried are the ones that take the first step's newest crease onto the
 * second's, and only where each step's creases, mirrored, lie along the
 * other's; each is then the whole state's symmetry (`verifiedSymmetry`, as
 * Repeat checks the axis it is given) across which the first's effect,
 * mirrored, is the second's (`verifyMaterial`, as a prepared Repeat checks
 * each step it mirrors). Null when no axis is, or the states are past what
 * Repeat checks.
 */
export function mirroredStepAxis(before: FoldScene, first: FoldScene, second: FoldScene): RepeatSymmetry | null {
  const [made, mirrored] = [newestCreases(first), newestCreases(second)];
  if (made.length === 0 || mirrored.length === 0) return null;
  for (const axis of axesBetween(made[0]!, mirrored[0]!)) {
    try {
      const map = reflection(axis);
      if (!liesAlong(made, mirrored, map) || !liesAlong(mirrored, made, map)) continue;
      const symmetry = verifiedSymmetry(before, axis);
      // Two precreases mirrored on one side merge into one Diagram step; a
      // pair front and back stays two, as it always has.
      if (!symmetry || symmetry.side !== 'same') continue;
      verifyMaterial(before, first, first, second, map);
      return symmetry;
    } catch (error) {
      if (!(error instanceof RepeatFailure)) throw error;
    }
  }
  return null;
}

/** Interior witnesses of material that moved, for compounds whose API has no plain analysis. */
export function movingWitnesses(before: FoldScene, after: FoldScene) {
  return changedFaces(before, after).map((i) => {
    const point = toPair(polygonCentroid(sheetRing(after, i)));
    faceAt(before, point);
    return point;
  });
}
