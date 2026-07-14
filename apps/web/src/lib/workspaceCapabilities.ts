import type { AppStatus, Selection } from './sampleProject';
import type { EditingContext } from '../workspaces/editingContext';

export type WorkspaceCapabilityId =
  | 'file.new'
  | 'file.open'
  | 'file.importAdd'
  | 'file.detectCpImage'
  | 'file.save'
  | 'file.saveAs'
  | 'file.exportV5'
  | 'file.exportV4'
  | 'file.exportCp'
  | 'file.exportFold'
  | 'file.exportOri'
  | 'file.exportOrh'
  | 'file.exportSvg'
  | 'file.exportPng'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.delete'
  | 'edit.selectAll'
  | 'edit.deselectAll'
  | 'edit.selectByIndex'
  | 'edit.selectMovableParts'
  | 'edit.selectCorridorFacets'
  | 'edit.makeRoot'
  | 'edit.splitEdge'
  | 'edit.setEdgeLength'
  | 'edit.scaleEdgeLengths'
  | 'edit.renormalizeToEdge'
  | 'edit.renormalizeToUnitScale'
  | 'edit.absorbNodes'
  | 'edit.absorbRedundantNodes'
  | 'edit.absorbEdges'
  | 'edit.perturbNodes'
  | 'edit.perturbAllNodes'
  | 'edit.removeStrain'
  | 'edit.removeAllStrain'
  | 'edit.relieveStrain'
  | 'edit.relieveAllStrain'
  | 'edit.addLargestStubForNodes'
  | 'edit.addLargestStubForPoly'
  | 'edit.triangulateTree'
  | 'view.design'
  | 'view.edit'
  | 'view.creasePattern'
  | 'view.simulate'
  | 'view.simulator'
  | 'view.conditions'
  | 'view.resetLayout'
  | 'optimize.scale'
  | 'optimize.edges'
  | 'optimize.strain'
  | 'cp.build'
  | 'cp.deleteSelectedLines'
  | 'cp.changeCreaseType'
  | 'cp.advanceCreaseType'
  | 'cp.makeMountain'
  | 'cp.makeValley'
  | 'cp.makeEdge'
  | 'cp.makeAuxiliary'
  | 'cp.toggleMountainValley'
  | 'cp.transformFlipHorizontal'
  | 'cp.transformFlipVertical'
  | 'cp.transformRotateLeft'
  | 'cp.transformRotateRight'
  | 'cp.replaceLineType'
  | 'cp.deleteLineType'
  | 'cp.checkCamv'
  | 'cp.check1'
  | 'cp.check2'
  | 'cp.check3'
  | 'cp.check4'
  | 'cp.fix1'
  | 'cp.fix2'
  | 'cp.fixInaccurate'
  | 'cp.changeCircleColor'
  | 'cp.organizeCircles'
  | 'simulator.refresh';

export interface WorkspaceCapability {
  enabled: boolean;
  visible: boolean;
  label: string;
  reason: string;
}

export type WorkspaceCapabilities = Record<WorkspaceCapabilityId, WorkspaceCapability>;

export interface WorkspaceCapabilityInput {
  activeEditingContext: EditingContext;
  engineReady: boolean;
  status: AppStatus;
  edgeCount: number;
  creaseCount: number;
  facetCount: number;
  hasEditableCreasePattern: boolean;
  hasImportedCreasePattern: boolean;
  hasSimulationModel: boolean;
  oristudioCpSelectedLineCount: number;
  oristudioCpSelectedVertexCount: number;
  oristudioCpSelectedPointCount: number;
  oristudioCpSelectedCircleCount: number;
  hasDeletableBpSelection: boolean;
  historyPastCount: number;
  historyFutureCount: number;
  clipboard: unknown | null;
  selection: Selection;
}

