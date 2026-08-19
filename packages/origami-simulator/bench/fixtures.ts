// Shared fixture generators for benchmarks, parity gates and property tests.
//
// The set deliberately spans the shapes that break things, not just the ones
// that work: a regular grid (scaling curve), an irregular-valence base, a
// high-density box pleat, and a family of degenerate inputs.
import type { FoldAssignment, FoldDocument } from '../src/types.js';

export interface SimulatorFixture {
  /** Stable identifier; used as the golden-trace filename. */
  readonly name: string;
  readonly description: string;
  /** Approximate vertex count after triangulation, for bench table ordering. */
  readonly scale: 'tiny' | 'small' | 'medium' | 'large' | 'xl';
  /** Degenerate fixtures are expected to be handled gracefully, not to solve well. */
  readonly degenerate: boolean;
  build(): FoldDocument;
}

interface EdgeAccumulator {
  edges: [number, number][];
  assignment: FoldAssignment[];
  foldAngle: Array<number | null>;
}

function newEdges(): EdgeAccumulator {
  return { edges: [], assignment: [], foldAngle: [] };
}

function pushEdge(acc: EdgeAccumulator, u: number, v: number, kind: FoldAssignment): void {
  acc.edges.push([u, v]);
  acc.assignment.push(kind);
  acc.foldAngle.push(kind === 'M' ? -150 : kind === 'V' ? 150 : kind === 'F' ? 0 : null);
}

/**
 * Miura-ori: an `n` x `m` parallelogram grid of quads with alternating
 * mountain/valley assignment. The workhorse scaling fixture — regular topology,
 * every interior vertex degree 4, and it folds to a well-conditioned state.
 */
export function makeMiura(n: number, m: number): FoldDocument {
  const angle = Math.PI / 3;
  const index = (i: number, j: number) => i * (m + 1) + j;
  const vertices: number[][] = [];
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      vertices.push([i + (j % 2 === 0 ? 0 : Math.cos(angle) * 0.25), j * Math.sin(angle), 0]);
    }
  }

  const acc = newEdges();
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (i < n) {
        const border = j === 0 || j === m;
        pushEdge(acc, index(i, j), index(i + 1, j), border ? 'B' : j % 2 === 0 ? 'M' : 'V');
      }
      if (j < m) {
        const border = i === 0 || i === n;
        pushEdge(acc, index(i, j), index(i, j + 1), border ? 'B' : i % 2 === 0 ? 'V' : 'M');
      }
    }
  }

  const faces: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      faces.push([index(i, j), index(i + 1, j), index(i + 1, j + 1), index(i, j + 1)]);
    }
  }

  return {
    vertices_coords: vertices,
    edges_vertices: acc.edges,
    edges_assignment: acc.assignment,
    edges_foldAngle: acc.foldAngle,
    faces_vertices: faces,
  };
}

/**
 * Box-pleated grid: a square grid with both diagonals in every other cell, so
 * crease density per vertex is far higher than a Miura and interior vertices
 * reach degree 8. This is the stress case for the per-vertex crease gather.
 */
export function makeBoxPleat(n: number): FoldDocument {
  const index = (i: number, j: number) => i * (n + 1) + j;
  const vertices: number[][] = [];
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) vertices.push([i, j, 0]);
  }

  const acc = newEdges();
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      if (i < n) {
        const border = j === 0 || j === n;
        pushEdge(acc, index(i, j), index(i + 1, j), border ? 'B' : (i + j) % 2 === 0 ? 'M' : 'V');
      }
      if (j < n) {
        const border = i === 0 || i === n;
        pushEdge(acc, index(i, j), index(i, j + 1), border ? 'B' : (i + j) % 2 === 0 ? 'V' : 'M');
      }
    }
  }

  // Diagonals on a checkerboard, alternating direction — this is what drives
  // interior valence up and makes the crease gather irregular.
  const faces: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const a = index(i, j);
      const b = index(i + 1, j);
      const c = index(i + 1, j + 1);
      const d = index(i, j + 1);
      if ((i + j) % 2 === 0) {
        pushEdge(acc, a, c, (i * 7 + j * 3) % 2 === 0 ? 'M' : 'V');
        faces.push([a, b, c], [a, c, d]);
      } else {
        pushEdge(acc, b, d, (i * 5 + j) % 2 === 0 ? 'V' : 'M');
        faces.push([a, b, d], [b, c, d]);
      }
    }
  }

  return {
    vertices_coords: vertices,
    edges_vertices: acc.edges,
    edges_assignment: acc.assignment,
    edges_foldAngle: acc.foldAngle,
    faces_vertices: faces,
  };
}

