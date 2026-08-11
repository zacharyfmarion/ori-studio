//! Handle-based CP engine session — the shared, UI-agnostic home for the
//! crease-pattern operations that the browser (`oristudio-cp-wasm`) and desktop
//! (Tauri native commands) bridges both expose.
//!
//! Both bridges own a [`CpSession`] (the browser one in a `thread_local`, the
//! desktop one in Tauri managed `Mutex` state) and are thin marshaling wrappers
//! over these methods. Keeping the operation bodies here means web and desktop
//! cannot diverge in behavior; see
//! `implementation-plans/desktop-native-cp-engine-migration.md`.
//!
//! Documents and folded figures are held in slot arenas keyed by opaque `u32`
//! handles (matching the historical wasm bridge). Methods take and return owned,
//! `serde`-friendly types so each bridge only has to (de)serialize at its edge.

use serde::Serialize;

use crate::fold_graph::FoldGraphError;
use crate::folding::{
    AdditionalEstimationError, DisplayStyle, EstimationOrder, FoldSetupError, FoldedFigureModel,
    FoldedFigureRenderOptions, FoldedFigureRenderSnapshot, FoldedFigureSnapshot,
    FoldingEstimateError, FoldingEstimateSession, WorkerOverlapSearchError, fold_another,
    folded_figure_render_snapshot_from_session, folded_figure_snapshot_from_session,
    folding_estimate_to_case,
};
use crate::folding3d::model::Folded3dRenderModel;
use crate::folding3d::order::Advance;
use crate::folding3d::session::{Fold3dSession, Fold3dSessionError};
use crate::folding3d::snapshot::Fold3dSnapshot;
use crate::folding3d::wire::Fold3dRefusalWire;
use crate::geometry::{Circle, LineColor, LineSegment, Point};
use crate::geometry_transport::{self, CompactGeometry};
use crate::model::TextElement;
use crate::share;
use crate::{
    CommandError, CreasePatternCommand, CreasePatternCommandPayload, CreasePatternDocument,
    CreasePatternModel, OperationCategory, OperationDescriptor, OperationId, OperationOrigin,
    OperationStatus, execute_command, io, operation_descriptors, operations, preview_command,
};

/// Canonical CP engine command surface — the single source of truth for parity
/// across the wasm bridge, the native Tauri commands, and the frontend clients.
/// Each name maps to a [`CpSession`] operation. A bridge that adds or drops a
/// command without updating this list fails its parity test.
pub const CP_ENGINE_COMMANDS: &[&str] = &[
    "operation_descriptors",
    "load_cp",
    "load_fold",
    "load_fold_file",
    "load_ori",
    "load_orh",
    "load_document",
    "restore_document",
    "document_snapshot",
    "document_geometry",
    "restore_from_compact",
    "document_summary",
    "free_document",
    "execute_command",
    "preview_command",
    "insert_line_segments",
    "deselect_all",
    "import_add",
    "replace_line_segments",
    "export_cp",
    "export_fold",
    "export_fold_file",
    "export_ori",
    "export_orh",
    "export_share",
    "load_share",
    "set_texts",
    "place_circles",
    "folded_figure_fold",
    "folded_figure_fold_selected",
    "folded_figure_snapshot",
    "folded_figure_render_snapshot",
    "folded_figure_set_model",
    "folded_figure_duplicate",
    "folded_figure_fold_another",
    "folded_figure_fold_to_case",
    "folded_figure_fold_3d",
    "folded_figure_3d_fold_another",
    "folded_figure_3d_duplicate",
    "free_folded_figure",
];

/// Error envelope shared by both bridges. Serializes to `{ code, message }`,
/// the shape the frontend's `WasmErrorEnvelope` already expects.
#[derive(Debug, Clone, Serialize)]
pub struct EngineError {
    pub code: &'static str,
    pub message: String,
}

impl EngineError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid_handle(message: &'static str) -> Self {
        Self::new("invalid_handle", message)
    }

    fn invalid_input(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message)
    }
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for EngineError {}

impl From<CommandError> for EngineError {
    fn from(error: CommandError) -> Self {
        let code = match error {
            CommandError::UnsupportedOperation { .. } => "unsupported_operation",
            CommandError::NotImplemented { .. } => "not_implemented",
            CommandError::InvalidInput { .. } => "invalid_input",
        };
        Self::new(code, error.to_string())
    }
}

/// A share link that fails to decode is ordinary user input (a truncated paste,
/// a link from a newer build), not an engine fault — so it carries a code the
/// frontend can branch on rather than a generic failure.
impl From<crate::share::ShareError> for EngineError {
    fn from(error: crate::share::ShareError) -> Self {
        let code = match error {
            crate::share::ShareError::UnknownVersion(_)
            | crate::share::ShareError::UnknownCriticalExtension(_) => "share_link_too_new",
            _ => "share_link_invalid",
        };
        Self::new(code, error.to_string())
    }
}

impl From<io::IoError> for EngineError {
    fn from(error: io::IoError) -> Self {
        // A file we decline to represent is not malformed input, and the two
        // want different copy: one is "this file is broken", the other is "this
        // file is fine and we cannot open it".
        //
        // Its own code, not the shared `unsupported_operation`. That code is
        // minted by three engines for three unrelated reasons and its message is
        // whatever `Debug` printed, so the frontend cannot write copy for it
        // without writing the wrong copy for the other two. See
        // `Fold3dRefusal`'s doc for the rule: a stable code, never a sentence.
        match error {
            io::IoError::FoldedForm { .. } => Self::new("fold_folded_form", error.to_string()),
            _ => Self::invalid_input(error.to_string()),
        }
    }
}

/// Colour Oriedita itself writes for the circles it keeps — see the packing
/// circles in its bundled `default-molecules/*.fold`, which are all `"3"`.
const CIRCLE_COLOR: LineColor = LineColor::Cyan3;

