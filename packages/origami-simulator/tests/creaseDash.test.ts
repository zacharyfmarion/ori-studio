import { describe, expect, it } from 'vitest';
import { MAX_DASH_RUNS, packCreaseDash } from '../src/webgl/meshRenderer.js';

/**
 * The edge shader's dash logic, as far as it can be checked without WebGL2. What
 * remains in the shader after this is a uniform upload and a `mod` against the
 * distance along the edge; the drawn result is browser-verified.
 */
describe('packing crease dashes for the edge shader', () => {
  it('packs by assignment code, so the shader indexes with no branch', () => {
    const { runs, counts } = packCreaseDash({
      border: null,
      mountain: [10, 3, 3, 3],
      valley: [8, 8],
    });
    // 0=B, 1=M, 2=V.
    expect([...counts]).toEqual([0, 4, 2]);
    expect([...runs.subarray(MAX_DASH_RUNS, MAX_DASH_RUNS + 4)]).toEqual([10, 3, 3, 3]);
    expect([...runs.subarray(MAX_DASH_RUNS * 2, MAX_DASH_RUNS * 2 + 2)]).toEqual([8, 8]);
  });

  it('reports zero runs for solid, which the shader reads as "no dash"', () => {
    expect([...packCreaseDash(undefined).counts]).toEqual([0, 0, 0]);
    expect([...packCreaseDash({ border: null, mountain: null, valley: null }).counts]).toEqual([
      0, 0, 0,
    ]);
    expect([...packCreaseDash({ border: null, mountain: [], valley: null }).counts]).toEqual([
      0, 0, 0,
    ]);
  });

  it('doubles an odd-length pattern, keeping "even run is ink" true', () => {
    // CSS and canvas both repeat an odd pattern inverted. Handling it here means
    // the shader never has to know about parity.
    const { runs, counts } = packCreaseDash({ border: null, mountain: [5, 2, 1], valley: null });
    expect(counts[1]).toBe(6);
    expect([...runs.subarray(MAX_DASH_RUNS, MAX_DASH_RUNS + 6)]).toEqual([5, 2, 1, 5, 2, 1]);
  });

  it('truncates past the shader’s array bound rather than overflowing it', () => {
    const { counts } = packCreaseDash({
      border: null,
      mountain: [1, 2, 3, 4, 5, 6, 7, 8],
      valley: null,
    });
    expect(counts[1]).toBe(MAX_DASH_RUNS);
  });

  it('clamps a negative run, which would run the modulo backwards', () => {
    const { runs } = packCreaseDash({ border: null, mountain: [4, -2], valley: null });
    expect(runs[MAX_DASH_RUNS + 1]).toBe(0);
  });

  it('leaves the array sized for exactly three kinds', () => {
    expect(packCreaseDash(undefined).runs).toHaveLength(3 * MAX_DASH_RUNS);
  });
});
