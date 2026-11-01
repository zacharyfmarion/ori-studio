//! The Layer order dialog's calls on [`FoldEngine`], across the wasm
//! boundary. `apps/web/src/layer-order/engine/layerOrderWire.ts` holds these
//! shapes in full.
//!
//! ```ts
//! class FoldEngine {
//!   /** Open a constraint session on what a host folded: the CP bridge's
//!    *  source, passed through unchanged, on the solver's first order.
//!    *  `limits` may be undefined. */
//!   layer_open(source: OristudioCpFoldSource, limits?: LayerLimits): LayerOpenOutcome;
//!   /** The same, on the order the host shows: its relations, [upper, lower, …]. */
//!   layer_open_showing(source: OristudioCpFoldSource, relations: Uint32Array,
//!     limits?: LayerLimits): LayerOpenOutcome;
//!   /** The same as layer_open, then a saved record (its JSON) restored onto it. */
//!   layer_restore(source: OristudioCpFoldSource, record: string, limits?: LayerLimits):
//!     LayerRestoreOutcome;
//!   /** A record restored again on an open session (a retry), same handle. */
//!   layer_restore_record(session: number, record: string, limits?: LayerLimits):
//!     LayerRestoreOutcome;
//!   /** Where the order on screen came from at open or the last restore. */
//!   layer_opened_on(session: number): LayerOpenedOn;
//!   /** The pairs deduction leaves open, [lo, hi, …], ascending. */
//!   layer_open_pairs(session: number): Uint32Array;
//!   /** The committed constraints, [subject, object, sign, …]. */
//!   layer_constraints(session: number): Int32Array;
//!   /** The committed list plus one [subject, object, sign]: never commits. */
//!   layer_preview(session: number, candidate: Int32Array, limits?: LayerLimits): LayerPreviewed;
//!   /** Any list, whatever is committed: never commits. */
//!   layer_preview_list(session: number, constraints: Int32Array, limits?: LayerLimits):
//!     LayerPreviewed;
//!   /** Make the whole list the committed one (Add, remove, undo, redo, Clear all). */
//!   layer_commit(session: number, constraints: Int32Array, limits?: LayerLimits): LayerCommitted;
//!   /** Add by a preview: its token and the list it checked; no search when current. */
//!   layer_commit_preview(session: number, token: number, constraints: Int32Array,
//!     limits?: LayerLimits): LayerCommitted;
//!   /** The order on screen, one bit per pair: what layer_show puts back. */
//!   layer_order(session: number): Uint8Array;
//!   /** Undo and redo: the list committed and an earlier order on screen, exactly, no search. */
//!   layer_show(session: number, constraints: Int32Array, order: Uint8Array,
//!     limits?: LayerLimits): LayerShown;
//!   /** The saved constraints a restore did not apply, in record order. */
//!   layer_carried(session: number): LayerCarriedRow[];
//!   /** Remove the carried row of record index `index` (`LayerCarriedRow.index`). */
//!   layer_remove_carried(session: number, index: number): boolean;
//!   layer_clear_carried(session: number): void;
//!   layer_stacks(session: number, side: 'front' | 'back'): LayerStacks;
//!   /** The kernel's paper scene of the order on screen; null with no subfaces. */
//!   layer_scene(session: number, side: 'front' | 'back', model?: OristudioCpFoldedFigureModel):
//!     OristudioCpFoldedPaperScene | null;
//!   /** [upper, lower, …], for the CP bridge's `folded_figure_fold_with_order`. */
//!   layer_oriedita_relations(session: number): Uint32Array;
//!   /**
//!    * The committed constraints, then the carried rows, as one record: every
//!    * carried row, or only those whose record index `keep` names. The session
//!    * keeps its carried rows either way.
//!    */
//!   layer_save(session: number, keep?: Uint32Array): LayerSaveOutcome;
//!   /** Let a session go, with its cursors; whether it was held. */
//!   layer_close(session: number): boolean;
//!   layer_live(): number;
//!
//!   // E6: why a sentence can't fit, and the solutions.
//!   /** The smallest clashing set of the committed list plus one. Never commits. */
//!   layer_explain(session: number, candidate: Int32Array, limits?: LayerLimits): LayerExplained;
//!   /** The same for any list. */
//!   layer_explain_list(session: number, constraints: Int32Array, limits?: LayerLimits):
//!     LayerExplained;
//!   /** A solutions cursor beside the session, counted only when advanced. */
//!   layer_solutions_start(session: number, caps?: LayerSolutionCaps): number;
//!   /** One slice of the count, resumed where the last stopped. */
//!   layer_solutions_advance(session: number, cursor: number, limits?: LayerLimits):
//!     LayerSolutionCount;
//!   /** Where the order on screen lies in the stepper's order ("3 of 12"). */
//!   layer_solutions_position(session: number, cursor: number, by: LayerStepBy): LayerPosition;
//!   /** The next or previous solution; only the order on screen changes. */
//!   layer_step(session: number, cursor: number, by: LayerStepBy,
//!     direction: 'next' | 'previous', limits?: LayerLimits): LayerStepped;
//!   layer_solutions_close(session: number, cursor: number): boolean;
//! }
//! ```
//!
//! A cursor counts the committed constraints it started on. After a commit
//! or a restore to other constraints every call on it throws
//! `session_stale_solutions` (a commit back to the same list makes it good
//! again); a step keeps it. There is no count worker: the dialog's one
//! worker advances the cursor in short slices (a small `maxNodes` and a
//! short `deadlineMs`) between its other calls.
//!
//! Every call that searches (the opens, the restores, the previews, the
//! commits) takes `{ maxNodes?, fastNodes?, deadlineMs? }`; the deadline is
//! `deadlineMs` after the call starts, by the worker's clock, and **keep
//! trying is the same call with a larger `deadlineMs`** ([`LayerLimits`]). A
//! call that timed out changed nothing.
//!
//! The order a host shows, for `layer_open_showing`, is read off the paper
//! scene it holds by `layerOrderSceneRelations.ts`, which mirrors
//! `oristudio_fold::steer::scene_relations`: the scene is already in the
//! host's hands, so it is not sent through the wasm to come back as pairs.
//!
//! Large data crosses as typed arrays, copied out of the wasm heap (so a
//! later call that grows it leaves them valid); small results are plain
//! objects. Refusals are values (`{ status: 'refused', refusal: { code, … } }`);
//! only a caller's mistake or a defect throws, as `{ code, message }`
//! ([`LayerCallError`]).

