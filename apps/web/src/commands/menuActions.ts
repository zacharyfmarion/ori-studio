import { activeDesignTab } from '../store/workspaceStore/designTabs';
import { designKindForContext } from '../designKinds';
import type { DesignTab } from '../store/workspaceStore/designTabs';
import { track } from '../analytics';
import { getFileService, type FileCommand, type FileService } from '../platform/fileService';
import { useHelpStore } from '../store/helpStore';
import { useLayoutStore } from '../store/layoutStore';
import { useBpOptimizerUiStore } from '../store/bpOptimizerUiStore';
import { useSelectionUiStore } from '../store/selectionUiStore';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { selectWorkspaceCapabilities } from '../store/workspaceStore/capabilities';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from '../lib/workspaceCapabilities';
import { requestPositiveNumber, type NumberDialogOptions } from '../store/commandDialogStore';
import { showActiveWorkspace } from '../routing/workspaceUrlSync';
import { requestStartScreen } from './startScreenController';
import type {
  OristudioCpCommandPayload,
  OristudioCpDocumentState,
} from '../engine/oristudioCpTypes';
import type { OristudioCpSelection } from '../lib/creasePatternViewport';
import type { CpSelectionTransform } from '../lib/creasePatternClipboard';
import type { Point } from '../lib/geometry';
import type { OristudioCpOperationId } from '../lib/oristudioCpCommands';
import type { OristudioCpSurfaceRequestKind } from '../store/workspaceStore/types';
import type { EditingContext } from '../workspaces/editingContext';
import type {
} from '../engine/oristudioBpTypes';
import type { CreaseExportOptions } from '../lib/creaseExport';

import i18n from '../i18n';
import { runUpdateCheck } from '../lib/updateController';
import { announceUpdateCheck } from '../lib/updateFeedback';

export const MENU_ACTION_IDS = [
  'app.about',
  'app.quit',
  'file.new',
  'file.open',
  'file.importAdd',
  'file.detectCpImage',
  'file.save',
  'file.saveAs',
  'file.settings',
  'file.exportV5',
  'file.exportV4',
  'file.exportCp',
  'file.exportFold',
  'file.exportBps',
  'file.exportOri',
  'file.exportOrh',
  'file.exportSvg',
  'file.exportPng',
  'edit.undo',
  'edit.redo',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.delete',
  'edit.selectAll',
  'edit.deselectAll',
  'edit.selectByIndex',
  'edit.selectMovableParts',
  'edit.selectCorridorFacets',
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
  'view.design',
  'view.edit',
  'view.creasePattern',
  'view.simulate',
  'view.simulator',
  'view.conditions',
  'view.resetLayout',
  'optimize.scale',
  'optimize.edges',
  'optimize.strain',
  'bp.optimize.layout',
  'bp.layout.subdivide',
  'bp.layout.unsubdivide',
  'bp.layout.rotateRight',
  'bp.layout.rotateLeft',
  'bp.layout.flipHorizontal',
  'bp.layout.flipVertical',
  'cp.build',
  'cp.deleteSelectedLines',
  'cp.changeCreaseType',
  'cp.advanceCreaseType',
  'cp.makeMountain',
  'cp.makeValley',
  'cp.makeEdge',
  'cp.makeAuxiliary',
  'cp.makeUnassigned',
  'cp.makeUnassignedKeepDirection',
  'cp.toggleMountainValley',
  'cp.transformFlipHorizontal',
  'cp.transformFlipVertical',
  'cp.transformRotateLeft',
  'cp.transformRotateRight',
  'cp.replaceLineType',
  'cp.deleteLineType',
  'cp.checkCamv',
  'cp.check1',
  'cp.check2',
  'cp.check3',
  'cp.check4',
  'cp.fix1',
  'cp.fix2',
  'cp.deleteExtraVertices',
  'cp.deleteExtraVerticesIgnoreColor',
  'cp.fixInaccurate',
  'cp.exactSolve',
  'cp.changeCircleColor',
  'cp.organizeCircles',
  'cp.setActiveCreaseAngle',
  'insert.image',
  'insert.text',
  'help.about',
  'help.checkForUpdates',
] as const;

