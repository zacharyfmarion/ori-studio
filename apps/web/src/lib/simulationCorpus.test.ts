import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseImportedCreasePatternFromFold } from './creasePatternImport';

/**
 * Whole-pattern regression coverage on a real box-pleated CP.
 *
 * This runs the path the app runs — face inference, then two `prepareFoldModel`
 * passes around a winding pass and a fold-angle flip — which is why it lives here
 * rather than in the simulator package: `inferTopology` is not importable from
 * there, and this file's stored FOLD projection carries no faces.
 *
 * The fixture is a 24-generation iguana design (7910 creases) contributed for
 * this purpose, with its embedded reference images removed; the crease pattern is
 * untouched. Its hand-drawn creases include collinear splits, which no fixture
 * built in this repo had, and which stranded four mountains before this branch.
 */
// Vitest runs from apps/web; the shared fixture tree is at the repo root.
const FIXTURE = resolve(process.cwd(), '../../tests/fixtures/simulation/iguana_24.osf');

describe('iguana_24 crease pattern', () => {
  it('prepares a simulation model with every crease driven', () => {
    const project = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const document = project.workspace.documents.find(
      (candidate: { kind: string }) => candidate.kind === 'crease-pattern',
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

    // A mountain or valley incident to anything other than two faces is a crease
    // the solver ignores and the renderer never draws. Four of these survived here
    // before the collinear-split fix.
    const facesPerEdge = simulation.edges_vertices.map(() => 0);
    (simulation.faces_edges ?? []).forEach((faceEdges) => {
      faceEdges.forEach((edge) => {
        if (edge >= 0) facesPerEdge[edge] = (facesPerEdge[edge] ?? 0) + 1;
      });
    });
    const orphans = simulation.edges_vertices.filter((_edge, index) => {
      const assignment = simulation.edges_assignment?.[index];
      return (assignment === 'M' || assignment === 'V') && facesPerEdge[index] !== 2;
    });

    expect(orphans).toEqual([]);
    expect(simulation.faces_vertices.length).toBeGreaterThan(0);
    expect(simulation.vertices_coords.every((coord) => coord.every(Number.isFinite))).toBe(true);
  });
});