use js_sys::{Float64Array, Int32Array, Object, Reflect, Uint8Array, Uint32Array};
use oristudio_cp::folding::FoldedFigureModel;
use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;

use super::wire::{
    CantFitKind, CantFitWire, Committing, Explained, LAYER_LIMITS_FIELDS,
    LAYER_SOLUTION_CAPS_FIELDS, LayerCallError, LayerFoldSource, LayerLimits, LayerOpened,
    LayerRefusal, LayerRestored, LayerSolutionCaps, LayerStepBy, Opening, PackedStacks, Previewed,
    Restoring, Saving, Showing, Sides, Stepping, direction_of, side_of,
};
use crate::{FoldEngine, js_error, parse, to_js_value};

#[wasm_bindgen]
impl FoldEngine {
    /// Open a constraint session on `source`, the CP bridge's
    /// `{ segments, starting_face_id, aux_segments, digest }` of what the
    /// host folded, on the solver's first order. `limits` may be `undefined`
    /// or `null`.
    pub fn layer_open(&mut self, source: JsValue, limits: JsValue) -> Result<JsValue, JsValue> {
        let source: LayerFoldSource = parse("source", source)?;
        let limits = limits_of(limits)?;
        opening(self.layers.open(&source, &limits).map_err(thrown)?)
    }

    /// Open a constraint session on `source` showing the order the host
    /// shows: `relations`, `[upper, lower, …]` in Oriedita's frame, as
    /// `layer_oriedita_relations` answers them.
    pub fn layer_open_showing(
        &mut self,
        source: JsValue,
        relations: &[u32],
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let source: LayerFoldSource = parse("source", source)?;
        let limits = limits_of(limits)?;
        opening(
            self.layers
                .open_showing(&source, relations, &limits)
                .map_err(thrown)?,
        )
    }

