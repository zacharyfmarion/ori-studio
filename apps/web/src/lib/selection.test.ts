import { describe, expect, it } from 'vitest';
import { createSampleProject } from './sampleProject';
import {
  selectByIndex,
  selectCorridorFacets,
  isEdgeSelected,
  isNodeSelected,
  selectEverything,
  selectMovableParts,
  selectionCoversAllNodes,
  selectionSummary,
  toggleConditionSelection,
  toggleEdgeSelection,
  toggleNodeSelection,
} from './selection';

describe('selection helpers', () => {
  it('toggles node and edge multi-selection', () => {
    const withNode = toggleNodeSelection({ kind: 'tree' }, 2);
    expect(isNodeSelected(withNode, 2)).toBe(true);

    const withEdge = toggleEdgeSelection(withNode, 1);
    expect(isNodeSelected(withEdge, 2)).toBe(true);
    expect(isEdgeSelected(withEdge, 1)).toBe(true);
    expect(selectionSummary(withEdge)).toBe('1 nodes, 1 edges');

    expect(toggleNodeSelection(withEdge, 2)).toEqual({
      kind: 'multi',
      nodes: [],
      edges: [1],
      paths: [],
      creases: [],
      facets: [],
      conditions: [],
    });
  });

  it('selects every project part', () => {
    const selection = selectEverything(createSampleProject());
    expect(selection.kind).toBe('multi');
    if (selection.kind !== 'multi') return;
    expect(selection.nodes).toHaveLength(4);
    expect(selection.edges).toHaveLength(3);
    expect(selection.paths).toHaveLength(3);
    expect(selection.creases).toHaveLength(6);
    expect(selection.facets).toHaveLength(3);
    expect(selection.conditions).toHaveLength(0);
    expect(selectionCoversAllNodes(selection, createSampleProject())).toBe(true);
  });

  it('detects when a node selection clears the whole design', () => {
    const project = createSampleProject();

    expect(
      selectionCoversAllNodes(
        {
          kind: 'multi',
          nodes: [1, 2, 3, 4],
          edges: [],
          paths: [],
          creases: [],
          facets: [],
          conditions: [],
        },
        project,
      ),
    ).toBe(true);
    expect(
      selectionCoversAllNodes(
        {
          kind: 'multi',
          nodes: [1, 2, 3],
          edges: [],
          paths: [],
          creases: [],
          facets: [],
          conditions: [],
        },
        project,
      ),
    ).toBe(false);
  });

  it('selects a single part by TreeMaker index', () => {
    const project = createSampleProject();

    expect(selectByIndex(project, 'node', 2)).toEqual({ kind: 'node', id: 2 });
    expect(selectByIndex(project, 'facet', 1)).toEqual({ kind: 'facet', id: 1 });
    expect(selectByIndex(project, 'edge', 99)).toEqual({ kind: 'tree' });
  });

  it('selects movable leaf nodes and edges that are not fixed-length constrained', () => {
    const project = {
      ...createSampleProject(),
      nodes: createSampleProject().nodes.map((node) =>
        node.id === 2 ? { ...node, isPinned: true } : node,
      ),
      conditions: [
        {
          id: 1,
          isFeasible: true,
          kind: { type: 'edge_length_fixed' as const, edge: 2 },
        },
      ],
    };

    expect(selectMovableParts(project)).toEqual({
      kind: 'multi',
      nodes: [3, 4],
      edges: [1, 3],
      paths: [],
      creases: [],
      facets: [],
      conditions: [],
    });
  });

  it('selects facets by selected corridor edges and toggles conditions', () => {
    const project = {
      ...createSampleProject(),
      facets: createSampleProject().facets.map((facet, index) => ({
        ...facet,
        corridorEdge: index === 1 ? 2 : 1,
      })),
    };

    expect(selectCorridorFacets(project, [2])).toEqual({
      kind: 'multi',
      nodes: [],
      edges: [],
      paths: [],
      creases: [],
      facets: [2],
      conditions: [],
    });

    const selection = toggleConditionSelection({ kind: 'tree' }, 4);
    expect(selection).toEqual({
      kind: 'multi',
      nodes: [],
      edges: [],
      paths: [],
      creases: [],
      facets: [],
      conditions: [4],
    });
    expect(toggleConditionSelection(selection, 4)).toEqual({ kind: 'tree' });
  });
});
