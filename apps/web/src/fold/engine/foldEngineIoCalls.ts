/**
 * Import CP (with its Layer order dialog opening, row H10), Start from Edit's
 * folded figure, Send to Edit and the FOLD export, over the same wasm
 * `FoldEngine` as `foldEngineCalls.ts`: what
 * `workers/foldSequenceWorker.ts` exposes beside the step calls, kept apart
 * from the worker so the wasm test drives exactly these calls in-process.
 *
 * Every argument is checked here, at the boundary, as `foldEngineCalls.ts`
 * checks its own: handles are whole numbers, a choice is a list of indices,
 * a file is bytes. Shapes inside a target, limits or a scene are serde's to
 * check, in Rust. A caller's mistake throws a `{ code, message }` envelope;
 * a refusal is a value (`foldEngineIoWire.ts`).
 *
 * A landed import carries its state's `fs1` fingerprint, taken here like a
 * step's, so a commit needs nothing more from the worker.
 *
 * Pure: no React, no store, no wasm import (the engine is handed in).
 */

import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { foldStateFingerprint } from '../document/foldDigest';
import { invalidInput, requireHandle, requireObject } from './foldEngineCalls';
import type {
  FoldExported,
  FoldImportFingerprinted,
  FoldImportLanded,
  FoldImportLayerOpening,
  FoldImportLimits,
  FoldImportOpened,
  FoldImportSource,
  FoldImportTarget,
  FoldSheetFound,
} from './foldEngineIoWire';
import type { FoldEngineOutcome } from './foldEngineWire';

/** The wasm class's io surface, as the generated `FoldEngine` has it. */
export interface FoldWasmIoEngine {
  import_cp(file: unknown, bytes: Uint8Array, target: unknown, limits: unknown): unknown;
  import_sheet(file: unknown, bytes: Uint8Array): unknown;
  import_search(importHandle: number, choice: Uint32Array, limits: unknown): unknown;
  import_pick(importHandle: number, choice: Uint32Array): unknown;
  import_layer_opening(importHandle: number, choice: Uint32Array): unknown;
  import_pick_layer_order(importHandle: number, digest: string, relations: Uint32Array): unknown;
  import_turn(importHandle: number, turnDeg: number): unknown;
  import_edit_folded_figure(scene: unknown, target: unknown, limits: unknown): unknown;
  release_imports(imports: Uint32Array): number;
  live_imports(): number;
  send_to_edit(state: number, title?: string | null): string;
  export_fold(states: Uint32Array, title?: string | null): unknown;
  canonical_keys(state: number): string[];
}

/** The largest index a choice can carry: a `u32`. */
const MAX_INDEX = 0xffff_ffff;

function requireBytes(source: FoldImportSource): Uint8Array {
  if ('bytes' in source) {
    // By tag rather than `instanceof`: a file read in another realm (a
    // `TextEncoder`'s, a test's) is a `Uint8Array` all the same.
    if (Object.prototype.toString.call(source.bytes) !== '[object Uint8Array]') {
      throw invalidInput('bytes must be a Uint8Array');
    }
    return source.bytes;
  }
  if (typeof source.text !== 'string') throw invalidInput('a source needs its bytes or its text');
  return new TextEncoder().encode(source.text);
}

function requireChoice(choice: unknown): Uint32Array {
  if (!Array.isArray(choice)) throw invalidInput('choice must be an array of indices');
  return Uint32Array.from(choice, (index: unknown, k) => {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > MAX_INDEX) {
      throw invalidInput(`choice[${k}] must be an index (a whole number from 0), got ${String(index)}`);
    }
    return index;
  });
}

function requireTitle(title: unknown): string | undefined {
  if (title !== undefined && typeof title !== 'string') throw invalidInput('title must be a string');
  return title;
}

function requireHandles(name: string, handles: unknown): Uint32Array {
  if (!Array.isArray(handles)) throw invalidInput(`${name} must be an array of handles`);
  return Uint32Array.from(handles, (handle: unknown, k) => requireHandle(`${name}[${k}]`, handle));
}

