import { describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../engine/oristudioCpTypes';
import type { OristudioCpSelection } from '../lib/creasePatternViewport';
import { getWorkspaceCapabilities } from '../lib/workspaceCapabilities';
import { createFileService } from '../platform/fileService';
import { createMenuActionHandler, isMenuActionId } from './menuActions';

function createDeps() {
  return {
    workspace: {
      createNewProject: vi.fn().mockResolvedValue(undefined),
      loadExampleProject: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue(true),
      importAddCreasePattern: vi.fn().mockResolvedValue(true),
      saveProject: vi.fn().mockResolvedValue(true),
      saveProjectAs: vi.fn().mockResolvedValue(true),
      exportV5: vi.fn().mockResolvedValue(true),
      exportV4: vi.fn().mockResolvedValue(true),
      exportCp: vi.fn().mockResolvedValue(true),
      exportFold: vi.fn().mockResolvedValue(true),
      exportOri: vi.fn().mockResolvedValue(true),
      exportOrh: vi.fn().mockResolvedValue(true),
      exportSvg: vi.fn().mockResolvedValue(true),
      exportPng: vi.fn().mockResolvedValue(true),
      undo: vi.fn().mockResolvedValue(undefined),
      redo: vi.fn().mockResolvedValue(undefined),
      cutSelection: vi.fn().mockResolvedValue(undefined),
      copySelection: vi.fn(),
      pasteClipboard: vi.fn().mockResolvedValue(undefined),
      deleteSelection: vi.fn().mockResolvedValue(undefined),
      optimizeScale: vi.fn().mockResolvedValue(undefined),
      optimizeEdges: vi.fn().mockResolvedValue(undefined),
      optimizeStrain: vi.fn().mockResolvedValue(undefined),
      buildCreasePattern: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(),
      selectAll: vi.fn(),
      selectNone: vi.fn(),
      selectMovableParts: vi.fn(),
      selectCorridorFacets: vi.fn(),
      makeSelectedNodeRoot: vi.fn().mockResolvedValue(undefined),
      splitSelectedEdge: vi.fn().mockResolvedValue(undefined),
      setSelectedEdgeLengths: vi.fn().mockResolvedValue(undefined),
      scaleSelectedEdgeLengths: vi.fn().mockResolvedValue(undefined),
      renormalizeToSelectedEdge: vi.fn().mockResolvedValue(undefined),
      renormalizeToUnitScale: vi.fn().mockResolvedValue(undefined),
      absorbSelectedNodes: vi.fn().mockResolvedValue(undefined),
      absorbRedundantNodes: vi.fn().mockResolvedValue(undefined),
      absorbSelectedEdges: vi.fn().mockResolvedValue(undefined),
      perturbSelectedNodes: vi.fn().mockResolvedValue(undefined),
      perturbAllNodes: vi.fn().mockResolvedValue(undefined),
      removeSelectionStrain: vi.fn().mockResolvedValue(undefined),
      removeAllStrain: vi.fn().mockResolvedValue(undefined),
      relieveSelectionStrain: vi.fn().mockResolvedValue(undefined),
      relieveAllStrain: vi.fn().mockResolvedValue(undefined),
      addLargestStubForSelectedNodes: vi.fn().mockResolvedValue(undefined),
      addLargestStubForSelectedPoly: vi.fn().mockResolvedValue(undefined),
      triangulateTree: vi.fn().mockResolvedValue(undefined),
      documentMode: 'tree' as 'tree' | 'crease-pattern',
      activeEditingSurface: 'tree' as 'tree' | 'crease-pattern',
      activeEditingContext: 'treemaker-tree' as import('../workspaces/editingContext').EditingContext,
      setActiveEditingSurface: vi.fn(),
      oristudioBpDocument: null,
      deleteOristudioBpTreeNode: vi.fn().mockResolvedValue(true),
      oristudioCpDocument: null as OristudioCpDocumentState | null,
      oristudioCpSelection: {
        lines: [1, 2],
        vertices: [],
        points: [],
        circles: [],
        texts: [],
        faces: [],
      } as OristudioCpSelection,
      setOristudioCpSelection: vi.fn(),
      clearOristudioCpSelection: vi.fn(),
      requestOristudioCpAction: vi.fn(),
      executeOristudioCpCommand: vi.fn().mockResolvedValue(true),
      transformOristudioCpSelection: vi.fn().mockResolvedValue(true),
    },
    layout: {
      activatePanel: vi.fn(),
      resetLayout: vi.fn(),
    },
    fileService: createFileService('web'),
    showStartScreen: vi.fn().mockResolvedValue(true),
    quit: vi.fn(),
    help: vi.fn(),
    about: vi.fn(),
    settings: vi.fn(),
    selectByIndex: vi.fn(),
    requestPositiveNumber: vi.fn().mockResolvedValue(0.5),
  };
}

describe('menu actions', () => {
  it('recognizes shared command ids', () => {
    expect(isMenuActionId('file.new')).toBe(true);
    expect(isMenuActionId('cp.build')).toBe(true);
    expect(isMenuActionId('cp.checkCamv')).toBe(true);
    expect(isMenuActionId('not.real')).toBe(false);
  });

  it('dispatches document and layout commands', async () => {
    const deps = createDeps();
    const handle = createMenuActionHandler(deps);

    await expect(handle('file.new')).resolves.toBe(true);
    await expect(handle('view.edit')).resolves.toBe(true);
    await expect(handle('view.simulate')).resolves.toBe(true);
    await expect(handle('view.creasePattern')).resolves.toBe(true);
    await expect(handle('view.simulator')).resolves.toBe(true);
    await expect(handle('file.settings')).resolves.toBe(true);
    await expect(handle('help.documentation')).resolves.toBe(true);
    await expect(handle('help.about')).resolves.toBe(true);
    await expect(handle('app.about')).resolves.toBe(true);
    await expect(handle('cp.build')).resolves.toBe(true);
    await expect(handle('optimize.edges')).resolves.toBe(true);

    expect(deps.showStartScreen).toHaveBeenCalledOnce();
    expect(deps.workspace.createNewProject).not.toHaveBeenCalled();
    expect(deps.layout.activatePanel).toHaveBeenCalledWith('crease-pattern');
    expect(deps.layout.activatePanel).toHaveBeenCalledWith('simulator');
    expect(deps.layout.activatePanel).toHaveBeenCalledTimes(4);
    expect(deps.settings).toHaveBeenCalledOnce();
    expect(deps.help).toHaveBeenCalledOnce();
    expect(deps.about).toHaveBeenCalledTimes(2);
    expect(deps.workspace.buildCreasePattern).toHaveBeenCalledOnce();
    expect(deps.workspace.optimizeEdges).toHaveBeenCalledOnce();
  });

  it('dispatches data-driven Examples entries by id prefix', async () => {
    const deps = createDeps();
    const handle = createMenuActionHandler(deps);

    await expect(handle('file.openExample:triad')).resolves.toBe(true);

    expect(deps.workspace.loadExampleProject).toHaveBeenCalledWith('triad');
    expect(deps.workspace.loadExampleProject).toHaveBeenCalledTimes(1);
  });

  it('dispatches CP diagnostics and selected-line commands through the shared CP runtime', async () => {
    const deps = createDeps();
    const handle = createMenuActionHandler(deps);

    await expect(handle('cp.checkCamv')).resolves.toBe(true);
    await expect(handle('cp.check1')).resolves.toBe(true);
    await expect(handle('cp.fix2')).resolves.toBe(true);
    await expect(handle('cp.deleteSelectedLines')).resolves.toBe(true);
    await expect(handle('cp.changeCreaseType')).resolves.toBe(true);
    await expect(handle('cp.makeMountain')).resolves.toBe(true);
    await expect(handle('cp.makeAuxiliary')).resolves.toBe(true);
    await expect(handle('cp.toggleMountainValley')).resolves.toBe(true);
    await expect(handle('cp.fixInaccurate')).resolves.toBe(true);
    await expect(handle('cp.replaceLineType')).resolves.toBe(true);
    await expect(handle('cp.deleteLineType')).resolves.toBe(true);
    await expect(handle('cp.organizeCircles')).resolves.toBe(true);

    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith('CheckCamv');
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith('Check1');
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith('Fix2');
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith(
      'LineSegmentDelete',
      { line_ids: [1, 2] }
    );
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith('ChangeCreaseType', {
      line_ids: [1, 2],
    });
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith('CreaseMakeMountain', {
      line_ids: [1, 2],
    });
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith('CreaseMakeAux', {
      line_ids: [1, 2],
    });
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith('CreaseToggleMv', {
      line_ids: [1, 2],
    });
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith('OrganizeCircles');
    expect(deps.workspace.requestOristudioCpAction).toHaveBeenCalledWith('FixInaccurate');
    expect(deps.workspace.requestOristudioCpAction).toHaveBeenCalledWith('ReplaceLineTypeSelect');
    expect(deps.workspace.requestOristudioCpAction).toHaveBeenCalledWith('DeleteLineTypeSelect');
  });

  it('dispatches CP selection transform actions through the workspace transform command', async () => {
    const deps = createDeps();
    const handle = createMenuActionHandler(deps);

    await expect(handle('cp.transformFlipHorizontal')).resolves.toBe(true);
    await expect(handle('cp.transformFlipVertical')).resolves.toBe(true);
    await expect(handle('cp.transformRotateLeft')).resolves.toBe(true);
    await expect(handle('cp.transformRotateRight')).resolves.toBe(true);

    expect(deps.workspace.transformOristudioCpSelection).toHaveBeenNthCalledWith(1, {
      kind: 'flip-horizontal',
    });
    expect(deps.workspace.transformOristudioCpSelection).toHaveBeenNthCalledWith(2, {
      kind: 'flip-vertical',
    });
    expect(deps.workspace.transformOristudioCpSelection).toHaveBeenNthCalledWith(3, {
      kind: 'rotate',
      angleDegrees: 90,
    });
    expect(deps.workspace.transformOristudioCpSelection).toHaveBeenNthCalledWith(4, {
      kind: 'rotate',
      angleDegrees: -90,
    });
  });

  it('does not dispatch selected-line CP commands without selected CP lines', async () => {
    const deps = createDeps();
    deps.workspace.oristudioCpSelection = {
      lines: [],
      vertices: [],
      points: [],
      circles: [],
      texts: [],
      faces: [],
    };
    const handle = createMenuActionHandler(deps);

    await expect(handle('cp.deleteSelectedLines')).resolves.toBe(false);
    await expect(handle('cp.makeMountain')).resolves.toBe(false);
    await expect(handle('cp.fixInaccurate')).resolves.toBe(false);
    await expect(handle('cp.replaceLineType')).resolves.toBe(false);

    expect(deps.workspace.executeOristudioCpCommand).not.toHaveBeenCalled();
    expect(deps.workspace.requestOristudioCpAction).not.toHaveBeenCalled();
  });

  it('opens contextual CP action settings from the menu', async () => {
    const deps = createDeps();
    deps.workspace.oristudioCpSelection = {
      lines: [],
      vertices: [],
      points: [],
      circles: [1],
      texts: [],
      faces: [],
    };
    const handle = createMenuActionHandler(deps);

    await expect(handle('cp.changeCircleColor')).resolves.toBe(true);

    expect(deps.workspace.requestOristudioCpAction).toHaveBeenCalledWith('CircleChangeColor');
    expect(deps.workspace.executeOristudioCpCommand).not.toHaveBeenCalled();
  });

  it('dispatches edit commands through workspace actions', async () => {
    const deps = createDeps();
    const handle = createMenuActionHandler(deps);

    await expect(handle('edit.undo')).resolves.toBe(true);
    await expect(handle('edit.copy')).resolves.toBe(true);
    await expect(handle('edit.selectAll')).resolves.toBe(true);
    await expect(handle('edit.deselectAll')).resolves.toBe(true);
    await expect(handle('edit.selectByIndex')).resolves.toBe(true);
    await expect(handle('edit.selectMovableParts')).resolves.toBe(true);
    await expect(handle('edit.selectCorridorFacets')).resolves.toBe(true);
    await expect(handle('edit.makeRoot')).resolves.toBe(true);
    await expect(handle('edit.renormalizeToEdge')).resolves.toBe(true);
    await expect(handle('edit.absorbNodes')).resolves.toBe(true);
    await expect(handle('edit.perturbAllNodes')).resolves.toBe(true);
    await expect(handle('edit.relieveAllStrain')).resolves.toBe(true);
    await expect(handle('edit.triangulateTree')).resolves.toBe(true);

    expect(deps.workspace.undo).toHaveBeenCalledOnce();
    expect(deps.workspace.copySelection).toHaveBeenCalledOnce();
    expect(deps.workspace.selectAll).toHaveBeenCalledOnce();
    expect(deps.workspace.selectNone).toHaveBeenCalledOnce();
    expect(deps.selectByIndex).toHaveBeenCalledOnce();
    expect(deps.workspace.selectMovableParts).toHaveBeenCalledOnce();
    expect(deps.workspace.selectCorridorFacets).toHaveBeenCalledOnce();
    expect(deps.workspace.makeSelectedNodeRoot).toHaveBeenCalledOnce();
    expect(deps.workspace.renormalizeToSelectedEdge).toHaveBeenCalledOnce();
    expect(deps.workspace.absorbSelectedNodes).toHaveBeenCalledOnce();
    expect(deps.workspace.perturbAllNodes).toHaveBeenCalledOnce();
    expect(deps.workspace.relieveAllStrain).toHaveBeenCalledOnce();
    expect(deps.workspace.triangulateTree).toHaveBeenCalledOnce();
  });

  it('routes generic selection commands to editable CP state in CP mode', async () => {
    const deps = createDeps();
    deps.workspace.documentMode = 'crease-pattern';
    deps.workspace.activeEditingSurface = 'crease-pattern';
    deps.workspace.activeEditingContext = 'crease-pattern';
    deps.workspace.oristudioCpDocument = {
      handle: 1,
      loadSerial: 1,
      source: { format: 'cp', filename: 'lines.cp', path: null },
      operationDescriptors: [],
      lastCommandResult: null,
      summary: {
        title: 'lines',
        line_segments: 2,
        circles: 0,
        points: 0,
        aux_line_segments: 0,
        texts: 0,
        can_save_as_cp: true,
        is_empty: false,
      },
      document: {
        title: 'lines',
        metadata: {},
        crease_pattern: {
          line_segments: [
            {
              a: { x: 0, y: 0 },
              b: { x: 1, y: 0 },
              color: 'Red1',
              active: 'Inactive0',
              selected: 0,
              customized: 0,
              customized_color: { red: 0, green: 0, blue: 0 },
            },
            {
              a: { x: 0, y: 0 },
              b: { x: 0, y: 1 },
              color: 'Blue2',
              active: 'Inactive0',
              selected: 0,
              customized: 0,
              customized_color: { red: 0, green: 0, blue: 0 },
            },
          ],
          circles: [],
          points: [],
          aux_line_segments: [],
          texts: [],
          grid: {
            interval_grid_size: 2,
            grid_size: 8,
            grid_xa: 1,
            grid_xb: 0,
            grid_xc: 1,
            grid_ya: 1,
            grid_yb: 0,
            grid_yc: 1,
            grid_angle: 90,
            base_state: 'WithinPaper',
            vertical_scale_position: 0,
            horizontal_scale_position: 0,
            draw_diagonal_gridlines: false,
          },
        },
      },
    };
    const handle = createMenuActionHandler(deps);

    await expect(handle('edit.selectAll')).resolves.toBe(true);
    await expect(handle('edit.deselectAll')).resolves.toBe(true);
    await expect(handle('edit.delete')).resolves.toBe(true);

    expect(deps.workspace.setOristudioCpSelection).toHaveBeenCalledWith({
      lines: [1, 2],
      vertices: [],
      points: [],
      circles: [],
      texts: [],
      faces: [],
    });
    expect(deps.workspace.clearOristudioCpSelection).toHaveBeenCalledOnce();
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenCalledWith(
      'LineSegmentDelete',
      { line_ids: [1, 2] }
    );
    expect(deps.workspace.selectAll).not.toHaveBeenCalled();
    expect(deps.workspace.selectNone).not.toHaveBeenCalled();
    expect(deps.workspace.deleteSelection).not.toHaveBeenCalled();
  });

  it('routes Delete to selected editable CP vertices and points', async () => {
    const deps = createDeps();
    deps.workspace.documentMode = 'crease-pattern';
    deps.workspace.activeEditingSurface = 'crease-pattern';
    deps.workspace.activeEditingContext = 'crease-pattern';
    deps.workspace.oristudioCpSelection = {
      lines: [],
      vertices: ['1000000000:0'],
      points: [1],
      circles: [],
      texts: [],
      faces: [],
    };
    deps.workspace.oristudioCpDocument = {
      handle: 1,
      loadSerial: 1,
      source: { format: 'cp', filename: 'points.cp', path: null },
      operationDescriptors: [],
      lastCommandResult: null,
      summary: {
        title: 'points',
        line_segments: 2,
        circles: 0,
        points: 1,
        aux_line_segments: 0,
        texts: 0,
        can_save_as_cp: true,
        is_empty: false,
      },
      document: {
        title: 'points',
        metadata: {},
        crease_pattern: {
          line_segments: [
            {
              a: { x: 0, y: 0 },
              b: { x: 1, y: 0 },
              color: 'Red1',
              active: 'Inactive0',
              selected: 0,
              customized: 0,
              customized_color: { red: 0, green: 0, blue: 0 },
            },
            {
              a: { x: 1, y: 0 },
              b: { x: 2, y: 0 },
              color: 'Red1',
              active: 'Inactive0',
              selected: 0,
              customized: 0,
              customized_color: { red: 0, green: 0, blue: 0 },
            },
          ],
          circles: [],
          points: [{ x: 2, y: 2 }],
          aux_line_segments: [],
          texts: [],
          grid: {
            interval_grid_size: 2,
            grid_size: 8,
            grid_xa: 1,
            grid_xb: 0,
            grid_xc: 1,
            grid_ya: 1,
            grid_yb: 0,
            grid_yc: 1,
            grid_angle: 90,
            base_state: 'WithinPaper',
            vertical_scale_position: 0,
            horizontal_scale_position: 0,
            draw_diagonal_gridlines: false,
          },
        },
      },
    };
    const handle = createMenuActionHandler(deps);

    await expect(handle('edit.delete')).resolves.toBe(true);

    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenNthCalledWith(1, 'DeletePoint', {
      points: [{ x: 1, y: 0 }],
      selection_distance: 1,
    });
    expect(deps.workspace.executeOristudioCpCommand).toHaveBeenNthCalledWith(2, 'DeletePoint', {
      points: [{ x: 2, y: 2 }],
      selection_distance: 1,
    });
  });

  it('requests in-app numeric values for parameterized edit commands', async () => {
    const deps = createDeps();
    deps.requestPositiveNumber
      .mockResolvedValueOnce(0.25)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1.5);
    const handle = createMenuActionHandler(deps);

    await expect(handle('edit.splitEdge')).resolves.toBe(true);
    await expect(handle('edit.setEdgeLength')).resolves.toBe(true);
    await expect(handle('edit.scaleEdgeLengths')).resolves.toBe(true);

    expect(deps.requestPositiveNumber).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: 'Split Edge', initialValue: '0.5' })
    );
    expect(deps.workspace.splitSelectedEdge).toHaveBeenCalledWith(0.25);
    expect(deps.workspace.setSelectedEdgeLengths).toHaveBeenCalledWith(2);
    expect(deps.workspace.scaleSelectedEdgeLengths).toHaveBeenCalledWith(1.5);
  });

  it('cancels parameterized edit commands when the in-app number modal is dismissed', async () => {
    const deps = createDeps();
    deps.requestPositiveNumber.mockResolvedValueOnce(null);

    await expect(createMenuActionHandler(deps)('edit.splitEdge')).resolves.toBe(false);

    expect(deps.workspace.splitSelectedEdge).not.toHaveBeenCalled();
  });

  it('routes file commands through the selected file service', async () => {
    const deps = createDeps();

    await expect(createMenuActionHandler(deps)('file.saveAs')).resolves.toBe(true);
    expect(deps.workspace.saveProjectAs).toHaveBeenCalledWith(deps.fileService);

    await expect(createMenuActionHandler(deps)('file.importAdd')).resolves.toBe(true);
    expect(deps.workspace.importAddCreasePattern).toHaveBeenCalledWith(deps.fileService);

    await expect(createMenuActionHandler(deps)('file.exportFold')).resolves.toBe(true);
    await expect(createMenuActionHandler(deps)('file.exportOri')).resolves.toBe(true);
    await expect(createMenuActionHandler(deps)('file.exportOrh')).resolves.toBe(true);
    await expect(createMenuActionHandler(deps)('file.exportV5')).resolves.toBe(true);
    await expect(createMenuActionHandler(deps)('file.exportCp')).resolves.toBe(true);
    expect(deps.workspace.exportFold).toHaveBeenCalledWith(deps.fileService);
    expect(deps.workspace.exportOri).toHaveBeenCalledWith(deps.fileService);
    expect(deps.workspace.exportOrh).toHaveBeenCalledWith(deps.fileService);
    expect(deps.workspace.exportV5).toHaveBeenCalledWith(deps.fileService);
    expect(deps.workspace.exportCp).toHaveBeenCalledWith(deps.fileService);
  });

  it('opens the CP image detector from the File menu', async () => {
    const deps = createDeps();
    const listener = vi.fn();
    window.addEventListener('ori-studio:detect-cp-image', listener);
    try {
      await expect(createMenuActionHandler(deps)('file.detectCpImage')).resolves.toBe(true);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('ori-studio:detect-cp-image', listener);
    }
  });

  it('does not dispatch disabled capabilities', async () => {
    const deps = {
      ...createDeps(),
      capabilities: () =>
        getWorkspaceCapabilities({
        activeEditingContext: 'crease-pattern',
        engineReady: true,
        status: 'crease_pattern_ready',
        edgeCount: 0,
        creaseCount: 4,
        facetCount: 1,
        hasEditableCreasePattern: false,
        hasImportedCreasePattern: true,
        hasSimulationModel: true,
        oristudioCpSelectedLineCount: 0,
        oristudioCpSelectedVertexCount: 0,
        oristudioCpSelectedPointCount: 0,
        oristudioCpSelectedCircleCount: 0,
        hasDeletableBpSelection: false,
        historyPastCount: 0,
        historyFutureCount: 0,
        clipboard: null,
        selection: { kind: 'tree' },
        }),
    };

    await expect(createMenuActionHandler(deps)('cp.build')).resolves.toBe(false);

    expect(deps.workspace.buildCreasePattern).not.toHaveBeenCalled();
  });

  it('returns false for unknown ids', async () => {
    await expect(createMenuActionHandler(createDeps())('unknown')).resolves.toBe(false);
  });
});
