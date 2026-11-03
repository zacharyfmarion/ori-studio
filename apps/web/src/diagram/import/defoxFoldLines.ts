/**
 * A saved Defox view's fold lines, kept as the Diagram's own lines when a
 * capture replaces the view (Show as, Pose).
 *
 * Defox draws the creases a step makes on the state it shows: each face's
 * new creases, `fold.UV` assigned in `fold.UA`, thick and in colour — often a
 * Defox diagram's only instruction, many of its projects having no arrows at
 * all. They are part of the saved picture, so the capture that replaces it
 * would leave them behind. Here each becomes a line on the new picture: laid
 * through the face of the capture that holds it on the paper, kept only where
 * that face is the one on top, as the picture is seen with its layers
 * unspread (a spread carries it after, with its face, as every mark is
 * carried), and named as the viewer sees it.
 *
 * Defox's names are the reverse of FOLD's — its CP reader swaps M and V and
 * its writer swaps them back (`Y.FOLD_2_CP`) — so on the paper's front `MM`
 * is a valley the step makes and `VV` a mountain. `FF` is a crease made and
 * left flat, folded and unfolded, which says no direction: drawn as the
 * valley a precrease is. A crease the step folds the other way lies on a
 * face's edge (`fold.EV`, `RM` to a valley, `RV` to a mountain) and is named
 * as the face on top of the two sees it, as Defox draws it. An edge the step
 * unfolds (`UF`) is no line a diagram draws, and is left to its arrow.
 *
 * Pure: no store, no DOM. The document reads it as it loads (`setLinkedPicture`),
 * so it imports nothing that reads the document's values as it loads: not the
 * file module.
 */
import { createAnnotation, type PictureFrame, type PicturePoint } from '../annotate/annotationModel';
import {
  randomDiagramId,
  type DiagramIdFactory,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { facePlacement, faceSpreadMove, paperFacesOf, type StepFaces } from '../zoom/zoomImprint';

type Pt = [number, number];

/**
 * A crease a saved Defox step makes, on its paper: a valley or a mountain on
 * the paper's front, or a precrease — across a face, or along the edge
 * between two that it folds the other way.
 */
export interface DefoxFoldLine {
  from: Pt;
  to: Pt;
  fold: 'valley' | 'mountain' | 'precrease';
  along: 'face' | 'edge';
}

const FACE_FOLDS: Readonly<Record<string, DefoxFoldLine['fold']>> = { MM: 'valley', VV: 'mountain', FF: 'precrease' };
const EDGE_FOLDS: Readonly<Record<string, DefoxFoldLine['fold']>> = { RM: 'valley', RV: 'mountain' };

/** The saved paper and its fold lines, as a snapshot keeps them; null for one that does not read. */
interface SavedFoldLines {
  /** The paper's box, on Defox's own sheet. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  lines: DefoxFoldLine[];
}

const isPoint = (value: unknown): value is Pt =>
  Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n));

function savedFoldLines(snapshot: string): SavedFoldLines | null {
  let saved: unknown;
  try {
    saved = JSON.parse(snapshot);
  } catch {
    return null;
  }
  const fold = (saved as { fold?: Record<string, unknown> } | null)?.fold;
  const { V, UV, UA, EV, EA } = fold ?? {};
  if (!Array.isArray(V) || !V.every(isPoint) || !Array.isArray(UV) || !Array.isArray(UA) || UA.length !== UV.length) {
    return null;
  }
  const points = V as Pt[];
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  if (!(box.maxX > box.minX) || !(box.maxY > box.minY)) return null;
  const lines: DefoxFoldLine[] = [];
  const read = (segments: unknown[], assigns: unknown[], folds: typeof FACE_FOLDS, along: DefoxFoldLine['along']) =>
    segments.forEach((ends: unknown, index) => {
      const fold = folds[String(assigns[index])];
      if (!fold || !Array.isArray(ends) || ends.length !== 2) return;
      const [a, b] = ends.map((end) => (Number.isInteger(end) ? points[end as number] : undefined));
      if (a && b && (a[0] !== b[0] || a[1] !== b[1])) lines.push({ from: [...a], to: [...b], fold, along });
    });
  read(UV, UA, FACE_FOLDS, 'face');
  if (Array.isArray(EV) && Array.isArray(EA) && EA.length === EV.length) read(EV, EA, EDGE_FOLDS, 'edge');
  return { box, lines };
}

/** The paper's box on a step's faces: every face's ring, about the paper's centre. */
function paperBox(faces: StepFaces): SavedFoldLines['box'] | null {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const ring of faces.paper) {
    for (const [x, y] of ring) {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  return box.maxX > box.minX && box.maxY > box.minY ? box : null;
}

/**
 * Where on `ring` the segment from `a` to `b` lies inside it, as runs of its
 * parameter: cut where it crosses the ring, each piece kept by its middle.
 */
function insideRuns(ring: readonly Pt[], a: Pt, b: Pt): [number, number][] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const cuts = [0, 1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [p, q] = [ring[j]!, ring[i]!];
    const [ex, ey] = [q[0] - p[0], q[1] - p[1]];
    const across = dx * ey - dy * ex;
    if (across === 0) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / across;
    const s = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / across;
    if (t > 0 && t < 1 && s >= 0 && s <= 1) cuts.push(t);
  }
  cuts.sort((x, y) => x - y);
  const runs: [number, number][] = [];
  for (let k = 1; k < cuts.length; k += 1) {
    const [t0, t1] = [cuts[k - 1]!, cuts[k]!];
    if (t1 - t0 < 1e-9) continue;
    const middle = (t0 + t1) / 2;
    if (!insideRing(ring, [a[0] + dx * middle, a[1] + dy * middle])) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] >= t0 - 1e-9) last[1] = t1;
    else runs.push([t0, t1]);
  }
  return runs;
}

