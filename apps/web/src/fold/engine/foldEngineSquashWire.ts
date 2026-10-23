/**
 * What crosses the Fold bridge for the vertex folds — squash, petal fold,
 * rabbit ear and swivel (plan Phase 11) — as TypeScript sees it. Mirrors
 * `crates/oristudio-fold-wasm/src/ops_squash_family.rs` and the engine's
 * `compound::vertex`; the Rust side is the truth.
 *
 * - **Ops** are the document's (`FoldSquashOp`, `FoldPetalOp` — its H by a
 *   precrease's `crease` point, or by its two `ends`, which the fold creases
 *   itself — `FoldRabbitEarOp`, `FoldSwivelOp` and its edge form
 *   `FoldSwivelEdgeOp`, answered as `kind: 'swivel-by-edge'`), and a stored
 *   one replays through the ordinary `step` call: it lands with its
 *   `compound` report (`family: 'vertex'`), or is refused — the engine's
 *   codes, or the compound
 *   folds' `choice_needed` and `choice_broken` when its stored choice no
 *   longer decides the order.
 * - **The tools** ask the compound question (`compoundAnalysis`,
 *   `family: 'vertex'`), as the reverse fold's tools do: what the op names,
 *   which of a fan's fourth rays land, and the orders it leaves (each the
 *   `FoldChoices.completion` that picks it); then preview and commit the
 *   step with its choices through `step`. A rabbit ear's fourth crease rises
 *   as its ridge, so there is no ridge to choose. The family's own calls besides
 *   (`vertexFold`): one order lands; more are held under a `pending` handle
 *   until a pick lands one, whose `compound.stored` is the
 *   `FoldChoices.completion` the step stores.
 * - **The motion** (plan D15) is visual, in stages: each moving block turns
 *   about one of its creases per stage, or rests (`FoldStepMotionLegs`, every
 *   compound step's, read through `stepMotionLegsOf`).
 *
 * Pure types and constants: no React, no store, no wasm.
 */

import type { FoldCompletionChoice, FoldDirection, FoldModelLine } from '../document/foldSequenceDocument';
import type { FoldCompoundFingerprinted, FoldCompoundLanded, FoldCompoundReportBase } from './foldEngineCompoundWire';
import type { FoldLetter, FoldModelPoint } from './foldEngineWire';

/** Which vertex fold a report is (`VertexFoldKind`). */
export type FoldVertexFoldKind = 'squash' | 'petal' | 'rabbit_ear' | 'swivel';

/** What a vertex fold did (`VertexReport`), as a compound step reports it under `family: 'vertex'`. */
export interface FoldVertexReport extends FoldCompoundReportBase {
  kind: FoldVertexFoldKind;
  /** Where its creases meet, in the parent's model frame. */
  vertices: FoldModelPoint[];
  /** The lines its blocks turn about, in the parent's model frame. */
  creases: FoldModelLine[];
  /** In the model frame. */
  direction: FoldDirection;
  /** What the step stores: the order chosen among several, when there were several. */
  stored: { completion?: FoldCompletionChoice };
}

/** A landed vertex fold, as `step` and the tools' calls return it. */
export type FoldVertexLanded = FoldCompoundLanded<'vertex'>;

export type FoldVertexFingerprinted = FoldCompoundFingerprinted<'vertex'>;

/** How many complete orders a completion offers (`ChoiceCount`). */
export interface FoldChoiceCount {
  orders: number;
  /** Whether that is every order; otherwise a lower bound. */
  exact: boolean;
}

/** What `vertexFold` came to: one order, landed; or a choice held under `pending`. */
export type FoldVertexTried =
  | ({ result: 'landed' } & FoldVertexFingerprinted)
  | {
      result: 'choose';
      pending: number;
      count: FoldChoiceCount;
      /** How many orders each independent component lists: a pick names one of each. */
      components: number[];
    };

// ---------------------------------------------------------------------------
// Analyses: what a tool previews before a vertex fold lands

