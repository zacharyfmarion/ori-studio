import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReferencesPlanSummary } from '../../store/workspaceStore/types';
import {
  useReferencesApproximationWarning,
  type ReferencesApproximationWarning,
} from './useReferencesApproximationWarning';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Only the fields the hook reads are real; the rest is a plan-shaped stub. */
function summary(overrides: Partial<ReferencesPlanSummary> = {}): ReferencesPlanSummary {
  return {
    inexactSteps: 0,
    exactnessClass: 'exact',
    stopReason: 'complete',
    computedAtRevision: 'r1',
    ...overrides,
  } as ReferencesPlanSummary;
}

let latest: ReferencesApproximationWarning | null = null;

/**
 * Declared once: a new component type per render would remount and lose the
 * hook's memory. Captured in an effect, not during render: `act` flushes
 * effects before it returns, so `latest` is current by the time a test reads it.
 */
function Probe({ value }: { value: ReferencesPlanSummary | null }) {
  const warning = useReferencesApproximationWarning(value);
  useEffect(() => {
    latest = warning;
  });
  return null;
}

function render(value: ReferencesPlanSummary | null) {
  act(() => root?.render(<Probe value={value} />));
}

describe('useReferencesApproximationWarning', () => {
  it('stays closed for a plan whose every step is exact', () => {
    render(summary());
    expect(latest?.open).toBe(false);
  });

  it('opens for a plan with inexact steps, carrying their count and the class', () => {
    render(summary({ inexactSteps: 22, exactnessClass: 'off_lattice' }));
    expect(latest?.open).toBe(true);
    expect(latest?.reason).toBe('inexact');
    expect(latest?.inexactSteps).toBe(22);
    expect(latest?.exactnessClass).toBe('off_lattice');
  });

  it('opens, as a failure, for a plan that stopped rather than approximate', () => {
    render(
      summary({
        stopReason: 'too_many_approximations',
        inexactSteps: 0,
        exactnessClass: 'off_lattice',
      })
    );
    expect(latest?.open).toBe(true);
    expect(latest?.reason).toBe('too_many');
    expect(latest?.exactnessClass).toBe('off_lattice');
  });

  it('stays closed for a plan that stopped for any other reason without inexact steps', () => {
    render(summary({ stopReason: 'unsolved' }));
    expect(latest?.open).toBe(false);
    render(summary({ stopReason: 'aborted', computedAtRevision: 'r2' }));
    expect(latest?.open).toBe(false);
  });

  it('closes on dismiss and does not reopen for the same plan', () => {
    const plan = summary({ inexactSteps: 3 });
    render(plan);
    act(() => latest?.dismiss());
    expect(latest?.open).toBe(false);
    render(plan);
    expect(latest?.open).toBe(false);
  });

  it('opens again for the next plan with inexact steps, not for an exact one', () => {
    render(summary({ inexactSteps: 3 }));
    act(() => latest?.dismiss());
    render(summary({ inexactSteps: 0, computedAtRevision: 'r2' }));
    expect(latest?.open).toBe(false);
    render(summary({ inexactSteps: 1, computedAtRevision: 'r3' }));
    expect(latest?.open).toBe(true);
  });

  it('closes when the plan goes away', () => {
    render(summary({ inexactSteps: 3 }));
    expect(latest?.open).toBe(true);
    render(null);
    expect(latest?.open).toBe(false);
    expect(latest?.inexactSteps).toBe(0);
  });
});
