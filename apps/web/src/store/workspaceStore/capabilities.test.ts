import { describe, expect, it } from 'vitest';
import { historyCountForContext } from './capabilities';

describe('historyCountForContext', () => {
  const bp = 5;
  const cp = 4;
  const tree = 3;

  it('routes the count to each context own history stack', () => {
    expect(historyCountForContext('bp-tree', bp, cp, tree)).toBe(bp);
    expect(historyCountForContext('bp-packing', bp, cp, tree)).toBe(bp);
    expect(historyCountForContext('crease-pattern', bp, cp, tree)).toBe(cp);
    expect(historyCountForContext('treemaker-tree', bp, cp, tree)).toBe(tree);
  });

  it('reports zero for read-only/consumer contexts so undo stays inert', () => {
    // Simulate consumes the folded model and has no history of its own; the NUX
    // chooser predates any editable document.
    expect(historyCountForContext('simulate', bp, cp, tree)).toBe(0);
    expect(historyCountForContext('design-nux', bp, cp, tree)).toBe(0);
  });
});
