/**
 * A Fold sequence: the sheet it starts from and the steps folded on it, as the
 * project file holds it (`workspace.foldSequences`, plan D6 and D7).
 *
 * The steps are an **append-only tree**, stored flat and parent-linked. A node
 * with `parent: null` folds from the flat sheet; there is no synthetic root.
 * A node's state is fixed by its path, so a node id is a complete link target,
 * and folding differently from an earlier step makes a branch rather than an
 * edit.
 *
 * What a step stores is chosen so it survives replay (research §10):
 *
 * - **Inputs are anchors in sheet coordinates** ({@link SheetPoint}), never
 *   face, flap or enumeration ids, which are renumbered on every step. Sheet
 *   points survive because every later face is a subset of an earlier one.
 * - **Choices are results** ({@link FoldChoices}): the line an axiom root
 *   gave, the free pair assignments a completion took. Replay finds them
 *   again, and a choice that no longer resolves to exactly one result breaks
 *   its step rather than picking another.
 * - **Lines and directions are in the parent's frames.** A stored line is in
 *   the parent node's model frame; a direction is valley or mountain as seen
 *   in the parent's view, which is part of the parent's state.
 *
 * Marks, notes, a step's layer spread and `expect` ride along beside the op
 * and never change what a step folds. Status — ok, changed, broken, locked —
 * is derived on replay (`foldReplay`), never stored.
 *
 * Pure: no React, no store, no engine.
 */

import type { RegionReference } from '../../cp-workspace/regions/regionReference';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { randomId, type IdFactory } from '../../lib/documentFile';
import { DEFAULT_DOCUMENT_PAPER_STYLE, type ResolvedDocumentPaperStyle } from '../../lib/paper/documentPaperStyle';
import type { FoldAxiom, ReferenceKind } from '../../lib/foldSentences';
import {
  evaluateOrieditaRatioExpression,
  type OristudioCpRatioExpression,
} from '../../lib/oristudioCpToolSettings';
import type { TurnKind, TurnOverAxis, TurnRotation } from '../../lib/steps/turn';

/** This build's `formatVersion`: one per sequence, so a newer sequence opens read-only on its own. */
export const FOLD_SEQUENCE_FORMAT_VERSION = 2;

/** Makes the ids of a sequence, its steps and its marks: `fold-…`, `fstep-…`, `fmark-…`. */
export type FoldIdFactory = IdFactory<'fold' | 'fstep' | 'fmark'>;

export const randomFoldId: FoldIdFactory = randomId;

/**
 * A point in sheet coordinates: the unit sheet frame, y-up, the outline's
 * bounding box at the origin, longer side 1 (the engine's frame, plan D2).
 */
export type SheetPoint = readonly [number, number];

/**
 * A line `n · p = d` with a unit normal, in the parent node's model frame:
 * the engine's `Line`, as it serializes.
 */
export interface FoldModelLine {
  n: readonly [number, number];
  d: number;
}

/**
 * The shortest normal a stored model line may have: the geometry crate's
 * `TOL`, below which the engine's `Line::new` names no line. The engine
 * normalises any longer one.
 */
export const FOLD_MODEL_LINE_MIN_NORMAL = 1e-6;

// ---------------------------------------------------------------------------
// Paper

/**
 * The sheet's outline (plan D7):
 *
 * - a rectangle's `aspect` is `[width, height]` normalised to longer side 1
 *   ({@link rectangleShape});
 * - a polygon is stored as its points in the unit frame — any convex outline
 *   of 3 to 8 sides an Import starting sheet found (`io/foldStartingSheet.ts`),
 *   or, in files from before it, a regular polygon with its first vertex at
 *   −π/2 ({@link regularPolygonShape}) — and its side count is derived from
 *   them.
 */
export type FoldPaperShape =
  | { kind: 'square' }
  | { kind: 'rectangle'; aspect: readonly [number, number] }
  | { kind: 'polygon'; points: readonly SheetPoint[] };

export type FoldPaperShapeKind = FoldPaperShape['kind'];

export const FOLD_PAPER_SHAPE_KINDS: readonly FoldPaperShapeKind[] = ['square', 'rectangle', 'polygon'];

/** The fewest and most sides a polygon sheet has (plan D7). */
export const FOLD_POLYGON_MIN_SIDES = 3;
export const FOLD_POLYGON_MAX_SIDES = 8;

/**
 * Which side of the sheet faces the viewer before the first step. It changes
 * what a valley the viewer makes stores (letters are front-relative, plan D2),
 * so it is the document's, not a display setting.
 */
export type FoldStartSide = 'front' | 'back';

export const FOLD_START_SIDES: readonly FoldStartSide[] = ['front', 'back'];

export interface FoldPaper {
  shape: FoldPaperShape;
  startSide: FoldStartSide;
}

export const SQUARE_PAPER: FoldPaper = { shape: { kind: 'square' }, startSide: 'front' };

/** A `width : height` rectangle, normalised to longer side 1; null unless both are positive and finite. */
export function rectangleShape(width: number, height: number): FoldPaperShape | null {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return null;
  const longer = Math.max(width, height);
  return { kind: 'rectangle', aspect: [width / longer, height / longer] };
}

