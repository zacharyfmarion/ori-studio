/**
 * What the Fold canvas draws over the paper of each pane, beside the painted
 * scene: the references picked so far, the one under the pointer, the lines
 * a click is offered, the line a free fold is being drawn along, the
 * Divide-line marks, and a region a click would pick — on the renderer's
 * overlay channels (points on top of
 * everything, strokes on the preview channel, regions on the fill channel
 * with the pane's tint), in the pane's own frame.
 *
 * These are the tool's feedback, not the paper, so they take theme accents
 * rather than the paper style's pens: the pick accent for what is picked and
 * hovered, as References and Edit mark theirs.
 *
 * Pure: the colours are handed in, resolved by the pane.
 */
import type { Point } from '../../lib/geometry';
import type { FillGeometry, PointGeometry, Rgba, StrokeGeometry } from '../../cp-workspace/renderer/types';
import type { FoldMark, FoldModelLine, SheetPoint } from '../document/foldSequenceDocument';
import { markPoints } from '../document/foldSequenceDocument';
import type { FoldPaneSpreadMap } from './foldPaneSpreadMap';
import {
  samePick,
  sheetToScene,
  type FoldFreePick,
  type FoldHit,
  type FoldPaneId,
  type FoldPick,
  type FoldPickIndex,
  type FoldPointPick,
  type FoldSegmentPick,
} from './foldPicking';
import type { FoldScene } from '../engine/foldEngineWire';
import { clipConvex, toPoint } from './foldCanvasGeometry';

export interface FoldOverlayInks {
  /** The pick accent: what is picked and what a click would take. */
  accent: Rgba;
  /** A mark's dot. */
  mark: Rgba;
  /** What a dot is outlined in against the paper. */
  outline: Rgba;
  /**
   * Lines a tool offers that are no crease: Repeat's axes. Edit's selection
   * colour (`--cp-selection`), chosen to be confusable with no fold colour —
   * the accent may be a valley's blue.
   */
  selection: Rgba;
}

/** CSS px: a picked point's dot, the ring round the one under the pointer, a mark's dot. */
const PICKED_RADIUS = 4.5;
const HOVER_RADIUS = 8;
const MARK_RADIUS = 3;
const HOVER_FILL_ALPHA = 0.28;
/** A picked or hovered line, as a multiple of the frame's stroke width: over the crease, wider than it. */
const LINE_WIDTH_MUL = 2.6;
const HOVER_LINE_ALPHA = 0.5;
/** A located line awaiting its fold's picture: over the paper, narrower than a picked crease. */
const LOCATED_WIDTH_MUL = 1.6;
/** A line a click is offered (`offered`): lit, a little narrower and fainter than one picked. */
const OFFERED_ALPHA = 0.7;
const OFFERED_WIDTH_MUL = 2.1;

/** A dot on the overlay, in the pane's frame: its radius in CSS px. */
export interface FoldOverlayDot {
  at: Point;
  radius: number;
  fill: Rgba;
  stroke: Rgba;
}

/** A stroke on the overlay, in the pane's frame: its width a multiple of the frame's stroke width. */
export interface FoldOverlayStroke {
  a: Point;
  b: Point;
  color: Rgba;
  widthMul: number;
}

/**
 * What a tool draws over a pane beside its picks: a vertex fold's vertex, the
 * line it lands on and the choices it offers (`vertex/vertexOverlay`). Its
 * creases are paper, in the diagram-crease pens (`withFoldCreases`).
 */
export interface FoldOverlayMarks {
  dots: readonly FoldOverlayDot[];
  strokes: readonly FoldOverlayStroke[];
}

type Dot = FoldOverlayDot;
type Stroke = FoldOverlayStroke;

function packDots(dots: readonly Dot[]): PointGeometry | null {
  if (dots.length === 0) return null;
  const count = dots.length;
  const center = new Float32Array(count * 2);
  const radius = new Float32Array(count);
  const screenSpace = new Float32Array(count).fill(1);
  const fill = new Float32Array(count * 4);
  const stroke = new Float32Array(count * 4);
  dots.forEach((dot, k) => {
    center[k * 2] = dot.at.x;
    center[k * 2 + 1] = dot.at.y;
    radius[k] = dot.radius;
    fill.set(dot.fill, k * 4);
    stroke.set(dot.stroke, k * 4);
  });
  return { center, radius, screenSpace, fill, stroke, count };
}

