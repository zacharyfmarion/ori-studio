import { describe, expect, it } from 'vitest';
import { designKind } from '../designKinds';
import { resolveEditingContext, type EditingContextInput } from './editingContext';

const base: EditingContextInput = {
  activePanelId: 'design',
  designMethod: 'treemaker',
  hasBpDocument: false,
};

describe('resolveEditingContext', () => {
  it('maps the design panel by design state', () => {
    expect(resolveEditingContext({ ...base, designMethod: 'none' })).toBe('design-nux');
    expect(resolveEditingContext(base)).toBe('treemaker-tree');
    expect(resolveEditingContext({ ...base, designMethod: 'box-pleat', hasBpDocument: true })).toBe(
      'bp-tree',
    );
  });

  it('offers nothing while a box-pleat document is still loading', () => {
    // Choosing Box-pleated is asynchronous, and the pane shows "Preparing the
    // box-pleat editor…" in between. Neither BP's commands (there is no document
    // to run them on) nor TreeMaker's (this is not a tree) apply, so the answer
    // is the context that offers neither. It used to be `treemaker-tree`, which
    // put Optimize and Build in the toolbar of a box-pleat design.
    expect(
      resolveEditingContext({ ...base, designMethod: 'box-pleat', hasBpDocument: false }),
    ).toBe('design-nux');
  });

  it('maps the BP packing pane, of a box-pleat design', () => {
    // The pane list comes from the *kind*, so `bp-editor` is only a pane a
    // box-pleat design has. That pairing is the only one reachable: with per-tab
    // docks the packing pane exists nowhere else.
    expect(
      resolveEditingContext({
        ...base,
        activePanelId: 'bp-editor',
        designMethod: 'box-pleat',
        hasBpDocument: true,
      }),
    ).toBe('bp-packing');
  });

  it("falls back to the active design's canvas for a pane its kind does not have", () => {
    // One render after a tab switch, `activePanelId` still names the outgoing
    // design's pane. Answering with the incoming design's canvas is what stops
    // the menus flickering through the other kind's commands.
    expect(resolveEditingContext({ ...base, activePanelId: 'bp-editor' })).toBe('treemaker-tree');
    expect(
      resolveEditingContext({
        ...base,
        activePanelId: 'inspector',
        designMethod: 'box-pleat',
        hasBpDocument: true,
      }),
    ).toBe('bp-tree');
  });

  it('maps the crease-pattern pane and its side controls', () => {
    expect(resolveEditingContext({ ...base, activePanelId: 'crease-pattern' })).toBe(
      'crease-pattern',
    );
    expect(resolveEditingContext({ ...base, activePanelId: 'cp-view-controls' })).toBe(
      'crease-pattern',
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
        designMethod: 'box-pleat',
        hasBpDocument: true,
      }),
    ).toBe('bp-tree');
  });
});

/**
 * The Design half of this resolution is the kind's, not this file's.
 *
 * It used to be a switch listing `inspector`, `diagnostics`, `conditions`, and
 * `bp-editor` by name, so a third design kind could not have contexts without an
 * edit here — the exact coupling the registry exists to remove. These state that
 * every pane a shipped kind declares resolves to the context it declared, with no
 * list in between.
 */
describe('contexts come from the kind descriptor', () => {
  for (const [method, hasBpDocument] of [
    ['treemaker', false],
    ['box-pleat', true],
  ] as const) {
    it(`resolves every ${method} pane to its declared context`, () => {
      const kind = designKind(method);
      expect(kind?.panes.length).toBeGreaterThan(0);
      for (const pane of kind?.panes ?? []) {
        expect(
          resolveEditingContext({
            activePanelId: pane.component,
            designMethod: method,
            hasBpDocument,
          }),
        ).toBe(pane.editingContext);
      }
    });
  }
});
