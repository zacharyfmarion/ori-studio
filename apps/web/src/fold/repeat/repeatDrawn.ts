/**
 * An axis Repeat is given by a line drawn on the canvas, located with the
 * line modes as any fold's line is (`foldToolRegistry`): an existing crease,
 * an axiom, or a free line. The axis is a line on the paper, so a drawn line
 * is read as one:
 *
 * - on the **crease pattern**, it is the sheet line drawn — a crease's own
 *   sheet line, the line through two points, or an axiom's line on the flat
 *   sheet;
 * - on the **folded pane**, it is read on the top layer under it: the line
 *   drawn in the scene, taken to the sheet through the transform of the face
 *   on top where it is drawn — a crease picked there is the top crease's own
 *   sheet line already.
 *
 * Taken when it is one of the range's verified axes, within Repeat's
 * tolerance; refused otherwise, the nearest one offered when it is near.
 *
 * Pure.
 */
import type { Point } from '../../lib/geometry';
import {
  alongLine,
  chordOfConvex,
  invertIsometry,
  lineThrough,
  pointOnLine,
  sceneLineOf,
  toPoint,
  transformLine,
} from '../canvas/foldCanvasGeometry';
import {
  resolveFoldPick,
  type FoldHit,
  type FoldHitRadii,
  type FoldPaneId,
  type FoldPick,
  type FoldPickIndex,
  type FoldSegmentPick,
} from '../canvas/foldPicking';
import type { FoldModelLine } from '../document/foldSequenceDocument';
import type { FoldIsometry } from '../engine/foldEngineWire';
import { lineModeAxiom, type FoldLineModeId } from '../tools/foldToolCatalog';
import { lineModeInput } from '../tools/foldToolRegistry';
import type { FoldToolState } from '../tools/foldToolState';
import { modelMap, REPEAT_TOL, type RepeatSymmetry } from './repeatGeometry';
import { sameRepeatLine } from './repeatRange';

/** A line drawn for Repeat's axis, as the sheet line it names and the line drawn on its pane. */
export interface RepeatDrawnLine {
  /** On the sheet: the axis it names. */
  sheet: FoldModelLine;
  /** The pane it was drawn on. */
  pane: FoldPaneId;
  /** As drawn there: in sheet coordinates on the crease pattern, in the scene frame on the folded pane. */
  drawn: FoldModelLine;
}

/** Where a line drawn for Repeat came from, as analytics names it. */
export type RepeatAxisSource = 'listed' | 'drawn_cp' | 'drawn_folded';

export const drawnAxisSource = (drawn: Pick<RepeatDrawnLine, 'pane'>): RepeatAxisSource =>
  drawn.pane === 'crease-pattern' ? 'drawn_cp' : 'drawn_folded';

/**
 * A scene line read on the top layer under it, near `near`: through the
 * transform of the face on top at the point of the line nearest `near` — or,
 * off the paper there, where the line first crosses the paper beyond it.
 * Null when the line misses the paper.
 */
export function sheetLineUnder(index: FoldPickIndex, line: FoldModelLine, near: Point): FoldModelLine | null {
  // The point of the line nearest `near`, and how far along the line each subface's stretch lies from it.
  const t0 = alongLine(line, near);
  let best: { top: number; off: number } | null = null;
  for (const subface of index.subfaces) {
    const top = subface.stack[0];
    if (top === undefined) continue;
    const chord = chordOfConvex(subface.polygon, line);
    if (!chord || chord[1] - chord[0] < 1e-9) continue;
    const off = t0 < chord[0] ? chord[0] - t0 : t0 > chord[1] ? t0 - chord[1] : 0;
    if (!best || off < best.off) best = { top, off };
  }
  const transform = best ? index.scene.face_transforms[best.top] : undefined;
  return transform ? transformLine(invertIsometry(transform), line) : null;
}

/** The sheet line along a crease or edge picked on either pane: its own sheet segment. */
function creaseSheetLine(pick: FoldSegmentPick): FoldModelLine | null {
  return lineThrough(toPoint(pick.sheet[0]), toPoint(pick.sheet[1]));
}

/** Whether every pick was made on the crease pattern: the line is the sheet's own. */
export function drawnOnCreasePattern(picks: readonly FoldPick[]): boolean {
  return picks.length > 0 && picks.every((pick) => pick.pane === 'crease-pattern');
}

