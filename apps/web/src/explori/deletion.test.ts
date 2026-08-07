import { describe, expect, it } from 'vitest';
import { createExploriDocument, type ExploriDocument } from './document';
import { deletableExploriNodeId } from './deletion';

/**
 *   0 (root) ── 1 ── 2      and      0 ── 3
 *
 * So 2 and 3 are leaves, 1 is interior, and 0 is the root.
 */
function tree(): ExploriDocument {
  return {
    ...createExploriDocument(),
    nodes: [
      { id: 0, loc: { x: 0, y: 0 }, name: '' },
      { id: 1, loc: { x: 0, y: 1 }, name: '' },
      { id: 2, loc: { x: 0, y: 2 }, name: '' },
      { id: 3, loc: { x: 1, y: 0 }, name: '' },
    ],
    edges: [
      { id: 10, vertices: [0, 1], length: 1 },
      { id: 11, vertices: [1, 2], length: 1 },
      { id: 12, vertices: [0, 3], length: 1 },
    ],
  };
}

describe('what a delete would remove', () => {
  it('removes a selected leaf', () => {
    expect(deletableExploriNodeId(tree(), { kind: 'vertex', id: 2 })).toBe(2);
    expect(deletableExploriNodeId(tree(), { kind: 'vertex', id: 3 })).toBe(3);
  });

  it('refuses the root, which has no edge to go with it', () => {
    expect(deletableExploriNodeId(tree(), { kind: 'vertex', id: 0 })).toBeNull();
  });

  it('refuses an interior node, because what hangs below it has nowhere to go', () => {
    expect(deletableExploriNodeId(tree(), { kind: 'vertex', id: 1 })).toBeNull();
  });

  it('reads an edge selection as the branch it leads to', () => {
    // Pointing at the branch 1–2 means the flap on its end, not the join.
    expect(deletableExploriNodeId(tree(), { kind: 'edge', id: 11 })).toBe(2);
    expect(deletableExploriNodeId(tree(), { kind: 'edge', id: 12 })).toBe(3);
  });

  it('refuses an edge whose far end is not a leaf', () => {
    // 0–1: the root cannot go, and 1 still carries a subtree.
    expect(deletableExploriNodeId(tree(), { kind: 'edge', id: 10 })).toBeNull();
  });

  it('has nothing to remove with nothing selected', () => {
    expect(deletableExploriNodeId(tree(), null)).toBeNull();
    expect(deletableExploriNodeId(tree(), { kind: 'vertex', id: 99 })).toBeNull();
    expect(deletableExploriNodeId(tree(), { kind: 'edge', id: 99 })).toBeNull();
  });
});

/**
 * Mirror draw makes deletion a question about both halves.
 *
 * This predicate decides whether Edit ▸ Delete is *enabled*; `deleteExploriNode`
 * decides whether it *runs*. They used to ask different questions — this one
 * looked only at the selected node, the executor also resolved the mirror
 * partner — so a leaf whose partner had become interior left the menu item live
 * and doing nothing at all.
 */
describe('deletableExploriNodeId — with a mirror partner', () => {
  /** Root, leaf L and its twin T, plus a child hanging under T. */
  function treeWithInteriorPartner(enabled: boolean): ExploriDocument {
    return {
      ...createExploriDocument(),
      nodes: [
        { id: 0, loc: { x: 0, y: 0 }, name: '' },
        { id: 1, loc: { x: 1, y: 1 }, name: '' },
        { id: 2, loc: { x: -1, y: 1 }, name: '' },
        { id: 3, loc: { x: -2, y: 2 }, name: '' },
      ],
      edges: [
        { id: 0, vertices: [0, 1], length: 1 },
        { id: 1, vertices: [0, 2], length: 1 },
        { id: 2, vertices: [2, 3], length: 1 },
      ],
      nextNodeId: 4,
      nextEdgeId: 3,
      symmetry: { enabled, pairs: [{ v1: 1, v2: 2 }] },
    };
  }

  it('refuses a leaf whose partner has become interior', () => {
    const document = treeWithInteriorPartner(true);
    expect(deletableExploriNodeId(document, { kind: 'vertex', id: 1 })).toBeNull();
  });

  it('allows it once mirror draw is off, since only the one node goes', () => {
    const document = treeWithInteriorPartner(false);
    expect(deletableExploriNodeId(document, { kind: 'vertex', id: 1 })).toBe(1);
  });

  it('still allows a leaf whose partner is also a leaf', () => {
    const document = treeWithInteriorPartner(true);
    const bothLeaves = {
      ...document,
      nodes: document.nodes.filter((node) => node.id !== 3),
      edges: document.edges.filter((edge) => edge.id !== 2),
    };
    expect(deletableExploriNodeId(bothLeaves, { kind: 'vertex', id: 1 })).toBe(1);
  });
});
