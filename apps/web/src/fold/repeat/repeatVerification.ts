/** Compare material effects, including flat precreases and internal layer order. */
import type { Point } from '../../lib/geometry';
import { applyIsometry, invertIsometry, polygonArea, polygonCentroid, toPair } from '../canvas/foldCanvasGeometry';
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
  sameIsometry,
  sheetRing,
  sideSign,
  turnsOver,
  verifiedSymmetry,
  type RepeatSide,
  type RepeatSymmetry,
} from './repeatGeometry';

const AREA = 1e-12;

/**
 * How a repeated step's creases must match its source's (`verifyCreases`):
 * `exact`, each crease it changes held the source's value before the step —
 * Repeat's own test; `angles`, held as far folded, so an old flat crease and
 * fresh paper are alike — for steps folded by hand, one along a crease an
 * earlier step left and its mirror across fresh paper.
 */
export type RepeatCreaseTest = 'exact' | 'angles';

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
 * A mirrored step that lands any other way is refused — unless, refused for
 * where its paper lies, it lands as the mirror says measured against other
 * paper the source moved alike (`heldGauge`). Which it passed is returned.
 *
 * `map` may be any isometry of the sheet, a turn as well as a reflection;
 * only a reflection has an axis to hold paper on one side of, so only it is
 * measured again against held paper.
 */
export function verifyMaterial(
  before: FoldScene,
  after: FoldScene,
  tb: FoldScene,
  ta: FoldScene,
  map: FoldIsometry,
  side: RepeatSide = 'same',
  creases: RepeatCreaseTest = 'exact',
): RepeatMeasure {
  try {
    verifyMirrored(before, after, tb, ta, map, side, null, creases);
    return 'unmoved';
  } catch (error) {
    if (!(error instanceof RepeatFailure) || !MISPLACED.has(error.code) || !turnsOver(map)) throw error;
    const gauge = heldGauge(before, after, tb, ta, map);
    if (!gauge) throw error;
    try {
      verifyMirrored(before, after, tb, ta, map, side, gauge, creases);
    } catch (again) {
      // Refused again, the step is refused as it first was.
      throw again instanceof RepeatFailure ? error : again;
    }
    return 'held';
  }
}

/**
 * What a mirrored step passed measured against: the paper the source step
 * left in place, or other paper it moved all alike (`heldGauge`).
 */
export type RepeatMeasure = 'unmoved' | 'held';

/** The refusals of paper landed, or moved, other than the source's mirror says: those a gauge can answer. */
const MISPLACED = new Set(['repeat_material', 'repeat_extra_material']);

/**
 * Two steps measured against paper each moved alike, put back where it lay
 * before its step (`heldGauge`): `after` and `ta` so placed, and how the
 * target's pairs of layers read against the source's — reversed where both
 * turned that paper over: the target then folds paper the source left seen
 * from its back.
 */
interface HeldGauge {
  after: FoldScene;
  ta: FoldScene;
  order: 1 | -1;
}

