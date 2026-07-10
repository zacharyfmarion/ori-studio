import { expose } from 'comlink';
import init, {
  bp_add_tree_leaf,
  bp_check_optimizer_result,
  bp_complete_stretch,
  bp_delete_tree_leaf,
  bp_export_bps,
  bp_export_cp,
  bp_export_fold,
  bp_export_workspace,
  bp_free_project,
  bp_import_treemaker,
  bp_join_tree_vertex,
  bp_load_project,
  bp_load_workspace,
  bp_merge_tree_edge,
  bp_move_device,
  bp_move_layout_flap,
  bp_move_layout_flaps,
  bp_move_tree_vertex,
  bp_new_sample_project,
  bp_notify_project_saved,
  bp_open_optimizer_template,
  bp_optimizer_request,
  bp_optimizer_solve,
  bp_optimizer_solve_report,
  bp_optimizer_solve_report_with_progress,
  bp_optimizer_template,
  bp_project_packing_validation,
  bp_project_crease_pattern_snapshot,
  bp_project_layout_snapshot,
  bp_port_descriptors,
  bp_project_snapshot,
  bp_project_summary,
  bp_project_tree_data,
  bp_redo_project,
  bp_rename_tree_vertex,
  bp_replace_with_optimizer_template,
  bp_resize_layout_flap,
  bp_flip_layout_sheet,
  bp_rotate_layout_sheet,
  bp_split_tree_edge,
  bp_subdivide_layout_sheet,
  bp_switch_stretch_config,
  bp_switch_stretch_pattern,
  bp_undo_project,
  bp_update_layout_sheet,
  bp_update_tree_edge_length,
  bp_validate_optimizer_packing,
} from '../generated/oristudio-bp-wasm/oristudio_bp_wasm';
import type {
  OristudioBpPortDescriptor,
  OristudioBpOptimizerEvent,
  OristudioBpRawProject,
  OristudioBpWasmCreasePatternSnapshot,
  OristudioBpWasmLayoutSnapshot,
  OristudioBpWasmHistoryNavigationProject,
  OristudioBpWasmOpenedProject,
  OristudioBpWasmTreeData,
  OristudioBpWasmWorkspaceExportProject,
  OristudioBpWasmWorkspaceProject,
  OristudioBpWasmProjectSummary,
  OristudioBpWasmPackingValidation,
} from '../engine/oristudioBpTypes';
import type { WasmErrorEnvelope } from '../engine/types';

let ready: Promise<void> | null = null;

async function ensureReady() {
  ready ??= init().then(() => undefined);
  await ready;
}

function normalizeError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'oristudio_bp_wasm_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function call<T>(fn: () => T): Promise<T> {
  await ensureReady();
  try {
    return fn();
  } catch (error) {
    throw normalizeError(error);
  }
}