    /// Open a session on `source` and restore `record`, a saved record's
    /// JSON string, onto it (decision D10).
    pub fn layer_restore(
        &mut self,
        source: JsValue,
        record: &str,
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let source: LayerFoldSource = parse("source", source)?;
        let limits = limits_of(limits)?;
        restoring(
            self.layers
                .restore(&source, record, &limits)
                .map_err(thrown)?,
        )
    }

    /// Restore `record` again on the open `session`, as `layer_restore`
    /// answers, under the same handle.
    pub fn layer_restore_record(
        &mut self,
        session: u32,
        record: &str,
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits = limits_of(limits)?;
        restoring(
            self.layers
                .restore_record(session, record, &limits)
                .map_err(thrown)?,
        )
    }

    /// Where the order on screen came from at open or the last restore.
    pub fn layer_opened_on(&self, session: u32) -> Result<JsValue, JsValue> {
        to_js_value(&self.layers.opened_on(session).map_err(thrown)?)
    }

    /// The pairs deduction leaves open, `[lo, hi, …]`.
    pub fn layer_open_pairs(&self, session: u32) -> Result<Vec<u32>, JsValue> {
        self.layers.open_pairs(session).map_err(thrown)
    }

    /// The committed constraints, `[subject, object, sign, …]`.
    pub fn layer_constraints(&self, session: u32) -> Result<Vec<i32>, JsValue> {
        self.layers.constraints(session).map_err(thrown)
    }

    /// Whether the committed constraints and `candidate`
    /// (`[subject, object, sign]`) leave an order. Never commits; a fit
    /// carries the token `layer_commit_preview` adopts it by.
    pub fn layer_preview(
        &mut self,
        session: u32,
        candidate: &[i32],
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits = limits_of(limits)?;
        previewed(
            self.layers
                .preview(session, candidate, &limits)
                .map_err(thrown)?,
        )
    }

    /// Whether `constraints` (`[subject, object, sign, …]`), whatever is
    /// committed, leave an order. Never commits.
    pub fn layer_preview_list(
        &mut self,
        session: u32,
        constraints: &[i32],
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits = limits_of(limits)?;
        previewed(
            self.layers
                .preview_list(session, constraints, &limits)
                .map_err(thrown)?,
        )
    }

    /// Make `constraints` (`[subject, object, sign, …]`) the committed list.
    pub fn layer_commit(
        &mut self,
        session: u32,
        constraints: &[i32],
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits = limits_of(limits)?;
        committed(
            self.layers
                .commit(session, constraints, &limits)
                .map_err(thrown)?,
        )
    }

    /// Add by a preview: `token` from its fit and `constraints` the list it
    /// checked. Adopted with no search while it is the session's last
    /// preview; otherwise the list is committed by a search within `limits`.
    pub fn layer_commit_preview(
        &mut self,
        session: u32,
        token: u32,
        constraints: &[i32],
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits = limits_of(limits)?;
        committed(
            self.layers
                .commit_preview(session, token, constraints, &limits)
                .map_err(thrown)?,
        )
    }

    /// The order on screen, packed one bit per variable: what `layer_show`
    /// puts back exactly. Meaningless to any other session.
    pub fn layer_order(&self, session: u32) -> Result<Vec<u8>, JsValue> {
        self.layers.order(session).map_err(thrown)
    }

    /// Undo and redo: `constraints` (`[subject, object, sign, …]`) committed
    /// and `order` (`layer_order`'s, from earlier) on screen, exactly, with
    /// no search: `{ verdict: 'shown', … }` as `layer_commit` answers a
    /// commit, or `{ verdict: 'refused' }` when the order does not fit the
    /// creases and the constraints, or timed out. Only `shown` changed the
    /// session; a cursor counting the same constraints stays good.
    pub fn layer_show(
        &mut self,
        session: u32,
        constraints: &[i32],
        order: &[u8],
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits = limits_of(limits)?;
        match self
            .layers
            .show(session, constraints, order, &limits)
            .map_err(thrown)?
        {
            Showing::Shown(done) => {
                let answer = committed(Committing::Committed(done))?;
                Reflect::set(
                    &answer,
                    &JsValue::from_str("verdict"),
                    &JsValue::from_str("shown"),
                )?;
                Ok(answer)
            }
            Showing::Refused => Ok(Fields::new().text("verdict", "refused")?.into()),
            Showing::TimedOut(out) => Ok(Fields::of(&out)?.text("verdict", "timed_out")?.into()),
        }
    }