/// The transform a loader applied to a file's coordinates, recovered by
/// comparing where the geometry started against where it ended up.
///
/// Recovered rather than reproduced: the importers' normalizations live in
/// `io::fold` and friends, and a second copy of that arithmetic here would be
/// free to drift from the one that actually ran. Measuring the result cannot.
///
/// Uniform and keyed on height, because that is what `import_fold_document`
/// does — it maps the source bbox's min corner onto `(-200, -200)` and scales
/// by `400 / source_height`, leaving a non-square paper wider than 400. The
/// `.cp` and `.orh` readers move nothing, which falls out as the identity.
struct SourceToDocument {
    scale: f64,
    source_min: Point,
    document_min: Point,
}

impl SourceToDocument {
    fn resolve(model: &CreasePatternModel, source_bounds: &[f64]) -> Result<Self, EngineError> {
        let source_min = Point::new(source_bounds[0], source_bounds[1]);
        let source_height = source_bounds[3] - source_bounds[1];
        if source_height <= 0.0 || !source_height.is_finite() {
            return Err(EngineError::new(
                "invalid_circles",
                "source_bounds must have a positive, finite height",
            ));
        }

        let Some(bounds) = line_segment_bounds(model) else {
            // No lines means no evidence of what the loader did. Refusing beats
            // guessing the identity: a caller in this position has handed us a
            // document that is not the one its circles belong to.
            return Err(EngineError::new(
                "invalid_circles",
                "cannot place circles on a document with no line segments",
            ));
        };

        let document_height = bounds.1.y - bounds.0.y;
        if document_height <= 0.0 {
            // Every line on one horizontal: the scale would be zero and every
            // circle would collapse onto a point. Same reasoning as above — say
            // so rather than emit degenerate geometry.
            return Err(EngineError::new(
                "invalid_circles",
                "cannot place circles on a document whose lines have no height",
            ));
        }

        Ok(Self {
            scale: document_height / source_height,
            source_min,
            document_min: bounds.0,
        })
    }

    fn point(&self, x: f64, y: f64) -> Point {
        Point::new(
            self.document_min.x + (x - self.source_min.x) * self.scale,
            self.document_min.y + (y - self.source_min.y) * self.scale,
        )
    }

    fn length(&self, value: f64) -> f64 {
        value * self.scale
    }
}

/// `(min, max)` over every line-segment endpoint, or `None` when there are none.
fn line_segment_bounds(model: &CreasePatternModel) -> Option<(Point, Point)> {
    let mut points = model
        .line_segments
        .iter()
        .flat_map(|segment| [segment.a, segment.b]);
    let first = points.next()?;
    Some(points.fold((first, first), |(min, max), point| {
        (
            Point::new(min.x.min(point.x), min.y.min(point.y)),
            Point::new(max.x.max(point.x), max.y.max(point.y)),
        )
    }))
}

impl From<FoldingEstimateError> for EngineError {
    fn from(error: FoldingEstimateError) -> Self {
        // Stable per-cause code for the UI; Debug string carries the detail.
        fn setup_code(setup: &FoldSetupError) -> &'static str {
            match setup {
                FoldSetupError::FoldGraph(FoldGraphError::DisconnectedFaces { .. }) => {
                    "fold_disconnected"
                }
                FoldSetupError::InitialHierarchy(_) => "fold_same_parity",
            }
        }
        let code = match &error {
            FoldingEstimateError::Setup(setup) => setup_code(setup),
            FoldingEstimateError::WorkerOverlap(worker) => match worker {
                WorkerOverlapSearchError::Setup(setup) => setup_code(setup),
                WorkerOverlapSearchError::AdditionalEstimation(
                    AdditionalEstimationError::Setup(setup),
                ) => setup_code(setup),
                WorkerOverlapSearchError::AdditionalEstimation(_) => "fold_contradiction",
                WorkerOverlapSearchError::SubFace(_)
                | WorkerOverlapSearchError::FinalAdditionalEstimationRequired { .. } => {
                    "fold_layer_search"
                }
            },
        };
        Self::new(code, format!("{error:?}"))
    }
}

/// A flat folded-figure estimation session plus its display model.
#[derive(Clone)]
pub struct FlatFoldedFigure {
    pub session: FoldingEstimateSession,
    pub model: FoldedFigureModel,
}

/// The expensive, stateful object behind a folded-figure handle.
///
/// One arena for both kinds, so [`CpSession::free_folded_figure`] and the
/// frontend's handle retention need no change and handle ids stay unique across
/// kinds — which is what makes a mix-up always *detectable* rather than
/// silently wrong. Every flat command applied to a spatial figure, and every
/// spatial command applied to a flat one, is a typed
/// `folded_figure_kind_mismatch` error and never a wrong answer.
#[derive(Clone)]
pub enum FoldedFigure {
    Flat(Box<FlatFoldedFigure>),
    Spatial(Box<Fold3dSession>),
}

impl FoldedFigure {
    fn kind(&self) -> &'static str {
        match self {
            Self::Flat(_) => "flat",
            Self::Spatial(_) => "spatial",
        }
    }
}

/// Static description of a CP operation (mirror of the wasm bridge's
/// `JsOperationDescriptor`).
#[derive(Debug, Clone, Serialize)]
pub struct OperationInfo {
    pub id: OperationId,
    pub upstream: &'static str,
    pub target: &'static str,
    pub category: OperationCategory,
    pub stage: u8,
    pub status: OperationStatus,
    pub origin: OperationOrigin,
}

impl From<&'static OperationDescriptor> for OperationInfo {
    fn from(descriptor: &'static OperationDescriptor) -> Self {
        Self {
            id: descriptor.id,
            upstream: descriptor.upstream,
            target: descriptor.target,
            category: descriptor.category,
            stage: descriptor.stage,
            status: descriptor.status,
            origin: descriptor.origin,
        }
    }
}

/// Counts + flags describing a document (mirror of the wasm `DocumentSummary`).
#[derive(Debug, Clone, Serialize)]
pub struct DocumentSummary {
    pub title: Option<String>,
    pub line_segments: usize,
    pub circles: usize,
    pub points: usize,
    pub aux_line_segments: usize,
    pub texts: usize,
    pub can_save_as_cp: bool,
    pub is_empty: bool,
}

/// A newly-allocated folded figure handle plus its initial snapshot.
#[derive(Debug, Clone, Serialize)]
pub struct FoldedFigureResult {
    pub handle: u32,
    pub snapshot: FoldedFigureSnapshot,
}

