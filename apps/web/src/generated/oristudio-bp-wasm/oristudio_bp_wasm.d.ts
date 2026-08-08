/* tslint:disable */
/* eslint-disable */

export function bp_add_tree_leaf(handle: number, at: number, length: number): any;

export function bp_check_optimizer_result(result: any): void;

export function bp_complete_stretch(handle: number, id: string): any;

/**
 * Delete a batch of leaves in one round, as BP Studio's `$delete(vertices)`
 * does. The batch matters: `remove_leaf` simulates the whole round before
 * touching the tree, so the cascade (a parent that becomes a leaf once its
 * child goes) and the `MIN_VERTICES` floor are decided across every id at
 * once, rather than once per call.
 */
export function bp_delete_tree_leaves(handle: number, ids: any): any;

export function bp_export_bps(handle: number): string;

export function bp_export_cp(handle: number, reorient: boolean, use_auxiliary: boolean, cp_scale: number): string;

export function bp_export_fold(handle: number, reorient: boolean, use_auxiliary: boolean): string;

export function bp_export_workspace(projects: any): Uint8Array;

export function bp_flip_layout_sheet(handle: number, horizontal: boolean): any;

export function bp_free_project(handle: number): void;

export function bp_import_treemaker(title: string, text: string): number;

export function bp_join_tree_vertex(handle: number, id: number): any;

export function bp_load_project(text: string): number;

export function bp_load_workspace(bytes: Uint8Array): any;

export function bp_merge_tree_edge(handle: number, n1: number, n2: number): any;

export function bp_move_device(handle: number, id: string, device_index: number, x: number, y: number, dragging: boolean): any;

export function bp_move_layout_flap(handle: number, id: number, x: number, y: number, dragging: boolean): any;

export function bp_move_layout_flaps(handle: number, ids: any, x: number, y: number, dragging: boolean): any;

export function bp_move_tree_vertex(handle: number, id: number, x: number, y: number, dragging: boolean): any;

export function bp_new_sample_project(): number;

export function bp_notify_project_saved(handle: number): void;

export function bp_open_optimizer_template(handle: number, request: any, result: any): any;

export function bp_optimizer_request(handle: number, layout: string, use_bh: boolean, random: number, use_dimension: boolean, jitter_seed: number): any;

export function bp_optimizer_solve(request: any, seed?: number | null): any;

export function bp_optimizer_solve_report(request: any, seed?: number | null): any;

export function bp_optimizer_solve_report_with_progress(request: any, seed: number | null | undefined, on_event: Function): any;

export function bp_optimizer_template(handle: number, request: any, result: any): any;

export function bp_port_descriptors(): any;

export function bp_project_crease_pattern_snapshot(handle: number, reorient: boolean, use_auxiliary: boolean): any;

export function bp_project_layout_snapshot(handle: number): any;

export function bp_project_packing_validation(handle: number): any;

export function bp_project_snapshot(handle: number): any;

export function bp_project_summary(handle: number): any;

export function bp_project_tree_data(handle: number): any;

export function bp_redo_project(handle: number): any;

export function bp_rename_tree_vertex(handle: number, id: number, name: string): any;

export function bp_replace_with_optimizer_template(handle: number, request: any, result: any): any;

export function bp_resize_layout_flap(handle: number, id: number, width: number, height: number): any;

export function bp_rotate_layout_sheet(handle: number, clockwise: boolean): any;

export function bp_split_tree_edge(handle: number, n1: number, n2: number): any;

export function bp_subdivide_layout_sheet(handle: number): any;

export function bp_switch_stretch_config(handle: number, id: string, delta: number): any;

export function bp_switch_stretch_pattern(handle: number, id: string, delta: number): any;

export function bp_undo_project(handle: number): any;

export function bp_unsubdivide_layout_sheet(handle: number): any;

/**
 * Resize the layout sheet. A `null`/`undefined` dimension keeps whatever the
 * session's sheet has now, so a caller editing one dimension never has to
 * restate the other from a snapshot that may already be stale.
 */
export function bp_update_layout_sheet(handle: number, grid_type: string, width?: number | null, height?: number | null): any;

export function bp_update_tree_edge_length(handle: number, n1: number, n2: number, length: number, dragging: boolean): any;

export function bp_validate_optimizer_packing(request: any, result: any): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly bp_add_tree_leaf: (a: number, b: number, c: number) => [number, number, number];
    readonly bp_check_optimizer_result: (a: any) => [number, number];
    readonly bp_complete_stretch: (a: number, b: number, c: number) => [number, number, number];
    readonly bp_delete_tree_leaves: (a: number, b: any) => [number, number, number];
    readonly bp_export_bps: (a: number) => [number, number, number, number];
    readonly bp_export_cp: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly bp_export_fold: (a: number, b: number, c: number) => [number, number, number, number];
    readonly bp_export_workspace: (a: any) => [number, number, number, number];
    readonly bp_flip_layout_sheet: (a: number, b: number) => [number, number, number];
    readonly bp_free_project: (a: number) => [number, number];
    readonly bp_import_treemaker: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly bp_join_tree_vertex: (a: number, b: number) => [number, number, number];
    readonly bp_load_project: (a: number, b: number) => [number, number, number];
    readonly bp_load_workspace: (a: number, b: number) => [number, number, number];
    readonly bp_merge_tree_edge: (a: number, b: number, c: number) => [number, number, number];
    readonly bp_move_device: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly bp_move_layout_flap: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly bp_move_layout_flaps: (a: number, b: any, c: number, d: number, e: number) => [number, number, number];
    readonly bp_move_tree_vertex: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly bp_new_sample_project: () => [number, number, number];
    readonly bp_notify_project_saved: (a: number) => [number, number];
    readonly bp_open_optimizer_template: (a: number, b: any, c: any) => [number, number, number];
    readonly bp_optimizer_request: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly bp_optimizer_solve: (a: any, b: number, c: number) => [number, number, number];
    readonly bp_optimizer_solve_report: (a: any, b: number, c: number) => [number, number, number];
    readonly bp_optimizer_solve_report_with_progress: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly bp_optimizer_template: (a: number, b: any, c: any) => [number, number, number];
    readonly bp_port_descriptors: () => [number, number, number];
    readonly bp_project_crease_pattern_snapshot: (a: number, b: number, c: number) => [number, number, number];
    readonly bp_project_layout_snapshot: (a: number) => [number, number, number];
    readonly bp_project_packing_validation: (a: number) => [number, number, number];
    readonly bp_project_snapshot: (a: number) => [number, number, number];
    readonly bp_project_summary: (a: number) => [number, number, number];
    readonly bp_project_tree_data: (a: number) => [number, number, number];
    readonly bp_redo_project: (a: number) => [number, number, number];
    readonly bp_rename_tree_vertex: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly bp_replace_with_optimizer_template: (a: number, b: any, c: any) => [number, number, number];
    readonly bp_resize_layout_flap: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly bp_rotate_layout_sheet: (a: number, b: number) => [number, number, number];
    readonly bp_split_tree_edge: (a: number, b: number, c: number) => [number, number, number];
    readonly bp_subdivide_layout_sheet: (a: number) => [number, number, number];
    readonly bp_switch_stretch_config: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly bp_switch_stretch_pattern: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly bp_undo_project: (a: number) => [number, number, number];
    readonly bp_unsubdivide_layout_sheet: (a: number) => [number, number, number];
    readonly bp_update_layout_sheet: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly bp_update_tree_edge_length: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly bp_validate_optimizer_packing: (a: any, b: any) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