    /// The saved constraints the last restore did not apply, in record
    /// order, each with its status.
    pub fn layer_carried(&self, session: u32) -> Result<JsValue, JsValue> {
        to_js_value(&self.layers.carried(session).map_err(thrown)?)
    }

    /// Remove the carried row of record index `index`; whether there was one.
    pub fn layer_remove_carried(&mut self, session: u32, index: u32) -> Result<bool, JsValue> {
        self.layers
            .remove_carried(session, index as usize)
            .map_err(thrown)
    }

    /// Remove every carried row.
    pub fn layer_clear_carried(&mut self, session: u32) -> Result<(), JsValue> {
        self.layers.clear_carried(session).map_err(thrown)
    }

    /// The order on screen's stacks from `side` (`"front"` or `"back"`).
    pub fn layer_stacks(&self, session: u32, side: &str) -> Result<JsValue, JsValue> {
        let side = side_of(side).map_err(thrown)?;
        Ok(stacks_object(&self.layers.stacks(session, side).map_err(thrown)?)?.into())
    }

    /// The kernel's paper scene of the order on screen from `side`, with the
    /// host's `model` (`undefined` or `null` for the kernel's default).
    pub fn layer_scene(
        &self,
        session: u32,
        side: &str,
        model: JsValue,
    ) -> Result<JsValue, JsValue> {
        let side = side_of(side).map_err(thrown)?;
        let model: FoldedFigureModel = optional("model", model)?;
        let scene = self.layers.scene(session, side, &model).map_err(thrown)?;
        match scene {
            Some(scene) => to_js_value(&scene),
            None => Ok(JsValue::NULL),
        }
    }

    /// The order on screen as Oriedita's relations, `[upper, lower, …]`.
    pub fn layer_oriedita_relations(&self, session: u32) -> Result<Vec<u32>, JsValue> {
        self.layers.oriedita_relations(session).map_err(thrown)
    }

    /// The saved record: `{ status: 'ok', json }`, or refused over budget.
    /// `keep`, when given, names the carried rows to write back by record
    /// index; the session keeps every one either way.
    pub fn layer_save(&self, session: u32, keep: Option<Vec<u32>>) -> Result<JsValue, JsValue> {
        let keep: Option<Vec<usize>> =
            keep.map(|keep| keep.into_iter().map(|index| index as usize).collect());
        match self.layers.save(session, keep.as_deref()).map_err(thrown)? {
            Saving::Saved { json } => Ok(Fields::new()
                .text("status", "ok")?
                .text("json", &json)?
                .into()),
            Saving::Refused(refusal) => refused(&refusal),
        }
    }

    /// Let a session go; whether it was held.
    pub fn layer_close(&mut self, session: u32) -> bool {
        self.layers.close(session)
    }

    /// How many sessions are held.
    pub fn layer_live(&self) -> u32 {
        u32::try_from(self.layers.len()).unwrap_or(u32::MAX)
    }

    // --- E6: explain, and the solutions -----------------------------------

    /// Why the committed constraints and `candidate` (`[subject, object,
    /// sign]`) can't fit: the smallest clashing set. Never commits.
    pub fn layer_explain(
        &self,
        session: u32,
        candidate: &[i32],
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits = limits_of(limits)?;
        explained(
            self.layers
                .explain(session, candidate, &limits)
                .map_err(thrown)?,
        )
    }

    /// [`Self::layer_explain`] for any list (`[subject, object, sign, …]`).
    pub fn layer_explain_list(
        &self,
        session: u32,
        constraints: &[i32],
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits = limits_of(limits)?;
        explained(
            self.layers
                .explain_list(session, constraints, &limits)
                .map_err(thrown)?,
        )
    }

