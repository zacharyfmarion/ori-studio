import { reportError } from '../../monitoring';
import { trackFoldOrderResolved, trackFoldFreeLineSnapChanged, trackFoldMarkAdded } from '../../analytics/trackFold';
import { useFoldImportOrderUi } from '../orders/foldImportOrderUi';
import { useFoldImportUiStore } from '../io/foldImportUiStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trackFoldChoiceOffered, trackFoldStepAdded } from '../../analytics';
import type { FoldStepAddedOpKind, FoldStepVertexForm } from '../../analytics';
import { readHeldModifiers } from '../../keyboard/heldModifiers';
import type { TurnKind } from '../../lib/steps/turn';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { shownFoldSequence } from '../../store/workspaceStore/foldState';
import {
  isLockedStep,
  isSwivelEdgeOp,
  isSwivelOnFoldOp,
  isSwivelValleyMountainOp,
  isVertexOp,
  randomFoldId,
  swivelKindOf,
  type FoldCrimpOp,
  type FoldDirection,
  type FoldMark,
  type FoldMarkEntry,
  type FoldOp,
  type FoldPlainOp,
  type FoldPrecreaseOp,
  type FoldReverseOp,
  type FoldSequenceDocument,
  type FoldSinkOp,
  type FoldSwivelKind,
  type FoldTuckOp,
} from '../document/foldSequenceDocument';
import type { FoldReverseKind } from '../engine/foldEngineReverseWire';
import type { FoldSinkKind } from '../engine/foldEngineSinkWire';
import type { FoldFlap, FoldModelPoint } from '../engine/foldEngineWire';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { sameFlap, wovenIntervalAt } from '../tools/crossSection';
import {
  isLineTool,
  isVertexTool,
  type FoldLineModeId,
  type FoldSecondLineModeId,
  type FoldToolId,
} from '../tools/foldToolCatalog';
import { nextStep } from '../tools/foldToolRegistry';
import { steppedTuckTarget } from '../tools/tuck/tuckStep';
import { rotationBucket } from '../tools/rotate/rotateTool';
import type { FoldUseLineFix } from '../tools/refusalNotice';
import { defaultMovingSign, freeLineThrough, freePicksAlong, movingPoint } from '../tools/foldStepBuilder';
import {
  flapSeed,
  foldToolInput,
  foldToolInputKey,
  isLocated,
  locatesTakenLine,
  picksAlongLine,
  type FoldTools,
  type FoldToolState,
} from '../tools/foldToolState';
import { extentClicks, nextExtentMode, type FoldExtentMode } from '../tools/precrease/precreaseExtent';
import {
  fanGiven,
  fanHasNoFourth,
  fanHingeRegion,
  nearestDirection,
  parallelSegments,
  petalHingeClicks,
  petalRegionKey,
  picksFanHinge,
  picksPetalRegion,
  picksSwivelPivot,
  squashTargetToward,
  steppedFourth,
  swivelEdgePick,
} from '../tools/vertex/vertexStep';
import { SWIVEL_TARGET_FROM, type FoldSquashHinge, type FoldSwivelInput } from '../tools/vertex/vertexInputs';
import { swivelOffered, swivelReachesNothing, type FoldSwivelReachView } from '../tools/vertex/swivelReach';
import type { FoldLineBy } from '../tools/foldToolCatalog';
import { isFoldAltLatched } from './foldAltLatch';
import { resolveAlongPick } from './foldAlongLine';
import { repeatHit } from '../repeat/repeatDrawn';
import { toPair, transformLine } from './foldCanvasGeometry';
import {
  resolveFoldEdgePoint,
  resolveFoldPick,
  topSheetPointAt,
  type FoldHit,
  type FoldPick,
  type FoldPickRule,
  type FoldHitRadii,
  type FoldPaneId,
  type FoldPickIndex,
  type FoldPointPick,
  type FoldSegmentPick,
} from './foldPicking';
import type { FoldToolPreview } from './useFoldToolPreview';
import type { FoldStateView } from './useFoldStateView';
import { swivelMeetingPick, swivelMeetings } from './vertex/swivelMeeting';

/** A free point: Alt held, or on a touch screen its latch. */
export function freePointHeld(): boolean {
  return readHeldModifiers().alt || isFoldAltLatched();
}

/**
 * A fold along a located line, whose line a near miss's landmark line — or a
 * tilted open sink's square line — can take the place of: a crimp's first
 * line among them.
 */
function isAlongLine(
  op: FoldOp | undefined
): op is FoldPlainOp | FoldPrecreaseOp | FoldReverseOp | FoldCrimpOp | FoldTuckOp | FoldSinkOp {
  return (
    op?.kind === 'valley' ||
    op?.kind === 'mountain' ||
    op?.kind === 'precrease' ||
    op?.kind === 'inside-reverse' ||
    op?.kind === 'outside-reverse' ||
    op?.kind === 'crimp' || op?.kind === 'pleat' ||
    op?.kind === 'tuck' ||
    op?.kind === 'open-sink' ||
    op?.kind === 'closed-sink' ||
    op?.kind === 'unsink'
  );
}

