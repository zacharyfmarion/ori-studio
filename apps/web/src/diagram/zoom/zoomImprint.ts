/**
 * An enlarged step's frame imprinted on the paper and landed on a step's
 * picture (Revision 2, `implementation-plans/diagram-revision-2.md`,
 * "Capturing a frame: the imprint").
 *
 * A frame is laid on the paper through one face of its own step — its anchor
 * face — and drawn on another step where that paper lies, through the face
 * that holds the anchor's point there, turned and mirrored with it. Both
 * happen on the two pictures with their spread taken off, and the landed frame
 * then follows its step's spread by its centre: the two stages Zach chose
 * after 16.0, which every measured refold lands within 1.36% of its diameter.
 *
 * Terms, as the plan's:
 * - **paper coordinates**: pattern units about the centre of the paper's box;
 * - **the unspread picture**: a step's picture as its pose draws it, with no
 *   spread, in scene px;
 * - **a face's placement**: the similarity from the paper to the unspread
 *   picture fitted to its corners, reflected when the face shows its back;
 * - **a face's drawn ring**: its whole ring in the stored scene when the step
 *   is spread, its unspread ring when not;
 * - **a face's spread move**: where the spread takes a point of it — its mean
 *   value coordinates over its unspread ring, the same weights over its drawn
 *   ring, which is the painter's own field exactly;
 * - **onto the spread**: an unspread point, by the move of the face on top
 *   there unspread; **off the spread**: the unspread point that onto takes to
 *   a drawn one, solved rather than fitted.
 *
 * Everything here is in scene px or on the paper. Frames are stored in picture
 * units; {@link toScene} and {@link toPicture} convert.
 *
 * Pure but for one memo per picture object ({@link paperFacesOf}).
 */
import { meanValueWeights } from '../../cp-workspace/folded/foldedLayerSpread';
import type { PaperScene, SceneBounds } from '../../lib/paper/paperScene';
import { turnClockwise } from '../../lib/geometry';
import { rectangleAngle, type PicturePoint } from '../annotate/annotationModel';
import { CAPTURE_PX_PER_UNIT, storedSceneStep } from '../capture/captureGeometry';
import type { DiagramScenePicture, DiagramStep, DiagramZoomOutline } from '../document/diagramDocument';
import { readPaperFaces } from '../document/diagramFile';
import { storedScene } from '../pictures/pictureFrame';
import { distanceOutside, distanceToSegment, zoomCore, zoomShapeOf } from './zoomModel';

type Pt = PicturePoint;

/** A step's faces as anchoring reads them. */
export interface StepFaces {
  /** A flat fold's faces, or a crease pattern's one face, the paper. */
  kind: 'flat' | 'crease-pattern';
  /** Per face, its ring on the paper; empty for a face the kernel could not name. */
  paper: Pt[][];
  /** Per face, its ring on the unspread picture, scene px. */
  unspread: Pt[][];
  /** Per face, its ring as drawn, scene px: the stored scene's when the step is spread, else its unspread ring. */
  drawn: Pt[][];
  /** Per face, the faces stacked over it as the picture is seen: the greatest is backmost. */
  levels: number[];
  /** Whether the picture is spread; with none, off and onto the spread are the identity. */
  spread: boolean;
  /** Whole faces, back to front, in the stored scene's paint order. */
  order: number[];
  /** Every one-ring face item the stored scene paints, back to front — woven patches too — each by its face. */
  pieces: { face: number; ring: Pt[] }[];
  /** The picture's frame in scene px: the stored scene's bounds. */
  bounds: SceneBounds;
  /** Within this many scene px a point is on a ring: a few of the stored scene's steps. */
  epsilon: number;
}

const memo = new WeakMap<DiagramScenePicture, { render: string; faces: StepFaces | null }>();

/**
 * A step's faces: a flat fold's stored `paperFaces`, a crease pattern's one
 * face — the paper — from its render; null for a step with no faces to anchor
 * to (3D, simulated, References, an upload, a fixed or raster picture, a flat
 * capture made before it kept them, none at all). Read once per picture.
 */
