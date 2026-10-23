/**
 * A vertex fold's step (plan Phase 11, D6): from what the tools picked and
 * what the engine said of the flap, line or fan, to the op and choices a
 * document stores — the vertex folds' `reverseStep`.
 *
 * Two ops are built, each from the one before:
 *
 * - **The asked op** ({@link vertexAskedOp}) is what the engine is asked to
 *   describe first (the compound question): the clicks' sheet anchors, the
 *   direction, a fan's layers — the geometry the folder's choices are made
 *   against. A rabbit ear's hinge ray is fixed by the region clicked;
 *   its stationary anchor is resolved automatically. A squash is asked with its spine on the
 *   hinge, so its vertex is known wherever the folder aims it; a swivel by its
 *   edge is asked with the ridge square to the edge, and the answer lists both
 *   ridges and which land.
 * - **The folded op** is the asked one with the choices made: a squash's
 *   spine target ({@link withTarget}) and a fan's fourth ray, or a swivel's
 *   ridge — the folder's, else the first that lands ({@link emergentToFold},
 *   {@link withEmergent}). A rabbit ear's fourth crease rises as its ridge,
 *   the odd letter out of its four, so there is no ridge to choose (an older
 *   step's `ridge` is not read).
 *
 * What a step stores is each one's result — a direction, a depth at a sheet
 * point, the completion's FOLD triples — never an index (plan D6).
 *
 * **Which layer a click names** is the one the viewer sees on the side the
 * direction names, at the point clicked: the top for a valley, the bottom for
 * a mountain (the engine's own reading of a squash's flap and a petal fold's
 * petal). It is found here, from the scene, so a click keeps meaning the same
 * flap when the direction changes.
 *
 * **The hinge region** in a rabbit ear is picked after its three corners.
 * Kawasaki's theorem fixes one fourth ray there. The other two regions are
 * tried as stationary anchors, without changing the selected hinge.
 *
 * **A petal fold's hinge** is named as the folder chose ({@link petalHingeOf}):
 * the precrease clicked, or the line through two points clicked, which the
 * fold creases itself. The flap below it is a region of the folded form the
 * canvas lights from the engine's answer ({@link petalRegionKey}).
 *
 * **A swivel** is made by its edge (`FoldSwivelEdgeOp`): the pivot, the edge
 * clicked and the line it lands on. A pivot clicked on a folded edge makes
 * the classic swivel whose creases meet on that edge
 * (`FoldSwivelOnFoldOp`, `fold`): the point names the edge, and the creases
 * meet where the line halfway between the edge and the target crosses it.
 * Or it is made by its valley and mountain (`FoldSwivelValleyMountainOp`):
 * the two lines on the layer that faces the viewer, each located with the
 * line modes, which meet on a folded edge; it has no direction, its letters
 * being the viewer's. On a folded edge it is open — its strip folded up on
 * top — or inside, the strip tucked between the two layers. It is folded as
 * the folder asked, its way and its kind, and never another (owner feedback,
 * 2026-10-20: a swivel that silently folded behind): a way or a kind that
 * does not land is refused, and the refusal offers the other way when that
 * one lands. A swivel by its rays still replays and shows; no tool makes one.
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../../lib/geometry';
import {
  FOLD_SWIVEL_KINDS,
  isSwivelEdgeOp,
  isFoldedSwivelOp,
  petalOp,
  swivelKindOf,
  vertexDirectionOf,
  withSwivelKind,
  type FoldChoices,
  type FoldCompletionChoice,
  type FoldDirection,
  type FoldLocatedLine,
  type FoldModelDirection,
  type FoldModelLine,
  type FoldPetalHinge,
  type FoldSeed,
  type FoldSwivelKind,
  type FoldSwivelTarget,
  type FoldVertexOp,
  type SheetPoint,
} from '../../document/foldSequenceDocument';
import type { FoldVertexAnalysed } from '../../engine/foldEngineSquashWire';
import type { FoldEngineRefused, FoldModelPoint } from '../../engine/foldEngineWire';
import { applyIsometry, invertIsometry, lineThrough, polygonArea, sideOf, toPair } from '../../canvas/foldCanvasGeometry';
import { foldStackAt, type FoldPick, type FoldPickIndex, type FoldSegmentPick } from '../../canvas/foldPicking';
import { isVertexTool, type FoldLineBy, type FoldToolId, type FoldVertexToolId } from '../foldToolCatalog';
import { fanHingeRay, fanLayerProbe, fanRegionAt, fanRegionOnFolded, fanStayer, fanToward, type FoldFanGiven } from './fanGeometry';
import { lineByClicks, SWIVEL_TARGET_FROM, type FoldSquashHinge, type FoldSwivelInput } from './vertexInputs';

/** What the tools have picked for a vertex fold, and every choice made of what the engine lists. */
export interface FoldVertexIntent {
  tool: FoldVertexToolId;
  /** How a petal fold's hinge is named: a precrease, or its two ends. */
  petalHinge: FoldLineBy;
  /** How a swivel's target is named: a crease or an edge, or two points. */
  swivelTarget: FoldLineBy;
  /** How a swivel is constructed: by its edge onto a line, or by its valley and mountain. */
  swivelInput?: FoldSwivelInput;
  /** A swivel by its valley and mountain's valley, once taken, and its mountain, once located. */
  swivelValley?: FoldLocatedLine;
  swivelMountain?: FoldLocatedLine;
  /** A squash's hinge: the folded edge, or a line drawn; and that line, once taken. */
  squashHinge?: FoldSquashHinge;
  hinge?: FoldLocatedLine;
  /** In click order (`vertexInputs`). */
  picks: readonly FoldPick[];
  /** As the viewer sees it. */
  direction: FoldDirection;
  /** The layers a rabbit ear cuts from the direction's side; null for every one. */
  fanLayers: number | null;
  /**
   * A swivel on a folded edge's kind, as it is asked: its strip on top
   * (open, absent) or tucked between the two layers. Read by no other fold.
   */
  swivelKind?: FoldSwivelKind;
}

