/**
 * A step's picture with its lines left out where a line mark is drawn along
 * them (`implementation-plans/diagram-annotate-lines-under-marks.md`): a
 * dashed fold line drawn over a crease showed the crease through every gap
 * between its dashes, and no longer read as dashed. A diagram leaves the
 * crease out where the fold line is drawn; so does every surface here that
 * draws a step's marks over its picture.
 *
 * Only the stretch a mark lies along goes: a valley line along half a long
 * precrease takes that half, and the rest is drawn as it was. An edge goes as
 * a crease does — a fold line is often drawn where two flaps' raw edges meet
 * — so the paper's outline has a gap only where a mark is drawn in it.
 * Nothing else changes — a scene keeps its bounds, so its frame, and so every
 * mark on it and every page it is laid out on, stays where it was.
 *
 * Pure: no DOM, no store.
 */
import type { PaperFaceItem, PaperItem, PaperLineItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { faceOutlineLines } from '../../lib/paper/paperSvg';
import { uncoveredSpans } from '../../lib/uncoveredSpans';

/** A point as a mark's ends are kept: in picture units, the frame's longer side one, y down. */
export type MarkPoint = readonly [number, number];

/**
 * The line marks drawn over a step's picture along lines of it
 * (`linesUnderMarks`): each one's ends in picture units, how near a line of
 * the picture counts as under one, in the same units, and a key that two sets
 * share exactly when they leave out the same.
 */
export interface CoveringMarks {
  lines: readonly (readonly [MarkPoint, MarkPoint])[];
  tolerance: number;
  key: string;
}

/** A mark as the filter tests it, in scene px. */
interface SceneMark {
  a: ScenePoint;
  b: ScenePoint;
  length: number;
  box: readonly [number, number, number, number];
}

/**
 * The lines of `scene` a mark drawn along one leaves out, in scene px, as they
 * are drawn: every line some pixel shows — an aux line only where `auxDrawn` —
 * and each side of a face that strokes its own outline. What a mark is tried
 * against before a picture is painted under it ({@link sceneUnderMarks}), so
 * a mark along none of them paints nothing new.
 */
export function hideableSceneLines(scene: PaperScene, auxDrawn: boolean): (readonly [ScenePoint, ScenePoint])[] {
  const drawn = (role: PaperLineItem['role']) => auxDrawn || role !== 'aux';
  const lines: (readonly [ScenePoint, ScenePoint])[] = [];
  for (const item of scene.items) {
    if (item.hidden) continue;
    if (item.kind === 'line' && drawn(item.role)) lines.push([item.a, item.b]);
    else if (item.kind === 'face' && item.outline !== undefined && drawn(item.outline)) {
      for (const side of faceOutlineLines(item)) lines.push([side.a, side.b]);
    }
  }
  return lines;
}

/**
 * A stored scene under the marks over it: its frame is its bounds
 * (`stepPictureFrame`), so a picture unit is the bounds' longer side in
 * scene px. The scene itself where none is given or none covers a line.
 */
export function storedSceneUnderMarks(scene: PaperScene, covering: CoveringMarks | null | undefined): PaperScene {
  if (!covering || covering.lines.length === 0) return scene;
  const { minX, minY, maxX, maxY } = scene.bounds;
  const longer = Math.max(maxX - minX, maxY - minY);
  if (!(longer > 0)) return scene;
  const toScene = ([x, y]: MarkPoint): ScenePoint => [minX + x * longer, minY + y * longer];
  return sceneUnderMarks(scene, covering, toScene, longer);
}

/**
 * `scene` with every stretch of a line that one of `covering`'s marks lies
 * along left out: `toScene` puts a picture unit's point in the scene, where
 * one unit is `unitPx` across. A line lies under a mark where the shorter of
 * the two lies on the other's line, within the tolerance, and they overlap by
 * more than it. Each part of a line that is left keeps the crease it is a
 * piece of, so erode still measures on the crease, and a cut end is the
 * pen's own end, joined to nothing. A face that strokes its own outline — a
 * flat fold gives one to a face whose sides all take one pen, most often the
 * edge's — gives it up for a line per side, right after it, as a flat fold
 * emits a face with lines of its own, so that one side can go and the rest
 * stay. The scene itself, the same object, when no line lies under any of
 * them.
 */
export function sceneUnderMarks(
  scene: PaperScene,
  covering: CoveringMarks,
  toScene: (point: MarkPoint) => ScenePoint,
  unitPx: number
): PaperScene {
  const tolerance = covering.tolerance * unitPx;
  const marks = covering.lines.flatMap(([from, to]) => sceneMark(toScene(from), toScene(to), tolerance));
  if (marks.length === 0) return scene;
  let changed = false;
  const items: PaperItem[] = [];
  for (const item of scene.items) {
    if (item.kind === 'line') {
      const left = lineLeft(item, marks, tolerance);
      if (left === null) items.push(item);
      else {
        items.push(...left);
        changed = true;
      }
    } else if (item.kind === 'face' && item.outline !== undefined && nearAMark(item, marks)) {
      const sides = outlineSides(item);
      const lefts = sides.map((side) => lineLeft(side, marks, tolerance));
      if (lefts.every((left) => left === null)) {
        items.push(item);
        continue;
      }
      const { outline: _outline, ...face } = item;
      items.push(face);
      lefts.forEach((left, index) => items.push(...(left ?? [sides[index]!])));
      changed = true;
    } else items.push(item);
  }
  return changed ? { ...scene, items } : scene;
}

/** A mark in scene px, or nothing for one no longer than the tolerance: it lies along every line through its point. */
function sceneMark(a: ScenePoint, b: ScenePoint, tolerance: number): SceneMark[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(length > tolerance)) return [];
  const box = [
    Math.min(a[0], b[0]) - tolerance,
    Math.min(a[1], b[1]) - tolerance,
    Math.max(a[0], b[0]) + tolerance,
    Math.max(a[1], b[1]) + tolerance,
  ] as const;
  return [{ a, b, length, box }];
}

