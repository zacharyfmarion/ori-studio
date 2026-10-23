/**
 * The Fold tools' interaction state (plan D13, D14): the tool in hand, the
 * line mode, the references clicked so far, and every choice made while a
 * fold is previewed — the root, the moving side, what moves, the fixes taken.
 *
 * Interaction state, not the document: nothing here is saved or undone, and a
 * commit, a cancel or a move to another step lets it go. Module state in a
 * vanilla store, as Simulate's tool state is, because the keyboard executor
 * and the canvas read and write it from callbacks that must not re-subscribe;
 * React reads it through {@link useFoldTools}.
 *
 * The clicks are counted by the surface-agnostic reducer the registry hands
 * out (`createStepSequenceTool` through `createToolRuntime`); this holds what
 * each click picked, which the reducer, counting points, has no word for.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { createToolRuntime, type ToolRuntime } from '../../cp-workspace/tools/runtime';
import type { Point } from '../../lib/geometry';
import { sameTurnRotation, type TurnRotation } from '../../lib/steps/turn';
import type { OristudioCpRatioExpression } from '../../lib/oristudioCpToolSettings';
import { ratioExpressionFromHalves } from '../../lib/oristudioCpToolSettings';
import type { FoldPick, FoldPointPick } from '../canvas/foldPicking';
import {
  FOLD_MARK_MAX_PARTS,
  type FoldChoices,
  type FoldDirection,
  type FoldLocatedLine,
  type FoldModelLine,
  type FoldModelDirection,
  type FoldOp,
  type FoldRepeatOp,
  type FoldReturnOp,
  type FoldSwivelKind,
  type SheetPoint,
} from '../document/foldSequenceDocument';
import type { FoldReverseKind } from '../engine/foldEngineReverseWire';
import type { FoldFlap } from '../engine/foldEngineWire';
import {
  isLineTool,
  isOneStepTool,
  locatesLine,
  type FoldLineBy,
  type FoldLineModeId,
  type FoldSecondLineModeId,
  type FoldToolId,
} from './foldToolCatalog';
import { sameFlap } from './crossSection';
import { lineModeInput, locateEngine, toolInput, type FoldInputModel } from './foldToolRegistry';
import { extentClicks, type FoldExtentMode } from './precrease/precreaseExtent';
import { FOLD_ROTATION_DEFAULT } from './rotate/rotateTool';
import { SWIVEL_TARGET_FROM, type FoldSquashHinge, type FoldSwivelInput } from './vertex/vertexInputs';

/** Wrap without adding two potentially MAX_SAFE_INTEGER-sized indices. */
function wrappedOpening(index: number, delta: number, count: number): number {
  const at = index % count;
  const offset = delta % count;
  return offset >= 0
    ? (at >= count - offset ? at - (count - offset) : at + offset)
    : (at < -offset ? count + (at + offset) : at + offset);
}

/**
 * What a fold takes along with the moving side (D6's seed, before it names
 * sheet points): the top flap at the line, which is where a fold starts;
 * every layer; the flaps picked — as the engine named them, so a new section
 * of the same line finds them again — or the stack at a point of the folded
 * pane, at the depth a repeated click went down to.
 *
 * `top` names no flap: which flap is on top is the cross-section's to say,
 * and the section is the line's and the side's. It is resolved where the
 * section is known (`tools/topFlapSeed`, `useFoldLineSection`), before any
 * step is built, so no step is ever built with it. For a reverse fold it
 * instead resolves to every layer, the material named by an Axiom 2
 * moving point picked on the CP (`reverseMaterialSeed`), or every layer on
 * the stretch of a free or Axiom 1 line drawn between its picks
 * (`reverseSegmentSeed`).
 */
export type FoldToolSeed =
  | { scope: 'top' }
  | { scope: 'all' }
  | { scope: 'flaps'; flaps: readonly FoldFlap[] }
  | { scope: 'depth'; at: SheetPoint; scene: Point; choice: number };

/** A seed a step can be built with: the default resolved to named flaps, or every layer. */
export type FoldResolvedSeed = Exclude<FoldToolSeed, { scope: 'top' }>;

/**
 * The default seed (owner request, 2026-10-13): the topmost flap at the
 * line, as the front shows it, not every layer. A fold that takes a whole
 * point takes every layer of it instead (`seedForTool`).
 */
export const FOLD_TOP_FLAP: FoldToolSeed = { scope: 'top' };

/** Every layer on the moving side. */
export const FOLD_EVERY_LAYER: FoldResolvedSeed = { scope: 'all' };

/** A fold a refusal's fix offers, folded in place of the one the picks locate until they change. */
export interface FoldToolOverride {
  op: FoldOp;
  choices?: FoldChoices;
}

/** How a Divide-line mark divides its segment (D6), as the window edits it. */
export interface FoldDivideSettings {
  mode: 'count' | 'ratio';
  parts: number;
  ratio: OristudioCpRatioExpression;
}

export const FOLD_DIVIDE_DEFAULT: FoldDivideSettings = {
  mode: 'count',
  parts: 2,
  ratio: ratioExpressionFromHalves({ a: 1, b: 0, c: 0 }, { a: 1, b: 0, c: 0 }),
};