/**
 * An axiom's roots for the picks, as the engine named them (`axiomCandidates`),
 * and the frame they are in: the flat sheet's model frame for picks on the
 * crease pattern, the state on screen's for picks on the folded pane.
 */
export interface RepeatAxiomRoots {
  lines: readonly FoldModelLine[];
  /** The frame's model → sheet map: the flat sheet's face, for picks on the crease pattern. */
  sheetOfModel: FoldIsometry | null;
}

/**
 * The lines the picks draw once every click of the line mode is in: one for
 * a crease or a free line, one per root for an axiom (`roots`, asked of the
 * engine; null while it is). Null until then, or when the picks draw no line.
 */
export function repeatDrawnLines(
  mode: FoldLineModeId,
  picks: readonly FoldPick[],
  index: FoldPickIndex | null,
  roots: RepeatAxiomRoots | null
): RepeatDrawnLine[] | null {
  if (picks.length !== lineModeInput(mode).steps.length || picks.length === 0) return null;
  const onCp = drawnOnCreasePattern(picks);
  const pane: FoldPaneId = onCp ? 'crease-pattern' : 'folded';
  if (lineModeAxiom(mode) !== null) {
    if (!roots) return null;
    if (onCp) {
      const toSheet = roots.sheetOfModel;
      return toSheet ? roots.lines.map((line) => ({ sheet: transformLine(toSheet, line), pane, drawn: transformLine(toSheet, line) })) : null;
    }
    if (!index) return null;
    const near = middleOf(picks.flatMap(sceneOf));
    return roots.lines.flatMap((line) => {
      const drawn = sceneLineOf(index.scene.view_transform, line);
      const sheet = sheetLineUnder(index, drawn, near ?? pointOnLine(drawn, 0));
      return sheet ? [{ sheet, pane, drawn }] : [];
    });
  }
  if (mode === 'free') {
    const [p, q] = picks;
    if (p?.kind !== 'free' || q?.kind !== 'free') return null;
    if (onCp && p.sheet && q.sheet) {
      const sheet = lineThrough(toPoint(p.sheet), toPoint(q.sheet));
      return sheet ? [{ sheet, pane, drawn: sheet }] : null;
    }
    const drawn = lineThrough(p.scene, q.scene);
    if (!drawn || !index) return null;
    const sheet = sheetLineUnder(index, drawn, { x: (p.scene.x + q.scene.x) / 2, y: (p.scene.y + q.scene.y) / 2 });
    return sheet ? [{ sheet, pane, drawn }] : null;
  }
  const [crease] = picks;
  if (crease?.kind !== 'segment') return null;
  const sheet = creaseSheetLine(crease);
  const drawn = crease.pane === 'crease-pattern' || onCp ? sheet : lineThrough(crease.scene[0], crease.scene[1]);
  return sheet && drawn ? [{ sheet, pane, drawn }] : null;
}

/** Where a pick is on the folded pane, when it is on the paper there. */
function sceneOf(pick: FoldPick): Point[] {
  if (pick.kind === 'segment') return [{ x: (pick.scene[0].x + pick.scene[1].x) / 2, y: (pick.scene[0].y + pick.scene[1].y) / 2 }];
  return pick.scene ? [pick.scene] : [];
}

function middleOf(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}

/** The model → sheet map of the flat sheet's one face: an axiom's roots asked of the sheet are in its model frame. */
export function sheetOfFlatModel(scene: Parameters<typeof modelMap>[0]): FoldIsometry | null {
  return scene.faces.length === 1 ? invertIsometry(modelMap(scene, 0)) : null;
}

/** The verified axis the first drawn line that is one names, within Repeat's tolerance; -1 for none. */
export function drawnRepeatAxis(axes: readonly RepeatSymmetry[], drawn: readonly Pick<RepeatDrawnLine, 'sheet'>[]): number {
  for (const line of drawn) {
    const found = axes.findIndex((axis) => sameRepeatLine(axis.sheet, line.sheet));
    if (found >= 0) return found;
  }
  return -1;
}