export function getWorkspaceCapabilities(input: WorkspaceCapabilityInput): WorkspaceCapabilities {
  const isBpContext =
    input.activeEditingContext === 'bp-tree' || input.activeEditingContext === 'bp-packing';
  // The shell keys off the active editing context. `treeMode` is TreeMaker-tree
  // authoring specifically (optimize / build / tree edits / TreeMaker export);
  // BP authoring is `isBpContext`, and the crease-pattern editor is its own
  // context.
  const treeMode = input.activeEditingContext === 'treemaker-tree';
  const creasePatternMode = input.activeEditingContext === 'crease-pattern';
  const activeCpSurface =
    input.activeEditingContext === 'crease-pattern' && input.hasEditableCreasePattern;
  const isBusy = isWorkspaceBusy(input.status);
  const hasTreeEdges = input.edgeCount > 0;
  const hasCreasePattern =
    input.hasEditableCreasePattern ||
    input.hasImportedCreasePattern ||
    input.creaseCount > 0 ||
    input.facetCount > 0;
  const canOptimize =
    treeMode && input.engineReady && hasTreeEdges && !isBusy && input.status !== 'error';
  const canBuild =
    treeMode &&
    input.engineReady &&
    !isBusy &&
    (input.status === 'optimized' || input.status === 'crease_pattern_ready');
  const canExportTreeFold = treeMode && hasCreasePattern && !isBusy;
  const canExportEditableOrImportedFold =
    input.hasEditableCreasePattern || (creasePatternMode && input.hasImportedCreasePattern);
  const canSaveEditableCreasePattern = creasePatternMode && input.hasEditableCreasePattern;
  const canExportEditableCp = input.hasEditableCreasePattern;
  const canExportCreasePattern = hasCreasePattern && !isBusy;
  const canEditCp = input.hasEditableCreasePattern && !isBusy;
  const canRefreshFoldArtifacts =
    !isBusy &&
    (input.hasEditableCreasePattern ||
      (treeMode && (input.creaseCount > 0 || input.facetCount > 0)));
  const hasSelectedCpLines = input.oristudioCpSelectedLineCount > 0;
  const hasSelectedCpPoints =
    input.oristudioCpSelectedVertexCount > 0 || input.oristudioCpSelectedPointCount > 0;
  const hasSelectedCpCircles = input.oristudioCpSelectedCircleCount > 0;
  const hasSelectedCpLinesOrCircles = hasSelectedCpLines || hasSelectedCpCircles;
  const hasSelection = selectionHasEditableParts(input.selection);
  const hasSelectedEdges = selectedEdgeCount(input.selection) > 0;
  const hasOneSelectedEdge = selectedEdgeCount(input.selection) === 1;
  const hasSelectedNodes = selectedNodeCount(input.selection) > 0;
  const hasOneSelectedNode = selectedNodeCount(input.selection) === 1;
  const clipboardKind = workspaceClipboardKind(input.clipboard);
  const buildLabel = hasCreasePattern ? 'Rebuild CP' : 'Build CP';
  const buildReason = hasCreasePattern ? 'Rebuild crease pattern' : 'Build crease pattern';

  const capabilities: WorkspaceCapabilities = {
    'file.new': capability(!isBusy, 'New', isBusy ? busyReason(input.status) : 'Choose a new Ori Studio workspace'),
    'file.open': capability(!isBusy, 'Open...', isBusy ? busyReason(input.status) : 'Open a project or crease pattern'),
    'file.importAdd': capability(
      canEditCp,
      'Import (Add)...',
      canEditCp
        ? 'Import a crease pattern beside the current one'
        : input.hasEditableCreasePattern
          ? busyReason(input.status)
          : 'Open an editable crease pattern before importing'
    ),
    'file.detectCpImage': capability(
      !isBusy,
      'Detect CP from Image...',
      isBusy ? busyReason(input.status) : 'Detect a square crease pattern from an image'
    ),
    'file.save': capability(
      (treeMode || canSaveEditableCreasePattern) && !isBusy,
      'Save',
      treeMode
        ? busyOr('Save Ori Studio project', input.status)
        : canSaveEditableCreasePattern
          ? busyOr('Save editable crease pattern as an Ori Studio project', input.status)
          : 'Editable crease-pattern kernel is unavailable'
    ),
    'file.saveAs': capability(
      (treeMode || canSaveEditableCreasePattern) && !isBusy,
      'Save As...',
      treeMode
        ? busyOr('Save Ori Studio project as a new file', input.status)
        : canSaveEditableCreasePattern
          ? busyOr('Save editable crease pattern as a new Ori Studio project', input.status)
          : 'Editable crease-pattern kernel is unavailable'
    ),
    'file.exportV5': capability(
      treeMode && !isBusy,
      'Export TreeMaker 5...',
      treeMode ? busyOr('Export TreeMaker 5 project', input.status) : 'TreeMaker 5 export requires a tree document'
    ),
    'file.exportV4': capability(
      treeMode && !isBusy,
      'Export TreeMaker 4...',
      treeMode ? busyOr('Export TreeMaker 4 project', input.status) : 'TreeMaker 4 export requires a tree document'
    ),
    'file.exportCp': capability(
      canExportEditableCp && !isBusy,
      'Export CP...',
      canExportEditableCp
        ? busyOr('Export editable crease pattern as CP', input.status)
        : 'Open an editable crease pattern before exporting CP'
    ),
    'file.exportFold': capability(
      (canExportTreeFold || canExportEditableOrImportedFold) && !isBusy,
      'Export FOLD...',
      canExportTreeFold || canExportEditableOrImportedFold
        ? busyOr('Export FOLD document', input.status)
        : treeMode
          ? 'Build a crease pattern before exporting FOLD'
          : 'Open a crease pattern before exporting FOLD'
    ),
    'file.exportOri': capability(
      canExportEditableCp && !isBusy,
      'Export ORI...',
      canExportEditableCp
        ? busyOr('Export editable crease pattern as an Oriedita ORI document', input.status)
        : 'Open an editable crease pattern before exporting ORI'
    ),
    'file.exportOrh': capability(
      canExportEditableCp && !isBusy,
      'Export ORH...',
      canExportEditableCp
        ? busyOr('Export editable crease pattern as a legacy Oriedita/Orihime ORH document', input.status)
        : 'Open an editable crease pattern before exporting ORH'
    ),
    'file.exportSvg': capability(
      canExportCreasePattern,
      'Export SVG...',
      hasCreasePattern ? busyOr('Export crease pattern SVG', input.status) : 'No crease pattern to export'
    ),
    'file.exportPng': capability(
      canExportCreasePattern,
      'Export PNG...',
      hasCreasePattern ? busyOr('Export crease pattern PNG', input.status) : 'No crease pattern to export'
    ),
    'edit.undo': capability(
      input.historyPastCount > 0 && !isBusy,
      'Undo',
      activeCpSurface
          ? 'Undo the last crease-pattern edit'
          : 'Undo the last tree edit'
    ),
    'edit.redo': capability(
      input.historyFutureCount > 0 && !isBusy,
      'Redo',
      activeCpSurface
          ? 'Redo the next crease-pattern edit'
          : 'Redo the next tree edit'
    ),
    'edit.cut': capability(
      treeMode && hasSelection && !isBusy,
      'Cut',
      treeMode ? 'Cut selected tree parts' : 'Imported crease patterns are read-only'
    ),
    'edit.copy': capability(
      (treeMode && hasSelection) || (canEditCp && hasSelectedCpLines),
      'Copy',
      treeMode
        ? 'Copy selected tree parts'
        : canEditCp
          ? hasSelectedCpLines
            ? 'Copy selected crease-pattern lines'
            : 'Select one or more crease-pattern lines first'
          : 'Open an editable crease pattern first'
    ),
    'edit.paste': capability(
      (treeMode && clipboardKind === 'tree' && !isBusy) ||
        (canEditCp && clipboardKind === 'cp-lines'),
      'Paste',
      treeMode
        ? clipboardKind === 'tree'
          ? busyOr('Paste copied tree parts', input.status)
          : 'Copy tree parts before pasting'
        : canEditCp
          ? clipboardKind === 'cp-lines'
            ? 'Paste copied crease-pattern lines'
            : 'Copy crease-pattern lines before pasting'
          : 'Open an editable crease pattern first'
    ),
    'edit.delete': capability(
      (isBpContext && input.hasDeletableBpSelection && !isBusy) ||
        (!isBpContext && treeMode && !activeCpSurface && hasSelection && !isBusy) ||
        (canEditCp && activeCpSurface && (hasSelectedCpLines || hasSelectedCpPoints)),
      'Delete Selected',
      treeMode && !activeCpSurface
        ? 'Delete selected tree parts'
        : canEditCp
          ? hasSelectedCpLines
            ? 'Delete selected crease-pattern lines'
            : hasSelectedCpPoints
              ? 'Delete selected crease-pattern points'
              : 'Select one or more crease-pattern lines or points first'
          : 'Imported crease patterns are read-only'
    ),
    'edit.selectAll': capability(true, 'Select All', 'Select visible document parts'),
    'edit.deselectAll': capability(true, 'Deselect All', 'Clear the current selection'),
    'edit.selectByIndex': capability(true, 'Select By Index...', 'Select a document part by its TreeMaker index'),
    'edit.selectMovableParts': capability(
      treeMode && !isBusy,
      'Select Movable Parts',
      treeMode ? busyOr('Select unpinned leaf nodes and movable edges', input.status) : 'Movable parts require a tree document'
    ),
    'edit.selectCorridorFacets': capability(
      input.facetCount > 0 && hasSelectedEdges,
      'Select Corridor Facets',
      input.facetCount > 0
        ? hasSelectedEdges
          ? 'Select facets in selected edge corridors'
          : 'Select one or more tree edges first'
        : 'Build a crease pattern before selecting corridor facets'
    ),
    'edit.makeRoot': capability(
      treeMode && hasOneSelectedNode && !isBusy,
      'Make Root',
      treeMode ? busyOr('Make selected node the root', input.status) : 'Root edits require a tree document'
    ),
    'edit.splitEdge': capability(
      treeMode && hasOneSelectedEdge && !isBusy,
      'Split Edge...',
      treeMode ? busyOr('Split selected edge', input.status) : 'Edge edits require a tree document'
    ),
    'edit.setEdgeLength': capability(
      treeMode && hasSelectedEdges && !isBusy,
      'Set Edge Length...',
      treeMode ? busyOr('Set selected edge lengths', input.status) : 'Edge edits require a tree document'
    ),
    'edit.scaleEdgeLengths': capability(
      treeMode && hasSelectedEdges && !isBusy,
      'Scale Edge Lengths...',
      treeMode ? busyOr('Scale selected edge lengths', input.status) : 'Edge edits require a tree document'
    ),
    'edit.renormalizeToEdge': capability(
      treeMode && hasOneSelectedEdge && !isBusy,
      'Renormalize To Edge',
      treeMode ? busyOr('Renormalize model to selected edge', input.status) : 'Edge edits require a tree document'
    ),
    'edit.renormalizeToUnitScale': capability(
      treeMode && input.edgeCount > 0 && !isBusy,
      'Renormalize To Unit Scale',
      treeMode ? busyOr('Renormalize model to unit scale', input.status) : 'Tree edits require a tree document'
    ),
    'edit.absorbNodes': capability(
      treeMode && hasSelectedNodes && !isBusy,
      'Absorb Nodes',
      treeMode ? busyOr('Absorb selected redundant nodes', input.status) : 'Node edits require a tree document'
    ),
    'edit.absorbRedundantNodes': capability(
      treeMode && input.edgeCount > 0 && !isBusy,
      'Absorb Redundant Nodes',
      treeMode ? busyOr('Absorb all degree-two internal nodes', input.status) : 'Node edits require a tree document'
    ),
    'edit.absorbEdges': capability(
      treeMode && hasSelectedEdges && !isBusy,
      'Absorb Edges',
      treeMode ? busyOr('Absorb selected edges', input.status) : 'Edge edits require a tree document'
    ),
    'edit.perturbNodes': capability(
      treeMode && hasSelectedNodes && !isBusy,
      'Perturb Nodes',
      treeMode ? busyOr('Perturb selected nodes', input.status) : 'Node edits require a tree document'
    ),
    'edit.perturbAllNodes': capability(
      treeMode && !isBusy,
      'Perturb All Nodes',
      treeMode ? busyOr('Perturb all nodes', input.status) : 'Node edits require a tree document'
    ),
    'edit.removeStrain': capability(
      treeMode && hasSelectedEdges && !isBusy,
      'Remove Strain',
      treeMode ? busyOr('Clear selected edge strain', input.status) : 'Edge edits require a tree document'
    ),
    'edit.removeAllStrain': capability(
      treeMode && input.edgeCount > 0 && !isBusy,
      'Remove All Strain',
      treeMode ? busyOr('Clear all edge strain', input.status) : 'Edge edits require a tree document'
    ),
    'edit.relieveStrain': capability(
      treeMode && hasSelectedEdges && !isBusy,
      'Relieve Strain',
      treeMode ? busyOr('Absorb selected strain into edge length', input.status) : 'Edge edits require a tree document'
    ),
    'edit.relieveAllStrain': capability(
      treeMode && input.edgeCount > 0 && !isBusy,
      'Relieve All Strain',
      treeMode ? busyOr('Absorb all strain into edge lengths', input.status) : 'Edge edits require a tree document'
    ),
    'edit.addLargestStubForNodes': capability(
      false,
      'Add Largest Stub From Nodes',
      'Stub finder port is pending'
    ),
    'edit.addLargestStubForPoly': capability(
      false,
      'Add Largest Stub From Poly',
      'Stub finder port is pending'
    ),
    'edit.triangulateTree': capability(false, 'Triangulate Tree', 'Stub finder triangulation port is pending'),
    'view.design': capability(true, 'Design', 'Show the design workspace'),
    'view.edit': capability(true, 'Edit', 'Show the edit workspace'),
    'view.creasePattern': capability(true, 'Edit', 'Show the edit workspace'),
    'view.simulate': capability(true, 'Simulate', 'Show the simulate workspace'),
    'view.simulator': capability(true, 'Simulate', 'Show the simulate workspace'),
    'view.conditions': capability(true, 'Conditions', 'Show the conditions pane'),
    'view.resetLayout': capability(true, 'Reset Layout', 'Reset pane layout'),
    'optimize.scale': commandCapability(
      canOptimize,
      treeMode,
      'Optimize Scale',
      canOptimize ? 'Optimize Scale' : disabledOptimizeReason(input, isBusy, hasTreeEdges)
    ),
    'optimize.edges': commandCapability(
      canOptimize,
      treeMode,
      'Optimize Edges',
      canOptimize ? 'Optimize Edges' : disabledOptimizeReason(input, isBusy, hasTreeEdges)
    ),
    'optimize.strain': commandCapability(
      canOptimize,
      treeMode,
      'Optimize Strain',
      canOptimize ? 'Optimize Strain' : disabledOptimizeReason(input, isBusy, hasTreeEdges)
    ),
    'cp.build': commandCapability(
      canBuild,
      treeMode,
      buildLabel,
      canBuild ? buildReason : disabledBuildReason(input, isBusy, hasTreeEdges)
    ),
    'cp.deleteSelectedLines': capability(
      canEditCp && hasSelectedCpLines,
      'Delete Selected CP Lines',
      canEditCp
        ? hasSelectedCpLines
          ? 'Delete selected crease-pattern lines'
          : 'Select one or more crease-pattern lines first'
        : 'Open an editable crease pattern before deleting lines'
    ),
    'cp.changeCreaseType': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Change Crease Type',
      'Change selected crease-pattern line types'
    ),
    'cp.advanceCreaseType': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Advance Crease Type',
      'Advance selected crease-pattern line types'
    ),
    'cp.makeMountain': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Make Mountain',
      'Make selected lines mountain folds'
    ),
    'cp.makeValley': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Make Valley',
      'Make selected lines valley folds'
    ),
    'cp.makeEdge': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Make Edge',
      'Make selected lines edge folds'
    ),
    'cp.makeAuxiliary': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Make Auxiliary',
      'Convert selected lines to auxiliary lines'
    ),
    'cp.toggleMountainValley': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Toggle Mountain/Valley',
      'Toggle selected mountain and valley lines'
    ),
    'cp.transformFlipHorizontal': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Flip Horizontal',
      'Flip selected crease-pattern lines horizontally'
    ),
    'cp.transformFlipVertical': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Flip Vertical',
      'Flip selected crease-pattern lines vertically'
    ),
    'cp.transformRotateLeft': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Rotate Left 90',
      'Rotate selected crease-pattern lines left'
    ),
    'cp.transformRotateRight': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Rotate Right 90',
      'Rotate selected crease-pattern lines right'
    ),
    'cp.replaceLineType': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Replace Selected Line Type...',
      'Open line-type replacement settings for selected lines'
    ),
    'cp.deleteLineType': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      'Delete Selected Line Type...',
      'Open line-type deletion settings for selected lines'
    ),
    'cp.checkCamv': capability(
      canEditCp,
      'Check CAMV',
      canEditCp ? 'Check Maekawa and related vertex flat-foldability issues' : 'Open an editable crease pattern first'
    ),
    'cp.check1': capability(
      canEditCp,
      'Check Overlaps',
      canEditCp ? 'Check overlapping or contained non-auxiliary creases' : 'Open an editable crease pattern first'
    ),
    'cp.check2': capability(
      canEditCp,
      'Check T-junctions',
      canEditCp ? 'Check near T-intersections between creases' : 'Open an editable crease pattern first'
    ),
    'cp.check3': capability(
      canEditCp,
      'Check Vertex Foldability',
      canEditCp ? 'Check vertex flat-foldability markers' : 'Open an editable crease pattern first'
    ),
    'cp.check4': capability(
      canEditCp,
      'Check Maekawa/LBL',
      canEditCp ? 'Check Maekawa, angle, and little-big-little violations' : 'Open an editable crease pattern first'
    ),
    'cp.fix1': capability(
      canEditCp,
      'Repair Overlaps',
      canEditCp
        ? 'Merge exact duplicates and select remaining overlapping creases'
        : 'Open an editable crease pattern first'
    ),
    'cp.fix2': capability(
      canEditCp,
      'Split T-junctions',
      canEditCp
        ? 'Split near T-intersections using Oriedita tolerances'
        : 'Open an editable crease pattern first'
    ),
    'cp.fixInaccurate': capability(
      canEditCp && hasSelectedCpLines,
      'Fix Inaccurate Creases...',
      canEditCp
        ? hasSelectedCpLines
          ? 'Open inaccurate-crease repair settings for selected lines'
          : 'Select one or more crease-pattern lines first'
        : 'Open an editable crease pattern first'
    ),
    'cp.changeCircleColor': capability(
      canEditCp && hasSelectedCpLinesOrCircles,
      'Change Circle Color...',
      canEditCp
        ? hasSelectedCpLinesOrCircles
          ? 'Open color settings for selected circles or auxiliary lines'
          : 'Select one or more circles or auxiliary lines first'
        : 'Open an editable crease pattern first'
    ),
    'cp.organizeCircles': capability(
      canEditCp,
      'Organize Circles',
      canEditCp ? 'Prune invalid zero-radius circles' : 'Open an editable crease pattern first'
    ),
    'simulator.refresh': capability(
      canRefreshFoldArtifacts,
      'Refresh',
      canRefreshFoldArtifacts
        ? busyOr('Refresh simulator model', input.status)
        : 'Build or edit a crease pattern before refreshing the simulator'
    ),
  };

  return maskCapabilitiesForContext(capabilities, input.activeEditingContext);
}

