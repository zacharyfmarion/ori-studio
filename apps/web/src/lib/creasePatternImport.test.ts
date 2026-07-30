import { describe, expect, it } from 'vitest';
import {
  foldArtifactsFromFold,
  parseImportedCreasePattern,
  parseImportedCreasePatternFromFold,
  segmentationFoldArtifactsFromFold,
} from './creasePatternImport';

describe('crease pattern import', () => {
  it('parseImportedCreasePatternFromFold matches the stringify+reparse path', () => {
    const fold = {
      file_spec: 1.1,
      frame_title: 'square',
      vertices_coords: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 2],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'M'],
    };
    const source = { format: 'fold' as const, filename: 'square.fold', path: null };

    const viaText = parseImportedCreasePattern(JSON.stringify(fold), source);
    const viaObject = parseImportedCreasePatternFromFold(fold, source);

    expect(viaObject).toEqual(viaText);
  });

  it('parses ORIPA CP lines and infers simulatable faces', () => {
    const result = parseImportedCreasePattern(
      [
        '1 0 0 1 0',
        '1 1 0 1 1',
        '1 1 1 0 1',
        '1 0 1 0 0',
        '2 0 0 1 1',
      ].join('\n'),
      { format: 'cp', filename: 'square.cp', path: null }
    );

    expect(result.document.source.format).toBe('cp');
    expect(result.document.lineOnly).toBe(false);
    expect(result.document.stats.faces).toBe(2);
    expect(result.project.creases.some((crease) => crease.fold === 'mountain')).toBe(true);
    expect(result.foldArtifacts.simulation_model?.fold.faces_vertices).toHaveLength(2);
  });

  it('keeps a line-only CP document when no faces can be inferred', () => {
    const result = parseImportedCreasePattern('2 0 0 1 1', {
      format: 'cp',
      filename: 'line.cp',
      path: null,
    });

    expect(result.document.lineOnly).toBe(true);
    expect(result.project.creases).toHaveLength(1);
    expect(result.project.facets).toHaveLength(0);
    expect(result.foldArtifacts.simulation_model).toBeNull();
    expect(result.foldArtifacts.simulation_model_error).toContain('Simulation requires');
  });

  it('selects the first useful FOLD crease-pattern frame with faces', () => {
    const fold = {
      file_title: 'multi frame',
      vertices_coords: [
        [0, 0],
        [1, 0],
      ],
      edges_vertices: [[0, 1]],
      edges_assignment: ['M'],
      file_frames: [
        {
          frame_title: 'usable cp',
          frame_classes: ['creasePattern'],
          vertices_coords: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
          edges_vertices: [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0],
          ],
          edges_assignment: ['B', 'B', 'B', 'B'],
          faces_vertices: [[0, 1, 2, 3]],
        },
        {
          frame_title: 'embedded folded',
          frame_classes: ['foldedForm'],
          frame_parent: 1,
          frame_inherit: true,
          vertices_coords: [
            [0, 0],
            [0.5, 0],
            [0, 0.5],
          ],
          edges_vertices: [
            [0, 1],
            [1, 2],
            [2, 0],
          ],
          edges_assignment: ['B', 'B', 'B'],
          faces_vertices: [[0, 1, 2]],
          faceOrders: [[0, 0, -1]],
        },
      ],
    };

    const result = parseImportedCreasePattern(JSON.stringify(fold), {
      format: 'fold',
      filename: 'multi.fold',
      path: null,
    });

    expect(result.document.selectedFrame?.index).toBe(1);
    expect(result.document.selectedFrame?.title).toBe('usable cp');
    expect(result.document.foldFrames).toHaveLength(3);
    expect(result.document.foldedFormFrames).toHaveLength(1);
    expect(result.document.foldedFormFrames[0]).toMatchObject({
      index: 2,
      title: 'embedded folded',
      parentIndex: 1,
      inherited: true,
      foldedForm: true,
      faces: 1,
    });
    expect(result.document.sourceFold?.file_frames?.[1]?.frame_title).toBe('embedded folded');
    expect(result.document.stats.faces).toBe(1);
    expect(result.project.title).toBe('usable cp');
  });
  it('splits every crossing when inferring topology (broad-phase guard)', () => {
    // splitSegments uses a swept bounding-box broad phase rather than testing all
    // pairs. These counts were verified to match the naive all-pairs
    // implementation exactly; lines in general position put nearly every vertex
    // at a crossing, so a broad phase that skipped a real pair — or that fed the
    // asymmetric intersection predicate its arguments in the wrong order — moves
    // these numbers.
    const cp = (count: number) => {
      let seed = 987654321;
      const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      return Array.from({ length: count }, (_, i) =>
        `${i % 3 === 0 ? 1 : 2} ${rand().toFixed(6)} ${rand().toFixed(6)} ${rand().toFixed(6)} ${rand().toFixed(6)}`
      ).join('\n');
    };

    const topology = (text: string) => {
      const { fold } = parseImportedCreasePattern(text, {
        format: 'cp',
        filename: 'general.cp',
        path: null,
      }).document;
      return {
        vertices: fold.vertices_coords.length,
        edges: fold.edges_vertices.length,
        faces: fold.faces_vertices.length,
      };
    };

    expect(topology(cp(30))).toEqual({ vertices: 192, edges: 290, faces: 99 });
    expect(topology(cp(60))).toEqual({ vertices: 606, edges: 1000, faces: 396 });
  });

  /**
   * Regression: inferring topology rebuilds the edge list (segments split at
   * intersections, coincident ones merge, survivors come out in a new order),
   * so the source fold's per-edge extension arrays no longer describe it. They
   * used to be carried over verbatim, and because the edge *count* can survive
   * unchanged a length check could not catch it. The CP kernel's importer
   * trusts `oristudio:edges_line_colors` over `edges_assignment`, so the stale
   * array came back as scrambled crease types — borders exporting as mountains
   * and valleys.
   */
  it('keeps per-edge extension arrays aligned when topology is inferred', () => {
    // Edges are deliberately not in the order the rebuild emits them, so a
    // carried-over array lands on the wrong creases.
    const fold = {
      file_spec: 1.1,
      vertices_coords: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      edges_vertices: [
        [2, 3],
        [0, 1],
        [3, 0],
        [1, 2],
      ],
      edges_assignment: ['M', 'B', 'V', 'F'],
      // Oriedita line colours: 0 = border, 1 = mountain, 2 = valley, 3 = aux.
      // All four differ, so the rebuild's reordering cannot cancel itself out.
      'oristudio:edges_line_colors': [1, 0, 2, 3],
      faces_vertices: [],
    } as unknown as Parameters<typeof segmentationFoldArtifactsFromFold>[0];

    const { fold: inferred } = segmentationFoldArtifactsFromFold(fold);
    const colors = (inferred as unknown as Record<string, number[]>)[
      'oristudio:edges_line_colors'
    ];
    expect(colors).toHaveLength(inferred.edges_vertices.length);

    // Every rebuilt edge must carry the colour of the source edge with the same
    // geometry, and that colour must agree with its assignment.
    const expectedFor = new Map([
      ['0,2|2,2', 1],
      ['0,0|2,0', 0],
      ['0,0|0,2', 2],
      ['2,0|2,2', 3],
    ]);
    const key = (index: number) => {
      const [a, b] = inferred.edges_vertices[index]!;
      const pa = inferred.vertices_coords[a]!;
      const pb = inferred.vertices_coords[b]!;
      return [`${pa[0]},${pa[1]}`, `${pb[0]},${pb[1]}`].sort().join('|');
    };
    const colorForAssignment: Record<string, number> = { B: 0, M: 1, V: 2, F: 3 };

    inferred.edges_vertices.forEach((_edge, index) => {
      expect(colors[index]).toBe(expectedFor.get(key(index)));
      expect(colors[index]).toBe(colorForAssignment[inferred.edges_assignment![index]!]);
    });
  });

  it('simulates a crease drawn as two collinear segments as one crease', () => {
    // From test_files/simulation/inline_simulate_issue.osf. The crease to the
    // top-right corner is two collinear mountains (1-5, 5-4) and the faces beside
    // it are quads whose rings walk through vertex 5. Triangulating through that
    // vertex made a zero-area sliver, the degenerate filter deleted it, and both
    // halves were left incident to no face -- so the crease neither folded nor
    // drew, while the flat diagonal invented in its place was pinned at 0.
    //
    // This is the app's own path rather than the simulator package's: it prepares
    // twice, around a face-winding pass and a fold-angle sign flip.
    const fold = {
      vertices_coords: [
        [-200, 200],
        [200, 200],
        [200, -200],
        [-200, -200],
        [0, 0],
        [150, 150],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 4],
        [1, 5],
        [4, 5],
        [3, 4],
        [2, 4],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'M', 'M', 'M', 'M', 'V'],
      edges_foldAngle: [0, 0, 0, 0, -180, -180, -180, -180, 180],
      faces_vertices: [
        [0, 1, 5, 4],
        [1, 2, 4, 5],
        [2, 3, 4],
        [0, 4, 3],
      ],
    } as unknown as Parameters<typeof foldArtifactsFromFold>[0];

    const artifacts = foldArtifactsFromFold(fold);
    const simulation = artifacts.simulation_model?.fold;
    expect(artifacts.simulation_model_error).toBeNull();
    expect(simulation).toBeDefined();
    if (!simulation) return;

    // Vertex 5 and its two halves are gone, replaced by one mountain diagonal.
    expect(simulation.vertices_coords).toHaveLength(5);
    const centre = simulation.vertices_coords.findIndex(([x, , z]) => x === 0 && z === 0);
    const corner = simulation.vertices_coords.findIndex(([x, , z]) => x === 200 && z === 200);
    const diagonal = simulation.edges_vertices.findIndex(
      ([a, b]) => (a === centre && b === corner) || (a === corner && b === centre)
    );
    expect(diagonal).toBeGreaterThanOrEqual(0);
    expect(simulation.edges_assignment?.[diagonal]).toBe('M');

    // Every mountain and valley drives a crease: four faces around the centre,
    // each edge between two of them. An M or V edge with any other count is one
    // the solver ignores and the renderer never draws.
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
  });
});