    /// A solutions cursor for the committed constraints; `caps` may be
    /// `undefined` or `null`.
    pub fn layer_solutions_start(&mut self, session: u32, caps: JsValue) -> Result<u32, JsValue> {
        let caps: LayerSolutionCaps = if caps.is_undefined() || caps.is_null() {
            LayerSolutionCaps::default()
        } else {
            known_fields("caps", &caps, &LAYER_SOLUTION_CAPS_FIELDS)?;
            parse("caps", caps)?
        };
        self.layers.solutions_start(session, &caps).map_err(thrown)
    }

    /// One slice of the count: `{ front, back, orders, done }`, each tally
    /// `{ n, exact }`.
    pub fn layer_solutions_advance(
        &mut self,
        session: u32,
        cursor: u32,
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let limits = limits_of(limits)?;
        to_js_value(
            &self
                .layers
                .solutions_advance(session, cursor, &limits)
                .map_err(thrown)?,
        )
    }

    /// Where the order on screen lies: `{ index, total: { n, exact } }`.
    pub fn layer_solutions_position(
        &self,
        session: u32,
        cursor: u32,
        by: JsValue,
    ) -> Result<JsValue, JsValue> {
        let by = step_by_of(by)?;
        to_js_value(
            &self
                .layers
                .solutions_position(session, cursor, by)
                .map_err(thrown)?,
        )
    }

    /// The next or the previous solution (`direction`: `"next"` or
    /// `"previous"`).
    pub fn layer_step(
        &mut self,
        session: u32,
        cursor: u32,
        by: JsValue,
        direction: &str,
        limits: JsValue,
    ) -> Result<JsValue, JsValue> {
        let by = step_by_of(by)?;
        let direction = direction_of(direction).map_err(thrown)?;
        let limits = limits_of(limits)?;
        let stepped = self
            .layers
            .step(session, cursor, by, direction, &limits)
            .map_err(thrown)?;
        Ok(match stepped {
            Stepping::Moved(moved) => Fields::new()
                .text("verdict", "moved")?
                .set(
                    "changed",
                    spots_changed(&moved.changed.front, &moved.changed.back)?,
                )?
                .plain("position", &moved.position)?
                .set("stacks", sides_object(&moved.stacks)?)?
                .into(),
            Stepping::End => Fields::new().text("verdict", "end")?.into(),
            Stepping::TimedOut(out) => Fields::of(&out)?.text("verdict", "timed_out")?.into(),
        })
    }

    /// Let a cursor go; whether it was held.
    pub fn layer_solutions_close(&mut self, session: u32, cursor: u32) -> Result<bool, JsValue> {
        self.layers.solutions_close(session, cursor).map_err(thrown)
    }
}

fn explained(explained: Explained) -> Result<JsValue, JsValue> {
    Ok(match explained {
        Explained::Fits => Fields::new().text("verdict", "fits")?.into(),
        Explained::Clash(clash) => Fields::new()
            .text("verdict", "clash")?
            .set(
                "constraints",
                Uint32Array::from(clash.constraints.as_slice()),
            )?
            .set("minimal", JsValue::from_bool(clash.minimal))?
            .set("faces", Uint32Array::from(clash.faces.as_slice()))?
            .set("proof", proof_object(&clash.proof, &clash.proof_faces)?)?
            .set("traced", Uint32Array::from(clash.traced.as_slice()))?
            .into(),
        Explained::TimedOut(out) => Fields::of(&out)?.text("verdict", "timed_out")?.into(),
    })
}

/// `{ picture: 'front' | 'back' }` or `'layer_order'`.
fn step_by_of(by: JsValue) -> Result<oristudio_fold::steer::StepBy, JsValue> {
    if by.is_object() {
        known_fields("by", &by, &["picture"])?;
    }
    let by: LayerStepBy = parse("by", by)?;
    by.step_by().map_err(thrown)
}

/// A plain JS object, built field by field: serde for the small parts, typed
/// arrays copied out of the heap for the large ones.
struct Fields(Object);