/**
 * Classic bird base: a square with the full diagonal/angle-bisector crease set.
 * Irregular, non-grid topology with a degree-8 centre vertex — the closest
 * small fixture to what TreeMaker actually emits.
 */
export function makeBirdBase(): FoldDocument {
  // 0-3 corners, 4-7 edge midpoints, 8 centre.
  const vertices = [
    [0, 0, 0],
    [2, 0, 0],
    [2, 2, 0],
    [0, 2, 0],
    [1, 0, 0],
    [2, 1, 0],
    [1, 2, 0],
    [0, 1, 0],
    [1, 1, 0],
  ];
  const acc = newEdges();
  // Boundary, split at the midpoints.
  pushEdge(acc, 0, 4, 'B');
  pushEdge(acc, 4, 1, 'B');
  pushEdge(acc, 1, 5, 'B');
  pushEdge(acc, 5, 2, 'B');
  pushEdge(acc, 2, 6, 'B');
  pushEdge(acc, 6, 3, 'B');
  pushEdge(acc, 3, 7, 'B');
  pushEdge(acc, 7, 0, 'B');
  // Diagonals through the centre.
  pushEdge(acc, 0, 8, 'V');
  pushEdge(acc, 1, 8, 'V');
  pushEdge(acc, 2, 8, 'V');
  pushEdge(acc, 3, 8, 'V');
  // Midpoint spokes: the book/cupboard folds.
  pushEdge(acc, 4, 8, 'M');
  pushEdge(acc, 5, 8, 'M');
  pushEdge(acc, 6, 8, 'M');
  pushEdge(acc, 7, 8, 'M');

  const faces = [
    [0, 4, 8],
    [4, 1, 8],
    [1, 5, 8],
    [5, 2, 8],
    [2, 6, 8],
    [6, 3, 8],
    [3, 7, 8],
    [7, 0, 8],
  ];

  return {
    vertices_coords: vertices,
    edges_vertices: acc.edges,
    edges_assignment: acc.assignment,
    edges_foldAngle: acc.foldAngle,
    faces_vertices: faces,
  };
}

/** The existing 4-vertex smoke test: unit square, one mountain diagonal. */
export function makeBookFold(): FoldDocument {
  return {
    file_spec: 1.2,
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
      [0, 2],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M'],
    edges_foldAngle: [null, null, null, null, -180],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

/** A face with three collinear vertices — zero area, undefined normal. */
export function makeZeroAreaFace(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [1, 3],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M'],
    edges_foldAngle: [null, null, null, null, -180],
    faces_vertices: [
      [0, 1, 3],
      [1, 2, 3],
    ],
  };
}

/** Two triangles sharing only a vertex — a disconnected-ish component. */
export function makeDisconnected(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [0, 1],
      [3, 3],
      [4, 3],
      [3, 4],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 0],
      [3, 4],
      [4, 5],
      [5, 3],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B'],
    edges_foldAngle: [null, null, null, null, null, null],
    faces_vertices: [
      [0, 1, 2],
      [3, 4, 5],
    ],
  };
}