/**
 * A regular polygon of `sides` sides, its first vertex at −π/2 (the bottom),
 * counter-clockwise, placed in the unit frame: the engine's
 * `Sheet::regular`, stored as points. Null outside 3 to 8 sides.
 */
export function regularPolygonShape(sides: number): FoldPaperShape | null {
  if (!Number.isInteger(sides) || sides < FOLD_POLYGON_MIN_SIDES || sides > FOLD_POLYGON_MAX_SIDES) return null;
  const ring = Array.from({ length: sides }, (_, k): [number, number] => {
    const t = -Math.PI / 2 + (2 * Math.PI * k) / sides;
    return [Math.cos(t), Math.sin(t)];
  });
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const scale = 1 / Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0);
  return { kind: 'polygon', points: ring.map(([x, y]): SheetPoint => [(x - x0) * scale, (y - y0) * scale]) };
}

// ---------------------------------------------------------------------------
// Ops

/** Valley or mountain, as the viewer sees it in the parent's view. */
export type FoldDirection = 'valley' | 'mountain';

export const FOLD_DIRECTIONS: readonly FoldDirection[] = ['valley', 'mountain'];

/**
 * An axiom input. Each is resolved through the parent state's isometries into
 * its model frame on replay; a mark's id rides along for the sentence and for
 * provenance only — replay reads `at`, so clearing the mark breaks nothing.
 */
export type FoldRef =
  | { kind: 'point'; at: SheetPoint }
  | { kind: 'mark'; at: SheetPoint; mark: string }
  /** A line through two sheet points: an edge or a crease, by its end points. */
  | { kind: 'edge'; a: SheetPoint; b: SheetPoint };

/**
 * What each axiom's inputs are, in the shared crate's order
 * (`oristudio-geometry`'s `Construction`): O4 is `[p, m]`, O5
 * `[pivot, p, m1]`, O6 `[p1, m1, p2, m2]`, O7 `[p, m1, m2]`. Click order maps
 * to these slots in the tool, never in the file.
 */
export const AXIOM_SLOTS: Readonly<Record<FoldAxiom, readonly ReferenceKind[]>> = {
  1: ['point', 'point'],
  2: ['point', 'point'],
  3: ['line', 'line'],
  4: ['point', 'line'],
  5: ['point', 'point', 'line'],
  6: ['point', 'line', 'point', 'line'],
  7: ['point', 'line', 'line'],
};

/**
 * Where a fold line comes from (plan D14's line modes, D18's `via`):
 *
 * - an axiom, its inputs in the crate's order; the root it gave is the step's
 *   choice ({@link FoldChoices.root});
 * - a free line through two sheet points on it, at least the minimum feature
 *   apart, each the preimage of a point of the line inside the silhouette;
 * - an existing crease or bend, by a sheet point inside its sheet segment.
 */
export type FoldLineInput =
  | { via: 'axiom'; axiom: FoldAxiom; inputs: readonly FoldRef[] }
  | { via: 'free'; through: readonly [SheetPoint, SheetPoint] }
  | { via: 'crease'; at: SheetPoint };

export type FoldLineVia = FoldLineInput['via'];

/**
 * What a fold takes along with the moving side (the engine's `Seed`):
 *
 * - every layer on the moving side;
 * - the top `layers` layers at a sheet point (the bottom ones for a
 *   mountain), counted from the side the direction implies;
 * - the flaps of the faces containing these sheet points.
 */
export type FoldSeed =
  | { scope: 'all' }
  | { scope: 'depth'; at: SheetPoint; layers: number }
  | { scope: 'flaps'; at: readonly SheetPoint[] };

export type FoldSeedScope = FoldSeed['scope'];

/** The most layers a depth seed can name: the engine's `usize` in the browser's 32-bit wasm. */
export const FOLD_SEED_MAX_LAYERS = 0xffff_ffff;

/**
 * The fields every fold along a line shares. `moving` is a sheet point whose
 * image lies on the moving side, stored when neither the line (an axiom that
 * carries a point) nor the seed implies the side — always for `all` along a
 * free line or a crease — and when the step moves the other side than its
 * axiom implies (Swap), whatever the seed: the engine takes the side it
 * names over the axiom's.
 */
interface FoldAlongLine {
  line: FoldLineInput;
  moving?: SheetPoint;
  seed: FoldSeed;
}

/** A valley or mountain fold: the direction is the kind. */
export type FoldLanding = { kind: 'outer' } | { kind: 'against'; targets: readonly SheetPoint[] };

export interface FoldPlainOp extends FoldAlongLine {
  /** Absent only on legacy/in-memory outer folds. Writers make it explicit. */
  landing?: FoldLanding;
  kind: 'valley' | 'mountain';
}

/**
 * Fold and unfold: the creases are left flat, remembering their letters.
 * With an `extent`, only part of the line is creased ({@link FoldPrecreaseExtent}).
 */