/**
 * A compound fold's choices while it is previewed, one block per family: the
 * reverse fold's kind (`tools/reverse`), and the opening and the order taken
 * among those the engine lists — by index, as the axiom's root is: what the
 * step stores is the result each names (plan D6), never the index.
 */
export interface FoldCompoundToolChoices {
  /**
   * The kind the folder chose — a reverse fold's, or a crimp's, two reverse
   * folds of one kind — null while the tool takes the one that lands
   * (inside when both do).
   */
  reverseKind: FoldReverseKind | null;
  /** The way the flaps open, by index into the ways the engine lists. */
  opening: number;
  /** The layer order, by index into the orders the engine lists for the kind (a vertex fold's, for its op). */
  order: number;
  /**
   * The tuck's layer to tuck against (`tools/tuck`), by the face the engine
   * names it by; null takes the first listed. A face rather than an index,
   * so a fix naming one picks it, and a new seed that keeps it listed keeps
   * it chosen.
   */
  tuckTarget: number | null;
  /** Additional stationary targets, reset when the fold geometry changes. */
  tuckPinned?: readonly number[];
  // The vertex folds (`tools/vertex`): each a choice of what the engine
  // lists, by index, or of where the folder points, as a direction.
  /** Where a squash's spine lands: a direction from its vertex in the parent's model frame; null for the hinge line. */
  squashTarget: FoldModelDirection | null;
  /** A rabbit ear's or a swivel's fourth ray, by index into the candidates; null for the first that lands. */
  emergent: number | null;
  /** How many layers at a fan's center its creases cut, from the side the direction names; null for every one. */
  fanLayers: number | null;
  /**
   * The kind the folder chose for a swivel on a folded edge — its strip on
   * top, or tucked between the two layers — null for open, the kind asked
   * until another is chosen. Never changed for the folder: a kind that does
   * not land is refused, and the window offers the other.
   */
  swivelKind: FoldSwivelKind | null;
  /** A closed sink's pocket, by index into the pockets the engine lists for the point (`tools/sink`). */
  pocket: number;
}

/**
 * A saved step its tool rebuilds in place, from the step's parent (the Step
 * pane's Rebuild unfold, and Update from source steps): its id, its parent,
 * and the op it held when the rebuild began, which the store checks it still
 * holds before replacing it.
 */
export type FoldToolRebuild =
  | { tool: 'unfold-to'; id: string; parent: string | null; expected: FoldReturnOp }
  | { tool: 'repeat'; id: string; parent: string | null; expected: FoldRepeatOp };

export const FOLD_COMPOUND_CHOICES_INITIAL: FoldCompoundToolChoices = {
  reverseKind: null,
  opening: 0,
  order: 0,
  tuckTarget: null,
  tuckPinned: [],
  squashTarget: null,
  emergent: null,
  fanLayers: null,
  swivelKind: null,
  pocket: 0,
};

export interface FoldToolState {
  tool: FoldToolId;
  lineMode: FoldLineModeId;
  /** Optional point snapping for free-line endpoints; retained between folds. */
  freeLineSnap: boolean;
  /** The references clicked so far, in click order. */
  picks: readonly FoldPick[];
  /** The axiom root chosen, by index into the candidates the engine gave for the picks. */
  root: number;
  /** Independent axiom choice for the valley line of a pleat. */
  secondRoot?: number;
  /** The moving side is the other one from the default. */
  swapped: boolean;
  seed: FoldToolSeed;
  /** The way a precrease folds before it unfolds. */
  precreaseDirection: FoldDirection;
  /**
   * How much of its line a precrease creases (`tools/precrease`): the whole
   * line, a segment or a pinch. Kept from one precrease to the next, as the
   * line mode is.
   */
  extent: FoldExtentMode;
  /**
   * The points clicked along the located line for a segment's ends or a
   * pinch's centre, in click order: let go with the line, as the picks are.
   */
  extentPicks: readonly FoldPointPick[];
  // The crimp's and the tuck's settings, which stay chosen as the line mode
  // does: from one fold to the next.
  /** How a crimp's second line is located, after its first. */
  secondLineMode: FoldSecondLineModeId;
  /** A tuck's direction as the viewer sees it: a valley goes under its target, a mountain over it. */
  tuckDirection: FoldDirection;
  /** The way a vertex fold folds, as the viewer sees it: kept from fold to fold, as a precrease's is. */
  vertexDirection: FoldDirection;
  /**
   * How a petal fold's hinge is named — a crease already there, or its two
   * ends, which the fold creases — and a swivel's target line: a crease or an
   * edge, or two points. Each kept from fold to fold, as the line mode is.
   */
  petalHinge: FoldLineBy;
  swivelTarget: FoldLineBy;
  /** How a swivel is constructed: by its edge onto a line, or by its valley and mountain. Kept from fold to fold. */
  swivelInput?: FoldSwivelInput;
  /** A squash's hinge: the folded edge it infers, or a line drawn with the line modes. Kept from fold to fold. */
  squashHinge?: FoldSquashHinge;
  /**
   * The line a construction takes before its picks go on, once taken: the
   * line as it was located, and on the folded pane. A swivel by its valley
   * and mountain's valley, its picks then locating the mountain; a squash's
   * drawn hinge, its pick then the flap's end.
   */
  takenLine?: FoldLocatedLine & { sceneLine: FoldModelLine };
  override: FoldToolOverride | null;
  divide: FoldDivideSettings;
  /** The flap the pointer is over in the layer picker or the chips, which the canvas lights. */
  hoveredFlap: number | null;
  compound: FoldCompoundToolChoices;
  // The Rotate tool's (`tools/rotate`).
  /** How far and which way Rotate turns the model: kept from one rotation to the next, as the line mode is. */
  rotation: TurnRotation;
  /**
   * The tool Rotate, Unfold to step or Repeat was taken up from: what adding
   * its step, or Escape, puts back in hand.
   */
  resume: FoldToolId;
  // The sequence tools' (`fold/return`, `fold/repeat`), each kept while it is valid.
  /**
   * Unfold to step's target, an earlier entry of the path by id (null for the
   * flat sheet); null for the default, the entry before the step on screen.
   * Let go each time the tool is taken up.
   */
  unfoldTarget: { id: string | null } | null;
  /**
   * Repeat's range start, by id; null for the step on screen, a range of one.
   * The range always ends at the step on screen. Let go each time the tool is
   * taken up.
   */
  repeatFirst: string | null;
  /**
   * The symmetry axis the folder last chose or drew, by its sheet line:
   * Repeat's axis whenever it is one of the range's verified axes. Kept for
   * the session, never saved.
   */
  repeatAxis: FoldModelLine | null;
  /** Where that axis came from: offered and taken (`listed`), or drawn on a pane — what analytics says of a repeat. */
  repeatAxisSource: 'listed' | 'drawn_cp' | 'drawn_folded';
  /** Repeat saves a step per operation instead of one numbered step: kept from one repeat to the next. */
  repeatIndividual: boolean;
  /** A saved step its tool is rebuilding in place; null while the tool adds a step. */
  rebuild: FoldToolRebuild | null;
}

