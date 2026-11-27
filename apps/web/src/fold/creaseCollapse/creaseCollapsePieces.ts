/**
 * What Collapse picks (`implementation-plans/fold-collapse-existing-creases.md`):
 * the stretches of the state's own lines a click can set.
 *
 * A piece is a crease of the state — an edge of its face graph, a fold or a
 * flat crease — or a crease mark, cut wherever a crease mark ends on it or
 * crosses it: there another line meets it, so the two sides can fold
 * differently (a diagonal valley on one side of where pinches end, mountain
 * on the other). The border is no piece. Every piece is named by its sheet
 * ends, which is what a Collapse step stores (`FoldCollapseCrease`).
 *
 * Where a piece is on each pane:
 *
 * - **The crease pattern** draws it in sheet coordinates, every layer.
 * - **The folded pane** draws it through each face of the scene on screen
 *   it lies on (the step on screen, or the Collapse it previews: the same
 *   sheet, other faces); an image is clicked only where its face is on top,
 *   as the paper the viewer sees.
 *
 * Pure: no React, no store, no engine.
 */
import { LineHitIndex } from '../../cp-workspace/picking/lineHitIndex';
import type { Point } from '../../lib/geometry';
import type { FoldCollapseTo, SheetPoint } from '../document/foldSequenceDocument';
import type { FoldLetter, FoldScene } from '../engine/foldEngineWire';
import { applyIsometry, insideConvex, toPoint } from '../canvas/foldCanvasGeometry';
import type { FoldPaneId } from '../canvas/foldPicking';

/** One stretch a click sets (see the module docs). */
export interface FoldCollapsePiece {
  /** Its sheet ends. */
  sheet: readonly [SheetPoint, SheetPoint];
  /** What it is now: folded with its letter, or open (a flat crease, or a crease mark). */
  now: FoldCollapseTo;
  /** The letter it has, folded, or remembers, flat. */
  letter: FoldLetter;
  /** A crease mark's, beside the face graph. */
  mark: boolean;
}

/** How far apart, in sheet units, two points are one: the engine's tolerance. */
const SAME = 1e-6;

interface Line {
  a: Point;
  b: Point;
  now: FoldCollapseTo;
  letter: FoldLetter;
  mark: boolean;
}

/** Where `p` lies along a–b as a fraction, when it lies on the segment strictly inside it; null otherwise. */
function strictlyOn(a: Point, b: Point, p: Point): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= SAME) return null;
  const off = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
  if (off > SAME) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length);
  return t * length > SAME && (1 - t) * length > SAME ? t : null;
}

/** Where two segments cross strictly inside both, as a fraction along the first; null for none. */
function crossing(a: Point, b: Point, c: Point, d: Point): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  const scale = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
  if (scale === 0 || Math.abs(denom) <= 1e-12 * scale) return null;
  const q = { x: c.x - a.x, y: c.y - a.y };
  const t = (q.x * s.y - q.y * s.x) / denom;
  const u = (q.x * r.y - q.y * r.x) / denom;
  const lr = Math.hypot(r.x, r.y);
  const ls = Math.hypot(s.x, s.y);
  const inside = (v: number, length: number) => v * length > SAME && (1 - v) * length > SAME;
  return inside(t, lr) && inside(u, ls) ? t : null;
}

/** The state's pieces (see the module docs), creases first in edge order, then the crease marks'. */
export function collapsePieces(scene: FoldScene): FoldCollapsePiece[] {
  const lines: Line[] = [];
  for (const crease of scene.creases) {
    if (crease.kind === 'border' || !crease.letter) continue;
    lines.push({
      a: crease.from,
      b: crease.to,
      now: crease.kind === 'fold' ? crease.letter : 'open',
      letter: crease.letter,
      mark: false,
    });
  }
  for (const mark of scene.crease_marks ?? []) {
    lines.push({ a: mark.from, b: mark.to, now: 'open', letter: mark.letter, mark: true });
  }
  const pieces: FoldCollapsePiece[] = [];
  for (const line of lines) {
    const cuts = [0, 1];
    for (const other of lines) {
      if (other === line || (!line.mark && !other.mark)) continue;
      // A mark's end on this line, or this mark's on a crease, and wherever the two cross.
      if (other.mark) {
        for (const end of [other.a, other.b]) {
          const t = strictlyOn(line.a, line.b, end);
          if (t !== null) cuts.push(t);
        }
      }
      const t = crossing(line.a, line.b, other.a, other.b);
      if (t !== null) cuts.push(t);
    }
    cuts.sort((p, q) => p - q);
    const at = (t: number): SheetPoint => [line.a.x + (line.b.x - line.a.x) * t, line.a.y + (line.b.y - line.a.y) * t];
    const length = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
    for (let k = 1; k < cuts.length; k++) {
      if ((cuts[k]! - cuts[k - 1]!) * length <= SAME) continue;
      pieces.push({ sheet: [at(cuts[k - 1]!), at(cuts[k]!)], now: line.now, letter: line.letter, mark: line.mark });
    }
  }
  return pieces;
}