/** A high-valence hub: one interior vertex joined to a 16-gon boundary. */
export function makeHighValence(spokes = 16): FoldDocument {
  const vertices: number[][] = [[0, 0, 0]];
  for (let i = 0; i < spokes; i += 1) {
    const t = (i / spokes) * Math.PI * 2;
    vertices.push([Math.cos(t), Math.sin(t), 0]);
  }
  const acc = newEdges();
  for (let i = 0; i < spokes; i += 1) {
    pushEdge(acc, 1 + i, 1 + ((i + 1) % spokes), 'B');
    pushEdge(acc, 0, 1 + i, i % 2 === 0 ? 'M' : 'V');
  }
  const faces: number[][] = [];
  for (let i = 0; i < spokes; i += 1) {
    faces.push([0, 1 + i, 1 + ((i + 1) % spokes)]);
  }
  return {
    vertices_coords: vertices,
    edges_vertices: acc.edges,
    edges_assignment: acc.assignment,
    edges_foldAngle: acc.foldAngle,
    faces_vertices: faces,
  };
}

/** An edge shared by three faces — invalid manifold, must not crash. */
export function makeNonManifoldEdge(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, -1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 0],
      [1, 3],
      [3, 2],
      [0, 4],
      [4, 1],
    ],
    edges_assignment: ['M', 'B', 'B', 'B', 'B', 'B', 'B'],
    edges_foldAngle: [-180, null, null, null, null, null, null],
    faces_vertices: [
      [0, 1, 2],
      [1, 3, 2],
      [0, 4, 1],
    ],
  };
}

/**
 * The full fixture set. `SCALING_FIXTURES` is the subset the throughput bench
 * walks; the degenerate entries exist for parity and invariant tests, where the
 * requirement is "handled gracefully", not "solves well".
 */
export const FIXTURES: readonly SimulatorFixture[] = [
  {
    name: 'book-fold',
    description: 'Unit square, single mountain diagonal (4 vertices)',
    scale: 'tiny',
    degenerate: false,
    build: makeBookFold,
  },
  {
    name: 'bird-base',
    description: 'Classic bird base; irregular valence, degree-8 centre',
    scale: 'tiny',
    degenerate: false,
    build: makeBirdBase,
  },
  {
    name: 'miura-8x8',
    description: 'Miura-ori 8x8',
    scale: 'tiny',
    degenerate: false,
    build: () => makeMiura(8, 8),
  },
  {
    name: 'miura-16x16',
    description: 'Miura-ori 16x16',
    scale: 'small',
    degenerate: false,
    build: () => makeMiura(16, 16),
  },
  {
    name: 'miura-32x32',
    description: 'Miura-ori 32x32',
    scale: 'medium',
    degenerate: false,
    build: () => makeMiura(32, 32),
  },
  {
    name: 'miura-56x56',
    description: 'Miura-ori 56x56',
    scale: 'large',
    degenerate: false,
    build: () => makeMiura(56, 56),
  },
  {
    name: 'miura-80x80',
    description: 'Miura-ori 80x80',
    scale: 'xl',
    degenerate: false,
    build: () => makeMiura(80, 80),
  },
  {
    name: 'boxpleat-24',
    description: 'Box-pleated 24x24 grid; high crease density, degree-8 interior',
    scale: 'medium',
    degenerate: false,
    build: () => makeBoxPleat(24),
  },
  {
    name: 'high-valence',
    description: '16-spoke hub around a single interior vertex',
    scale: 'tiny',
    degenerate: false,
    build: () => makeHighValence(16),
  },
  {
    name: 'degenerate-zero-area',
    description: 'Collinear triple producing a zero-area face',
    scale: 'tiny',
    degenerate: true,
    build: makeZeroAreaFace,
  },
  {
    name: 'degenerate-disconnected',
    description: 'Two triangles with no shared topology',
    scale: 'tiny',
    degenerate: true,
    build: makeDisconnected,
  },
  {
    name: 'degenerate-non-manifold',
    description: 'Edge incident to three faces',
    scale: 'tiny',
    degenerate: true,
    build: makeNonManifoldEdge,
  },
];

export const SCALING_FIXTURES: readonly SimulatorFixture[] = FIXTURES.filter(
  (fixture) => fixture.name.startsWith('miura-') || fixture.name === 'boxpleat-24',
);

export function fixtureByName(name: string): SimulatorFixture {
  const found = FIXTURES.find((fixture) => fixture.name === name);
  if (!found) throw new Error(`Unknown simulator fixture: ${name}`);
  return found;
}