/** The tools' state with the seed resolved (`useFoldLineSection`): what every step is built from. */
export type FoldSeededToolState = Omit<FoldToolState, 'seed'> & { seed: FoldResolvedSeed };

export const FOLD_TOOL_INITIAL: FoldToolState = {
  tool: 'valley',
  // The design opens on point to point, the first fold of most models.
  lineMode: 'axiom-2',
  freeLineSnap: true,
  picks: [],
  root: 0,
  swapped: false,
  seed: FOLD_TOP_FLAP,
  precreaseDirection: 'valley',
  extent: 'whole',
  extentPicks: [],
  secondLineMode: 'free',
  tuckDirection: 'valley',
  vertexDirection: 'valley',
  petalHinge: 'crease',
  swivelTarget: 'crease',
  override: null,
  divide: FOLD_DIVIDE_DEFAULT,
  hoveredFlap: null,
  compound: FOLD_COMPOUND_CHOICES_INITIAL,
  rotation: FOLD_ROTATION_DEFAULT,
  resume: 'valley',
  unfoldTarget: null,
  repeatFirst: null,
  repeatAxis: null,
  repeatAxisSource: 'listed',
  repeatIndividual: false,
  rebuild: null,
};

/** What a new locate starts from: the tool, the line mode, the extent and the Divide settings stay. */
function located(state: FoldToolState): FoldToolState {
  return {
    ...state,
    picks: [],
    takenLine: undefined,
    extentPicks: [],
    root: 0,
    secondRoot: 0,
    swapped: false,
    seed: FOLD_TOP_FLAP,
    override: null,
    hoveredFlap: null,
    compound: FOLD_COMPOUND_CHOICES_INITIAL,
  };
}

/**
 * A swivel by its valley and mountain is asked for by its kind as well as
 * its lines, from the first pick (`vertexToolWindow`'s kind control): a new
 * locate — another line mode, the valley taken, Esc, the next fold — keeps
 * the kind chosen. A swivel by its edge chooses its kind once its picks are
 * in, so its locate starts the kind again with them.
 */
function keepAskedKind(state: FoldToolState, next: FoldToolState): FoldToolState {
  const { swivelKind } = state.compound;
  const asked = state.tool === 'swivel' && state.swivelInput === 'valley-mountain';
  return asked && swivelKind !== null ? { ...next, compound: { ...next.compound, swivelKind } } : next;
}

/** A new tip — another side, another seed, another root — opens, sinks and stacks anew: the kind stays chosen. */
function anotherTip(compound: FoldCompoundToolChoices): FoldCompoundToolChoices {
  return compound.opening === 0 && compound.order === 0 && compound.pocket === 0 && !compound.tuckPinned?.length
    ? compound
    : { ...compound, opening: 0, order: 0, pocket: 0, tuckPinned: [] };
}

/** A sink with a kind, open or closed: the tools the sink window's kind control switches between. */
function isSinkKindTool(tool: FoldToolId): boolean {
  return tool === 'open-sink' || tool === 'closed-sink';
}

/**
 * The clicks the state's tool and line mode collect (a crimp's, its second
 * line's too; a petal fold's hinge and a swivel's target as they are named).
 */
export function foldToolInput(
  state: Pick<FoldToolState, 'tool' | 'lineMode'> &
    Partial<Pick<FoldToolState, 'secondLineMode' | 'petalHinge' | 'swivelTarget' | 'swivelInput' | 'squashHinge' | 'takenLine'>>
): FoldInputModel | null {
  return toolInput(state.tool, state.lineMode, state.secondLineMode, {
    petalHinge: state.petalHinge ?? 'crease',
    swivelTarget: state.swivelTarget ?? 'crease',
    swivelInput: state.swivelInput ?? 'edge',
    squashHinge: state.squashHinge ?? 'folded',
    lineTaken: state.takenLine !== undefined,
  });
}

