import { describe, expect, it } from 'vitest';
import { projectFromSnapshot } from './snapshotMapper';
import type { PathSnapshot, TreeSnapshot } from './types';

function path(overrides: Partial<PathSnapshot> & Pick<PathSnapshot, 'id' | 'nodes'>): PathSnapshot {
  return {
    is_leaf: true,
    is_active: false,
    is_feasible: true,
    is_border: false,
    is_polygon: false,
    is_conditioned: false,
    ...overrides,
  };
}

function snapshot(paths: PathSnapshot[]): TreeSnapshot {
  return {
    summary: {
      scale: 1,
      is_feasible: true,
      cp_status: 'clean',
      nodes: 4,
      edges: 0,
      paths: paths.length,
      vertices: 0,
      creases: 0,
      facets: 0,
      leaf_nodes: 3,
      conditions: 0,
      conditioned_nodes: 0,
      conditioned_edges: 0,
      conditioned_paths: 0,
    },
    cp_status_report: {
      status: 'clean',
      bad_edges: [],
      bad_polys: [],
      bad_vertices: [],
      bad_creases: [],
      bad_facets: [],
    },
    paper: {
      width: 1,
      height: 1,
      scale: 1,
      has_symmetry: false,
      sym_loc: { x: 0.5, y: 0.5 },
      sym_angle: 0,
    },
    nodes: [
      {
        id: 1,
        label: 'n1',
        loc: { x: 0.5, y: 0.5 },
        is_leaf: false,
        is_pinned: false,
        is_conditioned: false,
        owner: 'Tree',
      },
      {
        id: 2,
        label: 'n2',
        loc: { x: 0.2, y: 0.2 },
        is_leaf: true,
        is_pinned: false,
        is_conditioned: false,
        owner: 'Tree',
      },
      {
        id: 3,
        label: 'n3',
        loc: { x: 0.8, y: 0.2 },
        is_leaf: true,
        is_pinned: false,
        is_conditioned: false,
        owner: 'Tree',
      },
      {
        id: 4,
        label: 'n4',
        loc: { x: 0.5, y: 0.8 },
        is_leaf: true,
        is_pinned: false,
        is_conditioned: false,
        owner: 'Tree',
      },
    ],
    edges: [],
    paths,
    vertices: [],
    creases: [],
    facets: [],
    conditions: [],
  };
}

describe('projectFromSnapshot', () => {
  it('keeps existing leaf paths and reference-visible non-leaf paths', () => {
    const project = projectFromSnapshot(
      snapshot([
        path({ id: 1, nodes: [2, 3] }),
        path({ id: 2, nodes: [1, 2], is_leaf: false, is_polygon: true }),
        path({ id: 3, nodes: [1, 3], is_leaf: false, is_conditioned: true }),
        path({ id: 4, nodes: [1, 4], is_leaf: false, is_active: true }),
        path({ id: 5, nodes: [1, 4], is_leaf: false }),
      ]),
    );

    expect(project.paths.map((visiblePath) => visiblePath.id)).toEqual([1, 2, 3, 4]);
    expect(project.paths.find((visiblePath) => visiblePath.id === 2)).toMatchObject({
      isLeaf: false,
      isPolygon: true,
    });
  });

  it('maps facet corridor edges for corridor selection', () => {
    const project = projectFromSnapshot({
      ...snapshot([]),
      summary: { ...snapshot([]).summary, vertices: 3, facets: 1 },
      vertices: [
        { id: 1, loc: { x: 0, y: 0 } },
        { id: 2, loc: { x: 1, y: 0 } },
        { id: 3, loc: { x: 0, y: 1 } },
      ],
      facets: [{ id: 1, vertices: [1, 2, 3], color: 1, corridor_edge: 7 }],
    });

    expect(project.facets).toEqual([
      {
        id: 1,
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        color: 'white',
        corridorEdge: 7,
      },
    ]);
  });
});