/// Result of a batch fold-to-case run.
#[derive(Debug, Clone, Serialize)]
pub struct FoldedFigureBatchResult {
    pub snapshot: FoldedFigureSnapshot,
    pub discovered_case_numbers: Vec<usize>,
}

/// What a 3D fold produced — a figure, or the reason there is none.
///
/// A refusal is an `Ok` **result**, never an [`EngineError`]. It does not reach
/// the store's catch path, does not raise an error toast and does not destroy
/// the draft figure, mirroring how the flat path already treats a global
/// flat-foldability contradiction. It also carries structured data
/// (`point`, `residual_degrees`, `line`) that `EngineError`'s flat `code` +
/// `message` pair cannot.
///
/// The two arms make the impossible state unrepresentable rather than guarded:
/// a refusal never carries a handle, and a placement always does.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Fold3dFoldResult {
    Placed {
        handle: u32,
        /// Boxed for size only — `Box` is transparent to `serde`, so the wire
        /// shape is the same object either way.
        snapshot: Box<Fold3dSnapshot>,
        render: Box<Folded3dRenderModel>,
    },
    Refused {
        refusal: Fold3dRefusalWire,
    },
}

/// What one press of "another solution" did to a 3D figure.
#[derive(Debug, Clone, Serialize)]
pub struct Fold3dStepResult {
    pub snapshot: Box<Fold3dSnapshot>,
    pub render: Box<Folded3dRenderModel>,
    /// `false` when the odometer wrapped back to the first solution.
    ///
    /// Carried explicitly rather than inferred. The flat path derives its wrap
    /// from `find_another_overlap_valid` flipping while the discovered count is
    /// above one; a stream over several components should not have to
    /// re-derive that from the outside.
    pub advanced: bool,
}

/// Slot-arena session holding editable documents and folded figures.
#[derive(Default)]
pub struct CpSession {
    documents: Vec<Option<CreasePatternDocument>>,
    folded_figures: Vec<Option<FoldedFigure>>,
}

impl CpSession {
    pub fn new() -> Self {
        Self::default()
    }

    // --- handle arena internals -------------------------------------------------

    fn store_document(&mut self, document: CreasePatternDocument) -> u32 {
        Self::store(&mut self.documents, document)
    }

    fn store_folded(&mut self, folded: FoldedFigure) -> u32 {
        Self::store(&mut self.folded_figures, folded)
    }

    fn store<T>(slots: &mut Vec<Option<T>>, value: T) -> u32 {
        if let Some((index, slot)) = slots.iter_mut().enumerate().find(|(_, s)| s.is_none()) {
            *slot = Some(value);
            index as u32
        } else {
            slots.push(Some(value));
            (slots.len() - 1) as u32
        }
    }

    fn document(&self, handle: u32) -> Result<&CreasePatternDocument, EngineError> {
        self.documents
            .get(handle as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| EngineError::invalid_handle("invalid CreasePatternDocument handle"))
    }

    fn document_mut(&mut self, handle: u32) -> Result<&mut CreasePatternDocument, EngineError> {
        self.documents
            .get_mut(handle as usize)
            .and_then(Option::as_mut)
            .ok_or_else(|| EngineError::invalid_handle("invalid CreasePatternDocument handle"))
    }

    fn folded(&self, handle: u32) -> Result<&FoldedFigure, EngineError> {
        self.folded_figures
            .get(handle as usize)
            .and_then(Option::as_ref)
            .ok_or_else(|| EngineError::invalid_handle("invalid folded figure handle"))
    }

    fn folded_mut(&mut self, handle: u32) -> Result<&mut FoldedFigure, EngineError> {
        self.folded_figures
            .get_mut(handle as usize)
            .and_then(Option::as_mut)
            .ok_or_else(|| EngineError::invalid_handle("invalid folded figure handle"))
    }

    fn flat(&self, handle: u32) -> Result<&FlatFoldedFigure, EngineError> {
        match self.folded(handle)? {
            FoldedFigure::Flat(figure) => Ok(figure),
            other => Err(kind_mismatch(other, "flat")),
        }
    }

    fn flat_mut(&mut self, handle: u32) -> Result<&mut FlatFoldedFigure, EngineError> {
        match self.folded_mut(handle)? {
            FoldedFigure::Flat(figure) => Ok(figure),
            other => Err(kind_mismatch(other, "flat")),
        }
    }

    fn spatial(&self, handle: u32) -> Result<&Fold3dSession, EngineError> {
        match self.folded(handle)? {
            FoldedFigure::Spatial(figure) => Ok(figure),
            other => Err(kind_mismatch(other, "spatial")),
        }
    }

    fn spatial_mut(&mut self, handle: u32) -> Result<&mut Fold3dSession, EngineError> {
        match self.folded_mut(handle)? {
            FoldedFigure::Spatial(figure) => Ok(figure),
            other => Err(kind_mismatch(other, "spatial")),
        }
    }

    // --- operation catalog ------------------------------------------------------

    pub fn operation_descriptors(&self) -> Vec<OperationInfo> {
        operation_descriptors()
            .iter()
            .map(OperationInfo::from)
            .collect()
    }

    // --- document loading / construction (allocate handles) ---------------------

    pub fn load_cp(&mut self, text: &str, title: &str) -> Result<u32, EngineError> {
        let model = io::cp::import_cp_str(text)?;
        Ok(self.store_document(document_with(model, title)))
    }

    pub fn load_fold(&mut self, text: &str, title: &str) -> Result<u32, EngineError> {
        let model = io::fold::import_fold_json(text)?;
        Ok(self.store_document(document_with(model, title)))
    }

    pub fn load_fold_file(&mut self, text: &str) -> Result<u32, EngineError> {
        let document = io::fold::import_fold_file_document_json(text)?;
        Ok(self.store_document(document))
    }

    /// Encode a document as an unpadded base64url share payload for a URL
    /// fragment. See [`crate::share`] for what does and does not travel.
    pub fn export_share(&self, handle: u32) -> Result<String, EngineError> {
        let document = self.document(handle)?;
        let payload = share::encode_share(document, share::ShareOptions::default())?;
        Ok(share::b64::encode(&payload))
    }