export interface FoldPrecreaseOp extends FoldAlongLine {
  kind: 'precrease';
  direction: FoldDirection;
  /** Part of the line only: a segment or a pinch. Absent for the whole line. */
  extent?: FoldPrecreaseExtent;
}

/**
 * A point input, as an axiom's point slot takes one: a sheet point, or a
 * Divide-line mark's resolved sheet point with its id riding along for the
 * sentence only. Replay reads `at`.
 */
export type FoldPointRef = Extract<FoldRef, { kind: 'point' | 'mark' }>;

/**
 * How much of its line a partial precrease creases. Each point is resolved
 * through the parent and its image projected onto the located line, one rule
 * for every point:
 *
 * - **segment**: between two points of the line, in either order;
 * - **pinch**: a short mark `length` long (sheet units: the sheet's longer
 *   side is 1), centred on a point of the line — where it crosses another
 *   crease, say. The tool offers the engine's default (`defaultPinchLength`,
 *   a sixteenth of the sheet's shorter side) and the step stores the length
 *   it used, so replay never depends on the default.
 *
 * The marks it leaves are real creases — each keeps its letter, front-relative,
 * and every later fold carries it — that end inside the paper: they split no
 * face, change no layer order, and go to Edit and the FOLD export as
 * auxiliary lines. A crease folded along one later takes it in.
 */
export type FoldPrecreaseExtent =
  | { kind: 'segment'; from: FoldPointRef; to: FoldPointRef }
  | { kind: 'pinch'; at: FoldPointRef; length: number };

export type FoldPrecreaseExtentKind = FoldPrecreaseExtent['kind'];

export const FOLD_PRECREASE_EXTENT_KINDS: readonly FoldPrecreaseExtentKind[] = ['segment', 'pinch'];

/**
 * A plain fold along an existing crease, named by a sheet point inside its
 * sheet segment in the parent: refolding a precrease, or unfolding a flap
 * along a bend (plan D3: the top flap, picked by the seed).
 */
export interface FoldCreaseOp {
  kind: 'unfold' | 'refold';
  crease: SheetPoint;
  direction: FoldDirection;
  moving?: SheetPoint;
  seed: FoldSeed;
}

/** Turn the model over about an axis: the view mirrors; no layer or letter changes. */
export interface FoldTurnOp {
  kind: 'turn';
  axis: TurnOverAxis;
}

/** Rotate the model by a part of a turn: the view only. */
export interface FoldRotateOp {
  kind: 'rotate';
  rotate: TurnRotation;
}

/** Where an imported crease pattern came from: a closed enum, never a file name (plan D16, D18). */
export type FoldCpOrigin = 'cp' | 'fold' | 'ori' | 'orh' | 'sample' | 'edit_folded_figure' | 'project_cp';

export const FOLD_CP_ORIGINS: readonly FoldCpOrigin[] = ['cp', 'fold', 'ori', 'orh', 'sample', 'edit_folded_figure', 'project_cp'];

/**
 * Import CP: an authoritative snapshot, optionally linked to a project CP. The crease pattern and its
 * chosen layer order are compact JSON strings — about a third the size of
 * nested arrays in the pretty-printed project file — and the order names
 * faces by interior sheet-point witnesses, as {@link FoldChoices} does.
 */
export interface FoldCpJumpOp {
  kind: 'cp-jump';
  cpJson: string;
  orderJson: string;
  origin: FoldCpOrigin;
  /** Project-local source. Replay always uses cpJson and orderJson, never the live source. */
  source?: { documentId: string; revision: string; region?: RegionReference };
}

// --- Compound folds (plan D4), one block per family -------------------------

/**
 * A reverse fold (plan Phase 9, research §5.2): the tip — the paper on the
 * moving side grown from the seed across every crease off the line — pushed
 * inside its flaps (`inside-reverse`) or wrapped round them
 * (`outside-reverse`). The line and the tip side are stored as a fold along
 * a line stores its line and moving side, and the seed is what the tip grows
 * from: every layer on that side, the top layers at a point as the viewer
 * sees them, or flaps. Its openings and its order, when it has a choice of
 * either, are its {@link FoldChoices}.
 */
export interface FoldReverseOp extends FoldAlongLine {
  kind: 'inside-reverse' | 'outside-reverse';
}

export type FoldReverseKind = 'inside' | 'outside';

/** A reverse op's kind, as the engine names it. */
export function reverseKindOf(op: FoldReverseOp): FoldReverseKind {
  return op.kind === 'inside-reverse' ? 'inside' : 'outside';
}

/** A crimp's kind, the same on both its lines (plan Phase 11). */
export type FoldCrimpKind = 'inside' | 'outside';

export const FOLD_CRIMP_KINDS: readonly FoldCrimpKind[] = ['inside', 'outside'];

/**
 * A crimp (plan Phase 11): two reverse folds of one kind as one step, along
 * `line` (ℓ1, nearer the body) and `second` (ℓ2, nearer the tip). The tip
 * grows from the seed on ℓ1's moving side. `second` is named by two sheet
 * points or a crease, since a step stores one root: `line`'s, when that is
 * an axiom. Its choices are the flaps' openings and the completion's.
 */