/** Every verb the canvas, its window, its rail and its keys share: one path whichever one presses. */
export interface FoldCanvasVerbs {
  setFreeLineSnap: (enabled: boolean) => void;
  selectTool: (id: FoldToolId) => void;
  selectLineMode: (id: FoldLineModeId, line?: 'first') => void;
  /** Add a turn as a step of its own, after the step on screen. */
  turn: (turn: TurnKind) => void;
  /** What a click at a point of a pane takes, for the tool's next click. */
  hitTest: (pane: FoldPaneId, at: { x: number; y: number }, radii: FoldHitRadii) => FoldHit | null;
  /** A click landed on a pane. */
  pick: (hit: FoldHit | null) => void;
  /** Fold the other side; whether there was a located line to swap the side of. */
  swapSide: () => boolean;
  toggleFlap: (flap: number) => void;
  hoverFlap: (flap: number | null) => void;
  includeFlaps: (flaps: readonly number[]) => void;
  foldOtherWay: () => void;
  pickFlap: (flap: FoldFlap) => void;
  useLine: (fix: FoldUseLineFix) => void;
  /**
   * Step through the choice the canvas's chooser shows (`foldCanvasChoice`):
   * the layer orders, the ways the tip opens, or the axiom's roots; whether
   * there was more than one to step through.
   */
  stepChoice: (delta: number) => boolean;
  choosingOrder?: () => boolean;
  /**
   * Commit the fold previewed; whether there was one to commit. Pressed while
   * the preview is still landing, it commits once it lands (or lets go if it
   * is refused), and says so.
   */
  commit: () => boolean;
  acceptOrder?: () => boolean;
  /** Escape's rung: let go of what the tool holds; whether it held anything. */
  cancel: () => boolean;
  /** Clear the Divide-line marks made on the step on screen. */
  clearMarks: () => void;
  // A compound fold's choices, one block per family.
  /** The reverse fold's kind, and a crimp's. */
  setReverseKind: (kind: FoldReverseKind | null) => void;
  /** Step through the ways the tip opens, and the layer orders listed. */
  stepOpening: (delta: number) => void;
  stepOrder: (delta: number) => void;
  /** How a crimp's second line is located. */
  setSecondLineMode: (mode: FoldSecondLineModeId) => void;
  /** A tuck's direction. */
  setTuckDirection: (direction: FoldDirection) => void;
  /** Step through the layers listed to tuck against. */
  stepTuckTarget: (delta: number) => void;
  toggleTuckPinned: (face: number) => void;
  /** Tuck against this listed layer instead: a refusal's `tuck_target` fix. */
  tuckTarget: (face: number) => void;
  // The vertex folds (`tools/vertex`), and what their refusals' buttons do.
  setVertexDirection: (direction: FoldDirection) => void;
  /** How a swivel is constructed: by its edge onto a line, or by its valley and mountain. */
  setSwivelInput: (mode: FoldSwivelInput) => void;
  /** A squash's hinge: the folded edge, or a line drawn. */
  setSquashHinge: (hinge: FoldSquashHinge) => void;
  /** A swivel on a folded edge's kind: its strip on top, or tucked between the layers. */
  setSwivelKind: (kind: FoldSwivelKind) => void;
  /** The same vertex fold, the other direction. */
  vertexOtherWay: () => void;
  /** Step through a fan's fourth-ray candidates; take one by its direction (a fix's). */
  stepEmergent: (delta: number) => void;
  takeEmergent: (direction: FoldModelPoint) => void;
  /** Step through how many layers at a fan's center are cut. */
  stepFanLayers: (delta: number) => void;
  /** Put a squash's spine back onto its hinge line. */
  resetSquashTarget: () => void;
  /** Name a petal fold's hinge, or a swivel's target, by a crease or by two points. */
  setVertexLineBy: (lineBy: FoldLineBy) => void;
  /** Precrease a petal fold's hinge, or its kite, first: the Precrease tool through the hinge's ends, or on the edge-to-edge axiom. */
  precreaseLine: () => void;
  precreaseKite: () => void;
  /** A petal fold over a hinge crease whose kite is not creased: the same hinge by its ends, so the fold creases the kite. */
  petalByEnds: () => void;
  /** The sinks: the other kind of sink (its tool taken in hand, the line kept), and a closed sink's pockets. */
  otherSink: (kind: FoldSinkKind) => void;
  stepPocket: (delta: number) => void;
  // A precrease's extent (`tools/precrease`), and what its refusals' buttons do.
  /** Crease this much of the line. */
  setExtent: (extent: FoldExtentMode) => void;
  /** The extent after the one chosen, with the Precrease tool in hand; whether it was in hand. */
  cycleExtent: () => boolean;
  /** Crease the whole line instead of part of it. */
  useWholeLine: () => void;
  /** A segment too short to crease, as a pinch at its first point instead. */
  pinchInstead: () => void;
  /** Mark through every layer at the line, not the ones picked. */
  throughAllLayers: () => void;
  /** A point that stays put, swapped for the one at its spot on paper that folds (`FoldToolPreview.moverFix`). */
  useMovingPoint: () => void;
  /** A reverse fold with only the flaps its drawn line crosses, opened the way that lands (`FoldToolPreview.seedFix`). */
  useNarrowerSeed: () => void;
}

/** The verbs, and whether a commit waits for the preview to land. */
export interface FoldCanvasVerbBinding {
  verbs: FoldCanvasVerbs;
  /** Enter was pressed before the preview landed: it commits once it has. */
  queued: boolean;
}

/**
 * What a commit asked for before the preview landed does now — asked for the
 * tools' input then (`queued`, `foldToolInputKey`), with `input` theirs now:
 * nothing queued; wait while that input's step is still being built (a
 * reverse fold's tip or an axiom's roots still being asked about) or is
 * landing; review ambiguous orders, otherwise commit once landed; drop it
 * when it was refused, the input
 * changed, or nothing can be committed — a fan none of whose fourth creases
 * lands among them.
 */
export function queuedCommit(
  queued: string | null,
  preview: Pick<FoldToolPreview, 'step' | 'refused' | 'landing'> & Partial<Pick<FoldToolPreview, 'vertex' | 'orderResolution' | 'held'>>,
  readOnly: boolean,
  input: string
): 'idle' | 'wait' | 'review' | 'commit' | 'drop' {
  if (queued === null) return 'idle';
  const { step, landing } = preview;
  // A refusal held over from the last seed (`foldShownPreview`) is not this step's.
  const refused = preview.held ? null : preview.refused;
  if (input !== queued || readOnly) return 'drop';
  const resolution = preview.orderResolution;
  if (resolution && (resolution.inputKey !== input || resolution.waiting)) return 'wait';
  if (resolution?.required) return 'review';
  if (resolution?.failed || refused || fanHasNoFourth(preview.vertex?.base ?? null)) return 'drop';
  return !step || landing ? 'wait' : 'commit';
}

/** Which of the previewed fold's choices the canvas's chooser shows, and of how many: the one a folder makes last. */
export type FoldCanvasChoice = {
  kind: 'order' | 'opening' | 'target' | 'pocket' | 'root' | FoldVertexCanvasChoiceKind;
  index: number;
  count: number;
};

/** A vertex fold's choice the chooser steps through, beside its order: a rabbit ear's fourth ray, a swivel's ridge. */
export type FoldVertexCanvasChoiceKind = 'emergent' | 'ridge';

/**
 * What the compound fold in hand lists to choose from: the ways a reverse
 * fold's or a crimp's tip opens, the orders any of them leaves — a sink's
 * too — and the layers a tuck can go against. None for a plain fold.
 */