function verifyMirrored(
  before: FoldScene,
  after: FoldScene,
  tb: FoldScene,
  ta: FoldScene,
  map: FoldIsometry,
  side: RepeatSide,
  gauge: HeldGauge | null,
  creases: RepeatCreaseTest,
): void {
  // A gauge changes only where each face lies: its pose and what moved.
  const [moved, landed] = gauge ? [gauge.after, gauge.ta] : [after, ta];
  // The target's paper back to the source's: a reflection's own map, a turn's the other way round.
  const back = invertIsometry(map);
  const changed = new Set(changedFaces(before, moved));
  for (const i of changed) {
    const ring = sheetRing(after, i);
    for (let old = 0; old < before.faces.length; old++) {
      const sourcePart = overlap(ring, sheetRing(before, old));
      if (polygonArea(sourcePart) < AREA) continue;
      const mapped = sourcePart.map((p) => applyIsometry(map, p));
      for (let t = 0; t < tb.faces.length; t++) {
        const targetPart = overlap(mapped, sheetRing(tb, t));
        if (polygonArea(targetPart) < AREA) continue;
        const at = mappedPoint(back, toPair(polygonCentroid(targetPart)));
        const expected = compose(correspondingFrame(before, tb, map, at), compose(modelMap(moved, i), back));
        for (let j = 0; j < ta.faces.length; j++) {
          const part = overlap(targetPart, sheetRing(ta, j));
          if (polygonArea(part) > AREA && !sameImages(expected, modelMap(landed, j), part))
            throw new RepeatFailure('repeat_material');
        }
      }
    }
  }
  for (const j of changedFaces(tb, landed)) {
    const inverse = sheetRing(ta, j).map((p) => applyIsometry(back, p));
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
  const flip = (after.view.flipped === ta.view.flipped ? 1 : -1) * sideSign(side) * (gauge?.order ?? 1);
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
  verifyCreases(before, after, tb, ta, map, creases);
}

/**
 * The source step seen holding other paper still. The side a fold moves is
 * the engine's to say (a pleat moves the side of its line that holds its
 * second line), and it is often the big side, across the axis. Its mirror
 * then moves paper the source moved too, and measured against the paper the
 * source left in place (the frame is read point by point,
 * `correspondingFrame`), no rigid fold lands it. Held still instead, one of
 * the source's motions can leave the paper that moves on one side of the
 * axis: both steps are then measured so, the target holding the mirror of
 * that paper where `tb` had it. Turns and slides are tried before
 * turn-overs; null when none qualifies, or the source's moved paper lies
 * clear of its own mirror.
 */
function heldGauge(before: FoldScene, after: FoldScene, tb: FoldScene, ta: FoldScene, map: FoldIsometry): HeldGauge | null {
  const changed = changedFaces(before, after);
  if (onOneSide(after, changed, map) || !overliesItsMirror(after, changed, map)) return null;
  for (const { motion, paper } of motions(before, after, changed)) {
    const held = regauged(after, invertIsometry(motion));
    const moving = changedFaces(before, held);
    // All the moved paper held still leaves nothing to measure: any rigid motion would pass.
    if (!moving.length || !onOneSide(held, moving, map)) continue;
    const back = putBack(tb, ta, paper.map((p) => applyIsometry(map, p)));
    // A mirror turns that paper over as the source did; one that holds it
    // still instead is the same shape turned over, and no mirror of the step.
    if (!back || turnsOver(back) !== turnsOver(motion)) return null;
    return { after: held, ta: regauged(ta, back), order: turnsOver(back) ? -1 : 1 };
  }
  return null;
}

/** The distinct motions of the paper a step moved, each with a piece it moved so: turns and slides first. */
function motions(before: FoldScene, after: FoldScene, changed: readonly number[]) {
  const found: { motion: FoldIsometry; paper: Point[] }[] = [];
  for (const i of changed) {
    const ring = sheetRing(after, i);
    for (let old = 0; old < before.faces.length; old++) {
      const paper = overlap(ring, sheetRing(before, old));
      if (polygonArea(paper) < AREA || sameImages(modelMap(after, i), modelMap(before, old), paper)) continue;
      const motion = compose(modelMap(after, i), invertIsometry(modelMap(before, old)));
      if (!found.some((each) => sameIsometry(each.motion, motion))) found.push({ motion, paper });
    }
  }
  return [...found.filter((each) => !turnsOver(each.motion)), ...found.filter((each) => turnsOver(each.motion))];
}

/** `scene` with every face moved by `g` in the model frame: the same state, other paper held still. */
function regauged(scene: FoldScene, g: FoldIsometry): FoldScene {
  return {
    ...scene,
    face_transforms: scene.faces.map((_, i) => compose(scene.view_transform, compose(g, modelMap(scene, i)))),
  };
}

/** The motion putting `ta`'s paper over the sheet polygon `paper` back where `tb` had it, read through one face of each. */
function putBack(tb: FoldScene, ta: FoldScene, paper: readonly Point[]): FoldIsometry | null {
  for (let j = 0; j < ta.faces.length; j++) {
    const part = overlap(paper, sheetRing(ta, j));
    if (polygonArea(part) < AREA) continue;
    const t = tb.faces.findIndex((_, k) => polygonArea(overlap(part, sheetRing(tb, k))) > AREA);
    if (t >= 0) return compose(modelMap(tb, t), invertIsometry(modelMap(ta, j)));
  }
  return null;
}

/** Whether every one of `faces` lies on one side of the axis `map` reflects across, touching it at most. */
function onOneSide(scene: FoldScene, faces: readonly number[], map: FoldIsometry): boolean {
  let side: Point | null = null;
  for (const i of faces)
    for (const p of sheetRing(scene, i)) {
      const q = applyIsometry(map, p);
      const across = { x: p.x - q.x, y: p.y - q.y };
      if (Math.hypot(across.x, across.y) < REPEAT_TOL) continue;
      if (!side) side = across;
      else if (side.x * across.x + side.y * across.y < 0) return false;
    }
  return true;
}

/** Whether paper of `faces` lies over the mirror of paper of theirs. */
function overliesItsMirror(scene: FoldScene, faces: readonly number[], map: FoldIsometry): boolean {
  const rings = faces.map((i) => sheetRing(scene, i));
  return rings.some((ring) => {
    const mirrored = ring.map((p) => applyIsometry(map, p));
    return rings.some((other) => polygonArea(overlap(mirrored, other)) > AREA);
  });
}

/** A crease of a scene as a sheet segment, with its value (`kind:letter`). */
export interface CreaseSegment {
  a: Point;
  b: Point;
  value: string;
}
function segments(s: FoldScene): CreaseSegment[] {
  return [
    ...s.creases.map((c) => ({ a: c.from, b: c.to, value: `${c.kind}:${c.letter}` })),
    ...(s.crease_marks ?? []).map((c) => ({ a: c.from, b: c.to, value: `flat:${c.letter}` })),
  ];
}
function parameter(s: CreaseSegment, p: Point): number | null {
  const x = s.b.x - s.a.x,
    y = s.b.y - s.a.y,
    length = Math.hypot(x, y);
  if (length < 1e-10 || Math.abs(x * (p.y - s.a.y) - y * (p.x - s.a.x)) > 1e-7 * length) return null;
  return ((p.x - s.a.x) * x + (p.y - s.a.y) * y) / (length * length);
}
function valueAt(all: CreaseSegment[], p: Point): string {
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

function verifyCreases(
  before: FoldScene,
  after: FoldScene,
  tb: FoldScene,
  ta: FoldScene,
  map: FoldIsometry,
  creases: RepeatCreaseTest,
) {
  // What a crease the step changes held before it, alike on both sides: the same value, or with `angles` as far folded.
  const heldAlike = (was: string, old: string) =>
    was === old || (creases === 'angles' && foldAngle(was) !== null && foldAngle(was) === foldAngle(old));
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
  const groups: { basis: CreaseSegment; sets: CreaseSegment[][] }[] = [];
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
      if (old !== next ? !heldAlike(was, old) || now !== next : was !== now) throw new RepeatFailure('repeat_creases');
    }
  }
}

