import { useEffect, useMemo, useRef, useState } from 'react';
import { trackFoldChoiceOffered } from '../../analytics';
import { reportError } from '../../monitoring';
import { canonicalJson } from '../document/foldDigest';
import type { FoldChoices, FoldCompletionChoice, FoldSinkOp } from '../document/foldSequenceDocument';
import {
  isFoldSinkOp,
  type FoldEngineSinkOp,
  type FoldPocket,
  type FoldSinkAnalysed,
  type FoldSinkOrders,
  type FoldSinkPicked,
  type FoldSunkPoints,
} from '../engine/foldEngineSinkWire';
import type { FoldAxiomCandidate, FoldEngineOutcome, FoldEngineRefused } from '../engine/foldEngineWire';
import type { FoldSessionWorker } from '../session/foldSession';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { isSinkTool, type FoldSinkToolId } from '../tools/foldToolCatalog';
import type { FoldStepBuild } from '../tools/foldStepBuilder';
import type { FoldSeededToolState } from '../tools/foldToolState';
import { chosenAt } from '../tools/reverse/reverseStep';
import { buildSinkStep, pocketsAsSeen, sinkOrderPicks, type FoldSinkIntent } from '../tools/sink/sinkStep';
import type { FoldPickIndex } from './foldPicking';

/** What the sink tools know of the sink they are previewing, beside the step. */
export interface FoldSinkPreview {
  tool: FoldSinkToolId;
  /**
   * A sink's point as the engine described it — its outline, apex, square
   * line and pockets — with why an open sink of it is refused; null until it
   * is in, and for an unsink.
   */
  point: FoldSinkAnalysed | null;
  /** A closed sink's pockets, when its point has several, and the one taken; empty for no choice. */
  pockets: readonly FoldPocket[];
  pocket: number;
  /** An unsink's sunk points, while the folder has named none; null until they are in, and for a sink. */
  sunk: FoldSunkPoints | null;
  /** How many layer orders the chooser steps through, when the sink leaves several (else 0), and the one taken. */
  orders: number;
  order: number;
}

export interface FoldSinkStepAnswer {
  build: FoldStepBuild;
  sink: FoldSinkPreview | null;
  /** Why the point cannot be asked about, or no sunk point lies on the unsink's side. */
  refused: FoldEngineRefused | null;
}

type Answer<T> = { key: string; value: T | null; refused: FoldEngineRefused | null };

/** One question of the engine about the state on screen. Module-level, so an answer hook never asks twice for one key. */
type Ask<A, T> = (engine: FoldSessionWorker, at: number, ask: A) => Promise<FoldEngineOutcome<T>>;

const askPoint: Ask<{ op: FoldEngineSinkOp; choices?: FoldChoices }, FoldSinkAnalysed> = async (engine, at, ask) => {
  const answer = await engine.compoundAnalysis(at, ask.op, ask.choices);
  // A sink op's answer is always the sink family's.
  if (answer.status === 'ok' && answer.family !== 'sink') throw new Error(`a sink answered for ${answer.family}`);
  return answer as FoldEngineOutcome<FoldSinkAnalysed>;
};

const askSunk: Ask<{ op: FoldEngineSinkOp; choices?: FoldChoices }, FoldSunkPoints> = (engine, at, ask) =>
  engine.sunkPoints(at, ask.op, ask.choices);

const askOrders: Ask<{ op: FoldEngineSinkOp; choices?: FoldChoices }, FoldSinkOrders> = (engine, at, ask) =>
  engine.sinkOrders(at, ask.op, ask.choices);

const askPick: Ask<{ op: FoldEngineSinkOp; choices?: FoldChoices; choice: number[] }, FoldSinkPicked> = (
  engine,
  at,
  ask
) => engine.sinkPick(at, ask.op, ask.choice, ask.choices);

/**
 * The engine's answer to `ask` from the state on screen, once per ask on a
 * state: an equal ask asks nothing again, and an answer is kept only while it
 * is for the ask on screen.
 */
