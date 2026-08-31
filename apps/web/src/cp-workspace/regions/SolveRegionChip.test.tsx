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

/**
 * The figures from `test_files/detect-cp/mid-solve_2.osf`: a 1,900x Kawasaki
 * improvement that still sat ~7,500x above the editor's own 1e-6° bar.
 */
const RESIDUALS = {
  maxKawasakiDegreesBefore: 14.367,
  maxKawasakiDegreesAfter: 0.00747,
  oddDegreeVerticesBefore: 3,
  oddDegreeVerticesAfter: 0,
};

/** A solve that reached foldable precision — the one ending that says "Solved". */
const EXACT = {
  completion: 'exact',
  residuals: { ...RESIDUALS, maxKawasakiDegreesAfter: 0, oddDegreeVerticesBefore: 0 },
} as const;

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
    onSolve?: () => void;
    onStop?: () => void;
    onAccept?: () => void;
    onTryAgain?: () => void;
  } = {}
): void {
  act(() => {
    root.render(
      <TooltipProvider>
        <SolveRegionChip
          region={REGION}
          image={null}
          container={container}
          hiddenCount={0}
          state={state}
          onSolve={handlers.onSolve ?? NOOP}
          onStop={handlers.onStop ?? NOOP}
          onAccept={handlers.onAccept ?? NOOP}
          onTryAgain={handlers.onTryAgain ?? NOOP}
          onSelect={NOOP}
          onToggleImageHidden={NOOP}
          onImageOpacity={NOOP}
          onDeleteImage={NOOP}
          onToggleCheckClass={NOOP}
          onMove={NOOP}
          onGestureStart={NOOP}
          onGestureCommit={NOOP}
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

/**
 * The running-solve spinner, so its accessible name can be read.
 *
 * The one thing on this half of the chip that is still not a button: a toast can
 * announce an ending but cannot carry a condition that lasts 25 s.
 */
function spinner(): HTMLElement {
  const found = chip().querySelector<HTMLElement>('.cp-region-chip__spinner');
  if (!found) throw new Error('the chip rendered no running-solve indicator');
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

    // Composition, not replacement: the region is still named accessibly by the
    // base chip, and the base chip's controls are still on the bar beside the
    // solve ones.
    expect(chip().getAttribute('aria-label')).toContain('Detected candidate');
    expect(chip().textContent).toContain('Solve');
    expect(document.querySelector('button[aria-label="Suppressed checks"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Delete region"]')).not.toBeNull();
  });

  it('offers Solve without being selected', () => {
    const onSolve = vi.fn();
    renderChip({ status: 'idle' }, { onSolve });

    act(() => button('Solve').click());
    expect(onSolve).toHaveBeenCalledTimes(1);
  });

  it('shows a running solve even when there is no Stop to show, and names its stage', () => {
    // The bar carries no prose, so the stage is the indicator's accessible name
    // rather than a sentence — but it is still named. Stage 1 fails fast and
    // stage 2 is up to six accepted refinement rounds, so they are different
    // waits. The indicator itself is not optional: with `cancellable: false`
    // there is no Stop either, and without it the chip would be indistinguishable
    // from idle for the whole 25 s.
    renderChip({ status: 'solving', stage: 'geometry', cancellable: false, stopping: false });
    expect(spinner().getAttribute('aria-label')).toBe('Solving geometry…');
    // Nothing solve-shaped is pressable meanwhile — what is left are the
    // suppression controls, which a running solve has no reason to take away.
    expect(() => button('Solve')).toThrow();

    renderChip({ status: 'solving', stage: 'refining', cancellable: false, stopping: false });
    expect(spinner().getAttribute('aria-label')).toBe('Refining to fold precision…');
  });

  it('offers Stop only for a run that can actually be stopped', () => {
    // The degradation rule, at the surface: a solve dispatched onto a transport
    // nothing can reach shows the wait and no button, rather than a Stop that
    // writes into nothing.
    const onStop = vi.fn();
    renderChip({ status: 'solving', stage: 'geometry', cancellable: false, stopping: false });
    expect(() => button('Stop')).toThrow();
    expect(spinner()).not.toBeNull();

    renderChip(
      { status: 'solving', stage: 'refining', cancellable: true, stopping: false },
      { onStop }
    );
    act(() => button('Stop').click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('says the stop is on its way rather than offering it twice', () => {
    const onStop = vi.fn();
    renderChip(
      { status: 'solving', stage: 'geometry', cancellable: true, stopping: true },
      { onStop }
    );

    const stopping = button('Stopping…');
    expect(stopping.hasAttribute('disabled')).toBe(true);
    act(() => stopping.click());
    expect(onStop).not.toHaveBeenCalled();
  });

  it('becomes a two-button gate once it has solved', () => {
    const onAccept = vi.fn();
    const onTryAgain = vi.fn();
    renderChip(
      { status: 'solved', movedVertices: 45, maxMovementPx: 0.42, ...EXACT },
      { onAccept, onTryAgain }
    );

    // What it *did* is the toast's, which has room for a sentence; the bar is
    // the gate. See `useCpRegionSolve.test.tsx` for the figures.
    expect(chip().textContent?.trim()).toBe('Try againAccept');

    act(() => button('Try again').click());
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    act(() => button('Accept').click());
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  /**
   * The regression this half of the chip exists for. `status: 'solved'` means the
   * coordinates landed, not that the pattern is done — an accepted-but-ambiguous
   * solve on `mid-solve_2.osf` improved Kawasaki 1,900x and left all 70 angle
   * markers standing, under a chip that said "Solved".
   */
  it('never says "Solved" on the bar, whatever the solve actually did', () => {
    // The regression this half of the chip exists for. `status: 'solved'` means
    // the coordinates landed, not that the pattern is done — an
    // accepted-but-ambiguous solve on `mid-solve_2.osf` improved Kawasaki 1,900x
    // and left all 70 angle markers standing, under a chip that said "Solved".
    // The bar now says nothing at all; the distinction lives in the toast, and
    // it survives here as the button labels.
    for (const completion of ['improved', 'unfoldable', 'approximate'] as const) {
      renderChip({
        status: 'solved',
        movedVertices: 45,
        maxMovementPx: 0.42,
        completion,
        residuals: { ...RESIDUALS, oddDegreeVerticesAfter: 3 },
      });
      expect(chip().textContent).not.toContain('Solved');
    }
  });

  it('keeps Accept reachable but stops it being the recommended answer', () => {
    const onAccept = vi.fn();
    const onTryAgain = vi.fn();
    renderChip(
      {
        status: 'solved',
        movedVertices: 45,
        maxMovementPx: 0.42,
        completion: 'improved',
        residuals: RESIDUALS,
      },
      { onAccept, onTryAgain }
    );

    // The coordinates are genuinely better, so keeping them stays a real choice —
    // it simply stops being called a plain Accept and stops being primary.
    expect(() => button('Accept')).toThrow();
    act(() => button('Accept anyway').click());
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(button('Accept anyway').className).not.toContain('ui-button--primary');
    expect(button('Try again').className).toContain('ui-button--primary');

    act(() => button('Try again').click());
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it('leaves the button emphasis alone when only the check disagrees', () => {
    // `approximate` is the solver calling it solved at a residual the editor's
    // own 1e-6° bar still flags. Nothing combinatorial is wrong, so there is
    // nothing to send the user back to repair — the sentence carries the news,
    // the buttons do not change.
    renderChip({
      status: 'solved',
      movedVertices: 45,
      maxMovementPx: 0.42,
      completion: 'approximate',
      residuals: { ...RESIDUALS, maxKawasakiDegreesAfter: 5e-4 },
    });

    expect(button('Accept').className).toContain('ui-button--primary');
    expect(() => button('Accept anyway')).toThrow();
  });

  it('offers a retry rather than a revert, and leaves the reason to the toast', () => {
    const onSolve = vi.fn();
    const onTryAgain = vi.fn();
    renderChip(
      { status: 'failed', reason: 'movement budget exceeded' },
      { onSolve, onTryAgain }
    );

    // The reason is the toast's — it is a sentence, and the bar is 200 px wide
    // at working zoom. `useCpRegionSolve` raises one for every ending that
    // reaches this state; `useCpRegionSolve.test.tsx` holds it to that.
    expect(chip().textContent).not.toContain('movement budget exceeded');
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

    // The count that decides whether the partial is worth taking moved to the
    // timeout toast, which is where the sentence around it lives.
    expect(chip().textContent).not.toContain('448');
    act(() => button('Accept').click());
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
