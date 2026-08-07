import { describe, expect, it } from 'vitest';
import type { AppStatus, DocumentMode, Selection } from './sampleProject';
import type { EditingContext } from '../workspaces/editingContext';
import { getNextDocumentAction, getWorkspaceCapabilities } from './workspaceCapabilities';

const treeSelection: Selection = { kind: 'tree' };

function capabilities({
  documentMode = 'tree',
  activeEditingContext = documentMode === 'crease-pattern' ? 'crease-pattern' : 'treemaker-tree',
  status = 'ready',
  edgeCount = 0,
  creaseCount = 0,
  facetCount = 0,
  engineReady = true,
  hasEditableCreasePattern = false,
  hasImportedCreasePattern = false,
  hasBoxPleatDocument = false,
  boxPleatTreeEdgeCount = 0,
  boxPleatBusy = false,
  boxPleatCanSubdivide = true,
  boxPleatCanUnsubdivide = false,
  oristudioCpSelectedLineCount = 0,
  oristudioCpSelectedPointCount = 0,
  oristudioCpSelectedCircleCount = 0,
  hasDeletableBpSelection = false,
  historyPastCount = 0,
  historyFutureCount = 0,
  clipboard = null,
  selection = treeSelection,
}: {
  documentMode?: DocumentMode;
  activeEditingContext?: EditingContext;
  status?: AppStatus;
  edgeCount?: number;
  creaseCount?: number;
  facetCount?: number;
  engineReady?: boolean;
  hasEditableCreasePattern?: boolean;
  hasImportedCreasePattern?: boolean;
  hasBoxPleatDocument?: boolean;
  boxPleatTreeEdgeCount?: number;
  boxPleatBusy?: boolean;
  boxPleatCanSubdivide?: boolean;
  boxPleatCanUnsubdivide?: boolean;
  oristudioCpSelectedLineCount?: number;
  oristudioCpSelectedPointCount?: number;
  oristudioCpSelectedCircleCount?: number;
  hasDeletableBpSelection?: boolean;
  historyPastCount?: number;
  historyFutureCount?: number;
  clipboard?: unknown | null;
  selection?: Selection;
} = {}) {
  return getWorkspaceCapabilities({
    activeEditingContext,
    engineReady,
    status,
    edgeCount,
    creaseCount,
    facetCount,
    hasEditableCreasePattern,
    hasImportedCreasePattern,
    hasBoxPleatDocument,
    boxPleatTreeEdgeCount,
    boxPleatBusy,
    boxPleatCanSubdivide,
    boxPleatCanUnsubdivide,
    hasSimulationModel: false,
    oristudioCpSelectedLineCount,
    oristudioCpSelectedPointCount,
    oristudioCpSelectedCircleCount,
    hasDeletableBpSelection,
    historyPastCount,
    historyFutureCount,
    clipboard,
    selection,
  });
}