/**
 * Whether the tool in hand locates a line of its own with the line modes,
 * taken before its picks go on (`takenLine`): a swivel by its valley and
 * mountain, both of its lines; a squash about a drawn hinge, until it is
 * taken.
 */
export function locatesTakenLine(state: Pick<FoldToolState, 'tool' | 'swivelInput' | 'squashHinge'>): boolean {
  return (state.tool === 'swivel' && state.swivelInput === 'valley-mountain') || (state.tool === 'squash' && state.squashHinge === 'line');
}

/**
 * What the tools have been asked to fold, as a key: the tool, its line and
 * every pick and choice made along it — not the flap hovered, which asks for
 * nothing. Any change to it is another fold.
 */
export function foldToolInputKey(state: FoldToolState): string {
  // A rebuild by its step alone: the op it held is the store's to check, and may be long.
  const { hoveredFlap: _hovered, freeLineSnap: _snap, rebuild, ...input } = state;
  return JSON.stringify({ ...input, rebuild: rebuild?.id ?? null });
}

/**
 * The fold's line as the tools hold it, as a key: their input
 * (`foldToolInputKey`) but the seed and a compound fold's choices — what a
 * flap picked or unpicked, or another kind, opening or order, leaves alone.
 */
export function foldToolLineKey(state: FoldToolState): string {
  const { seed: _seed, compound: _compound, ...line } = state;
  return foldToolInputKey({ ...line, seed: FOLD_TOOL_INITIAL.seed, compound: FOLD_TOOL_INITIAL.compound });
}

/** Toolbar construction changes follow the line currently being drawn. */
export function pleatDrawingValley(state: Pick<FoldToolState, 'tool' | 'lineMode' | 'picks'>): boolean {
  return state.tool === 'pleat' && state.picks.length >= lineModeInput(state.lineMode).steps.length;
}

export function activeFoldLineMode(state: Pick<FoldToolState, 'tool' | 'lineMode' | 'secondLineMode' | 'picks'>): FoldLineModeId {
  return pleatDrawingValley(state) ? state.secondLineMode : state.lineMode;
}

/** Every click is in: the line is located (or, for the Divide line, the segment). */
export function isLocated(state: FoldToolState): boolean {
  const model = foldToolInput(state);
  return model !== null && state.picks.length >= model.steps.length;
}

/** Whether anything is under way that Escape would let go. */
export function hasToolInput(state: FoldToolState): boolean {
  return state.picks.length > 0 || state.extentPicks.length > 0 || state.override !== null || state.takenLine !== undefined;
}

/**
 * The precrease's extent is what the tools are asking for: the Precrease tool
 * in hand, its line located, and a segment or a pinch chosen — so a click
 * along the line is one of its points.
 */
export function picksAlongLine(state: FoldToolState): boolean {
  return state.tool === 'precrease' && state.extent !== 'whole' && isLocated(state) && state.override === null;
}