    /// Decode a share payload into a **new** document handle. Opening a link
    /// never mutates an existing document.
    pub fn load_share(&mut self, text: &str) -> Result<u32, EngineError> {
        let bytes = share::b64::decode(text.trim())
            .ok_or_else(|| EngineError::invalid_input("share link is not valid base64url"))?;
        let decoded = share::decode_share(&bytes)?;
        Ok(self.store_document(decoded.document))
    }

    pub fn load_ori(
        &mut self,
        text: &str,
        accept_unknown_version: bool,
    ) -> Result<u32, EngineError> {
        let document = io::ori::import_ori_json_with_unknown_version(text, accept_unknown_version)?;
        Ok(self.store_document(document))
    }

    pub fn load_orh(&mut self, text: &str) -> Result<u32, EngineError> {
        let document = io::orh::import_orh_str(text)?;
        Ok(self.store_document(document))
    }

    pub fn load_document(&mut self, document: CreasePatternDocument) -> u32 {
        self.store_document(document)
    }

    // --- document lifecycle / read ----------------------------------------------

    pub fn restore_document(
        &mut self,
        handle: u32,
        document: CreasePatternDocument,
    ) -> Result<(), EngineError> {
        *self.document_mut(handle)? = document;
        Ok(())
    }

    /// A clone of the document behind `handle` (bridges serialize it). Not the
    /// hot path — the frontend uses [`Self::document_geometry`] for that.
    pub fn document_snapshot(&self, handle: u32) -> Result<CreasePatternDocument, EngineError> {
        Ok(self.document(handle)?.clone())
    }

    pub fn document_geometry(&self, handle: u32) -> Result<CompactGeometry, EngineError> {
        Ok(geometry_transport::encode(self.document(handle)?))
    }

    pub fn restore_from_compact(
        &mut self,
        handle: u32,
        compact: &CompactGeometry,
    ) -> Result<(), EngineError> {
        let document = geometry_transport::decode(compact).map_err(EngineError::invalid_input)?;
        *self.document_mut(handle)? = document;
        Ok(())
    }

    pub fn document_summary(&self, handle: u32) -> Result<DocumentSummary, EngineError> {
        let document = self.document(handle)?;
        let model = &document.crease_pattern;
        Ok(DocumentSummary {
            title: document.title.clone(),
            line_segments: model.line_segments.len(),
            circles: model.circles.len(),
            points: model.points.len(),
            aux_line_segments: model.aux_line_segments.len(),
            texts: model.texts.len(),
            can_save_as_cp: model.can_save_as_cp(),
            is_empty: model.is_empty(),
        })
    }

    pub fn free_document(&mut self, handle: u32) -> Result<(), EngineError> {
        let slot = self
            .documents
            .get_mut(handle as usize)
            .ok_or_else(|| EngineError::invalid_handle("invalid CreasePatternDocument handle"))?;
        *slot = None;
        Ok(())
    }

    // --- editing commands -------------------------------------------------------

    pub fn execute_command(
        &mut self,
        handle: u32,
        operation: OperationId,
        payload: CreasePatternCommandPayload,
    ) -> Result<crate::CommandResult, EngineError> {
        let document = self.document_mut(handle)?;
        Ok(execute_command(
            document,
            CreasePatternCommand::new(operation).with_payload(payload),
        )?)
    }

    pub fn preview_command(
        &self,
        handle: u32,
        operation: OperationId,
        payload: CreasePatternCommandPayload,
    ) -> Result<crate::CommandPreview, EngineError> {
        let document = self.document(handle)?;
        Ok(preview_command(
            document,
            CreasePatternCommand::new(operation).with_payload(payload),
        )?)
    }

    pub fn insert_line_segments(
        &mut self,
        handle: u32,
        segments: &[LineSegment],
    ) -> Result<u32, EngineError> {
        let document = self.document_mut(handle)?;
        let changed = operations::transform::insert_line_segments(
            &mut document.crease_pattern,
            segments,
            true,
        );
        Ok(changed as u32)
    }

    pub fn deselect_all(&mut self, handle: u32) -> Result<u32, EngineError> {
        let document = self.document_mut(handle)?;
        let changed = operations::selection::unselect_all(&mut document.crease_pattern);
        Ok(changed as u32)
    }

    pub fn import_add(&mut self, handle: u32, imported_handle: u32) -> Result<u32, EngineError> {
        let imported_pattern = self.document(imported_handle)?.crease_pattern.clone();
        let document = self.document_mut(handle)?;
        operations::arrangement::import_add(&mut document.crease_pattern, &imported_pattern);
        Ok(document.crease_pattern.line_segments.len() as u32)
    }

    pub fn replace_line_segments(
        &mut self,
        handle: u32,
        line_ids: &[usize],
        segments: &[LineSegment],
    ) -> Result<u32, EngineError> {
        let document = self.document_mut(handle)?;
        let indices = resolved_line_indices(&document.crease_pattern, line_ids)?;
        let changed = operations::transform::replace_line_segments(
            &mut document.crease_pattern,
            &indices,
            segments,
        );
        Ok(changed as u32)
    }

    // --- export -----------------------------------------------------------------

    pub fn export_cp(&self, handle: u32) -> Result<String, EngineError> {
        Ok(io::cp::export_cp_string(
            &self.document(handle)?.crease_pattern,
        ))
    }

    pub fn export_fold(&self, handle: u32) -> Result<String, EngineError> {
        let document = self.document(handle)?;
        Ok(io::fold::export_fold_json(
            &document.crease_pattern,
            document.title.clone(),
        )?)
    }

