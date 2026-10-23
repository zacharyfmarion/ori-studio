import { useEffect, useMemo, useRef } from 'react';
import { trackFoldChoiceOffered } from '../../analytics';
import type { FoldChoices, FoldCompletionChoice, FoldCrimpKind, FoldCrimpOp } from '../document/foldSequenceDocument';
import type { FoldCrimpAnalysed } from '../engine/foldEngineCrimpTuckWire';
import type { FoldAxiomCandidate, FoldEngineRefused } from '../engine/foldEngineWire';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { buildCrimpStep, crimpKindToFold, crimpLines, type FoldCrimpLines } from '../tools/crimp/crimpStep';
import type { FoldStepBuild } from '../tools/foldStepBuilder';
import type { FoldSeededToolState } from '../tools/foldToolState';
import { chosenAt, reverseOpenWays, type FoldReverseOpenWay, type FoldReverseWays } from '../tools/reverse/reverseStep';
import type { FoldPickIndex } from './foldPicking';
import { useFoldCompoundAsk, useFoldCompoundOrders } from './useFoldCompoundAsk';

/** What the crimp tool knows of the crimp it is previewing, beside the step. */
export interface FoldCrimpPreview {
  /** The engine's answer for the tip at ℓ1 and what lies beyond ℓ2, with the openings chosen; null until it is in. */
  asked: FoldCrimpAnalysed | null;
  /** The kind folded on both lines (`crimpKindToFold`). */
  kind: FoldCrimpKind;
  /** The kinds that land; empty while unknown, or while neither does. */
  kinds: readonly FoldCrimpKind[];
  /** The ways the tip opens at ℓ1, when a flap has a choice; the one taken. */
  ways: FoldReverseWays;
  way: FoldReverseOpenWay | null;
  /** The orders the kind leaves, when it leaves several; the one taken. */
  orders: readonly FoldCompletionChoice[];
  order: FoldCompletionChoice | null;
  /** Both lines across the paper on the folded pane, as located (`crimpLines`). */
  lines: FoldCrimpLines;
}

export interface FoldCrimpStepAnswer {
  build: FoldStepBuild;
  crimp: FoldCrimpPreview | null;
  /** Why the tip cannot be asked about: the lines meet, ℓ2 misses it, nothing stays, a stored choice gone. */
  refused: FoldEngineRefused | null;
}

const NO_LINES: FoldCrimpLines = { first: null, second: null };

/**
 * The crimp tool's step (plan Phase 11), as the reverse tool's is
 * (`useFoldReverseStep`): the two lines the picks locate asked about as a
 * tip — what moves, how its flaps open at ℓ1, which kinds land on both lines
 * — then, with an opening and a kind, the orders its completion leaves,
 * asked of the crimp's own call; then built with the kind folded, the way it
 * opens and the order it lands in, each the folder's or the first the
 * engine lists. While an answer is on its way there is no step, so nothing
 * is previewed against a tip the engine has not described.
 *
 * A fix that puts another line in place of the first one — a near miss's
 * landmark line, which the tools hold as their override — is ℓ1 from then
 * on; the second line, the kind, opening and order are still chosen here.
 */