export interface FoldCrimpOp extends FoldAlongLine {
  kind: 'crimp';
  second: FoldLineInput;
  crimp: FoldCrimpKind;
}

/**
 * A tuck (plan Phase 11): a fold slid immediately under the layer at
 * `target` (a valley, as seen in the parent's view) or over it (a mountain).
 * Its choice is the completion's.
 */
export interface FoldTuckOp extends FoldAlongLine {
  kind: 'tuck';
  direction: FoldDirection;
  target: SheetPoint;
  /** Other stationary layers this tuck must land against; old readers lock this field. */
  additionalTargets?: readonly SheetPoint[];
}

// The vertex folds (plan Phase 11): paper turned about a vertex. Each ends
// at a completion, whose choice is `FoldChoices.completion`.

/**
 * A direction in the parent's model frame, any length: what a step stores
 * for a choice among rays. Replay takes the nearest the engine offers, as it
 * takes the nearest root of an axiom.
 */
export type FoldModelDirection = readonly [number, number];

/**
 * A squash: the flap by a sheet point on its upper layer as the viewer sees
 * it (the top layer for a valley, the bottom one for a mountain), and where
 * its spine lands — a direction from the flap's vertex, absent for its hinge
 * line (the symmetric squash). The engine creases each layer on a line of
 * its own.
 *
 * Its hinge is the one the flap's lower layer folds over, unless `hinge`
 * draws one, located as a fold's line is: then only the flap's end on the
 * flap point's side of it squashes, lifted along it, the spine landing on
 * it. Only a drawn hinge is spelled, so every other squash reads and writes
 * as it always did; a build before it reads `hinge` as a key it does not
 * know and locks the step rather than squash the whole flap.
 */
export interface FoldSquashOp {
  kind: 'squash';
  flap: SheetPoint;
  target?: FoldModelDirection;
  direction: FoldDirection;
  hinge?: FoldLocatedLine;
}

/**
 * A petal fold: the petal by a sheet point on the flap's top layer below H,
 * and H — the line the petal lifts about — named one of two ways, exactly
 * one of them (a step with both, or neither, does not read):
 *
 * - **`crease`** ({@link FoldPetalCreaseOp}): a sheet point inside H's
 *   precrease's sheet segment. H and the kite creases are creases already,
 *   wherever the fold folds them.
 * - **`ends`** ({@link FoldPetalEndsOp}): two sheet points, H's ends on the
 *   flap's folded edges (where the kite creases meet them), on no crease
 *   necessarily. The fold creases H itself, through the top layer alone —
 *   the paper it lifts — and each kite crease not there yet through the top
 *   two layers, and leaves every other layer uncreased.
 *
 * The `crease` form is the one every step stored before `ends` existed, and
 * reads and writes as it always did; a build before `ends` locks a step that
 * uses it (an op key it does not know) rather than folding it.
 * {@link petalHinge} reads either form as one shape, {@link petalOp} writes it.
 */
export type FoldPetalOp = FoldPetalCreaseOp | FoldPetalEndsOp;

interface FoldPetalFields {
  kind: 'petal';
  petal: SheetPoint;
  direction: FoldDirection;
}

/** A petal fold over its precreases: H by a sheet point inside its precrease's sheet segment. */
export interface FoldPetalCreaseOp extends FoldPetalFields {
  crease: SheetPoint;
}

/** A petal fold that creases its own H: H through its two ends, as sheet points. */
export interface FoldPetalEndsOp extends FoldPetalFields {
  ends: readonly [SheetPoint, SheetPoint];
}

/** A petal fold's H as one shape: an existing crease at a sheet point, or the line through two sheet points. */
export type FoldPetalHinge =
  | { kind: 'crease'; at: SheetPoint }
  | { kind: 'points'; from: SheetPoint; to: SheetPoint };

export type FoldPetalHingeKind = FoldPetalHinge['kind'];

/** H as the op names it. */
export function petalHinge(op: FoldPetalOp): FoldPetalHinge {
  return 'ends' in op ? { kind: 'points', from: op.ends[0], to: op.ends[1] } : { kind: 'crease', at: op.crease };
}

/** The petal op that names H as `hinge` does. */
export function petalOp(hinge: FoldPetalHinge, petal: SheetPoint, direction: FoldDirection): FoldPetalOp {
  return hinge.kind === 'crease'
    ? { kind: 'petal', crease: hinge.at, petal, direction }
    : { kind: 'petal', ends: [hinge.from, hinge.to], petal, direction };
}

/**
 * A rabbit ear: the triangle's corners as sheet points; the emergent ray, a
 * direction from the incenter; the layers at the incenter; and a sheet point
 * on paper that stays. Its three creases to the corners fold as `direction`
 * says and its fourth the other way, as the ridge the ear rises along.
 */