/** The verified axis a crease or edge picked lies along, on either pane; -1 for none. */
export function repeatAxisAlong(axes: readonly RepeatSymmetry[], pick: FoldPick | null): number {
  const line = pick?.kind === 'segment' ? creaseSheetLine(pick) : null;
  return line ? axes.findIndex((axis) => sameRepeatLine(axis.sheet, line)) : -1;
}

/** What the canvas asks of Repeat while it is in hand: whether an axis may be taken, the axes, and the one under a point. */
export interface RepeatHitSource {
  view: { drawing: boolean; axes: readonly RepeatSymmetry[] | null };
  axisAt: (pane: FoldPaneId, at: Point, radius: number) => number;
}

/**
 * What a click on a pane would do with Repeat in hand (`useFoldCanvasVerbs`):
 *
 * - while a line is being located, take the line mode's next pick, as any
 *   fold's line takes it;
 * - else, a crease or a point the line mode takes starts a line — a crease
 *   along an axis saying which axis it is, so the pointer on it previews it;
 * - else, the axis drawn under the pointer (`axisAt`), previewed while the
 *   pointer is on it and taken by a click;
 * - else, a free line's first end.
 *
 * Nothing while no axis may be taken. `free` is the free-point key held.
 */
export function repeatHit(
  index: FoldPickIndex,
  pane: FoldPaneId,
  at: Point,
  radii: FoldHitRadii,
  tool: Pick<FoldToolState, 'lineMode' | 'picks' | 'freeLineSnap'>,
  repeat: RepeatHitSource | null,
  free: boolean
): FoldHit {
  if (!repeat?.view.drawing) return { pane, at, pick: null };
  const model = lineModeInput(tool.lineMode);
  // A line located and refused: the next click starts another.
  const drawing = tool.picks.length > 0 && tool.picks.length < model.steps.length;
  const step = model.steps[drawing ? tool.picks.length : 0];
  if (!step) return { pane, at, pick: null };
  const found = resolveFoldPick(index, pane, at, radii, {
    snap: step.snap,
    edges: step.edges,
    ...(step.kinds ? { kinds: step.kinds } : {}),
    free,
    snapFree: step.snapFree === true && tool.freeLineSnap,
  });
  // Where a crease was picked: on the crease pattern it is the sheet's own line.
  const pick: FoldPick | null = found?.kind === 'segment' ? { ...found, pane } : found;
  if (drawing) return { pane, at, pick };
  if (pick?.kind === 'segment') {
    const along = repeatAxisAlong(repeat.view.axes ?? [], pick);
    return along >= 0 ? { pane, at, pick, repeatAxis: along } : { pane, at, pick };
  }
  if (pick?.kind === 'point') return { pane, at, pick };
  const axis = repeat.axisAt(pane, at, radii.line);
  return axis >= 0 ? { pane, at, pick: null, repeatAxis: axis } : { pane, at, pick };
}

/** How far off a drawn line may be, in degrees and as a share of the paper's span, for its nearest axis to be offered. */
const NEAR_DEGREES = 4;
const NEAR_SHARE = 0.04;

/**
 * The verified axis nearest a drawn line that is none of them, on the sheet,
 * when one is near enough to be what the folder meant — within a few degrees
 * and a few hundredths of the paper's span (`span`, in sheet units) —
 * offered to take in its place, never taken for it; -1 when none is.
 */
export function nearestRepeatAxis(axes: readonly RepeatSymmetry[], drawn: readonly Pick<RepeatDrawnLine, 'sheet'>[], span: number): number {
  let best = -1;
  let score = Infinity;
  for (const { sheet } of drawn)
    for (const [k, axis] of axes.entries()) {
      const line = axis.sheet;
      const dot = line.n[0] * sheet.n[0] + line.n[1] * sheet.n[1];
      const sign = dot >= 0 ? 1 : -1;
      const degrees = (Math.acos(Math.min(1, Math.abs(dot))) * 180) / Math.PI;
      const offset = Math.abs(line.d - sign * sheet.d) / Math.max(span, REPEAT_TOL);
      if (degrees > NEAR_DEGREES || offset > NEAR_SHARE) continue;
      const off = degrees / NEAR_DEGREES + offset / NEAR_SHARE;
      if (off < score) {
        best = k;
        score = off;
      }
    }
  return best;
}