    /// Export a document as a full FOLD file, with one `foldedForm` frame per
    /// 3D folded figure named in `folded_handles`.
    ///
    /// The frames are appended **after** the document merge rather than written
    /// inside it: `merge_fold_file_document` assigns `file_frames` from the
    /// imported original, so anything written earlier would be dropped on every
    /// file that came from a `.fold`.
    ///
    /// A flat handle here is a `folded_figure_kind_mismatch` rather than a
    /// silent skip — a flat figure has a folded form too, but it is the shipped
    /// wireframe rather than this one, and quietly omitting it would look like
    /// an export that lost data.
    pub fn export_fold_file(
        &self,
        handle: u32,
        folded_handles: &[u32],
    ) -> Result<String, EngineError> {
        let mut fold = io::fold::export_fold_file_document(self.document(handle)?)?;
        let mut frames = Vec::with_capacity(folded_handles.len());
        for (index, &folded) in folded_handles.iter().enumerate() {
            let session = self.spatial(folded)?;
            let title = if folded_handles.len() == 1 {
                "Folded form".to_string()
            } else {
                format!("Folded form {}", index + 1)
            };
            frames.push(
                session.folded_form_frame(Some(title)).map_err(|error| {
                    EngineError::new("folded_form_too_large", error.to_string())
                })?,
            );
        }
        io::fold::append_folded_form_frames(&mut fold, frames);
        Ok(io::fold::export_fold_file_json(&fold)?)
    }

    pub fn export_ori(&self, handle: u32) -> Result<String, EngineError> {
        Ok(io::ori::export_ori_json(self.document(handle)?)?)
    }

    pub fn export_orh(&self, handle: u32) -> Result<String, EngineError> {
        Ok(io::orh::export_orh_string(self.document(handle)?))
    }

    /// Replace the document's text elements wholesale.
    ///
    /// Rich text lives in a web-side annotation layer; the kernel `texts` vec is
    /// only the Oriedita interchange representation. The frontend flattens each
    /// rich text box to a plain `{x, y, text}` and pushes them here right before
    /// an `.ori` / `.fold` export (clearing them afterwards), and clears them (an
    /// empty call) after inflating a loaded file's texts into web-side
    /// annotations. `coords` is a flat `[x0, y0, x1, y1, ...]` paired with
    /// `texts` by index.
    pub fn set_texts(
        &mut self,
        handle: u32,
        coords: &[f64],
        texts: Vec<String>,
    ) -> Result<(), EngineError> {
        if coords.len() != texts.len() * 2 {
            return Err(EngineError::new(
                "invalid_texts",
                "coords length must be twice the number of texts",
            ));
        }
        let document = self.document_mut(handle)?;
        document.crease_pattern.texts = texts
            .into_iter()
            .enumerate()
            .map(|(i, text)| TextElement::new(coords[i * 2], coords[i * 2 + 1], text))
            .collect();
        Ok(())
    }

    /// Add circles to a document, given in the coordinate space of the file it
    /// was loaded from.
    ///
    /// This exists because a loader may move the geometry: `import_fold_document`
    /// normalizes a FOLD's line segments onto the ±200 box, while the `.cp` and
    /// `.orh` readers use their file's coordinates verbatim. A caller holding
    /// circles that belong *with* those lines — "Send to Edit (include circles)"
    /// handing over a design's packing — cannot know which happened, and should
    /// not have to. It states the bounds its own coordinates were in, and the
    /// same transform the lines underwent is recovered here by comparing those
    /// bounds against where the lines actually landed.
    ///
    /// Circles cannot ride in the file instead. Oriedita's FOLD importer reads
    /// circles and *then* moves only the line segments (`FoldImporter.toSave`
    /// calls `FoldLineSet.move`, which touches `lineSegments` alone), so a FOLD's
    /// circles are left wherever the file put them; our importer ports that quirk
    /// faithfully. `.cp` has no circle channel at all.
    ///
    /// Appends rather than replaces, so a document that already carries circles
    /// keeps them — unlike [`Self::set_texts`], whose whole job is to be the
    /// document's text layer.
    pub fn place_circles(
        &mut self,
        handle: u32,
        source_bounds: &[f64],
        coords: &[f64],
        radii: &[f64],
    ) -> Result<(), EngineError> {
        if source_bounds.len() != 4 {
            return Err(EngineError::new(
                "invalid_circles",
                "source_bounds must be [min_x, min_y, max_x, max_y]",
            ));
        }
        if coords.len() != radii.len() * 2 {
            return Err(EngineError::new(
                "invalid_circles",
                "coords length must be twice the number of radii",
            ));
        }
        if radii.is_empty() {
            return Ok(());
        }

        let document = self.document_mut(handle)?;
        let transform = SourceToDocument::resolve(&document.crease_pattern, source_bounds)?;
        for (index, radius) in radii.iter().enumerate() {
            let center = transform.point(coords[index * 2], coords[index * 2 + 1]);
            document.crease_pattern.add_circle(Circle::from_center(
                center,
                transform.length(*radius),
                CIRCLE_COLOR,
            ));
        }
        Ok(())
    }

    // --- folding ----------------------------------------------------------------

    pub fn folded_figure_fold(
        &mut self,
        document_handle: u32,
        starting_face_id: i32,
        order: EstimationOrder,
        model: FoldedFigureModel,
    ) -> Result<FoldedFigureResult, EngineError> {
        let segments = self
            .document(document_handle)?
            .crease_pattern
            .line_segments
            .clone();
        self.fold_segments(&segments, starting_face_id, order, model)
    }

    pub fn folded_figure_fold_selected(
        &mut self,
        document_handle: u32,
        selected_line_ids: &[usize],
        starting_face_id: i32,
        order: EstimationOrder,
        model: FoldedFigureModel,
    ) -> Result<FoldedFigureResult, EngineError> {
        let all_segments = &self.document(document_handle)?.crease_pattern.line_segments;
        let selected = selected_folding_segments(all_segments, selected_line_ids);
        let segments = if selected.is_empty() {
            all_segments.clone()
        } else {
            selected
        };
        self.fold_segments(&segments, starting_face_id, order, model)
    }