function packStrokes(strokes: readonly Stroke[]): StrokeGeometry | null {
  if (strokes.length === 0) return null;
  const count = strokes.length;
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const widthMul = new Float32Array(count);
  strokes.forEach((stroke, k) => {
    a.set([stroke.a.x, stroke.a.y], k * 2);
    b.set([stroke.b.x, stroke.b.y], k * 2);
    color.set(stroke.color, k * 4);
    widthMul[k] = stroke.widthMul;
  });
  return { a, b, color, widthMul, dashSlot: new Float32Array(count), count };
}

const withAlpha = ([r, g, b, a]: Rgba, alpha: number): Rgba => [r, g, b, a * alpha];

/**
 * Where a pick is drawn on a pane: the scene frame on the folded pane — where
 * the spread draws its sheet point, while the pane is spread — the sheet on
 * the other.
 */
function pickOnPane(
  pick: FoldPick,
  pane: FoldPaneId,
  spread: FoldPaneSpreadMap | null = null
): Point | readonly [Point, Point] | null {
  const folded = pane === 'folded';
  switch (pick.kind) {
    case 'point':
      if (!folded) return toPoint(pick.sheet);
      return spread ? (spread.sheet(pick.sheet) ?? pick.scene) : pick.scene;
    case 'segment':
      if (!folded) return [toPoint(pick.sheet[0]), toPoint(pick.sheet[1])];
      return spread ? spread.segment(pick.sheet, pick.scene) : pick.scene;
    case 'free':
      // A free line's end: where it lies folded, and on the sheet under it (none off the paper).
      if (!folded) return pick.sheet ? toPoint(pick.sheet) : null;
      return spread && pick.sheet ? (spread.sheet(pick.sheet) ?? pick.scene) : pick.scene;
  }
}

export interface FoldPaneOverlay {
  points: PointGeometry | null;
  strokes: StrokeGeometry | null;
  /** Tints that follow the pointer, over the pane's own (`tint`): a region a click would pick. */
  fills?: FillGeometry | null;
}

/**
 * The regions a click picks among on one pane — a fan's paper that stays —
 * and the one picked: lit over the paper, the one under the pointer too.
 */
export interface FoldOverlayRegions {
  /** Per region, its convex polygons in the pane's frame. */
  polygons: readonly (readonly (readonly Point[])[])[];
  /** The region picked; null before one is. */
  picked: number | null;
  /** The region a hit on this pane would pick; null off the paper. */
  at: (hit: FoldHit) => number | null;
}

/** How strongly the region picked is lit, and one under the pointer. */
const REGION_PICKED_TINT = 0.42;
const REGION_HOVERED_TINT = 0.26;

/** The regions lit (see {@link FoldOverlayRegions}): the one picked, and the one under the pointer when it is another. */
export function foldRegionTint(
  regions: FoldOverlayRegions | null,
  hovered: FoldHit | null,
  accent: Rgba
): FillGeometry | null {
  if (!regions) return null;
  const triangles: number[] = [];
  const colors: number[] = [];
  const light = (region: number | null, alpha: number) => {
    const color = [accent[0], accent[1], accent[2], accent[3] * alpha];
    for (const ring of region === null ? [] : (regions.polygons[region] ?? [])) {
      for (let k = 1; k + 1 < ring.length; k += 1) {
        for (const corner of [ring[0]!, ring[k]!, ring[k + 1]!]) {
          triangles.push(corner.x, corner.y);
          colors.push(...color);
        }
      }
    }
  };
  const under = hovered ? regions.at(hovered) : null;
  light(regions.picked, REGION_PICKED_TINT);
  if (under !== regions.picked) light(under, REGION_HOVERED_TINT);
  if (triangles.length === 0) return null;
  return { position: new Float32Array(triangles), color: new Float32Array(colors), count: triangles.length / 2 };
}

/** How strongly the moving set is tinted, and the flap under the pointer over that. */
const MOVING_TINT = 0.3;
const HOVERED_TINT = 0.5;