/** A fan's fourth ray before one is taken: the analysis lists every candidate whatever it is. */
export const PLACEHOLDER_RAY: FoldModelDirection = [1, 0];

/** A refusal the tools can tell without the engine, under the engine's own code. */
function refusedAs(refusal: FoldEngineRefused['refusal']): FoldEngineRefused {
  return { status: 'refused', refusal, fixes: [], faces: [], vertices: [] };
}

/** Why a vertex op cannot be built from the clicks: one of them names no paper. */
export function offPaper(point: SheetPoint | null): FoldEngineRefused {
  return refusedAs({ code: 'point_off_paper', ...(point ? { point } : {}) });
}

/** Which side of the paper a layer is read from: the direction's own, or the far one. */
type Seen = 'near' | 'far';

/**
 * The sheet point, at a point of the folded pane, of the layer the viewer
 * sees there on the direction's side (`near`: the top for a valley) or the
 * other (`far`). Null off the paper.
 */
export function layerSheetPointAt(
  index: FoldPickIndex,
  scene: Point,
  direction: FoldDirection,
  seen: Seen = 'near'
): SheetPoint | null {
  const stack = foldStackAt(index, scene);
  const top = (direction === 'valley') === (seen === 'near');
  const face = top ? stack[0] : stack[stack.length - 1];
  const transform = face === undefined ? undefined : index.scene.face_transforms[face];
  return transform ? toPair(applyIsometry(invertIsometry(transform), scene)) : null;
}

/** Where a pick is on the folded pane's scene frame; null for a segment's. */
function sceneOf(pick: FoldPick | undefined): Point | null {
  if (!pick || pick.kind === 'segment') return null;
  return pick.scene;
}

/** The sheet point a point pick names: a landmark's, or the paper's under a free click. */
function sheetOf(pick: FoldPick | undefined): SheetPoint | null {
  if (!pick || pick.kind === 'segment') return null;
  return pick.sheet;
}

/** A sheet point inside a line pick's sheet segment: what names the crease or edge it is. */
export const middleOf = ({ sheet: [a, b] }: FoldSegmentPick): SheetPoint => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// ---------------------------------------------------------------------------
// A petal fold's hinge, and the flap below it

/** The clicks that name a petal fold's hinge, by how it is named. */
export function petalHingeClicks(intent: Pick<FoldVertexIntent, 'petalHinge'>): number {
  return lineByClicks(intent.petalHinge);
}