export interface FoldRabbitEarOp {
  kind: 'rabbit-ear';
  corners: readonly [SheetPoint, SheetPoint, SheetPoint];
  emergent: FoldModelDirection;
  seed: FoldSeed;
  stayer: SheetPoint;
  direction: FoldDirection;
  /**
   * An older step's choice of which far ray rose as the ridge, before the
   * fourth crease always did. Read and written back as it came, so the
   * step's path (`fh1`) holds, but never read by the engine (an unknown
   * field there) and never written by the tools: a step that named a
   * corner's crease now lands the rabbit ear, and replays as changed.
   */
  ridge?: FoldModelDirection;
}

/**
 * A swivel at a free vertex: the vertex and the points its three given rays
 * run toward as sheet points, the emergent ray, the layers at the vertex and
 * a sheet point on paper that stays. The swivel's rays form; its edge form
 * is {@link FoldSwivelEdgeOp}, which alone has `via` ({@link isSwivelEdgeOp}).
 */
export interface FoldSwivelOp {
  kind: 'swivel';
  vertex: SheetPoint;
  toward: readonly [SheetPoint, SheetPoint, SheetPoint];
  emergent: FoldModelDirection;
  seed: FoldSeed;
  stayer: SheetPoint;
  direction: FoldDirection;
}

/** A swivel's target: an existing crease or edge by a sheet point on it, or the line through two sheet points. */
export type FoldSwivelTarget = Exclude<FoldLineInput, { via: 'axiom' }>;

/**
 * A swivel as folders diagram it: swivel the edge through the sheet point
 * `edge` (a raw edge or a folded edge) onto `target` (engine
 * `compound::swivel`). The creases are computed. They meet at a free vertex
 * ({@link FoldSwivelFreeOp}) or on a folded edge ({@link FoldSwivelOnFoldOp}).
 * An older build reads `via` as a key it does not know and locks the step
 * rather than fold it.
 */
export type FoldSwivelEdgeOp = FoldSwivelFreeOp | FoldSwivelOnFoldOp;

/**
 * A swivel by its edge pivoting at `pivot`: its creases meet where the pivot
 * lands moved onto the nearer bisector of the edge and the target, through
 * the layers `seed` names. The ridge — the crease that folds the other way —
 * is the one square to the edge unless `ridge` names the turning wedge's
 * other ray (a direction in the parent's model frame; replay takes the
 * nearer), stored only when the folder took it.
 */
export interface FoldSwivelFreeOp {
  kind: 'swivel';
  via: 'edge';
  pivot: SheetPoint;
  edge: SheetPoint;
  target: FoldSwivelTarget;
  seed: FoldSeed;
  direction: FoldDirection;
  ridge?: FoldModelDirection;
}

/**
 * The classic swivel, its creases meeting on a folded edge (engine
 * `compound::swivel_on_edge`): the folded crease through the sheet point
 * `fold`, where the bisector of the edge and the target nearer it crosses
 * that crease. Its layers are the two the folded edge joins, and it has no
 * ridge to choose, so it stores no `seed` and no `ridge`. An older build,
 * whose edge form always had a `pivot`, reads `fold` as a key it does not
 * know and locks the step rather than fold it.
 *
 * It is the open swivel, the other layer's strip folded up on top, unless
 * `swivel` says `'inside'`: the inside (closed) swivel, the strip tucked
 * between the two layers. Only the inside one spells it, so every open
 * swivel reads and writes as it always did; a build before the inside
 * swivel reads `swivel` as a key it does not know and locks the step rather
 * than fold it open.
 */
export interface FoldSwivelOnFoldOp {
  kind: 'swivel';
  via: 'edge';
  fold: SheetPoint;
  edge: SheetPoint;
  target: FoldSwivelTarget;
  direction: FoldDirection;
  swivel?: 'inside';
}

/** A line as a step stores it to locate it again: how it was located, and an axiom's root taken. */
export interface FoldLocatedLine {
  line: FoldLineInput;
  root?: FoldModelLine;
}

/**
 * A swivel on a folded edge as folders diagram it (engine
 * `compound::swivel_valley_mountain`): on the layer that faces the viewer,
 * the valley and the mountain bounding the flap, meeting at a point on the
 * folded edge, each located as a fold's line is. The crease on the layer
 * behind is computed. Its letters are the viewer's, so it has no direction:
 * a swivel whose pair lies behind is made by turning the model over first.
 * Open, its strip folding up across the valley, unless `swivel` says
 * `'inside'`: the strip tucks under across the mountain.
 */
export interface FoldSwivelValleyMountainOp {
  kind: 'swivel';
  via: 'valley-mountain';
  valley: FoldLocatedLine;
  mountain: FoldLocatedLine;
  swivel?: 'inside';
}

/** Where a swivel on a folded edge puts the other layer's strip: on top, or tucked between the two layers. */
export type FoldSwivelKind = 'open' | 'inside';

/** The kinds in the order the engine's answer lists them (`kinds`). */
export const FOLD_SWIVEL_KINDS: readonly FoldSwivelKind[] = ['open', 'inside'];

/** A swivel op's kind: inside only on a folded edge that says so. */
export function swivelKindOf(op: FoldSwivelOp | FoldSwivelEdgeOp | FoldSwivelValleyMountainOp): FoldSwivelKind {
  return 'swivel' in op && op.swivel === 'inside' ? 'inside' : 'open';
}

