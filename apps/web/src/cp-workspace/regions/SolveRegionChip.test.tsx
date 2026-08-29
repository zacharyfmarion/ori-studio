import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
import { SolveRegionChip, type CpRegionSolveState } from './SolveRegionChip';

/**
 * The solve half. It composes the base chip rather than replacing it, so every
 * assertion here is also an assertion that the suppression summary survived.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

let host: HTMLDivElement;
let container: HTMLDivElement;
let root: Root;

const NOOP = () => {};
const REGION = createCpSuppressionRegion({
  center: { x: 0.5, y: 0.5 },
  width: 1,
  height: 1,
  label: 'Detected candidate',
  solveInput: { spans: [] },
});

function renderChip(
  state: CpRegionSolveState,
  handlers: {
    expanded?: boolean;
    onSolve?: () => void;
    onAccept?: () => void;
    onTryAgain?: () => void;
  } = {}
): void {
  act(() => {
    root.render(
      <TooltipProvider>
        <SolveRegionChip
          region={REGION}
          container={container}
          expanded={handlers.expanded ?? false}
          hiddenCount={0}
          state={state}
          onSolve={handlers.onSolve ?? NOOP}
          onAccept={handlers.onAccept ?? NOOP}
          onTryAgain={handlers.onTryAgain ?? NOOP}
          onSelect={NOOP}
          onToggleCheckClass={NOOP}
          onOpacity={NOOP}
          onGestureStart={NOOP}
          onGestureCommit={NOOP}
          onBringToFront={NOOP}
          onSendToBack={NOOP}
          onDelete={NOOP}
        />
      </TooltipProvider>
    );
  });
}

function chip(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[role="toolbar"]');
  if (!element) throw new Error('the chip did not render');
  return element;
}

function button(label: string): HTMLButtonElement {
  const found = [...chip().querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === label
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

beforeEach(() => {
  cpOverlayViewStore.set({
    model: { origin: [100, 100], ex: [200, 0], ey: [0, 200] },
    user: { origin: [100, 100], ex: [200, 0], ey: [0, 200] },
  });
  container = document.createElement('div');
  container.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  document.body.appendChild(container);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  container.remove();
});

describe('SolveRegionChip', () => {
  it('renders the base chip and appends to it', () => {
    renderChip({ status: 'idle' });

    // Composition, not replacement: the suppression summary is still what the
    // region says about itself.
    expect(chip().textContent).toContain('Detected candidate');
    expect(chip().textContent).toContain('Kawasaki (angles)');
    expect(chip().textContent).toContain('Solve');
  });

  it('offers Solve without being selected', () => {
    const onSolve = vi.fn();
    renderChip({ status: 'idle' }, { expanded: false, onSolve });

    act(() => button('Solve').click());
    expect(onSolve).toHaveBeenCalledTimes(1);
  });

  it('names the stage rather than showing a spinner', () => {
    renderChip({ status: 'solving', stage: 'geometry' });
    expect(chip().textContent).toContain('Solving geometry');
    // Stage 1 fails fast; stage 2 is up to six accepted refinement rounds, so
    // they are different waits and get different sentences.
    expect(chip().querySelectorAll('button').length).toBe(1); // the summary only

    renderChip({ status: 'solving', stage: 'refining' });
    expect(chip().textContent).toContain('Refining to fold precision');
  });

  it('becomes a two-button gate once it has solved', () => {
    const onAccept = vi.fn();
    const onTryAgain = vi.fn();
    renderChip(
      { status: 'solved', movedVertices: 45, maxMovementPx: 0.42 },
      { onAccept, onTryAgain }
    );

    // Rounded up, so the claim stays true: 0.42 px reads "< 1 px".
    expect(chip().textContent).toContain('Solved · 45 vertices moved < 1 px');

    act(() => button('Try again').click());
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    act(() => button('Accept').click());
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('agrees with itself on one moved vertex', () => {
    renderChip({ status: 'solved', movedVertices: 1, maxMovementPx: 2.1 });
    expect(chip().textContent).toContain('Solved · 1 vertex moved < 3 px');
  });

  it('reports the specific refusal, and offers a retry rather than a revert', () => {
    const onSolve = vi.fn();
    const onTryAgain = vi.fn();
    renderChip(
      { status: 'failed', reason: 'movement budget exceeded' },
      { onSolve, onTryAgain }
    );

    expect(chip().textContent).toContain('Could not solve — movement budget exceeded');
    // The document is unchanged on every non-acceptance — the solver hands back
    // the input coordinates — so there is nothing to revert, and a "Try again"
    // here would imply the failed attempt had landed.
    expect(() => button('Try again')).toThrow();
    expect(chip().textContent).not.toContain('Accept');

    act(() => button('Solve').click());
    expect(onSolve).toHaveBeenCalledTimes(1);
    expect(onTryAgain).not.toHaveBeenCalled();
  });

  it('offers the timeout partial, because "the solver got this far" is honest', () => {
    const onAccept = vi.fn();
    renderChip(
      { status: 'failed', reason: 'timed out after 25 s', partialMovedVertices: 448 },
      { onAccept }
    );

    expect(chip().textContent).toContain('timed out after 25 s');
    expect(chip().textContent).toContain('Partial result · 448 vertices');
    act(() => button('Accept').click());
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