/**
 * A petal fold's hinge as its clicks name it (`FoldPetalHinge`): the
 * precrease clicked, by a sheet point inside it, or the line through the two
 * points clicked. Null before those clicks are in.
 */
export function petalHingeOf(intent: Pick<FoldVertexIntent, 'petalHinge' | 'picks'>): FoldPetalHinge | null {
  const [first, second] = intent.picks;
  if (intent.petalHinge === 'crease') return first?.kind === 'segment' ? { kind: 'crease', at: middleOf(first) } : null;
  const from = sheetOf(first);
  const to = sheetOf(second);
  return from && to ? { kind: 'points', from, to } : null;
}

/** The hinge's line on the folded pane, from its clicks; null before they are in. */
export function petalHingeScene(intent: Pick<FoldVertexIntent, 'petalHinge' | 'picks'>): FoldModelLine | null {
  const [first, second] = intent.picks;
  if (intent.petalHinge === 'crease') return first?.kind === 'segment' ? lineThrough(first.scene[0], first.scene[1]) : null;
  const a = sceneOf(first);
  const b = sceneOf(second);
  return a && b ? lineThrough(a, b) : null;
}

/**
 * Whether a click now picks a petal fold's flap: its next click, once its
 * hinge is named, or a click while its fold is previewed, which picks it
 * again. `picks` is how many clicks are in.
 */
export function picksPetalRegion(tool: FoldToolId, petalHinge: FoldLineBy, picks: number): boolean {
  if (tool !== 'petal') return false;
  const clicks = lineByClicks(petalHinge);
  return picks === clicks || picks === clicks + 1;
}

/**
 * Which flap a point of the folded pane names below a petal fold's hinge, as
 * a key: the layer the direction names there (the top one for a valley) and
 * the hinge's side it lies on. The engine grows the flap from that layer, on
 * that side, so two points with one key name one flap: the canvas asks the
 * engine once per key (`useFoldPetalMarks`). Null off the paper, or before the
 * hinge is named.
 */
export function petalRegionKey(
  index: FoldPickIndex,
  intent: Pick<FoldVertexIntent, 'petalHinge' | 'picks' | 'direction'>,
  scene: Point
): string | null {
  const line = petalHingeScene(intent);
  if (!line) return null;
  const stack = foldStackAt(index, scene);
  const face = intent.direction === 'valley' ? stack[0] : stack[stack.length - 1];
  if (face === undefined) return null;
  return `${face}${sideOf(line, scene) >= 0 ? '+' : '-'}`;
}

/** The petal op whose flap is the paper at a point of the folded pane; null off the paper or before the hinge. */
export function petalOpAt(
  index: FoldPickIndex,
  intent: Pick<FoldVertexIntent, 'petalHinge' | 'picks' | 'direction'>,
  scene: Point
): FoldVertexOp | null {
  const hinge = petalHingeOf(intent);
  const petal = layerSheetPointAt(index, scene, intent.direction);
  return hinge && petal ? petalOp(hinge, petal, intent.direction) : null;
}

// ---------------------------------------------------------------------------
// A squash's flap

/** A line the tools took (`FoldToolState.takenLine`) as a step stores it: without its line on the folded pane. */
export function storedLine(line: (FoldLocatedLine & { sceneLine?: FoldModelLine }) | undefined): FoldLocatedLine | undefined {
  return line ? { line: line.line, ...(line.root ? { root: line.root } : {}) } : undefined;
}

/** A squash of the flap a sheet point names, about the hinge the intent takes: the drawn one, when it is. */
function squashOp(flap: SheetPoint, intent: Pick<FoldVertexIntent, 'direction' | 'hinge'>): FoldVertexOp {
  return { kind: 'squash', flap, direction: intent.direction, ...(intent.hinge ? { hinge: intent.hinge } : {}) };
}

/**
 * The squash whose flap is the paper at a point of the folded pane — the
 * layer the viewer sees there, on the direction's side — about the hinge the
 * intent takes; null off the paper, or while a drawn hinge is not yet taken.
 */
export function squashOpAt(
  index: FoldPickIndex,
  intent: Pick<FoldVertexIntent, 'direction' | 'squashHinge' | 'hinge'>,
  scene: Point
): FoldVertexOp | null {
  if (intent.squashHinge === 'line' && !intent.hinge) return null;
  const flap = layerSheetPointAt(index, scene, intent.direction);
  return flap ? squashOp(flap, intent) : null;
}

