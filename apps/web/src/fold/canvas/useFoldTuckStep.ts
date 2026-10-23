import { useEffect, useMemo, useRef } from 'react';
import { trackFoldChoiceOffered } from '../../analytics';
import type { FoldCompletionChoice, FoldDirection, FoldTuckOp } from '../document/foldSequenceDocument';
import type { FoldTuckAnalysis, FoldTuckPlacement, FoldTuckTarget } from '../engine/foldEngineCrimpTuckWire';
import type { FoldAnalysis, FoldAxiomCandidate, FoldEngineRefused } from '../engine/foldEngineWire';
import type { FoldSessionSurface } from '../session/useFoldSession';
import type { FoldStepBuild } from '../tools/foldStepBuilder';
import type { FoldSeededToolState } from '../tools/foldToolState';
import { chosenAt } from '../tools/reverse/reverseStep';
import { buildTuckStep, tuckTargetChosen, tuckTargetsOf } from '../tools/tuck/tuckStep';
import type { FoldPickIndex } from './foldPicking';
import { useFoldCompoundAsk, useFoldCompoundOrders, type FoldCompoundAsk } from './useFoldCompoundAsk';

/** What the tuck tool knows of the tuck it is previewing, beside the step. */
export interface FoldTuckPreview {
  /** What the engine listed for the line, side and seed; null until it is in. */
  asked: FoldTuckAnalysis | null;
  /**
   * As the viewer sees it: a valley tuck goes under its target, a mountain
   * one over it. What the window says (the engine's `placement` is the
   * model frame's, the other way round on a view turned over).
   */
  direction: FoldDirection;
  /** The layers offered to tuck against (`tuckTargetsOf`), and the one taken. */
  targets: readonly FoldTuckTarget[];
  target: FoldTuckTarget | null;
  /** Other selected stationary targets, highlighted together with the primary one. */
  additional?: readonly FoldTuckTarget[];
  /** The orders the tuck leaves against it, when it leaves several; the one taken. */
  orders: readonly FoldCompletionChoice[];
  order: FoldCompletionChoice | null;
}

export interface FoldTuckStepAnswer {
  build: FoldStepBuild;
  tuck: FoldTuckPreview | null;
  /** Why it cannot be tucked: nothing stays, the seed reaches no layer, or none here takes the tuck. */
  refused: FoldEngineRefused | null;
  /**
   * While it is refused before a step is built: the plain fold along its
   * line, side and seed, whose layers the picker shows — a tuck's flaps are
   * that fold's — so the flaps can be narrowed until a layer takes it.
   * Asked of the engine for its layers only, never previewed or committed.
   */
  layers: FoldCompoundAsk | null;
}

/**
 * No layer takes the tuck here — none the block lands on, or none the engine
 * found it fits against — under the engine's own code: worded as such by the
 * notice (`tuck_infeasible` with no `target`), never sent to the engine.
 */
export function tuckWithoutTarget(placement: FoldTuckPlacement): FoldEngineRefused {
  return {
    status: 'refused',
    refusal: { code: 'tuck_infeasible', target: null, placement, faces: [] },
    fixes: [],
    faces: [],
    vertices: [],
  };
}

/**
 * A tuck no layer takes (`tuckWithoutTarget`), offered its flaps one at a
 * time when the plain fold along its line moves several, as the engine
 * offers them when nothing would stay (`nothing_stays`): narrowed to one
 * flap, a layer the others carried may stay and take it. `analysis` is that
 * plain fold's — the picker's layers (`FoldTuckStepAnswer.layers`) — so no
 * flap is offered until it is in. Any other refusal is the engine's, fixes
 * and all.
 */
export function tuckRefusedWithFlaps(
  refused: FoldEngineRefused | null,
  analysis: FoldAnalysis | null
): FoldEngineRefused | null {
  if (refused?.refusal.code !== 'tuck_infeasible' || refused.refusal.target !== null) return refused;
  if (!analysis || analysis.flaps.length < 2) return refused;
  return { ...refused, fixes: [{ fix: 'pick_flap', flaps: analysis.flaps }] };
}

/**
 * The tuck tool's step (plan Phase 11), as the reverse tool's is
 * (`useFoldReverseStep`): the line, side, seed and direction the picks
 * locate asked about — what moves, and every layer the block lands on with
 * whether it takes the tuck — then, against the target taken, the orders its
 * completion leaves, asked of the tuck's own call; then built against that
 * target in the order taken, each the folder's or the first the engine
 * lists. While an answer is on its way there is no step.
 *
 * Only a listed layer is ever a target: the folder steps through them, and a
 * refusal's `tuck_target` fix picks one by its face. When none is listed the
 * tuck is refused here (`tuckWithoutTarget`), with no step. A fix's line in
 * place of the picks' is the tuck's line, as the reverse tool's is.
 */
