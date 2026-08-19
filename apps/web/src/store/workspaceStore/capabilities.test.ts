import { describe, expect, it } from 'vitest';
import { historyCountForContext } from './capabilities';
import { singleBoxPleatDesignTab, singleDesignTab, type DesignTab } from './designTabs';

/**
 * Which history the Edit menu is counting.
 *
 * This used to name the kinds it knew and return 0 for everything else, which
 * *disabled* Undo and Redo for any design kind not on the list — and made the
 * dispatch behind them unreachable, so the bug read as "undo does nothing"
 * rather than as a greyed menu item. It asks the kind now.
 */
describe('historyCountForContext', () => {
  const cp = 4;

  function tabWith(
    kind: 'treemaker' | 'box-pleat' | 'explori',
    past: number,
    future: number,
  ): DesignTab {
    const base =
      kind === 'box-pleat'
        ? singleBoxPleatDesignTab({}).designTabs[0]
        : singleDesignTab(kind, 'Untitled').designTabs[0];
    if (base.kind === 'treemaker') {
      return {
        ...base,
        treemaker: {
          ...base.treemaker,
          historyPast: Array(past).fill('x'),
          historyFuture: Array(future).fill('x'),
        },
      };
    }
    if (base.kind === 'box-pleat') {
      return {
        ...base,
        boxPleat: {
          ...base.boxPleat,
          historyPast: Array(past).fill({}),
          historyFuture: Array(future).fill({}),
        },
      } as DesignTab;
    }
    if (base.kind === 'explori') {
      return {
        ...base,
        explori: {
          ...base.explori,
          historyPast: Array(past).fill('{}'),
          historyFuture: Array(future).fill('{}'),
        },
      };
    }
    return base;
  }

  it('asks the active design kind for its own depth', () => {
    expect(historyCountForContext('treemaker-tree', tabWith('treemaker', 3, 1), cp, 'past')).toBe(
      3,
    );
    expect(historyCountForContext('bp-tree', tabWith('box-pleat', 5, 2), cp, 'past')).toBe(5);
    expect(historyCountForContext('bp-packing', tabWith('box-pleat', 5, 2), cp, 'future')).toBe(2);
    // The one the old switch could not answer, which is the whole point.
    expect(historyCountForContext('explori-tree', tabWith('explori', 7, 0), cp, 'past')).toBe(7);
    expect(historyCountForContext('explori-results', tabWith('explori', 7, 4), cp, 'future')).toBe(
      4,
    );
  });

  it('lets the crease-pattern editor answer for itself', () => {
    // A workspace rather than a design kind, so it is not in the registry.
    expect(historyCountForContext('crease-pattern', tabWith('treemaker', 3, 3), cp, 'past')).toBe(
      cp,
    );
  });

  it('reports zero for read-only/consumer contexts so undo stays inert', () => {
    // Simulate consumes the folded model and has no history of its own; the NUX
    // chooser predates any editable document.
    expect(historyCountForContext('simulate', tabWith('treemaker', 3, 3), cp, 'past')).toBe(0);
    expect(historyCountForContext('design-nux', tabWith('treemaker', 3, 3), cp, 'past')).toBe(0);
  });

  it('reports zero when the tab is of a different kind than the context', () => {
    // A transient state on a tab switch: the context still names the outgoing
    // design's pane. Answering with the *incoming* tab's history would enable
    // undo against a stack that is not there.
    expect(historyCountForContext('bp-tree', tabWith('explori', 9, 9), cp, 'past')).toBe(0);
  });
});
