import { useEffect, useRef } from 'react';
import { ANALYTICS_EVENTS } from './events';
import { track } from './runtime';

/** One way a card offers, as the event names it. */
export interface ReferencesWayFacts {
  /** The planner's code for the kind of fold: axiom and reference kinds, `O2:cp`. */
  kind: string;
  /** The criterion the pick won on against this way; null for the pick. */
  decidedBy: string | null;
}

/** The card being read, when it offers other ways to fold it. */
export interface ReferencesWaysVisitCard {
  /** Which card, stable for the plan: `referencesWays.wayKey`. */
  key: string;
  /** The way it shows now; 0 is the planner's pick. */
  index: number;
  ways: readonly ReferencesWayFacts[];
  stepKind: 'cp' | 'aux' | 'press';
  /** A card of two mirrored folds, switched together. */
  twin: boolean;
}

export interface ReferencesWaysExploredInput {
  /** The plan being read; a new object is a new plan. Null when none is. */
  plan: object | null;
  /** The active card, or null when it offers no other way (or none is read). */
  card: ReferencesWaysVisitCard | null;
}

export type ReferencesWaysExploredProperties = Record<string, string | boolean>;

/** A visit to one card: what it offered, what was looked at, whether it changed. */
interface Visit {
  card: ReferencesWaysVisitCard;
  viewed: Set<number>;
  changed: boolean;
}

/** What the event remembers between renders. */
export interface ReferencesWaysExploredState {
  plan: object | null;
  visit: Visit | null;
  /** The way each card of this plan was last reported settled on. */
  reported: Map<string, number>;
}

export function initialWaysExploredState(): ReferencesWaysExploredState {
  return { plan: null, visit: null, reported: new Map() };
}

function visitOf(card: ReferencesWaysVisitCard | null): Visit | null {
  return card ? { card, viewed: new Set([card.index]), changed: false } : null;
}

/** The event a visit ends in, if it earns one, noted in `reported`. */
function ending(
  visit: Visit | null,
  reported: Map<string, number>
): ReferencesWaysExploredProperties | null {
  if (!visit?.changed) return null;
  const { card } = visit;
  if (reported.get(card.key) === card.index) return null;
  reported.set(card.key, card.index);
  const pick = card.ways[0];
  const settled = card.ways[card.index];
  if (!pick || !settled) return null;
  return {
    tab: 'sequence',
    settled: card.index === 0 ? 'recommended' : 'alternative',
    from_kind: pick.kind,
    to_kind: settled.kind,
    decided_by: card.index === 0 ? 'none' : (settled.decidedBy ?? 'none'),
    ways: String(card.ways.length),
    viewed: String(visit.viewed.size),
    step_kind: card.stepKind,
    twin: card.twin,
  };
}

/**
 * One render's step of the visit bookkeeping: the state after it, and the
 * event it ends a visit with, if any. A visit ends when the reader moves to
 * another card, leaves the plan, or a new plan lands; it earns an event only
 * if they changed the way while on it, and never twice for a card of one plan
 * settled the same way.
 */
export function stepWaysExplored(
  state: ReferencesWaysExploredState,
  input: ReferencesWaysExploredInput
): { state: ReferencesWaysExploredState; event: ReferencesWaysExploredProperties | null } {
  if (input.plan !== state.plan) {
    const event = ending(state.visit, state.reported);
    return {
      state: { plan: input.plan, visit: visitOf(input.card), reported: new Map() },
      event,
    };
  }
  const { visit } = state;
  if (input.card?.key !== visit?.card.key) {
    const event = ending(visit, state.reported);
    return { state: { ...state, visit: visitOf(input.card) }, event };
  }
  if (!visit || !input.card) return { state, event: null };
  const changed = visit.changed || input.card.index !== visit.card.index;
  visit.viewed.add(input.card.index);
  return { state: { ...state, visit: { ...visit, card: input.card, changed } }, event: null };
}

/**
 * Emit `references ways explored` as the reader leaves a card on which they
 * looked at its other ways — whether they kept the planner's pick or settled
 * on another, what kind each fold is, and which of the planner's criteria the
 * pick won on. Per visit rather than per press, so cycling through the ways and
 * back reads as one look that confirmed the pick. Enums only: the kind codes
 * are the planner's closed vocabulary, never a reference or a coordinate
 * (`docs/analytics.md`).
 */
export function useReferencesWaysExploredEvent(input: ReferencesWaysExploredInput): void {
  const state = useRef(initialWaysExploredState());
  const { plan, card } = input;
  useEffect(() => {
    const next = stepWaysExplored(state.current, { plan, card });
    state.current = next.state;
    if (next.event) track(ANALYTICS_EVENTS.referencesWaysExplored, next.event);
  }, [plan, card]);
  useEffect(
    () => () => {
      const event = ending(state.current.visit, state.current.reported);
      state.current = { ...state.current, visit: null };
      if (event) track(ANALYTICS_EVENTS.referencesWaysExplored, event);
    },
    []
  );
}