/** One piece where the folded pane draws it: through a face it lies on, and whether that face is on top there. */
export interface FoldCollapseImage {
  piece: number;
  scene: readonly [Point, Point];
  visible: boolean;
  /** The face it is drawn through shows its front. */
  frontUp: boolean;
}

/** The pieces, indexed where each pane finds them. */
export interface FoldCollapsePieceIndex {
  pieces: readonly FoldCollapsePiece[];
  /** Every image of every piece on the folded pane, through the scene on screen. */
  images: readonly FoldCollapseImage[];
  creasePattern: LineHitIndex;
  /** The visible images, by index into `images` + 1. */
  folded: LineHitIndex;
}

/** A face's sheet outline, from the scene's sheet points. */
function sheetRing(scene: FoldScene, face: number): Point[] | null {
  const points = scene.faces[face]?.points;
  if (!points) return null;
  const ring = points.map((vertex) => scene.sheet_points[vertex]);
  return ring.some((p) => p === undefined) ? null : (ring as Point[]);
}

/** The face on top at a scene point, by the scene's cells; null off the paper. */
function topAt(scene: FoldScene, p: Point): number | null {
  for (const cell of scene.subfaces) {
    if (insideConvex(cell.polygon, p, -1e-9)) return cell.faces_top_to_bottom[0] ?? null;
  }
  return null;
}

/**
 * The pieces of `parent` (the step on screen) indexed on both panes, the
 * folded pane's through `shown` — the step on screen itself, or the Collapse
 * it previews, whose sheet is the same.
 */
export function collapsePieceIndex(parent: FoldScene, shown: FoldScene): FoldCollapsePieceIndex {
  const pieces = collapsePieces(parent);
  const rings = shown.faces.map((_, face) => sheetRing(shown, face));
  const images: FoldCollapseImage[] = [];
  pieces.forEach((piece, k) => {
    const a = toPoint(piece.sheet[0]);
    const b = toPoint(piece.sheet[1]);
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const seen: FoldCollapseImage[] = [];
    rings.forEach((ring, face) => {
      const transform = shown.face_transforms[face];
      if (!ring || !transform || !insideConvex(ring, middle, 1e-7)) return;
      // A point just inside the face beside the piece's middle: whether that paper is on top.
      const centre = ring.reduce((sum, p) => ({ x: sum.x + p.x / ring.length, y: sum.y + p.y / ring.length }), { x: 0, y: 0 });
      const toward = Math.hypot(centre.x - middle.x, centre.y - middle.y) || 1;
      const inside = { x: middle.x + ((centre.x - middle.x) / toward) * 1e-4, y: middle.y + ((centre.y - middle.y) / toward) * 1e-4 };
      const image: FoldCollapseImage = {
        piece: k,
        scene: [applyIsometry(transform, a), applyIsometry(transform, b)],
        visible: topAt(shown, applyIsometry(transform, inside)) === face,
        frontUp: transform[0] * transform[4] - transform[1] * transform[3] > 0,
      };
      // A fold's two faces draw it in one place: one image, seen if either face is.
      const same = seen.find((other) => sameSegment(other.scene, image.scene));
      if (same) {
        if (image.visible && !same.visible) Object.assign(same, { visible: true, frontUp: image.frontUp });
        return;
      }
      seen.push(image);
    });
    images.push(...seen);
  });
  const creasePattern = new LineHitIndex(
    pieces.map((piece, k) => ({ id: k + 1, a: toPoint(piece.sheet[0]), b: toPoint(piece.sheet[1]) }))
  );
  const folded = new LineHitIndex(
    images.flatMap((image, k) => (image.visible ? [{ id: k + 1, a: image.scene[0], b: image.scene[1] }] : []))
  );
  return { pieces, images, creasePattern, folded };
}

function sameSegment([a, b]: readonly [Point, Point], [c, d]: readonly [Point, Point]): boolean {
  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) <= SAME;
  return (near(a, c) && near(b, d)) || (near(a, d) && near(b, c));
}

/** The piece a pointer on a pane is over, within `radius` of it (the pane's frame), and its image there; null for none. */
export function collapsePieceAt(
  index: FoldCollapsePieceIndex,
  pane: FoldPaneId,
  at: Point,
  radius: number
): { piece: number; scene: readonly [Point, Point] | null } | null {
  if (pane === 'crease-pattern') {
    const hit = index.creasePattern.query(at.x, at.y, radius);
    if (hit < 1) return null;
    const image = index.images.find((each) => each.piece === hit - 1 && each.visible) ?? index.images.find((each) => each.piece === hit - 1);
    return { piece: hit - 1, scene: image?.scene ?? null };
  }
  const hit = index.folded.query(at.x, at.y, radius);
  const image = hit > 0 ? index.images[hit - 1] : undefined;
  return image ? { piece: image.piece, scene: image.scene } : null;
}
