import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../bootstrap';
import { AnalyticsRuntimeProvider } from '../runtime';
import {
  arriveWaysExplored,
  initialWaysExploredState,
  stepWaysExplored,
  useReferencesWaysExploredEvent,
  type ReferencesWaysExploredInput,
  type ReferencesWaysExploredProperties,
  type ReferencesWaysVisitCard,
} from '../useReferencesWaysExploredEvent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const planA = {};
const planB = {};

function card(key: string, index: number, overrides: Partial<ReferencesWaysVisitCard> = {}) {
  return {
    key,
    index,
    ways: [
      { kind: 'O2:cc', decidedBy: null },
      { kind: 'O1:cc', decidedBy: 'one_motion' },
      { kind: 'O3:ee', decidedBy: 'corner_to_corner' },
    ],
    stepKind: 'cp' as const,
    twin: false,
    ...overrides,
  };
}

/** A card reached by switching it, as it stood before the switch. */
interface Arrival {
  arrive: { plan: object | null; card: ReferencesWaysVisitCard };
}

/**
 * Feed a sequence of renders — and arrivals, between them — through the
 * bookkeeping; the events it sends.
 */
function run(
  inputs: readonly (ReferencesWaysExploredInput | Arrival)[]
): ReferencesWaysExploredProperties[] {
  let state = initialWaysExploredState();
  const events: ReferencesWaysExploredProperties[] = [];
  for (const input of inputs) {
    const next =
      'arrive' in input
        ? arriveWaysExplored(state, input.arrive)
        : stepWaysExplored(state, input);
    state = next.state;
    if (next.event) events.push(next.event);
  }
  return events;
}

describe('stepWaysExplored', () => {
  it('sends nothing for a card read without changing its way', () => {
    expect(
      run([
        { plan: planA, card: card('0:5', 0) },
        { plan: planA, card: card('0:6', 0) },
        { plan: planA, card: null },
      ])
    ).toEqual([]);
  });

  it('reports the way a card was left on, what kind each fold is, and why the pick won', () => {
    expect(
      run([
        { plan: planA, card: card('0:5', 0) },
        { plan: planA, card: card('0:5', 1) },
        { plan: planA, card: card('0:5', 2) },
        { plan: planA, card: card('0:6', 0) },
      ])
    ).toEqual([
      {
        tab: 'sequence',
        settled: 'alternative',
        from_kind: 'O2:cc',
        to_kind: 'O3:ee',
        decided_by: 'corner_to_corner',
        ways: '3',
        viewed: '3',
        step_kind: 'cp',
        twin: false,
      },
    ]);
  });

  it('reads a look that came back to the pick as a pick confirmed', () => {
    expect(
      run([
        { plan: planA, card: card('0:5', 0, { stepKind: 'aux', twin: true }) },
        { plan: planA, card: card('0:5', 1, { stepKind: 'aux', twin: true }) },
        { plan: planA, card: card('0:5', 0, { stepKind: 'aux', twin: true }) },
        { plan: planA, card: null },
      ])
    ).toEqual([
      {
        tab: 'sequence',
        settled: 'recommended',
        from_kind: 'O2:cc',
        to_kind: 'O2:cc',
        decided_by: 'none',
        ways: '3',
        viewed: '2',
        step_kind: 'aux',
        twin: true,
      },
    ]);
  });

  it('reports a card of one plan again only when it is settled differently', () => {
    const events = run([
      { plan: planA, card: card('0:5', 0) },
      { plan: planA, card: card('0:5', 1) },
      { plan: planA, card: card('0:6', 0) },
      // Back, and off again on the same way: nothing new.
      { plan: planA, card: card('0:5', 1) },
      { plan: planA, card: card('0:5', 0) },
      { plan: planA, card: card('0:5', 1) },
      { plan: planA, card: card('0:6', 0) },
      // Back, and off on another way.
      { plan: planA, card: card('0:5', 1) },
      { plan: planA, card: card('0:5', 2) },
      { plan: planA, card: null },
    ]);
    expect(events.map((event) => event.to_kind)).toEqual(['O1:cc', 'O3:ee']);
  });

  // A swipe on a card other than the active one selects it and switches it in
  // one render. Seen only as renders, that is a card that was never anything
  // but its new way, and the change is lost.
  it('reads a card reached by switching it as a change made on it', () => {
    const swipedTo = [
      { plan: planA, card: card('0:5', 0) },
      { plan: planA, card: card('0:6', 1) },
      { plan: planA, card: null },
    ];
    expect(run(swipedTo)).toEqual([]);
    expect(
      run([swipedTo[0], { arrive: { plan: planA, card: card('0:6', 0) } }, ...swipedTo.slice(1)])
    ).toEqual([
      {
        tab: 'sequence',
        settled: 'alternative',
        from_kind: 'O2:cc',
        to_kind: 'O1:cc',
        decided_by: 'one_motion',
        ways: '3',
        viewed: '2',
        step_kind: 'cp',
        twin: false,
      },
    ]);
  });

  it('ends the card being read when another is reached, and ignores reaching it again', () => {
    const events = run([
      { plan: planA, card: card('0:5', 0) },
      { plan: planA, card: card('0:5', 2) },
      { arrive: { plan: planA, card: card('0:6', 0) } },
      { plan: planA, card: card('0:6', 1) },
      // A second swipe on the card now being read is an ordinary change.
      { arrive: { plan: planA, card: card('0:6', 1) } },
      { plan: planA, card: card('0:6', 2) },
      { plan: planA, card: null },
    ]);
    expect(events.map((event) => [event.to_kind, event.viewed])).toEqual([
      ['O3:ee', '2'],
      ['O3:ee', '3'],
    ]);
  });

  it('ends the visit when a new plan lands, and starts the new plan afresh', () => {
    const events = run([
      { plan: planA, card: card('0:5', 0) },
      { plan: planA, card: card('0:5', 1) },
      { plan: planB, card: card('0:5', 0) },
      { plan: planB, card: card('0:5', 1) },
      { plan: planB, card: null },
    ]);
    expect(events.map((event) => event.settled)).toEqual(['alternative', 'alternative']);
  });
});

function makeFakeClient() {
  return {
    init: vi.fn(),
    register: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
  } satisfies PostHogClientLike;
}

function events(client: ReturnType<typeof makeFakeClient>) {
  return client.capture.mock.calls
    .filter((call) => call[0] === 'references ways explored')
    .map((call) => call[1]);
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

function Probe(input: ReferencesWaysExploredInput) {
  useReferencesWaysExploredEvent(input);
  return null;
}

function render(client: PostHogClientLike, node: ReactNode) {
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: node }));
  });
}

describe('useReferencesWaysExploredEvent', () => {
  it('reports a changed card when the reader moves on, and when the panel goes', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { plan: planA, card: card('0:5', 0) }));
    render(client, createElement(Probe, { plan: planA, card: card('0:5', 2) }));
    render(client, createElement(Probe, { plan: planA, card: card('0:6', 0) }));
    expect(events(client)).toHaveLength(1);
    render(client, createElement(Probe, { plan: planA, card: card('0:6', 1) }));
    act(() => root.render(createElement(AnalyticsRuntimeProvider, { client, children: null })));
    expect(events(client).map((event) => event.to_kind)).toEqual(['O3:ee', 'O1:cc']);
    act(() => root.unmount());
  });
});