export function useFoldCrimpStep(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  tools: FoldSeededToolState,
  candidate: FoldAxiomCandidate | null,
  enabled: boolean
): FoldCrimpStepAnswer {
  const state = session.cursor.state;
  const stateKey = state ? `${state.generation}:${state.id}` : null;
  const { lineMode, secondLineMode, picks, swapped, seed, compound, override } = tools;
  const fixed = override && override.op.kind === 'crimp' ? override.op : null;

  // The tip: both lines, the side and the anchor, as either kind would fold them.
  const located = useMemo<FoldStepBuild>(() => {
    if (!enabled || !index) return { status: 'unlocated' };
    return buildCrimpStep(
      { lineMode, secondLineMode, picks, candidate, swapped, seed, kind: 'inside', openings: [], completion: null },
      index
    );
  }, [enabled, index, lineMode, secondLineMode, picks, candidate, swapped, seed]);
  const lines = useMemo<FoldCrimpLines>(
    () =>
      enabled && index
        ? crimpLines(
            { lineMode, secondLineMode, picks, candidate, swapped, seed, kind: 'inside', openings: [], completion: null },
            index
          )
        : NO_LINES,
    [enabled, index, lineMode, secondLineMode, picks, candidate, swapped, seed]
  );
  const tip =
    located.status !== 'built' || located.op.kind !== 'crimp'
      ? null
      : fixed
        ? { op: withFirstLine(located.op, fixed, 'inside') }
        : { op: located.op, ...(located.choices ? { choices: located.choices } : {}) };
  const first = useFoldCompoundAsk(session, stateKey, tip, 'crimp', 'fold:crimp');
  const described = first?.asked ?? null;
  const ways = useMemo(() => (described ? reverseOpenWays(described.analysis.tip) : []), [described]);
  const way = chosenAt(ways, compound.opening);
  // With a flap's opening chosen, the kinds are that opening's.
  const opened = useMemo(
    () => (tip && way ? { op: tip.op, choices: { ...tip.choices, opening: way.stored } } : null),
    // The tip is rebuilt on every render; its identity is the located build's, or the fix's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [located, fixed, way]
  );
  const second = useFoldCompoundAsk(session, stateKey, opened, 'crimp', 'fold:crimp');
  const answer = way ? second : first;
  const asked = answer?.asked ?? null;
  const kinds = asked?.kinds ?? [];
  const kind = crimpKindToFold(compound.reverseKind, kinds);

  // The orders, once the kind lands with its opening: the crimp's own call.
  const lands = asked !== null && kinds.includes(kind);
  const unordered = useMemo(() => {
    if (!tip || !lands) return null;
    const choices: FoldChoices = { ...tip.choices, ...(way ? { opening: way.stored } : {}) };
    return { op: { ...tip.op, crimp: kind }, ...(Object.keys(choices).length > 0 ? { choices } : {}) };
    // The tip is rebuilt on every render; its identity is the located build's, or the fix's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, fixed, lands, kind, way]);
  const listed = useFoldCompoundOrders(session, stateKey, unordered, 'fold:crimp');
  const orders = listed?.orders ?? [];
  const order = chosenAt(orders, compound.order);

  // Each choice offered is counted once, by the tip it was offered for.
  const offered = useRef<{ opening: string | null; order: string | null }>({ opening: null, order: null });
  const tipKey = first?.key ?? null;
  const ordersKey = listed?.key ?? null;
  useEffect(() => {
    if (tipKey !== null && ways.length > 1 && offered.current.opening !== tipKey) {
      offered.current.opening = tipKey;
      trackFoldChoiceOffered('opening', ways.length);
    }
    if (ordersKey !== null && orders.length > 1 && offered.current.order !== ordersKey) {
      offered.current.order = ordersKey;
      trackFoldChoiceOffered('order', orders.length);
    }
  }, [tipKey, ways.length, ordersKey, orders.length]);

  const refusedTip = answer?.refused ?? null;
  // The orders are still being listed for a kind that lands: no step yet.
  const listing = unordered !== null && listed === null;
  const build = useMemo<FoldStepBuild>(() => {
    if (located.status !== 'built' || !index) return located;
    // No step until the engine has described the tip, its opening and its
    // orders — or refused it. A refused tip is still a step, so its layers
    // stay on show and its preview says the same refusal.
    if ((!asked && !refusedTip) || listing) return { status: 'unlocated' };
    const built = buildCrimpStep(
      { lineMode, secondLineMode, picks, candidate, swapped, seed, kind, openings: way?.stored ?? [], completion: order },
      index
    );
    if (!fixed || built.status !== 'built' || built.op.kind !== 'crimp') return built;
    // Along the fix's first line: its free line in place of the picks', which no
    // axiom's root belongs to.
    const choices: FoldChoices = {
      ...(order ? { completion: order } : {}),
      ...(way ? { opening: way.stored } : {}),
    };
    const { choices: _picked, ...rest } = built;
    return {
      ...rest,
      op: withFirstLine(built.op, fixed, kind),
      ...(Object.keys(choices).length > 0 ? { choices } : {}),
      via: fixed.line.via,
    };
  }, [located, index, asked, refusedTip, listing, fixed, lineMode, secondLineMode, picks, candidate, swapped, seed, kind, way, order]);

  if (!enabled) return { build: { status: 'unlocated' }, crimp: null, refused: null };
  return {
    build,
    crimp: { asked, kind, kinds, ways, way, orders, order, lines },
    refused: refusedTip,
  };
}

/** The crimp `op` along the fix's first line, tip side and anchor, of `kind`: its second line is the picks'. */
function withFirstLine(op: FoldCrimpOp, fixed: FoldCrimpOp, kind: FoldCrimpKind): FoldCrimpOp {
  const { moving: _moving, seed: _seed, line: _line, ...rest } = op;
  return {
    ...rest,
    line: fixed.line,
    ...(fixed.moving ? { moving: fixed.moving } : {}),
    seed: fixed.seed,
    crimp: kind,
  };
}