/**
 * Whether any of `marks` comes within a face's box: a flat fold outlines
 * nearly every face, and one no mark comes near keeps its outline without its
 * sides being read.
 */
function nearAMark(face: PaperFaceItem, marks: readonly SceneMark[]): boolean {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of face.rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return marks.some(({ box }) => maxX >= box[0] && minX <= box[2] && maxY >= box[1] && minY <= box[3]);
}

/**
 * The lines a face's outline stands for, in its pen, each joined at both
 * ends as the flat fold joins a face's lines that share one role, in its
 * group if it has one, so the file still holds them with it.
 */
function outlineSides(face: PaperFaceItem): PaperLineItem[] {
  return faceOutlineLines(face).map((side) => ({
    ...side,
    joined: [true, true],
    ...(face.group !== undefined ? { group: face.group } : {}),
  }));
}

/**
 * What is left of `line` under `marks`: null where none lies along it, so
 * the line is kept as it is; else its parts no mark covers, none when they
 * cover all of it.
 */
function lineLeft(line: PaperLineItem, marks: readonly SceneMark[], tolerance: number): PaperLineItem[] | null {
  const [ax, ay] = line.a;
  const [bx, by] = line.b;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (!(length > tolerance)) return null;
  const covered: (readonly [number, number])[] = [];
  for (const mark of marks) {
    const [minX, minY, maxX, maxY] = mark.box;
    if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(ay, by) < minY || Math.min(ay, by) > maxY) continue;
    // The shorter on the longer's line: run on past the shorter's ends, a stored point's rounding would tilt it.
    const along =
      length <= mark.length
        ? offLine(line.a, mark.a, mark.b, mark.length) <= tolerance && offLine(line.b, mark.a, mark.b, mark.length) <= tolerance
        : offLine(mark.a, line.a, line.b, length) <= tolerance && offLine(mark.b, line.a, line.b, length) <= tolerance;
    if (!along) continue;
    const at = ([x, y]: ScenePoint) => ((x - ax) * dx + (y - ay) * dy) / (length * length);
    const [u, v] = [at(mark.a), at(mark.b)];
    const overlap = (Math.min(1, Math.max(u, v)) - Math.max(0, Math.min(u, v))) * length;
    if (overlap > tolerance) covered.push([u, v]);
  }
  if (covered.length === 0) return null;
  return uncoveredSpans(covered, tolerance / length).map(([start, end]) => linePart(line, start, end));
}

/** How far `point` lies off the line through `a` and `b`, `length` apart. */
function offLine([x, y]: ScenePoint, [ax, ay]: ScenePoint, [bx, by]: ScenePoint, length: number): number {
  return Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / length;
}

/**
 * The part of `line` from `start` to `end` along it: its own ends where it
 * reaches them, with their flags; a cut end the pen's own, which neither
 * retreats under erode nor joins another line. The crease it is a piece of is
 * kept — the line's, or the line itself — so erode measures on the crease, as
 * it does for a piece the tree cut.
 */
function linePart(line: PaperLineItem, start: number, end: number): PaperLineItem {
  const point = (t: number): ScenePoint =>
    t === 0 ? line.a : t === 1 ? line.b : [line.a[0] + (line.b[0] - line.a[0]) * t, line.a[1] + (line.b[1] - line.a[1]) * t];
  const [fromStart, toEnd] = [start === 0, end === 1];
  return {
    ...line,
    a: point(start),
    b: point(end),
    onBoundary: [fromStart && line.onBoundary[0], toEnd && line.onBoundary[1]],
    whole: line.whole ?? { a: line.a, b: line.b, onBoundary: line.onBoundary },
    ...(line.joined ? { joined: [fromStart && line.joined[0], toEnd && line.joined[1]] } : {}),
  };
}