/** A squash's flap and creases (`SquashAnalysis`). */
export interface FoldSquashAnalysis {
  vertex: FoldModelPoint;
  hinge: FoldModelLine;
  spine: FoldModelLine;
  /** Unit directions from the vertex: a target is a direction between them. */
  hinge_direction: FoldModelPoint;
  spine_direction: FoldModelPoint;
  /** The flap's layers: the parent's faces. */
  upper: number[];
  lower: number[];
  /** Each layer's own crease, through the vertex. */
  upper_crease: FoldModelLine;
  lower_crease: FoldModelLine;
  /** The wedge from the hinge to the spine, radians, and the target's share of it. */
  wedge: number;
  share: number;
}

/**
 * A petal fold's ends, corner, kite creases and layers (`PetalAnalysis`),
 * whichever way its op names H (`FoldPetalOp`'s `crease` or `ends`).
 */
export interface FoldPetalAnalysis {
  /** H, in the parent's model frame. */
  line: FoldModelLine;
  /** H's ends on the flap's folded edges, and the corner the kite creases meet at. */
  ends: [FoldModelPoint, FoldModelPoint];
  corner: FoldModelPoint;
  /** The kite creases from each end: precreased, or — H named by its ends — the bisector of H and the folded edge there. */
  kites: [FoldModelLine, FoldModelLine];
  /** The parent's faces of the top and second layers: below H, or across it where H is not creased. */
  top: number[];
  second: number[];
  /**
   * What the fold creases itself (H named by its ends): H where it crosses
   * the top layer, and each kite crease (in `kites`' order) where it crosses
   * the top two layers. All false over precreases, and always for H named by
   * a crease. The bridge always sends both; they are optional only so an
   * analysis written before them still types.
   */
  scores_line?: boolean;
  scores_kites?: [boolean, boolean];
}

/** A rabbit ear's or a swivel's rays and layers (`FanAnalysis`). */
export interface FoldFanAnalysis {
  center: FoldModelPoint;
  /** The three given rays' directions. */
  given: FoldModelPoint[];
  /** Every direction the fourth ray can take (three at most): what a tool offers. */
  candidates: FoldModelPoint[];
  /** The candidate the op's emergent ray names. */
  emergent: number | null;
  /** The layers the creases cut, the first nearest the side the direction names. */
  layers: number[];
}

/**
 * Which of a swivel by its edge's four creases (`SwivelRay`): toward where
 * the edge meets the target, square to the edge, toward its far end, and
 * Kawasaki's. On a folded edge: `meet` the swivel crease (one in each of the
 * two layers), `hinge` the other layer's second crease.
 */
export type FoldSwivelRay = 'meet' | 'foot' | 'end' | 'hinge';

/**
 * A wedge a swivel by its edge moves (`SwivelWedge`): across meet, turned
 * about the vertex, across the hinge. The wedge from hinge to meet stays. On
 * a folded edge: the edge's layer folding across the swivel crease, the
 * other layer's paper on the half of the folded edge that opens, and its
 * strip folding across its second crease.
 */
export type FoldSwivelWedge = 'near' | 'turn' | 'beyond';

/** One crease of a swivel by its edge, as a tool previews it in the diagram pens (`SwivelCrease`). */
export interface FoldSwivelCrease {
  ray: FoldSwivelRay;
  /** A unit direction from the vertex, in the parent's model frame. */
  direction: FoldModelPoint;
  /**
   * Where the pen starts, in the parent's model frame: the vertex, or on a
   * folded edge, for the swivel crease of the layer the viewer sees under
   * the other, where the other's ends (`to` when it is hidden all along).
   */
  from: FoldModelPoint;
  /** Where it leaves the last layer it cuts, in the parent's model frame: the pen runs from `from` to here. */
  to: FoldModelPoint;
  /** As the viewer sees it: the op's direction's letter, the ridge the other. */
  letter: FoldLetter;
  /** Whether it is the ridge, the odd letter out. */
  ridge: boolean;
  /**
   * This stretch lies behind paper the viewer sees, drawn dotted as a
   * diagram draws it: a swivel by its valley and mountain's crease on the
   * layer behind. Absent when it is seen.
   */
  hidden?: true;
}