/**
 * The paper a located fold moves, tinted in the theme's accent over the
 * folded pane (plan D11: "a theme accent drawn over the paper, never a paper
 * colour"): every cell of the scene with a moving face in its stack, cut to
 * the moving side of the line — the engine's moving faces are the parent's,
 * and the line cuts them, so a whole-face tint would light paper that stays.
 * The flap under the pointer in the layer picker is lit again over that.
 * Fills in the pane's frame, for the overlay fill channel; null when nothing
 * is located.
 */
export function foldMovingTint(
  index: FoldPickIndex,
  moving: { line: FoldModelLine; sign: 1 | -1; faces: readonly number[]; hovered: readonly number[] } | null,
  accent: Rgba
): FillGeometry | null {
  if (!moving || moving.faces.length === 0) return null;
  const at = new Map(index.scene.lineage.map((face, k) => [face.id, k]));
  const toIndices = (ids: readonly number[]) =>
    new Set(ids.flatMap((id) => {
      const k = at.get(id);
      return k === undefined ? [] : [k];
    }));
  const faces = toIndices(moving.faces);
  const hovered = toIndices(moving.hovered);
  const triangles: number[] = [];
  const colors: number[] = [];
  const add = (stackHas: (face: number) => boolean, alpha: number) => {
    const color = [accent[0], accent[1], accent[2], accent[3] * alpha];
    for (const cell of index.subfaces) {
      if (!cell.stack.some(stackHas)) continue;
      const piece = clipConvex(cell.polygon, moving.line, moving.sign);
      for (let k = 1; k + 1 < piece.length; k += 1) {
        for (const corner of [piece[0]!, piece[k]!, piece[k + 1]!]) {
          triangles.push(corner.x, corner.y);
          colors.push(...color);
        }
      }
    }
  };
  add((face) => faces.has(face), MOVING_TINT);
  if (hovered.size > 0) add((face) => hovered.has(face), HOVERED_TINT);
  if (triangles.length === 0) return null;
  return { position: new Float32Array(triangles), color: new Float32Array(colors), count: triangles.length / 2 };
}

/** How strongly a layer listed to tuck against is lit, and the one taken over that. */
const TARGET_TINT = 0.16;
const TARGET_TAKEN_TINT = 0.42;

/**
 * The layers a tuck may go against, lit in the theme's accent over the
 * folded pane: every cell whose stack holds one, whole — a target stays, so
 * no line cuts it — each listed one faintly and the one taken brighter. The
 * fill is an overlay, so a layer under others shows where it lies. Null when
 * none is listed.
 */
export function foldTargetsTint(
  index: FoldPickIndex,
  targets: { listed: readonly number[]; taken: number | null; additional?: readonly number[] },
  accent: Rgba
): FillGeometry | null {
  if (targets.listed.length === 0) return null;
  const at = new Map(index.scene.lineage.map((face, k) => [face.id, k]));
  const positions = (ids: readonly number[]) =>
    new Set(ids.flatMap((id) => {
      const k = at.get(id);
      return k === undefined ? [] : [k];
    }));
  const listed = positions(targets.listed);
  const taken = positions([...(targets.taken === null ? [] : [targets.taken]), ...(targets.additional ?? [])]);
  const triangles: number[] = [];
  const colors: number[] = [];
  const add = (lit: ReadonlySet<number>, alpha: number) => {
    const color = [accent[0], accent[1], accent[2], accent[3] * alpha];
    for (const cell of index.subfaces) {
      if (!cell.stack.some((face) => lit.has(face))) continue;
      const ring = cell.polygon;
      for (let k = 1; k + 1 < ring.length; k += 1) {
        for (const corner of [ring[0]!, ring[k]!, ring[k + 1]!]) {
          triangles.push(corner.x, corner.y);
          colors.push(...color);
        }
      }
    }
  };
  add(listed, TARGET_TINT);
  if (taken.size > 0) add(taken, TARGET_TAKEN_TINT);
  if (triangles.length === 0) return null;
  return { position: new Float32Array(triangles), color: new Float32Array(colors), count: triangles.length / 2 };
}

/** Two fills drawn as one, the second over the first; either may be none. */
export function joinFills(first: FillGeometry | null, second: FillGeometry | null): FillGeometry | null {
  if (!first || !second) return first ?? second;
  const position = new Float32Array(first.position.length + second.position.length);
  position.set(first.position);
  position.set(second.position, first.position.length);
  const color = new Float32Array(first.color.length + second.color.length);
  color.set(first.color);
  color.set(second.color, first.color.length);
  return { position, color, count: first.count + second.count };
}

