import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/queryResponse.json';
import {
  createExploriDocument,
  effectiveExploriDbConfigs,
  exploriEditableTree,
  parseExploriDocument,
  serializeExploriDocument,
  type ExploriDocument,
} from './document';
import type { ExploriResult } from './types';

function drawn(): ExploriDocument {
  return {
    ...createExploriDocument(),
    nodes: [
      { id: 0, loc: { x: 0, y: 0 }, name: '' },
      { id: 1, loc: { x: 0, y: 2 }, name: 'head' },
      { id: 2, loc: { x: 1, y: -1 }, name: '' },
    ],
    edges: [
      { id: 1, vertices: [0, 1], length: 2 },
      { id: 2, vertices: [0, 2], length: Math.SQRT2 },
    ],
    nextNodeId: 3,
    nextEdgeId: 3,
  };
}

describe('the ExplOri document', () => {
  it('round-trips through the text a park and a save both use', () => {
    const document = { ...drawn(), selected: fixture.results[0] as unknown as ExploriResult };
    const restored = parseExploriDocument(serializeExploriDocument(document));
    expect(restored.nodes).toEqual(document.nodes);
    expect(restored.edges).toEqual(document.edges);
    expect(restored.dbConfigs).toEqual(document.dbConfigs);
    // The chosen result comes back whole, which is what makes a saved design
    // work with the archive unreachable.
    expect(restored.selected?.cp.vertices.length).toBeGreaterThan(0);
  });

  it('opens a damaged document rather than failing it', () => {
    expect(parseExploriDocument('not json').nodes).toHaveLength(1);
    expect(parseExploriDocument('{"nodes":[]}').nodes).toHaveLength(1);
    // A node with no position is unusable; the rest of the document is not.
    const partial = parseExploriDocument(
      JSON.stringify({ nodes: [{ id: 0, loc: { x: 0, y: 0 } }, { id: 1 }], edges: [] }),
    );
    expect(partial.nodes).toHaveLength(1);
  });

  it('drops an edge that names a node the document does not have', () => {
    const parsed = parseExploriDocument(
      JSON.stringify({
        nodes: [{ id: 0, loc: { x: 0, y: 0 } }],
        edges: [{ id: 1, vertices: [0, 7], length: 1 }],
      }),
    );
    expect(parsed.edges).toHaveLength(0);
  });

  it('never hands back an id that is already taken', () => {
    const parsed = parseExploriDocument(serializeExploriDocument(drawn()));
    expect(parsed.nextNodeId).toBeGreaterThan(2);
    expect(parsed.nextEdgeId).toBeGreaterThan(2);
  });
});

describe('the editable tree it presents', () => {
  it('calls a node of degree one a leaf, root included', () => {
    const tree = exploriEditableTree(drawn());
    expect(tree.vertices.find((vertex) => vertex.id === 1)?.isLeaf).toBe(true);
    expect(tree.vertices.find((vertex) => vertex.id === 0)?.isLeaf).toBe(false);
    expect(tree.rootVertexId).toBe(0);
  });

  it('has a single node, which is a leaf and the root', () => {
    const tree = exploriEditableTree(createExploriDocument());
    expect(tree.vertices).toHaveLength(1);
    expect(tree.vertices[0].isRoot).toBe(true);
    expect(tree.vertices[0].isLeaf).toBe(true);
  });

  it('gives every edge no ceiling, because there is no paper to overflow', () => {
    for (const edge of exploriEditableTree(drawn()).edges) expect(edge.maxLength).toBeNull();
  });
});

describe('which databases a search uses', () => {
  const withNodes = (...points: [number, number][]): ExploriDocument => ({
    ...createExploriDocument(),
    nodes: [
      { id: 0, loc: { x: 0, y: 0 }, name: '' },
      ...points.map(([x, y], index) => ({ id: index + 1, loc: { x, y }, name: '' })),
    ],
  });
  const symmetriesOf = (document: ExploriDocument) =>
    new Set(effectiveExploriDbConfigs(document).map((config) => config.symmetry));

  it('leaves the asymmetric archive out for a symmetric tree', () => {
    // Two leaves reflected about x = 0, and one sitting on it.
    expect(symmetriesOf(withNodes([2, 1], [-2, 1], [0, 3]))).toEqual(new Set(['diag', 'book']));
  });

  it('includes it for a tree that is not symmetric', () => {
    expect(symmetriesOf(withNodes([2, 1], [-2, 1], [1.5, -2]))).toEqual(
      new Set(['diag', 'book', 'none']),
    );
  });

  it('reads symmetry off the drawing, not off the recorded pairs', () => {
    // A tree drawn symmetrically with mirror draw off has no pairs at all, and is
    // symmetric all the same.
    const drawn = { ...withNodes([2, 1], [-2, 1]), symmetry: { enabled: false, pairs: [] } };
    expect(symmetriesOf(drawn)).toEqual(new Set(['diag', 'book']));
  });

  it('stops guessing once the user has chosen', () => {
    const chosen: ExploriDocument = {
      ...withNodes([2, 1], [-2, 1]),
      dbConfigs: [{ N: 3, symmetry: 'none' }],
      dbConfigsDirty: true,
    };
    // Symmetric drawing, but the choice is theirs and stands.
    expect(effectiveExploriDbConfigs(chosen)).toEqual([{ N: 3, symmetry: 'none' }]);
  });

  it('remembers that they chose, across a save', () => {
    const chosen: ExploriDocument = {
      ...withNodes([2, 1]),
      dbConfigs: [{ N: 2, symmetry: 'book' }],
      dbConfigsDirty: true,
    };
    const reopened = parseExploriDocument(serializeExploriDocument(chosen));
    expect(reopened.dbConfigsDirty).toBe(true);
    expect(effectiveExploriDbConfigs(reopened)).toEqual([{ N: 2, symmetry: 'book' }]);
  });
});