export interface FoldTools {
  readonly store: StoreApi<FoldToolState>;
  selectTool(tool: FoldToolId): void;
  selectLineMode(mode: FoldLineModeId, line?: 'first'): void;
  setFreeLineSnap(enabled: boolean): void;
  /** A click: the pick it made. Whether it was taken (a click past the last is not). */
  pick(pick: FoldPick): boolean;
  /**
   * Another answer for the last click, every choice made of what it led to
   * let go: a fan's paper that stays, picked again while its fold is
   * previewed — its fourth creases are listed anew.
   */
  repick(pick: FoldPick): void;
  /**
   * The point picked at sheet point `from` named by `to` instead, the same
   * spot on another layer, every other choice kept: a fold refused as its
   * point staying put, taking the point on paper that folds (`moverStays`).
   * Whether a point was picked there.
   */
  swapPoint(from: SheetPoint, to: SheetPoint): boolean;
  /** Let go of the clicks and every choice made since: Escape's rung, and what a commit leaves. */
  clear(): void;
  /**
   * Fold the other side. Whether there was a side to swap: none until the
   * line is located, so a swap is never latched for a line not yet there.
   */
  swapSide(): boolean;
  /** Step through the axiom's roots, of `count`. */
  stepRoot(delta: number, count: number, line?: 'first' | 'second'): void;
  /** Fold with this seed; a seed of no flaps is every layer (`flapSeed`). */
  setSeed(seed: FoldToolSeed): void;
  /**
   * Pick or unpick a flap; `all` is the section's every flap, so picking the
   * last unpicked one is `all` again — and so is unpicking the only one
   * picked, which would otherwise leave a seed that moves nothing (`flapSeed`).
   * `resolved` is the preview's resolved default: the top flap or material
   * picked on the CP. A press widens from what the preview actually moves.
   */
  toggleFlap(flap: FoldFlap, all: readonly FoldFlap[], resolved: FoldResolvedSeed | null): void;
  setPrecreaseDirection(direction: FoldDirection): void;
  // A precrease's extent (`tools/precrease`).
  /** Crease this much of the line: its points along the line start again. */
  setExtent(extent: FoldExtentMode): void;
  /**
   * A point clicked along the located line, for the extent: a segment's next
   * end, a pinch's centre. Once the extent has every point, a click starts it
   * again from this one — the pinch moves there, a segment starts there.
   */
  pickAlong(pick: FoldPointPick): void;
  /** Let go of the last point clicked along the line; whether there was one. Escape's first rung. */
  unpickAlong(): boolean;
  setOverride(override: FoldToolOverride | null): void;
  setDivide(divide: Partial<FoldDivideSettings>): void;
  setHoveredFlap(flap: number | null): void;
  // A compound fold's choices, one block per family.
  /** The reverse fold's kind; null takes the one that lands. */
  setReverseKind(kind: FoldReverseKind | null): void;
  /** Step through the ways the flaps open, of `count`. */
  stepOpening(delta: number, count: number): void;
  /** Step through the layer orders listed, of `count`. */
  stepOrder(delta: number, count: number): void;
  // The crimp's and the tuck's.
  /** How a crimp's second line is located: its clicks start again, its first line's stay. */
  setSecondLineMode(mode: FoldSecondLineModeId): void;
  /** A tuck's direction, which lists other layers to tuck against. */
  setTuckDirection(direction: FoldDirection): void;
  /** The layer a tuck goes against, by its face; null takes the first listed. */
  setTuckTarget(face: number | null): void;
  toggleTuckPinned(face: number): void;
  // The vertex folds (`tools/vertex`): each choice made anew lists the
  // choices after it anew — the fourth ray its orders.
  setVertexDirection(direction: FoldDirection): void;
  /** Name a petal fold's hinge by a crease or by its two ends: its clicks start again. */
  setPetalHinge(hinge: FoldLineBy): void;
  /** Construct a swivel by its edge onto a line, or by its valley and mountain: its picks start again. */
  setSwivelInput(mode: FoldSwivelInput): void;
  /** Take the line located (`locatesTakenLine`): a swivel's valley, or a squash's hinge. The picks start again, for what comes next. */
  takeLine(line: NonNullable<FoldToolState['takenLine']>): void;
  /** Squash about the folded edge, or a drawn line: its picks start again. */
  setSquashHinge(hinge: FoldSquashHinge): void;
  /** Name a swivel's target by a crease or edge, or by two points: its pivot and edge stay, its target is clicked anew. */
  setSwivelTarget(target: FoldLineBy): void;
  /** Where a squash's spine lands; null for the hinge line. */
  setSquashTarget(target: FoldModelDirection | null): void;
  /** Take a fan's emergent candidate by index; null for the first that lands. */
  setEmergent(emergent: number | null): void;
  /** A swivel on a folded edge's kind, open or inside; null for the one that lands. */
  setSwivelKind(kind: FoldSwivelKind | null): void;
  /** How many layers at the fan's center are cut; null for every one. */
  setFanLayers(layers: number | null): void;
  /** Step through a closed sink's pockets, of `count`: each stacks anew. */
  stepPocket(delta: number, count: number): void;
  // The Rotate tool's (`tools/rotate`).
  /** Turn the model by this rotation instead: a preset, a direction, an exact angle. */
  setRotation(rotation: TurnRotation): void;
  /**
   * Put down a tool held for one step — Rotate, Unfold to step, Repeat — the
   * tool it was taken up from back in hand: what adding its step and Escape
   * do. Whether one was in hand.
   */
  putDown(): boolean;
  // The sequence tools' (`fold/return`, `fold/repeat`).
  /** Unfold to this entry of the path (null for the flat sheet). */
  setUnfoldTarget(id: string | null): void;
  /** Start Repeat's range at this step. */
  setRepeatFirst(id: string): void;
  /** Mirror across this axis, by its sheet line: what Repeat remembers as the last axis chosen, and how it was (offered, by default). */
  setRepeatAxis(axis: FoldModelLine, source?: FoldToolState['repeatAxisSource']): void;
  setRepeatIndividual(individual: boolean): void;
  /**
   * Take up the tool that rebuilds `rebuild`'s step in place, its settings
   * read from the step: an unfold's target, a repeat's range start and axis.
   * The step's parent must be on screen.
   */
  rebuildStep(rebuild: FoldToolRebuild): void;
  /** Let go of a rebuild under way: the tool goes on adding a step. */
  dropRebuild(): void;
}

/**
 * The seed that picks `flaps` of `all`: every layer when they are every flap
 * at the line, or none of them. A seed of no flaps names nothing on the
 * moving side, so the engine refuses it (`no_side`) and the window, with no
 * section to show, has no chips left to pick one again: the last chip
 * unpressed would strand the fold. Every layer is the widest it can be, so
 * unpressing the last chip moves every layer: one press from the top flap.
 */
export function flapSeed(flaps: readonly FoldFlap[], all: readonly FoldFlap[] = []): FoldResolvedSeed {
  if (flaps.length === 0) return { scope: 'all' };
  const everything = all.length > 0 && all.every((each) => flaps.some((other) => sameFlap(each, other)));
  return everything ? { scope: 'all' } : { scope: 'flaps', flaps };
}

/** The parts a Divide-line count may take: two up to the Diagram's divisions' limit. */
export function clampDivideParts(parts: number): number {
  return Math.min(FOLD_MARK_MAX_PARTS, Math.max(2, Math.round(Number.isFinite(parts) ? parts : 2)));
}