/**
 * TreeMaker/CP-specific commands that make no sense while authoring a Box-Pleat
 * design. Hidden (and disabled) in a BP context so the Design and Crease Pattern
 * menus — and the tree-editing Edit submenus — don't surface TreeMaker actions.
 * File/Edit(undo,redo,clipboard)/View stay available.
 */
const BP_HIDDEN_CAPABILITIES = new Set<WorkspaceCapabilityId>([
  'edit.makeRoot',
  'edit.splitEdge',
  'edit.setEdgeLength',
  'edit.scaleEdgeLengths',
  'edit.renormalizeToEdge',
  'edit.renormalizeToUnitScale',
  'edit.absorbNodes',
  'edit.absorbRedundantNodes',
  'edit.absorbEdges',
  'edit.perturbNodes',
  'edit.perturbAllNodes',
  'edit.removeStrain',
  'edit.removeAllStrain',
  'edit.relieveStrain',
  'edit.relieveAllStrain',
  'edit.addLargestStubForNodes',
  'edit.addLargestStubForPoly',
  'edit.triangulateTree',
  'edit.selectByIndex',
  'edit.selectMovableParts',
  'edit.selectCorridorFacets',
  'view.conditions',
  'file.exportV5',
  'file.exportV4',
  'file.exportCp',
  'file.exportFold',
  'file.exportOri',
  'file.exportOrh',
  'file.exportSvg',
  'file.exportPng',
]);

