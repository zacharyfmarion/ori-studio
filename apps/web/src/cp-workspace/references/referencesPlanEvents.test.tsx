import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../../analytics/bootstrap';
import { AnalyticsRuntimeProvider } from '../../analytics/runtime';
import type { ReferencesPlanSummary } from '../../store/workspaceStore/types';
import { trackPlan } from './referencesPlanEvents';
import type { ReferencesPlanRecord } from './referencesResults';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** Every `folding steps …` capture, as `[event, properties]`. */
function planEvents(client: ReturnType<typeof makeFakeClient>) {
  return client.capture.mock.calls
    .filter((call) => String(call[0]).startsWith('folding steps '))
    .map((call) => [call[0], call[1]]);
}

let container: HTMLElement;
let root: Root;
let client: ReturnType<typeof makeFakeClient>;

// `trackPlan` reports through the module-level `track`, which the provider
// wires to its client on mount — so the provider is mounted, with a fake.
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = makeFakeClient();
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: null }));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/** Only the fields `trackPlan` reads; the rest is record-shaped filler. */
function record(overrides: Partial<ReferencesPlanRecord> = {}): ReferencesPlanRecord {
  return {
    revision: 'r1',
    components: [],
    refused: [],
    durationMs: 1234,
    precreaseGrid: true,
    gridWhereNeeded: true,
    allowDanglingFolds: false,
    mergeSymmetricSteps: true,
    ...overrides,
  };
}

function summary(overrides: Partial<ReferencesPlanSummary> = {}): ReferencesPlanSummary {
  return {
    stopReason: 'complete',
    cpLines: 40,
    aux: 3,
    visibleAux: 1,
    exactnessClass: 'exact',
    turnOvers: 4,
    mixedSteps: 0,
    gridKind: null,
    gridLines: 0,
    gridSteps: 0,
    gridUnwantedLength: 0,
    reachLength: 0.25,
    ...overrides,
  } as ReferencesPlanSummary;
}

describe('trackPlan', () => {
  it('reports a finished plan as completed, with bucketed counts only', () => {
    trackPlan(record(), summary(), false);
    const [[event, properties]] = planEvents(client);
    expect(event).toBe('folding steps completed');
    expect(properties).toMatchObject({
      target_kind: 'whole_cp',
      lines_bucket: '<=50',
      duration_bucket: expect.any(String),
      exactness_class: 'exact',
      dangling_folds: 'disallowed',
      symmetric_steps: 'merged',
    });
    expect(properties).not.toHaveProperty('refusal_reason');
    // Nothing raw: every value is an enum or a bucket label.
    for (const value of Object.values(properties as Record<string, unknown>)) {
      expect(typeof value).toBe('string');
    }
  });

  it('reports a run with no plan at all as refused for the sheet', () => {
    trackPlan(record(), null, false);
    expect(planEvents(client)).toEqual([
      [
        'folding steps refused',
        { target_kind: 'whole_cp', refusal_reason: 'non_rectangular', duration_bucket: '<=2500' },
      ],
    ]);
  });

  it('reports a stopped run as cancelled, whatever the plan said', () => {
    trackPlan(record(), summary({ stopReason: 'aborted' }), true);
    expect(planEvents(client).map(([event]) => event)).toEqual(['folding steps cancelled']);
  });

  it.each([
    ['refused_sheet', 'non_rectangular'],
    ['point_cap', 'point_cap'],
    ['budget', 'budget'],
    ['too_many_approximations', 'too_many_approximations'],
  ])('reports a plan that stopped with %s as a refusal, reason %s', (stopReason, reason) => {
    trackPlan(record(), summary({ stopReason, exactnessClass: 'off_lattice' }), false);
    const [[event, properties]] = planEvents(client);
    expect(event).toBe('folding steps refused');
    expect(properties).toMatchObject({ refusal_reason: reason, exactness_class: 'off_lattice' });
  });

  it('does not count a partial plan that stopped for a non-refusal as refused', () => {
    trackPlan(record(), summary({ stopReason: 'unsolved' }), false);
    expect(planEvents(client).map(([event]) => event)).toEqual(['folding steps completed']);
  });
});
