import type { TFunction } from 'i18next';
import type { AppStatus, Selection } from './sampleProject';
import type { EditingContext } from '../workspaces/editingContext';

// Fallback translator returning the inline English default — used when a caller reads
// capabilities imperatively or in tests without a live i18n instance.
const identityTranslate = ((_key: string, defaultValue?: string) =>
  defaultValue ?? _key) as unknown as TFunction;

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
  | 'file.exportBps'
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
  hasBoxPleatDocument: boolean;
  hasSimulationModel: boolean;
  oristudioCpSelectedLineCount: number;
  oristudioCpSelectedPointCount: number;
  oristudioCpSelectedCircleCount: number;
  hasDeletableBpSelection: boolean;
  historyPastCount: number;
  historyFutureCount: number;
  clipboard: unknown | null;
  selection: Selection;
}

export function getWorkspaceCapabilities(
  input: WorkspaceCapabilityInput,
  t: TFunction = identityTranslate
): WorkspaceCapabilities {
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
  // A box-pleat design saves as a native .osf (bundling its companion CP).
  const canSaveBoxPleat = isBpContext && input.hasBoxPleatDocument;
  const canExportEditableCp = input.hasEditableCreasePattern;
  const canExportCreasePattern = hasCreasePattern && !isBusy;
  const canEditCp = input.hasEditableCreasePattern && !isBusy;
  const canRefreshFoldArtifacts =
    !isBusy &&
    (input.hasEditableCreasePattern ||
      (treeMode && (input.creaseCount > 0 || input.facetCount > 0)));
  const hasSelectedCpLines = input.oristudioCpSelectedLineCount > 0;
  const hasSelectedCpPoints = input.oristudioCpSelectedPointCount > 0;
  const hasSelectedCpCircles = input.oristudioCpSelectedCircleCount > 0;
  const hasSelectedCpLinesOrCircles = hasSelectedCpLines || hasSelectedCpCircles;
  const hasSelection = selectionHasEditableParts(input.selection);
  const hasSelectedEdges = selectedEdgeCount(input.selection) > 0;
  const hasOneSelectedEdge = selectedEdgeCount(input.selection) === 1;
  const hasSelectedNodes = selectedNodeCount(input.selection) > 0;
  const hasOneSelectedNode = selectedNodeCount(input.selection) === 1;
  const clipboardKind = workspaceClipboardKind(input.clipboard);
  const buildLabel = hasCreasePattern
    ? t('common:capability.rebuildCp', 'Rebuild CP')
    : t('common:capability.buildCp', 'Build CP');
  const buildReason = hasCreasePattern
    ? t('common:capability.rebuildCreasePattern', 'Rebuild crease pattern')
    : t('common:capability.buildCreasePattern', 'Build crease pattern');

  const capabilities: WorkspaceCapabilities = {
    'file.new': capability(
      !isBusy,
      t('common:capability.new', 'New'),
      isBusy
        ? busyReason(input.status, t)
        : t('common:capability.chooseNewWorkspace', 'Choose a new Ori Studio workspace')
    ),
    'file.open': capability(
      !isBusy,
      t('common:capability.open', 'Open...'),
      isBusy
        ? busyReason(input.status, t)
        : t('common:capability.openProjectOrCreasePattern', 'Open a project or crease pattern')
    ),
    'file.importAdd': capability(
      canEditCp,
      t('common:capability.importAdd', 'Import (Add)...'),
      canEditCp
        ? t('common:capability.importCreasePatternBeside', 'Import a crease pattern beside the current one')
        : input.hasEditableCreasePattern
          ? busyReason(input.status, t)
          : t('common:capability.openEditableCpBeforeImporting', 'Open an editable crease pattern before importing')
    ),
    'file.detectCpImage': capability(
      !isBusy,
      t('common:capability.detectCpFromImage', 'Detect CP from Image...'),
      isBusy
        ? busyReason(input.status, t)
        : t('common:capability.detectSquareCpFromImage', 'Detect a square crease pattern from an image')
    ),
    'file.save': capability(
      (treeMode || canSaveEditableCreasePattern || canSaveBoxPleat) && !isBusy,
      t('common:capability.save', 'Save'),
      treeMode || canSaveBoxPleat
        ? busyOr(t('common:capability.saveProject', 'Save Ori Studio project'), input.status, t)
        : canSaveEditableCreasePattern
          ? busyOr(t('common:capability.saveEditableCpAsProject', 'Save editable crease pattern as an Ori Studio project'), input.status, t)
          : t('common:capability.editableCpKernelUnavailable', 'Editable crease-pattern kernel is unavailable')
    ),
    'file.saveAs': capability(
      (treeMode || canSaveEditableCreasePattern || canSaveBoxPleat) && !isBusy,
      t('common:capability.saveAs', 'Save As...'),
      treeMode || canSaveBoxPleat
        ? busyOr(t('common:capability.saveProjectAsNewFile', 'Save Ori Studio project as a new file'), input.status, t)
        : canSaveEditableCreasePattern
          ? busyOr(t('common:capability.saveEditableCpAsNewProject', 'Save editable crease pattern as a new Ori Studio project'), input.status, t)
          : t('common:capability.editableCpKernelUnavailable', 'Editable crease-pattern kernel is unavailable')
    ),
    'file.exportV5': capability(
      treeMode && !isBusy,
      t('common:capability.exportTreeMaker5', 'Export TreeMaker 5...'),
      treeMode
        ? busyOr(t('common:capability.exportTreeMaker5Project', 'Export TreeMaker 5 project'), input.status, t)
        : t('common:capability.treeMaker5ExportRequiresTree', 'TreeMaker 5 export requires a tree document')
    ),
    'file.exportV4': capability(
      treeMode && !isBusy,
      t('common:capability.exportTreeMaker4', 'Export TreeMaker 4...'),
      treeMode
        ? busyOr(t('common:capability.exportTreeMaker4Project', 'Export TreeMaker 4 project'), input.status, t)
        : t('common:capability.treeMaker4ExportRequiresTree', 'TreeMaker 4 export requires a tree document')
    ),
    'file.exportCp': capability(
      canExportEditableCp && !isBusy,
      t('common:capability.exportCp', 'Export CP...'),
      canExportEditableCp
        ? busyOr(t('common:capability.exportEditableCpAsCp', 'Export editable crease pattern as CP'), input.status, t)
        : t('common:capability.openEditableCpBeforeExportingCp', 'Open an editable crease pattern before exporting CP')
    ),
    'file.exportFold': capability(
      (canExportTreeFold || canExportEditableOrImportedFold) && !isBusy,
      t('common:capability.exportFold', 'Export FOLD...'),
      canExportTreeFold || canExportEditableOrImportedFold
        ? busyOr(t('common:capability.exportFoldDocument', 'Export FOLD document'), input.status, t)
        : treeMode
          ? t('common:capability.buildCpBeforeExportingFold', 'Build a crease pattern before exporting FOLD')
          : t('common:capability.openCpBeforeExportingFold', 'Open a crease pattern before exporting FOLD')
    ),
    'file.exportBps': commandCapability(
      input.hasBoxPleatDocument && !isBusy,
      input.hasBoxPleatDocument,
      t('common:capability.exportBps', 'Export .bps...'),
      input.hasBoxPleatDocument
        ? busyOr(t('common:capability.exportBoxPleatAsBps', 'Export the box-pleat design as a Box Pleating Studio .bps file'), input.status, t)
        : t('common:capability.openBoxPleatBeforeExportingBps', 'Open a box-pleat design before exporting .bps')
    ),
    'file.exportOri': capability(
      canExportEditableCp && !isBusy,
      t('common:capability.exportOri', 'Export ORI...'),
      canExportEditableCp
        ? busyOr(t('common:capability.exportEditableCpAsOri', 'Export editable crease pattern as an Oriedita ORI document'), input.status, t)
        : t('common:capability.openEditableCpBeforeExportingOri', 'Open an editable crease pattern before exporting ORI')
    ),
    'file.exportOrh': capability(
      canExportEditableCp && !isBusy,
      t('common:capability.exportOrh', 'Export ORH...'),
      canExportEditableCp
        ? busyOr(t('common:capability.exportEditableCpAsOrh', 'Export editable crease pattern as a legacy Oriedita/Orihime ORH document'), input.status, t)
        : t('common:capability.openEditableCpBeforeExportingOrh', 'Open an editable crease pattern before exporting ORH')
    ),
    'file.exportSvg': capability(
      canExportCreasePattern,
      t('common:capability.exportSvg', 'Export SVG...'),
      hasCreasePattern
        ? busyOr(t('common:capability.exportCreasePatternSvg', 'Export crease pattern SVG'), input.status, t)
        : t('common:capability.noCreasePatternToExport', 'No crease pattern to export')
    ),
    'file.exportPng': capability(
      canExportCreasePattern,
      t('common:capability.exportPng', 'Export PNG...'),
      hasCreasePattern
        ? busyOr(t('common:capability.exportCreasePatternPng', 'Export crease pattern PNG'), input.status, t)
        : t('common:capability.noCreasePatternToExport', 'No crease pattern to export')
    ),
    'edit.undo': capability(
      input.historyPastCount > 0 && !isBusy,
      t('common:capability.undo', 'Undo'),
      activeCpSurface
          ? t('common:capability.undoLastCpEdit', 'Undo the last crease-pattern edit')
          : t('common:capability.undoLastTreeEdit', 'Undo the last tree edit')
    ),
    'edit.redo': capability(
      input.historyFutureCount > 0 && !isBusy,
      t('common:capability.redo', 'Redo'),
      activeCpSurface
          ? t('common:capability.redoNextCpEdit', 'Redo the next crease-pattern edit')
          : t('common:capability.redoNextTreeEdit', 'Redo the next tree edit')
    ),
    'edit.cut': capability(
      treeMode && hasSelection && !isBusy,
      t('common:capability.cut', 'Cut'),
      treeMode
        ? t('common:capability.cutSelectedTreeParts', 'Cut selected tree parts')
        : t('common:capability.importedCpReadOnly', 'Imported crease patterns are read-only')
    ),
    'edit.copy': capability(
      (treeMode && hasSelection) || (canEditCp && hasSelectedCpLines),
      t('common:capability.copy', 'Copy'),
      treeMode
        ? t('common:capability.copySelectedTreeParts', 'Copy selected tree parts')
        : canEditCp
          ? hasSelectedCpLines
            ? t('common:capability.copySelectedCpLines', 'Copy selected crease-pattern lines')
            : t('common:capability.selectCpLinesFirst', 'Select one or more crease-pattern lines first')
          : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'edit.paste': capability(
      (treeMode && clipboardKind === 'tree' && !isBusy) ||
        (canEditCp && clipboardKind === 'cp-lines'),
      t('common:capability.paste', 'Paste'),
      treeMode
        ? clipboardKind === 'tree'
          ? busyOr(t('common:capability.pasteCopiedTreeParts', 'Paste copied tree parts'), input.status, t)
          : t('common:capability.copyTreePartsBeforePasting', 'Copy tree parts before pasting')
        : canEditCp
          ? clipboardKind === 'cp-lines'
            ? t('common:capability.pasteCopiedCpLines', 'Paste copied crease-pattern lines')
            : t('common:capability.copyCpLinesBeforePasting', 'Copy crease-pattern lines before pasting')
          : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'edit.delete': capability(
      (isBpContext && input.hasDeletableBpSelection && !isBusy) ||
        (!isBpContext && treeMode && !activeCpSurface && hasSelection && !isBusy) ||
        (canEditCp && activeCpSurface && (hasSelectedCpLines || hasSelectedCpPoints)),
      t('common:capability.deleteSelected', 'Delete Selected'),
      treeMode && !activeCpSurface
        ? t('common:capability.deleteSelectedTreeParts', 'Delete selected tree parts')
        : canEditCp
          ? hasSelectedCpLines
            ? t('common:capability.deleteSelectedCpLines', 'Delete selected crease-pattern lines')
            : hasSelectedCpPoints
              ? t('common:capability.deleteSelectedCpPoints', 'Delete selected crease-pattern points')
              : t('common:capability.selectCpLinesOrPointsFirst', 'Select one or more crease-pattern lines or points first')
          : t('common:capability.importedCpReadOnly', 'Imported crease patterns are read-only')
    ),
    'edit.selectAll': capability(
      true,
      t('common:capability.selectAll', 'Select All'),
      t('common:capability.selectVisibleDocumentParts', 'Select visible document parts')
    ),
    'edit.deselectAll': capability(
      true,
      t('common:capability.deselectAll', 'Deselect All'),
      t('common:capability.clearCurrentSelection', 'Clear the current selection')
    ),
    'edit.selectByIndex': capability(
      true,
      t('common:capability.selectByIndex', 'Select By Index...'),
      t('common:capability.selectPartByTreeMakerIndex', 'Select a document part by its TreeMaker index')
    ),
    'edit.selectMovableParts': capability(
      treeMode && !isBusy,
      t('common:capability.selectMovableParts', 'Select Movable Parts'),
      treeMode
        ? busyOr(t('common:capability.selectUnpinnedLeafNodesAndEdges', 'Select unpinned leaf nodes and movable edges'), input.status, t)
        : t('common:capability.movablePartsRequireTree', 'Movable parts require a tree document')
    ),
    'edit.selectCorridorFacets': capability(
      input.facetCount > 0 && hasSelectedEdges,
      t('common:capability.selectCorridorFacets', 'Select Corridor Facets'),
      input.facetCount > 0
        ? hasSelectedEdges
          ? t('common:capability.selectFacetsInEdgeCorridors', 'Select facets in selected edge corridors')
          : t('common:capability.selectTreeEdgesFirst', 'Select one or more tree edges first')
        : t('common:capability.buildCpBeforeSelectingCorridorFacets', 'Build a crease pattern before selecting corridor facets')
    ),
    'edit.makeRoot': capability(
      treeMode && hasOneSelectedNode && !isBusy,
      t('common:capability.makeRoot', 'Make Root'),
      treeMode
        ? busyOr(t('common:capability.makeSelectedNodeRoot', 'Make selected node the root'), input.status, t)
        : t('common:capability.rootEditsRequireTree', 'Root edits require a tree document')
    ),
    'edit.splitEdge': capability(
      treeMode && hasOneSelectedEdge && !isBusy,
      t('common:capability.splitEdge', 'Split Edge...'),
      treeMode
        ? busyOr(t('common:capability.splitSelectedEdge', 'Split selected edge'), input.status, t)
        : t('common:capability.edgeEditsRequireTree', 'Edge edits require a tree document')
    ),
    'edit.setEdgeLength': capability(
      treeMode && hasSelectedEdges && !isBusy,
      t('common:capability.setEdgeLength', 'Set Edge Length...'),
      treeMode
        ? busyOr(t('common:capability.setSelectedEdgeLengths', 'Set selected edge lengths'), input.status, t)
        : t('common:capability.edgeEditsRequireTree', 'Edge edits require a tree document')
    ),
    'edit.scaleEdgeLengths': capability(
      treeMode && hasSelectedEdges && !isBusy,
      t('common:capability.scaleEdgeLengths', 'Scale Edge Lengths...'),
      treeMode
        ? busyOr(t('common:capability.scaleSelectedEdgeLengths', 'Scale selected edge lengths'), input.status, t)
        : t('common:capability.edgeEditsRequireTree', 'Edge edits require a tree document')
    ),
    'edit.renormalizeToEdge': capability(
      treeMode && hasOneSelectedEdge && !isBusy,
      t('common:capability.renormalizeToEdge', 'Renormalize To Edge'),
      treeMode
        ? busyOr(t('common:capability.renormalizeModelToEdge', 'Renormalize model to selected edge'), input.status, t)
        : t('common:capability.edgeEditsRequireTree', 'Edge edits require a tree document')
    ),
    'edit.renormalizeToUnitScale': capability(
      treeMode && input.edgeCount > 0 && !isBusy,
      t('common:capability.renormalizeToUnitScale', 'Renormalize To Unit Scale'),
      treeMode
        ? busyOr(t('common:capability.renormalizeModelToUnitScale', 'Renormalize model to unit scale'), input.status, t)
        : t('common:capability.treeEditsRequireTree', 'Tree edits require a tree document')
    ),
    'edit.absorbNodes': capability(
      treeMode && hasSelectedNodes && !isBusy,
      t('common:capability.absorbNodes', 'Absorb Nodes'),
      treeMode
        ? busyOr(t('common:capability.absorbSelectedRedundantNodes', 'Absorb selected redundant nodes'), input.status, t)
        : t('common:capability.nodeEditsRequireTree', 'Node edits require a tree document')
    ),
    'edit.absorbRedundantNodes': capability(
      treeMode && input.edgeCount > 0 && !isBusy,
      t('common:capability.absorbRedundantNodes', 'Absorb Redundant Nodes'),
      treeMode
        ? busyOr(t('common:capability.absorbDegreeTwoInternalNodes', 'Absorb all degree-two internal nodes'), input.status, t)
        : t('common:capability.nodeEditsRequireTree', 'Node edits require a tree document')
    ),
    'edit.absorbEdges': capability(
      treeMode && hasSelectedEdges && !isBusy,
      t('common:capability.absorbEdges', 'Absorb Edges'),
      treeMode
        ? busyOr(t('common:capability.absorbSelectedEdges', 'Absorb selected edges'), input.status, t)
        : t('common:capability.edgeEditsRequireTree', 'Edge edits require a tree document')
    ),
    'edit.perturbNodes': capability(
      treeMode && hasSelectedNodes && !isBusy,
      t('common:capability.perturbNodes', 'Perturb Nodes'),
      treeMode
        ? busyOr(t('common:capability.perturbSelectedNodes', 'Perturb selected nodes'), input.status, t)
        : t('common:capability.nodeEditsRequireTree', 'Node edits require a tree document')
    ),
    'edit.perturbAllNodes': capability(
      treeMode && !isBusy,
      t('common:capability.perturbAllNodes', 'Perturb All Nodes'),
      treeMode
        ? busyOr(t('common:capability.perturbAllNodesReason', 'Perturb all nodes'), input.status, t)
        : t('common:capability.nodeEditsRequireTree', 'Node edits require a tree document')
    ),
    'edit.removeStrain': capability(
      treeMode && hasSelectedEdges && !isBusy,
      t('common:capability.removeStrain', 'Remove Strain'),
      treeMode
        ? busyOr(t('common:capability.clearSelectedEdgeStrain', 'Clear selected edge strain'), input.status, t)
        : t('common:capability.edgeEditsRequireTree', 'Edge edits require a tree document')
    ),
    'edit.removeAllStrain': capability(
      treeMode && input.edgeCount > 0 && !isBusy,
      t('common:capability.removeAllStrain', 'Remove All Strain'),
      treeMode
        ? busyOr(t('common:capability.clearAllEdgeStrain', 'Clear all edge strain'), input.status, t)
        : t('common:capability.edgeEditsRequireTree', 'Edge edits require a tree document')
    ),
    'edit.relieveStrain': capability(
      treeMode && hasSelectedEdges && !isBusy,
      t('common:capability.relieveStrain', 'Relieve Strain'),
      treeMode
        ? busyOr(t('common:capability.absorbSelectedStrainIntoLength', 'Absorb selected strain into edge length'), input.status, t)
        : t('common:capability.edgeEditsRequireTree', 'Edge edits require a tree document')
    ),
    'edit.relieveAllStrain': capability(
      treeMode && input.edgeCount > 0 && !isBusy,
      t('common:capability.relieveAllStrain', 'Relieve All Strain'),
      treeMode
        ? busyOr(t('common:capability.absorbAllStrainIntoLengths', 'Absorb all strain into edge lengths'), input.status, t)
        : t('common:capability.edgeEditsRequireTree', 'Edge edits require a tree document')
    ),
    'edit.addLargestStubForNodes': capability(
      false,
      t('common:capability.addLargestStubFromNodes', 'Add Largest Stub From Nodes'),
      t('common:capability.stubFinderPortPending', 'Stub finder port is pending')
    ),
    'edit.addLargestStubForPoly': capability(
      false,
      t('common:capability.addLargestStubFromPoly', 'Add Largest Stub From Poly'),
      t('common:capability.stubFinderPortPending', 'Stub finder port is pending')
    ),
    'edit.triangulateTree': capability(
      false,
      t('common:capability.triangulateTree', 'Triangulate Tree'),
      t('common:capability.stubFinderTriangulationPortPending', 'Stub finder triangulation port is pending')
    ),
    'view.design': capability(
      true,
      t('common:capability.design', 'Design'),
      t('common:capability.showDesignWorkspace', 'Show the design workspace')
    ),
    'view.edit': capability(
      true,
      t('common:capability.edit', 'Edit'),
      t('common:capability.showEditWorkspace', 'Show the edit workspace')
    ),
    'view.creasePattern': capability(
      true,
      t('common:capability.edit', 'Edit'),
      t('common:capability.showEditWorkspace', 'Show the edit workspace')
    ),
    'view.simulate': capability(
      true,
      t('common:capability.simulate', 'Simulate'),
      t('common:capability.showSimulateWorkspace', 'Show the simulate workspace')
    ),
    'view.simulator': capability(
      true,
      t('common:capability.simulate', 'Simulate'),
      t('common:capability.showSimulateWorkspace', 'Show the simulate workspace')
    ),
    'view.conditions': capability(
      true,
      t('common:capability.conditions', 'Conditions'),
      t('common:capability.showConditionsPane', 'Show the conditions pane')
    ),
    'view.resetLayout': capability(
      true,
      t('common:capability.resetLayout', 'Reset Layout'),
      t('common:capability.resetPaneLayout', 'Reset pane layout')
    ),
    'optimize.scale': commandCapability(
      canOptimize,
      treeMode,
      t('common:capability.optimizeScale', 'Optimize Scale'),
      canOptimize ? t('common:capability.optimizeScale', 'Optimize Scale') : disabledOptimizeReason(input, isBusy, hasTreeEdges, t)
    ),
    'optimize.edges': commandCapability(
      canOptimize,
      treeMode,
      t('common:capability.optimizeEdges', 'Optimize Edges'),
      canOptimize ? t('common:capability.optimizeEdges', 'Optimize Edges') : disabledOptimizeReason(input, isBusy, hasTreeEdges, t)
    ),
    'optimize.strain': commandCapability(
      canOptimize,
      treeMode,
      t('common:capability.optimizeStrain', 'Optimize Strain'),
      canOptimize ? t('common:capability.optimizeStrain', 'Optimize Strain') : disabledOptimizeReason(input, isBusy, hasTreeEdges, t)
    ),
    'cp.build': commandCapability(
      canBuild,
      treeMode,
      buildLabel,
      canBuild ? buildReason : disabledBuildReason(input, isBusy, hasTreeEdges, t)
    ),
    'cp.deleteSelectedLines': capability(
      canEditCp && hasSelectedCpLines,
      t('common:capability.deleteSelectedCpLinesLabel', 'Delete Selected CP Lines'),
      canEditCp
        ? hasSelectedCpLines
          ? t('common:capability.deleteSelectedCpLines', 'Delete selected crease-pattern lines')
          : t('common:capability.selectCpLinesFirst', 'Select one or more crease-pattern lines first')
        : t('common:capability.openEditableCpBeforeDeletingLines', 'Open an editable crease pattern before deleting lines')
    ),
    'cp.changeCreaseType': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.changeCreaseType', 'Change Crease Type'),
      t('common:capability.changeSelectedCpLineTypes', 'Change selected crease-pattern line types'),
      t
    ),
    'cp.advanceCreaseType': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.advanceCreaseType', 'Advance Crease Type'),
      t('common:capability.advanceSelectedCpLineTypes', 'Advance selected crease-pattern line types'),
      t
    ),
    'cp.makeMountain': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.makeMountain', 'Make Mountain'),
      t('common:capability.makeSelectedLinesMountain', 'Make selected lines mountain folds'),
      t
    ),
    'cp.makeValley': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.makeValley', 'Make Valley'),
      t('common:capability.makeSelectedLinesValley', 'Make selected lines valley folds'),
      t
    ),
    'cp.makeEdge': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.makeEdge', 'Make Edge'),
      t('common:capability.makeSelectedLinesEdge', 'Make selected lines edge folds'),
      t
    ),
    'cp.makeAuxiliary': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.makeAuxiliary', 'Make Auxiliary'),
      t('common:capability.convertSelectedLinesToAuxiliary', 'Convert selected lines to auxiliary lines'),
      t
    ),
    'cp.toggleMountainValley': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.toggleMountainValley', 'Toggle Mountain/Valley'),
      t('common:capability.toggleSelectedMountainValleyLines', 'Toggle selected mountain and valley lines'),
      t
    ),
    'cp.transformFlipHorizontal': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.flipHorizontal', 'Flip Horizontal'),
      t('common:capability.flipSelectedCpLinesHorizontally', 'Flip selected crease-pattern lines horizontally'),
      t
    ),
    'cp.transformFlipVertical': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.flipVertical', 'Flip Vertical'),
      t('common:capability.flipSelectedCpLinesVertically', 'Flip selected crease-pattern lines vertically'),
      t
    ),
    'cp.transformRotateLeft': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.rotateLeft90', 'Rotate Left 90'),
      t('common:capability.rotateSelectedCpLinesLeft', 'Rotate selected crease-pattern lines left'),
      t
    ),
    'cp.transformRotateRight': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.rotateRight90', 'Rotate Right 90'),
      t('common:capability.rotateSelectedCpLinesRight', 'Rotate selected crease-pattern lines right'),
      t
    ),
    'cp.replaceLineType': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.replaceSelectedLineType', 'Replace Selected Line Type...'),
      t('common:capability.openLineTypeReplacementSettings', 'Open line-type replacement settings for selected lines'),
      t
    ),
    'cp.deleteLineType': selectedCpLineCapability(
      canEditCp,
      hasSelectedCpLines,
      t('common:capability.deleteSelectedLineType', 'Delete Selected Line Type...'),
      t('common:capability.openLineTypeDeletionSettings', 'Open line-type deletion settings for selected lines'),
      t
    ),
    'cp.checkCamv': capability(
      canEditCp,
      t('common:capability.checkCamv', 'Check CAMV'),
      canEditCp
        ? t('common:capability.checkMaekawaVertexFoldability', 'Check Maekawa and related vertex flat-foldability issues')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'cp.check1': capability(
      canEditCp,
      t('common:capability.checkOverlaps', 'Check Overlaps'),
      canEditCp
        ? t('common:capability.checkOverlappingCreases', 'Check overlapping or contained non-auxiliary creases')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'cp.check2': capability(
      canEditCp,
      t('common:capability.checkTJunctions', 'Check T-junctions'),
      canEditCp
        ? t('common:capability.checkNearTIntersections', 'Check near T-intersections between creases')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'cp.check3': capability(
      canEditCp,
      t('common:capability.checkVertexFoldability', 'Check Vertex Foldability'),
      canEditCp
        ? t('common:capability.checkVertexFoldabilityMarkers', 'Check vertex flat-foldability markers')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'cp.check4': capability(
      canEditCp,
      t('common:capability.checkMaekawaLbl', 'Check Maekawa/LBL'),
      canEditCp
        ? t('common:capability.checkMaekawaAngleLblViolations', 'Check Maekawa, angle, and little-big-little violations')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'cp.fix1': capability(
      canEditCp,
      t('common:capability.repairOverlaps', 'Repair Overlaps'),
      canEditCp
        ? t('common:capability.mergeDuplicatesSelectOverlaps', 'Merge exact duplicates and select remaining overlapping creases')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'cp.fix2': capability(
      canEditCp,
      t('common:capability.splitTJunctions', 'Split T-junctions'),
      canEditCp
        ? t('common:capability.splitNearTIntersections', 'Split near T-intersections using Oriedita tolerances')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'cp.fixInaccurate': capability(
      canEditCp && hasSelectedCpLines,
      t('common:capability.fixInaccurateCreases', 'Fix Inaccurate Creases...'),
      canEditCp
        ? hasSelectedCpLines
          ? t('common:capability.openInaccurateCreaseRepairSettings', 'Open inaccurate-crease repair settings for selected lines')
          : t('common:capability.selectCpLinesFirst', 'Select one or more crease-pattern lines first')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'cp.changeCircleColor': capability(
      canEditCp && hasSelectedCpLinesOrCircles,
      t('common:capability.changeCircleColor', 'Change Circle Color...'),
      canEditCp
        ? hasSelectedCpLinesOrCircles
          ? t('common:capability.openCircleColorSettings', 'Open color settings for selected circles or auxiliary lines')
          : t('common:capability.selectCirclesOrAuxLinesFirst', 'Select one or more circles or auxiliary lines first')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'cp.organizeCircles': capability(
      canEditCp,
      t('common:capability.organizeCircles', 'Organize Circles'),
      canEditCp
        ? t('common:capability.pruneZeroRadiusCircles', 'Prune invalid zero-radius circles')
        : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
    ),
    'simulator.refresh': capability(
      canRefreshFoldArtifacts,
      t('common:capability.refresh', 'Refresh'),
      canRefreshFoldArtifacts
        ? busyOr(t('common:capability.refreshSimulatorModel', 'Refresh simulator model'), input.status, t)
        : t('common:capability.buildOrEditCpBeforeRefreshing', 'Build or edit a crease pattern before refreshing the simulator')
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

// Undo/redo stay in the Edit menu while simulating (rendered inert — the
// simulate context has no history stack, so the count is zero and they are
// disabled). Every other `edit.*` command authors the tree and is hidden.
const SIMULATE_VISIBLE_EDIT = new Set<WorkspaceCapabilityId>(['edit.undo', 'edit.redo']);

function maskCapabilitiesForContext(
  capabilities: WorkspaceCapabilities,
  context: EditingContext
): WorkspaceCapabilities {
  if (context === 'simulate') {
    // Simulate is a read-only consumer of the folded model: only navigation
    // (`view.*`), file operations, playback (`simulator.*`), and inert
    // undo/redo apply. Every authoring command is hidden.
    const masked = { ...capabilities };
    for (const id of Object.keys(masked) as WorkspaceCapabilityId[]) {
      const isAuthoring =
        id.startsWith('cp.') ||
        id.startsWith('optimize.') ||
        (id.startsWith('edit.') && !SIMULATE_VISIBLE_EDIT.has(id));
      if (isAuthoring) {
        masked[id] = { ...masked[id], visible: false, enabled: false };
      }
    }
    return masked;
  }

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
  enabledReason: string,
  t: TFunction
): WorkspaceCapability {
  return capability(
    canEditCp && hasSelectedCpLines,
    label,
    canEditCp
      ? hasSelectedCpLines
        ? enabledReason
        : t('common:capability.selectCpLinesFirst', 'Select one or more crease-pattern lines first')
      : t('common:capability.openEditableCpFirst', 'Open an editable crease pattern first')
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

function busyOr(reason: string, status: AppStatus, t: TFunction): string {
  return isWorkspaceBusy(status) ? busyReason(status, t) : reason;
}

function busyReason(status: AppStatus, t: TFunction): string {
  if (status === 'loading_engine') return t('common:capability.engineStillLoading', 'Engine is still loading');
  if (status === 'optimizing') return t('common:capability.optimizationRunning', 'Optimization is running');
  if (status === 'building_crease_pattern') return t('common:capability.creasePatternBuildRunning', 'Crease pattern build is running');
  return t('common:capability.oriStudioBusy', 'Ori Studio is busy');
}

function disabledOptimizeReason(
  input: WorkspaceCapabilityInput,
  isBusy: boolean,
  hasTreeEdges: boolean,
  t: TFunction
): string {
  if (input.activeEditingContext !== 'treemaker-tree')
    return t('common:capability.optimizationRequiresTree', 'Optimization requires an editable tree document');
  if (!input.engineReady || input.status === 'loading_engine') return t('common:capability.engineStillLoading', 'Engine is still loading');
  if (isBusy) return busyReason(input.status, t);
  if (!hasTreeEdges) return t('common:capability.addTreeEdgeBeforeOptimizing', 'Add at least one tree edge before optimizing');
  if (input.status === 'error') return t('common:capability.resolveEngineErrorBeforeOptimizing', 'Resolve the current engine error before optimizing');
  return t('common:capability.optimizationUnavailable', 'Optimization is unavailable');
}

function disabledBuildReason(
  input: WorkspaceCapabilityInput,
  isBusy: boolean,
  hasTreeEdges: boolean,
  t: TFunction
): string {
  if (input.activeEditingContext !== 'treemaker-tree')
    return t('common:capability.buildCpRequiresTree', 'Build CP requires an editable tree document');
  if (!input.engineReady || input.status === 'loading_engine') return t('common:capability.engineStillLoading', 'Engine is still loading');
  if (isBusy) return busyReason(input.status, t);
  if (input.status === 'error') return t('common:capability.resolveEngineErrorBeforeBuilding', 'Resolve the current engine error before building the crease pattern');
  if (!hasTreeEdges) return t('common:capability.addTreeEdgesThenOptimize', 'Add tree edges, then optimize before building the crease pattern');
  return t('common:capability.optimizeScaleBeforeBuild', 'Optimize Scale before building the crease pattern');
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
