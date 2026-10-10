import { describe, expect, it } from 'vitest';
import { sidePanesFor } from '../store/layoutStore';
import { selectionPaneIn } from './useWorkspaceViewDrawer';

/** The pane the touch drawer opens on when something is selected. */
describe('selectionPaneIn', () => {
  it('is Properties in Edit for a canvas object, and Layers in the Diagram for a mark', () => {
    expect(selectionPaneIn(sidePanesFor('edit'), { canvasObject: true, layer: false })).toBe('cp-properties');
    expect(selectionPaneIn(sidePanesFor('diagram'), { canvasObject: false, layer: true })).toBe('diagram-layers');
  });

  it('is the workspace’s own: a selection left in the other workspace takes no part', () => {
    expect(selectionPaneIn(sidePanesFor('diagram'), { canvasObject: true, layer: true })).toBe('diagram-layers');
    expect(selectionPaneIn(sidePanesFor('diagram'), { canvasObject: true, layer: false })).toBeUndefined();
    expect(selectionPaneIn(sidePanesFor('edit'), { canvasObject: false, layer: true })).toBeUndefined();
  });

  it('is none with nothing selected, or in a workspace with no such pane', () => {
    expect(selectionPaneIn(sidePanesFor('diagram'), { canvasObject: false, layer: false })).toBeUndefined();
    expect(selectionPaneIn(sidePanesFor('simulate'), { canvasObject: true, layer: true })).toBeUndefined();
  });
});