export function createFoldTools(initial: FoldToolState = FOLD_TOOL_INITIAL): FoldTools {
  const store = createStore<FoldToolState>(() => initial);
  // The reducer that counts the clicks, rebuilt whenever what is clicked for changes.
  let runtime: ToolRuntime | null = null;
  let runtimeFor: FoldInputModel | null = null;
  const counter = (model: FoldInputModel): ToolRuntime => {
    if (runtime && runtimeFor === model) return runtime;
    runtime = createToolRuntime(locateEngine(model));
    runtimeFor = model;
    return runtime;
  };
  const set = (next: (state: FoldToolState) => FoldToolState) => {
    const before = store.getState();
    const after = next(before);
    if (after !== before) store.setState(after, true);
  };
  const restart = (state: FoldToolState): FoldToolState => {
    runtime?.reset();
    return keepAskedKind(state, located(state));
  };

  const api: FoldTools = {
    store,

    selectTool(tool) {
      set((state) => {
        if (state.tool === tool) return state;
        // Every fold along a line folds the same line: switching between V,
        // M, P and the compound folds along one keeps it, as the window's
        // V / M / P control promises — a crimp's first line, and the picks
        // past it are its second line's, which another tool does not take.
        // Anything else locates anew. The open and the closed sink are one
        // sink's two kinds, as the reverse fold's are: a fix's line taken for
        // one (the square line) is the other's too.
        if (tool === 'pleat') return { ...restart(state), tool, lineMode: 'free', secondLineMode: 'free' };
        const keeps = isLineTool(tool) && isLineTool(state.tool);
        if (keeps) {
          const secondLineMode = tool === 'crimp' && state.secondLineMode !== 'free' && state.secondLineMode !== 'crease' ? 'free' : state.secondLineMode;
          const clicks = secondLineMode !== state.secondLineMode
            ? lineModeInput(state.lineMode).steps.length
            : toolInput(tool, state.lineMode, secondLineMode).steps.length;
          const sinkKinds = isSinkKindTool(tool) && isSinkKindTool(state.tool);
          return {
            ...state,
            tool,
            secondLineMode,
            picks: state.picks.length > clicks ? state.picks.slice(0, clicks) : state.picks,
            override: sinkKinds ? state.override : null,
            compound: anotherTip(state.compound),
          };
        }
        // A tool held for one step remembers the tool it was taken up from, to
        // give it back — the one before it, when it was another such tool.
        // Unfold to step and Repeat start again from the step on screen.
        if (isOneStepTool(tool)) {
          return {
            ...restart(state),
            tool,
            resume: isOneStepTool(state.tool) ? state.resume : state.tool,
            rebuild: null,
            ...(tool === 'unfold-to' ? { unfoldTarget: null } : {}),
            ...(tool === 'repeat' ? { repeatFirst: null } : {}),
          };
        }
        return { ...restart(state), tool, rebuild: null };
      });
    },

    setFreeLineSnap(freeLineSnap) {
      set((state) => state.freeLineSnap === freeLineSnap ? state : { ...state, freeLineSnap });
    },

    selectLineMode(lineMode, line) {
      if (line !== 'first' && pleatDrawingValley(store.getState())) {
        api.setSecondLineMode(lineMode);
        return;
      }
      set((state) => {
        // A line mode belongs to the folds along a line: choosing one from
        // any other tool takes a fold in hand.
        // A swivel by its valley and mountain locates its lines in a line
        // mode too: it stays in hand, and the valley taken stays taken.
        // So does a squash about a drawn hinge.
        const twoLines = locatesTakenLine(state);
        // So does Repeat, whose axis may be drawn in any line mode.
        const tool = twoLines || state.tool === 'repeat' ? state.tool : locatesLine(state.tool) ? state.tool : 'valley';
        if (state.lineMode === lineMode && state.tool === tool) return state;
        return { ...restart(state), tool, lineMode, ...(twoLines ? { takenLine: state.takenLine } : {}) };
      });
    },

    pick(pick) {
      const state = store.getState();
      const model = foldToolInput(state);
      if (!model || state.picks.length >= model.steps.length) return false;
      const out = counter(model).feed({ kind: 'down', point: pickPoint(pick) });
      if (out.ignored) return false;
      store.setState({ ...state, picks: [...state.picks, pick], override: null }, true);
      return true;
    },

    repick(pick) {
      set((state) =>
        state.picks.length === 0
          ? state
          : {
              ...state,
              picks: [...state.picks.slice(0, -1), pick],
              override: null,
              compound: { ...state.compound, emergent: null, order: 0, tuckPinned: [] },
            }
      );
    },

    swapPoint(from, to) {
      const state = store.getState();
      const at = state.picks.findIndex(
        (pick) => pick.kind === 'point' && Math.abs(pick.sheet[0] - from[0]) <= 1e-9 && Math.abs(pick.sheet[1] - from[1]) <= 1e-9
      );
      const picked = state.picks[at];
      if (picked?.kind !== 'point') return false;
      const picks = state.picks.slice();
      picks[at] = { ...picked, sheet: to, mark: null };
      store.setState({ ...state, picks, override: null }, true);
      return true;
    },

    clear() {
      set((state) => (hasToolInput(state) || state.seed.scope !== 'top' || state.swapped ? restart(state) : state));
    },

    swapSide() {
      // A vertex fold has no moving side to swap: the key falls through.
      const now = store.getState();
      if (!isLocated(now) || !isLineTool(now.tool)) return false;
      // The flaps picked, or the stack a depth pick went down, are the old
      // side's: the new side folds its own top flap until something of it is picked.
      set((state) => ({
        ...state,
        swapped: !state.swapped,
        seed: FOLD_TOP_FLAP,
        override: null,
        compound: anotherTip(state.compound),
      }));
      return true;
    },

    stepRoot(delta, count, line = 'first') {
      if (count <= 1) return;
      set((state) => ({
        ...state,
        [line === 'second' ? 'secondRoot' : 'root']: ((((line === 'second' ? state.secondRoot ?? 0 : state.root) + delta) % count) + count) % count,
        swapped: false,
        // Another root is another line: points clicked along this one are off it.
        extentPicks: [],
        override: null,
        compound: anotherTip(state.compound),
      }));
    },

    setSeed(asked) {
      const seed = asked.scope === 'flaps' ? flapSeed(asked.flaps) : asked;
      set((state) => ({ ...state, seed, override: null, compound: anotherTip(state.compound) }));
    },

    toggleFlap(flap, all, resolved) {
      set((state) => {
        const seed = state.seed.scope === 'top' ? resolved : state.seed;
        const picked = seed?.scope === 'flaps' ? seed.flaps : seed?.scope === 'all' ? all : [];
        const has = picked.some((each) => sameFlap(each, flap));
        const next = has ? picked.filter((each) => !sameFlap(each, flap)) : [...picked, flap];
        return { ...state, seed: flapSeed(next, all), override: null, compound: anotherTip(state.compound) };
      });
    },

    setPrecreaseDirection(precreaseDirection) {
      set((state) => (state.precreaseDirection === precreaseDirection ? state : { ...state, precreaseDirection, override: null }));
    },

    setExtent(extent) {
      set((state) => (state.extent === extent ? state : { ...state, extent, extentPicks: [], override: null }));
    },

    pickAlong(pick) {
      set((state) => {
        if (state.extent === 'whole') return state;
        const full = state.extentPicks.length >= extentClicks(state.extent);
        return { ...state, extentPicks: full ? [pick] : [...state.extentPicks, pick], override: null };
      });
    },

    unpickAlong() {
      const now = store.getState();
      if (now.extentPicks.length === 0) return false;
      set((state) => ({ ...state, extentPicks: state.extentPicks.slice(0, -1), override: null }));
      return true;
    },

    setOverride(override) {
      set((state) => ({ ...state, override }));
    },

    setDivide(divide) {
      set((state) => {
        const next = { ...state.divide, ...divide };
        return { ...state, divide: { ...next, parts: clampDivideParts(next.parts) } };
      });
    },

    setHoveredFlap(hoveredFlap) {
      set((state) => (state.hoveredFlap === hoveredFlap ? state : { ...state, hoveredFlap }));
    },

    // A compound fold's choices are made along its line: a fix's line in
    // place of the picks' (the override) is kept through them.
    setReverseKind(reverseKind) {
      set((state) =>
        state.compound.reverseKind === reverseKind
          ? state
          : { ...state, compound: { ...state.compound, reverseKind, order: 0 } }
      );
    },

    stepOpening(delta, count) {
      if (count <= 1) return;
      set((state) => ({
        ...state,
        compound: { ...state.compound, opening: wrappedOpening(state.compound.opening, delta, count), order: 0 },
      }));
    },

    stepOrder(delta, count) {
      if (count <= 1) return;
      set((state) => ({
        ...state,
        compound: { ...state.compound, order: (((state.compound.order + delta) % count) + count) % count },
      }));
    },

    setSecondLineMode(secondLineMode) {
      set((state) => {
        if (state.secondLineMode === secondLineMode) return state;
        // The first line's clicks stay: only the second line is located anew.
        const first = lineModeInput(state.lineMode).steps.length;
        const picks = (state.tool === 'crimp' || state.tool === 'pleat') ? state.picks.slice(0, first) : state.picks;
        return { ...state, secondLineMode, secondRoot: 0, picks, override: null, compound: anotherTip(state.compound) };
      });
    },

    setTuckDirection(tuckDirection) {
      // Another direction lists other layers, and orders them anew.
      set((state) =>
        state.tuckDirection === tuckDirection
          ? state
          : { ...state, tuckDirection, override: null, compound: { ...anotherTip(state.compound), tuckTarget: null } }
      );
    },

    toggleTuckPinned(face) {
      set((state) => {
        const pinned = state.compound.tuckPinned ?? [];
        return {
          ...state,
          compound: {
            ...state.compound,
            order: 0,
            tuckPinned: pinned.includes(face) ? pinned.filter((f) => f !== face) : [...pinned, face],
          },
        };
      });
    },

    setTuckTarget(tuckTarget) {
      // Another target is another tuck: the orders are its own.
      set((state) =>
        state.compound.tuckTarget === tuckTarget
          ? state
          : { ...state, compound: { ...state.compound, tuckTarget, order: 0 } }
      );
    },

    // A vertex fold's choices: each is another fold, whose later choices are listed anew.
    setVertexDirection(vertexDirection) {
      set((state) =>
        state.vertexDirection === vertexDirection
          ? state
          : { ...state, vertexDirection, compound: { ...state.compound, order: 0 } }
      );
    },

    setPetalHinge(petalHinge) {
      // Another way to name the hinge: its clicks, and the flap's after them, start again.
      set((state) => {
        if (state.petalHinge === petalHinge) return state;
        return state.tool === 'petal' ? { ...restart(state), petalHinge } : { ...state, petalHinge };
      });
    },

    takeLine(line) {
      set(state => ({ ...restart(state), takenLine: line }));
    },
    setSquashHinge(squashHinge) {
      set(state => (state.squashHinge ?? 'folded') === squashHinge ? state : { ...restart(state), squashHinge });
    },
    setSwivelInput(swivelInput) {
      // Another construction asks anew: its kind too.
      set(state => (state.swivelInput ?? 'edge') === swivelInput ? state : { ...restart(state), swivelInput, compound: FOLD_COMPOUND_CHOICES_INITIAL });
    },

    setSwivelTarget(swivelTarget) {
      set((state) => {
        if (state.swivelTarget === swivelTarget) return state;
        // The pivot and the edge stay: only the target is clicked anew.
        const picks = state.tool === 'swivel' ? state.picks.slice(0, SWIVEL_TARGET_FROM) : state.picks;
        return {
          ...state,
          swivelTarget,
          picks,
          override: null,
          compound: { ...state.compound, emergent: null, order: 0, tuckPinned: [] },
        };
      });
    },

    setSquashTarget(squashTarget) {
      set((state) => ({ ...state, compound: { ...state.compound, squashTarget, order: 0 } }));
    },

    setEmergent(emergent) {
      set((state) =>
        state.compound.emergent === emergent
          ? state
          : { ...state, compound: { ...state.compound, emergent, order: 0 } }
      );
    },

    setSwivelKind(swivelKind) {
      // Another kind is another fold: its orders are its own.
      set((state) =>
        state.compound.swivelKind === swivelKind
          ? state
          : { ...state, compound: { ...state.compound, swivelKind, order: 0 } }
      );
    },

    setFanLayers(fanLayers) {
      set((state) =>
        state.compound.fanLayers === fanLayers
          ? state
          : { ...state, compound: { ...state.compound, fanLayers, order: 0 } }
      );
    },

    stepPocket(delta, count) {
      if (count <= 1) return;
      set((state) => ({
        ...state,
        compound: { ...state.compound, pocket: (((state.compound.pocket + delta) % count) + count) % count, order: 0 },
      }));
    },

    // The Rotate tool's.
    setRotation(rotation) {
      set((state) => (sameTurnRotation(state.rotation, rotation) ? state : { ...state, rotation }));
    },

    putDown() {
      const now = store.getState();
      if (!isOneStepTool(now.tool)) return false;
      api.selectTool(isOneStepTool(now.resume) ? 'valley' : now.resume);
      return true;
    },

    // The sequence tools'.
    setUnfoldTarget(id) {
      set((state) => (state.unfoldTarget?.id === id ? state : { ...state, unfoldTarget: { id } }));
    },

    setRepeatFirst(repeatFirst) {
      set((state) => (state.repeatFirst === repeatFirst ? state : { ...state, repeatFirst }));
    },

    setRepeatAxis(repeatAxis, repeatAxisSource = 'listed') {
      set((state) =>
        state.repeatAxis &&
        state.repeatAxis.d === repeatAxis.d &&
        state.repeatAxis.n[0] === repeatAxis.n[0] &&
        state.repeatAxis.n[1] === repeatAxis.n[1] &&
        state.repeatAxisSource === repeatAxisSource
          ? state
          : { ...state, repeatAxis, repeatAxisSource }
      );
    },

    setRepeatIndividual(repeatIndividual) {
      set((state) => (state.repeatIndividual === repeatIndividual ? state : { ...state, repeatIndividual }));
    },

    rebuildStep(rebuild) {
      api.selectTool(rebuild.tool);
      set((state) =>
        rebuild.tool === 'unfold-to'
          ? { ...state, rebuild, unfoldTarget: { id: rebuild.expected.target } }
          : { ...state, rebuild, repeatFirst: rebuild.expected.source.first, repeatAxis: rebuild.expected.axis, repeatAxisSource: 'listed' }
      );
    },

    dropRebuild() {
      set((state) => (state.rebuild === null ? state : { ...state, rebuild: null }));
    },
  };
  return api;
}

/** Where a pick is, for the reducer that counts it: it reads positions, never what was picked. */
function pickPoint(pick: FoldPick): Point {
  if (pick.kind === 'free') return pick.scene;
  if (pick.kind === 'point') return { x: pick.sheet[0], y: pick.sheet[1] };
  return { x: pick.sheet[0][0], y: pick.sheet[0][1] };
}

let tools: FoldTools | null = null;

/** The app's Fold tools, made on first use. */
export function foldTools(): FoldTools {
  tools ??= createFoldTools();
  return tools;
}

/** Any part of the tools' state; the selector must return what the state holds, not a new object. */
export function useFoldTools<T>(selector: (state: FoldToolState) => T): T {
  return useStore(foldTools().store, selector);
}