export function paperFacesOf(step: DiagramStep): StepFaces | null {
  const { picture, source } = step;
  if (step.unknown || picture?.kind !== 'scene' || source?.kind !== 'cp') return null;
  const { render } = source;
  if (render.mode !== 'folded-flat' && render.mode !== 'crease-pattern') return null;
  const key = JSON.stringify(render);
  const cached = memo.get(picture);
  if (cached?.render === key) return cached.faces;
  const scene = storedScene(picture);
  let faces: StepFaces | null = null;
  if (scene) {
    faces =
      render.mode === 'crease-pattern'
        ? creasePatternFaces(scene, render.rotationDeg)
        : flatFaces(scene, picture.paperFaces, render.spread !== undefined);
  }
  memo.set(picture, { render: key, faces });
  return faces;
}

/** The face items a stored scene paints in one ring, in order. */
function piecesOf(scene: PaperScene): { face: number; ring: Pt[] }[] {
  const pieces: { face: number; ring: Pt[] }[] = [];
  for (const item of scene.items) {
    if (item.kind === 'face' && item.rings.length === 1) pieces.push({ face: item.face, ring: item.rings[0]! as Pt[] });
  }
  return pieces;
}

function sceneEpsilon(scene: PaperScene): number {
  const { minX, minY, maxX, maxY } = scene.bounds;
  return Math.max(1e-9 * Math.max(maxX - minX, maxY - minY), 2 * storedSceneStep(scene.sheet));
}

function flatFaces(scene: PaperScene, stored: string | undefined, spread: boolean): StepFaces | null {
  const read = stored === undefined ? null : readPaperFaces(stored);
  if (!read || typeof read === 'symbol') return null;
  const { points, rings, levels } = read.faces;
  const pieces = piecesOf(scene);
  const whole = new Map<number, Pt[]>();
  const order: number[] = [];
  for (const { face, ring } of pieces) {
    if (whole.has(face)) continue;
    whole.set(face, ring);
    order.push(face);
  }
  const unspread = rings.map((ring) => ring.map((index): Pt => [points[index]![2], points[index]![3]]));
  return {
    kind: 'flat',
    paper: rings.map((ring) => ring.map((index): Pt => [points[index]![0], points[index]![1]])),
    unspread,
    drawn: unspread.map((ring, face) => {
      if (!spread) return ring;
      const drawn = whole.get(face);
      return drawn && drawn.length === ring.length ? drawn : [];
    }),
    levels: [...levels],
    spread,
    order,
    pieces,
    bounds: scene.bounds,
    epsilon: sceneEpsilon(scene),
  };
}

/**
 * A crease pattern's one face: the paper, placed as `creasePatternScene`
 * places it — about its centre, turned, at the capture scale, on either
 * side's colour alike — so its ring on the paper is its drawn ring with that
 * undone.
 */
function creasePatternFaces(scene: PaperScene, rotationDeg: number): StepFaces | null {
  let ring: Pt[] | null = null;
  for (const item of scene.items) {
    if (item.kind !== 'face' || item.face !== 0) continue;
    for (const each of item.rings)
      if (!ring || Math.abs(ringArea(each as Pt[])) > Math.abs(ringArea(ring))) ring = each as Pt[];
  }
  if (!ring || ring.length < 3) return null;
  const unturn = turnClockwise(-rotationDeg);
  const paper = ring.map(([x, y]): Pt => {
    const p = unturn({
      x: x / CAPTURE_PX_PER_UNIT,
      y: y / CAPTURE_PX_PER_UNIT,
    });
    return [p.x, p.y];
  });
  return {
    kind: 'crease-pattern',
    paper: [paper],
    unspread: [ring],
    drawn: [ring],
    levels: [0],
    spread: false,
    order: [0],
    pieces: [{ face: 0, ring }],
    bounds: scene.bounds,
    epsilon: sceneEpsilon(scene),
  };
}

/* --------------------------------------------------------------------------
 * Picture units and scene px
 * ----------------------------------------------------------------------- */

