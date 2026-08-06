import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/queryResponse.json';
import {
  createExploriDocument,
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
      JSON.stringify({ nodes: [{ id: 0, loc: { x: 0, y: 0 } }, { id: 1 }], edges: [] })
    );
    expect(partial.nodes).toHaveLength(1);
  });

  it('drops an edge that names a node the document does not have', () => {
    const parsed = parseExploriDocument(
      JSON.stringify({
        nodes: [{ id: 0, loc: { x: 0, y: 0 } }],
        edges: [{ id: 1, vertices: [0, 7], length: 1 }],
      })
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
