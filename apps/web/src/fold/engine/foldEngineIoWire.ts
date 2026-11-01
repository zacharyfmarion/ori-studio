/**
 * What crosses the Fold engine's bridge for Import CP, Start from Edit's
 * folded figure, Send to Edit and the FOLD export (plan D10, D16), as
 * TypeScript sees it. Mirrors `crates/oristudio-fold-wasm/src/io/wire.rs`;
 * the Rust side is the truth. The conventions are `foldEngineWire.ts`'s:
 * inputs as the document and the tools spell them, outputs as the engine's
 * serde types (snake_case) in the `status` envelope, refusals as values with
 * a stable `code` and never a sentence.
 *
 * - **An import is opened, then picked.** Opening reads a file with the CP
 *   kernel's own loader, imports it against an empty sequence or after a
 *   state, and completes its layer order from its letters: a true ‹ n of m ›,
 *   held in the worker under an import handle. Picking lands one order as a
 *   step and returns the `cp-jump` op that stores it, landed exactly as every
 *   replay of that op will land it.
 * - **An empty sequence adopts the pattern's sheet** (`paper`): the caller
 *   sets the sequence's paper to it when it stores the step, so the replay
 *   lands the step from that sheet.
 * - **A stored `cp-jump`** goes through the ordinary `step` call; one that no
 *   longer lands is refused with one of these codes and the step is broken.
 * - **Or the Layer order dialog picks** (row H10): an opened import is opened
 *   onto the dialog's faces (`FoldImportLayerOpening`), and the order its
 *   Apply chose lands as a pick's does.
 *
 * Pure types and constants: no React, no store, no wasm.
 */

import type { OristudioCpFoldedPaperScene, OristudioCpFoldSource } from '../../engine/oristudioCpTypes';
import type { FoldStateFingerprint } from '../document/foldDigest';
import type { FoldCpJumpOp, SheetPoint } from '../document/foldSequenceDocument';
import type { ImportedCreasePatternFormat } from '../../lib/fileFormats';
import type { FoldStateSummary } from './foldEngineWire';

// ---------------------------------------------------------------------------
// Inputs

/** The formats the CP kernel's loaders read: the same four Edit imports. */
export type FoldImportFormat = ImportedCreasePatternFormat;

/**
 * A crease pattern file: its bytes, or its text (sent as UTF-8; `.orh` is
 * better sent as bytes). A sample that ships with Fold says so, and its step
 * records `origin: 'sample'` rather than its format.
 */
export type FoldImportSource = { format: FoldImportFormat; sample?: boolean } & (
  | { bytes: Uint8Array }
  | { text: string }
);

/**
 * Where an import lands:
 *
 * - `empty`: a sequence with no steps, which adopts the pattern's square or
 *   rectangle, seen from `startSide` (`front` when absent);
 * - `after`: after the state this handle names, which must fit the pattern's
 *   sheet and still be held when an order is picked. The view is kept and the
 *   root continues.
 */
export type FoldImportTarget =
  | { kind: 'empty'; startSide?: 'front' | 'back' }
  | { kind: 'after'; state: number };

/**
 * What the completion may spend: orders listed per independent component (at
 * least one), and search nodes in all. Each defaults to the engine's
 * interactive bound; a search that needs more is refused as
 * `import_budget_exceeded` and may be asked again with more.
 */
export interface FoldImportLimits {
  perComponent?: number;
  maxNodes?: number;
}

// ---------------------------------------------------------------------------
// Outputs

/** The sheet an import found, as the engine names it. */
export type FoldImportSheetShape = { shape: 'square' } | { shape: 'rectangle'; width: number; height: number };

/** What an import found. Points are in sheet coordinates. */
export interface FoldImportSummary {
  shape: FoldImportSheetShape;
  /** The pattern was turned a quarter, counter-clockwise, to fit the sequence's sheet. */
  quarter_turn: boolean;
  faces: number;
  mountains: number;
  valleys: number;
  precreases: number;
  /** Folded creases whose letter the completion decides. */
  unknown_letters: number;
  /** Non-crease annotations. Cyan/F lines are retained as flat crease marks instead. */
  guides: [SheetPoint, SheetPoint][];
  /** Segments, or pieces of them, that added nothing. */
  dropped: number;
}

/** The sheet an empty sequence adopts, as the document stores its paper. */
export type FoldImportAdoptedPaper = { kind: 'square' } | { kind: 'rectangle'; aspect: [number, number] };