export type MenuActionId = (typeof MENU_ACTION_IDS)[number];

export interface WorkspaceCommands {
  createNewProject(): Promise<boolean>;
  subdivideOristudioBpLayoutSheet(): Promise<boolean>;
  unsubdivideOristudioBpLayoutSheet(): Promise<boolean>;
  rotateOristudioBpLayoutSheet(clockwise: boolean): Promise<boolean>;
  flipOristudioBpLayoutSheet(horizontal: boolean): Promise<boolean>;
  loadExampleProject(id: string): Promise<boolean>;
  openProject(fileService?: FileService): Promise<boolean>;
  importAddCreasePattern(fileService?: FileService): Promise<boolean>;
  saveProject(fileService?: FileService): Promise<boolean>;
  saveProjectAs(fileService?: FileService): Promise<boolean>;
  exportV5(fileService?: FileService): Promise<boolean>;
  exportV4(fileService?: FileService): Promise<boolean>;
  exportCp(fileService?: FileService): Promise<boolean>;
  exportFold(fileService?: FileService): Promise<boolean>;
  exportBps(fileService?: FileService): Promise<boolean>;
  exportOri(fileService?: FileService): Promise<boolean>;
  exportOrh(fileService?: FileService): Promise<boolean>;
  exportSvg(fileService?: FileService, options?: CreaseExportOptions): Promise<boolean>;
  exportPng(fileService?: FileService, options?: CreaseExportOptions): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  cutSelection(): Promise<void>;
  copySelection(): void;
  pasteClipboard(at?: Point): Promise<void>;
  deleteSelection(): Promise<void>;
  optimizeScale(): Promise<void>;
  optimizeEdges(): Promise<void>;
  optimizeStrain(): Promise<void>;
  buildCreasePattern(): Promise<void>;
  select(selection: { kind: 'tree' }): void;
  selectAll(): void;
  selectNone(): void;
  selectMovableParts(): void;
  selectCorridorFacets(): void;
  makeSelectedNodeRoot(): Promise<void>;
  splitSelectedEdge(distance: number): Promise<void>;
  setSelectedEdgeLengths(length: number): Promise<void>;
  scaleSelectedEdgeLengths(factor: number): Promise<void>;
  renormalizeToSelectedEdge(): Promise<void>;
  renormalizeToUnitScale(): Promise<void>;
  absorbSelectedNodes(): Promise<void>;
  absorbRedundantNodes(): Promise<void>;
  absorbSelectedEdges(): Promise<void>;
  perturbSelectedNodes(): Promise<void>;
  perturbAllNodes(): Promise<void>;
  removeSelectionStrain(): Promise<void>;
  removeAllStrain(): Promise<void>;
  relieveSelectionStrain(): Promise<void>;
  relieveAllStrain(): Promise<void>;
  addLargestStubForSelectedNodes(): Promise<void>;
  addLargestStubForSelectedPoly(): Promise<void>;
  triangulateTree(): Promise<void>;
  activeEditingContext: EditingContext;
  designTabs: DesignTab[];
  activeDesignId: string;
  deleteOristudioBpTreeNode(id: number): Promise<boolean>;
  deleteExploriNode(id: number): Promise<boolean>;
  oristudioCpDocument: OristudioCpDocumentState | null;
  oristudioCpSelection: OristudioCpSelection;
  setOristudioCpSelection(selection: OristudioCpSelection): void;
  clearOristudioCpSelection(): void;
  requestOristudioCpAction(operationId: OristudioCpOperationId): void;
  requestOristudioCpSurface(kind: OristudioCpSurfaceRequestKind): void;
  executeOristudioCpCommand(
    operationId: OristudioCpOperationId,
    payload?: OristudioCpCommandPayload
  ): Promise<boolean>;
  transformOristudioCpSelection(transform: CpSelectionTransform): Promise<boolean>;
}

