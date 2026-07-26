import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { FIXTURES } from '../bench/fixtures.js';

// The fixture set is shared by benchmarks, parity gates and invariant tests, so
// it needs its own guard: a fixture that silently stops producing geometry
// would quietly weaken every gate built on top of it.

describe('fixture set', () => {
  it('has unique names', () => {
    const names = FIXTURES.map((fixture) => fixture.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      it('prepares into a non-empty triangulated model', () => {
        const prepared = prepareFoldModel(fixture.build(), { triangulate: true });
        expect(prepared.vertexCount).toBeGreaterThan(0);
        expect(prepared.faceCount).toBeGreaterThan(0);
        expect(prepared.edgeCount).toBeGreaterThan(0);
        // Triangulation must leave only triangles; the solver indexes faces as
        // flat triples and would read garbage otherwise.
        for (const face of prepared.facesVertices) {
          expect(face).toHaveLength(3);
        }
        expect(prepared.indices).toHaveLength(prepared.faceCount * 3);
        for (const index of prepared.indices) {
          expect(index).toBeLessThan(prepared.vertexCount);
        }
      });

      it('steps without producing NaN or Inf', () => {
        const prepared = prepareFoldModel(fixture.build(), { triangulate: true });
        const model = new OrigamiModel(prepared);
        const solver = new ReferenceSolver(model, { foldPercent: 100 });
        solver.step(50);
        for (const value of model.positions) {
          expect(Number.isFinite(value)).toBe(true);
        }
      });
    });
  }
});

describe('non-degenerate fixtures', () => {
  // Degenerate fixtures only have to survive; these have to actually fold.
  for (const fixture of FIXTURES.filter((f) => !f.degenerate)) {
    it(`${fixture.name} moves away from flat when folded`, () => {
      const prepared = prepareFoldModel(fixture.build(), { triangulate: true });
      const model = new OrigamiModel(prepared);
      const flat = model.positions.slice();
      const solver = new ReferenceSolver(model, { foldPercent: 100 });
      solver.step(100);

      let maxDelta = 0;
      for (let i = 0; i < flat.length; i += 1) {
        maxDelta = Math.max(maxDelta, Math.abs(flat[i]! - model.positions[i]!));
      }
      expect(maxDelta).toBeGreaterThan(1e-3);
    });
  }
});