/**
 * The sheet a pattern's border outlines ("Import starting sheet",
 * `import_sheet`), as the engine names a sheet (`SheetShape`): a square, a
 * rectangle by its sides in the frame the outline code chose, or any other
 * outline as its corners, counter-clockwise in the unit sheet frame. Checked
 * by the engine as a sheet it folds: convex, no side too short.
 */
export type FoldFoundSheet =
  | { shape: 'square' }
  | { shape: 'rectangle'; width: number; height: number }
  | { shape: 'polygon'; points: [number, number][] };

/** `import_sheet`'s answer. */
export interface FoldSheetFound {
  sheet: FoldFoundSheet;
}

/** An import opened: its orders completed, held until one is picked or it is released. */
export interface FoldImportOpened {
  /** The handle `importPick` and `releaseImports` take. */
  import: number;
  summary: FoldImportSummary;
  /** For an empty target, the paper the sequence adopts; null after a state. */
  paper: FoldImportAdoptedPaper | null;
  /** The true ‹ n of m ›: every order the letters allow when `exact`, a lower bound otherwise. */
  count: { orders: number; exact: boolean };
  /** Per independent component, its listed orders. A choice picks one index below each; all zeros is the default. */
  components: { orders: number; truncated: boolean; pairs?: [number, number][] }[];
  /** Search nodes the completion used. */
  nodes: number;
}

/** An import landed as a step: the state, held like any step's, and the op to store. */
export interface FoldImportLanded {
  state: number;
  summary: FoldStateSummary;
  op: FoldCpJumpOp;
}

/** A landed import with its state's `fs1` fingerprint: what a commit takes. */
export interface FoldImportFingerprinted extends FoldImportLanded {
  fingerprint: FoldStateFingerprint;
}

/** A FOLD file. */
export interface FoldExported {
  text: string;
}

/**
 * What the Layer order dialog opens on for a held import
 * (`implementation-plans/layer-order-dialog.md`, row H10;
 * `import_layer_opening`):
 *
 * - `source`: the fold the dialog analyses, the import's stored crease
 *   pattern as Edit folds it whole, in the CP bridge's own shape; its
 *   `digest` is what `importPickLayerOrder` takes back with the relations;
 * - `shown`: the order the choice picks, drawn over the source's faces by
 *   the CP kernel (its front pass), which the dialog opens on, so an Apply
 *   that changed nothing is that choice;
 * - `look`: the side of the folded paper Fold shows the state from, and how
 *   far it turns it, clockwise on screen, from that side's picture.
 *
 * The engine remembers the match of the import's faces with the dialog's
 * until the import is opened again or let go.
 */
export interface FoldImportLayerOpening {
  source: OristudioCpFoldSource;
  shown: OristudioCpFoldedPaperScene;
  look: { side: 'front' | 'back'; turn_deg: number };
}

/**
 * Every Import CP and FOLD export refusal code: the engine's
 * (`ImportRefusal::code` in `crates/oristudio-fold/src/import/mod.rs`), then
 * the bridge's (`IoRefusal::code`).
 */
export const FOLD_IMPORT_REFUSAL_CODES = [
  'import_not_finite',
  'import_no_border',
  'import_outline_loops',
  'import_outline_invalid',
  'import_shape_unsupported',
  'import_shape_mismatch',
  'import_crease_off_sheet',
  'import_conflicting_creases',
  'import_crease_not_chord',
  'import_disconnected_creases',
  'import_non_convex_face',
  'import_too_many_faces',
  'import_stacked_too_deep',
  'import_not_flat_foldable',
  'import_ambiguous_overlap',
  'import_no_order',
  'import_budget_exceeded',
  'import_order_open',
  'import_witness_not_in_face',
  'import_relation_one_face',
  'import_internal',
  // The bridge's: a file the kernel cannot read, a stored step that no longer
  // lands, an incomplete figure, an export over the cap.
  'import_unreadable',
  'import_folded_form',
  'import_stored_unreadable',
  'import_order_broken',
  'import_figure_incomplete',
  'fold_export_too_large',
  // The Layer order dialog cannot open on a held import (row H10): the
  // import keeps its own chooser, so no one is shown this.
  'import_layer_unavailable',
] as const;

export type FoldImportRefusalCode = (typeof FOLD_IMPORT_REFUSAL_CODES)[number];