    fn fold_segments(
        &mut self,
        segments: &[LineSegment],
        starting_face_id: i32,
        order: EstimationOrder,
        model: FoldedFigureModel,
    ) -> Result<FoldedFigureResult, EngineError> {
        // The routing mirror, on the **post-fallback** slice.
        //
        // Both flat entry points funnel through here, and
        // `folded_figure_fold_selected` silently widens an empty resolved
        // selection to the whole document above. Guarding the pre-fallback set
        // would let a non-empty id list that resolves to nothing — a snapshot
        // that has drifted from the kernel document — fold an entire mixed
        // document flat and draw a plausible picture with no error, which is
        // exactly the case this guard exists for.
        if crate::model::has_non_classic_segments(segments) {
            return Err(EngineError::new(
                "fold_needs_3d",
                "the creases being folded include a non-180 fold angle; use folded_figure_fold_3d",
            ));
        }
        let mut session = FoldingEstimateSession::new(segments, starting_face_id);
        session.folding_estimated(order)?;
        let snapshot = folded_figure_snapshot_from_session(&session, model.clone());
        let handle = self.store_folded(FoldedFigure::Flat(Box::new(FlatFoldedFigure {
            session,
            model,
        })));
        Ok(FoldedFigureResult { handle, snapshot })
    }

    pub fn folded_figure_snapshot(&self, handle: u32) -> Result<FoldedFigureSnapshot, EngineError> {
        let folded = self.flat(handle)?;
        Ok(folded_figure_snapshot_from_session(
            &folded.session,
            folded.model.clone(),
        ))
    }

    pub fn folded_figure_render_snapshot(
        &self,
        handle: u32,
        display_style: Option<DisplayStyle>,
        options: FoldedFigureRenderOptions,
    ) -> Result<Option<FoldedFigureRenderSnapshot>, EngineError> {
        let folded = self.flat(handle)?;
        let display_style = display_style.unwrap_or(folded.session.estimate().display_style);
        Ok(folded_figure_render_snapshot_from_session(
            &folded.session,
            display_style,
            folded.model.clone(),
            options,
        )?)
    }

    pub fn folded_figure_set_model(
        &mut self,
        handle: u32,
        model: FoldedFigureModel,
    ) -> Result<FoldedFigureSnapshot, EngineError> {
        let folded = self.flat_mut(handle)?;
        folded.model = model;
        Ok(folded_figure_snapshot_from_session(
            &folded.session,
            folded.model.clone(),
        ))
    }

    pub fn folded_figure_duplicate(
        &mut self,
        handle: u32,
    ) -> Result<FoldedFigureResult, EngineError> {
        let duplicate = self.flat(handle)?.clone();
        let snapshot =
            folded_figure_snapshot_from_session(&duplicate.session, duplicate.model.clone());
        let handle = self.store_folded(FoldedFigure::Flat(Box::new(duplicate)));
        Ok(FoldedFigureResult { handle, snapshot })
    }

    pub fn folded_figure_fold_another(
        &mut self,
        handle: u32,
    ) -> Result<FoldedFigureSnapshot, EngineError> {
        let folded = self.flat_mut(handle)?;
        fold_another(&mut folded.session)?;
        Ok(folded_figure_snapshot_from_session(
            &folded.session,
            folded.model.clone(),
        ))
    }

    pub fn folded_figure_fold_to_case(
        &mut self,
        handle: u32,
        objective: usize,
        initial_order: EstimationOrder,
    ) -> Result<FoldedFigureBatchResult, EngineError> {
        let folded = self.flat_mut(handle)?;
        let batch = folding_estimate_to_case(&mut folded.session, objective, initial_order)?;
        let snapshot = folded_figure_snapshot_from_session(&folded.session, folded.model.clone());
        Ok(FoldedFigureBatchResult {
            snapshot,
            discovered_case_numbers: batch.discovered_case_numbers,
        })
    }

    // --- folding in 3D ----------------------------------------------------------

    /// Place, measure and order the selected creases in 3D.
    ///
    /// Deliberately unlike [`Self::folded_figure_fold_selected`] in one way: an
    /// empty resolved selection is an error rather than a silent widening to the
    /// whole document. The 3D path's blast radius is a whole-document fold that
    /// may refuse for reasons the user cannot connect to what they selected, and
    /// "the caller asked for nothing, so fold everything" turns a caller bug
    /// into a silent scope change.
    pub fn folded_figure_fold_3d(
        &mut self,
        document_handle: u32,
        selected_line_ids: &[usize],
        starting_face_id: i32,
        model: FoldedFigureModel,
    ) -> Result<Fold3dFoldResult, EngineError> {
        let all_segments = &self.document(document_handle)?.crease_pattern.line_segments;
        let segments = selected_folding_segments(all_segments, selected_line_ids);
        if segments.is_empty() {
            return Err(EngineError::invalid_input(
                "at least one foldable line id is required",
            ));
        }
        // The mirror of `fold_segments`' guard. Between the two, a routing
        // mistake at any of the frontend's fold doors is a loud error rather
        // than a picture computed by the wrong folder.
        if !crate::model::has_non_classic_segments(&segments) {
            return Err(EngineError::new(
                "fold_is_flat",
                "every crease being folded is a full fold; use folded_figure_fold_selected",
            ));
        }
        match Fold3dSession::new(&segments, starting_face_id, model) {
            Ok(session) => Ok(self.place_3d(session)),
            Err(Fold3dSessionError::Refused(refusal)) => Ok(Fold3dFoldResult::Refused {
                refusal: refusal.into(),
            }),
            Err(error) => Err(EngineError::new("fold_3d_failed", error.to_string())),
        }
    }

    /// Step a 3D figure to its next layer order, wrapping when exhausted.
    pub fn folded_figure_3d_fold_another(
        &mut self,
        handle: u32,
    ) -> Result<Fold3dStepResult, EngineError> {
        let session = self.spatial_mut(handle)?;
        let advance = session
            .advance()
            .map_err(|error| EngineError::new("fold_3d_failed", error.to_string()))?;
        Ok(Fold3dStepResult {
            snapshot: Box::new(session.snapshot()),
            render: Box::new(session.render_model().clone()),
            advanced: advance == Advance::Next,
        })
    }

    /// Copy a 3D figure, including where it sits in its solution stream.
    ///
    /// The duplicate shows the **same** solution the original was showing and
    /// cycles independently from there — the property a shared handle would
    /// break.
    pub fn folded_figure_3d_duplicate(
        &mut self,
        handle: u32,
    ) -> Result<Fold3dFoldResult, EngineError> {
        let duplicate = self.spatial(handle)?.clone();
        Ok(self.place_3d(duplicate))
    }

