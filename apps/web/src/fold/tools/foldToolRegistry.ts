/**
 * Which input each Fold tool takes from the canvas (plan D13): the single
 * source of truth for how many clicks a line mode collects, what each click
 * snaps to, and which of the axiom's input slots it fills.
 *
 * Edit's `inputModelRegistry` is keyed to kernel operations and stays Edit's;
 * this is Fold's own table in the same vocabulary — every click is one step
 * of a `createStepSequenceTool` sequence, snapped per step by a
 * {@link CpStepSnap} — so the surface-agnostic reducers count the clicks and
 * this says what each one is.
 *
 * - `point`: a point landmark (a corner, a crease crossing, a mark, an edge's
 *   midpoint), or, with Alt held or latched, any point of the paper;
 * - `crease-required`: an edge, a fold or a precrease — the click is ignored
 *   off one, as Edit's "select a destination line" steps ignore it;
 * - `free`, the one snap Fold adds: the point clicked, as it is.
 *
 * Click order is the instructions' (`lineModeSteps`), which reads naturally;
 * each step names the slot of the axiom's own input order it fills
 * (`AXIOM_SLOTS`, the shared crate's order), so the order a step stores never
 * depends on the order it was clicked in (plan D6).
 *
 * React-free and store-free.
 */
import type { CpStepSnap } from '../../cp-workspace/tools/inputModelRegistry';
import { createStepSequenceTool, type SequenceState } from '../../cp-workspace/tools/stepSequenceTool';
import type { ToolEngine } from '../../cp-workspace/tools/types';
import type { FoldAxiom, ReferenceKind } from '../../lib/foldSentences';
import { AXIOM_SLOTS } from '../document/foldSequenceDocument';
import type { FoldSegmentPick } from '../canvas/foldPicking';
import { lineModeAxiom, type FoldLineModeId, type FoldSecondLineModeId, type FoldToolId } from './foldToolCatalog';
import { FOLD_VERTEX_LINES_DEFAULT, locatesWithLineModes, vertexToolInput, type FoldVertexLines } from './vertex/vertexInputs';

/** How one click snaps: Edit's vocabulary, and the raw point a free line takes. */
export type FoldStepSnap = CpStepSnap | 'free';

/** One click of a tool's sequence. */
export interface FoldLocateStep {
  snap: FoldStepSnap;
  /** A free-line endpoint may snap to points; a free region pick must not. */
  snapFree?: boolean;
  /** For an axiom: the input slot this click fills, in the axiom's own order. */
  slot: number | null;
  /** For a `crease-required` click: whether the paper's raw edge counts, or only folds and creases. */
  edges: boolean;
  /**
   * For a `crease-required` click that takes only some kinds of line, in
   * place of `edges`: a petal fold's hinge is a precrease, a swivel's moving
   * edge a raw or folded edge. A line of any other kind is never offered.
   */
  kinds?: readonly FoldSegmentKind[];
}

/** A line's kind, as the landmarks name it: the paper's raw edge, a fold (a bend), or a flat crease. */
export type FoldSegmentKind = FoldSegmentPick['segment'];

export interface FoldInputModel {
  steps: readonly FoldLocateStep[];
}

/**
 * The clicks of each axiom, in click order, as the slots they fill. Read with
 * `lineModeSteps`: "the edge or crease the fold is perpendicular to" is O4's
 * line, clicked first though stored second.
 */
const AXIOM_CLICK_SLOTS: Readonly<Record<FoldAxiom, readonly number[]>> = {
  1: [0, 1],
  2: [0, 1],
  3: [0, 1],
  // Perpendicular to the line, then through the point: O4 is [p, m].
  4: [1, 0],
  // The point to move, the pivot, the line: O5 is [pivot, p, m1].
  5: [1, 0, 2],
  6: [0, 1, 2, 3],
  // The point to move, the line it lands on, the line it is square to: O7 is [p, m1, m2].
  7: [0, 1, 2],
};

const snapFor = (kind: ReferenceKind): CpStepSnap => (kind === 'point' ? 'point' : 'crease-required');

function axiomModel(axiom: FoldAxiom): FoldInputModel {
  const kinds = AXIOM_SLOTS[axiom];
  return {
    steps: AXIOM_CLICK_SLOTS[axiom].map((slot) => ({ snap: snapFor(kinds[slot]!), slot, edges: true })),
  };
}