/** The creases the step that landed `scene` made — the newest — as sheet segments. */
function newestCreases(scene: FoldScene): CreaseSegment[] {
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
function axesBetween(a: CreaseSegment, b: CreaseSegment): FoldModelLine[] {
  const unit = (s: CreaseSegment): Point => {
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
    const mid = (s: CreaseSegment): Point => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });
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
function liesAlong(from: readonly CreaseSegment[], onto: readonly CreaseSegment[], map: FoldIsometry): boolean {
  return from.every((segment) => {
    const middle = applyIsometry(map, { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 });
    return onto.some((target) => {
      const t = parameter(target, middle);
      return t !== null && t > -1e-7 && t < 1 + 1e-7;
    });
  });
}

const middleOf = (s: CreaseSegment): Point => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });

/** `pieces`, each line's run together: pieces on one line that touch or overlap become one segment. */
function joined(pieces: readonly CreaseSegment[]): CreaseSegment[] {
  const out: CreaseSegment[] = [];
  const left = [...pieces];
  while (left.length) {
    const basis = left.shift()!;
    const along = [basis];
    for (let k = left.length - 1; k >= 0; k -= 1) {
      const piece = left[k]!;
      if (parameter(basis, piece.a) !== null && parameter(basis, piece.b) !== null) along.push(...left.splice(k, 1));
    }
    const spans = along
      .map((piece) => [parameter(basis, piece.a)!, parameter(basis, piece.b)!].sort((x, y) => x - y) as [number, number])
      .sort((x, y) => x[0] - y[0]);
    const at = (t: number): Point => ({ x: basis.a.x + t * (basis.b.x - basis.a.x), y: basis.a.y + t * (basis.b.y - basis.a.y) });
    let [start, end] = spans[0]!;
    for (const [from, to] of spans.slice(1)) {
      if (from <= end + 1e-7) {
        end = Math.max(end, to);
        continue;
      }
      out.push({ a: at(start), b: at(end), value: basis.value });
      [start, end] = [from, to];
    }
    out.push({ a: at(start), b: at(end), value: basis.value });
  }
  return out;
}