/** The picture's frame's longer side in scene px: one picture unit. */
function unitOf(bounds: SceneBounds): number {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

/** An outline in picture units, in scene px. */
export function toScene(faces: Pick<StepFaces, 'bounds'>, outline: DiagramZoomOutline): DiagramZoomOutline {
  const unit = unitOf(faces.bounds);
  return scaled(
    outline,
    [faces.bounds.minX + outline.centre[0] * unit, faces.bounds.minY + outline.centre[1] * unit],
    unit
  );
}

/** An outline in scene px, in picture units. */
export function toPicture(faces: Pick<StepFaces, 'bounds'>, outline: DiagramZoomOutline): DiagramZoomOutline {
  const unit = unitOf(faces.bounds);
  return scaled(
    outline,
    [(outline.centre[0] - faces.bounds.minX) / unit, (outline.centre[1] - faces.bounds.minY) / unit],
    1 / unit
  );
}

/** A point in picture units, in scene px. */
export function pointToScene(faces: Pick<StepFaces, 'bounds'>, [u, v]: Pt): Pt {
  const unit = unitOf(faces.bounds);
  return [faces.bounds.minX + u * unit, faces.bounds.minY + v * unit];
}

/** An outline about a new centre, its sizes times `by`, its turn kept. */
function scaled(outline: DiagramZoomOutline, centre: Pt, by: number): DiagramZoomOutline {
  return {
    centre,
    ...(outline.radius !== undefined ? { radius: outline.radius * by } : {}),
    ...(outline.size !== undefined
      ? {
          size: [outline.size[0] * by, outline.size[1] * by] as [number, number],
        }
      : {}),
    ...(outline.angle !== undefined ? { angle: outline.angle } : {}),
  };
}

/* --------------------------------------------------------------------------
 * A face's placement
 * ----------------------------------------------------------------------- */

/**
 * A similarity of the plane, as complex numbers: `q = a·p + b`, or
 * `q = a·p̄ + b` when it reflects.
 */
export interface Placement {
  a: Pt;
  b: Pt;
  reflected: boolean;
  /** How much it scales: |a|. */
  scale: number;
  apply(point: Pt): Pt;
  invert(point: Pt): Pt;
  /** A direction carried by it: its linear part. */
  applyVector(vector: Pt): Pt;
  invertVector(vector: Pt): Pt;
}

function similarity(a: Pt, b: Pt, reflected: boolean): Placement {
  const linear = ([x, y]: Pt): Pt => {
    const yy = reflected ? -y : y;
    return [a[0] * x - a[1] * yy, a[0] * yy + a[1] * x];
  };
  const unlinear = ([x, y]: Pt): Pt => {
    const s2 = a[0] * a[0] + a[1] * a[1];
    const px = (a[0] * x + a[1] * y) / s2;
    const py = (a[0] * y - a[1] * x) / s2;
    return [px, reflected ? -py : py];
  };
  return {
    a,
    b,
    reflected,
    scale: Math.hypot(a[0], a[1]),
    apply: (point) => {
      const [x, y] = linear(point);
      return [x + b[0], y + b[1]];
    },
    invert: ([x, y]) => unlinear([x - b[0], y - b[1]]),
    applyVector: linear,
    invertVector: unlinear,
  };
}

/**
 * The sign of the least-squares affine map's determinant from one ring to
 * another — below 0, it reflects: the map is C·S⁻¹, S the rings' spread
 * (positive definite), so its sign is that of det C, their cross term.
 */
function affineDeterminant(from: readonly Pt[], to: readonly Pt[]): number {
  const n = from.length;
  const mean = (ring: readonly Pt[]): Pt => [
    ring.reduce((s, p) => s + p[0], 0) / n,
    ring.reduce((s, p) => s + p[1], 0) / n,
  ];
  const [f, t] = [mean(from), mean(to)];
  let [c0, c1, c2, c3] = [0, 0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const [fx, fy] = [from[i]![0] - f[0], from[i]![1] - f[1]];
    const [tx, ty] = [to[i]![0] - t[0], to[i]![1] - t[1]];
    c0 += tx * fx;
    c1 += tx * fy;
    c2 += ty * fx;
    c3 += ty * fy;
  }
  return c0 * c3 - c1 * c2;
}

/**
 * The similarity taking `paper` onto `picture`, fitted by least squares over
 * every corner — reflected when the affine fit is (the face shows its back) —
 * as complex numbers: a = Σ (q − q̄)·conj(p − p̄) / Σ |p − p̄|².
 */
export function fitPlacement(paper: readonly Pt[], picture: readonly Pt[]): Placement | null {
  const n = paper.length;
  if (n < 2 || picture.length !== n) return null;
  const reflected = affineDeterminant(paper, picture) < 0;
  const p = paper.map(([x, y]): Pt => [x, reflected ? -y : y]);
  const mean = (ring: readonly Pt[]): Pt => [
    ring.reduce((s, q) => s + q[0], 0) / n,
    ring.reduce((s, q) => s + q[1], 0) / n,
  ];
  const [pm, qm] = [mean(p), mean(picture)];
  let [re, im, norm] = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const [px, py] = [p[i]![0] - pm[0], p[i]![1] - pm[1]];
    const [qx, qy] = [picture[i]![0] - qm[0], picture[i]![1] - qm[1]];
    re += qx * px + qy * py;
    im += qy * px - qx * py;
    norm += px * px + py * py;
  }
  if (!(norm > 0)) return null;
  const a: Pt = [re / norm, im / norm];
  const b: Pt = [qm[0] - (a[0] * pm[0] - a[1] * pm[1]), qm[1] - (a[0] * pm[1] + a[1] * pm[0])];
  return similarity(a, b, reflected);
}