/**
 * Which flap a point of the folded pane names for a squash, as a key: the
 * face the viewer sees there, and about a drawn hinge (its line on the
 * folded pane, `hingeScene`) the side of it the point is on — each side's
 * end is another flap. Null off the paper.
 */
export function squashFlapKey(
  index: FoldPickIndex,
  direction: FoldDirection,
  hingeScene: FoldModelLine | null,
  scene: Point
): string | null {
  const stack = foldStackAt(index, scene);
  const face = direction === 'valley' ? stack[0] : stack[stack.length - 1];
  if (face === undefined) return null;
  return hingeScene ? `${face}${sideOf(hingeScene, scene) >= 0 ? '+' : '-'}` : `${face}`;
}

// ---------------------------------------------------------------------------
// A swivel's target

/** The line a swivel's target clicks name; null before they are in. */
function swivelTargetOf(intent: Pick<FoldVertexIntent, 'swivelTarget'>, picks: readonly FoldPick[]): FoldSwivelTarget | null {
  const [first, second] = picks;
  if (intent.swivelTarget === 'crease') return first?.kind === 'segment' ? { via: 'crease', at: middleOf(first) } : null;
  const a = sheetOf(first);
  const b = sheetOf(second);
  return a && b ? { via: 'free', through: [a, b] } : null;
}

/**
 * Whether a click now picks a swivel's pivot — its first — which may sit on a
 * folded edge, where its creases then meet (`resolveFoldEdgePoint`).
 */
export function picksSwivelPivot(tool: FoldToolId, picks: number): boolean {
  return tool === 'swivel' && picks === 0;
}

/**
 * The folded edge a swivel's pivot was clicked on, its creases meeting there
 * (`FoldSwivelOnFoldOp`); null for a pivot anywhere else, and before it is
 * clicked.
 */
export function swivelFoldPick(intent: { tool: FoldToolId; picks: readonly FoldPick[] }): FoldSegmentPick | null {
  const pivot = intent.tool === 'swivel' ? intent.picks[0] : undefined;
  return pivot?.kind === 'point' ? (pivot.fold ?? null) : null;
}

/** The edge a swivel's clicks moved, on the folded pane; null before it is clicked. */
export function swivelEdgePick(intent: { tool: FoldToolId; picks: readonly FoldPick[] }): FoldSegmentPick | null {
  const edge = intent.tool === 'swivel' ? intent.picks[1] : undefined;
  return edge?.kind === 'segment' ? edge : null;
}

/** Whether two scene segments run parallel: a target no turn lays the edge on. */
export function parallelSegments([a, b]: readonly [Point, Point], [c, d]: readonly [Point, Point]): boolean {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: d.x - c.x, y: d.y - c.y };
  const lengths = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  return !(lengths > 0) || Math.abs(u.x * v.y - u.y * v.x) / lengths < 1e-6;
}

// ---------------------------------------------------------------------------
// A rabbit ear's center and layers

/** The incenter of a triangle: its corners weighted by the opposite sides (the engine's `incenter`). */
export function incenter([a, b, c]: readonly [Point, Point, Point]): Point | null {
  const side = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
  const [la, lb, lc] = [side(b, c), side(a, c), side(a, b)];
  const sum = la + lb + lc;
  if (!(sum > 0)) return null;
  return { x: (la * a.x + lb * b.x + lc * c.x) / sum, y: (la * a.y + lb * b.y + lc * c.y) / sum };
}

/**
 * Where a rabbit ear's creases meet, on the folded pane: its incenter (an
 * isometry keeps it, so the scene's is the model's, carried). Null before the
 * clicks that place it are in, and for any other fold.
 */
export function fanCenterScene(intent: Pick<FoldVertexIntent, 'tool' | 'picks'>): Point | null {
  if (intent.tool !== 'rabbit-ear') return null;
  const [a, b, c] = intent.picks.slice(0, 3).map(sceneOf);
  return a && b && c ? incenter([a, b, c]) : null;
}

