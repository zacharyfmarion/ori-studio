import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../engine/types';
import { foldArtifactsFromFold, parseImportedCreasePatternFromFold } from './creasePatternImport';

/**
 * Whole-pattern regression coverage on real crease patterns, one per document
 * kind the app can simulate.
 *
 * This runs the path the app runs — face inference where needed, then two
 * `prepareFoldModel` passes around a winding pass and a fold-angle flip — which
 * is why it lives here rather than in the simulator package: `inferTopology` is
 * not importable from there.
 */
// Vitest runs from apps/web; the shared fixture tree is at the repo root.
const FIXTURES = resolve(process.cwd(), '../../tests/fixtures/simulation');

/**
 * Mountains and valleys incident to anything other than two faces: creases the
 * solver ignores and the renderer never draws.
 */
function orphanedCreases(fold: FoldDocument): number[][] {
  const facesPerEdge = fold.edges_vertices.map(() => 0);
  (fold.faces_edges ?? []).forEach((faceEdges) => {
    faceEdges.forEach((edge) => {
      if (edge >= 0) facesPerEdge[edge] = (facesPerEdge[edge] ?? 0) + 1;
    });
  });
  return fold.edges_vertices.filter((_edge, index) => {
    const assignment = fold.edges_assignment?.[index];
    return (assignment === 'M' || assignment === 'V') && facesPerEdge[index] !== 2;
  });
}

/**
 * A 24-generation iguana design (7910 creases) contributed for this purpose,
 * with its embedded reference images removed; the crease pattern is untouched.
 * Its hand-drawn creases include collinear splits, which no fixture built in
 * this repo had, and which stranded four mountains before they were merged.
 */
describe('iguana_24 crease pattern', () => {
  it('prepares a simulation model with every crease driven', () => {
    const project = JSON.parse(readFileSync(`${FIXTURES}/iguana_24.osf`, 'utf8'));
    const document = project.workspace.documents.find(
      (candidate: { kind: string }) => candidate.kind === 'crease-pattern'
    );
    const projection = document.creasePattern.foldProjection;

    const { foldArtifacts } = parseImportedCreasePatternFromFold(projection, {
      format: 'fold',
      filename: 'iguana_24.fold',
      path: null,
    });
    const simulation = foldArtifacts.simulation_model?.fold;
    expect(foldArtifacts.simulation_model_error).toBeNull();
    expect(simulation).toBeDefined();
    if (!simulation) return;

    expect(orphanedCreases(simulation)).toEqual([]);
    expect(simulation.faces_vertices.length).toBeGreaterThan(0);
    expect(simulation.vertices_coords.every((coord) => coord.every(Number.isFinite))).toBe(true);
  });
});

/**
 * The other kind of document that reaches the simulator: a TreeMaker design,
 * whose crease pattern arrives as `Tree::fold_artifacts().fold` rather than as
 * an Oriedita export. The engine used to prepare its mesh itself; now it hands
 * over the crease pattern and this path prepares it, so the conventions the two
 * producers write have to agree — 2D coordinates, and FOLD-standard fold angles
 * the winding pass is free to flip.
 *
 * The fixture is `tests/fixtures/generated/triad-optimized.tmd5` built through
 * `optimize_scale` + `build_polys_and_crease_pattern`, captured verbatim.
 */
describe('TreeMaker triad crease pattern', () => {
  it('prepares a simulation model from the engine fold artifacts', () => {
    const fold = JSON.parse(readFileSync(`${FIXTURES}/treemaker_triad.fold`, 'utf8')) as FoldDocument;
    expect(fold.vertices_coords.every((coord) => coord.length === 2)).toBe(true);

    const artifacts = foldArtifactsFromFold(fold);
    const simulation = artifacts.simulation_model?.fold;
    expect(artifacts.simulation_model_error).toBeNull();
    expect(simulation).toBeDefined();
    if (!simulation) return;

    expect(orphanedCreases(simulation)).toEqual([]);
    expect(simulation.faces_vertices.length).toBeGreaterThan(0);
    expect(simulation.vertices_coords.every((coord) => coord.every(Number.isFinite))).toBe(true);

    // Every crease the engine marked keeps its assignment, and carries the angle
    // that folds it in that direction against the normalized winding — the
    // negation of the FOLD-standard angle the engine wrote.
    const driven = simulation.edges_assignment
      ?.map((assignment, index) => ({ assignment, angle: simulation.edges_foldAngle?.[index] }))
      .filter(({ assignment }) => assignment === 'M' || assignment === 'V');
    expect(driven?.length).toBe(6);
    driven?.forEach(({ assignment, angle }) => {
      expect(angle).toBe(assignment === 'M' ? 180 : -180);
    });
  });

  it('simulates around a crease with only one incident face', () => {
    const fold = JSON.parse(
      readFileSync(`${FIXTURES}/treemaker_triad.fold`, 'utf8')
    ) as FoldDocument;
    // A mountain hanging off the pattern. The engine used to reject the whole
    // document over one of these (`BadCreaseTopology`) and report the design as
    // unsimulatable; this path drops the crease the solver could not have driven
    // anyway and folds the rest.
    fold.vertices_coords.push([2, 2]);
    fold.edges_vertices.push([0, fold.vertices_coords.length - 1]);
    fold.edges_assignment?.push('M');
    fold.edges_foldAngle?.push(-180);

    const artifacts = foldArtifactsFromFold(fold);

    expect(artifacts.simulation_model_error).toBeNull();
    expect(artifacts.simulation_model?.fold.faces_vertices.length).toBeGreaterThan(0);
  });
});