function selectedCpDeletePoints(
  selection: OristudioCpSelection,
  documentState: OristudioCpDocumentState | null
): Point[] {
  if (!documentState) return [];

  const points: Point[] = [];
  for (const id of selection.points) {
    const point = documentState.document.crease_pattern.points[id - 1];
    if (point) points.push(point);
  }

  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.x}:${point.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface LayoutCommands {
  activatePanel(id: string): void;
  resetLayout(): void;
}

export interface MenuActionDependencies {
  workspace: WorkspaceCommands;
  layout: LayoutCommands;
  fileService: FileService;
  capabilities?: () => WorkspaceCapabilities;
  showStartScreen?: () => Promise<boolean>;
  /**
   * Point the app at the workspace the store is on. Defaults to the real router,
   * so this cannot be a wiring line someone forgets to pass — see
   * {@link showActiveWorkspace} for why the actions below need it at all.
   */
  showWorkspace?: () => void;
  quit?: () => void;
  about?: () => void;
  settings?: () => void;
  selectByIndex?: () => void;
  openBpOptimizer?: () => void;
  requestPositiveNumber?: (options: NumberDialogOptions) => Promise<number | null>;
}

const FILE_ACTIONS: Partial<Record<MenuActionId, FileCommand>> = {
  'file.open': 'openProject',
  'file.importAdd': 'importAddCreasePattern',
  'file.save': 'saveProject',
  'file.saveAs': 'saveProjectAs',
  'file.exportV5': 'exportV5',
  'file.exportV4': 'exportV4',
  'file.exportCp': 'exportCp',
  'file.exportFold': 'exportFold',
  'file.exportBps': 'exportBps',
  'file.exportOri': 'exportOri',
  'file.exportOrh': 'exportOrh',
  'file.exportSvg': 'exportSvg',
  'file.exportPng': 'exportPng',
};

const CP_OPERATION_ACTIONS: Partial<Record<MenuActionId, OristudioCpOperationId>> = {
  'cp.checkCamv': 'CheckCamv',
  'cp.check1': 'Check1',
  'cp.check2': 'Check2',
  'cp.check3': 'Check3',
  'cp.check4': 'Check4',
  'cp.fix1': 'Fix1',
  'cp.fix2': 'Fix2',
  'cp.deleteExtraVertices': 'DeleteExtraVertices',
  'cp.deleteExtraVerticesIgnoreColor': 'DeleteExtraVerticesIgnoreColor',
};

/**
 * A selected-lines entry is either a bare operation or one with extra payload.
 * Widened for the two unassign variants, which are one kernel operation
 * distinguished by a flag rather than two operations — no second descriptor, so
 * PORTING.md's origin rules need nothing.
 */
type CpSelectedLineAction =
  | OristudioCpOperationId
  | { operation: OristudioCpOperationId; payload: OristudioCpCommandPayload };

const CP_SELECTED_LINE_ACTIONS: Partial<Record<MenuActionId, CpSelectedLineAction>> = {
  'cp.changeCreaseType': 'ChangeCreaseType',
  'cp.advanceCreaseType': 'CreaseAdvanceType',
  'cp.makeMountain': 'CreaseMakeMountain',
  'cp.makeValley': 'CreaseMakeValley',
  'cp.makeEdge': 'CreaseMakeEdge',
  'cp.makeAuxiliary': 'CreaseMakeAux',
  // Keeping the direction is the default and the common intent; forgetting it
  // as well is the explicit ask, so it is the one that names itself.
  'cp.makeUnassigned': {
    operation: 'CreaseMakeUnassigned',
    payload: { forget_direction: true },
  },
  'cp.makeUnassignedKeepDirection': 'CreaseMakeUnassigned',
  'cp.toggleMountainValley': 'CreaseToggleMv',
};

const CP_CONTEXT_ACTIONS: Partial<Record<MenuActionId, OristudioCpOperationId>> = {
  'cp.replaceLineType': 'ReplaceLineTypeSelect',
  'cp.deleteLineType': 'DeleteLineTypeSelect',
  'cp.fixInaccurate': 'FixInaccurate',
  'cp.changeCircleColor': 'CircleChangeColor',
  // Insert > Text arms the text tool; the next canvas click places the box.
  // No new plumbing, because placing text was always a tool — the menu entry
  // just gives it a name outside the rail.
  'insert.text': 'Text',
};

/**
 * Menu entries the mounted crease-pattern panel has to handle itself, because
 * they are panel-owned UI rather than kernel operations. See
 * `OristudioCpSurfaceRequest`.
 */
const CP_SURFACE_ACTIONS: Partial<Record<MenuActionId, OristudioCpSurfaceRequestKind>> = {
  'insert.image': 'insert-image',
  'cp.setActiveCreaseAngle': 'crease-angle',
};

const CP_SELECTION_TRANSFORM_ACTIONS: Partial<Record<MenuActionId, CpSelectionTransform>> = {
  'cp.transformFlipHorizontal': { kind: 'flip-horizontal' },
  'cp.transformFlipVertical': { kind: 'flip-vertical' },
  'cp.transformRotateLeft': { kind: 'rotate', angleDegrees: 90 },
  'cp.transformRotateRight': { kind: 'rotate', angleDegrees: -90 },
};

/**
 * View entries, by the pane each one shows. A table rather than four switch arms
 * because they share the part that was missing: activating a pane moves the app
 * to that pane's workspace, and the move has to reach the URL. One dispatch point
 * is one place to say so. `view.resetLayout` is not here — it rearranges the
 * workspace you are already in.
 */
const VIEW_PANEL_ACTIONS: Partial<Record<MenuActionId, string>> = {
  'view.design': 'design',
  'view.edit': 'crease-pattern',
  'view.creasePattern': 'crease-pattern',
  'view.simulate': 'simulator',
  'view.simulator': 'simulator',
  'view.conditions': 'conditions',
};

export function isMenuActionId(id: string): id is MenuActionId {
  return (MENU_ACTION_IDS as readonly string[]).includes(id);
}

/**
 * Asking the crease-pattern workspace to run an exact solve.
 *
 * A window event rather than a `WorkspaceCommands` method, for the same reason
 * `file.detectCpImage` is one: what the command opens is a *surface* — the solve
 * runs against the `ExactSolveInput` attached to a region, reports two stages
 * while it works, and ends on an Accept / Try again gate — and none of that is
 * store state the dispatcher could call into. The store owns documents; the CP
 * workspace owns this flow.
 *
 * The chokepoint in {@link handleMenuAction} still sees the command, so the
 * keyboard, the command palette and `command invoked` all work unchanged.
 *
 * `useCpRegionSolve` is the listener, and it is also what the `SolveRegionChip`'s
 * Solve button calls — the same function, one argument apart. The button does not
 * re-dispatch this event: it already knows which region it is on, and the event
 * carries no target, so routing through it would mean throwing that away and
 * asking the selection to reconstruct it. Two entry points, one implementation;
 * they differ only in the `CpExactSolveRunKind` each run is registered under.
 */
export const CP_EXACT_SOLVE_REQUEST_EVENT = 'ori-studio:cp-exact-solve';

const OPEN_EXAMPLE_PREFIX = 'file.openExample:';

export function createMenuActionHandler(deps: MenuActionDependencies) {
  const showWorkspace = () => (deps.showWorkspace ?? showActiveWorkspace)();

  return async (id: string): Promise<boolean> => {
    // Data-driven File menu entries (examples) carry their target in the id;
    // they are dispatched by prefix rather than the static id union.
    if (id.startsWith(OPEN_EXAMPLE_PREFIX)) {
      const exampleId = id.slice(OPEN_EXAMPLE_PREFIX.length);
      if (!exampleId) return false;
      const opened = await deps.workspace.loadExampleProject(exampleId);
      if (opened) showWorkspace();
      return opened;
    }
    if (!isMenuActionId(id)) {
      console.warn(`Unknown menu action: ${id}`);
      return false;
    }

    const capability = deps.capabilities?.()[id as WorkspaceCapabilityId];
    if (capability && !capability.enabled) {
      console.info(`Menu action disabled: ${id}: ${capability.reason}`);
      return false;
    }

    const fileCommand = FILE_ACTIONS[id];
    if (fileCommand) {
      switch (fileCommand) {
        case 'openProject': {
          const opened = await deps.workspace.openProject(deps.fileService);
          // The load picked its own landing workspace; until this, nothing told
          // the router — so opening from the start screen filled the store and
          // left the start screen on screen.
          if (opened) showWorkspace();
          return opened;
        }
        case 'importAddCreasePattern':
          return deps.workspace.importAddCreasePattern(deps.fileService);
        case 'saveProject':
          return deps.workspace.saveProject(deps.fileService);
        case 'saveProjectAs':
          return deps.workspace.saveProjectAs(deps.fileService);
        case 'exportV5':
          return deps.workspace.exportV5(deps.fileService);
        case 'exportV4':
          return deps.workspace.exportV4(deps.fileService);
        case 'exportCp':
          return deps.workspace.exportCp(deps.fileService);
        case 'exportFold':
          return deps.workspace.exportFold(deps.fileService);
        case 'exportBps':
          return deps.workspace.exportBps(deps.fileService);
        case 'exportOri':
          return deps.workspace.exportOri(deps.fileService);
        case 'exportOrh':
          return deps.workspace.exportOrh(deps.fileService);
        case 'exportSvg':
          return deps.workspace.exportSvg(deps.fileService);
        case 'exportPng':
          return deps.workspace.exportPng(deps.fileService);
      }
      // Every FileCommand must dispatch. Without this the switch silently falls
      // through for an unhandled one and the menu entry does nothing -- which is
      // how the folded-form exports shipped dead.
      const unhandled: never = fileCommand;
      return unhandled;
    }

    const cpOperation = CP_OPERATION_ACTIONS[id];
    if (cpOperation) {
      return deps.workspace.executeOristudioCpCommand(cpOperation);
    }

    const cpSelectedLineOperation = CP_SELECTED_LINE_ACTIONS[id];
    if (cpSelectedLineOperation) {
      const lineIds = deps.workspace.oristudioCpSelection.lines;
      if (lineIds.length === 0) return false;
      const operation =
        typeof cpSelectedLineOperation === 'string'
          ? cpSelectedLineOperation
          : cpSelectedLineOperation.operation;
      const extra =
        typeof cpSelectedLineOperation === 'string' ? {} : cpSelectedLineOperation.payload;
      return deps.workspace.executeOristudioCpCommand(operation, {
        line_ids: lineIds,
        ...extra,
      });
    }

    const cpContextOperation = CP_CONTEXT_ACTIONS[id];
    if (cpContextOperation) {
      const selection = deps.workspace.oristudioCpSelection;
      if (
        (cpContextOperation === 'ReplaceLineTypeSelect' ||
          cpContextOperation === 'DeleteLineTypeSelect' ||
          cpContextOperation === 'FixInaccurate') &&
        selection.lines.length === 0
      ) {
        return false;
      }
      if (
        cpContextOperation === 'CircleChangeColor' &&
        selection.lines.length === 0 &&
        selection.circles.length === 0
      ) {
        return false;
      }
      deps.workspace.requestOristudioCpAction(cpContextOperation);
      return true;
    }

    const cpSurfaceKind = CP_SURFACE_ACTIONS[id];
    if (cpSurfaceKind) {
      deps.workspace.requestOristudioCpSurface(cpSurfaceKind);
      return true;
    }

    const cpSelectionTransform = CP_SELECTION_TRANSFORM_ACTIONS[id];
    if (cpSelectionTransform) {
      return deps.workspace.transformOristudioCpSelection(cpSelectionTransform);
    }

    const viewPanel = VIEW_PANEL_ACTIONS[id];
    if (viewPanel) {
      deps.layout.activatePanel(viewPanel);
      showWorkspace();
      return true;
    }

    switch (id) {
      case 'app.about':
        deps.about?.();
        return true;
      case 'app.quit':
        deps.quit?.();
        return true;
      case 'file.new':
        return (deps.showStartScreen ?? requestStartScreen)();
      case 'file.detectCpImage':
        window.dispatchEvent(new CustomEvent('ori-studio:detect-cp-image'));
        return true;
      case 'file.settings':
        deps.settings?.();
        return true;
      case 'edit.undo':
        await deps.workspace.undo();
        return true;
      case 'edit.redo':
        await deps.workspace.redo();
        return true;
      case 'edit.cut':
        await deps.workspace.cutSelection();
        return true;
      case 'edit.copy':
        deps.workspace.copySelection();
        return true;
      case 'edit.paste':
        await deps.workspace.pasteClipboard();
        return true;
      case 'edit.delete': {
        // *What* to delete is the design kind's answer, asked once. *How* stays
        // here, because each kind's delete is a different store action — but the
        // predicate that used to gate this by naming kinds is gone, which is
        // what left a registered kind's Delete permanently disabled.
        const kind = designKindForContext(deps.workspace.activeEditingContext);
        if (kind?.deletableTarget) {
          const target = kind.deletableTarget(activeDesignTab(deps.workspace));
          // A design context owns Delete whether or not it has a target: falling
          // through to the crease-pattern branch would delete creases from under
          // a tree pane that simply had nothing selected.
          if (target === null) return false;
          if (kind.id === 'box-pleat') return deps.workspace.deleteOristudioBpTreeNode(target);
          if (kind.id === 'explori') return deps.workspace.deleteExploriNode(target);
          return false;
        }
        if (
          deps.workspace.activeEditingContext === 'crease-pattern' &&
          deps.workspace.oristudioCpDocument
        ) {
          const lineIds = deps.workspace.oristudioCpSelection.lines;
          const circleIds = deps.workspace.oristudioCpSelection.circles;
          const points = selectedCpDeletePoints(
            deps.workspace.oristudioCpSelection,
            deps.workspace.oristudioCpDocument
          );
          if (lineIds.length === 0 && circleIds.length === 0 && points.length === 0) return false;
          let succeeded = false;
          // Lines and circles go in one command so a mixed selection produces a
          // single history entry. Oriedita has no circle selection at all, so this
          // is an Ori Studio addition rather than ported behavior.
          if (lineIds.length > 0 || circleIds.length > 0) {
            succeeded = await deps.workspace.executeOristudioCpCommand('LineSegmentDelete', {
              line_ids: lineIds,
              circle_ids: circleIds,
            });
          }
          for (const point of points) {
            succeeded =
              (await deps.workspace.executeOristudioCpCommand('DeletePoint', {
                points: [point],
                // Not the snap radius, and it must never become it: these are the
                // exact stored coordinates of an already-selected point, so this
                // only has to cover float noise. At the user's snap radius a wide
                // setting would delete a *neighbouring* point instead.
                selection_distance: 1,
              })) || succeeded;
          }
          return succeeded;
        } else {
          await deps.workspace.deleteSelection();
          return true;
        }
      }
      case 'edit.selectAll':
        if (
          deps.workspace.activeEditingContext === 'crease-pattern' &&
          deps.workspace.oristudioCpDocument
        ) {
          const lineCount =
            deps.workspace.oristudioCpDocument?.document.crease_pattern.line_segments.length ?? 0;
          deps.workspace.setOristudioCpSelection({
            lines: Array.from({ length: lineCount }, (_value, index) => index + 1),
            points: [],
            circles: [],
            texts: [],
            faces: [],
          });
        } else {
          deps.workspace.selectAll();
        }
        return true;
      case 'edit.deselectAll':
        if (
          deps.workspace.activeEditingContext === 'crease-pattern' &&
          deps.workspace.oristudioCpDocument
        ) {
          deps.workspace.clearOristudioCpSelection();
        } else {
          deps.workspace.selectNone();
        }
        return true;
      case 'edit.selectByIndex':
        deps.selectByIndex?.();
        return true;
      case 'edit.selectMovableParts':
        deps.workspace.selectMovableParts();
        return true;
      case 'edit.selectCorridorFacets':
        deps.workspace.selectCorridorFacets();
        return true;
      case 'edit.makeRoot':
        await deps.workspace.makeSelectedNodeRoot();
        return true;
      case 'edit.splitEdge': {
        const distance = await (deps.requestPositiveNumber ?? requestPositiveNumber)({
          title: 'Split Edge',
          label: 'Distance',
          initialValue: '0.5',
          confirmLabel: 'Split',
          minExclusive: 0,
          meta: 'Distance along the selected strained edge.',
        });
        if (distance === null) return false;
        await deps.workspace.splitSelectedEdge(distance);
        return true;
      }
      case 'edit.setEdgeLength': {
        const length = await (deps.requestPositiveNumber ?? requestPositiveNumber)({
          title: 'Set Edge Length',
          label: 'Length',
          initialValue: '1',
          confirmLabel: 'Set',
          minExclusive: 0,
          meta: 'Applies this exact length to the selected edge.',
        });
        if (length === null) return false;
        await deps.workspace.setSelectedEdgeLengths(length);
        return true;
      }
      case 'edit.scaleEdgeLengths': {
        const factor = await (deps.requestPositiveNumber ?? requestPositiveNumber)({
          title: 'Scale Edge Lengths',
          label: 'Factor',
          initialValue: '1',
          confirmLabel: 'Scale',
          minExclusive: 0,
          meta: 'Multiplies selected edge lengths by this factor.',
        });
        if (factor === null) return false;
        await deps.workspace.scaleSelectedEdgeLengths(factor);
        return true;
      }
      case 'edit.renormalizeToEdge':
        await deps.workspace.renormalizeToSelectedEdge();
        return true;
      case 'edit.renormalizeToUnitScale':
        await deps.workspace.renormalizeToUnitScale();
        return true;
      case 'edit.absorbNodes':
        await deps.workspace.absorbSelectedNodes();
        return true;
      case 'edit.absorbRedundantNodes':
        await deps.workspace.absorbRedundantNodes();
        return true;
      case 'edit.absorbEdges':
        await deps.workspace.absorbSelectedEdges();
        return true;
      case 'edit.perturbNodes':
        await deps.workspace.perturbSelectedNodes();
        return true;
      case 'edit.perturbAllNodes':
        await deps.workspace.perturbAllNodes();
        return true;
      case 'edit.removeStrain':
        await deps.workspace.removeSelectionStrain();
        return true;
      case 'edit.removeAllStrain':
        await deps.workspace.removeAllStrain();
        return true;
      case 'edit.relieveStrain':
        await deps.workspace.relieveSelectionStrain();
        return true;
      case 'edit.relieveAllStrain':
        await deps.workspace.relieveAllStrain();
        return true;
      case 'edit.addLargestStubForNodes':
        await deps.workspace.addLargestStubForSelectedNodes();
        return true;
      case 'edit.addLargestStubForPoly':
        await deps.workspace.addLargestStubForSelectedPoly();
        return true;
      case 'edit.triangulateTree':
        await deps.workspace.triangulateTree();
        return true;
      case 'view.resetLayout':
        deps.layout.resetLayout();
        return true;
      case 'optimize.scale':
        await deps.workspace.optimizeScale();
        return true;
      case 'optimize.edges':
        await deps.workspace.optimizeEdges();
        return true;
      case 'optimize.strain':
        await deps.workspace.optimizeStrain();
        return true;
      case 'bp.optimize.layout':
        // Opens the options dialog; the run itself starts from there.
        deps.openBpOptimizer?.();
        return true;
      case 'bp.layout.subdivide':
        return deps.workspace.subdivideOristudioBpLayoutSheet();
      case 'bp.layout.unsubdivide':
        return deps.workspace.unsubdivideOristudioBpLayoutSheet();
      case 'bp.layout.rotateRight':
        return deps.workspace.rotateOristudioBpLayoutSheet(true);
      case 'bp.layout.rotateLeft':
        return deps.workspace.rotateOristudioBpLayoutSheet(false);
      case 'bp.layout.flipHorizontal':
        return deps.workspace.flipOristudioBpLayoutSheet(true);
      case 'bp.layout.flipVertical':
        return deps.workspace.flipOristudioBpLayoutSheet(false);
      case 'cp.build':
        await deps.workspace.buildCreasePattern();
        return true;
      case 'cp.deleteSelectedLines': {
        const lineIds = deps.workspace.oristudioCpSelection.lines;
        if (lineIds.length === 0) return false;
        return deps.workspace.executeOristudioCpCommand('LineSegmentDelete', {
          line_ids: lineIds,
        });
      }
      case 'cp.organizeCircles':
        return deps.workspace.executeOristudioCpCommand('OrganizeCircles');
      // Whether there is anything to solve is `cp.exactSolve`'s capability, and
      // it is checked at the top of this handler like every other action's. The
      // listener (`useCpRegionSolve`) must still refuse a request that resolves
      // to no region, because `deps.capabilities` is optional here — a host that
      // supplies none dispatches every id it is handed.
      case 'cp.exactSolve':
        window.dispatchEvent(new CustomEvent(CP_EXACT_SOLVE_REQUEST_EVENT));
        return true;
      case 'help.about':
        deps.about?.();
        return true;

      // Dispatching through here means `command invoked` is captured at the
      // chokepoint; no second hand-placed event for the same thing.
      case 'help.checkForUpdates':
        // No settings pane is open on this path, so the toast is the only thing
        // that can answer the press.
        void runUpdateCheck('manual').then((outcome) => announceUpdateCheck(outcome, i18n.t));
        return true;
    }

    return false;
  };
}

/**
 * The command id we send to analytics: the static id, or — for data-driven ids
 * like `file.openExample:<id>` — just the prefix, so the raw payload never
 * becomes an unbounded property value.
 */
function analyticsCommandId(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(0, colon);
}

/** The coarse top-level group (first path segment), inherently low-cardinality. */
function analyticsCommandGroup(id: string): string {
  return id.split(/[.:]/, 1)[0] || 'other';
}

export function handleMenuAction(id: string): Promise<boolean> {
  // The chokepoint for menu bar / command palette / keyboard-mapped actions.
  // Capturing intent here covers most of the app with one event. Only recognized
  // ids are recorded, so stray dispatches don't create phantom commands.
  if (isMenuActionId(id) || id.startsWith(OPEN_EXAMPLE_PREFIX)) {
    track('command invoked', {
      command_id: analyticsCommandId(id),
      command_group: analyticsCommandGroup(id),
    });
  }
  return createMenuActionHandler({
    workspace: useWorkspaceStore.getState(),
    layout: useLayoutStore.getState(),
    fileService: getFileService(),
    capabilities: () => selectWorkspaceCapabilities(useWorkspaceStore.getState()),
    showStartScreen: requestStartScreen,
    settings: () => {
      useSettingsStore.getState().openSettings();
    },
    about: () => {
      useHelpStore.getState().openAbout();
    },
    selectByIndex: () => {
      useSelectionUiStore.getState().openSelectByIndex();
    },
    openBpOptimizer: () => {
      useBpOptimizerUiStore.getState().open();
    },
  })(id);
}
