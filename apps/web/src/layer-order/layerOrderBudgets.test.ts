import { describe, expect, it } from 'vitest';
import {
  LAYER_ORDER_COUNT_MAX_OPEN_PAIRS,
  LAYER_ORDER_COUNT_SLICE,
  LAYER_ORDER_LABEL_CAP,
  layerOrderCountStarts,
  layerOrderStepsCount,
} from './layerOrderBudgets';

/**
 * What census 2 measured (`scripts/layer-order-census.mjs`, its
 * `summary.md`; phase gate 2 of `implementation-plans/layer-order-dialog.md`),
 * the numbers each budget was set from. A budget that moves without a new
 * census fails here; a new census updates these first.
 */
const CENSUS_2 = {
  /** Open objects per pickable subject, over the corpus's 34,397. */
  objectsPerSubject: { p50: 8, p90: 34, p95: 46, p99: 87, max: 306 },
  /** At a cap of 50: the subjects whose objects all keep letters, and the designs where every subject's do. */
  atFifty: { subjects: 0.958, designs: 0.886 },
  /** Open pairs at open: the corpus's largest design, and iguana-c0. */
  openPairs: { corpusMax: 16_352, iguana: 65_851 },
  /** The longest count call (its start or a slice), ms. */
  longestCountCallMs: { corpus: 59.28, iguana: 643.9 },
  /** Every corpus slice of `{ maxNodes: 1000, deadlineMs: 30 }`, ms. */
  sliceMs: { p50: 30.1, p95: 33.6, max: 59.28 },
} as const;

describe('the Layer order dialog’s budgets, as census 2 set them', () => {
  it('letter every open object of the p95 subject, and cap the p99 one', () => {
    expect(LAYER_ORDER_LABEL_CAP).toBe(50);
    expect(LAYER_ORDER_LABEL_CAP).toBeGreaterThanOrEqual(CENSUS_2.objectsPerSubject.p95);
    expect(LAYER_ORDER_LABEL_CAP).toBeLessThan(CENSUS_2.objectsPerSubject.p99);
    expect(CENSUS_2.atFifty.subjects).toBeGreaterThanOrEqual(0.95);
  });

  it('count every corpus design, and not the iguana', () => {
    expect(LAYER_ORDER_COUNT_MAX_OPEN_PAIRS).toBe(20_000);
    expect(layerOrderCountStarts(CENSUS_2.openPairs.corpusMax)).toBe(true);
    expect(layerOrderCountStarts(LAYER_ORDER_COUNT_MAX_OPEN_PAIRS)).toBe(true);
    expect(layerOrderCountStarts(LAYER_ORDER_COUNT_MAX_OPEN_PAIRS + 1)).toBe(false);
    expect(layerOrderCountStarts(CENSUS_2.openPairs.iguana)).toBe(false);
    // Where the count runs, no call of it kept a preview waiting 100 ms.
    expect(CENSUS_2.longestCountCallMs.corpus).toBeLessThan(100);
    expect(CENSUS_2.longestCountCallMs.iguana).toBeGreaterThan(100);
  });

  it('count in the slice census 2 timed', () => {
    expect(LAYER_ORDER_COUNT_SLICE).toEqual({ maxNodes: 1_000, fastNodes: 128, deadlineMs: 30 });
    expect(CENSUS_2.sliceMs.p50).toBeLessThan(LAYER_ORDER_COUNT_SLICE.deadlineMs + 5);
    expect(CENSUS_2.sliceMs.max).toBeLessThan(100);
  });

  it('count in a host’s steps where the count starts, and never in the dialog’s, which counts in slices (E9)', () => {
    expect(layerOrderStepsCount('host', CENSUS_2.openPairs.corpusMax)).toBe(true);
    expect(layerOrderStepsCount('host', LAYER_ORDER_COUNT_MAX_OPEN_PAIRS)).toBe(true);
    expect(layerOrderStepsCount('host', LAYER_ORDER_COUNT_MAX_OPEN_PAIRS + 1)).toBe(false);
    expect(layerOrderStepsCount('host', CENSUS_2.openPairs.iguana)).toBe(false);
    expect(layerOrderStepsCount('dialog', 0)).toBe(false);
    expect(layerOrderStepsCount('dialog', CENSUS_2.openPairs.corpusMax)).toBe(false);
    expect(layerOrderStepsCount('dialog', CENSUS_2.openPairs.iguana)).toBe(false);
  });
});
