import { describe, expect, it } from 'vitest';
import { resolveEditingContext, type EditingContextInput } from './editingContext';

const base: EditingContextInput = {
  activePanelId: 'design',
  pendingDesignChoice: false,
  workflowTarget: 'treemaker',
  hasBpDocument: false,
};

describe('resolveEditingContext', () => {
  it('maps the design panel by design state', () => {
    expect(resolveEditingContext({ ...base, pendingDesignChoice: true })).toBe('design-nux');
    expect(resolveEditingContext(base)).toBe('treemaker-tree');
    expect(
      resolveEditingContext({ ...base, workflowTarget: 'box-pleat', hasBpDocument: true })
    ).toBe('bp-tree');
  });

  it('treats box-pleat as treemaker until the BP document exists', () => {
    // workflowTarget flips before the document is created; the design panel is
    // still the chooser/empty tree, so it must not resolve to bp-tree yet.
    expect(resolveEditingContext({ ...base, workflowTarget: 'box-pleat', hasBpDocument: false })).toBe(
      'treemaker-tree'
    );
  });

  it('maps the BP packing pane', () => {
    expect(resolveEditingContext({ ...base, activePanelId: 'bp-editor' })).toBe('bp-packing');
  });

  it('maps the crease-pattern pane and its side controls', () => {
    expect(resolveEditingContext({ ...base, activePanelId: 'crease-pattern' })).toBe('crease-pattern');
    expect(resolveEditingContext({ ...base, activePanelId: 'cp-view-controls' })).toBe(
      'crease-pattern'
    );
  });

  it('maps the simulator and sequence panes', () => {
    expect(resolveEditingContext({ ...base, activePanelId: 'simulator' })).toBe('simulate');
    expect(resolveEditingContext({ ...base, activePanelId: 'sequence' })).toBe('simulate');
  });

  it('resolves TreeMaker side panes to the tree context', () => {
    for (const id of ['inspector', 'diagnostics', 'conditions']) {
      expect(resolveEditingContext({ ...base, activePanelId: id })).toBe('treemaker-tree');
    }
  });

  it('falls back to design resolution for an unknown or null active panel', () => {
    expect(resolveEditingContext({ ...base, activePanelId: null })).toBe('treemaker-tree');
    expect(
      resolveEditingContext({
        ...base,
        activePanelId: null,
        workflowTarget: 'box-pleat',
        hasBpDocument: true,
      })
    ).toBe('bp-tree');
  });
});
