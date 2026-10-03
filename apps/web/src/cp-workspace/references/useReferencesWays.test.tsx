import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../../analytics/bootstrap';
import { AnalyticsRuntimeProvider } from '../../analytics/runtime';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import type { PrecreasePlanResult } from './precreasePlan';
import type { PrecreaseSequence, PrecreaseWitness } from './precreaseSequence';
import { REFERENCES_PLANNER_BUILD, type ReferencesPlanCacheKey } from './referencesPlanCache';
import {
  installReferencesPlanCache,
  lookupReferencesPlan,
  resetReferencesPlanCacheForTests,
} from './referencesPlanCacheStore';
import type { ReferencesPlanModel } from './referencesPlanGeometry';
import type { ReferencesPlanRecord } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';
import { presentedSequence, waySignature } from './referencesWays';
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
const sequence = planned();
const SETTINGS = {
  precreaseGrid: true,
  gridWhereNeeded: true,
  allowDanglingFolds: true,
  mergeSymmetricSteps: true,
};
const CACHE_KEY: ReferencesPlanCacheKey = {
  planner: REFERENCES_PLANNER_BUILD,
  settings: SETTINGS,
  sheet: {
    bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
    frame: { origin: [-200, 200], x_axis: [1, 0], y_axis: [0, -1], width: 400, height: 400 },
    fingerprint: 'ps1:0000000000000abc',
  },
};
const variant = { sequence, model: {} as ReferencesPlanModel };
const plan: ReferencesPlanRecord = {
  revision: '7:r',
  components: [
    {
      component: 0,
      result: { sequence } as PrecreasePlanResult,
      frame: { origin: [0, 0], x_axis: [1, 0], y_axis: [0, 1], width: 1, height: 1 },
      plain: variant,
      hoisted: variant,
      cacheKey: CACHE_KEY,
    },
  ],
  refused: [],
  durationMs: 0,
  ...SETTINGS,
};
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
  resetReferencesPlanCacheForTests();
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

  // The cache keeps a sheet's choices beside its plan, so they are saved with
  // the file and back when the reader returns to the sheet.
  it('writes a choice through to the plan it names in the cache', () => {
    useWorkspaceStore.setState({
      oristudioCpDocument: { loadSerial: 7 } as OristudioCpDocumentState,
    });
    installReferencesPlanCache(
      { v: 1, entries: [{ key: CACHE_KEY, ways: {}, payload: 'packed' }] },
      7
    );
    read(WAYS);
    act(() => controller?.nextWay());
    const chosen = waySignature(sequence.steps[WAYS].ways![1].witness);
    const lineId = String(sequence.steps[WAYS].line_id);
    expect(lookupReferencesPlan(7, CACHE_KEY)).toEqual({
      outcome: 'hit',
      payload: 'packed',
      ways: { [lineId]: chosen },
    });
  });

  it('does nothing for a card with one way', () => {
    read(0);
    act(() => controller?.shiftWay(0, 1));
    expect(useWorkspaceStore.getState().referencesView.planWays).toEqual({});
  });
});