/**
 * The creases the step from `before` to `after` changed — made, refolded or
 * unfolded — as sheet segments, each line's pieces run together: the lines a
 * step folds along, made by it or not. A fold along a crease an earlier step
 * left makes none, so the newest `made_at` would name that step's.
 */
export function changedCreases(before: FoldScene, after: FoldScene): CreaseSegment[] {
  const creased = (scene: FoldScene) =>
    segments(scene).filter(
      (s) => !s.value.startsWith('border:') && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > REPEAT_TOL,
    );
  const [was, now] = [creased(before), creased(after)];
  return joined(now.filter((segment) => valueAt(was, middleOf(segment)) !== valueAt(now, middleOf(segment))));
}

/**
 * The turns of the sheet that take segment `a` onto `b`, end for end either
 * way, its middle onto the other's; none where the two only slide, which no
 * sheet repeats onto itself.
 */
function turnsBetween(a: CreaseSegment, b: CreaseSegment): FoldIsometry[] {
  const turns: FoldIsometry[] = [];
  const from = middleOf(a),
    to = middleOf(b);
  for (const [p, q] of [
    [b.a, b.b],
    [b.b, b.a],
  ] as const) {
    const angle = Math.atan2(q.y - p.y, q.x - p.x) - Math.atan2(a.b.y - a.a.y, a.b.x - a.a.x);
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    if (1 - c < REPEAT_TOL) continue;
    turns.push([c, -s, to.x - (c * from.x - s * from.y), s, c, to.y - (s * from.x + c * from.y)]);
  }
  return turns;
}

/** How one step repeats another: its mirror image, or the same fold turned. */
export type StepRelation = 'mirror' | 'turn';

/**
 * How the step that landed `ta` from `tb` repeats the step that landed
 * `after` from `before`, the two folded by hand and measured each on its own
 * state: its mirror image across some line of the sheet, or the same fold
 * turned about some point — the paper it moves, where that paper lands, its
 * layers and its creases, by Repeat's own test (`verifyMaterial`), creases
 * held alike as far as they were folded (`angles`). The paper elsewhere need
 * not be symmetric: two flaps folded alike are alike wherever they are.
 *
 * The maps tried take the source's first changed line (`changedCreases`)
 * onto one of the target's, kept only where each step's lines, so mapped,
 * lie along the other's — cheap, so a pair that plainly does not repeat
 * costs next to nothing. Mirrors are tried first. Null when neither, or the
 * states are past what Repeat checks.
 */
export function stepRelation(before: FoldScene, after: FoldScene, tb: FoldScene, ta: FoldScene): StepRelation | null {
  const [source, target] = [changedCreases(before, after), changedCreases(tb, ta)];
  if (source.length === 0 || target.length === 0) return null;
  const repeats = (map: FoldIsometry) => {
    if (!liesAlong(source, target, map) || !liesAlong(target, source, map)) return false;
    try {
      verifyMaterial(before, after, tb, ta, map, 'same', 'angles');
      return true;
    } catch (error) {
      if (error instanceof RepeatFailure) return false;
      throw error;
    }
  };
  const first = source[0]!;
  for (const other of target) {
    for (const axis of axesBetween(first, other)) {
      let mirror: FoldIsometry;
      try {
        mirror = reflection(axis);
      } catch (error) {
        if (error instanceof RepeatFailure) continue;
        throw error;
      }
      if (repeats(mirror)) return 'mirror';
    }
  }
  for (const other of target) {
    for (const turn of turnsBetween(first, other)) if (repeats(turn)) return 'turn';
  }
  return null;
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
