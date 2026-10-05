import { describe, expect, it, vi } from 'vitest';
import { createDiagram, insertSteps, type DiagramStep } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { largestHeld, layoutDiagram, MEASURE_SETTLED } from './diagramPages';
import { estimateTextSetter } from './estimateTextSetter';
import { layoutPicture } from './pagePictures';

// Every measure counted, each as it was.
vi.mock('./pagePictures', async (original) => {
  const actual = await original<typeof import('./pagePictures')>();
  return { ...actual, layoutPicture: vi.fn(actual.layoutPicture) };
});

/** A picture's fit as measured at a scale, and every scale it was measured at. */
function measured(fit: (scale: number) => number) {
  const scales: number[] = [];
  return {
    scales,
    fitAt: (scale: number | null) => {
      const at = scale ?? 1;
      scales.push(at);
      return fit(at);
    },
  };
}

describe('largestHeld', () => {
  it('takes a reach of straight pieces at its own fit, in a step or two', () => {
    // Measured anywhere, the fit read is the same: the reach is one line.
    const straight = measured(() => 4.2);
    expect(largestHeld(straight.fitAt)).toBe(4.2);
    expect(straight.scales.length).toBeLessThanOrEqual(3);
    // A reach that curves: each measure's line lands nearer, as Newton's method does.
    const curved = measured((scale) => 3 + 0.2 * Math.sqrt(scale));
    const found = largestHeld(curved.fitAt)!;
    expect(Math.abs(3 + 0.2 * Math.sqrt(found) - found)).toBeLessThan(MEASURE_SETTLED * found);
    expect(curved.scales.length).toBeLessThan(8);
  });

  it('finds where a reach that hides the paper starts to grow, which no scale is its own fit at (third review)', () => {
    // Below 6.6 the reach is flat and fits the room's 10.2; above it, it grows and fits 5.38.
    const knee = measured((scale) => (scale < 6.6 ? 10.2 : 5.38));
    const found = largestHeld(knee.fitAt)!;
    expect(found).toBeLessThan(6.6);
    expect(found).toBeGreaterThan(6.6 * (1 - 2 * MEASURE_SETTLED));
    expect(knee.scales.length).toBeLessThan(40);
  });

  it('returns only a scale found to hold, below one found not to when given', () => {
    // Holding only in patches: whatever it returns, it held there.
    const patchy = (scale: number) => (Math.floor(scale * 3) % 2 === 0 ? 10 : 0.1);
    const found = largestHeld(measured(patchy).fitAt)!;
    expect(patchy(found)).toBeGreaterThanOrEqual(found * (1 - MEASURE_SETTLED));
    // Given a scale it does not hold at, it looks below it.
    const below = largestHeld(measured(() => 4.2).fitAt, 3)!;
    expect(below).toBeLessThan(3);
    expect(below).toBeGreaterThan(3 * (1 - 2 * MEASURE_SETTLED));
    // Holding nowhere: the fit read at the smallest scale tried, never more.
    const nowhere = largestHeld(measured((scale) => scale / 2).fitAt)!;
    expect(nowhere).toBeLessThan(1e-6);
    expect(largestHeld(() => null)).toBeNull();
  });
});

describe('layoutDiagram', () => {
  it('measures each picture once at each scale, however often its search, the layouts and their check ask (review 4)', () => {
    // Pictures whose marks reach past them, so each is searched for in its rooms and checked where drawn.
    const steps: DiagramStep[] = [0, 1, 2, 3].map((index) => ({
      ...cpStep(`step-${index}`),
      annotations: [{ id: 'a', kind: 'valley-arrow', from: [0.2, 0.004 + 0.1 * index], to: [0.8, 0.004], bend: 0.05 }],
    }));
    const document = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), steps, 0);
    for (const scale of ['fit', 'paper'] as const) {
      vi.mocked(layoutPicture).mockClear();
      layoutDiagram({ ...document, page: { ...document.page, scale } }, estimateTextSetter);
      const measures = vi.mocked(layoutPicture).mock.calls.map(([step, , , measure]) => `${step.id} ${JSON.stringify(measure)}`);
      expect(measures.length, scale).toBeGreaterThan(steps.length);
      expect(new Set(measures).size, scale).toBe(measures.length);
    }
  });
});
