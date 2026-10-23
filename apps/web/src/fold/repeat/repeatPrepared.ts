/**
 * The repeats Repeat has prepared with no layer order chosen, by what each
 * was prepared for — the range and the axis (`useFoldRepeatTool`'s context) —
 * and the ones being prepared. Every listed axis is prepared up front, one
 * after another, so the window knows which axes land before the folder picks
 * one: an axis whose repeat is refused is offered disabled, with why
 * (`axisState`). A preparation asked for again while it runs joins it; one
 * prepared shows again at once.
 *
 * React-free: the hook keeps one in a ref.
 */
import type { FoldSearchTicket } from '../engine/foldSearch';
import type { RepeatPrepared } from './repeatPreparation';
import type { RepeatStop } from './repeatWords';

/** What a repeat across an axis does, as far as it is known: it lands (ready, or with an order to choose), it is refused, or it is not known yet. */
export type RepeatAxisState =
  | { kind: 'lands' }
  | { kind: 'refused'; prepared: Extract<RepeatPrepared, { status: 'blocked' }> }
  | { kind: 'unknown' };

/** How many are kept: every axis of a few ranges. */
const KEPT = 32;

export interface RepeatPreparedStore {
  /** The repeat prepared for `context`, if it was. */
  get(context: string): RepeatPrepared | undefined;
  /** The preparation running for `context`, if one is. */
  running(context: string): { ticket: FoldSearchTicket; answer: Promise<RepeatPrepared | null> } | undefined;
  /** Whether any preparation is running. */
  busy(): boolean;
  /** Whether a preparation for `context` failed — the worker, not the repeat: it is not asked again of itself. */
  failed(context: string): boolean;
  /**
   * Run `prepare` for `context`, kept once it answers. `null` from it is a
   * preparation stopped (it is neither kept nor failed); `undefined`, one the
   * worker could not answer (failed). `onSettled` is called after either.
   */
  start(
    context: string,
    ticket: FoldSearchTicket,
    prepare: () => Promise<RepeatPrepared | null | undefined>,
    onSettled: () => void
  ): { ticket: FoldSearchTicket; answer: Promise<RepeatPrepared | null> };
  /** Stop every preparation running whose context `keep` rejects: another range is in hand. */
  stopOthers(keep: (context: string) => boolean, stop: (ticket: FoldSearchTicket) => void): void;
}

export function createRepeatPreparedStore(): RepeatPreparedStore {
  const kept = new Map<string, RepeatPrepared>();
  const running = new Map<string, { ticket: FoldSearchTicket; answer: Promise<RepeatPrepared | null> }>();
  const failed = new Set<string>();
  return {
    get: (context) => kept.get(context),
    running: (context) => running.get(context),
    busy: () => running.size > 0,
    failed: (context) => failed.has(context),
    start(context, ticket, prepare, onSettled) {
      // Only this job's own entry is let go as it settles: one stopped may settle after another took its place.
      const done = () => {
        if (running.get(context)?.ticket === ticket) running.delete(context);
      };
      const answer = prepare().then(
        (prepared) => {
          done();
          if (prepared === undefined) failed.add(context);
          else if (prepared !== null) {
            kept.delete(context);
            kept.set(context, prepared);
            while (kept.size > KEPT) kept.delete(kept.keys().next().value!);
          }
          onSettled();
          return prepared ?? null;
        },
        () => {
          done();
          onSettled();
          return null;
        }
      );
      const job = { ticket, answer };
      running.set(context, job);
      return job;
    },
    stopOthers(keep, stop) {
      // Let go at once: one asked again before the stop has settled starts afresh rather than joining it.
      for (const [context, job] of [...running]) {
        if (keep(context)) continue;
        running.delete(context);
        stop(job.ticket);
      }
    },
  };
}

/** What the window is told of an axis: whether its repeat lands, and when refused, why and at which operation. */
export interface RepeatAxisView {
  kind: RepeatAxisState['kind'];
  stop?: RepeatStop;
  /** The source operation it stopped at, 0-based. */
  step?: number;
}

export function axisStateView(state: RepeatAxisState): RepeatAxisView {
  if (state.kind !== 'refused') return { kind: state.kind };
  const { code, refusal, op, step } = state.prepared;
  return { kind: 'refused', stop: { code, ...(refusal ? { refusal } : {}), ...(op ? { op } : {}) }, step };
}

/** What the repeat prepared for an axis's context says of it. */
export function axisState(store: RepeatPreparedStore, context: string | null): RepeatAxisState {
  const prepared = context === null ? undefined : store.get(context);
  if (!prepared) return { kind: 'unknown' };
  return prepared.status === 'blocked' ? { kind: 'refused', prepared } : { kind: 'lands' };
}