export function useFoldTuckStep(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  tools: FoldSeededToolState,
  candidate: FoldAxiomCandidate | null,
  enabled: boolean
): FoldTuckStepAnswer {
  const state = session.cursor.state;
  const stateKey = state ? `${state.generation}:${state.id}` : null;
  const { lineMode, picks, swapped, seed, tuckDirection: direction, compound, override } = tools;
  const fixed = override && override.op.kind === 'tuck' ? override.op : null;

  // The line, side, seed and direction, against no target yet: what the targets are asked with.
  const located = useMemo<FoldStepBuild>(() => {
    if (!enabled || !index) return { status: 'unlocated' };
    return buildTuckStep({ lineMode, picks, candidate, swapped, seed, direction, target: null, completion: null }, index);
  }, [enabled, index, lineMode, picks, candidate, swapped, seed, direction]);
  const unaimed =
    located.status !== 'built' || located.op.kind !== 'tuck'
      ? null
      : fixed
        ? { op: alongFix(located.op, fixed) }
        : { op: located.op, ...(located.choices ? { choices: located.choices } : {}) };
  const listing = useFoldCompoundAsk(session, stateKey, unaimed, 'tuck', 'fold:tuck');
  const asked = listing?.asked?.analysis ?? null;
  const targets = useMemo(() => tuckTargetsOf(asked), [asked]);
  const target = tuckTargetChosen(targets, compound.tuckTarget);
  const additional = useMemo(
    () => targets.filter((item) => item.face !== target?.face && compound.tuckPinned?.includes(item.face)),
    [targets, target, compound.tuckPinned]
  );
  const additionalTargets = useMemo(() => additional.map((item) => item.at), [additional]);

  // The orders against the target taken: the tuck's own call.
  const aimed = useMemo(() => {
    if (!unaimed || !target) return null;
    return {
      op: { ...unaimed.op, target: target.at, ...(additionalTargets.length ? { additionalTargets } : {}) },
      ...(unaimed.choices ? { choices: unaimed.choices } : {}),
    };
    // The ask is rebuilt on every render; its identity is the located build's, or the fix's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, fixed, target, additionalTargets]);
  const listed = useFoldCompoundOrders(session, stateKey, aimed, 'fold:tuck');
  const orders = listed?.orders ?? [];
  const order = chosenAt(orders, compound.order);

  // Each choice offered is counted once, by the ask it was offered for.
  const offered = useRef<{ target: string | null; order: string | null }>({ target: null, order: null });
  const targetsKey = listing?.key ?? null;
  const ordersKey = listed?.key ?? null;
  useEffect(() => {
    if (targetsKey !== null && targets.length > 1 && offered.current.target !== targetsKey) {
      offered.current.target = targetsKey;
      trackFoldChoiceOffered('tuck_target', targets.length);
    }
    if (ordersKey !== null && orders.length > 1 && offered.current.order !== ordersKey) {
      offered.current.order = ordersKey;
      trackFoldChoiceOffered('order', orders.length);
    }
  }, [targetsKey, targets.length, ordersKey, orders.length]);

  const placement = asked?.placement ?? null;
  const refusedListing = listing?.refused ?? null;
  // Listed, and no layer takes it: refused here, never asked of the engine against a layer it did not list.
  const untargeted = asked !== null && target === null && placement !== null ? tuckWithoutTarget(placement) : null;
  const waiting = aimed !== null && listed === null;
  const build = useMemo<FoldStepBuild>(() => {
    if (located.status !== 'built' || !index) return located;
    // A refused listing names no target to build against: the refusal is the
    // step's, with the engine's fixes (pick a flap, say), and nothing is
    // asked of the engine against a target it did not list.
    if (refusedListing) return { status: 'refused', refused: refusedListing };
    if (!asked || !target || waiting) return { status: 'unlocated' };
    const built = buildTuckStep(
      { lineMode, picks, candidate, swapped, seed, direction, target: target.at, additionalTargets, completion: order },
      index
    );
    if (!fixed || built.status !== 'built' || built.op.kind !== 'tuck') return built;
    // Along the fix's line: its free line in place of the picks', which no
    // axiom's root belongs to.
    const { choices: _picked, ...rest } = built;
    return {
      ...rest,
      op: alongFix(built.op, fixed),
      ...(order ? { choices: { completion: order } } : {}),
      via: fixed.line.via,
    };
  }, [located, index, refusedListing, asked, target, waiting, fixed, lineMode, picks, candidate, swapped, seed, direction, order, additionalTargets]);

  // Refused before a step is built: the layers are the plain fold's along the same line.
  const refusedEarly = refusedListing !== null || untargeted !== null;
  const layers = useMemo<FoldCompoundAsk | null>(() => {
    if (!refusedEarly || !unaimed) return null;
    const { kind: _kind, target: _target, direction: _direction, ...along } = unaimed.op;
    return { op: { ...along, kind: direction }, ...(unaimed.choices ? { choices: unaimed.choices } : {}) };
    // The ask is rebuilt on every render; its identity is the located build's, or the fix's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refusedEarly, located, fixed, direction]);

  if (!enabled) return { build: { status: 'unlocated' }, tuck: null, refused: null, layers: null };
  return {
    build,
    tuck: { asked, direction, targets, target, additional, orders, order },
    refused: refusedListing ?? untargeted,
    layers,
  };
}

/** The tuck `op` along the fix's line, moving side and seed: its direction and target are the tools'. */
function alongFix(op: FoldTuckOp, fixed: FoldTuckOp): FoldTuckOp {
  const { moving: _moving, seed: _seed, line: _line, ...rest } = op;
  return { ...rest, line: fixed.line, ...(fixed.moving ? { moving: fixed.moving } : {}), seed: fixed.seed };
}