function useSinkAnswer<A, T>(
  session: FoldSessionSurface,
  stateKey: string | null,
  ask: A | null,
  call: Ask<A, T>,
  surface: string
): Answer<T> | null {
  const { withCursor } = session;
  const key = ask !== null && stateKey ? `${stateKey}|${canonicalJson(ask)}` : null;
  const [answer, setAnswer] = useState<Answer<T> | null>(null);
  useEffect(() => {
    if (ask === null || key === null || answer?.key === key) return undefined;
    let current = true;
    void withCursor((engine, at) => call(engine, at, ask)).then(
      (reply) => {
        if (!current || reply.status !== 'answered') return;
        const value = reply.value;
        setAnswer(value.status === 'ok' ? { key, value, refused: null } : { key, value: null, refused: value });
      },
      (error: unknown) => reportError(error, { surface })
    );
    return () => {
      current = false;
    };
    // The ask is read through its key, and `call` is module-level: an equal ask must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withCursor, key, answer?.key]);
  return answer && answer.key === key ? answer : null;
}

/** An unsink with nothing sunk on its side: worded as the engine words one whose seed names no sunk point. */
function noSunkPoint(): FoldEngineRefused {
  return { status: 'refused', refusal: { code: 'unsink_not_sunk' }, fixes: [], faces: [], vertices: [] };
}

/** A step along the fix's line in place of the picks': its free line, which no axiom's root belongs to. */
function alongFix(build: FoldStepBuild, fixed: FoldSinkOp | null, tool: FoldSinkToolId): FoldStepBuild {
  if (!fixed || build.status !== 'built') return build;
  const { root: _root, ...kept } = build.choices ?? {};
  const { choices: _picked, ...rest } = build;
  return {
    ...rest,
    op: { ...fixed, kind: tool },
    ...(Object.keys(kept).length > 0 ? { choices: kept } : {}),
    via: fixed.line.via,
  };
}

/**
 * The sink tools' step (plan Phase 11): the line the picks locate asked
 * about — a sink's point, with its pockets and why an open sink is refused;
 * an unsink's sunk points, while the folder has named none — then built with
 * the pocket taken and the order it lands in, each the folder's or the first
 * the engine lists (`tools/sink/sinkStep`). While an answer is on its way
 * there is no step, so nothing is previewed against a point the engine has
 * not described.
 *
 * A fix that puts another line in place of the picks' — the square line a
 * tilted open sink is offered, which the tools hold as their override — is
 * the sink's line from then on, its pocket and order still chosen here.
 */
export function useFoldSinkStep(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  tools: FoldSeededToolState,
  candidate: FoldAxiomCandidate | null,
  enabled: boolean
): FoldSinkStepAnswer {
  const state = session.cursor.state;
  const stateKey = state ? `${state.generation}:${state.id}` : null;
  const tool: FoldSinkToolId = isSinkTool(tools.tool) ? tools.tool : 'open-sink';
  const { lineMode, picks, swapped, seed, compound, override } = tools;
  const fixed = override && isFoldSinkOp(override.op) ? override.op : null;

  const intentOf = (made: Pick<FoldSinkIntent, 'pocket' | 'completion' | 'sunk'>): FoldSinkIntent => ({
    lineMode,
    picks,
    candidate,
    swapped,
    seed,
    tool,
    ...made,
  });

  // The point: the line, side and anchor, as any sink of it would fold them.
  const located = useMemo<FoldStepBuild>(() => {
    if (!enabled || !index) return { status: 'unlocated' };
    return alongFix(buildSinkStep(intentOf({ pocket: null, completion: null, sunk: null }), index), fixed, tool);
    // The intent is the tools' fields listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, index, lineMode, picks, candidate, swapped, seed, tool, fixed]);
  const tip = located.status === 'built' && isFoldSinkOp(located.op) ? { op: located.op, choices: located.choices } : null;

  // A sink's point is either kind's: asked once, the kind control never asks again.
  const pointAsk = useMemo(
    () => (tip && tool !== 'unsink' ? { op: { ...tip.op, kind: 'open-sink' as const }, ...rootOnly(tip.choices) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [located, tool]
  );
  const point = useSinkAnswer(session, stateKey, pointAsk, askPoint, 'fold:sink-point');
  // An unsink's sunk points, while the folder has named none.
  const sunkAsk = useMemo(
    () => (tip && tool === 'unsink' && tip.op.seed.scope === 'all' ? { op: tip.op, ...rootOnly(tip.choices) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [located, tool]
  );
  const sunk = useSinkAnswer(session, stateKey, sunkAsk, askSunk, 'fold:sunk-points');

  // Front to back as the viewer sees them: the chooser starts on the front pocket.
  const flipped = index?.scene.view.flipped ?? false;
  const pockets = useMemo(
    () =>
      tool === 'closed-sink' && point?.value && point.value.analysis.pockets.length > 1
        ? pocketsAsSeen(point.value.analysis.pockets, flipped)
        : [],
    [tool, point, flipped]
  );
  const pocket = chosenAt(pockets, compound.pocket);
  const sunkPoint = sunk?.value?.points[0] ?? null;
  const noneSunk = sunk?.value !== undefined && sunk.value !== null && sunk.value.points.length === 0;

  // The step with its pocket and its sunk point, before its order is known:
  // built once the engine has described the point — or refused it, which is
  // still a step, its layers on show for a point to be picked there.
  const described = tool === 'unsink' ? sunkAsk === null || sunk !== null : point !== null;
  const decided = useMemo<FoldStepBuild>(() => {
    if (located.status !== 'built' || !index) return located;
    if (!described) return { status: 'unlocated' };
    const made = { pocket: pocket?.stored ?? null, completion: null, sunk: sunkPoint };
    return alongFix(buildSinkStep(intentOf(made), index), fixed, tool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, index, described, pocket, sunkPoint, fixed, tool]);

  // The orders it leaves, and — when they are several — what the one taken stores.
  const ordersAsk = useMemo(
    () => (decided.status === 'built' && isFoldSinkOp(decided.op) ? { op: decided.op, ...withChoices(decided.choices) } : null),
    [decided]
  );
  const orders = useSinkAnswer(session, stateKey, ordersAsk, askOrders, 'fold:sink-orders');
  const orderPicks = useMemo(() => sinkOrderPicks(orders?.value ?? null), [orders]);
  const orderPick = chosenAt(orderPicks, compound.order);
  const pickAsk = useMemo(
    () => (ordersAsk && orderPick && orderPicks.length > 1 ? { ...ordersAsk, choice: orderPick } : null),
    [ordersAsk, orderPick, orderPicks.length]
  );
  const picked = useSinkAnswer(session, stateKey, pickAsk, askPick, 'fold:sink-pick');
  const completion: FoldCompletionChoice | null = picked?.value?.completion ?? null;

  // Each choice offered is counted once, by the point it was offered for.
  const offered = useRef<{ pocket: string | null; order: string | null }>({ pocket: null, order: null });
  const pointKey = point?.key ?? null;
  const ordersKey = orders?.key ?? null;
  useEffect(() => {
    if (pointKey !== null && pockets.length > 1 && offered.current.pocket !== pointKey) {
      offered.current.pocket = pointKey;
      trackFoldChoiceOffered('pocket', pockets.length);
    }
    if (ordersKey !== null && orderPicks.length > 1 && offered.current.order !== ordersKey) {
      offered.current.order = ordersKey;
      trackFoldChoiceOffered('order', orderPicks.length);
    }
  }, [pointKey, pockets.length, ordersKey, orderPicks.length]);

  const build = useMemo<FoldStepBuild>(() => {
    if (decided.status !== 'built' || !index) return decided;
    // No step until the orders are counted — a refusal counts none, and the
    // preview says it — and, of several, the one taken is picked.
    if (!orders) return { status: 'unlocated' };
    if (orderPicks.length <= 1) return decided;
    if (!completion) return picked?.refused ? decided : { status: 'unlocated' };
    const made = { pocket: pocket?.stored ?? null, completion, sunk: sunkPoint };
    return alongFix(buildSinkStep(intentOf(made), index), fixed, tool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decided, index, orders, orderPicks.length, completion, picked?.refused, pocket, sunkPoint, fixed, tool]);

  if (!enabled) return { build: { status: 'unlocated' }, sink: null, refused: null };
  const refused = point?.refused ?? sunk?.refused ?? (noneSunk ? noSunkPoint() : null);
  return {
    build: noneSunk ? { status: 'unlocated' } : build,
    sink: {
      tool,
      point: point?.value ?? null,
      pockets,
      pocket: pockets.length > 0 ? Math.min(compound.pocket, pockets.length - 1) : 0,
      sunk: sunk?.value ?? null,
      orders: orderPicks.length,
      order: orderPicks.length > 0 ? Math.min(compound.order, orderPicks.length - 1) : 0,
    },
    refused,
  };
}

/** The choices a point is asked about with: only the axiom's root, which its line does not resolve without. */
function rootOnly(choices: FoldChoices | undefined): { choices?: FoldChoices } {
  return choices?.root ? { choices: { root: choices.root } } : {};
}

function withChoices(choices: FoldChoices | undefined): { choices?: FoldChoices } {
  return choices && Object.keys(choices).length > 0 ? { choices } : {};
}