export interface FoldPaneOverlayInput {
  pane: FoldPaneId;
  scene: FoldScene | null;
  picks: readonly FoldPick[];
  hovered: FoldHit | null;
  /**
   * While a line is being drawn through two clicks: its first end, which the
   * live line runs from to where a click would end it — a free line's, or
   * the first of two snapped points (a swivel's target).
   */
  freeFrom: FoldFreePick | FoldPointPick | null;
  /**
   * Lines the tools have located that no fold's picture draws yet — a
   * crimp's first line while its second is being located — across the
   * paper in the scene frame. Drawn on the folded pane only.
   */
  located?: readonly (readonly [Point, Point])[];
  marks: readonly FoldMark[];
  inks: FoldOverlayInks;
  /** The tool's own marks for this pane, under its picks: a vertex fold's vertex, landing line and choices. */
  tool?: FoldOverlayMarks | null;
  /**
   * How the folded pane draws the paper while its layers are spread
   * (`foldPaneSpreadMap`): the marks, the picks and the hover are drawn where
   * the spread puts their sheet points. Null, or on the other pane, they are
   * drawn where they lie.
   */
  spread?: FoldPaneSpreadMap | null;
  /** A partial precrease being made: its located line on this pane, and the points clicked along it. */
  along?: FoldOverlayAlong | null;
  /** The regions a click picks among on this pane — a fan's paper that stays — lit under the picks. */
  regions?: FoldOverlayRegions | null;
  /**
   * The lines a click is offered on this pane, lit under the picks — a
   * swivel's edges that can swing, then the lines its edge lands on — and
   * the one under the pointer lit as brightly as a pick.
   */
  offered?: readonly FoldSegmentPick[] | null;
  /**
   * The point a click on the other pane would take, from its pointer
   * ({@link foldHoverEcho}): marked where it lies on this pane as a picked
   * point is, so the crease pattern shows which paper a click on the folded
   * pane takes before the click.
   */
  echo?: FoldPick | null;
}

/**
 * The point a hit on the folded pane would take, for the crease pattern to
 * mark (`FoldPaneOverlayInput.echo`): a point, or a free point on the paper;
 * null for a line, bare paper or off it. `was` comes back while the hit
 * takes the same point, so a move along one point re-renders nothing.
 */
export function foldHoverEcho(hit: FoldHit | null, was: FoldPick | null): FoldPick | null {
  const pick = hit?.pick ?? null;
  const echo = pick && (pick.kind === 'point' || (pick.kind === 'free' && pick.sheet !== null)) ? pick : null;
  return echo && was && samePick(echo, was) ? was : echo;
}

/** A partial precrease's located line on one pane, and its points along it (`foldAlongOverlay`). */
export interface FoldOverlayAlong {
  /** The line's stretches on the paper, in the pane's frame (`FoldAlongLine.pieces`). */
  pieces: readonly (readonly [Point, Point])[];
  /** The points clicked along it, in click order. */
  picks: readonly FoldPick[];
  /** A segment: from its first end, the stretch to the point under the pointer is drawn. */
  segment: boolean;
  /** Every point is in, and the fold's picture draws the extent: the line steps back. */
  faint: boolean;
}

/** How bright the located line is once a partial precrease's picture draws its extent over it. */
const ALONG_FAINT_ALPHA = 0.35;