function insideRing(ring: readonly Pt[], [x, y]: Pt): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Whether `face` shows at `point` on the unspread picture: no face over it
 * there — one of a lower level (`DiagramPaperFaces.levels`, the greatest
 * backmost) whose ring holds it. Levels, not the stored scene's paint order,
 * which a connected spread does not keep; where two faces overlap, the one on
 * top is the lower. A face does not cover its own edge: a crease along the
 * seam where two flaps meet over it shows, as a diagram draws it there.
 */
function shownAt(faces: StepFaces, covers: readonly Cover[], face: number, [x, y]: Pt): boolean {
  const level = faces.levels[face] ?? 0;
  for (const cover of covers) {
    if (cover.level >= level) break;
    if (x < cover.minX || x > cover.maxX || y < cover.minY || y > cover.maxY) continue;
    if (insideRing(cover.ring, [x, y]) && !nearRing(cover.ring, [x, y], faces.epsilon * 2)) return false;
  }
  return true;
}

/** Whether `point` lies within `epsilon` of `ring`'s outline. */
function nearRing(ring: readonly Pt[], [x, y]: Pt, epsilon: number): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, ay] = ring[j]!;
    const [bx, by] = ring[i]!;
    const [dx, dy] = [bx - ax, by - ay];
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= epsilon) return true;
  }
  return false;
}

