//! Import CP, Send to Edit and the FOLD export: everything Fold hands to or
//! takes from the CP kernel's world (plan D1, D10, D16).
//!
//! The kernel is linked here (`oristudio-fold`'s `kernel` feature) and used
//! only at the edge, through its own loaders and writers ([`kernel`]):
//!
//! - **Import CP** ([`imports`]): a `.cp`, `.fold`, `.ori` or `.orh` file is
//!   read by the kernel's loader, written once by its FOLD writer as the
//!   step's `cpJson`, and that text — never the file — is what the engine
//!   imports, against an empty sequence or after a state. Its layer order is
//!   completed from its letters as a true ‹ n of m ›, within a budget, and
//!   held under an import handle until an order is picked. Picking lands the
//!   `cp-jump` op it returns *by replaying it* ([`jump::land`], what
//!   `Bridge::apply` does with every stored `cp-jump`), so a step is
//!   committed exactly as every later replay will land it.
//! - **Start from Edit's folded figure** ([`figure`]): the kernel's folded
//!   paper scene — what Edit's folded figure exposes on the web — gives the
//!   faces on the sheet and Oriedita's stacking, which decide the order.
//! - **Send to Edit and the FOLD export** ([`export`]): `fold_cp_to_model`
//!   through the kernel's FOLD writer, as Edit opens it; and a path's states
//!   as one FOLD file (`oristudio_fold::fold_file`).
//!
//! [`bindings`] puts these on `FoldEngine`.
//!
//! # The `cp-jump` op (plan D16)
//!
//! `{ kind: 'cp-jump', cpJson, orderJson, origin }`, a snapshot:
//!
//! - **`cpJson`** is the imported crease pattern as the kernel's FOLD writer
//!   writes its model — creases only, without the arrays its FOLD reader does
//!   not use for them — so the bridge reloads it with the kernel's reader and
//!   no file ([`kernel::cp_json`]). FOLD rather than the kernel model's own
//!   serde shape: FOLD is a published, versioned format that Edit and every
//!   FOLD tool read, where the model's serde is an internal shape about
//!   seven times the size (`tests/io.rs`).
//! - **`orderJson`** is the chosen order, every face named by an interior
//!   sheet-point witness, as FOLD `faceOrders` triples
//!   ([`oristudio_fold::WitnessOrder`]).
//! - **`origin`** is a closed enum, never a file name ([`CpOrigin`]).
//!
//! A stored `cp-jump` lands only when its pattern still imports after its
//! parent and its witnesses still decide one order; otherwise it is refused
//! (`import_*`) and the replay marks the step broken.
//!
//! Refusals are values with stable codes and no sentence ([`IoRefusal`]);
//! only a caller's mistake, or a defect, throws ([`IoCallError`]).

pub mod bindings;
pub mod export;
pub mod figure;
pub mod imports;
pub mod jump;
pub mod kernel;
pub mod wire;

pub use export::{export_fold, send_to_edit, send_to_edit_text};
pub use figure::{EditFigure, import_figure, read_figure};
pub use imports::{Imports, starting_sheet};
pub use jump::land;
pub use wire::{
    AdoptedPaper, ComponentCount, CpFile, CpFormat, CpJump, CpOrigin, Exported, FigureGap,
    IoCallError, IoRefusal, JumpOp, Landed, Limits, Opened, SheetFound, StoredField, Target,
};