/** A face's placement on its step: its ring on the paper onto its ring on the unspread picture. */
export function facePlacement(faces: StepFaces, face: number): Placement | null {
  const paper = faces.paper[face];
  return paper && paper.length >= 3 ? fitPlacement(paper, faces.unspread[face]!) : null;
}

/* --------------------------------------------------------------------------
 * The spread
 * ----------------------------------------------------------------------- */

/** Mean value weights of `point` over `ring`, with the edge and corner cases a hair wide. */
function weightsOver(ring: readonly Pt[], point: Pt): number[] | null {
  const span = Math.max(...ring.map(([x]) => Math.abs(x)), ...ring.map(([, y]) => Math.abs(y)), 1);
  return meanValueWeights(
    ring.map(([x, y]) => ({ x, y })),
    { x: point[0], y: point[1] },
    1e-12 * span
  );
}

function blend(weights: readonly number[], ring: readonly Pt[]): Pt {
  let [x, y] = [0, 0];
  weights.forEach((weight, corner) => {
    x += weight * ring[corner]![0];
    y += weight * ring[corner]![1];
  });
  return [x, y];
}

/**
 * Where a face's spread takes a point of it on the unspread picture: its mean
 * value coordinates over the face's unspread ring, the same weights over its
 * drawn ring. The point itself when the step is not spread.
 */
export function faceSpreadMove(faces: StepFaces, face: number, point: Pt): Pt {
  if (!faces.spread) return point;
  const [unspread, drawn] = [faces.unspread[face], faces.drawn[face]];
  if (!unspread || !drawn || drawn.length !== unspread.length || unspread.length < 3) return point;
  const weights = weightsOver(unspread, point);
  return weights ? blend(weights, drawn) : point;
}

/**
 * The unspread point a face's spread move takes to `drawnPoint`: solved, by
 * Newton's method from the face's affine fit, drawn ring onto unspread ring.
 * Exact for the affine spread, whose move is affine on a face; to a hair for
 * the depth spread's.
 */
export function unspreadOn(faces: StepFaces, face: number, drawnPoint: Pt): Pt {
  if (!faces.spread) return drawnPoint;
  const [unspread, drawn] = [faces.unspread[face], faces.drawn[face]];
  if (!unspread || !drawn || drawn.length !== unspread.length || unspread.length < 3) return drawnPoint;
  let u = affineFit(drawn, unspread)?.(drawnPoint) ?? drawnPoint;
  const residual = (point: Pt): Pt => {
    const at = faceSpreadMove(faces, face, point);
    return [at[0] - drawnPoint[0], at[1] - drawnPoint[1]];
  };
  const span = unitOf(faces.bounds) || 1;
  const h = 1e-6 * span;
  for (let step = 0; step < 40; step += 1) {
    const f = residual(u);
    if (Math.hypot(f[0], f[1]) <= 1e-12 * span) break;
    const fx = residual([u[0] + h, u[1]]);
    const gx = residual([u[0] - h, u[1]]);
    const fy = residual([u[0], u[1] + h]);
    const gy = residual([u[0], u[1] - h]);
    const j = [
      (fx[0] - gx[0]) / (2 * h),
      (fy[0] - gy[0]) / (2 * h),
      (fx[1] - gx[1]) / (2 * h),
      (fy[1] - gy[1]) / (2 * h),
    ];
    const det = j[0]! * j[3]! - j[1]! * j[2]!;
    if (!(Math.abs(det) > 0)) break;
    u = [u[0] - (j[3]! * f[0] - j[1]! * f[1]) / det, u[1] - (-j[2]! * f[0] + j[0]! * f[1]) / det];
  }
  return u;
}