/** A face that may lie over another, with its box: front first. */
interface Cover {
  level: number;
  ring: readonly Pt[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function coversOf(faces: StepFaces): Cover[] {
  const covers: Cover[] = [];
  faces.unspread.forEach((ring, face) => {
    if (ring.length < 3) return;
    const xs = ring.map(([x]) => x);
    const ys = ring.map(([, y]) => y);
    covers.push({
      level: faces.levels[face] ?? 0,
      ring,
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    });
  });
  return covers.sort((a, b) => a.level - b.level);
}

/**
 * The face in front of the two a folded edge lies between, on the paper: of
 * those holding a point `hair` to either side of its middle, the one of the
 * lower level, on top where they overlap. Null for an edge on no face.
 */
function frontFaceBeside(faces: StepFaces, [a, b]: [Pt, Pt], hair: number): number | null {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const middle: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let front: number | null = null;
  for (const side of [1, -1]) {
    const probe: Pt = [middle[0] - (dy / length) * hair * side, middle[1] + (dx / length) * hair * side];
    const face = faces.paper.findIndex((ring) => ring.length >= 3 && insideRing(ring, probe));
    if (face >= 0 && (front === null || (faces.levels[face] ?? 0) < (faces.levels[front] ?? 0))) front = face;
  }
  return front;
}

/** How many points along a stretch are looked at for what covers it, at least. */
const SAMPLES = 48;

/**
 * The runs of `[t0, t1]` where `shown` holds: looked at in even steps, each
 * end where it changes found by halving.
 */
function shownRuns(t0: number, t1: number, shown: (t: number) => boolean): [number, number][] {
  const step = (t1 - t0) / SAMPLES;
  const at = (k: number) => t0 + (k + 0.5) * step;
  const edge = (hidden: number, seen: number) => {
    let [lo, hi] = [hidden, seen];
    for (let k = 0; k < 30; k += 1) {
      const middle = (lo + hi) / 2;
      if (shown(middle)) hi = middle;
      else lo = middle;
    }
    return hi;
  };
  const runs: [number, number][] = [];
  let start: number | null = null;
  for (let k = 0; k < SAMPLES; k += 1) {
    const seen = shown(at(k));
    if (seen && start === null) start = k === 0 ? t0 : edge(at(k - 1), at(k));
    if (!seen && start !== null) {
      runs.push([start, edge(at(k), at(k - 1))]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, t1]);
  return runs;
}

interface Stretch {
  from: Pt;
  to: Pt;
  kind: 'valley-line' | 'mountain-line';
}

/**
 * The stretches with every two of one kind that lie on one line and meet or
 * overlap made one: each joined in turn by every later one it can take, pass
 * after pass until a pass joins none.
 */
function joined(stretches: Stretch[], epsilon: number): Stretch[] {
  let out = [...stretches];
  for (let merged = true; merged; ) {
    merged = false;
    const kept: Stretch[] = [];
    const taken = new Set<number>();
    for (let i = 0; i < out.length; i += 1) {
      if (taken.has(i)) continue;
      let stretch = out[i]!;
      for (let j = i + 1; j < out.length; j += 1) {
        if (taken.has(j)) continue;
        const together = joinedPair(stretch, out[j]!, epsilon);
        if (!together) continue;
        stretch = together;
        taken.add(j);
        merged = true;
      }
      kept.push(stretch);
    }
    out = kept;
  }
  return out;
}

function joinedPair(a: Stretch, b: Stretch, epsilon: number): Stretch | null {
  if (a.kind !== b.kind) return null;
  const [dx, dy] = [a.to[0] - a.from[0], a.to[1] - a.from[1]];
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const [ux, uy] = [dx / length, dy / length];
  const along = ([x, y]: Pt) => (x - a.from[0]) * ux + (y - a.from[1]) * uy;
  const off = ([x, y]: Pt) => Math.abs((x - a.from[0]) * uy - (y - a.from[1]) * ux);
  if (off(b.from) > epsilon || off(b.to) > epsilon) return null;
  const [b0, b1] = [along(b.from), along(b.to)].sort((x, y) => x - y) as [number, number];
  if (b0 > length + epsilon || b1 < -epsilon) return null;
  const [lo, hi] = [Math.min(0, b0), Math.max(length, b1)];
  const point = (s: number): Pt => [a.from[0] + ux * s, a.from[1] + uy * s];
  return { from: point(lo), to: point(hi), kind: a.kind };
}

/** The shortest line kept, in picture units: anything shorter is what covering faces leave of one. */
const SHORTEST = 0.002;

/**
 * The fold lines `snapshot`'s saved Defox step draws, as lines on `step`'s
 * picture — the capture that replaces it: a flat fold's, or a crease
 * pattern's, whose faces are on the paper. Empty for any other picture, a
 * snapshot that does not read, or a paper whose shape is not the snapshot's.
 */
export function defoxFoldLineMarks(
  snapshot: string,
  step: DiagramStep,
  newId: DiagramIdFactory = randomDiagramId
): KnownDiagramAnnotation[] {
  const faces = paperFacesOf(step);
  const saved = faces ? savedFoldLines(snapshot) : null;
  const box = faces && paperBox(faces);
  if (!faces || !saved || !box || saved.lines.length === 0) return [];
  // Defox's sheet onto the capture's paper: only scaled, as Defox writes its CP and the import places it.
  const scale = (box.maxX - box.minX) / (saved.box.maxX - saved.box.minX);
  if (Math.abs((box.maxY - box.minY) / (saved.box.maxY - saved.box.minY) / scale - 1) > 1e-6) return [];
  const onPaper = ([x, y]: Pt): Pt => [
    (box.minX + box.maxX) / 2 + (x - (saved.box.minX + saved.box.maxX) / 2) * scale,
    (box.minY + box.maxY) / 2 + (y - (saved.box.minY + saved.box.maxY) / 2) * scale,
  ];
  const covers = coversOf(faces);
  const stretches: Stretch[] = [];
  /** `line`'s runs laid through `face`: each where it shows, onto the spread with its face. */
  const lay = (line: DefoxFoldLine, face: number, [a, b]: [Pt, Pt], runs: readonly [number, number][]) => {
    const placement = facePlacement(faces, face);
    if (!placement) return;
    // As the viewer sees it: a face showing its back shows each fold the other way.
    const valley = line.fold === 'precrease' || (line.fold === 'valley') !== placement.reflected;
    const kind = valley ? 'valley-line' : 'mountain-line';
    const at = (t: number) => placement.apply([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    const level = faces.levels[face] ?? 0;
    for (const [t0, t1] of runs) {
      // Only the faces in front of this one whose box the stretch meets can cover it.
      const [p, q] = [at(t0), at(t1)];
      const near = covers.filter(
        (cover) =>
          cover.level < level &&
          cover.maxX >= Math.min(p[0], q[0]) &&
          cover.minX <= Math.max(p[0], q[0]) &&
          cover.maxY >= Math.min(p[1], q[1]) &&
          cover.minY <= Math.max(p[1], q[1])
      );
      for (const [s0, s1] of shownRuns(t0, t1, (t) => shownAt(faces, near, face, at(t)))) {
        stretches.push({ from: faceSpreadMove(faces, face, at(s0)), to: faceSpreadMove(faces, face, at(s1)), kind });
      }
    }
  };
  const hair = 1e-4 * Math.max(box.maxX - box.minX, box.maxY - box.minY);
  for (const line of saved.lines) {
    const ends: [Pt, Pt] = [onPaper(line.from), onPaper(line.to)];
    if (line.along === 'edge') {
      const face = frontFaceBeside(faces, ends, hair);
      if (face !== null) lay(line, face, ends, [[0, 1]]);
      continue;
    }
    faces.paper.forEach((ring, face) => {
      if (ring.length < 3) return;
      const runs = insideRuns(ring, ...ends);
      if (runs.length > 0) lay(line, face, ends, runs);
    });
  }
  const { minX, minY, maxX, maxY } = faces.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  if (!(unit > 0)) return [];
  const frame: PictureFrame = { width: (maxX - minX) / unit, height: (maxY - minY) / unit };
  const inPicture = ([x, y]: Pt): PicturePoint => [(x - minX) / unit, (y - minY) / unit];
  return joined(stretches, faces.epsilon * 2)
    .filter(({ from, to }) => Math.hypot(to[0] - from[0], to[1] - from[1]) >= SHORTEST * unit)
    .map(({ from, to, kind }) => createAnnotation(kind, inPicture(from), inPicture(to), frame, newId));
}