/** A piece of paper a swivel by its edge moves, in the parent's model frame (`SwivelRegion`). */
export interface FoldSwivelRegion {
  wedge: FoldSwivelWedge;
  /** Counter-clockwise. */
  polygon: FoldModelPoint[];
}

/**
 * A swivel by its edge before it folds (`SwivelEdgeAnalysis`), for the edge
 * form of the swivel op (`FoldSwivelEdgeOp`): where its creases meet, the
 * creases with their letters, where the edge lands, the ridges it can take
 * and the paper that moves.
 */
export interface FoldSwivelEdgeAnalysis {
  /** The pivot as given, and the vertex: the pivot moved onto the nearer bisector of edge and target. */
  pivot: FoldModelPoint;
  vertex: FoldModelPoint;
  /** Where the edge's line meets the target. */
  meet: FoldModelPoint;
  /** The edge's straight run, its end nearer `meet` first, and the parent's faces it bounds. */
  edge: [FoldModelPoint, FoldModelPoint];
  edge_faces: number[];
  /** The vertex's foot on the edge's line. */
  foot: FoldModelPoint;
  target: FoldModelLine;
  /** How far the turning wedge turns about the vertex: radians, counter-clockwise, in (−π, π]. */
  rotation: number;
  /** Where the edge's moving part lies once folded, on the target: its near part folded across meet, then its turned part (one segment when it starts past the foot). */
  landed: [FoldModelPoint, FoldModelPoint][];
  /** Meet, foot, end, hinge. */
  creases: FoldSwivelCrease[];
  /** The rays the ridge can be, foot's then end's: the op's `ridge` names one; `emergents` says which land. */
  ridges: FoldModelPoint[];
  ridge: number;
  /** The layers the creases cut, the first nearest the side the direction names. */
  layers: number[];
  /** The paper that moves; empty when the fan cannot cut the layers (folding it says why). */
  regions: FoldSwivelRegion[];
  /** On a folded edge (the op's `fold`): that edge and the half of it that opens. Absent for a free vertex. */
  fold?: FoldSwivelFold;
}

/** The folded edge a swivel's creases meet on (`SwivelFold`), in the parent's model frame. */
export interface FoldSwivelFold {
  /** Its straight run. */
  edge: [FoldModelPoint, FoldModelPoint];
  /** The half that opens, from the vertex toward the edge that moves. */
  opens: [FoldModelPoint, FoldModelPoint];
  /** The two faces it joins at the vertex, ascending. */
  faces: number[];
}

/**
 * A swivel by its valley and mountain before it folds
 * (`SwivelValleyMountainAnalysis`): where its creases meet, the crease on
 * the layer behind (split where the layer in front hides it, `hidden`), then
 * the front layer's two, each by its letter as seen; the two layers, the one
 * in front first; the paper that moves; the folded edge.
 */
export interface FoldSwivelValleyMountainAnalysis {
  vertex: FoldModelPoint;
  creases: FoldSwivelCrease[];
  layers: number[];
  regions: FoldSwivelRegion[];
  fold: FoldSwivelFold;
}

export type FoldVertexAnalysis =
  | ({ kind: 'squash' } & FoldSquashAnalysis)
  | ({ kind: 'petal' } & FoldPetalAnalysis)
  | ({ kind: 'rabbit-ear' } & FoldFanAnalysis)
  | ({ kind: 'swivel' } & FoldFanAnalysis)
  | ({ kind: 'swivel-by-edge' } & FoldSwivelEdgeAnalysis)
  | ({ kind: 'swivel-valley-mountain' } & FoldSwivelValleyMountainAnalysis);

/** The orders a vertex fold leaves to choose from (`VertexOrders`), as a reverse fold's question lists its own. */
export interface FoldVertexOrders {
  /** The true ‹ n of m ›. */
  count: FoldChoiceCount;
  /** The first eight, each the `completion` that picks it. */
  orders: FoldCompletionChoice[];
  /** More are listed than `orders` holds. */
  more: boolean;
}