    fn place_3d(&mut self, session: Fold3dSession) -> Fold3dFoldResult {
        let snapshot = Box::new(session.snapshot());
        let render = Box::new(session.render_model().clone());
        let handle = self.store_folded(FoldedFigure::Spatial(Box::new(session)));
        Fold3dFoldResult::Placed {
            handle,
            snapshot,
            render,
        }
    }

    pub fn free_folded_figure(&mut self, handle: u32) -> Result<(), EngineError> {
        let slot = self
            .folded_figures
            .get_mut(handle as usize)
            .ok_or_else(|| EngineError::invalid_handle("invalid folded figure handle"))?;
        *slot = None;
        Ok(())
    }
}

/// A flat command on a spatial figure, or the reverse.
///
/// A stable code, so the frontend can distinguish "you asked the wrong engine"
/// from "the engine could not answer" without parsing a sentence.
fn kind_mismatch(figure: &FoldedFigure, wanted: &'static str) -> EngineError {
    EngineError::new(
        "folded_figure_kind_mismatch",
        format!(
            "folded figure is {}, but this command needs a {wanted} one",
            figure.kind()
        ),
    )
}

fn document_with(model: CreasePatternModel, title: &str) -> CreasePatternDocument {
    CreasePatternDocument {
        title: title_from(title),
        crease_pattern: model,
        operation_frame: Default::default(),
        metadata: Default::default(),
    }
}

fn title_from(title: &str) -> Option<String> {
    let title = title.trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_owned())
    }
}

fn selected_folding_segments(
    segments: &[LineSegment],
    selected_line_ids: &[usize],
) -> Vec<LineSegment> {
    if selected_line_ids.is_empty() {
        return Vec::new();
    }
    segments
        .iter()
        .enumerate()
        .filter(|(index, segment)| {
            segment.color.is_folding_line() && selected_line_ids.contains(&(index + 1))
        })
        .map(|(_, segment)| segment.clone())
        .collect()
}