const api = {
  async portDescriptors(): Promise<OristudioBpPortDescriptor[]> {
    return call(() => bp_port_descriptors() as OristudioBpPortDescriptor[]);
  },
  async newSampleProject(): Promise<number> {
    return call(() => bp_new_sample_project());
  },
  async loadProject(text: string): Promise<number> {
    return call(() => bp_load_project(text));
  },
  async importTreeMaker(title: string, text: string): Promise<number> {
    return call(() => bp_import_treemaker(title, text));
  },
  async loadWorkspace(bytes: Uint8Array): Promise<OristudioBpWasmWorkspaceProject[]> {
    return call(() => bp_load_workspace(bytes) as OristudioBpWasmWorkspaceProject[]);
  },
  async snapshot(handle: number): Promise<OristudioBpRawProject> {
    return call(() => bp_project_snapshot(handle) as OristudioBpRawProject);
  },
  async summary(handle: number): Promise<OristudioBpWasmProjectSummary> {
    return call(() => bp_project_summary(handle) as OristudioBpWasmProjectSummary);
  },
  async treeData(handle: number): Promise<OristudioBpWasmTreeData> {
    return call(() => bp_project_tree_data(handle) as OristudioBpWasmTreeData);
  },
  async layoutSnapshot(handle: number): Promise<OristudioBpWasmLayoutSnapshot> {
    return call(() => bp_project_layout_snapshot(handle) as OristudioBpWasmLayoutSnapshot);
  },
  async creasePatternSnapshot(
    handle: number,
    reorient = false,
    useAuxiliary = false
  ): Promise<OristudioBpWasmCreasePatternSnapshot> {
    return call(
      () =>
        bp_project_crease_pattern_snapshot(
          handle,
          reorient,
          useAuxiliary
        ) as OristudioBpWasmCreasePatternSnapshot
    );
  },
  async packingValidation(handle: number): Promise<OristudioBpWasmPackingValidation> {
    return call(() => bp_project_packing_validation(handle) as OristudioBpWasmPackingValidation);
  },
  async undoProject(handle: number): Promise<OristudioBpWasmHistoryNavigationProject> {
    return call(() => bp_undo_project(handle) as OristudioBpWasmHistoryNavigationProject);
  },
  async redoProject(handle: number): Promise<OristudioBpWasmHistoryNavigationProject> {
    return call(() => bp_redo_project(handle) as OristudioBpWasmHistoryNavigationProject);
  },
  async notifyProjectSaved(handle: number): Promise<void> {
    return call(() => bp_notify_project_saved(handle));
  },
  async moveTreeVertex(
    handle: number,
    id: number,
    x: number,
    y: number,
    dragging = false
  ): Promise<OristudioBpRawProject> {
    return call(() => bp_move_tree_vertex(handle, id, x, y, dragging) as OristudioBpRawProject);
  },
  async renameTreeVertex(handle: number, id: number, name: string): Promise<OristudioBpRawProject> {
    return call(() => bp_rename_tree_vertex(handle, id, name) as OristudioBpRawProject);
  },
  async updateTreeEdgeLength(
    handle: number,
    n1: number,
    n2: number,
    length: number,
    dragging = false
  ): Promise<OristudioBpRawProject> {
    return call(
      () => bp_update_tree_edge_length(handle, n1, n2, length, dragging) as OristudioBpRawProject
    );
  },
  async addTreeLeaf(handle: number, at: number, length: number): Promise<OristudioBpRawProject> {
    return call(() => bp_add_tree_leaf(handle, at, length) as OristudioBpRawProject);
  },
  async deleteTreeLeaf(handle: number, id: number): Promise<OristudioBpRawProject> {
    return call(() => bp_delete_tree_leaf(handle, id) as OristudioBpRawProject);
  },
  async joinTreeVertex(handle: number, id: number): Promise<OristudioBpRawProject> {
    return call(() => bp_join_tree_vertex(handle, id) as OristudioBpRawProject);
  },
  async splitTreeEdge(handle: number, n1: number, n2: number): Promise<OristudioBpRawProject> {
    return call(() => bp_split_tree_edge(handle, n1, n2) as OristudioBpRawProject);
  },
  async mergeTreeEdge(handle: number, n1: number, n2: number): Promise<OristudioBpRawProject> {
    return call(() => bp_merge_tree_edge(handle, n1, n2) as OristudioBpRawProject);
  },
  async moveLayoutFlap(
    handle: number,
    id: number,
    x: number,
    y: number,
    dragging = false
  ): Promise<OristudioBpRawProject> {
    return call(() => bp_move_layout_flap(handle, id, x, y, dragging) as OristudioBpRawProject);
  },
  async moveLayoutFlaps(
    handle: number,
    ids: number[],
    x: number,
    y: number,
    dragging = false
  ): Promise<OristudioBpRawProject> {
    return call(() => bp_move_layout_flaps(handle, ids, x, y, dragging) as OristudioBpRawProject);
  },
  async resizeLayoutFlap(
    handle: number,
    id: number,
    width: number,
    height: number
  ): Promise<OristudioBpRawProject> {
    return call(() => bp_resize_layout_flap(handle, id, width, height) as OristudioBpRawProject);
  },
  async subdivideLayoutSheet(handle: number): Promise<OristudioBpRawProject> {
    return call(() => bp_subdivide_layout_sheet(handle) as OristudioBpRawProject);
  },
  async rotateLayoutSheet(handle: number, clockwise: boolean): Promise<OristudioBpRawProject> {
    return call(() => bp_rotate_layout_sheet(handle, clockwise) as OristudioBpRawProject);
  },
  async flipLayoutSheet(handle: number, horizontal: boolean): Promise<OristudioBpRawProject> {
    return call(() => bp_flip_layout_sheet(handle, horizontal) as OristudioBpRawProject);
  },
  async updateLayoutSheet(
    handle: number,
    gridType: 'rectangular' | 'diagonal',
    width: number,
    height: number
  ): Promise<OristudioBpRawProject> {
    return call(
      () => bp_update_layout_sheet(handle, gridType, width, height) as OristudioBpRawProject
    );
  },
  async completeStretch(handle: number, id: string): Promise<OristudioBpRawProject> {
    return call(() => bp_complete_stretch(handle, id) as OristudioBpRawProject);
  },
  async switchStretchConfig(
    handle: number,
    id: string,
    delta: number
  ): Promise<OristudioBpRawProject> {
    return call(() => bp_switch_stretch_config(handle, id, delta) as OristudioBpRawProject);
  },
  async switchStretchPattern(
    handle: number,
    id: string,
    delta: number
  ): Promise<OristudioBpRawProject> {
    return call(() => bp_switch_stretch_pattern(handle, id, delta) as OristudioBpRawProject);
  },
  async moveDevice(
    handle: number,
    id: string,
    index: number,
    x: number,
    y: number,
    dragging = false
  ): Promise<OristudioBpRawProject> {
    return call(() => bp_move_device(handle, id, index, x, y, dragging) as OristudioBpRawProject);
  },
  async exportBps(handle: number): Promise<string> {
    return call(() => bp_export_bps(handle));
  },
  async exportCp(handle: number, reorient = true, useAuxiliary = false): Promise<string> {
    return call(() => bp_export_cp(handle, reorient, useAuxiliary));
  },
  async exportFold(handle: number, reorient = true, useAuxiliary = false): Promise<string> {
    return call(() => bp_export_fold(handle, reorient, useAuxiliary));
  },
  async exportWorkspace(projects: OristudioBpWasmWorkspaceExportProject[]): Promise<Uint8Array> {
    return call(() => bp_export_workspace(projects));
  },
  async optimizerRequest(
    handle: number,
    layout: 'view' | 'random',
    useBasinHopping: boolean,
    randomCandidateCount: number,
    useDimension: boolean
  ): Promise<unknown> {
    return call(() =>
      bp_optimizer_request(
        handle,
        layout,
        useBasinHopping,
        randomCandidateCount,
        useDimension
      )
    );
  },
  async checkOptimizerResult(result: unknown): Promise<void> {
    return call(() => bp_check_optimizer_result(result));
  },
  async validateOptimizerPacking(request: unknown, result: unknown): Promise<void> {
    return call(() => bp_validate_optimizer_packing(request, result));
  },
  async optimizerTemplate(handle: number, request: unknown, result: unknown): Promise<unknown> {
    return call(() => bp_optimizer_template(handle, request, result));
  },
  async replaceWithOptimizerTemplate(
    handle: number,
    request: unknown,
    result: unknown
  ): Promise<OristudioBpRawProject> {
    return call(
      () => bp_replace_with_optimizer_template(handle, request, result) as OristudioBpRawProject
    );
  },
  async openOptimizerTemplate(
    handle: number,
    request: unknown,
    result: unknown
  ): Promise<OristudioBpWasmOpenedProject> {
    return call(
      () => bp_open_optimizer_template(handle, request, result) as OristudioBpWasmOpenedProject
    );
  },
  async optimizerSolve(request: unknown, seed: number | null = null): Promise<unknown> {
    return call(() => bp_optimizer_solve(request, seed));
  },
  async optimizerSolveReport(request: unknown, seed: number | null = null): Promise<unknown> {
    return call(() => bp_optimizer_solve_report(request, seed));
  },
  async optimizerSolveReportWithProgress(
    request: unknown,
    seed: number | null,
    onEvent: (event: OristudioBpOptimizerEvent) => void
  ): Promise<unknown> {
    return call(() => bp_optimizer_solve_report_with_progress(request, seed, onEvent));
  },
  async freeProject(handle: number): Promise<void> {
    return call(() => bp_free_project(handle));
  },
};

export type OristudioBpWorkerApi = typeof api;

expose(api);