function maskCapabilitiesForContext(
  capabilities: WorkspaceCapabilities,
  context: EditingContext
): WorkspaceCapabilities {
  const isBpContext = context === 'bp-tree' || context === 'bp-packing';
  if (!isBpContext) return capabilities;
  const masked = { ...capabilities };
  for (const id of Object.keys(masked) as WorkspaceCapabilityId[]) {
    if (id.startsWith('optimize.') || id.startsWith('cp.') || BP_HIDDEN_CAPABILITIES.has(id)) {
      masked[id] = { ...masked[id], visible: false, enabled: false };
    }
  }
  return masked;
}

export function getNextDocumentAction(
  capabilities: WorkspaceCapabilities
): WorkspaceCapabilityId | null {
  if (capabilities['cp.build'].visible && capabilities['cp.build'].enabled) return 'cp.build';
  if (capabilities['optimize.scale'].visible) return 'optimize.scale';
  return null;
}

export function isWorkspaceBusy(status: AppStatus): boolean {
  return status === 'loading_engine' || status === 'optimizing' || status === 'building_crease_pattern';
}

function capability(enabled: boolean, label: string, reason: string): WorkspaceCapability {
  return { enabled, visible: true, label, reason };
}

function selectedCpLineCapability(
  canEditCp: boolean,
  hasSelectedCpLines: boolean,
  label: string,
  enabledReason: string
): WorkspaceCapability {
  return capability(
    canEditCp && hasSelectedCpLines,
    label,
    canEditCp
      ? hasSelectedCpLines
        ? enabledReason
        : 'Select one or more crease-pattern lines first'
      : 'Open an editable crease pattern first'
  );
}