/** How many clicks place a fan's given rays; the hinge region is the click after them. Null for any other fold. */
export function fanGivenClicks(tool: FoldVertexToolId): number | null {
  return tool === 'rabbit-ear' ? 3 : null;
}

/**
 * A rabbit ear's given rays on the folded pane (`fanGeometry`), from its
 * incenter to its corners. Null before those clicks are in, or for any other
 * fold.
 */
export function fanGiven(intent: Pick<FoldVertexIntent, 'tool' | 'picks'>): FoldFanGiven | null {
  const clicks = fanGivenClicks(intent.tool);
  const center = fanCenterScene(intent);
  if (clicks === null || !center || intent.picks.length < clicks) return null;
  const toward = intent.picks.slice(clicks - 3, clicks).map(sceneOf);
  return toward.every((q): q is Point => q !== null) ? fanToward(center, toward, true) : null;
}

/**
 * Whether a click now picks a fan's hinge region: its next click, once
 * its given rays are placed, or a click while its fold is previewed, which
 * picks it again. `picks` is how many clicks are in.
 */
export function picksFanHinge(tool: FoldToolId, picks: number): boolean {
  const clicks = isVertexTool(tool) ? fanGivenClicks(tool) : null;
  return clicks !== null && (picks === clicks || picks === clicks + 1);
}

/** The region of `fan` the hinge was clicked in; null before that click, or at the center. */
export function fanHingeRegion(intent: Pick<FoldVertexIntent, 'tool' | 'picks'>, fan: FoldFanGiven): number | null {
  const clicks = fanGivenClicks(intent.tool);
  const scene = clicks === null ? null : sceneOf(intent.picks[clicks]);
  return scene ? fanRegionAt(fan, scene) : null;
}

/** How many layers lie at a fan's center: what its layers stepper counts up to. */
export function fanLayerCount(index: FoldPickIndex, center: Point): number {
  return foldStackAt(index, fanLayerProbe(index, center)).length;
}

/**
 * The layers a fan cuts, as the step stores them: every one, or the first
 * `layers` from the direction's side, counted from a sheet point at the
 * center on the first of them. Null when the center is on no paper.
 */
export function fanSeed(
  index: FoldPickIndex,
  center: Point,
  direction: FoldDirection,
  layers: number | null
): FoldSeed | null {
  const count = fanLayerCount(index, center);
  if (count === 0) return null;
  if (layers === null || layers >= count) return { scope: 'all' };
  const at = layerSheetPointAt(index, fanLayerProbe(index, center), direction, 'near');
  return at ? { scope: 'depth', at, layers: Math.max(1, layers) } : null;
}

/** Prefer keeping the larger remaining region still, then try the other.
 * This anchors the body of a model instead of flipping it with the ear.
 */
function fanAnchors(intent: FoldVertexIntent, index: FoldPickIndex, fan: FoldFanGiven, hinge: number): SheetPoint[] {
  return [0, 1, 2].filter(k => k !== hinge).map(k => ({
    at: fanStayer(index, fan, k, intent.direction, intent.fanLayers),
    area: fanRegionOnFolded(index, fan, k).reduce((sum, polygon) => sum + Math.abs(polygonArea(polygon)), 0),
  })).sort((a, b) => b.area - a.area).flatMap(({ at }) => at ? [at] : []);
}

// ---------------------------------------------------------------------------
// The ops

/**
 * The op the engine is asked to describe once every click is in (see the
 * module docs); null before then, or a refusal the tools can tell without
 * the engine: a click that names no paper.
 */