export function compoundListed(preview: Pick<FoldToolPreview, 'reverse' | 'crimp' | 'tuck' | 'sink'>): {
  ways: number;
  orders: number;
  targets: number;
} {
  const opens = preview.reverse ?? preview.crimp;
  return {
    ways: opens?.ways.length ?? 0,
    orders: (opens ?? preview.tuck)?.orders.length ?? preview.sink?.orders ?? 0,
    targets: preview.tuck?.targets.length ?? 0,
  };
}

/**
 * A vertex fold's deepest choice with more than one answer — its layer
 * order, then a fan's fourth ray — since the fourth ray lists the orders
 * anew. Null when none has more than one, or for any other tool.
 */
function vertexCanvasChoice(preview: FoldToolPreview): FoldCanvasChoice | null {
  const vertex = preview.vertex;
  if (!vertex) return null;
  const { orders, order, emergent, fourths } = vertex;
  if (!preview.orderResolution && orders.length > 1) return { kind: 'order', index: Math.max(0, order ? orders.indexOf(order) : 0), count: orders.length };
  if (vertex.base?.analysis.kind === 'rabbit-ear') return null;
  // Only the fourth creases — a swivel's ridges — that land, numbered among themselves.
  const at = emergent === null ? -1 : fourths.indexOf(emergent);
  const kind = vertex.base?.analysis.kind === 'swivel-by-edge' ? 'ridge' : 'emergent';
  return fourths.length > 1 && at >= 0 ? { kind, index: at, count: fourths.length } : null;
}

/**
 * The chooser on the canvas: the deepest choice with more than one answer —
 * the layer order, then the way the tip opens, the layer a tuck goes
 * against or the pocket a point sinks into (a vertex fold's fourth ray),
 * then the axiom's root — since each earlier choice resets the ones
 * after it. Null when none has more than one.
 */
export function foldCanvasChoice(preview: FoldToolPreview, tools: FoldToolState): FoldCanvasChoice | null {
  const vertex = vertexCanvasChoice(preview);
  if (vertex) return vertex;
  const { ways, orders, targets } = compoundListed(preview);
  if (!preview.orderResolution && orders > 1) return { kind: 'order', index: Math.min(tools.compound.order, orders - 1), count: orders };
  if (ways > 1) return { kind: 'opening', index: Math.min(tools.compound.opening, ways - 1), count: ways };
  const tuck = preview.tuck;
  if (tuck && targets > 1) {
    const at = tuck.targets.findIndex((target) => target.face === tuck.target?.face);
    return { kind: 'target', index: Math.max(0, at), count: targets };
  }
  const sink = preview.sink;
  if (sink && sink.pockets.length > 1) {
    return { kind: 'pocket', index: Math.min(tools.compound.pocket, sink.pockets.length - 1), count: sink.pockets.length };
  }
  const roots = preview.candidates?.length ?? 0;
  return roots > 1 ? { kind: 'root', index: Math.min(preview.rootLine === 'second' ? tools.secondRoot ?? 0 : tools.root, roots - 1), count: roots } : null;
}

/** What a committed op is called in `fold step added`; null for Import CP, which the canvas does not commit. */
function opKindOf(op: FoldOp): FoldStepAddedOpKind | null {
  switch (op.kind) {
    case 'repeat':
    case 'unfold-to':
    case 'cp-jump':
      return null;
    // Compound folds, snake_case as the event's enums are.
    case 'inside-reverse':
      return 'inside_reverse';
    case 'outside-reverse':
      return 'outside_reverse';
    case 'rabbit-ear':
      return 'rabbit_ear';
    case 'open-sink':
      return 'open_sink';
    case 'closed-sink':
      return 'closed_sink';
    default:
      return op.kind;
  }
}

/**
 * How a vertex fold named what it takes, as `fold step added` counts it: a
 * petal fold's hinge, a swivel's form and target, and on a folded edge its
 * kind.
 */
function vertexFormOf(op: FoldOp): FoldStepVertexForm | undefined {
  if (op.kind === 'petal') return { hinge: 'ends' in op ? 'points' : 'crease' };
  if (op.kind === 'squash') return { squashHinge: op.hinge ? 'line' : 'folded' };
  if (op.kind !== 'swivel') return undefined;
  if (isSwivelValleyMountainOp(op)) return { swivelForm: 'valley_mountain', swivelKind: swivelKindOf(op) };
  if (!isSwivelEdgeOp(op)) return { swivelForm: 'rays' };
  if (isSwivelOnFoldOp(op)) return { swivelForm: 'fold', target: op.target.via, swivelKind: swivelKindOf(op) };
  return { swivelForm: 'edge', target: op.target.via };
}

/**
 * `defaulted`: the tools' seed was still the default top flap when the step
 * was committed, so a flaps seed is the top flap taken by default, not
 * flaps the folder picked (`layer_scope: top`).
 */
function trackCommitted(op: FoldOp, defaulted: boolean): void {
  const kind = opKindOf(op);
  if (!kind) return;
  // A rotation says how far it turned, bucketed: a preset, or `other` for an exact angle.
  if (op.kind === 'rotate') {
    trackFoldStepAdded(kind, { amount: rotationBucket(op.rotate) });
    return;
  }
  // A vertex fold takes no line and no layer scope of a plain fold's: how it named its own lines instead.
  if (isVertexOp(op)) {
    const vertex = vertexFormOf(op);
    trackFoldStepAdded(kind, vertex ? { vertex } : undefined);
    return;
  }
  if (op.kind === 'turn' || op.kind === 'cp-jump' || op.kind === 'unfold-to' || op.kind === 'repeat') {
    trackFoldStepAdded(kind);
    return;
  }
  const via = 'line' in op ? op.line.via : 'crease';
  // A precrease says how much of its line it creased.
  const extent = op.kind === 'precrease' ? (op.extent?.kind ?? 'whole') : null;
  const layerScope = defaulted && op.seed.scope === 'flaps' ? 'top' : op.seed.scope;
  trackFoldStepAdded(kind, {
    layerScope,
    via,
    ...(extent ? { extent } : {}),
    ...(op.kind === 'tuck' ? { targetCount: 1 + (op.additionalTargets?.length ?? 0) } : {}),
    ...((op.kind === 'valley' || op.kind === 'mountain') && op.landing?.kind === 'against' ? { targetCount: op.landing.targets.length } : {}),
  });
}