/**
 * The compound question's answer for a vertex op (`VertexAnalysed`): what it
 * names, and what a tool chooses among — which fourth rays land, and the
 * orders it leaves, its stored completion aside.
 */
export interface FoldVertexAnalysed {
  analysis: FoldVertexAnalysis;
  /**
   * A rabbit ear's or a swivel's: per emergent candidate, whether the fold
   * lands with it, its other inputs as asked; a swivel by its edge's, per
   * ridge (`analysis.ridges`). Empty for the other folds.
   */
  emergents: boolean[];
  /**
   * A swivel on a folded edge's: valley, then mountain, as the viewer sees
   * them, each whether the fold lands that way, of the kind asked. Absent
   * for the other folds.
   */
  directions?: boolean[];
  /**
   * A swivel on a folded edge's: per kind, open then inside
   * (`FOLD_SWIVEL_KINDS`), its directions as `directions` lists them, each
   * whether the fold lands that way — its choices besides the order. Absent
   * for the other folds.
   */
  kinds?: [boolean, boolean][];
  /** Null when it lands with one order, or is refused (the preview says why). */
  orders: FoldVertexOrders | null;
}

// ---------------------------------------------------------------------------
// Refusals the tools read the fields of (`FoldRefusal`'s vertex block)

/** Why there is no flap to squash at a point (`NoFlap`). */
export type FoldNoFlap = 'single_layer' | 'no_spine' | 'no_hinge' | 'upper_not_hinged' | 'hinge_off_spine';

/**
 * Which crease of a petal fold is not precreased (`PetalCrease`). H named by
 * its ends creases what is missing, except H across the second layer's paper
 * outside a kite crease (`line`).
 */
export type FoldPetalCrease = 'line' | 'kite';

/** Why a petal fold has no flap (`NoPetal`). */
export type FoldNoPetal = 'no_ends' | 'no_corner';

/**
 * What a `petal_no_flap` cause names more precisely, where it does
 * (`NoPetalDetail`), as the refusal's optional `detail`:
 *
 * - `misses_flap` (with `no_ends`): H misses the flap altogether; its top
 *   layer, the refusal's `faces`, lies wholly on the petal's side of it.
 * - `past_corner` (with `no_corner`): the kite creases meet below H at
 *   `corner` (model frame), but the flap reaches past it; `faces` are the
 *   paper beyond. H lies too near the flap's closed point.
 */
export type FoldNoPetalDetail = { kind: 'misses_flap' } | { kind: 'past_corner'; corner: FoldModelPoint };

/**
 * A swivel's own refusals, in `FoldRefusal::code`'s order. By its edge, each
 * names the edge's faces (but `swivel_not_an_edge`, which names its
 * `point`): no raw or folded edge at the sheet point, a target parallel to
 * the edge, a vertex on the edge's line, an edge that ends before its foot
 * (with a `use_line` fix along the bisector), and an edge whose paper the
 * cut layers leave out. On a folded edge (`compound::swivel_on_edge`): no
 * folded crease at the sheet point (naming its `point`), a bisector that
 * crosses the folded edge nowhere, and a swivel crease meeting it at a right
 * angle or wider, each naming the two faces it joins. An inside swivel at a
 * free vertex, which has no two layers to tuck its strip between, naming
 * the edge's faces. By its valley and mountain
 * (`compound::swivel_valley_mountain`): lines that meet on no folded edge
 * the viewer sees (`swivel_line_meeting`, naming nothing), and lines that
 * bound no flap, one along the folded edge or both along one line
 * (`swivel_no_flap`, naming the two faces it joins). The fan's own follow
 * (`fan_*`, `no_order`), and a `use_emergent` fix names the other ridge, to
 * store as the op's `ridge`.
 */
export const FOLD_SWIVEL_REFUSAL_CODES = [
  'swivel_not_an_edge',
  'swivel_target_parallel',
  'swivel_pivot_on_edge',
  'swivel_edge_short',
  'swivel_edge_stays',
  'swivel_not_a_fold',
  'swivel_line_meeting',
  'swivel_no_flap',
  'swivel_misses_fold',
  'swivel_fold_wide',
  'swivel_inside_free',
] as const;