export function vertexAskedOp(intent: FoldVertexIntent, index: FoldPickIndex): FoldVertexOp | FoldEngineRefused | null {
  const { picks, direction } = intent;
  const layer = (pick: FoldPick | undefined) => {
    const scene = sceneOf(pick);
    return scene ? layerSheetPointAt(index, scene, direction) : null;
  };
  switch (intent.tool) {
    case 'squash': {
      // About a drawn hinge, nothing until it is taken: the picks before then locate it.
      if (intent.squashHinge === 'line' && !intent.hinge) return null;
      if (picks.length < 1) return null;
      const flap = layer(picks[0]);
      if (!flap) return offPaper(null);
      return squashOp(flap, intent);
    }
    case 'petal': {
      const clicks = petalHingeClicks(intent);
      if (picks.length < clicks + 1) return null;
      const hinge = petalHingeOf(intent);
      const petal = layer(picks[clicks]);
      if (!hinge || !petal) return offPaper(null);
      return petalOp(hinge, petal, direction);
    }
    case 'rabbit-ear': {
      if (picks.length < 4) return null;
      const points = picks.slice(0, 3).map(sheetOf);
      // Fix the hinge in the clicked region; anchor another region automatically.
      const fan = fanGiven(intent);
      const region = fan ? fanHingeRegion(intent, fan) : null;
      const ray = fan && region !== null ? fanHingeRay(fan, region) : null;
      if (!ray) return refusedAs({ code: 'fan_not_flat' });
      const stayer = fan && region !== null ? fanAnchors(intent, index, fan, region)[0] ?? null : null;
      const seed = fan ? fanSeed(index, fan.center, direction, intent.fanLayers) : null;
      const [a, b, c] = points;
      if (!a || !b || !c || !stayer || !seed) return offPaper(null);
      const origin = index.toModel({ x: 0, y: 0 });
      const tip = index.toModel(ray);
      const emergent: FoldModelDirection = [tip.x - origin.x, tip.y - origin.y];
      return { kind: 'rabbit-ear', corners: [a, b, c], emergent, seed, stayer, direction };
    }
    case 'swivel': {
      // By its valley and mountain: both lines in, the kind asked; no direction.
      if (intent.swivelInput === 'valley-mountain') {
        const { swivelValley: valley, swivelMountain: mountain } = intent;
        if (!valley || !mountain) return null;
        return withSwivelKind({ kind: 'swivel', via: 'valley-mountain', valley, mountain }, intent.swivelKind ?? 'open');
      }
      if (picks.length < SWIVEL_TARGET_FROM + lineByClicks(intent.swivelTarget)) return null;
      const [pivotPick, edgePick, ...targetPicks] = picks;
      const pivot = sheetOf(pivotPick);
      const target = swivelTargetOf(intent, targetPicks);
      if (!pivot || edgePick?.kind !== 'segment' || !target) return offPaper(null);
      // A pivot on a folded edge: the creases meet on that edge, through the
      // two layers it joins — open, or inside when that is asked.
      if (swivelFoldPick(intent)) {
        const open = { kind: 'swivel', via: 'edge', fold: pivot, edge: middleOf(edgePick), target, direction } as const;
        return withSwivelKind(open, intent.swivelKind ?? 'open');
      }
      return { kind: 'swivel', via: 'edge', pivot, edge: middleOf(edgePick), target, seed: { scope: 'all' }, direction };
    }
  }
}

/** Try the other stationary region without changing the selected hinge or layers. */
export function fanAnchorAlternative(intent: FoldVertexIntent, index: FoldPickIndex, asked: FoldVertexOp): FoldVertexOp | null {
  if (asked.kind !== 'rabbit-ear') return null;
  const fan = fanGiven(intent);
  const picked = fan ? fanHingeRegion(intent, fan) : null;
  const stayer = fan && picked !== null ? fanAnchors(intent, index, fan, picked).find(at => at[0] !== asked.stayer[0] || at[1] !== asked.stayer[1]) : null;
  return stayer ? { ...asked, stayer } : null;
}

/**
 * A fan's fourth creases that land, by index into the candidates, in order —
 * a swivel by its edge's ridges that land, by index into its ridges: all the
 * folder is offered (owner feedback, 2026-10-12: a choice that cannot fold is
 * never offered, refused after it is made). A candidate the answer has no
 * word on lands, as far as is known. Empty for any other fold.
 */
export function landingFourths(answer: FoldVertexAnalysed | null): number[] {
  const analysis = answer?.analysis;
  if (analysis?.kind === 'rabbit-ear') {
    const k = analysis.emergent;
    return k !== null && (answer?.emergents[k] === true) ? [k] : [];
  }
  const listed =
    analysis?.kind === 'swivel-by-edge'
      ? analysis.ridges
      : analysis?.kind === 'swivel'
        ? analysis.candidates
        : [];
  return listed.flatMap((_, k) => ((answer?.emergents[k] ?? true) ? [k] : []));
}

