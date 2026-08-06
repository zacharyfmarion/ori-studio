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