/** A swivel's meeting point, clicked again: its first click's rule (`vertexInputs`). */
const SWIVEL_MEET_RULE = { snap: 'point', edges: true } as const;

/**
 * What a swivel's next line click may take: once its reach is known, only
 * an edge that can swing, then only a line that edge lands on — nothing
 * while the worker is asked (`swivelOffered`). Without a reach — a target
 * named by two points — any line but one parallel to the edge, which no
 * turn lays it on. Nothing to add for any other tool.
 */
function swivelOffer(tool: FoldToolState, reach: FoldSwivelReachView | null): Pick<FoldPickRule, 'accept'> {
  if (tool.tool !== 'swivel' || tool.swivelInput === 'valley-mountain') return {};
  const offered = swivelOffered(reach, tool.picks);
  if (offered) return { accept: (segment: FoldSegmentPick) => offered(segment.edge) };
  const edge = swivelEdgePick(tool);
  if (!edge || tool.picks.length !== SWIVEL_TARGET_FROM) return {};
  return { accept: (segment: FoldSegmentPick) => !parallelSegments(segment.scene, edge.scene) };
}

/** Within this many sheet units, a second depth pick is the same spot, and goes a layer deeper. */
const SAME_SPOT = 1e-3;

/**
 * The marks made on a step — the sheet's own for null — every entry kept,
 * a newer build's among them: what a mark is added after, and a clear empties.
 */
export function marksMadeAt(sequence: FoldSequenceDocument | null, id: string | null): readonly FoldMarkEntry[] {
  if (!sequence) return [];
  if (id === null) return sequence.sheetMarks ?? [];
  const node = sequence.steps.find((step) => step.id === id);
  return node && !isLockedStep(node) ? (node.marks ?? []) : [];
}

/**
 * The verbs the Fold canvas offers, bound to the session, the tools and the
 * fold previewed. Stable for the canvas's life: each reads what it needs
 * when it runs, so a key press, a button and a click are one path.
 *
 * `picking` is the index the panes are hit-tested through: the view's own,
 * or the spread folded pane's (`useFoldPaneSpread`), which finds the paper
 * where it is drawn. The view's by default.
 */
