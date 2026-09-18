import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../bootstrap';
import { AnalyticsRuntimeProvider } from '../runtime';
import {
  useReferencesApproximationWarningEvent,
  type ReferencesApproximationWarningEventInput,
} from '../useReferencesApproximationWarningEvent';

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
    .filter((call) => call[0] === 'references approximation warning shown')
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
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Probe(input: ReferencesApproximationWarningEventInput) {
  useReferencesApproximationWarningEvent(input);
  return null;
}

function render(client: PostHogClientLike, node: ReactNode) {
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: node }));
  });
}

const shown = (overrides: Partial<ReferencesApproximationWarningEventInput> = {}) =>
  createElement(Probe, {
    open: true,
    reason: 'inexact',
    inexactSteps: 22,
    exactnessClass: 'off_lattice',
    ...overrides,
  });

describe('useReferencesApproximationWarningEvent', () => {
  it('stays silent while the warning is closed', () => {
    const client = makeFakeClient();
    render(client, shown({ open: false }));
    expect(events(client)).toEqual([]);
  });

  it('reports the opening once, with the reason, a bucketed count and the class', () => {
    const client = makeFakeClient();
    render(client, shown());
    render(client, shown());
    expect(events(client)).toEqual([
      { reason: 'inexact', inexact_steps_bucket: '<=50', exactness_class: 'off_lattice' },
    ]);
  });

  it('reports each opening, and an unknown class as exact', () => {
    const client = makeFakeClient();
    render(client, shown({ inexactSteps: 1, exactnessClass: null }));
    render(client, shown({ open: false }));
    render(client, shown({ inexactSteps: 300, exactnessClass: 'snappable' }));
    expect(events(client)).toEqual([
      { reason: 'inexact', inexact_steps_bucket: '<=1', exactness_class: 'exact' },
      { reason: 'inexact', inexact_steps_bucket: '<=500', exactness_class: 'snappable' },
    ]);
  });

  it('reports a plan that stopped rather than approximate as its own reason', () => {
    const client = makeFakeClient();
    render(client, shown({ reason: 'too_many', inexactSteps: 0 }));
    expect(events(client)).toEqual([
      { reason: 'too_many', inexact_steps_bucket: '<=1', exactness_class: 'off_lattice' },
    ]);
  });
});