function workspaceClipboardKind(clipboard: unknown | null): string | null {
  if (!clipboard || typeof clipboard !== 'object' || !('kind' in clipboard)) return null;
  const kind = (clipboard as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : null;
}

function commandCapability(
  enabled: boolean,
  visible: boolean,
  label: string,
  reason: string
): WorkspaceCapability {
  return { enabled, visible, label, reason };
}

function busyOr(reason: string, status: AppStatus): string {
  return isWorkspaceBusy(status) ? busyReason(status) : reason;
}

function busyReason(status: AppStatus): string {
  if (status === 'loading_engine') return 'Engine is still loading';
  if (status === 'optimizing') return 'Optimization is running';
  if (status === 'building_crease_pattern') return 'Crease pattern build is running';
  return 'Ori Studio is busy';
}

function disabledOptimizeReason(
  input: WorkspaceCapabilityInput,
  isBusy: boolean,
  hasTreeEdges: boolean
): string {
  if (input.activeEditingContext !== 'treemaker-tree')
    return 'Optimization requires an editable tree document';
  if (!input.engineReady || input.status === 'loading_engine') return 'Engine is still loading';
  if (isBusy) return busyReason(input.status);
  if (!hasTreeEdges) return 'Add at least one tree edge before optimizing';
  if (input.status === 'error') return 'Resolve the current engine error before optimizing';
  return 'Optimization is unavailable';
}

function disabledBuildReason(
  input: WorkspaceCapabilityInput,
  isBusy: boolean,
  hasTreeEdges: boolean
): string {
  if (input.activeEditingContext !== 'treemaker-tree')
    return 'Build CP requires an editable tree document';
  if (!input.engineReady || input.status === 'loading_engine') return 'Engine is still loading';
  if (isBusy) return busyReason(input.status);
  if (input.status === 'error') return 'Resolve the current engine error before building the crease pattern';
  if (!hasTreeEdges) return 'Add tree edges, then optimize before building the crease pattern';
  return 'Optimize Scale before building the crease pattern';
}

function selectedEdgeCount(selection: Selection): number {
  if (selection.kind === 'edge') return 1;
  if (selection.kind === 'multi') return selection.edges.length;
  return 0;
}

function selectedNodeCount(selection: Selection): number {
  if (selection.kind === 'node') return 1;
  if (selection.kind === 'multi') return selection.nodes.length;
  return 0;
}

function selectionHasEditableParts(selection: Selection): boolean {
  if (selection.kind === 'tree') return false;
  if (selection.kind === 'multi') {
    return (
      selection.nodes.length +
        selection.edges.length +
        selection.paths.length +
        selection.conditions.length >
      0
    );
  }
  return selection.kind === 'node' || selection.kind === 'edge' || selection.kind === 'path' || selection.kind === 'condition';
}
