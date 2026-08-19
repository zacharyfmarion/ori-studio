import { describe, expect, it } from 'vitest';
import type { TreeProject } from './sampleProject';
import {
  addSymmetryAuthoringPair,
  distanceToSymmetryAxis,
  findMirrorEdgeId,
  findMirrorNodeId,
  projectOntoSymmetryAxis,
  reflectPointAcrossSymmetryAxis,
  symmetrySide,
} from './symmetryAuthoring';

function project(
  nodes: TreeProject['nodes'],
  conditions: TreeProject['conditions'] = [],
  edges: TreeProject['edges'] = [],
): TreeProject {
  return {
    title: 'Symmetry test',
    paper: { width: 1, height: 1, symLoc: { x: 0.5, y: 0.5 }, symAngle: 90 },
    scale: 0.1,
    hasSymmetry: true,
    nodes,
    edges,
    paths: [],
    creases: [],
    facets: [],
    conditions,
  };
}

function edge(id: number, node1: number, node2: number): TreeProject['edges'][number] {
  return {
    id,
    label: `e${id}`,
    nodes: [node1, node2],
    length: 1,
    strain: 0,
    stiffness: 1,
    isConditioned: false,
  };
}

function node(id: number, x: number, y: number, isLeaf = true): TreeProject['nodes'][number] {
  return {
    id,
    label: `n${id}`,
    loc: { x, y },
    isLeaf,
    isPinned: false,
    isConditioned: false,
  };
}

describe('symmetry authoring helpers', () => {
  it('projects, reflects, and classifies points around the axis', () => {
    const axis = { loc: { x: 0.5, y: 0.5 }, angle: 90 };

    expect(projectOntoSymmetryAxis({ x: 0.25, y: 0.7 }, axis)).toEqual({
      x: 0.5,
      y: 0.7,
    });
    expect(reflectPointAcrossSymmetryAxis({ x: 0.25, y: 0.7 }, axis)).toEqual({
      x: 0.75,
      y: 0.7,
    });
    expect(distanceToSymmetryAxis({ x: 0.47, y: 0.25 }, axis)).toBeCloseTo(0.03);
    expect(symmetrySide({ x: 0.25, y: 0.7 }, axis)).toBe(-1);
    expect(symmetrySide({ x: 0.5, y: 0.7 }, axis)).toBe(0);
    expect(symmetrySide({ x: 0.75, y: 0.7 }, axis)).toBe(1);
  });

  it('tracks mirror counterparts from authoring pairs after leaf conditions become internal', () => {
    const design = project(
      [
        node(1, 0.5, 0.5, false),
        node(2, 0.25, 0.5, false),
        node(3, 0.75, 0.5, false),
        node(4, 0.2, 0.7),
        node(5, 0.8, 0.7),
      ],
      [{ id: 1, isFeasible: true, kind: { type: 'nodes_paired', node1: 4, node2: 5 } }],
      [edge(1, 1, 2), edge(2, 1, 3), edge(3, 2, 4), edge(4, 3, 5)],
    );
    const pairs = addSymmetryAuthoringPair([], 2, 3);

    expect(findMirrorNodeId(design, pairs, 2)).toBe(3);
    expect(findMirrorNodeId(design, pairs, 4)).toBe(5);
    expect(findMirrorEdgeId(design, pairs, 1)).toBe(2);
    expect(findMirrorEdgeId(design, pairs, 3)).toBe(4);
  });
});
