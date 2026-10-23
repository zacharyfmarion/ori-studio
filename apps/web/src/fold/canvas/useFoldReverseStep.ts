import { useEffect, useMemo, useRef } from 'react';
import { trackFoldChoiceOffered } from '../../analytics';
import type { FoldChoices, FoldCompletionChoice, FoldReverseKind } from '../document/foldSequenceDocument';
import type { FoldReverseAsked } from '../engine/foldEngineReverseWire';
import type { FoldAxiomCandidate, FoldEngineRefused } from '../engine/foldEngineWire';
import type { FoldSessionSurface } from '../session/useFoldSession';
import type { FoldStepBuild } from '../tools/foldStepBuilder';
import type { FoldSeededToolState } from '../tools/foldToolState';
import {
  buildReverseStep,
  chosenAt,
  reverseKindToFold,
  reverseOpenWays,
  reverseOrdersOf,
  type FoldReverseOpenWay,
  type FoldReverseWays,
} from '../tools/reverse/reverseStep';
import type { FoldPickIndex } from './foldPicking';
import { useFoldCompoundAsk, type FoldCompoundAsk } from './useFoldCompoundAsk';

/** What the reverse tool knows of the fold it is previewing, beside the step. */
export interface FoldReversePreview {
  /** The engine's answer for the tip, with the openings chosen; null until it is in. */
  asked: FoldReverseAsked | null;
  /** The kind folded (`reverseKindToFold`). */
  kind: FoldReverseKind;
  /** The kinds that land; empty while unknown, or while neither does. */
  kinds: readonly FoldReverseKind[];
  /** The ways the tip opens, when a flap has a choice; the one taken. */
  ways: FoldReverseWays;
  way: FoldReverseOpenWay | null;
  /** The orders the kind leaves, when it leaves several; the one taken. */
  orders: readonly FoldCompletionChoice[];
  order: FoldCompletionChoice | null;
}

export interface FoldReverseStepAnswer {
  build: FoldStepBuild;
  reverse: FoldReversePreview | null;
  /** Why the tip cannot be asked about: nothing stays, a flap with no opening, a stored choice gone. */
  refused: FoldEngineRefused | null;
}

/**
 * The tools' one question about a reverse fold (`useFoldCompoundAsk`), once
 * per tip on a state: the line, side and anchor, and the openings chosen.
 * Both kinds answer at once, and a stored completion is never asked about,
 * so neither a kind chosen nor an order stepped through asks again.
 */
function useReverseAsk(session: FoldSessionSurface, stateKey: string | null, ask: FoldCompoundAsk | null) {
  return useFoldCompoundAsk(session, stateKey, ask, 'reverse', 'fold:reverse');
}

/**
 * The reverse tool's step (plan Phase 9): the line the picks locate asked
 * about as a tip — what moves, how its flaps open, which kinds land — then
 * built with the kind folded, the way it opens and the order it lands in,
 * each the folder's or the first the engine lists (`tools/reverse/
 * reverseStep`). While an answer is on its way there is no step, so nothing
 * is previewed against a tip the engine has not described.
 *
 * A fix that puts another line in place of the picks' — a near miss's
 * landmark line, which the tools hold as their override — is the tip's line
 * from then on: asked about and folded along, its kind, opening and order
 * still chosen here.
 */
export function useFoldReverseStep(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  tools: FoldSeededToolState,
  candidate: FoldAxiomCandidate | null,
  enabled: boolean
): FoldReverseStepAnswer {
  const state = session.cursor.state;
  const stateKey = state ? `${state.generation}:${state.id}` : null;
  const { lineMode, picks, swapped, seed, compound, override } = tools;
  const fixed = override && (override.op.kind === 'inside-reverse' || override.op.kind === 'outside-reverse') ? override.op : null;

  // The tip: the line, side and anchor, as either kind would fold them.
  const located = useMemo<FoldStepBuild>(() => {
    if (!enabled || !index) return { status: 'unlocated' };
    return buildReverseStep(
      { lineMode, picks, candidate, swapped, seed, kind: 'inside', openings: [], completion: null },
      index
    );
  }, [enabled, index, lineMode, picks, candidate, swapped, seed]);
  const tip =
    located.status !== 'built'
      ? null
      : fixed
        ? { op: { ...fixed, kind: 'inside-reverse' as const } }
        : { op: located.op, ...(located.choices ? { choices: located.choices } : {}) };
  const first = useReverseAsk(session, stateKey, tip);
  const described = first?.asked ?? null;
  const ways = useMemo(() => (described ? reverseOpenWays(described.analysis) : []), [described]);
  const way = chosenAt(ways, compound.opening);
  // With a flap's opening chosen, the kinds and orders are that opening's.
  const opened = useMemo(
    () => (tip && way ? { op: tip.op, choices: { ...tip.choices, opening: way.stored } } : null),
    // The tip is rebuilt on every render; its identity is the located build's, or the fix's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [located, fixed, way]
  );
  const second = useReverseAsk(session, stateKey, opened);
  const answer = way ? second : first;
  const asked = answer?.asked ?? null;
  const kinds = asked?.kinds ?? [];
  const kind = reverseKindToFold(compound.reverseKind, kinds);
  const orders = reverseOrdersOf(asked, kind);
  const order = chosenAt(orders, compound.order);

  // Each choice offered is counted once, by the tip it was offered for.
  const offered = useRef<{ opening: string | null; order: string | null }>({ opening: null, order: null });
  const tipKey = first?.key ?? null;
  useEffect(() => {
    if (tipKey === null) return;
    if (ways.length > 1 && offered.current.opening !== tipKey) {
      offered.current.opening = tipKey;
      trackFoldChoiceOffered('opening', ways.length);
    }
    const orderKey = `${answer?.key ?? ''}:${kind}`;
    if (orders.length > 1 && offered.current.order !== orderKey) {
      offered.current.order = orderKey;
      trackFoldChoiceOffered('order', orders.length);
    }
  }, [tipKey, ways.length, orders.length, answer?.key, kind]);

  const refusedTip = answer?.refused ?? null;
  const build = useMemo<FoldStepBuild>(() => {
    if (located.status !== 'built' || !index) return located;
    // No step until the engine has described the tip, and its opening — or
    // refused it. A refused tip is still a step, so it is analysed like any
    // other: the layers at its line stay on show for the flaps to be narrowed
    // there, and its preview says the same refusal.
    if (!asked && !refusedTip) return { status: 'unlocated' };
    const built = buildReverseStep(
      { lineMode, picks, candidate, swapped, seed, kind, openings: way?.stored ?? [], completion: order },
      index
    );
    if (!fixed || built.status !== 'built') return built;
    // Along the fix's line: its free line in place of the picks', which no
    // axiom's root belongs to.
    const choices: FoldChoices = {
      ...(order ? { completion: order } : {}),
      ...(way ? { opening: way.stored } : {}),
    };
    const { choices: _picked, ...rest } = built;
    return {
      ...rest,
      op: { ...fixed, kind: kind === 'inside' ? 'inside-reverse' : 'outside-reverse' },
      ...(Object.keys(choices).length > 0 ? { choices } : {}),
      via: fixed.line.via,
    };
  }, [located, index, asked, refusedTip, fixed, lineMode, picks, candidate, swapped, seed, kind, way, order]);

  if (!enabled) return { build: { status: 'unlocated' }, reverse: null, refused: null };
  return {
    build,
    reverse: { asked, kind, kinds, ways, way, orders, order },
    refused: refusedTip,
  };
}