/** A swivel on a folded edge of the kind given: `swivel` spelled only when inside. */
export function withSwivelKind<T extends FoldSwivelOnFoldOp | FoldSwivelValleyMountainOp>(op: T, kind: FoldSwivelKind): T {
  const { swivel: _spelled, ...open } = op;
  return (kind === 'inside' ? { ...open, swivel: 'inside' } : open) as T;
}

/** Whether a swivel op names its swivel by its edge, not its rays. */
export function isSwivelEdgeOp(op: FoldOp): op is FoldSwivelEdgeOp {
  return op.kind === 'swivel' && 'via' in op && op.via === 'edge';
}

/** Whether a swivel op is the one whose creases meet on a folded edge. */
export function isSwivelOnFoldOp(op: FoldOp): op is FoldSwivelOnFoldOp {
  return isSwivelEdgeOp(op) && 'fold' in op;
}

/** Whether a swivel op names its swivel by its valley and mountain. */
export function isSwivelValleyMountainOp(op: FoldOp): op is FoldSwivelValleyMountainOp {
  return op.kind === 'swivel' && 'via' in op && op.via === 'valley-mountain';
}

/** Whether a swivel op's creases meet on a folded edge: by its edge there, or by its valley and mountain. */
export function isFoldedSwivelOp(op: FoldOp): op is FoldSwivelOnFoldOp | FoldSwivelValleyMountainOp {
  return isSwivelOnFoldOp(op) || isSwivelValleyMountainOp(op);
}

export type FoldVertexOp =
  | FoldSquashOp
  | FoldPetalOp
  | FoldRabbitEarOp
  | FoldSwivelOp
  | FoldSwivelEdgeOp
  | FoldSwivelValleyMountainOp;

/**
 * The way a vertex op folds, as the viewer sees it: its own direction, or for
 * a swivel by its valley and mountain, whose letters are the viewer's, toward
 * the viewer.
 */
export function vertexDirectionOf(op: FoldVertexOp): FoldDirection {
  return 'direction' in op ? op.direction : 'valley';
}

export type FoldVertexOpKind = FoldVertexOp['kind'];

export const FOLD_VERTEX_OP_KINDS: readonly FoldVertexOpKind[] = ['squash', 'petal', 'rabbit-ear', 'swivel'];

export function isVertexOp(op: FoldOp): op is FoldVertexOp {
  return (FOLD_VERTEX_OP_KINDS as readonly string[]).includes(op.kind);
}

/**
 * A sink of a closed point (plan Phase 11, research §5.4) along `line`: the
 * point the seed names, its tip on the moving side. An open sink turns every
 * layer inside out against its own; a closed sink reverses the whole point
 * into a pocket (`choices.pocket` when it has several). An unsink turns a
 * sunk tip back out: its line is the ring's (an existing crease of it), and
 * its seed and `moving` name the tip and the side it lies on now.
 */
export interface FoldSinkOp extends FoldAlongLine {
  kind: 'open-sink' | 'closed-sink' | 'unsink';
}

// ---------------------------------------------------------------------------

/** What a step does. A kind this build does not know locks its node and subtree. */
/** A recorded ancestor pose, restored with every physical crease retained. */
export interface FoldReturnOp {
  kind: 'unfold-to';
  target: string | null;
  source: { path: string; state: string; targetState: string };
}

/** A frozen sequential recipe. Internal steps are not numbered diagram nodes. */
export interface FoldRepeatOp {
  kind: 'repeat';
  source: { first: string; last: string; revision: string };
  parentState: string;
  /** Original-sheet reflection; independent of the current viewport. */
  axis: FoldModelLine;
  /**
   * `'behind'` when the axis reverses the layers, so the steps were folded on
   * the back (`fold/repeat`): the words say "Repeat behind". Only behind is
   * spelled, so a repeat on the other side reads and writes as it always
   * did. Words only — the steps are stored mirrored already, and replay never
   * reads it.
   */
  side?: 'behind';
  steps: readonly FoldRepeatEntry[];
}

export interface FoldRepeatEntry {
  op: FoldOp;
  choices?: FoldChoices;
  expect: string;
  sourceStep: string;
  /** Only for unfold-to: 0 is the repeat's parent; n is after internal operation n. */
  returnTo?: number;
}

/**
 * How many steps the engine counts a stored operation as (`FoldStateSummary.step`,
 * what a crease's `made_at` counts in): a Repeat each operation it lands, any
 * other one. So a step's own creases are those made after `step − foldOpSteps(op)`.
 */
export function foldOpSteps(op: Pick<FoldOp, 'kind'> | FoldRepeatOp): number {
  return op.kind === 'repeat' && 'steps' in op ? Math.max(op.steps.length, 1) : 1;
}

/** Two lines in the starting pose: mountain, then valley. */
export interface FoldPleatPlacement {
  landing: FoldLanding;
  completion?: FoldCompletionChoice;
}
export interface FoldPleatOp {
  kind: 'pleat';
  line: FoldLineInput;
  second: FoldLineInput;
  /** The valley construction's chosen root in the starting model frame. */
  secondRoot?: FoldModelLine;
  seed: FoldSeed;
  moving?: SheetPoint;
  /** Native placement choices for the first fold and the transported return fold. */
  resolved?: readonly [FoldPleatPlacement, FoldPleatPlacement];
}