/**
 * The fan's fourth ray taken — a swivel's ridge —: the folder's while it
 * lands, else the first that lands. With none that lands, null for a fan:
 * there is nothing to fold until the paper that stays is changed. A swivel
 * by its edge has no paper to change, so it folds the ridge it was asked
 * with, and the engine's refusal says why it cannot.
 */
export function emergentToFold(chosen: number | null, answer: FoldVertexAnalysed): number | null {
  const fourths = landingFourths(answer);
  if (chosen !== null && fourths.includes(chosen)) return chosen;
  const first = fourths[0];
  if (first !== undefined) return first;
  return answer.analysis.kind === 'swivel-by-edge' ? answer.analysis.ridge : null;
}

/** A fan the engine has described, none of whose fourth creases lands: nothing to fold until other paper stays. */
export function fanHasNoFourth(answer: FoldVertexAnalysed | null): boolean {
  const kind = answer?.analysis.kind;
  return (kind === 'rabbit-ear' || kind === 'swivel') && landingFourths(answer).length === 0;
}

/** The fourth crease `delta` on from `from` among the ones that land, round and round; null when none does. */
export function steppedFourth(fourths: readonly number[], from: number | null, delta: number): number | null {
  const count = fourths.length;
  if (count === 0) return null;
  const at = Math.max(0, from === null ? 0 : fourths.indexOf(from));
  return fourths[(((at + delta) % count) + count) % count] ?? null;
}

/**
 * The asked op with the fan's fourth ray `emergent` taken (an index into the
 * analysis' candidates), or a swivel by its edge's ridge (an index into its
 * ridges: stored only when it is not the first, the one square to the edge);
 * the op unchanged for a squash or a petal fold, or when the choice is not
 * listed.
 */
export function withEmergent(op: FoldVertexOp, answer: FoldVertexAnalysed, emergent: number | null): FoldVertexOp {
  const { analysis } = answer;
  // On a folded edge a swivel has no ridge to choose.
  if (isFoldedSwivelOp(op)) return op;
  if (isSwivelEdgeOp(op)) {
    const ray = emergent === null || analysis.kind !== 'swivel-by-edge' ? undefined : analysis.ridges[emergent];
    if (!ray) return op;
    const { ridge: _stored, ...rest } = op;
    return emergent === 0 ? rest : { ...rest, ridge: ray };
  }
  if (op.kind !== 'rabbit-ear' && op.kind !== 'swivel') return op;
  if (analysis.kind !== op.kind || emergent === null) return op;
  const ray = analysis.candidates[emergent];
  return ray ? { ...op, emergent: ray } : op;
}

/** A squash with its spine landing toward `target` (a model-frame direction); the op unchanged for any other fold, or none. */
export function withTarget(op: FoldVertexOp, target: FoldModelDirection | null): FoldVertexOp {
  return op.kind === 'squash' && target ? { ...op, target } : op;
}

/** The folder's choices of what the engine lists, by index, and where a squash's spine was aimed. */
export interface FoldVertexTaken {
  squashTarget: FoldModelDirection | null;
  /** A fan's fourth ray, or a swivel's ridge; null for the first that lands. */
  emergent: number | null;
  /** The layer order, of those listed. */
  order: number;
}

/** The op as it will be folded: the base op with the folder's spine target and fourth ray. */
export interface FoldVertexChosen {
  op: FoldVertexOp;
  /** The fourth ray or ridge taken, by index; null for no fan. */
  emergent: number | null;
  /** The way it folds, as the viewer sees it: the folder's, always (the module docs). */
  direction: FoldDirection;
  /** A swivel on a folded edge's kind: the one asked, always. Null for any other fold. */
  kind: FoldSwivelKind | null;
  /**
   * Whether it is another fold than the one first asked — a spine aimed off
   * the hinge, another fourth ray or ridge — whose orders must be asked of
   * it; otherwise the first answer stands for it.
   */
  again: boolean;
}

/**
 * Valley, then mountain: whether a swivel on a folded edge lands each way of
 * `kind`, as the engine's answer for the kind `asked` says — of both kinds
 * (`kinds`), or of the one asked alone (`directions`). Null when it has no
 * word on that kind.
 */