export interface FoldEngineIoCalls {
  /**
   * Import CP: read the file with the CP kernel's loader, import it against
   * `target` and complete its order within `limits`. The import is held
   * until it is released.
   */
  importCp(
    source: FoldImportSource,
    target: FoldImportTarget,
    limits?: FoldImportLimits
  ): FoldEngineOutcome<FoldImportOpened>;
  /**
   * Import starting sheet: the sheet the pattern's border outlines, read with
   * the same loader, the creases left alone. Nothing is held.
   */
  importSheet(source: FoldImportSource): FoldEngineOutcome<FoldSheetFound>;
  importSearch(importHandle: number, choice: readonly number[], limits?: FoldImportLimits): FoldEngineOutcome<{ opened: FoldImportOpened; choice: number[] }>;
  /** Land one listed order per component as a step: its state, fingerprint and op. */
  importPick(importHandle: number, choice: readonly number[]): FoldEngineOutcome<FoldImportFingerprinted>;
  /**
   * Open an import onto the Layer order dialog (row H10): the fold the dialog
   * analyses, the order `choice` picks drawn over its faces, and how Fold
   * shows the state. Refused as `import_layer_unavailable` when the dialog
   * cannot work on this import; its own chooser still can.
   */
  importLayerOpening(importHandle: number, choice: readonly number[]): FoldEngineOutcome<FoldImportLayerOpening>;
  /**
   * Land the order the Layer order dialog's Apply chose: `relations`, flat
   * `[upper, lower, …]` over the faces of the opening whose source has
   * `digest`, as a step: its state, fingerprint and op.
   */
  importPickLayerOrder(
    importHandle: number,
    digest: string,
    relations: Uint32Array
  ): FoldEngineOutcome<FoldImportFingerprinted>;
  /**
   * Turn an import opened onto the Layer order dialog so Fold shows it
   * turned `turnDeg`, clockwise on screen, from its side's picture (the
   * dialog's Rotate, in its opening's `look` terms). Every step it lands
   * after stores the turn (`FoldCpJumpOp.turnDeg`). Answers its look now.
   */
  importTurn(importHandle: number, turnDeg: number): FoldImportLayerOpening['look'];
  /** Start from Edit's folded figure: the kernel's paper scene of it. */
  importEditFoldedFigure(
    scene: OristudioCpFoldedPaperScene,
    target: FoldImportTarget,
    limits?: FoldImportLimits
  ): FoldEngineOutcome<FoldImportFingerprinted>;
  /** Let imports go; how many were held. */
  releaseImports(imports: readonly number[]): number;
  /** How many imports are held. */
  liveImports(): number;
  /** Send to Edit: the state's crease pattern as the FOLD text Edit's import takes. */
  sendToEdit(state: number, title?: string): string;
  /** The FOLD file of a path of states, the first step shown to the last. */
  exportFold(states: readonly number[], title?: string): FoldEngineOutcome<FoldExported>;
}

export function createFoldEngineIoCalls(engine: FoldWasmIoEngine): FoldEngineIoCalls {
  const fingerprinted = (landed: FoldEngineOutcome<FoldImportLanded>): FoldEngineOutcome<FoldImportFingerprinted> =>
    landed.status === 'ok'
      ? { ...landed, fingerprint: foldStateFingerprint({ keys: engine.canonical_keys(landed.state) }) }
      : landed;
  const target = (value: FoldImportTarget) => requireObject('target', value);
  const limits = (value: FoldImportLimits | undefined) =>
    value === undefined ? undefined : requireObject('limits', value);

  return {
    importCp(source, to, within) {
      requireObject('source', source);
      const file = { format: source.format, sample: source.sample === true };
      return engine.import_cp(file, requireBytes(source), target(to), limits(within)) as FoldEngineOutcome<
        FoldImportOpened
      >;
    },

    importSheet(source) {
      requireObject('source', source);
      return engine.import_sheet({ format: source.format }, requireBytes(source)) as FoldEngineOutcome<FoldSheetFound>;
    },

    importSearch(importHandle, choice, within) {
      return engine.import_search(requireHandle('import', importHandle), requireChoice(choice), limits(within)) as FoldEngineOutcome<{ opened: FoldImportOpened; choice: number[] }>;
    },

    importPick(importHandle, choice) {
      const landed = engine.import_pick(requireHandle('import', importHandle), requireChoice(choice));
      return fingerprinted(landed as FoldEngineOutcome<FoldImportLanded>);
    },

    importLayerOpening(importHandle, choice) {
      return engine.import_layer_opening(
        requireHandle('import', importHandle),
        requireChoice(choice)
      ) as FoldEngineOutcome<FoldImportLayerOpening>;
    },

    importPickLayerOrder(importHandle, digest, relations) {
      if (typeof digest !== 'string') throw invalidInput('digest must be a string');
      if (Object.prototype.toString.call(relations) !== '[object Uint32Array]') {
        throw invalidInput('relations must be a Uint32Array');
      }
      const landed = engine.import_pick_layer_order(requireHandle('import', importHandle), digest, relations);
      return fingerprinted(landed as FoldEngineOutcome<FoldImportLanded>);
    },

    importTurn(importHandle, turnDeg) {
      if (typeof turnDeg !== 'number' || !Number.isFinite(turnDeg)) throw invalidInput('turnDeg must be a number');
      return engine.import_turn(requireHandle('import', importHandle), turnDeg) as FoldImportLayerOpening['look'];
    },

    importEditFoldedFigure(scene, to, within) {
      requireObject('scene', scene);
      const landed = engine.import_edit_folded_figure(scene, target(to), limits(within));
      return fingerprinted(landed as FoldEngineOutcome<FoldImportLanded>);
    },

    releaseImports(imports) {
      const handles = requireHandles('imports', imports);
      return handles.length === 0 ? 0 : engine.release_imports(handles);
    },

    liveImports() {
      return engine.live_imports();
    },

    sendToEdit(state, title) {
      return engine.send_to_edit(requireHandle('state', state), requireTitle(title));
    },

    exportFold(states, title) {
      return engine.export_fold(requireHandles('states', states), requireTitle(title)) as FoldEngineOutcome<FoldExported>;
    },
  };
}