/** The least-squares affine map from one ring onto another, as a function; null for one with no area. */
function affineFit(from: readonly Pt[], to: readonly Pt[]): ((point: Pt) => Pt) | null {
  const n = from.length;
  const mean = (ring: readonly Pt[]): Pt => [
    ring.reduce((s, p) => s + p[0], 0) / n,
    ring.reduce((s, p) => s + p[1], 0) / n,
  ];
  const [f, t] = [mean(from), mean(to)];
  let [s0, s1, s3, c0, c1, c2, c3] = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const [fx, fy] = [from[i]![0] - f[0], from[i]![1] - f[1]];
    const [tx, ty] = [to[i]![0] - t[0], to[i]![1] - t[1]];
    s0 += fx * fx;
    s1 += fx * fy;
    s3 += fy * fy;
    c0 += tx * fx;
    c1 += tx * fy;
    c2 += ty * fx;
    c3 += ty * fy;
  }
  const det = s0 * s3 - s1 * s1;
  if (!(Math.abs(det) > 0)) return null;
  const inv = [s3 / det, -s1 / det, -s1 / det, s0 / det] as const;
  const l = [
    c0 * inv[0] + c1 * inv[2],
    c0 * inv[1] + c1 * inv[3],
    c2 * inv[0] + c3 * inv[2],
    c2 * inv[1] + c3 * inv[3],
  ] as const;
  return ([x, y]) => [t[0] + l[0] * (x - f[0]) + l[1] * (y - f[1]), t[1] + l[2] * (x - f[0]) + l[3] * (y - f[1])];
}

/** The face on top at an unspread point: the last whole face, in paint order, whose unspread ring holds it. */
export function topUnspread(faces: StepFaces, point: Pt): number | null {
  for (let i = faces.order.length - 1; i >= 0; i -= 1) {
    const face = faces.order[i]!;
    const ring = faces.unspread[face];
    if (ring && ring.length >= 3 && holds(ring, point, faces.epsilon)) return face;
  }
  return null;
}

/** The face drawn on top at a drawn point: the last piece the stored scene paints there, woven patches too. */
export function topDrawn(faces: StepFaces, point: Pt): number | null {
  for (let i = faces.pieces.length - 1; i >= 0; i -= 1) {
    const piece = faces.pieces[i]!;
    if (holds(piece.ring, point, faces.epsilon)) return piece.face;
  }
  return null;
}

/**
 * An unspread point onto the spread: by the move of the face on top there
 * unspread; a point on no face, by the nearest face's move at the nearest
 * point of its ring. The point itself with no spread.
 */
export function ontoSpread(faces: StepFaces, point: Pt): Pt {
  if (!faces.spread) return point;
  const face = topUnspread(faces, point);
  if (face !== null) return faceSpreadMove(faces, face, point);
  const nearest = nearestOnRings(faces.unspread, point);
  if (!nearest) return point;
  const moved = faceSpreadMove(faces, nearest.face, nearest.at);
  return [point[0] + moved[0] - nearest.at[0], point[1] + moved[1] - nearest.at[1]];
}

/**
 * A drawn point off the spread: the unspread point onto the spread takes to
 * it. Of the faces whose drawn ring holds it, the last painted whose move,
 * undone there, lands where that face is on top unspread. Where none does, it
 * lies in a strip the spread opened, where a lower layer shows: the face drawn
 * on top there is used, and onto the spread takes the point back to the layer
 * above, at most the strip's width away. A point on no face goes by the
 * nearest face's move at the nearest point of its drawn ring. The point
 * itself with no spread.
 */
export function offSpread(faces: StepFaces, point: Pt): Pt {
  if (!faces.spread) return point;
  for (let i = faces.order.length - 1; i >= 0; i -= 1) {
    const face = faces.order[i]!;
    const drawn = faces.drawn[face];
    if (!drawn || drawn.length < 3 || !holds(drawn, point, faces.epsilon)) continue;
    const unspread = unspreadOn(faces, face, point);
    if (topUnspread(faces, unspread) === face) return unspread;
  }
  const top = topDrawn(faces, point);
  if (top !== null) return unspreadOn(faces, top, point);
  const nearest = nearestOnRings(faces.drawn, point);
  if (!nearest) return point;
  const back = unspreadOn(faces, nearest.face, nearest.at);
  return [point[0] + back[0] - nearest.at[0], point[1] + back[1] - nearest.at[1]];
}

