import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../../analytics/bootstrap';
import { AnalyticsRuntimeProvider } from '../../analytics/runtime';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import type { PrecreaseSequence, PrecreaseWitness } from './precreaseSequence';
import type { ReferencesPlanModel } from './referencesPlanGeometry';
import type { ReferencesViewStep } from './referencesSequenceView';
import { presentedSequence } from './referencesWays';
import { useReferencesWays, type ReferencesWaysController } from './useReferencesWays';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function witness(axiom: number, inputs: PrecreaseWitness['inputs']): PrecreaseWitness {
  return {
    axiom,
    inputs,
    root: 0,
    who_moves: [0],
    hard: false,
    visible: true,
    skinny: false,
    ease: 0,
    err: 0,
  };
}

/** The fixture, its step 5 (index 4) offering three ways. */
function planned(): PrecreaseSequence {
  const sequence = plannerSequenceFixture();
  const step = sequence.steps[WAYS];
  const pick = step.witnesses[step.chosen ?? 0];
  sequence.steps[WAYS] = {
    ...step,
    ways: [
      { witness: pick, kind: 'O3:el' },
      {
        witness: witness(2, [{ kind: 'corner', id: 0, corner: 'sw' }, { kind: 'point', id: 4 }]),
        kind: 'O2:cp',
        decided_by: 'local',
      },
      {
        witness: witness(1, [{ kind: 'point', id: 4 }, { kind: 'point', id: 5 }]),
        kind: 'O1:pp',
        decided_by: 'one_motion',
      },
    ],
  };
  return sequence;
}

const WAYS = 4;
const plan = {};
const sequence = planned();
/** A card per planner step, in order: view index is step index. */
const viewSteps: ReferencesViewStep[] = sequence.steps.map((_, step) => ({
  kind: 'fold',
  side: 'front',
  component: 0,
  step,
}));

let controller: ReferencesWaysController | null = null;

function Probe({ activeStep }: { activeStep: number }) {
  const choices = useWorkspaceStore((state) => state.referencesView.planWays);
  const variants = [
    { sequence: presentedSequence(sequence, 0, choices), model: {} as ReferencesPlanModel },
  ];
  const value = useReferencesWays(plan, variants, viewSteps, activeStep, true);
  useEffect(() => {
    controller = value;
  });
  return null;
}

function fakeClient() {
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

let client = fakeClient();
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function read(activeStep: number): void {
  act(() => {
    root?.render(
      createElement(AnalyticsRuntimeProvider, {
        client,
        children: createElement(Probe, { activeStep }),
      })
    );
  });
}

const explored = () =>
  client.capture.mock.calls
    .filter((call) => call[0] === 'references ways explored')
    .map((call) => call[1]);

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  client = fakeClient();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  controller = null;
});

describe('useReferencesWays', () => {
  it('steps the active card through its ways and stops at either end', () => {
    read(WAYS);
    expect(controller?.active).toEqual({ count: 3, index: 0 });
    act(() => controller?.previousWay());
    expect(controller?.active?.index).toBe(0);
    act(() => controller?.nextWay());
    act(() => controller?.nextWay());
    act(() => controller?.nextWay());
    expect(controller?.active?.index).toBe(2);
    act(() => controller?.previousWay());
    expect(controller?.active?.index).toBe(1);
  });

  // The strip selects a swiped card and switches it in the same handler, so
  // the card is never read as it stood: without the arrival, leaving it would
  // report nothing.
  it('switches a card that is not the one being read, and reports it as a change', () => {
    read(0);
    expect(controller?.active).toBeNull();
    act(() => controller?.shiftWay(WAYS, 1));
    read(WAYS);
    expect(controller?.active).toEqual({ count: 3, index: 1 });
    read(0);
    expect(explored()).toEqual([
      expect.objectContaining({
        settled: 'alternative',
        from_kind: 'O3:el',
        to_kind: 'O2:cp',
        decided_by: 'local',
        viewed: '2',
      }),
    ]);
  });

  it('does nothing for a card with one way', () => {
    read(0);
    act(() => controller?.shiftWay(0, 1));
    expect(useWorkspaceStore.getState().referencesView.planWays).toEqual({});
  });
});
