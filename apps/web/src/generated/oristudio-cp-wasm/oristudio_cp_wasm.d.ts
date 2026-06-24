/* tslint:disable */
/* eslint-disable */

export function cp_operation_descriptors(): any;

export function document_snapshot(handle: number): any;

export function document_summary(handle: number): any;

export function execute_cp_command(handle: number, operation: any, payload: any): any;

export function export_cp(handle: number): string;

export function export_fold(handle: number): string;

export function folded_figure_fold(document_handle: number, starting_face_id: number, order: any, model: any): any;

export function folded_figure_fold_another(handle: number): any;

export function folded_figure_fold_to_case(handle: number, objective: number, initial_order: any): any;

export function folded_figure_snapshot(handle: number): any;

export function free_document(handle: number): void;

export function free_folded_figure(handle: number): void;

export function insert_line_segments(handle: number, segments: any): number;

export function load_cp(text: string, title: string): number;

export function load_document(document: any): number;

export function load_fold(text: string, title: string): number;

export function preview_cp_command(handle: number, operation: any, payload: any): any;

export function replace_line_segments(handle: number, line_ids: any, segments: any): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly cp_operation_descriptors: () => [number, number, number];
    readonly document_snapshot: (a: number) => [number, number, number];
    readonly document_summary: (a: number) => [number, number, number];
    readonly execute_cp_command: (a: number, b: any, c: any) => [number, number, number];
    readonly export_cp: (a: number) => [number, number, number, number];
    readonly export_fold: (a: number) => [number, number, number, number];
    readonly folded_figure_fold: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly folded_figure_fold_another: (a: number) => [number, number, number];
    readonly folded_figure_fold_to_case: (a: number, b: number, c: any) => [number, number, number];
    readonly folded_figure_snapshot: (a: number) => [number, number, number];
    readonly free_document: (a: number) => [number, number];
    readonly free_folded_figure: (a: number) => [number, number];
    readonly insert_line_segments: (a: number, b: any) => [number, number, number];
    readonly load_cp: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly load_document: (a: any) => [number, number, number];
    readonly load_fold: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly preview_cp_command: (a: number, b: any, c: any) => [number, number, number];
    readonly replace_line_segments: (a: number, b: any, c: any) => [number, number, number];
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