impl Fields {
    fn new() -> Fields {
        Fields(Object::new())
    }

    /// `value`'s plain object, to add fields to.
    fn of(value: &impl Serialize) -> Result<Fields, JsValue> {
        to_js_value(value)?
            .dyn_into::<Object>()
            .map(Fields)
            .map_err(|_| js_error("js_value", "a result is not an object".to_string()))
    }

    fn set(self, key: &str, value: impl Into<JsValue>) -> Result<Fields, JsValue> {
        Reflect::set(&self.0, &JsValue::from_str(key), &value.into())?;
        Ok(self)
    }

    fn text(self, key: &str, value: &str) -> Result<Fields, JsValue> {
        self.set(key, JsValue::from_str(value))
    }

    /// A count, as JavaScript's number.
    fn number(self, key: &str, value: impl Into<f64>) -> Result<Fields, JsValue> {
        self.set(key, JsValue::from_f64(value.into()))
    }

    fn plain(self, key: &str, value: &impl Serialize) -> Result<Fields, JsValue> {
        let value = to_js_value(value)?;
        self.set(key, value)
    }
}

impl From<Fields> for JsValue {
    fn from(fields: Fields) -> JsValue {
        fields.0.into()
    }
}

fn opening(opening: Opening) -> Result<JsValue, JsValue> {
    match opening {
        Opening::Opened(opened) => opened_object(&opened, "ok").map(JsValue::from),
        Opening::Refused(refusal) => refused(&refusal),
    }
}

fn restoring(restoring: Restoring) -> Result<JsValue, JsValue> {
    match restoring {
        Restoring::Restored(restored) => restored_object(&restored),
        Restoring::Refused(refusal) => refused(&refusal),
    }
}

/// `{ status, session, faces, front_up, open_pairs, spots, opened_on }`.
fn opened_object(opened: &LayerOpened, status: &str) -> Result<Fields, JsValue> {
    Fields::new()
        .text("status", status)?
        .number("session", opened.session)?
        .number("faces", opened.faces)?
        .set("front_up", Uint8Array::from(opened.front_up.as_slice()))?
        .set(
            "open_pairs",
            Uint32Array::from(opened.open_pairs.as_slice()),
        )?
        .number("spots", opened.spots)?
        .plain("opened_on", &opened.opened_on)
}

fn restored_object(restored: &LayerRestored) -> Result<JsValue, JsValue> {
    let faces = Fields::new()
        .set("status", Uint8Array::from(restored.faces.status.as_slice()))?
        .set("face", Int32Array::from(restored.faces.face.as_slice()))?
        .set("area", Float64Array::from(restored.faces.area.as_slice()))?;
    Ok(opened_object(&restored.opened, "ok")?
        .set(
            "constraints",
            Int32Array::from(restored.constraints.as_slice()),
        )?
        .plain("outcome", &restored.outcome)?
        .set("saved_faces", faces)?
        .plain("saved_constraints", &restored.constraint_status)?
        .set(
            "saved_order",
            Uint8Array::from(restored.order_status.as_slice()),
        )?
        .plain("carried", &restored.carried)?
        .into())
}

fn previewed(previewed: Previewed) -> Result<JsValue, JsValue> {
    Ok(match previewed {
        Previewed::Fits(fit) => Fields::new()
            .text("verdict", "fits")?
            .number("token", fit.token)?
            .set(
                "changed",
                spots_changed(&fit.changed.front, &fit.changed.back)?,
            )?
            .set("stacks", sides_object(&fit.stacks)?)?
            .plain("stage", &fit.stage)?
            .number("nodes", fit.nodes as f64)?
            .into(),
        Previewed::CantFit(cant) => cant_fit(&cant)?,
        Previewed::TimedOut(out) => Fields::of(&out)?.text("verdict", "timed_out")?.into(),
    })
}