export function useFoldCanvasVerbs(
  session: FoldSessionSurface,
  tools: FoldTools,
  view: FoldStateView,
  preview: FoldToolPreview,
  picking?: FoldPickIndex | null
): FoldCanvasVerbBinding {
  const live = useRef({ session, view, preview, picking });
  // Before any handler can run: effects land ahead of the next event.
  useEffect(() => {
    live.current = { session, view, preview, picking };
  });
  // What was picked was picked on the step on screen: another step — an
  // undo, a redo, a step chosen in the strip — starts the tool over. (A
  // commit has already let go of it.)
  const cursorId = session.cursorId;
  useEffect(() => {
    tools.clear();
  }, [tools, cursorId]);

  const committing = useRef(false);
  const commitOp = useCallback(
    (op: FoldOp, choices?: Parameters<FoldSessionSurface['commitStep']>[1]) => {
      if (useFoldImportOrderUi.getState().choosing) return;
      committing.current = true;
      const defaulted = tools.store.getState().seed.scope === 'top';
      void live.current.session.commitStep(op, choices).then((outcome) => {
        committing.current = false;
        if (outcome.status !== 'committed') return;
        trackCommitted(op, defaulted);
        tools.clear();
        // A rotation applied puts Rotate down, as Turn over is done at once:
        // left in hand, it would preview another turn on the step just made.
        if (op.kind === 'rotate') tools.putDown();
      }, (error: unknown) => {
        committing.current = false;
        reportError(error, { surface: 'fold:commit' });
      });
    },
    [tools]
  );

  // A commit asked for before the preview landed, by the tools' input it was
  // asked for: committed when that input's step lands, let go when it is
  // refused or the input changes. Never dropped without a word: the window
  // says it waits.
  const [queued, setQueued] = useState<string | null>(null);
  useEffect(() => {
    const now = queuedCommit(queued, preview, session.readOnly, foldToolInputKey(tools.store.getState()));
    if (now === 'idle' || now === 'wait') return;
    setQueued(null);
    if (now === 'review') preview.orderResolution?.resume();
    if (now === 'commit' && preview.step) commitOp(preview.step.op, preview.step.choices);
  }, [queued, preview, session.readOnly, commitOp, tools]);

  const verbs = useMemo<FoldCanvasVerbs>(() => {
    const state = () => tools.store.getState();

    /** A click on the folded paper while a fold is previewed: the stack there, one layer deeper each time. */
    const pickDepth = (at: { x: number; y: number }) => {
      const { view: shown, preview: previewed, session: current } = live.current;
      const step = previewed.step;
      const index = shown.index;
      if (!step || !index || step.op.kind === 'turn' || step.op.kind === 'rotate' || step.op.kind === 'cp-jump' || step.op.kind === 'unfold-to' || step.op.kind === 'repeat') return;
      const sheet = topSheetPointAt(index, at);
      if (!sheet) return;
      const seed = state().seed;
      const again =
        seed.scope === 'depth' && Math.hypot(seed.at[0] - sheet[0], seed.at[1] - sheet[1]) <= SAME_SPOT;
      const asked = again && seed.scope === 'depth' ? seed.at : sheet;
      void current.withCursor((engine, handle) => engine.depthChoices(handle, step.op, asked, step.choices)).then(
        (answer) => {
          if (answer.status !== 'answered' || answer.value.status !== 'ok') return;
          const { choices } = answer.value;
          if (choices.length === 0) return;
          if (!again && choices.length > 1) trackFoldChoiceOffered('depth', choices.length);
          const now = state().seed;
          const position = now.scope === 'depth' && again ? choices.findIndex((choice) => choice.layers === now.choice) : -1;
          const next = choices[(position + 1) % choices.length]!;
          tools.setSeed({ scope: 'depth', at: asked, scene: { x: at.x, y: at.y }, choice: next.layers });
        }
      );
    };

    /** A click on the folded paper while a squash is previewed: its spine lands toward the point, from its vertex. */
    const aimSquash = (at: { x: number; y: number }) => {
      const { view: shown, preview: previewed } = live.current;
      const analysis = previewed.vertex?.base?.analysis;
      if (!shown.index || analysis?.kind !== 'squash') return;
      const target = squashTargetToward(analysis.vertex, toPair(shown.index.toModel(at)));
      if (target) tools.setSquashTarget(target);
    };

    /** A fan's hinge region, clicked again while its fold is previewed: taken when it is another region. */
    const repickHinge = (pick: FoldPick) => {
      const now = state();
      const tool = now.tool;
      if (!isVertexTool(tool)) return;
      const fan = fanGiven({ tool, picks: now.picks });
      const region = (picks: readonly FoldPick[]) => (fan ? fanHingeRegion({ tool, picks }, fan) : null);
      const next = region([...now.picks.slice(0, -1), pick]);
      if (next === null || next === region(now.picks)) return;
      tools.repick(pick);
    };

    /** A petal fold's flap, clicked again while its fold is previewed: taken when it is other paper below the hinge. */
    const repetal = (pick: FoldPick) => {
      const now = state();
      const index = live.current.view.index;
      const last = now.picks.at(-1);
      if (!index || pick.kind !== 'free' || last?.kind !== 'free') return;
      const intent = { petalHinge: now.petalHinge, picks: now.picks, direction: now.vertexDirection };
      const next = petalRegionKey(index, intent, pick.scene);
      if (next === null || next === petalRegionKey(index, intent, last.scene)) return;
      tools.repick(pick);
    };

    /** Step a fan's fourth crease through the ones that land, the only ones offered. */
    const stepFourth = (delta: number) => {
      const vertex = live.current.preview.vertex;
      const next = steppedFourth(vertex?.fourths ?? [], vertex?.emergent ?? null, delta);
      if (next !== null) tools.setEmergent(next);
    };

    /** A vertex fold the other way round, as its direction control turns it. */
    const vertexOtherWay = () => {
      const now = state();
      tools.setVertexDirection(now.vertexDirection === 'valley' ? 'mountain' : 'valley');
    };

    /** A petal fold's hinge clicks, and the flap clicked after them. */
    const petalPicks = () => {
      const now = state();
      const clicks = petalHingeClicks(now);
      return { hinge: now.picks.slice(0, clicks), flap: now.picks[clicks] };
    };

    /**
     * The hinge's two ends as points to click: the ends clicked, or a hinge
     * crease's ends, where the folded form puts them. Null before the hinge
     * is named.
     */
    const hingeEnds = (): [FoldPointPick, FoldPointPick] | null => {
      const { hinge } = petalPicks();
      const [first, second] = hinge;
      if (first?.kind === 'segment') {
        const end = (k: 0 | 1): FoldPointPick => ({
          kind: 'point',
          provenance: 'vertex',
          sheet: first.sheet[k],
          mark: null,
          scene: first.scene[k],
        });
        return [end(0), end(1)];
      }
      return first?.kind === 'point' && second?.kind === 'point' ? [first, second] : null;
    };

    return {
      selectTool: tools.selectTool,
      selectLineMode: tools.selectLineMode,

      turn: (turn) => {
        const op: FoldOp = turn.kind === 'turn-over' ? { kind: 'turn', axis: turn.axis } : { kind: 'rotate', rotate: turn.rotate };
        tools.clear();
        commitOp(op);
      },

      hitTest: (pane, at, radii) => {
        const { view: shown, picking: drawn } = live.current;
        const index = drawn === undefined ? shown.index : drawn;
        if (!index) return null;
        const tool = state();
        // Repeat: its axes, drawn on both panes, and an axis of the folder's
        // own located with the line modes, while one may be taken.
        if (tool.tool === 'repeat') return repeatHit(index, pane, at, radii, tool, live.current.preview.repeat ?? null, freePointHeld());
        // A fan's hinge region, or a petal fold's flap, picked or picked
        // again: the paper under the pointer, whose region the panes light —
        // off it, nothing.
        if (picksFanHinge(tool.tool, tool.picks.length) || picksPetalRegion(tool.tool, tool.petalHinge, tool.picks.length)) {
          const pick = resolveFoldPick(index, pane, at, radii, { snap: 'free', edges: false, free: false });
          return { pane, at, pick: pick?.kind === 'free' && pick.sheet ? pick : null };
        }
        const model = foldToolInput(tool);
        const step = model ? nextStep(model, tool.picks.length) : null;
        // Located: a click on the paper picks layers, so what is under the
        // pointer is the paper itself, never a reference — and over a woven
        // section, which of its stacks the layer picker shows. A precrease of
        // part of its line takes its points along the line first: near the
        // line, the point of it under the pointer.
        if (!step) {
          if (picksAlongLine(tool) && shown.index) {
            const along = live.current.preview.extent?.along;
            const line = pane === 'folded' ? along?.folded : along?.creasePattern;
            const pick = line ? resolveAlongPick(shown.index, line, at, radii, freePointHeld()) : null;
            if (pick) return { pane, at, pick };
          }
          const interval = pane === 'folded' ? wovenIntervalAt(live.current.preview.section, at) : null;
          return interval === null ? { pane, at, pick: null } : { pane, at, pick: null, interval };
        }
        const free = freePointHeld();
        // A swivel's mountain runs from where its valley meets a folded
        // edge: near there, a point the mountain's line takes is that point
        // exactly, unless a free point is asked for, or a free line's end
        // snaps to nothing.
        const valley = tool.tool === 'swivel' ? tool.takenLine : undefined;
        const snaps = !free && (step.snap !== 'free' || (step.snapFree === true && tool.freeLineSnap));
        const meeting = valley && snaps ? swivelMeetingPick(swivelMeetings(index, valley.sceneLine), pane, at, radii.point, step.snap) : null;
        if (meeting) return { pane, at, pick: meeting };
        // A swivel's meeting point from which nothing can swing: a click
        // picks another point in its place, as its first click would.
        const reach = live.current.preview.vertex?.reach ?? null;
        const byEdge = tool.swivelInput !== 'valley-mountain';
        const remeet = tool.tool === 'swivel' && byEdge && tool.picks.length === 1 && swivelReachesNothing(reach);
        const pick = resolveFoldPick(index, pane, at, radii, {
          ...(remeet ? SWIVEL_MEET_RULE : { snap: step.snap, edges: step.edges, ...(step.kinds ? { kinds: step.kinds } : {}) }),
          free,
          snapFree: step.snapFree && tool.freeLineSnap,
          ...(remeet ? {} : swivelOffer(tool, reach)),
        });
        // A swivel's pivot may sit on a folded edge, where its creases meet:
        // the edge lights under the pointer. With the free-point key held
        // too — the engine finds where along it they meet, so a point placed
        // freely there would only make a pivot through every layer, which
        // no folder means on a folded edge (owner feedback, 2026-10-13).
        // By its valley and mountain, a swivel takes the line modes' picks instead.
        if ((byEdge && picksSwivelPivot(tool.tool, tool.picks.length)) || remeet) {
          const onFold = free ? resolveFoldEdgePoint(index, pane, at, radii, null) : null;
          return { pane, at, pick: onFold ?? (free ? pick : resolveFoldEdgePoint(index, pane, at, radii, pick)) };
        }
        return { pane, at, pick };
      },

      pick: (hit) => {
        // Nothing can be folded or marked on a newer build's sequence, or from a step locked behind one.
        if (!hit || live.current.session.readOnly || live.current.session.cursor.status === 'locked') return;
        const tool = state();
        if (tool.tool === 'repeat') {
          const repeat = live.current.preview.repeat;
          if (!repeat?.view.drawing) return;
          // An axis drawn on the paper: taken.
          if (!hit.pick && hit.repeatAxis !== undefined) {
            repeat.verbs.setAxis(hit.repeatAxis);
            return;
          }
          if (!hit.pick) return;
          // A line drawn and refused: the next click starts another.
          if (isLocated(tool)) tools.clear();
          tools.pick(hit.pick);
          return;
        }
        if (isLocated(tool)) {
          if (picksAlongLine(tool)) {
            // A point along the line, for a segment's end or a pinch's centre;
            // while one is still to come, a click beside the line picks nothing.
            if (hit.pick?.kind === 'point') {
              tools.pickAlong(hit.pick);
              return;
            }
            if (tool.extentPicks.length < extentClicks(tool.extent)) return;
          }
          if (hit.pane === 'folded' && isLineTool(tool.tool)) pickDepth(hit.at);
          // A squash's spine lands toward the point clicked on the folded paper.
          else if (hit.pane === 'folded' && tool.tool === 'squash') aimSquash(hit.at);
          // A fan's hinge region, picked again in another region, on either pane.
          else if (hit.pick && picksFanHinge(tool.tool, tool.picks.length)) repickHinge(hit.pick);
          // A petal fold's flap, picked again below the hinge, on either pane.
          else if (hit.pick && picksPetalRegion(tool.tool, tool.petalHinge, tool.picks.length)) repetal(hit.pick);
          return;
        }
        if (!hit.pick) return;
        // A swivel's meeting point from which nothing can swing: the point clicked takes its place.
        if (
          tool.tool === 'swivel' &&
          tool.picks.length === 1 &&
          hit.pick.kind === 'point' &&
          swivelReachesNothing(live.current.preview.vertex?.reach ?? null)
        ) {
          tools.repick(hit.pick);
          return;
        }
        tools.pick(hit.pick);
        if (tool.tool !== 'divide-line') return;
        // The Divide line takes one click: the mark is made at once.
        const segment = hit.pick;
        if (segment.kind !== 'segment') {
          tools.clear();
          return;
        }
        const { divide } = state();
        const mark: FoldMark = {
          id: randomFoldId('fmark'),
          from: segment.sheet[0],
          to: segment.sheet[1],
          divide: divide.mode === 'count' ? { mode: 'count', parts: divide.parts } : { mode: 'ratio', ratio: divide.ratio },
        };
        const cursor = live.current.session.cursorId;
        const store = useWorkspaceStore.getState();
        // On the step it was made on — the sheet's own list for the flat
        // sheet — after the marks already there: one undo entry (plan D6).
        if (store.setFoldMarks(cursor, [...marksMadeAt(shownFoldSequence(store)?.document ?? null, cursor), mark])) {
          trackFoldMarkAdded(divide.mode);
        }
        tools.clear();
      },

      swapSide: tools.swapSide,

      toggleFlap: (flap) => {
        const section = live.current.preview.section;
        const target = section?.flaps[flap];
        if (!section || !target) return;
        tools.toggleFlap(target, section.flaps, live.current.preview.seed);
      },

      hoverFlap: tools.setHoveredFlap,

      includeFlaps: (flaps) => {
        const analysis = live.current.preview.analysis;
        const section = live.current.preview.section;
        if (!analysis) return;
        // The fix's flaps join what the seed picked, never replace it: the
        // flaps picked, or — for the default top flap, or a stack picked by
        // depth, which a reverse fold's tip grows into whole flaps — the
        // flaps the analysis says it named.
        const seed = state().seed;
        const picked: FoldFlap[] =
          seed.scope === 'flaps'
            ? [...seed.flaps]
            : analysis.picked.flatMap((index) => analysis.flaps[index] ?? []);
        for (const flap of flaps) {
          const named = analysis.flaps[flap];
          if (named && !picked.some((each) => sameFlap(each, named))) picked.push(named);
        }
        tools.setSeed(flapSeed(picked, section?.flaps ?? analysis.flaps));
      },

      foldOtherWay: () => {
        const tool = state();
        if (tool.tool === 'valley') tools.selectTool('mountain');
        else if (tool.tool === 'mountain') tools.selectTool('valley');
        else if (tool.tool === 'precrease') tools.setPrecreaseDirection(tool.precreaseDirection === 'valley' ? 'mountain' : 'valley');
        else if (tool.tool === 'tuck') tools.setTuckDirection(tool.tuckDirection === 'valley' ? 'mountain' : 'valley');
        else if (isVertexTool(tool.tool)) vertexOtherWay();
      },

      setReverseKind: (kind) => tools.setReverseKind(kind),

      stepOpening: (delta) => tools.stepOpening(delta, compoundListed(live.current.preview).ways),

      // The layer orders the compound fold previewed lists: a reverse fold's,
      // a crimp's, a tuck's, a sink's or a vertex fold's.
      stepOrder: (delta) => {
        const resolution = live.current.preview.orderResolution;
        if (resolution?.active) resolution.step(delta);
        else if (!resolution) tools.stepOrder(delta, compoundListed(live.current.preview).orders || (live.current.preview.vertex?.orders.length ?? 0));
      },

      setSecondLineMode: (mode) => tools.setSecondLineMode(mode),

      setTuckDirection: (direction) => tools.setTuckDirection(direction),

      stepTuckTarget: (delta) => {
        const tuck = live.current.preview.tuck;
        if (!tuck || tuck.targets.length <= 1) return;
        tools.setTuckTarget(steppedTuckTarget(tuck.targets, tuck.target?.face ?? null, delta));
      },

      tuckTarget: (face) => tools.setTuckTarget(face),
      toggleTuckPinned: (face) => tools.toggleTuckPinned(face),

      // The vertex folds' choices, and what their refusals' buttons do.
      setVertexDirection: (direction) => tools.setVertexDirection(direction),

      setSwivelInput: tools.setSwivelInput,
      setSquashHinge: tools.setSquashHinge,
      setSwivelKind: (kind) => tools.setSwivelKind(kind),

      vertexOtherWay,

      stepEmergent: (delta) => stepFourth(delta),

      takeEmergent: (direction) => {
        const analysis = live.current.preview.vertex?.base?.analysis;
        // A fan's fourth ray, or a swivel's ridge: the one the direction names.
        const listed =
          analysis?.kind === 'swivel-by-edge'
            ? analysis.ridges
            : analysis?.kind === 'rabbit-ear' || analysis?.kind === 'swivel'
              ? analysis.candidates
              : null;
        const k = listed ? nearestDirection(listed, direction) : null;
        if (k !== null) tools.setEmergent(k);
      },

      stepFanLayers: (delta) => {
        const layers = live.current.preview.vertex?.layers ?? 0;
        if (layers <= 1) return;
        const now = state().compound.fanLayers ?? layers;
        const next = ((((now - 1 + delta) % layers) + layers) % layers) + 1;
        tools.setFanLayers(next >= layers ? null : next);
      },

      resetSquashTarget: () => tools.setSquashTarget(null),

      setVertexLineBy: (lineBy) => {
        const now = state();
        if (now.tool === 'petal') tools.setPetalHinge(lineBy);
        else if (now.tool === 'swivel') tools.setSwivelTarget(lineBy);
      },

      precreaseLine: () => {
        const ends = hingeEnds();
        // Precrease the hinge in the petal fold's direction, through its two ends.
        tools.setPrecreaseDirection(state().vertexDirection);
        tools.selectTool('precrease');
        tools.setExtent('whole');
        tools.selectLineMode('axiom-1');
        for (const pick of ends ?? []) tools.pick(pick);
      },

      precreaseKite: () => {
        // A kite crease folds a side edge onto the centre line: the edge-to-edge axiom.
        tools.setPrecreaseDirection(state().vertexDirection);
        tools.selectTool('precrease');
        tools.setExtent('whole');
        tools.selectLineMode('axiom-3');
      },

      petalByEnds: () => {
        const ends = hingeEnds();
        const { flap } = petalPicks();
        if (!ends) return;
        // The same hinge by its ends, and the flap as it was clicked: the fold creases what is missing.
        tools.setPetalHinge('points');
        for (const pick of [...ends, ...(flap ? [flap] : [])]) tools.pick(pick);
      },

      // The sinks'.
      otherSink: (kind) => tools.selectTool(kind === 'open' ? 'open-sink' : 'closed-sink'),

      stepPocket: (delta) => tools.stepPocket(delta, live.current.preview.sink?.pockets.length ?? 0),

      // A precrease's extent.
      setExtent: (extent) => tools.setExtent(extent),

      cycleExtent: () => {
        const now = state();
        if (now.tool !== 'precrease') return false;
        tools.setExtent(nextExtentMode(now.extent));
        return true;
      },

      useWholeLine: () => tools.setExtent('whole'),

      pinchInstead: () => {
        // The segment's first point is where the pinch goes.
        const [first] = state().extentPicks;
        tools.setExtent('pinch');
        if (first) tools.pickAlong(first);
      },

      setFreeLineSnap: (enabled) => {
        if (state().freeLineSnap === enabled) return;
        tools.setFreeLineSnap(enabled);
        trackFoldFreeLineSnapChanged(enabled);
      },

      throughAllLayers: () => tools.setSeed({ scope: 'all' }),

      useMovingPoint: () => {
        const fix = live.current.preview.moverFix;
        if (fix) tools.swapPoint(fix.from, fix.to);
      },

      useNarrowerSeed: () => {
        const fix = live.current.preview.seedFix;
        if (!fix) return;
        tools.setSeed({ scope: 'flaps', flaps: fix.flaps });
        if (fix.opening > 0) tools.stepOpening(fix.opening, fix.ways);
      },

      pickFlap: (flap) => tools.setSeed({ scope: 'flaps', flaps: [flap] }),

      useLine: (fix) => {
        const { preview: previewed, view: shown } = live.current;
        if (fix.step) {
          tools.setOverride({ op: fix.step.op, choices: fix.step.choices });
          return;
        }
        // A near miss's landmark line: a model line, stored as the free line
        // through it, the same side moving. A compound fold's too: its tool
        // takes the line from the override — a crimp's first line — and
        // keeps choosing the rest along it (`useFoldReverseStep`,
        // `useFoldCrimpStep`, `useFoldTuckStep`); and a tilted open sink's
        // square line, its pocket and order chosen along it
        // (`useFoldSinkStep`).
        const op = previewed.step?.op;
        const index = shown.index;
        if (!index) return;
        const sceneLine = transformLine(index.scene.view_transform, fix.line);
        if (!op) {
          // No step to put it in: an axiom whose roots were refused as a
          // near miss, or a swivel whose edge ends before it would turn (its
          // plain fold along the bisector). The line is located as a free
          // line instead, its side the fix's — a swivel's folded the way it
          // was to fold.
          const picks = freePicksAlong(index, sceneLine);
          if (!picks) return;
          const before = state();
          tools.selectLineMode('free');
          if (isVertexTool(before.tool)) {
            tools.selectTool(before.vertexDirection);
          }
          for (const pick of picks) tools.pick(pick);
          if (defaultMovingSign(index, sceneLine, false) !== (fix.side === 'positive' ? 1 : -1)) tools.swapSide();
          return;
        }
        if (!isAlongLine(op)) return;
        const through = freeLineThrough(index, sceneLine);
        const moving = movingPoint(index, sceneLine, fix.side === 'positive' ? 1 : -1);
        if (!through || !moving) return;
        const { moving: _moving, ...rest } = op;
        const seed = op.seed.scope === 'all' ? { moving: moving.sheet } : {};
        tools.setOverride({ op: { ...rest, line: { via: 'free', through }, ...seed } });
      },

      choosingOrder: () =>
        !!useFoldImportOrderUi.getState().choosing ||
        live.current.preview.orderResolution?.active === true ||
        live.current.preview.repeat?.choosing === true,

      stepChoice: (delta) => {
        const imported = useFoldImportOrderUi.getState();
        if (imported.choosing) {
          const { component, choice, opened } = imported.choosing;
          const part = opened.components[component];
          const count = part?.orders ?? 1;
          const next = (choice[component] ?? 0) + delta;
          imported.flow?.choose(component, part?.truncated ? Math.max(0, Math.min(count - 1, next)) : (next + count) % count);
          return true;
        }
        // A source operation's matching layer orders, while Repeat has one chosen.
        if (state().tool === 'repeat') return live.current.preview.repeat?.stepChoice(delta) ?? false;
        const resolution = live.current.preview.orderResolution;
        if (resolution?.active) { resolution.step(delta); return true; }
        const choice = foldCanvasChoice(live.current.preview, state());
        if (!choice) return false;
        switch (choice.kind) {
          case 'order':
            tools.stepOrder(delta, choice.count);
            break;
          case 'opening':
            tools.stepOpening(delta, choice.count);
            break;
          case 'target': {
            const tuck = live.current.preview.tuck;
            if (tuck) tools.setTuckTarget(steppedTuckTarget(tuck.targets, tuck.target?.face ?? null, delta));
            break;
          }
          case 'pocket':
            tools.stepPocket(delta, choice.count);
            break;
          case 'root':
            tools.stepRoot(delta, choice.count, live.current.preview.rootLine);
            break;
          case 'emergent':
          case 'ridge':
            stepFourth(delta);
            break;
        }
        return true;
      },

      acceptOrder: () => {
        const { preview, session } = live.current;
        const resolution = preview.orderResolution;
        if (!resolution?.active || resolution.waiting || resolution.failed || !preview.step || !preview.landed || preview.landing || preview.refused || session.readOnly || committing.current || resolution.inputKey !== foldToolInputKey(state())) return false;
        setQueued(null);
        trackFoldOrderResolved('accepted', 'tool', resolution.count);
        commitOp(preview.step.op, preview.step.choices);
        return true;
      },
      commit: () => {
        if (useFoldImportOrderUi.getState().choosing) return true;
        const current = state();
        // The sequence tools commit their own steps: Repeat prepares, chooses
        // and saves; Unfold to step adds its step, or rebuilds a saved one.
        if (current.tool === 'repeat') return live.current.preview.repeat?.primary() ?? false;
        if (current.tool === 'unfold-to') return live.current.preview.unfold?.commit() ?? false;
        // A swivel by its valley and mountain, or a squash about a drawn
        // hinge: Enter takes the line located — the valley, or the hinge —
        // and the picks go on to the mountain, or the flap's end.
        if (locatesTakenLine(current) && !current.takenLine) {
          const { locatedLine, refused } = live.current.preview;
          if (!locatedLine || refused || live.current.session.readOnly) return false;
          setQueued(null);
          tools.takeLine(locatedLine);
          return true;
        }
        const resolution = live.current.preview.orderResolution;
        if (live.current.session.readOnly) return false;
        // A confirmation made during search must review its answer if ambiguous.
        if (resolution && (resolution.waiting || resolution.inputKey !== foldToolInputKey(current))) {
          setQueued(foldToolInputKey(current)); return true;
        }
        if (resolution?.required) { setQueued(null); resolution.resume(); return true; }
        if (resolution?.failed) return false;
        const { step, refused, landing, extent, vertex, held } = live.current.preview;
        // A refusal held over from the last seed is not this step's: it waits for its own answer.
        if ((refused && !held) || live.current.session.readOnly) return false;
        // A fan none of whose fourth creases lands: nothing to fold, or to wait for, until another hinge region is picked.
        if (!step && fanHasNoFourth(vertex?.base ?? null)) return false;
        // A partial precrease whose points along the line are still to be clicked has nothing to commit.
        if (extent?.state.status === 'incomplete') return false;
        // Located, its step still being built (a reverse fold's tip, an
        // axiom's roots, being asked about) or still landing: committed once
        // it lands, never silently dropped.
        if (!step ? isLocated(state()) : landing) {
          setQueued(foldToolInputKey(state()));
          return true;
        }
        if (!step) return false;
        commitOp(step.op, step.choices);
        return true;
      },

      cancel: () => {
        if (useFoldImportOrderUi.getState().choosing) { useFoldImportUiStore.getState().close(); return true; }
        const resolution = live.current.preview.orderResolution;
        if (resolution?.active) { setQueued(null); resolution.back(); return true; }
        // Escape steps back along the line first: the last point clicked on it.
        if (tools.unpickAlong()) {
          setQueued(null);
          return true;
        }
        // Repeat steps back on its own ladder (`useFoldRepeatTool`); Unfold
        // to step is put down, back to a saved step it was rebuilding.
        if (state().tool === 'repeat') {
          setQueued(null);
          return live.current.preview.repeat?.cancel() ?? false;
        }
        if (state().tool === 'unfold-to') {
          setQueued(null);
          live.current.preview.unfold?.putDown();
          return true;
        }
        // Rotate holds its preview from the moment it is in hand: Escape puts it down, and the turn with it.
        if (tools.putDown()) {
          setQueued(null);
          live.current.session.cancel();
          return true;
        }
        const tool = state();
        const held = tool.takenLine !== undefined || tool.picks.length > 0 || tool.override !== null || tool.seed.scope !== 'top' || tool.swapped;
        if (!held) return false;
        setQueued(null);
        tools.clear();
        live.current.session.cancel();
        return true;
      },

      clearMarks: () => {
        const cursor = live.current.session.cursorId;
        useWorkspaceStore.getState().setFoldMarks(cursor, []);
      },
    };
  }, [tools, commitOp]);

  return { verbs, queued: queued !== null };
}