export type FoldOp =
  | FoldPleatOp
  | FoldRepeatOp
  | FoldReturnOp
  | FoldPlainOp
  | FoldPrecreaseOp
  | FoldCreaseOp
  | FoldTurnOp
  | FoldRotateOp
  | FoldCpJumpOp
  | FoldReverseOp
  | FoldCrimpOp
  | FoldTuckOp
  | FoldVertexOp
  | FoldSinkOp;

export type FoldOpKind = FoldOp['kind'];

export const FOLD_OP_KINDS: readonly FoldOpKind[] = [
  'repeat',
  'pleat',
  'valley',
  'mountain',
  'precrease',
  'unfold',
  'unfold-to',
  'refold',
  'turn',
  'rotate',
  'cp-jump',
  'inside-reverse',
  'outside-reverse',
  'crimp',
  'tuck',
  ...FOLD_VERTEX_OP_KINDS,
  'open-sink',
  'closed-sink',
  'unsink',
];

/** The turn a turn or rotate step makes, as the Diagram's turn entries spell it (`lib/steps/turn`). */
export function turnKindOf(op: FoldTurnOp | FoldRotateOp): TurnKind {
  return op.kind === 'turn' ? { kind: 'turn-over', axis: op.axis } : { kind: 'rotate', rotate: op.rotate };
}

// ---------------------------------------------------------------------------
// Choices

/**
 * A pair of faces ordered by a completion: FOLD's `faceOrders` triple over
 * the completion's witnesses, `[f, g, s]` with `s = 1` when face `f` lies on
 * the side face `g`'s front faces and `-1` when it lies on its back.
 */
export type FoldFaceOrder = readonly [number, number, 1 | -1];

/**
 * The pairs a completion left free, as they were chosen: the engine's
 * `WitnessOrder`, as Import CP's `orderJson` stores a whole order — one
 * interior sheet point per face named and the pairs over them. Stored as
 * FOLD triples rather than "above" because which side of a face another lies
 * on does not depend on which face is the root, so a replay that reaches the
 * model frame another way reads them the same.
 */
export interface FoldCompletionChoice {
  faces: readonly SheetPoint[];
  orders: readonly FoldFaceOrder[];
}

/** One flap's opening of a reverse fold, crimp or tuck: the faces of its upper block, by witnesses. */
export interface FoldOpeningChoice {
  upper: readonly SheetPoint[];
}

/**
 * The choices a step resolved, stored as results, never as indices or
 * digests (plan D6). Faces are named by interior sheet-point witnesses; a
 * witness that lands in no face, or two in one face, breaks the step.
 */
export interface FoldChoices {
  /** The line the axiom's chosen root gave; replay takes the nearest root to it. */
  root?: FoldModelLine;
  /**
   * The assignments of the pair variables seeds and propagation left free.
   * Replay fixes them and completes: exactly one result resolves; a conflict
   * or more than one breaks the step. An empty order is no choice.
   */
  completion?: FoldCompletionChoice;
  /** A sink's pocket: sheet points on the two faces that bound it. */
  pocket?: readonly [SheetPoint, SheetPoint];
  /** A reverse fold's or crimp's opening, per flap that opens more than one way. */
  opening?: readonly FoldOpeningChoice[];
}

// ---------------------------------------------------------------------------
// Marks

/**
 * The most parts a Divide-line mark divides into: as many as the Diagram's
 * `divisions` annotation, which it maps onto (plan D17).
 */
export const FOLD_MARK_MAX_PARTS = 32;

/**
 * How a Divide-line mark divides its segment: into `parts` equal parts, or at
 * Edit's exact ratio `s : t`, `s` the part next to `from`.
 */
export type FoldDivide =
  | { mode: 'count'; parts: number }
  | { mode: 'ratio'; ratio: OristudioCpRatioExpression };

/**
 * A Divide-line mark (plan D6): a reference annotation, made on a node — or
 * on the flat sheet — and visible to that node and its descendants. It
 * divides the segment `from`–`to`, the end points of an edge or crease of the
 * layer it was made on (the top visible layer at the pick), in sheet
 * coordinates. Never part of a state: excluded from `fh1` and `fs1`.
 */
export interface FoldMark {
  id: string;
  from: SheetPoint;
  to: SheetPoint;
  divide: FoldDivide;
}

/** A newer build's mark: carried verbatim and written back unchanged, never shown. */
export interface FoldCarriedMark {
  id: string;
  unknown: Record<string, unknown>;
}

export type FoldMarkEntry = FoldMark | FoldCarriedMark;

export function isKnownMark(mark: FoldMarkEntry): mark is FoldMark {
  return !('unknown' in mark);
}

