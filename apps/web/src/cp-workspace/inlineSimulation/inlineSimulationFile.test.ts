import { describe, expect, it } from 'vitest';
import { validateInlineSimulation, validateInlineSimulations } from './inlineSimulationFile';

const valid = {
  id: 'inline-sim-1',
  box: { center: { x: 10, y: -20 }, width: 100, height: 80, rotation: 0.5 },
  z: 3,
  view: { yaw: 0.78, pitch: -0.95, zoom: 1.4 },
  sourceBoundary: [
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ],
  ],
  sourceBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  sourceFingerprint: 'cs1:abcd',
  segmentIdHint: 2,
};

describe('reading a window back out of a file', () => {
  it('accepts a well-formed window unchanged', () => {
    expect(validateInlineSimulation(valid)).toEqual(valid);
  });

  it('drops a window with no box, which has nowhere to be drawn', () => {
    expect(validateInlineSimulation({ ...valid, box: undefined })).toBeNull();
    expect(validateInlineSimulation({ ...valid, box: { ...valid.box, width: 0 } })).toBeNull();
  });

  it('drops a window with no id', () => {
    // The id keys the runtime table holding its fold.
    expect(validateInlineSimulation({ ...valid, id: '' })).toBeNull();
    expect(validateInlineSimulation({ ...valid, id: 7 })).toBeNull();
  });

  it('drops a window with an unusable camera rather than guessing one', () => {
    expect(validateInlineSimulation({ ...valid, view: { yaw: 0, pitch: 0, zoom: 0 } })).toBeNull();
  });

  it('keeps the fingerprint and bounds exactly, including when absent', () => {
    // These are what staleness compares. A window with no fingerprint reads as
    // "cannot tell", which the check treats as not stale — so downgrading a
    // field that was merely written oddly would silence the indicator for good.
    const bare = validateInlineSimulation({
      ...valid,
      sourceBounds: null,
      sourceFingerprint: null,
    });
    expect(bare?.sourceFingerprint).toBeNull();
    expect(bare?.sourceBounds).toBeNull();
    expect(validateInlineSimulation(valid)?.sourceFingerprint).toBe('cs1:abcd');
  });

  it('drops a window with no boundary, which can never be given a fold', () => {
    // `resolveInlineSimulationSegment` needs the rings; without them the window
    // loads as an empty frame that refreshing cannot repair either.
    expect(validateInlineSimulation({ ...valid, sourceBoundary: null })).toBeNull();
    expect(validateInlineSimulation({ ...valid, sourceBoundary: [] })).toBeNull();
  });

  it('drops a window whose boundary has a malformed point', () => {
    // A ring missing a vertex is a different region, and would resolve to the
    // wrong one — the failure that actually simulates the wrong part of the CP.
    expect(
      validateInlineSimulation({
        ...valid,
        sourceBoundary: [
          [
            { x: 0, y: 0 },
            { x: 'nope', y: 1 },
          ],
        ],
      }),
    ).toBeNull();
  });

  it('defaults only the fields where zero is a real answer', () => {
    const partial = validateInlineSimulation({
      ...valid,
      z: undefined,
      box: { ...valid.box, rotation: undefined },
      segmentIdHint: undefined,
    });
    expect(partial?.z).toBe(0);
    expect(partial?.box.rotation).toBe(0);
    expect(partial?.segmentIdHint).toBeNull();
  });
});

describe('reading the list', () => {
  it('skips malformed entries without losing the good ones', () => {
    const out = validateInlineSimulations([valid, null, 'nope', { id: 'x' }]);
    expect(out.map((s) => s.id)).toEqual(['inline-sim-1']);
  });

  it('drops duplicate ids', () => {
    // Two windows sharing an id would share one entry in the fold side table,
    // and so one mesh and one fold position between them.
    const out = validateInlineSimulations([valid, { ...valid, z: 9 }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.z).toBe(3);
  });

  it('is empty for anything that is not a list', () => {
    expect(validateInlineSimulations(undefined)).toEqual([]);
    expect(validateInlineSimulations({})).toEqual([]);
  });
});