/** The overlay for one pane. */
export function foldPaneOverlay(input: FoldPaneOverlayInput): FoldPaneOverlay {
  const { pane, inks } = input;
  const spread = pane === 'folded' ? (input.spread ?? null) : null;
  const dots: Dot[] = [...(input.tool?.dots ?? [])];
  const strokes: Stroke[] = [...(input.tool?.strokes ?? [])];

  // The marks, under the picks: each point a mark makes, where the pane shows it.
  const markAt = (point: SheetPoint): Point | null => {
    if (pane !== 'folded') return toPoint(point);
    if (spread) return spread.sheet(point);
    return input.scene ? sheetToScene(input.scene, point) : null;
  };
  for (const mark of input.marks) {
    for (const point of markPoints(mark)) {
      const at = markAt(point);
      if (at) dots.push({ at, radius: MARK_RADIUS, fill: inks.mark, stroke: inks.outline });
    }
  }

  const offered = input.offered ?? null;
  const draw = (pick: FoldPick, hover: boolean) => {
    // A swivel's folded edge: the edge lit, and no dot. Where along it the
    // creases meet is the engine's to find, and its preview draws that dot
    // (owner feedback, 2026-10-13: a dot where it was clicked read as a
    // point to choose). By-creases construction does choose that exact
    // point, so it gets the usual point hover and selected dot instead.
    if (pick.kind === 'point' && pick.fold && pick.foldLocation !== 'given') {
      draw(pick.fold, hover);
      return;
    }
    const at = pickOnPane(pick, pane, spread);
    if (!at) return;
    if ('x' in at) {
      dots.push(
        hover
          ? { at, radius: HOVER_RADIUS, fill: withAlpha(inks.accent, HOVER_FILL_ALPHA), stroke: inks.accent }
          : { at, radius: PICKED_RADIUS, fill: inks.accent, stroke: inks.outline }
      );
    } else {
      // A line offered and under the pointer is lit as brightly as a pick: the one a click takes.
      const strong = !hover || offered?.some((line) => pick.kind === 'segment' && line.edge === pick.edge) === true;
      strokes.push({
        a: at[0],
        b: at[1],
        color: strong ? inks.accent : withAlpha(inks.accent, HOVER_LINE_ALPHA),
        widthMul: LINE_WIDTH_MUL,
      });
    }
  };
  // The lines offered, under everything picked.
  for (const line of offered ?? []) {
    const at = pickOnPane(line, pane, spread);
    if (at && !('x' in at)) strokes.push({ a: at[0], b: at[1], color: withAlpha(inks.accent, OFFERED_ALPHA), widthMul: OFFERED_WIDTH_MUL });
  }
  // A located line, under the picks that located it.
  if (pane === 'folded') {
    for (const [a, b] of input.located ?? []) strokes.push({ a, b, color: inks.accent, widthMul: LOCATED_WIDTH_MUL });
  }
  // A partial precrease's line, where its points are clicked: solid, in the
  // pick accent, as any located line — never dashed, which a crease is.
  const along = input.along ?? null;
  if (along) {
    const color = along.faint ? withAlpha(inks.accent, ALONG_FAINT_ALPHA) : inks.accent;
    for (const [a, b] of along.pieces) strokes.push({ a, b, color, widthMul: along.faint ? 1 : LOCATED_WIDTH_MUL });
  }
  for (const pick of input.picks) draw(pick, false);
  for (const pick of along?.picks ?? []) draw(pick, false);
  if (input.echo) draw(input.echo, false);

  const hovered = input.hovered;
  if (hovered?.pick) draw(hovered.pick, true);
  // A segment being drawn along the line, on the folded pane: from its first
  // end to where a click would put the other.
  const [first] = along?.picks ?? [];
  if (along?.segment && along.picks.length === 1 && first && pane === 'folded' && hovered?.pick?.kind === 'point') {
    const a = pickOnPane(first, pane, spread);
    const b = pickOnPane(hovered.pick, pane, spread);
    if (a && b && 'x' in a && 'x' in b) {
      strokes.push({ a, b, color: withAlpha(inks.accent, HOVER_LINE_ALPHA), widthMul: LINE_WIDTH_MUL });
    }
  }
  // The line a free fold — or a line through two snapped points — is being
  // drawn along, on the pane under the pointer: from its first end to where
  // a click would put the other.
  const from = input.freeFrom ? pickOnPane(input.freeFrom, pane, spread) : null;
  const toKind = input.freeFrom?.kind ?? null;
  const to = hovered?.pane === pane && hovered.pick && hovered.pick.kind === toKind ? pickOnPane(hovered.pick, pane, spread) : null;
  if (from && to && 'x' in from && 'x' in to) {
    strokes.push({ a: from, b: to, color: withAlpha(inks.accent, HOVER_LINE_ALPHA), widthMul: 1 });
  }
  return {
    points: packDots(dots),
    strokes: packStrokes(strokes),
    fills: foldRegionTint(input.regions ?? null, hovered, inks.accent),
  };
}