export function swivelDirectionsOf(
  answer: FoldVertexAnalysed,
  kind: FoldSwivelKind,
  asked: FoldSwivelKind
): readonly [boolean, boolean] | null {
  const row = answer.kinds?.[FOLD_SWIVEL_KINDS.indexOf(kind)];
  if (row && row.length === 2) return [row[0] === true, row[1] === true];
  const directions = answer.directions;
  return kind === asked && directions && directions.length === 2 ? [directions[0] === true, directions[1] === true] : null;
}

/** Open, then inside: whether a swivel on a folded edge lands each kind one way or the other; null when unknown. */
export function swivelKindsLanding(answer: FoldVertexAnalysed | null): readonly [boolean, boolean] | null {
  const kinds = answer?.kinds;
  if (!kinds || kinds.length !== 2) return null;
  const either = (k: number) => kinds[k]?.some((lands) => lands === true) === true;
  return [either(0), either(1)];
}

/** The choice of what the engine lists that the asked op names: a fan's fourth ray, a swivel's ridge. */
function namedChoice(answer: FoldVertexAnalysed): number | null {
  const { analysis } = answer;
  if (analysis.kind === 'rabbit-ear' || analysis.kind === 'swivel') return analysis.emergent;
  return analysis.kind === 'swivel-by-edge' ? analysis.ridge : null;
}

/**
 * The base op with the folder's choices made (see {@link FoldVertexChosen});
 * null for a fan none of whose fourth creases lands, which is no fold to
 * preview — the window says so, and offers other paper to stay.
 */
export function vertexChosenOp(
  base: FoldVertexOp,
  first: FoldVertexAnalysed,
  taken: FoldVertexTaken
): FoldVertexChosen | null {
  const emergent = emergentToFold(taken.emergent, first);
  const fan = base.kind === 'rabbit-ear' || (base.kind === 'swivel' && !('via' in base));
  if (fan && emergent === null) return null;
  // Folded the way and the kind asked: one that does not land is refused, never swapped.
  return {
    op: withTarget(withEmergent(base, first, emergent), taken.squashTarget),
    emergent,
    direction: vertexDirectionOf(base),
    kind: isFoldedSwivelOp(base) ? swivelKindOf(base) : null,
    again:
      (base.kind === 'squash' && taken.squashTarget !== null) ||
      (emergent !== null && emergent !== namedChoice(first)),
  };
}

/** The step a vertex tool previews and commits, and the choices it was built from. */
export interface FoldVertexBuilt {
  /** The op folded, and the completion that picks its order, when it leaves several. */
  step: { op: FoldVertexOp; choices?: FoldChoices };
  orders: readonly FoldCompletionChoice[];
  order: FoldCompletionChoice | null;
}

/**
 * The step from the op as it will be folded and the engine's answer for it:
 * the order it leaves, of those listed — stored as the completion that picks
 * it (plan D6), whenever the engine lists one (a fold that leaves a choice
 * cannot land without it).
 */
export function vertexStepFrom(chosen: FoldVertexOp, answer: FoldVertexAnalysed, taken: FoldVertexTaken): FoldVertexBuilt {
  const orders = answer.orders?.orders ?? [];
  const order = orders[Math.min(Math.max(0, taken.order), orders.length - 1)] ?? null;
  return { step: { op: chosen, ...(order ? { choices: { completion: order } } : {}) }, orders, order };
}

/**
 * The candidate pointing most nearly along `direction` — the engine's own
 * reading of a stored ray, the nearest taken (`fan.rs` `nearest`); null with
 * none, or no direction.
 */
export function nearestDirection(candidates: readonly FoldModelPoint[], direction: FoldModelPoint): number | null {
  const length = Math.hypot(direction[0], direction[1]);
  if (!(length > 0)) return null;
  let best: number | null = null;
  let bestCos = -Infinity;
  candidates.forEach(([x, y], k) => {
    const cos = (x * direction[0] + y * direction[1]) / ((Math.hypot(x, y) || 1) * length);
    if (cos > bestCos) {
      bestCos = cos;
      best = k;
    }
  });
  return best;
}

/** The direction from a squash's vertex to a model point: where its spine lands; null on the vertex itself. */
export function squashTargetToward(vertex: FoldModelPoint, at: FoldModelPoint): FoldModelDirection | null {
  const dx = at[0] - vertex[0];
  const dy = at[1] - vertex[1];
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? [dx / length, dy / length] : null;
}