/** The points a mark makes, from `from`: `parts − 1` of them, or the one at the ratio. */
export function markPoints(mark: FoldMark): SheetPoint[] {
  const at = (share: number): SheetPoint => [
    mark.from[0] + (mark.to[0] - mark.from[0]) * share,
    mark.from[1] + (mark.to[1] - mark.from[1]) * share,
  ];
  if (mark.divide.mode === 'count') {
    const { parts } = mark.divide;
    return Array.from({ length: parts - 1 }, (_, k) => at((k + 1) / parts));
  }
  const { ratioS, ratioT } = evaluateOrieditaRatioExpression(mark.divide.ratio);
  return [at(ratioS / (ratioS + ratioT))];
}

// ---------------------------------------------------------------------------
// Spread

/**
 * A step's own layer spread (`foldedLayerSpread.ts`): how its folded picture
 * spreads its layers apart, or `'off'` for not at all. Display data, as a
 * note is: it never changes what the step folds, and is outside `fh1` and
 * `fs1`. A step with none takes the nearest earlier step's on its path, else
 * the default (`foldStepSpread`), so spreading defaults to off.
 */
export type FoldSpreadSetting = LayerSpreadOptions | 'off';

/** A newer build's spread: carried verbatim and written back unchanged, never shown — the step takes an earlier one's. */
export interface FoldCarriedSpread {
  unknown: unknown;
}

export type FoldStepSpreadEntry = FoldSpreadSetting | FoldCarriedSpread;

/** Whether a step's spread entry is one this build reads, rather than a newer build's carried. */
export function isKnownSpread(entry: FoldStepSpreadEntry): entry is FoldSpreadSetting {
  return entry === 'off' || !('unknown' in entry);
}

// ---------------------------------------------------------------------------
// Steps and the sequence

/**
 * A step this build reads. `expect` holds the `fs1:` fingerprint of the state
 * it landed at commit (`foldDigest`), for drift only: a mismatch on replay is
 * *changed*, not broken.
 */
export interface FoldStep {
  id: string;
  /** The step it folds from; null for the flat sheet. */
  parent: string | null;
  op: FoldOp;
  choices?: FoldChoices;
  expect?: string;
  /** The author's words. The sentence itself is generated. */
  note?: string;
  marks?: readonly FoldMarkEntry[];
  /** Its own layer spread; absent, it takes an earlier step's ({@link FoldSpreadSetting}). */
  spread?: FoldStepSpreadEntry;
  unknown?: undefined;
}

/**
 * A step this build cannot read — an op of a kind it does not know, or one
 * that does not read — kept verbatim and written back unchanged. It locks
 * itself and its subtree: it can be deleted, never edited, and nothing below
 * it replays.
 */
export interface FoldLockedStep {
  id: string;
  parent: string | null;
  /** The node as it came. */
  unknown: Record<string, unknown>;
  /** Its note, when one reads: kept, never edited. */
  note?: string;
  op?: undefined;
}

export type FoldStepNode = FoldStep | FoldLockedStep;

export function isLockedStep(node: FoldStepNode): node is FoldLockedStep {
  return node.unknown !== undefined;
}

export interface FoldSequenceDocument {
  formatVersion: 1 | typeof FOLD_SEQUENCE_FORMAT_VERSION;
  /** `fold-<uuid>`. */
  id: string;
  title: string;
  paper: FoldPaper;
  /**
   * The paper style the sequence is drawn in, picked in the Paper tab: a
   * document's own style, as a diagram's is (`lib/paper/documentPaperStyle`)
   * — a built-in with its values, or a Settings style resolved when chosen.
   * Every sequence this build reads or makes has one ({@link FOLD_DEFAULT_PAPER_STYLE}
   * for a file written before there was one), and every file it writes holds it.
   * Optional only for documents built by hand, which draw in the default.
   */
  style?: ResolvedDocumentPaperStyle;
  /**
   * Reserved for per-sequence `PaperStyleOverrides` (plan D7, D11): never
   * written by this build, carried verbatim when a file holds one.
   */
  appearance?: Readonly<Record<string, unknown>>;
  /** Marks made on the flat sheet, visible to every step. */
  sheetMarks?: readonly FoldMarkEntry[];
  /** Flat and parent-linked; siblings in the order they were made. */
  steps: readonly FoldStepNode[];
  /** Sequence-level keys a newer build wrote, carried verbatim and written back after this build's own (plan D7). */
  carried?: Readonly<Record<string, unknown>>;
}

/**
 * What a sequence is drawn in until its Paper tab picks another: the built-in
 * Diagram style (a step of a sequence reads as a step of a diagram), as a new
 * diagram is.
 */
export const FOLD_DEFAULT_PAPER_STYLE: ResolvedDocumentPaperStyle = DEFAULT_DOCUMENT_PAPER_STYLE;

/** A new, empty sequence. */
export function createFoldSequence(
  paper: FoldPaper = SQUARE_PAPER,
  title = '',
  newId: FoldIdFactory = randomFoldId
): FoldSequenceDocument {
  return {
    formatVersion: FOLD_SEQUENCE_FORMAT_VERSION,
    id: newId('fold'),
    title,
    paper,
    style: FOLD_DEFAULT_PAPER_STYLE,
    steps: [],
  };
}