/** The nearest point of any of `rings` to `point`, and whose ring it is on. */
function nearestOnRings(rings: readonly Pt[][], point: Pt): { face: number; at: Pt } | null {
  let best: { face: number; at: Pt; distance: number } | null = null;
  rings.forEach((ring, face) => {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const at = nearestOnSegment(point, a, b);
      const distance = Math.hypot(point[0] - at[0], point[1] - at[1]);
      if (!best || distance < best.distance) best = { face, at, distance };
    }
  });
  return best;
}

function nearestOnSegment(point: Pt, a: Pt, b: Pt): Pt {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/* --------------------------------------------------------------------------
 * The anchor
 * ----------------------------------------------------------------------- */

/** The face of a step's paper that holds a paper point: the lowest index, so a point on a crease goes to the lower face. */
export function faceAt(faces: StepFaces, point: Pt): number | null {
  const span = unitOf(faces.bounds) / CAPTURE_PX_PER_UNIT;
  const epsilon = Math.max(1e-9, 1e-7 * span);
  for (let face = 0; face < faces.paper.length; face += 1) {
    const ring = faces.paper[face]!;
    if (ring.length >= 3 && holds(ring, point, epsilon)) return face;
  }
  return null;
}

/** The faces with a ring, backmost first: by level, a tie to the larger on the paper (within 0.1%), then the lower index. */
export function rankedFaces(faces: StepFaces): number[] {
  const area = faces.paper.map((ring) => Math.abs(ringArea(ring)));
  const named = faces.paper.map((_, face) => face).filter((face) => faces.paper[face]!.length >= 3);
  return named.sort((a, b) => {
    const level = faces.levels[b]! - faces.levels[a]!;
    if (level !== 0) return level;
    const larger = Math.max(area[a]!, area[b]!);
    if (Math.abs(area[a]! - area[b]!) > 1e-3 * larger) return area[b]! - area[a]!;
    return a - b;
  });
}

/**
 * The default anchor face for a frame drawn on its step (scene px): of the
 * faces ranked backmost first ({@link rankedFaces}), the first whose drawn
 * ring misses the frame; else the first that reaches outside it; else the
 * backmost. Null for a step with no named face.
 */
export function defaultAnchor(faces: StepFaces, frame: DiagramZoomOutline): number | null {
  const ranked = rankedFaces(faces).filter((face) => faces.drawn[face]!.length >= 3);
  const outside = ranked.find((face) => missesOutline(faces.drawn[face]!, frame, faces.epsilon));
  if (outside !== undefined) return outside;
  const reaching = ranked.find((face) =>
    faces.drawn[face]!.some((corner) => distanceOutside(frame, corner) > faces.epsilon)
  );
  return reaching ?? ranked[0] ?? null;
}

/** Whether a ring lies wholly outside an outline: nothing of either inside the other, no side within it. */
function missesOutline(ring: readonly Pt[], outline: DiagramZoomOutline, epsilon: number): boolean {
  if (holds(ring, outline.centre, 0)) return false;
  const { core, radius } = zoomCore(outline);
  for (let i = 0; i < ring.length; i += 1) {
    if (segmentToConvex(ring[i]!, ring[(i + 1) % ring.length]!, core) <= radius + epsilon) return false;
  }
  return true;
}

/** How far a segment is from a convex polygon (or a point): 0 where they meet. */
function segmentToConvex(a: Pt, b: Pt, core: readonly Pt[]): number {
  if (core.length === 1) return distanceToSegment(core[0]!, a, b);
  for (let i = 0; i < core.length; i += 1) if (segmentsCross(a, b, core[i]!, core[(i + 1) % core.length]!)) return 0;
  if (holds(core, a, 0)) return 0;
  let best = Infinity;
  for (let i = 0; i < core.length; i += 1) {
    const [p, q] = [core[i]!, core[(i + 1) % core.length]!];
    best = Math.min(best, distanceToSegment(a, p, q), distanceToSegment(b, p, q), distanceToSegment(p, a, b));
  }
  return best;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const cross = (o: Pt, p: Pt, q: Pt) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const [d1, d2, d3, d4] = [cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d)];
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * The anchor's point on the paper: the point inside a face farthest from its
 * edges — its pole of inaccessibility ({@link poleOf}).
 */
export function anchorPoint(faces: StepFaces, face: number): Pt | null {
  const ring = faces.paper[face];
  return ring && ring.length >= 3 ? poleOf(ring) : null;
}

/**
 * How near the deepest a face's pole is found, as a share of the face's
 * longer side. The point only has to lie well inside the face, so that the
 * face holding it is found again on another step: a thousandth is far inside
 * any crease's rounding, and it bounds the work on a face whose deepest
 * points run along a ridge — a rectangle's, a strip's, a parallelogram's —
 * which a finer share would follow cell by cell.
 */
const POLE_PRECISION = 1e-3;

/** The most cells a pole is searched over: a bound on a face no origami folds, never reached on one it does. */
const POLE_MAX_CELLS = 20_000;

/** A cell of a pole's search: its centre's depth `d`, and `max`, the deepest any point of it can be. */
interface PoleCell {
  x: number;
  y: number;
  h: number;
  d: number;
  max: number;
}

/**
 * A ring's pole of inaccessibility, to {@link POLE_PRECISION} of its size:
 * Mapbox's polylabel, cell by cell, the most promising first.
 */
export function poleOf(ring: readonly Pt[]): Pt {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [width, height] = [maxX - minX, maxY - minY];
  const longer = Math.max(width, height);
  const precision = POLE_PRECISION * longer;
  const cell = (x: number, y: number, h: number): PoleCell => {
    const d = signedDepth(ring, [x, y]);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  // The centroid is a good first guess; the box's centre, failing that.
  const centroid = ringCentroid(ring);
  let best = cell(centroid[0], centroid[1], 0);
  const middle = cell((minX + maxX) / 2, (minY + maxY) / 2, 0);
  if (middle.d > best.d) best = middle;
  if (!(Math.min(width, height) > 0)) return [best.x, best.y];
  // Square cells covering the box: its shorter side, or coarser on a long strip, so there are never many to start.
  const size = Math.max(Math.min(width, height), longer / 64);
  const queue = new PoleQueue();
  for (let x = minX; x < maxX; x += size) {
    for (let y = minY; y < maxY; y += size) queue.push(cell(x + size / 2, y + size / 2, size / 2));
  }
  for (let cells = 0; queue.size > 0 && cells < POLE_MAX_CELLS; cells += 1) {
    const next = queue.pop()!;
    if (next.d > best.d) best = next;
    if (next.max - best.d <= precision) continue;
    const half = next.h / 2;
    queue.push(cell(next.x - half, next.y - half, half));
    queue.push(cell(next.x + half, next.y - half, half));
    queue.push(cell(next.x - half, next.y + half, half));
    queue.push(cell(next.x + half, next.y + half, half));
  }
  return [best.x, best.y];
}

/** A binary heap of a pole's cells, the deepest-reaching on top. */
class PoleQueue {
  private readonly cells: PoleCell[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: PoleCell): void {
    const { cells } = this;
    cells.push(cell);
    for (let at = cells.length - 1; at > 0; ) {
      const parent = (at - 1) >> 1;
      if (cells[parent]!.max >= cells[at]!.max) break;
      [cells[parent], cells[at]] = [cells[at]!, cells[parent]!];
      at = parent;
    }
  }

  pop(): PoleCell | undefined {
    const { cells } = this;
    const top = cells[0];
    const last = cells.pop();
    if (cells.length === 0 || !last) return top;
    cells[0] = last;
    for (let at = 0; ; ) {
      const [left, right] = [2 * at + 1, 2 * at + 2];
      let largest = at;
      if (left < cells.length && cells[left]!.max > cells[largest]!.max) largest = left;
      if (right < cells.length && cells[right]!.max > cells[largest]!.max) largest = right;
      if (largest === at) break;
      [cells[largest], cells[at]] = [cells[at]!, cells[largest]!];
      at = largest;
    }
    return top;
  }
}

/** How deep a point is inside a ring: its distance to the nearest side, negative outside. */
function signedDepth(ring: readonly Pt[], point: Pt): number {
  let nearest = Infinity;
  for (let i = 0; i < ring.length; i += 1)
    nearest = Math.min(nearest, distanceToSegment(point, ring[i]!, ring[(i + 1) % ring.length]!));
  return holds(ring, point, 0) ? nearest : -nearest;
}

function ringCentroid(ring: readonly Pt[]): Pt {
  let [x, y, twice] = [0, 0, 0];
  for (let i = 0; i < ring.length; i += 1) {
    const [a, b] = [ring[i]!, ring[(i + 1) % ring.length]!];
    const cross = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
    twice += cross;
  }
  if (Math.abs(twice) < 1e-15) return ring[0]!;
  return [x / (3 * twice), y / (3 * twice)];
}

/* --------------------------------------------------------------------------
 * Imprint and land
 * ----------------------------------------------------------------------- */

/** An outline carried through a similarity: its centre, its sizes, and a rounded rectangle's turn. */
function carried(
  outline: DiagramZoomOutline,
  place: (point: Pt) => Pt,
  vector: (vector: Pt) => Pt,
  scale: number
): DiagramZoomOutline {
  const centre = place(outline.centre);
  if (zoomShapeOf(outline) === 'circle') return { centre, radius: outline.radius! * scale };
  const radians = ((outline.angle ?? 0) * Math.PI) / 180;
  const [x, y] = vector([Math.cos(radians), Math.sin(radians)]);
  const angle = rectangleAngle((Math.atan2(y, x) * 180) / Math.PI);
  return {
    centre,
    size: [outline.size![0] * scale, outline.size![1] * scale],
    ...(angle !== 0 ? { angle } : {}),
  };
}

/** A frame on the unspread picture (scene px) imprinted on the paper through a face's placement. */
export function imprintThrough(frame: DiagramZoomOutline, placement: Placement): DiagramZoomOutline {
  return carried(frame, placement.invert, placement.invertVector, 1 / placement.scale);
}

/** An imprint on the paper landed on the unspread picture (scene px) through a face's placement. */
export function landThrough(imprint: DiagramZoomOutline, placement: Placement): DiagramZoomOutline {
  return carried(imprint, placement.apply, placement.applyVector, placement.scale);
}

/**
 * Steps 2–3 of a capture: a frame as drawn on its step (scene px), its centre
 * taken off the spread — its size and turn as drawn — and imprinted on the
 * paper through `face`'s placement. Null when the face has none.
 */
export function imprintFrame(faces: StepFaces, face: number, frame: DiagramZoomOutline): DiagramZoomOutline | null {
  const placement = facePlacement(faces, face);
  if (!placement) return null;
  return imprintThrough({ ...frame, centre: offSpread(faces, frame.centre) }, placement);
}

/**
 * Steps 4–6 of a capture: an imprint landed on a step whose paper holds its
 * anchor's point `on` — through the face holding it there, on the unspread
 * picture, turned and mirrored with it — and its centre then taken onto the
 * spread by the face on top under it, its size and turn as landed. Scene px;
 * null when `on` is on none of the step's faces.
 */
export function landFrame(faces: StepFaces, imprint: DiagramZoomOutline, on: Pt): DiagramZoomOutline | null {
  const face = faceAt(faces, on);
  const placement = face === null ? null : facePlacement(faces, face);
  if (!placement) return null;
  const landed = landThrough(imprint, placement);
  return { ...landed, centre: ontoSpread(faces, landed.centre) };
}

/**
 * Where a press on a step's picture (scene px, as drawn) anchors: the face
 * drawn on top there, at the point pressed — that face's spread move undone,
 * then its placement inverted. Null off the paper.
 */
export function pickAnchor(faces: StepFaces, pressed: Pt): { face: number; on: Pt } | null {
  const face = topDrawn(faces, pressed);
  const placement = face === null ? null : facePlacement(faces, face);
  if (face === null || !placement) return null;
  return { face, on: placement.invert(unspreadOn(faces, face, pressed)) };
}

/* --------------------------------------------------------------------------
 * Rings
 * ----------------------------------------------------------------------- */

/** Even-odd, and within `epsilon` of a side counts as in. */
export function holds(ring: readonly Pt[], [x, y]: Pt, epsilon: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (epsilon > 0 && distanceToSegment([x, y], ring[j]!, ring[i]!) <= epsilon) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shoelace. */
export function ringArea(ring: readonly Pt[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [a, b] = [ring[i]!, ring[(i + 1) % ring.length]!];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2;
}