fn committed(committed: Committing) -> Result<JsValue, JsValue> {
    Ok(match committed {
        Committing::Committed(done) => Fields::new()
            .text("verdict", "committed")?
            .set(
                "changed",
                spots_changed(&done.changed.front, &done.changed.back)?,
            )?
            .set("stacks", sides_object(&done.stacks)?)?
            .set("open_pairs", Uint32Array::from(done.open_pairs.as_slice()))?
            .plain("stage", &done.stage)?
            .number("nodes", done.nodes as f64)?
            .set("adopted", JsValue::from_bool(done.adopted))?
            .into(),
        Committing::CantFit(cant) => cant_fit(&cant)?,
        Committing::TimedOut(out) => Fields::of(&out)?.text("verdict", "timed_out")?.into(),
    })
}

fn refused(refusal: &LayerRefusal) -> Result<JsValue, JsValue> {
    Ok(Fields::new()
        .text("status", "refused")?
        .plain("refusal", &refusal.to_value())?
        .into())
}

/// `{ kind, family? }`, with `faces` for a search's proof that some faces
/// have no order.
fn proof_object(proof: &CantFitKind, proof_faces: &[u32]) -> Result<Fields, JsValue> {
    let fields = Fields::of(proof)?;
    if proof_faces.is_empty() {
        Ok(fields)
    } else {
        fields.set("faces", Uint32Array::from(proof_faces))
    }
}

fn cant_fit(cant: &CantFitWire) -> Result<JsValue, JsValue> {
    Ok(Fields::new()
        .text("verdict", "cant_fit")?
        .set("proof", proof_object(&cant.proof, &cant.proof_faces)?)?
        .set("faces", Uint32Array::from(cant.faces.as_slice()))?
        .set(
            "constraints",
            Uint32Array::from(cant.constraints.as_slice()),
        )?
        .into())
}

fn stacks_object(stacks: &PackedStacks) -> Result<Fields, JsValue> {
    Fields::new()
        .set("offsets", Uint32Array::from(stacks.offsets.as_slice()))?
        .set("faces", Uint32Array::from(stacks.faces.as_slice()))
}

fn sides_object(sides: &Sides<PackedStacks>) -> Result<Fields, JsValue> {
    Fields::new()
        .set("front", stacks_object(&sides.front)?)?
        .set("back", stacks_object(&sides.back)?)
}

fn spots_changed(front: &[u32], back: &[u32]) -> Result<Fields, JsValue> {
    Fields::new()
        .set("front", Uint32Array::from(front))?
        .set("back", Uint32Array::from(back))
}

/// A call's limits, `undefined` or `null` for the defaults. A field the
/// limits have no name for is a mistake, not a default: `serde-wasm-bindgen`
/// reads only the fields a struct names, so a misspelt `deadline` would
/// otherwise leave a search with no deadline at all.
fn limits_of(value: JsValue) -> Result<LayerLimits, JsValue> {
    if value.is_undefined() || value.is_null() {
        return Ok(LayerLimits::default());
    }
    known_fields("limits", &value, &LAYER_LIMITS_FIELDS)?;
    parse("limits", value)
}

/// `value` is an object whose fields are all among `allowed`: anything
/// else is the caller's mistake (`invalid_input`), which `serde-wasm-bindgen`
/// would read as nothing.
fn known_fields(name: &str, value: &JsValue, allowed: &[&str]) -> Result<(), JsValue> {
    let Some(object) = value.dyn_ref::<Object>() else {
        return Err(thrown(LayerCallError::invalid(format!(
            "{name}: not an object"
        ))));
    };
    for key in Object::keys(object).iter() {
        let key = key.as_string().unwrap_or_default();
        if !allowed.contains(&key.as_str()) {
            return Err(thrown(LayerCallError::invalid(format!(
                "{name}: unknown field {key:?}, expected one of {allowed:?}"
            ))));
        }
    }
    Ok(())
}

/// `value` parsed, or the default when it is `undefined` or `null`.
fn optional<T: DeserializeOwned + Default>(name: &str, value: JsValue) -> Result<T, JsValue> {
    if value.is_undefined() || value.is_null() {
        Ok(T::default())
    } else {
        parse(name, value)
    }
}

fn thrown(error: LayerCallError) -> JsValue {
    js_error(error.code(), error.to_string())
}
