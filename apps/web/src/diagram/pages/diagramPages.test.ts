import { describe, expect, it, vi } from 'vitest';
import { createDiagram, insertSteps, type DiagramStep } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { largestHeld, layoutDiagram, leastOverrunHeld, MEASURE_SETTLED, OVERRUN_SAME_MM, type RoomMeasure } from './diagramPages';
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

describe('leastOverrunHeld', () => {
  /** A picture as measured at each scale, and every scale it was measured at; a card's measure is the one at `card`. */
  function room(measure: (scale: number) => RoomMeasure, card: number) {
    const scales: number[] = [];
    return {
      scales,
      measureAt: (scale: number | null) => {
        scales.push(scale ?? card);
        return measure(scale ?? card);
      },
    };
  }

  it('takes the largest scale that holds, where its marks hang out of nothing, measuring nothing more', () => {
    const fits = room(() => ({ fit: 4.2, overrun: 0, floor: 2 }), 4.2);
    expect(leastOverrunHeld(fits.measureAt)).toBe(4.2);
    const held = room(() => ({ fit: 4.2, overrun: 0, floor: 2 }), 4.2);
    largestHeld((scale) => held.measureAt(scale)!.fit);
    // The one measure more: how far it hangs out there.
    expect(fits.scales.length).toBe(held.scales.length + 1);
  });

  it('takes a smaller scale whose marks hang out less, where a mark shrinks with the paper (review 4)', () => {
    // The crane's step bd19b22a at a 12 pt pen in a B5 4×4 cell: it holds up to 0.0292 with nothing hanging
    // out, and again near 0.0417 with 1.1 mm out, which a measure there alone takes for the least.
    const bd19 = room((scale) => {
      const overrun = scale <= 0.0292 ? 0 : scale < 0.0355 ? (1.13 * (scale - 0.0292)) / 0.0063 : 1.13 - (0.04 * (scale - 0.0355)) / 0.0062;
      const fit = scale <= 0.0292 ? 0.0292 : scale < 0.0397 ? 0.0292 + 0.5 * (scale - 0.0292) : 0.0417;
      return { fit, overrun: Math.max(0, overrun), floor: 0.0225 };
    }, 0.0417);
    // Measured where it holds, a scale alone says nothing of the region below.
    expect(largestHeld((scale) => bd19.measureAt(scale)!.fit)).toBeCloseTo(0.0417, 6);
    const found = leastOverrunHeld(bd19.measureAt)!;
    // The top of the lower region: it holds there, hanging out as little as the least.
    const there = bd19.measureAt(found)!;
    expect(found).toBeGreaterThan(0.0292 * (1 - 1e-3));
    expect(found).toBeLessThan(0.0292 * (1 + 1e-3));
    expect(there.fit!).toBeGreaterThanOrEqual(found * (1 - MEASURE_SETTLED));
    expect(there.overrun).toBeLessThanOrEqual(OVERRUN_SAME_MM);
    expect(bd19.scales.length).toBeLessThan(40);
  });

  it('keeps the largest scale where its marks hang out as far at every scale down to its floor', () => {
    // Letters larger than the room: shrinking the paper takes nothing of them out of it.
    const letters = room((scale) => ({ fit: 0.0146, overrun: 1.4, floor: scale * 0 + 0.008 }), 0.0146);
    expect(leastOverrunHeld(letters.measureAt)).toBe(0.0146);
  });

  it('takes the largest scale that hangs out no more than the least, where its marks shrink toward the floor', () => {
    // Its heads capped by their arcs: they reach out of the room less the smaller the paper, out of it not at all under 0.02.
    const heads = room((scale) => ({ fit: 0.04, overrun: Math.max(0, 30 * (scale - 0.02)), floor: 0.015 }), 0.04);
    const found = leastOverrunHeld(heads.measureAt)!;
    expect(30 * (found - 0.02)).toBeLessThanOrEqual(OVERRUN_SAME_MM + 1e-9);
    expect(30 * (found - 0.02)).toBeGreaterThan(OVERRUN_SAME_MM * 0.99);
    // Below a scale given, it looks below it only.
    expect(leastOverrunHeld(heads.measureAt, 0.018)).toBeLessThan(0.018);
  });
});

describe('layoutDiagram', () => {
  it('draws a picture that holds its room but hangs out of it alone, smaller, where it hangs out less (review 4)', async () => {
    const actual = await vi.importActual<typeof import('./pagePictures')>('./pagePictures');
    const step: DiagramStep = {
      ...cpStep('step-x'),
      annotations: [{ id: 'a', kind: 'valley-line', from: [0.2, 0.5], to: [0.8, 0.5] }],
    };
    const document = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [step], 0);
    const line = (grows: number, beyond: number) => ({ grows, beyond });
    /** A unit-square paper picture, its marks `beyond` mm past each side across, shrinking as the paper grows. */
    const square = (beyond: number) => ({
      kind: 'paper' as const,
      width: 1 - (beyond > 0 ? 1 : 0),
      height: 1,
      frame: { width: 1, height: 1 },
      marks: { width: 2 * beyond, height: 0 },
      sides: { left: line(beyond > 0 ? -0.5 : 0, beyond), right: line(beyond > 0 ? -0.5 : 0, beyond), top: line(0, 0), bottom: line(0, 0) },
    });
    let marks = (_scale: number | null) => 0;
    vi.mocked(layoutPicture).mockImplementation((entry, assets, style, measure) =>
      entry.id === 'step-x' ? square(marks(measure && 'mmPerUnit' in measure ? measure.mmPerUnit : null)) : actual.layoutPicture(entry, assets, style, measure)
    );
    try {
      const plain = layoutDiagram(document, estimateTextSetter).pages[0]!.cells[0]!;
      const { w, h } = plain.drawMm;
      const room = Math.min(w, h);
      // From 0.7 of the room up, marks that hang 2 mm out of either side whatever the paper's size — the
      // reach of a glyph larger than the paper — and none below it, as an arrowhead capped by its arc.
      const below = 0.7 * room;
      marks = (scale) => (scale === null || scale >= below ? w / 2 + 2 : 0);
      const cell = layoutDiagram(document, estimateTextSetter).pages[0]!.cells[0]!;
      expect(cell.mmPerUnit!).toBeLessThan(below);
      expect(cell.mmPerUnit!).toBeGreaterThan(below * 0.99);
    } finally {
      vi.mocked(layoutPicture).mockImplementation(actual.layoutPicture);
    }
  });

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