describe('workspace capabilities', () => {
  it('disables optimize and build when tree documents have no edges', () => {
    const state = capabilities();

    expect(state['file.detectCpImage']).toMatchObject({
      enabled: true,
      reason: 'Detect a square crease pattern from an image',
    });
    expect(state['optimize.scale'].enabled).toBe(false);
    expect(state['optimize.scale'].reason).toBe('Add at least one tree edge before optimizing');
    expect(state['cp.build'].enabled).toBe(false);
    expect(state['cp.build'].reason).toBe('Add tree edges, then optimize before building the crease pattern');
    expect(getNextDocumentAction(state)).toBe('optimize.scale');
  });

  it('enables optimization before CP build and build after optimization', () => {
    const needsOptimization = capabilities({ status: 'needs_optimization', edgeCount: 2 });
    expect(needsOptimization['optimize.scale'].enabled).toBe(true);
    expect(needsOptimization['cp.build'].enabled).toBe(false);

    const optimized = capabilities({ status: 'optimized', edgeCount: 2 });
    expect(optimized['optimize.scale'].enabled).toBe(true);
    expect(optimized['cp.build'].enabled).toBe(true);
    expect(optimized['cp.build'].label).toBe('Build CP');
    expect(getNextDocumentAction(optimized)).toBe('cp.build');
  });

  it('allows rebuilding an existing generated crease pattern', () => {
    const state = capabilities({ status: 'crease_pattern_ready', edgeCount: 2, creaseCount: 4, facetCount: 1 });

    expect(state['cp.build'].enabled).toBe(true);
    expect(state['cp.build'].label).toBe('Rebuild CP');
    expect(state['file.exportV5'].enabled).toBe(true);
    expect(state['file.exportFold'].enabled).toBe(true);
  });

  it('enables corridor facet selection only after CP generation with selected edges', () => {
    const noEdge = capabilities({ facetCount: 2 });
    expect(noEdge['edit.selectCorridorFacets'].enabled).toBe(false);

    const selectedEdge = capabilities({ facetCount: 2, selection: { kind: 'edge', id: 1 } });
    expect(selectedEdge['edit.selectCorridorFacets'].enabled).toBe(true);
    expect(selectedEdge['edit.selectByIndex'].enabled).toBe(true);
    expect(selectedEdge['edit.selectMovableParts'].enabled).toBe(true);
  });

  it('gates core editing commands by selected part type', () => {
    const edgeState = capabilities({ edgeCount: 2, selection: { kind: 'edge', id: 1 } });
    expect(edgeState['edit.splitEdge'].enabled).toBe(true);
    expect(edgeState['edit.setEdgeLength'].enabled).toBe(true);
    expect(edgeState['edit.renormalizeToEdge'].enabled).toBe(true);
    expect(edgeState['edit.makeRoot'].enabled).toBe(false);

    const nodeState = capabilities({ edgeCount: 2, selection: { kind: 'node', id: 2 } });
    expect(nodeState['edit.makeRoot'].enabled).toBe(true);
    expect(nodeState['edit.perturbNodes'].enabled).toBe(true);
    expect(nodeState['edit.absorbNodes'].enabled).toBe(true);
    expect(nodeState['edit.splitEdge'].enabled).toBe(false);

    expect(edgeState['edit.triangulateTree'].enabled).toBe(false);
    expect(edgeState['edit.triangulateTree'].reason).toBe('Stub finder triangulation port is pending');
  });

  it('does not call an empty CP-ready tree a rebuildable crease pattern', () => {
    const state = capabilities({ status: 'crease_pattern_ready', edgeCount: 2 });

    expect(state['cp.build'].enabled).toBe(true);
    expect(state['cp.build'].label).toBe('Build CP');
    expect(getNextDocumentAction(state)).toBe('cp.build');
  });

  it('disables tree-only commands for imported crease-pattern documents', () => {
    const state = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      creaseCount: 5,
      facetCount: 1,
      hasImportedCreasePattern: true,
    });

    expect(state['optimize.scale'].enabled).toBe(false);
    expect(state['optimize.scale'].reason).toBe('Optimization requires an editable tree document');
    expect(state['cp.build'].enabled).toBe(false);
    expect(state['cp.build'].reason).toBe('Build CP requires an editable tree document');
    expect(state['file.save'].enabled).toBe(false);
    expect(state['file.exportCp'].enabled).toBe(false);
    expect(state['file.exportFold'].enabled).toBe(true);
    expect(state['file.exportOri'].enabled).toBe(false);
    expect(state['file.exportOrh'].enabled).toBe(false);
    expect(state['file.exportSvg'].enabled).toBe(true);
    expect(getNextDocumentAction(state)).toBe(null);
  });

  it('enables CP save actions when an editable CP kernel is available', () => {
    const state = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      creaseCount: 5,
      facetCount: 1,
      hasEditableCreasePattern: true,
      hasImportedCreasePattern: true,
    });

    expect(state['file.save']).toMatchObject({
      enabled: true,
      reason: 'Save editable crease pattern as an Ori Studio project',
    });
    expect(state['file.saveAs']).toMatchObject({
      enabled: true,
      reason: 'Save editable crease pattern as a new Ori Studio project',
    });
    expect(state['file.exportCp']).toMatchObject({
      enabled: true,
      reason: 'Export editable crease pattern as CP',
    });
    expect(state['file.exportFold']).toMatchObject({
      enabled: true,
      reason: 'Export FOLD document',
    });
    expect(state['file.exportOri']).toMatchObject({
      enabled: true,
      reason: 'Export editable crease pattern as an Oriedita ORI document',
    });
    expect(state['file.exportOrh']).toMatchObject({
      enabled: true,
      reason: 'Export editable crease pattern as a legacy Oriedita/Orihime ORH document',
    });
    expect(state['cp.checkCamv'].enabled).toBe(true);
    expect(state['cp.deleteSelectedLines'].enabled).toBe(false);
    expect(state['cp.fixInaccurate'].enabled).toBe(false);
    expect(state['cp.makeMountain'].enabled).toBe(false);
    expect(state['cp.changeCircleColor'].enabled).toBe(false);
    expect(state['cp.organizeCircles'].enabled).toBe(true);
  });

  it('enables FOLD export for new editable CP documents without an imported source', () => {
    const state = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
    });

    expect(state['file.exportFold']).toMatchObject({
      enabled: true,
      reason: 'Export FOLD document',
    });
    expect(state['file.exportOri']).toMatchObject({
      enabled: true,
      reason: 'Export editable crease pattern as an Oriedita ORI document',
    });
    expect(state['file.exportOrh']).toMatchObject({
      enabled: true,
      reason: 'Export editable crease pattern as a legacy Oriedita/Orihime ORH document',
    });
  });

  it('enables selected-line CP commands only when editable CP lines are selected', () => {
    const state = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
      hasImportedCreasePattern: true,
      oristudioCpSelectedLineCount: 2,
    });

    expect(state['cp.deleteSelectedLines']).toMatchObject({
      enabled: true,
      reason: 'Delete selected crease-pattern lines',
    });
    expect(state['edit.delete']).toMatchObject({
      enabled: true,
      reason: 'Delete selected crease-pattern lines',
    });
    expect(state['cp.fixInaccurate']).toMatchObject({
      enabled: true,
      reason: 'Open inaccurate-crease repair settings for selected lines',
    });
    expect(state['cp.makeMountain']).toMatchObject({
      enabled: true,
      reason: 'Make selected lines mountain folds',
    });
    expect(state['edit.copy']).toMatchObject({
      enabled: true,
      reason: 'Copy selected crease-pattern lines',
    });
    expect(state['cp.transformFlipHorizontal']).toMatchObject({
      enabled: true,
      reason: 'Flip selected crease-pattern lines horizontally',
    });
    expect(state['cp.transformRotateRight']).toMatchObject({
      enabled: true,
      reason: 'Rotate selected crease-pattern lines right',
    });
    expect(state['cp.replaceLineType']).toMatchObject({
      enabled: true,
      reason: 'Open line-type replacement settings for selected lines',
    });
  });

  it('enables CP paste only for a copied CP line payload', () => {
    const emptyClipboard = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
      oristudioCpSelectedLineCount: 1,
    });
    const cpClipboard = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
      oristudioCpSelectedLineCount: 1,
      clipboard: { kind: 'cp-lines' },
    });
    const treeClipboard = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
      oristudioCpSelectedLineCount: 1,
      clipboard: { kind: 'tree' },
    });

    expect(emptyClipboard['edit.paste']).toMatchObject({
      enabled: false,
      reason: 'Copy crease-pattern lines before pasting',
    });
    expect(cpClipboard['edit.paste']).toMatchObject({
      enabled: true,
      reason: 'Paste copied crease-pattern lines',
    });
    expect(treeClipboard['edit.paste'].enabled).toBe(false);
  });

  it('enables Delete Selected when editable CP points are selected', () => {
    const state = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
      hasImportedCreasePattern: true,
      oristudioCpSelectedPointCount: 1,
    });

    expect(state['edit.delete']).toMatchObject({
      enabled: true,
      reason: 'Delete selected crease-pattern points',
    });
    expect(state['cp.deleteSelectedLines'].enabled).toBe(false);
  });

  it('enables Delete Selected when editable CP circles are selected', () => {
    const state = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
      hasImportedCreasePattern: true,
      oristudioCpSelectedCircleCount: 1,
    });

    expect(state['edit.delete']).toMatchObject({
      enabled: true,
      reason: 'Delete selected crease-pattern circles',
    });
    // Circles are not lines, so the line-specific menu entry stays disabled.
    expect(state['cp.deleteSelectedLines'].enabled).toBe(false);
  });

  it('enables selected-circle CP actions only when circle or auxiliary selections exist', () => {
    const noSelection = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
      hasImportedCreasePattern: true,
    });
    const circleSelection = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
      hasImportedCreasePattern: true,
      oristudioCpSelectedCircleCount: 1,
    });

    expect(noSelection['cp.changeCircleColor'].enabled).toBe(false);
    expect(circleSelection['cp.changeCircleColor']).toMatchObject({
      enabled: true,
      reason: 'Open color settings for selected circles or auxiliary lines',
    });
  });

  it('enables undo and redo for editable CP history', () => {
    const state = capabilities({
      documentMode: 'crease-pattern',
      status: 'crease_pattern_ready',
      hasEditableCreasePattern: true,
      hasImportedCreasePattern: true,
      historyPastCount: 1,
      historyFutureCount: 1,
    });

    expect(state['edit.undo']).toMatchObject({
      enabled: true,
      reason: 'Undo the last crease-pattern edit',
    });
    expect(state['edit.redo']).toMatchObject({
      enabled: true,
      reason: 'Redo the next crease-pattern edit',
    });
  });

  it('disables workflow actions while the engine is busy or unavailable', () => {
    for (const status of ['loading_engine', 'optimizing', 'building_crease_pattern'] as const) {
      const state = capabilities({ status, edgeCount: 2, engineReady: status !== 'loading_engine' });

      expect(state['optimize.scale'].enabled).toBe(false);
      expect(state['cp.build'].enabled).toBe(false);
    }

    const errorState = capabilities({ status: 'error', edgeCount: 2 });
    expect(errorState['optimize.scale'].enabled).toBe(false);
    expect(errorState['cp.build'].enabled).toBe(false);
  });

  it('hides TreeMaker/CP commands in a Box-Pleat context', () => {
    const bp = capabilities({
      activeEditingContext: 'bp-tree',
      documentMode: 'tree',
      edgeCount: 2,
      historyPastCount: 1,
    });
    // Design menu + toolbar (TreeMaker/CP), tree-edit submenus, and CP exports hide.
    for (const id of [
      'optimize.scale',
      'optimize.edges',
      'cp.build',
      'cp.deleteSelectedLines',
      'edit.triangulateTree',
      'edit.absorbNodes',
      'view.conditions',
      'file.exportV5',
    ] as const) {
      expect(bp[id].visible).toBe(false);
      expect(bp[id].enabled).toBe(false);
    }
    // Generic commands stay; undo reads the BP history count.
    expect(bp['file.new'].visible).toBe(true);
    expect(bp['file.open'].visible).toBe(true);
    expect(bp['edit.undo'].visible).toBe(true);
    expect(bp['edit.undo'].enabled).toBe(true);
  });

  it('shows BP layout optimization only in a Box-Pleat context', () => {
    for (const context of ['bp-tree', 'bp-packing'] as const) {
      const bp = capabilities({
        activeEditingContext: context,
        hasBoxPleatDocument: true,
        boxPleatTreeEdgeCount: 3,
      });
      expect(bp['bp.optimize.layout'].visible).toBe(true);
      expect(bp['bp.optimize.layout'].enabled).toBe(true);
    }

    // Everywhere else the toolbar button and the Design menu entry are absent.
    for (const context of ['treemaker-tree', 'crease-pattern', 'simulate'] as const) {
      const other = capabilities({
        activeEditingContext: context,
        hasBoxPleatDocument: true,
        boxPleatTreeEdgeCount: 3,
      });
      expect(other['bp.optimize.layout'].visible).toBe(false);
    }
  });

  it('disables BP layout optimization without a document, edges, or while busy', () => {
    const noDocument = capabilities({ activeEditingContext: 'bp-tree' });
    expect(noDocument['bp.optimize.layout'].visible).toBe(true);
    expect(noDocument['bp.optimize.layout'].enabled).toBe(false);

    const noEdges = capabilities({
      activeEditingContext: 'bp-tree',
      hasBoxPleatDocument: true,
      boxPleatTreeEdgeCount: 0,
    });
    expect(noEdges['bp.optimize.layout'].enabled).toBe(false);

    const busy = capabilities({
      activeEditingContext: 'bp-tree',
      hasBoxPleatDocument: true,
      boxPleatTreeEdgeCount: 3,
      boxPleatBusy: true,
    });
    expect(busy['bp.optimize.layout'].enabled).toBe(false);
  });

  it('gates subdivide and un-subdivide on what the kernel would take', () => {
    const both = capabilities({
      activeEditingContext: 'bp-packing',
      hasBoxPleatDocument: true,
      boxPleatCanSubdivide: true,
      boxPleatCanUnsubdivide: true,
    });
    expect(both['bp.layout.subdivide'].enabled).toBe(true);
    expect(both['bp.layout.unsubdivide'].enabled).toBe(true);

    // Halving is only sound when every flap sits on an even grid line, so the
    // menu says why rather than failing after the click.
    const odd = capabilities({
      activeEditingContext: 'bp-packing',
      hasBoxPleatDocument: true,
      boxPleatCanUnsubdivide: false,
    });
    expect(odd['bp.layout.unsubdivide'].visible).toBe(true);
    expect(odd['bp.layout.unsubdivide'].enabled).toBe(false);

    const ceiling = capabilities({
      activeEditingContext: 'bp-packing',
      hasBoxPleatDocument: true,
      boxPleatCanSubdivide: false,
    });
    expect(ceiling['bp.layout.subdivide'].enabled).toBe(false);
  });

  it('shows the grid subdivision commands only in a Box-Pleat context', () => {
    const noDocument = capabilities({ activeEditingContext: 'bp-packing' });
    expect(noDocument['bp.layout.subdivide'].visible).toBe(true);
    expect(noDocument['bp.layout.subdivide'].enabled).toBe(false);

    for (const context of ['treemaker-tree', 'crease-pattern', 'simulate'] as const) {
      const other = capabilities({ activeEditingContext: context, hasBoxPleatDocument: true });
      expect(other['bp.layout.subdivide'].visible).toBe(false);
      expect(other['bp.layout.unsubdivide'].visible).toBe(false);
    }
  });

  it('hides tree-authoring Edit commands in the crease-pattern context', () => {
    const cp = capabilities({
      activeEditingContext: 'crease-pattern',
      documentMode: 'crease-pattern',
      hasEditableCreasePattern: true,
    });
    // The Node/Edge/Strain/Stubs submenus and tree-only Select items collapse
    // away so the Edit menu never surfaces tree operations in the CP editor.
    for (const id of [
      'edit.makeRoot',
      'edit.splitEdge',
      'edit.absorbNodes',
      'edit.removeStrain',
      'edit.triangulateTree',
      'edit.selectByIndex',
      'edit.selectMovableParts',
      'edit.selectCorridorFacets',
    ] as const) {
      expect(cp[id].visible).toBe(false);
      expect(cp[id].enabled).toBe(false);
    }
    // Context-agnostic Edit commands stay visible.
    for (const id of [
      'edit.undo',
      'edit.redo',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.delete',
      'edit.selectAll',
      'edit.deselectAll',
    ] as const) {
      expect(cp[id].visible).toBe(true);
    }
  });

  it('keeps tree-authoring Edit commands visible in the treemaker-tree context', () => {
    const tree = capabilities({ activeEditingContext: 'treemaker-tree', edgeCount: 2 });
    for (const id of ['edit.makeRoot', 'edit.absorbNodes', 'edit.selectMovableParts'] as const) {
      expect(tree[id].visible).toBe(true);
    }
  });

  it('shows the Crease Pattern menu only in the crease-pattern context', () => {
    const cpMenuIds = [
      'cp.deleteSelectedLines',
      'cp.changeCreaseType',
      'cp.transformFlipHorizontal',
      'cp.checkCamv',
      'cp.fix1',
      'cp.deleteExtraVerticesIgnoreColor',
      'cp.organizeCircles',
    ] as const;

    // Visible in the CP editor.
    const cp = capabilities({
      activeEditingContext: 'crease-pattern',
      documentMode: 'crease-pattern',
      hasEditableCreasePattern: true,
    });
    for (const id of cpMenuIds) expect(cp[id].visible).toBe(true);

    // Hidden in Design (tree) and Simulate — cp.build (a Design-menu command)
    // stays visible while authoring a tree.
    const tree = capabilities({ activeEditingContext: 'treemaker-tree', edgeCount: 2 });
    for (const id of cpMenuIds) {
      expect(tree[id].visible).toBe(false);
      expect(tree[id].enabled).toBe(false);
    }
    expect(tree['cp.build'].visible).toBe(true);

    const sim = capabilities({ activeEditingContext: 'simulate' });
    for (const id of cpMenuIds) expect(sim[id].visible).toBe(false);
  });

  it('enables Save and Export .bps for a loaded box-pleat design', () => {
    const withBp = capabilities({
      activeEditingContext: 'bp-tree',
      hasBoxPleatDocument: true,
    });
    expect(withBp['file.save'].enabled).toBe(true);
    expect(withBp['file.saveAs'].enabled).toBe(true);
    expect(withBp['file.exportBps'].visible).toBe(true);
    expect(withBp['file.exportBps'].enabled).toBe(true);

    // Without a box-pleat design, Export .bps is hidden and Save is not a BP save.
    const withoutBp = capabilities({ activeEditingContext: 'treemaker-tree', edgeCount: 0 });
    expect(withoutBp['file.exportBps'].visible).toBe(false);
    expect(withoutBp['file.exportBps'].enabled).toBe(false);
  });

  it('shows only playback/navigation commands with inert undo in the Simulate context', () => {
    const sim = capabilities({
      activeEditingContext: 'simulate',
      documentMode: 'tree',
      edgeCount: 2,
      // The store selector zeroes the history count for simulate (it has no own
      // stack), so undo/redo arrive here already at zero — hence inert.
      historyPastCount: 0,
      historyFutureCount: 0,
    });
    // Every authoring command — tree edits, CP edits, optimization — is hidden.
    for (const id of [
      'edit.delete',
      'edit.copy',
      'edit.selectAll',
      'edit.triangulateTree',
      'cp.build',
      'cp.makeMountain',
      'optimize.scale',
    ] as const) {
      expect(sim[id].visible).toBe(false);
      expect(sim[id].enabled).toBe(false);
    }
    // Navigation, file operations, and playback stay.
    expect(sim['view.simulate'].visible).toBe(true);
    expect(sim['view.design'].visible).toBe(true);
    expect(sim['file.open'].visible).toBe(true);
    expect(sim['simulator.refresh'].visible).toBe(true);
    // Undo/redo remain visible but inert — the simulate context has no history.
    expect(sim['edit.undo'].visible).toBe(true);
    expect(sim['edit.undo'].enabled).toBe(false);
    expect(sim['edit.redo'].visible).toBe(true);
    expect(sim['edit.redo'].enabled).toBe(false);
  });
});