fn resolved_line_indices(
    model: &CreasePatternModel,
    line_ids: &[usize],
) -> Result<Vec<usize>, EngineError> {
    if line_ids.is_empty() {
        return Err(EngineError::invalid_input(
            "at least one line id is required",
        ));
    }
    let mut indices = Vec::with_capacity(line_ids.len());
    for id in line_ids {
        let Some(index) = id.checked_sub(1) else {
            return Err(EngineError::invalid_input("line ids are one-based"));
        };
        if index >= model.line_segments.len() {
            return Err(EngineError::invalid_input("line id is out of range"));
        }
        indices.push(index);
    }
    indices.sort_unstable();
    indices.dedup();
    Ok(indices)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folding::InitialHierarchyError;

    const SQUARE_CP: &str =
        "2 0.0 0.0 1.0 0.0\n2 1.0 0.0 1.0 1.0\n2 1.0 1.0 0.0 1.0\n2 0.0 1.0 0.0 0.0\n";

    #[test]
    fn load_and_summary_round_trip() {
        let mut session = CpSession::new();
        let handle = session.load_cp(SQUARE_CP, "square").expect("load cp");
        let summary = session.document_summary(handle).expect("summary");
        assert_eq!(summary.title.as_deref(), Some("square"));
        assert_eq!(summary.line_segments, 4);
        assert!(!summary.is_empty);
    }

    #[test]
    fn geometry_round_trips_through_compact() {
        let mut session = CpSession::new();
        let handle = session.load_cp(SQUARE_CP, "").expect("load cp");
        let geometry = session.document_geometry(handle).expect("geometry");
        // Restoring the same compact geometry keeps the document intact.
        session
            .restore_from_compact(handle, &geometry)
            .expect("restore");
        assert_eq!(session.document_summary(handle).unwrap().line_segments, 4);
    }

    #[test]
    fn export_cp_round_trips() {
        let mut session = CpSession::new();
        let handle = session.load_cp(SQUARE_CP, "").expect("load cp");
        let exported = session.export_cp(handle).expect("export");
        let reloaded = session.load_cp(&exported, "").expect("reload exported cp");
        assert_eq!(session.document_summary(reloaded).unwrap().line_segments, 4);
    }

    #[test]
    fn invalid_handle_is_reported() {
        let session = CpSession::new();
        let error = session.document_summary(99).expect_err("invalid handle");
        assert_eq!(error.code, "invalid_handle");
    }

    #[test]
    fn free_document_invalidates_the_handle() {
        let mut session = CpSession::new();
        let handle = session.load_cp(SQUARE_CP, "").expect("load cp");
        session.free_document(handle).expect("free");
        assert!(session.document_summary(handle).is_err());
    }

    #[test]
    fn operation_catalog_is_non_empty() {
        let session = CpSession::new();
        assert!(!session.operation_descriptors().is_empty());
    }

    /// The frontend branches on `code`, so a disconnected fold graph has to be
    /// distinguishable from a parity abort and from a layer-ordering
    /// contradiction — all three used to be reachable only as `fold_same_parity`
    /// or nothing at all.
    #[test]
    fn a_disconnected_fold_graph_carries_its_own_engine_code() {
        let disconnected = EngineError::from(FoldingEstimateError::Setup(
            FoldSetupError::FoldGraph(FoldGraphError::DisconnectedFaces {
                reached: 225,
                unreached: 1,
            }),
        ));
        assert_eq!(disconnected.code, "fold_disconnected");

        let parity = EngineError::from(FoldingEstimateError::Setup(
            FoldSetupError::InitialHierarchy(InitialHierarchyError::SameParityAdjacentFaces {
                line: 0,
                first_face: 0,
                second_face: 1,
            }),
        ));
        assert_eq!(parity.code, "fold_same_parity");

        let contradiction = EngineError::from(FoldingEstimateError::WorkerOverlap(
            WorkerOverlapSearchError::AdditionalEstimation(
                AdditionalEstimationError::Contradiction {
                    upper_face: 0,
                    lower_face: 1,
                },
            ),
        ));
        assert_eq!(contradiction.code, "fold_contradiction");
    }

    /// A folded form is refused with a code of its own, not the shared
    /// `unsupported_operation`.
    ///
    /// Three engines mint `unsupported_operation` for three unrelated reasons
    /// and its message is whatever `Debug` printed, so a frontend case for it
    /// would be wrong for two of the three. Both signals in
    /// `reject_unrepresentable_geometry` are one fact about the file and share
    /// one code, which is what `humanizeError`'s single case is keyed on.
    #[test]
    fn a_folded_form_import_carries_its_own_engine_code() {
        for what in [
            "FOLD folded-form frames",
            "FOLD geometry outside the paper plane",
        ] {
            let error = EngineError::from(io::IoError::FoldedForm {
                what,
                detail: String::new(),
            });
            assert_eq!(error.code, "fold_folded_form");
        }

        // Everything else the importer can say is still ordinary bad input.
        let malformed = EngineError::from(io::IoError::InvalidField {
            field: "vertices_coords",
            message: "not an array".to_string(),
        });
        assert_ne!(malformed.code, "fold_folded_form");
    }

    /// A FOLD on a 1x1 paper: the importer scales it by 400 and recentres it on
    /// the origin, and a circle stated in the *paper's* coordinates has to make
    /// the same trip. This is the TreeMaker send in miniature.
    #[test]
    fn place_circles_follows_the_fold_importers_normalization() {
        let mut session = CpSession::new();
        let handle = session
            .load_fold(
                r#"{"vertices_coords":[[0,0],[1,0],[1,1],[0,1]],
                    "edges_vertices":[[0,1],[1,2],[2,3],[3,0]],
                    "edges_assignment":["B","B","B","B"]}"#,
                "",
            )
            .expect("load fold");

        // Centre of the paper, a quarter of its width across.
        session
            .place_circles(handle, &[0.0, 0.0, 1.0, 1.0], &[0.5, 0.5], &[0.25])
            .expect("place circles");

        let circles = &session.document(handle).unwrap().crease_pattern.circles;
        assert_eq!(circles.len(), 1);
        assert!((circles[0].x - 0.0).abs() < 1e-9);
        assert!((circles[0].y - 0.0).abs() < 1e-9);
        assert!((circles[0].r - 100.0).abs() < 1e-9);
        assert_eq!(circles[0].color, LineColor::Cyan3);
    }

    /// The `.cp` reader moves nothing, so a circle stated in the file's own
    /// coordinates must land exactly where it was stated. This is the BP send.
    #[test]
    fn place_circles_is_the_identity_when_the_loader_moved_nothing() {
        let mut session = CpSession::new();
        let handle = session.load_cp(SQUARE_CP, "").expect("load cp");

        session
            .place_circles(handle, &[0.0, 0.0, 1.0, 1.0], &[0.25, 0.75], &[0.1])
            .expect("place circles");

        let circles = &session.document(handle).unwrap().crease_pattern.circles;
        assert!((circles[0].x - 0.25).abs() < 1e-9);
        assert!((circles[0].y - 0.75).abs() < 1e-9);
        assert!((circles[0].r - 0.1).abs() < 1e-9);
    }

    /// Existing circles survive. A document loaded from a file that carried its
    /// own circles must not lose them to a design's packing.
    #[test]
    fn place_circles_appends_rather_than_replacing() {
        let mut session = CpSession::new();
        let handle = session.load_cp(SQUARE_CP, "").expect("load cp");
        session
            .document_mut(handle)
            .unwrap()
            .crease_pattern
            .add_circle(Circle::new(9.0, 9.0, 1.0, LineColor::Magenta5));

        session
            .place_circles(handle, &[0.0, 0.0, 1.0, 1.0], &[0.5, 0.5], &[0.2])
            .expect("place circles");

        let circles = &session.document(handle).unwrap().crease_pattern.circles;
        assert_eq!(circles.len(), 2);
        assert_eq!(circles[0].color, LineColor::Magenta5);
    }

    #[test]
    fn place_circles_accepts_an_empty_list() {
        let mut session = CpSession::new();
        let handle = session.load_cp(SQUARE_CP, "").expect("load cp");
        session
            .place_circles(handle, &[0.0, 0.0, 1.0, 1.0], &[], &[])
            .expect("empty is a no-op");
        assert!(
            session
                .document(handle)
                .unwrap()
                .crease_pattern
                .circles
                .is_empty()
        );
    }

    #[test]
    fn place_circles_rejects_malformed_input() {
        let mut session = CpSession::new();
        let handle = session.load_cp(SQUARE_CP, "").expect("load cp");

        // One radius needs two coordinates.
        let error = session
            .place_circles(handle, &[0.0, 0.0, 1.0, 1.0], &[0.5], &[0.2])
            .expect_err("mismatched lengths");
        assert_eq!(error.code, "invalid_circles");

        let error = session
            .place_circles(handle, &[0.0, 0.0, 1.0], &[0.5, 0.5], &[0.2])
            .expect_err("bounds must be four numbers");
        assert_eq!(error.code, "invalid_circles");

        // A zero-height source gives no scale to recover.
        let error = session
            .place_circles(handle, &[0.0, 0.0, 1.0, 0.0], &[0.5, 0.5], &[0.2])
            .expect_err("degenerate bounds");
        assert_eq!(error.code, "invalid_circles");
    }

    /// With no lines there is no evidence of what the loader did, so refusing
    /// beats silently assuming the identity and putting circles somewhere wrong.
    #[test]
    fn place_circles_refuses_a_document_with_no_lines() {
        let mut session = CpSession::new();
        let handle = session.load_document(CreasePatternDocument::default());

        let error = session
            .place_circles(handle, &[0.0, 0.0, 1.0, 1.0], &[0.5, 0.5], &[0.2])
            .expect_err("no lines to measure against");
        assert_eq!(error.code, "invalid_circles");
    }

    #[test]
    fn place_circles_rejects_an_invalid_handle() {
        let mut session = CpSession::new();
        let error = session
            .place_circles(99, &[0.0, 0.0, 1.0, 1.0], &[0.5, 0.5], &[0.2])
            .expect_err("invalid handle");
        assert_eq!(error.code, "invalid_handle");
    }
}
