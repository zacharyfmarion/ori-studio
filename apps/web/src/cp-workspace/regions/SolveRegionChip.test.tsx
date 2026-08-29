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
          container={container}
          hiddenCount={0}
          state={state}
          onSolve={handlers.onSolve ?? NOOP}
          onStop={handlers.onStop ?? NOOP}
          onAccept={handlers.onAccept ?? NOOP}
          onTryAgain={handlers.onTryAgain ?? NOOP}
          onSelect={NOOP}
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

/** The chip's own status readout, so its `title` can be read as well as its text. */
function status(): HTMLElement {
  const found = chip().querySelector<HTMLElement>('.cp-region-chip__status');
  if (!found) throw new Error('the chip rendered no status line');
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
    // region says about itself, and the base chip's controls are still on the
    // bar beside the solve ones.
    expect(chip().textContent).toContain('Detected candidate');
    expect(chip().textContent).toContain('Kawasaki (angles)');
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

  it('names the stage rather than showing a spinner', () => {
    renderChip({ status: 'solving', stage: 'geometry', cancellable: false, stopping: false });
    expect(chip().textContent).toContain('Solving geometry');
    // Stage 1 fails fast; stage 2 is up to six accepted refinement rounds, so
    // they are different waits and get different sentences. Nothing solve-shaped
    // is pressable meanwhile — what is left are the suppression controls, which
    // a running solve has no reason to take away.
    expect(() => button('Solve')).toThrow();

    renderChip({ status: 'solving', stage: 'refining', cancellable: false, stopping: false });
    expect(chip().textContent).toContain('Refining to fold precision');
  });

  it('offers Stop only for a run that can actually be stopped', () => {
    // The degradation rule, at the surface: a solve dispatched onto a transport
    // nothing can reach shows the wait and no button, rather than a Stop that
    // writes into nothing.
    const onStop = vi.fn();
    renderChip({ status: 'solving', stage: 'geometry', cancellable: false, stopping: false });
    expect(() => button('Stop')).toThrow();

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

    // Rounded up, so the claim stays true: 0.42 px reads "< 1 px".
    expect(chip().textContent).toContain('Solved · 45 vertices moved < 1 px');

    act(() => button('Try again').click());
    expect(onTryAgain).toHaveBeenCalledTimes(1);
    act(() => button('Accept').click());
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('agrees with itself on one moved vertex', () => {
    renderChip({ status: 'solved', movedVertices: 1, maxMovementPx: 2.1, ...EXACT });
    expect(chip().textContent).toContain('Solved · 1 vertex moved < 3 px');
  });

  /**
   * The regression this half of the chip exists for. `status: 'solved'` means the
   * coordinates landed, not that the pattern is done — an accepted-but-ambiguous
   * solve on `mid-solve_2.osf` improved Kawasaki 1,900x and left all 70 angle
   * markers standing, under a chip that said "Solved".
   */
  it('reports what an ambiguous solve actually did, rather than "Solved"', () => {
    renderChip({
      status: 'solved',
      movedVertices: 45,
      maxMovementPx: 0.42,
      completion: 'improved',
      residuals: RESIDUALS,
    });

    const line = status();
    expect(line.textContent).toBe('Improved · worst angle 14.4° → 0.007°');
    expect(line.textContent).not.toContain('Solved');
    // The chip cannot wrap, so the numbers it cannot fit are one hover away.
    expect(line.title).toContain('0.000001°');
  });

  it('names the odd-degree cause first, and counts the repair sites', () => {
    renderChip({
      status: 'solved',
      movedVertices: 45,
      maxMovementPx: 0.42,
      completion: 'unfoldable',
      residuals: { ...RESIDUALS, oddDegreeVerticesAfter: 3 },
    });

    expect(status().textContent).toBe('Not foldable · 3 vertices to repair');
    expect(status().title.startsWith('3 vertices still have an odd number of creases')).toBe(true);
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
    expect(status().textContent).toContain('worst angle');
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
