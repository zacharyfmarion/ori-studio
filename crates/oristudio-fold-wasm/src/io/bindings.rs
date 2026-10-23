//! The io calls on [`FoldEngine`], across the wasm boundary.
//!
//! ```ts
//! // `apps/web/src/fold/engine/foldEngineIoWire.ts` holds these shapes in full.
//! class FoldEngine {
//!   /** Import CP: read the file, import it against the target and
//!    *  complete its order. A sample's step records `origin: 'sample'`.
//!    *  `limits` may be undefined. */
//!   import_cp(file: { format: 'cp' | 'fold' | 'ori' | 'orh'; sample?: boolean },
//!     bytes: Uint8Array, target: ImportTarget, limits?: ImportLimits):
//!     Outcome<ImportOpened>;
//!   /** Import starting sheet: the sheet the pattern's border outlines
//!    *  (square, rectangle or polygon); only the border is read. */
//!   import_sheet(file: { format: 'cp' | 'fold' | 'ori' | 'orh' }, bytes: Uint8Array):
//!     Outcome<{ sheet: SheetShape }>;
//!   /** Land one listed order per component as a step: its state and op. */
//!   import_pick(import: number, choice: Uint32Array): Outcome<ImportLanded>;
//!   /** Open a checking session on an import (the Layer order dialog; no
//!    *  caller in apps/web yet): what its letters force, a first order. */
//!   import_session(import: number, limits?: ImportLimits):
//!     Outcome<{ import: number; forced: number; nodes: number }>;
//!   /** Whether the letters and these [upper, lower] pairs leave an order;
//!    *  a fit becomes the order shown, which the next check prefers. */
//!   import_check(import: number, pairs: [number, number][],
//!     limits?: { maxNodes?: number; fastNodes?: number }): ImportChecked;
//!   /** Start from Edit's folded figure: the kernel's folded paper scene. */
//!   import_edit_folded_figure(scene: FoldedPaperScene, target: ImportTarget,
//!     limits?: ImportLimits): Outcome<ImportLanded>;
//!   /** Let imports go; how many were held. */
//!   release_imports(imports: Uint32Array): number;
//!   live_imports(): number;
//!   /** Send to Edit: the state's crease pattern as FOLD text. */
//!   send_to_edit(state: number, title?: string): string;
//!   /** The FOLD file of a path of states, first to last. */
//!   export_fold(states: Uint32Array, title?: string): Outcome<{ text: string }>;
//! }
//! ```

use oristudio_cp::folding::FoldedPaperScene;
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;

use oristudio_fold::FaceId;

use super::export::{export_fold, send_to_edit};
use super::figure::import_figure;
use super::imports::starting_sheet;
use super::wire::{CheckWireLimits, CpFile, IoCallError, Limits, Target};
use crate::{FoldEngine, js_error, parse, to_js_value};

#[wasm_bindgen]
impl FoldEngine {
    /// Import CP: read `bytes` as `file` says, import the crease pattern
    /// against `target` and complete its order within `limits`, which may be
    /// `undefined` or `null`.
    pub fn import_cp(
        &mut self,
        file: JsValue,
        bytes: &[u8],
        target: JsValue,
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let file: CpFile = parse("file", file)?;
        let target: Target = parse("target", target)?;
        let limits: Limits = optional("limits", limits)?;
        let opened = self
            .imports
            .open(&self.inner, file, bytes, target, &limits)
            .map_err(thrown)?;
        to_js_value(&opened)
    }

    /// Import starting sheet: the sheet the border of the crease pattern in
    /// `bytes` outlines, for a sequence to start from. Only the border is
    /// read; nothing is held.
    pub fn import_sheet(&self, file: JsValue, bytes: &[u8]) -> Result<JsValue, JsValue> {
        let file: CpFile = parse("file", file)?;
        to_js_value(&starting_sheet(file, bytes))
    }

    /// Land the order `choice` picks, one listed order per component.
    pub fn import_pick(&mut self, import: u32, choice: &[u32]) -> Result<JsValue, JsValue> {
        let choice: Vec<usize> = choice.iter().map(|&k| k as usize).collect();
        let landed = self
            .imports
            .pick(&mut self.inner, import, &choice)
            .map_err(thrown)?;
        to_js_value(&landed)
    }

    pub fn import_search(
        &mut self,
        import: u32,
        choice: &[u32],
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits: Limits = optional("limits", limits)?;
        let choice: Vec<usize> = choice.iter().map(|&i| i as usize).collect();
        to_js_value(
            &self
                .imports
                .search(import, &choice, &limits)
                .map_err(thrown)?,
        )
    }

    /// Open a checking session on a held import (the Layer order dialog):
    /// what its letters force and a first order, which becomes the order
    /// shown. `limits` (`maxNodes`) may be `undefined` or `null`.
    pub fn import_session(&mut self, import: u32, limits: JsValue) -> Result<JsValue, JsValue> {
        let limits: Limits = optional("limits", limits)?;
        to_js_value(&self.imports.open_session(import, &limits).map_err(thrown)?)
    }

    /// Whether the import's letters and `pairs` (`[upper, lower]` face ids)
    /// leave an order. The search prefers the order shown; a fit becomes it.
    /// `limits` (`maxNodes`, `fastNodes`) may be `undefined` or `null`.
    pub fn import_check(
        &mut self,
        import: u32,
        pairs: JsValue,
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let pairs: Vec<[FaceId; 2]> = parse("pairs", pairs)?;
        let limits: CheckWireLimits = optional("limits", limits)?;
        to_js_value(
            &self
                .imports
                .check(import, &pairs, &limits)
                .map_err(thrown)?,
        )
    }

    /// Start from Edit's folded figure: `scene` is the kernel's folded paper
    /// scene of the figure, as `folded_figure_paper_scene` returned it.
    pub fn import_edit_folded_figure(
        &mut self,
        scene: JsValue,
        target: JsValue,
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let scene: FoldedPaperScene = parse("scene", scene)?;
        let target: Target = parse("target", target)?;
        let limits: Limits = optional("limits", limits)?;
        let landed = import_figure(&mut self.inner, &scene, target, &limits).map_err(thrown)?;
        to_js_value(&landed)
    }

    /// Let imports go; how many were held.
    pub fn release_imports(&mut self, imports: &[u32]) -> u32 {
        let released = imports.iter().filter(|&&i| self.imports.release(i)).count();
        u32::try_from(released).unwrap_or(u32::MAX)
    }

    /// How many imports are held.
    pub fn live_imports(&self) -> u32 {
        u32::try_from(self.imports.len()).unwrap_or(u32::MAX)
    }

    /// Send to Edit: the state's crease pattern as FOLD text.
    pub fn send_to_edit(&self, state: u32, title: Option<String>) -> Result<String, JsValue> {
        send_to_edit(&self.inner, state, title.as_deref()).map_err(thrown)
    }

    /// The FOLD file of the path `states` names, first step shown to last.
    pub fn export_fold(&self, states: &[u32], title: Option<String>) -> Result<JsValue, JsValue> {
        to_js_value(&export_fold(&self.inner, states, title.as_deref()).map_err(thrown)?)
    }
}

/// `value` parsed, or the default when it is `undefined` or `null`.
fn optional<T: DeserializeOwned + Default>(name: &str, value: JsValue) -> Result<T, JsValue> {
    if value.is_undefined() || value.is_null() {
        Ok(T::default())
    } else {
        parse(name, value)
    }
}

fn thrown(error: IoCallError) -> JsValue {
    js_error(error.code(), error.to_string())
}