/** One model per axiom, made once: a model's identity is what a counter is kept for. */
const AXIOM_MODELS: Readonly<Record<FoldAxiom, FoldInputModel>> = {
  1: axiomModel(1),
  2: axiomModel(2),
  3: axiomModel(3),
  4: axiomModel(4),
  5: axiomModel(5),
  6: axiomModel(6),
  7: axiomModel(7),
};

const FREE_LINE: FoldInputModel = {
  steps: [
    { snap: 'free', snapFree: true, slot: null, edges: false },
    { snap: 'free', snapFree: true, slot: null, edges: false },
  ],
};

/** An existing crease: a fold to unfold, or a precrease to refold. The paper's edge is no crease. */
const EXISTING_CREASE: FoldInputModel = { steps: [{ snap: 'crease-required', slot: null, edges: false }] };

/** The Divide line: one edge, fold or crease to divide. */
const DIVIDE_LINE: FoldInputModel = { steps: [{ snap: 'crease-required', slot: null, edges: true }] };

/** Rotate and Unfold to step: no clicks. The window sets everything they take. */
const NO_CLICKS: FoldInputModel = { steps: [] };

/** The clicks a line mode collects. */
export function lineModeInput(mode: FoldLineModeId): FoldInputModel {
  const axiom = lineModeAxiom(mode);
  if (axiom !== null) return AXIOM_MODELS[axiom];
  return mode === 'free' ? FREE_LINE : EXISTING_CREASE;
}

/**
 * A crimp's clicks: its first line's, in its line mode, then its second
 * line's — a free line's two ends, or one click on a crease. The second
 * line's clicks fill no axiom slot. One model per pair, made once, as each
 * axiom's is: a model's identity is what a counter is kept for.
 */
const CRIMP_MODELS = new Map<string, FoldInputModel>();

export function crimpInput(mode: FoldLineModeId, second: FoldSecondLineModeId): FoldInputModel {
  const key = `${mode}|${second}`;
  let model = CRIMP_MODELS.get(key);
  if (!model) {
    model = { steps: [...lineModeInput(mode).steps, ...lineModeInput(second).steps] };
    CRIMP_MODELS.set(key, model);
  }
  return model;
}

/**
 * The clicks the tool in hand collects: a fold along a line, its line mode's
 * — a crimp's, its two lines' —; a vertex fold, its own, a petal fold's hinge
 * and a swivel's target named as `vertex` says (`tools/vertex/vertexInputs`);
 * the Divide line's, its segment; Rotate's and Unfold to step's, none; Repeat's,
 * its line mode's, the mirror axis drawn on either pane (`fold/repeat/repeatDrawn`).
 */
export function toolInput(
  tool: FoldToolId,
  mode: FoldLineModeId,
  second: FoldSecondLineModeId = 'free',
  vertex: FoldVertexLines = FOLD_VERTEX_LINES_DEFAULT
): FoldInputModel {
  switch (tool) {
    case 'rotate':
    case 'unfold-to':
      return NO_CLICKS;
    case 'repeat':
    case 'valley':
    case 'mountain':
    case 'precrease':
    case 'inside-reverse':
    case 'tuck':
    case 'open-sink':
    case 'closed-sink':
    case 'unsink':
      return lineModeInput(mode);
    case 'pleat':
    case 'crimp':
      return crimpInput(mode, second);
    case 'squash':
    case 'petal':
    case 'rabbit-ear':
    case 'swivel':
      // By its valley and mountain, each line is located in the line mode
      // chosen; a squash's drawn hinge too, until it is taken.
      return locatesWithLineModes(tool, vertex) ? lineModeInput(mode) : vertexToolInput(tool, vertex);
    case 'divide-line':
      return DIVIDE_LINE;
  }
}

/** The click a model expects next, or null once every click is in. */
export function nextStep(model: FoldInputModel, picks: number): FoldLocateStep | null {
  return model.steps[picks] ?? null;
}

/** The reducer that counts a model's clicks: one sequence step per click. */
export function locateEngine(model: FoldInputModel): ToolEngine<SequenceState> {
  return createStepSequenceTool(model.steps.length);
}

/**
 * The picks, given in click order, put in the axiom's slot order. Null until
 * every click is in, or for a model whose steps fill no slots.
 */
export function inSlotOrder<T>(model: FoldInputModel, picks: readonly T[]): T[] | null {
  if (picks.length !== model.steps.length) return null;
  const slots = new Array<T>(picks.length);
  for (const [click, step] of model.steps.entries()) {
    if (step.slot === null) return null;
    slots[step.slot] = picks[click]!;
  }
  return slots;
}
