//! Import CP (plan D16, D10's inverse): a crease pattern from a file, from
//! Edit or from a sample becomes a state, its layer order completed from its
//! letters.
//!
//! 1. Find the sheet from the border: one closed loop, a square or a
//!    rectangle (V0), matched against the sequence's sheet or adopted by an
//!    empty sequence (`placement`).
//! 2. Map the kinds (D10's inverse): B, M and V keep; unassigned with a hint
//!    X is a precrease remembering X; unassigned without one is folded, its
//!    letter decided by the completion (Edit does not fold unassigned lines;
//!    Fold does); crease marks stay flat beside the graph, and aux annotations
//!    remain guides. Edit's cyan/F lines arrive as crease marks.
//! 3. Build the planar graph and its convex faces (`arrangement`), refusing a
//!    crease that is no full chord of its face, and a pattern of more faces
//!    than the layer order's cap (`oristudio_layer_order::MAX_FACES`): its
//!    tables grow with the square of the faces, so the cap is checked before
//!    anything is derived from them.
//! 4. Derive the isometries from a root, the folded view and its constraints
//!    ([`Unordered`]), refusing a pattern whose layers stack too deeply for
//!    their order to be worked out (`oristudio_layer_order::MAX_STACKED_TRIPLES`)
//!    as soon as its overlaps are counted, before its constraints and its
//!    completion.
//! 5. Complete the order seeded by the imported letters
//!    ([`ImportedPattern::complete`]): a true ‹ n of m ›, since the
//!    constraints are Fold's own (D8). Every order offered reproduces the
//!    imported letters; the one picked is stored by witnesses
//!    ([`WitnessOrder::of_state`], the step's `orderJson`) and replayed with
//!    [`ImportedPattern::replay`].
//!
//! The kernel's loaders (`.cp`, `.fold`, `.ori`, `.orh`) stay behind the
//! bridge; this module takes plain segments, so it needs no kernel.
//!
//! # Orientation and placement
//!
//! - The pattern's front is the sheet's front, whatever the sequence's start
//!   side: the letters keep their meaning.
//! - The frame is the one the outline code chooses. A rectangle that fits the
//!   sequence's sheet only turned is turned a quarter, counter-clockwise, and
//!   the summary says so.
//! - The state keeps the current view. Its root is the face containing the
//!   previous root's witness, at the previous root's isometry, so the model
//!   does not jump.
//!
//! Refusals name points in the input's coordinates, so they can be marked on
//! the pattern as its file draws it.

pub(crate) mod arrangement;
mod placement;

use oristudio_geometry::RefusalReason;
use oristudio_geometry::convex;
use oristudio_layer_order::{LayerOrder, LayerOrderError, MAX_FACES, OrieditaRelation};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::complete::{
    BudgetLimit, ChoiceCount, CompletionLimits, CompletionRefusal, CompletionSession, Completions,
    FixedKind, FixedPair,
};
use crate::crease_marks::{self, CreaseMark};
use crate::isometry::Isometry;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{Crease, CreaseKind, EdgeId, Face, FaceId, Letter, VertexId};
use crate::refusal::FoldRefusal;
use crate::sheet::{Sheet, SheetShape};
use crate::state::{State, StateParts};
use crate::unordered::Unordered;
use crate::view::{StartSide, View};
use crate::witness::{Broken, WitnessOrder};

use arrangement::{Kind, Placed};
use placement::{Placement, Recovered};

type Point = [f64; 2];

/// The coordinates an input's segments are in. Either way, any placement,
/// rotation and scale: the border fixes the sheet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportSpace {
    /// y-up, as the sheet frame and FOLD files are.
    Sheet,
    /// Oriedita's model space, y-down: the kernel's coordinates.
    Model,
}

/// What an imported segment is: the kernel's colours and direction hint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ImportKind {
    Border,
    Mountain,
    Valley,
    /// Neither: a precrease remembering `hint` when it has one, otherwise a
    /// fold whose letter the completion decides.
    Unassigned {
        #[serde(default)]
        hint: Option<Letter>,
    },
    /// A flat precrease that need not bound a face (it may end inside paper).
    /// Unlike an unassigned hinge, it never participates in layer completion.
    CreaseMark {
        letter: Letter,
    },
    /// An auxiliary line: a guide, never a crease.
    Aux,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImportSegment {
    pub from: Point,
    pub to: Point,
    #[serde(flatten)]
    pub kind: ImportKind,
}

/// A crease pattern to import, with no kernel types.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreasePatternInput {
    pub space: ImportSpace,
    pub segments: Vec<ImportSegment>,
}

impl CreasePatternInput {
    /// A state's crease pattern as an import reads it back, in sheet
    /// coordinates: B, M and V as they are, and F remembering X as
    /// unassigned with hint X (D10). Importing it gives back the state's
    /// creases and faces.
    pub fn of_state(state: &State) -> CreasePatternInput {
        let segments = state
            .creases()
            .iter()
            .map(|c| {
                let [from, to] = c.vertices.map(|v| state.vertices()[v.index()]);
                let kind = match c.kind {
                    CreaseKind::Border => ImportKind::Border,
                    CreaseKind::Folded(Letter::Mountain) => ImportKind::Mountain,
                    CreaseKind::Folded(Letter::Valley) => ImportKind::Valley,
                    CreaseKind::Flat(letter) => ImportKind::Unassigned { hint: Some(letter) },
                };
                ImportSegment { from, to, kind }
            })
            .chain(state.crease_marks().iter().map(|m| ImportSegment {
                from: m.a,
                to: m.b,
                kind: ImportKind::CreaseMark { letter: m.letter },
            }))
            .collect();
        CreasePatternInput {
            space: ImportSpace::Sheet,
            segments,
        }
    }
}

/// Where an import lands.
#[derive(Debug, Clone, Copy)]
pub enum ImportTarget<'a> {
    /// A sequence with no steps: it adopts the pattern's square or
    /// rectangle, seen from `start` as its flat sheet would be.
    Empty { start: StartSide },
    /// A sequence whose current state is this one: the pattern must fit its
    /// sheet; the view is kept and the root continues (plan D16).
    After(&'a State),
}

impl ImportTarget<'_> {
    fn sheet(&self) -> Option<&Sheet> {
        match self {
            ImportTarget::Empty { .. } => None,
            ImportTarget::After(state) => Some(state.sheet()),
        }
    }

    fn view(&self) -> View {
        match self {
            ImportTarget::Empty { start } => View::starting(*start),
            ImportTarget::After(state) => state.view(),
        }
    }

    fn step(&self) -> u32 {
        match self {
            ImportTarget::Empty { .. } => 1,
            ImportTarget::After(state) => state.step() + 1,
        }
    }

    /// A sheet point on the root and the isometry it keeps.
    fn anchor(&self, sheet: &Sheet) -> (Point, Isometry) {
        let [x0, y0, x1, y1] = convex::bounding_box(sheet.outline());
        let centre = [(x0 + x1) / 2.0, (y0 + y1) / 2.0];
        match self {
            ImportTarget::Empty { .. } => (centre, Isometry::IDENTITY),
            ImportTarget::After(state) => (
                state.face_witness(state.root()).unwrap_or(centre),
                state.isometry(state.root()).unwrap_or_default(),
            ),
        }
    }
}

/// Which shape V0 cannot import.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "source")]
pub enum UnsupportedShape {
    /// The pattern's border is a closed loop but no rectangle: its corners.
    Pattern { corners: Vec<Point> },
    /// The sequence's sheet is neither a square nor a rectangle.
    Sequence,
}

/// Everything Import CP refuses. Points are in the input's coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(tag = "code")]
pub enum ImportRefusal {
    #[serde(rename = "import_not_finite")]
    #[error("segment {segment} has a coordinate that is not finite")]
    NotFinite { segment: usize },
    #[serde(rename = "import_no_border")]
    #[error("the crease pattern has no border")]
    NoBorder,
    #[serde(rename = "import_outline_loops")]
    #[error("the border makes {count} loops; a sheet is one")]
    OutlineLoops { count: usize },
    #[serde(rename = "import_outline_invalid")]
    #[error("the border is not one simple closed loop")]
    OutlineInvalid { reason: RefusalReason },
    #[serde(rename = "import_shape_unsupported")]
    #[error("only square and rectangle sheets can be imported")]
    ShapeUnsupported { which: UnsupportedShape },
    /// Widths and heights with the longer side 1.
    #[serde(rename = "import_shape_mismatch")]
    #[error("the pattern's sheet is {found:?}, the sequence's {expected:?}")]
    ShapeMismatch { expected: [f64; 2], found: [f64; 2] },
    #[serde(rename = "import_crease_off_sheet")]
    #[error("segment {segment} leaves the sheet at {point:?}")]
    CreaseOffSheet { segment: usize, point: Point },
    #[serde(rename = "import_conflicting_creases")]
    #[error("segments {segments:?} lie on each other with different kinds")]
    ConflictingCreases { segments: [usize; 2], point: Point },
    #[serde(rename = "import_crease_not_chord")]
    #[error("segment {segment} ends inside the paper at {point:?}")]
    CreaseNotChord {
        segment: usize,
        kind: ImportKind,
        point: Point,
    },
    #[serde(rename = "import_disconnected_creases")]
    #[error("creases near {point:?} touch neither the border nor another crease")]
    DisconnectedCreases { point: Point },
    #[serde(rename = "import_non_convex_face")]
    #[error("a face has a reflex corner at {point:?}")]
    NonConvexFace { point: Point },
    /// More faces than Fold folds (`oristudio_layer_order::MAX_FACES`):
    /// refused as soon as the faces are counted, before anything is derived
    /// from them.
    #[serde(rename = "import_too_many_faces")]
    #[error("the crease pattern has {face_count} faces, over the {limit} cap")]
    TooManyFaces { face_count: usize, limit: usize },
    /// Layers stacked too deeply for Fold to work out their order
    /// (`oristudio_layer_order::MAX_STACKED_TRIPLES`): refused as soon as
    /// the folded faces' overlaps are known, before any constraint or order.
    #[serde(rename = "import_stacked_too_deep")]
    #[error(
        "the crease pattern stacks up to {deepest} layers deep, {triples} overlapping triples over the {limit} cap"
    )]
    StackedTooDeep {
        deepest: usize,
        triples: u64,
        limit: u64,
    },
    /// The pattern does not fold flat with its kinds: a vertex lands in two
    /// places, a hinge has the wrong orientations, or the folded image is
    /// malformed. `points` are the vertices and face witnesses it names.
    #[serde(rename = "import_not_flat_foldable")]
    #[error("the crease pattern does not fold flat: {refusal}")]
    NotFlatFoldable {
        refusal: FoldRefusal,
        points: Vec<Point>,
    },
    #[serde(rename = "import_ambiguous_overlap")]
    #[error("faces overlap by less than the tolerance can decide")]
    AmbiguousOverlap { points: Vec<Point> },
    /// No layer order agrees with the letters (and the other fixed orders).
    #[serde(rename = "import_no_order")]
    #[error("no layer order fits: {refusal}")]
    NoOrder {
        refusal: CompletionRefusal,
        points: Vec<Point>,
    },
    #[serde(rename = "import_budget_exceeded")]
    #[error("the layer-order search hit its {limit:?} budget after {nodes} nodes")]
    BudgetExceeded { limit: BudgetLimit, nodes: u64 },
    /// Edit's relations leave more than one order.
    #[serde(rename = "import_order_open")]
    #[error("the relations leave {} order(s), not one", orders.orders)]
    OrderOpen { orders: ChoiceCount },
    #[serde(rename = "import_witness_not_in_face")]
    #[error("{point:?} lies in no face of the pattern")]
    WitnessNotInFace { point: Point },
    #[serde(rename = "import_relation_one_face")]
    #[error("a relation names one face twice")]
    RelationOneFace { points: [Point; 2] },
    /// A defect, never the input's fault.
    #[serde(rename = "import_internal")]
    #[error("internal error: {message}")]
    Internal { message: String },
}

impl ImportRefusal {
    /// The stable snake_case code, the serialized tag.
    pub fn code(&self) -> &'static str {
        match self {
            ImportRefusal::NotFinite { .. } => "import_not_finite",
            ImportRefusal::NoBorder => "import_no_border",
            ImportRefusal::OutlineLoops { .. } => "import_outline_loops",
            ImportRefusal::OutlineInvalid { .. } => "import_outline_invalid",
            ImportRefusal::ShapeUnsupported { .. } => "import_shape_unsupported",
            ImportRefusal::ShapeMismatch { .. } => "import_shape_mismatch",
            ImportRefusal::CreaseOffSheet { .. } => "import_crease_off_sheet",
            ImportRefusal::ConflictingCreases { .. } => "import_conflicting_creases",
            ImportRefusal::CreaseNotChord { .. } => "import_crease_not_chord",
            ImportRefusal::DisconnectedCreases { .. } => "import_disconnected_creases",
            ImportRefusal::NonConvexFace { .. } => "import_non_convex_face",
            ImportRefusal::TooManyFaces { .. } => "import_too_many_faces",
            ImportRefusal::StackedTooDeep { .. } => "import_stacked_too_deep",
            ImportRefusal::NotFlatFoldable { .. } => "import_not_flat_foldable",
            ImportRefusal::AmbiguousOverlap { .. } => "import_ambiguous_overlap",
            ImportRefusal::NoOrder { .. } => "import_no_order",
            ImportRefusal::BudgetExceeded { .. } => "import_budget_exceeded",
            ImportRefusal::OrderOpen { .. } => "import_order_open",
            ImportRefusal::WitnessNotInFace { .. } => "import_witness_not_in_face",
            ImportRefusal::RelationOneFace { .. } => "import_relation_one_face",
            ImportRefusal::Internal { .. } => "import_internal",
        }
    }

    /// The same refusal with its sheet points mapped by `f`.
    fn map_points(self, f: impl Fn(Point) -> Point) -> ImportRefusal {
        match self {
            ImportRefusal::CreaseOffSheet { segment, point } => ImportRefusal::CreaseOffSheet {
                segment,
                point: f(point),
            },
            ImportRefusal::ConflictingCreases { segments, point } => {
                ImportRefusal::ConflictingCreases {
                    segments,
                    point: f(point),
                }
            }
            ImportRefusal::CreaseNotChord {
                segment,
                kind,
                point,
            } => ImportRefusal::CreaseNotChord {
                segment,
                kind,
                point: f(point),
            },
            ImportRefusal::DisconnectedCreases { point } => {
                ImportRefusal::DisconnectedCreases { point: f(point) }
            }
            ImportRefusal::NonConvexFace { point } => {
                ImportRefusal::NonConvexFace { point: f(point) }
            }
            other => other,
        }
    }
}

/// What an import found, for the step's summary and the UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportSummary {
    /// The sheet: the sequence's, or the pattern's for an empty sequence,
    /// which adopts it.
    pub shape: SheetShape,
    /// The pattern was turned a quarter, counter-clockwise, to fit.
    pub quarter_turn: bool,
    pub faces: usize,
    pub mountains: usize,
    pub valleys: usize,
    pub precreases: usize,
    /// Folded creases whose letter the completion decides.
    pub unknown_letters: usize,
    /// Aux lines in sheet coordinates, for the caller to keep as marks or
    /// drop.
    pub guides: Vec<[Point; 2]>,
    /// Segments, or pieces of them, that added nothing.
    pub dropped: usize,
}

/// An imported crease pattern, checked up to its layer order.
#[derive(Debug, Clone)]
pub struct ImportedPattern {
    unordered: Unordered,
    placement: Placement,
    summary: ImportSummary,
}

/// The sheet a crease pattern's border outlines, for a sequence to start
/// from ("Import starting sheet"): a square, a rectangle, or any other outline
/// as a polygon in the unit sheet frame, validated as a sheet the engine
/// folds — convex, no side shorter than the minimum feature
/// ([`Sheet::new`]). Only the border is read; the creases are left alone,
/// so a pattern that does not fold flat still gives its sheet.
pub fn starting_sheet(
    input: &CreasePatternInput,
) -> Result<Result<SheetShape, FoldRefusal>, ImportRefusal> {
    if let Some(segment) = input
        .segments
        .iter()
        .position(|s| s.from.iter().chain(&s.to).any(|c| !c.is_finite()))
    {
        return Err(ImportRefusal::NotFinite { segment });
    }
    let shape = placement::starting_sheet(input)?;
    Ok(Sheet::new(&shape).map(|sheet| match shape {
        // As the sheet stores it: counter-clockwise.
        SheetShape::Polygon { .. } => SheetShape::Polygon {
            points: sheet.outline().to_vec(),
        },
        other => other,
    }))
}

impl ImportedPattern {
    /// Recover the sheet, build the faces and derive everything but the
    /// order.
    pub fn new(
        input: &CreasePatternInput,
        target: ImportTarget<'_>,
    ) -> Result<ImportedPattern, ImportRefusal> {
        if let Some(segment) = input
            .segments
            .iter()
            .position(|s| s.from.iter().chain(&s.to).any(|c| !c.is_finite()))
        {
            return Err(ImportRefusal::NotFinite { segment });
        }
        let Recovered {
            placement,
            sheet,
            shape,
        } = placement::recover(input, target.sheet())?;
        let mut placed = Vec::new();
        let mut guides = Vec::new();
        let mut marks = Vec::new();
        for (segment, s) in input.segments.iter().enumerate() {
            let ends = [placement.to_sheet(s.from), placement.to_sheet(s.to)];
            if let ImportKind::CreaseMark { letter } = s.kind {
                // Flat ink outside the recovered sheet carries no paper. Clip
                // it here; active creases still use the strict chord checks.
                if let Some([u0, u1]) = crease_marks::span_inside(ends[0], ends[1], sheet.outline())
                {
                    let mark = CreaseMark {
                        a: ends[0],
                        b: ends[1],
                        letter,
                        // Existing flat lines, not M/V instructions made by
                        // this collapse. Their original folding date is unknown.
                        made_at: 0,
                    };
                    let mark = CreaseMark {
                        a: mark.at(u0),
                        b: mark.at(u1),
                        ..mark
                    };
                    if mark.length() >= MIN_FEATURE {
                        marks = crease_marks::add(&marks, vec![mark]);
                    }
                }
                continue;
            }
            match Kind::of(s.kind) {
                Some(kind) => placed.push(Placed {
                    ends,
                    kind,
                    segment,
                }),
                None => guides.push(ends),
            }
        }
        let arrangement = arrangement::arrange(&placed, &sheet)
            .map_err(|r| r.map_points(|p| placement.to_input(p)))?;
        if arrangement.faces.len() > MAX_FACES {
            return Err(ImportRefusal::TooManyFaces {
                face_count: arrangement.faces.len(),
                limit: MAX_FACES,
            });
        }

        let step = target.step();
        let mut summary = ImportSummary {
            shape,
            quarter_turn: placement.quarter_turn(),
            faces: arrangement.faces.len(),
            mountains: 0,
            valleys: 0,
            precreases: 0,
            unknown_letters: 0,
            guides,
            dropped: arrangement.dropped,
        };
        let mut unknown = Vec::new();
        let creases: Vec<Crease> = arrangement
            .edges
            .iter()
            .enumerate()
            .map(|(k, e)| {
                let id = EdgeId(k as u32);
                let kind = match e.kind {
                    Kind::Border => CreaseKind::Border,
                    Kind::Folded(Some(letter)) => {
                        match letter {
                            Letter::Mountain => summary.mountains += 1,
                            Letter::Valley => summary.valleys += 1,
                        }
                        CreaseKind::Folded(letter)
                    }
                    // A placeholder: the order decides.
                    Kind::Folded(None) => {
                        summary.unknown_letters += 1;
                        unknown.push(id);
                        CreaseKind::Folded(Letter::Valley)
                    }
                    Kind::Flat(letter) => {
                        summary.precreases += 1;
                        CreaseKind::Flat(letter)
                    }
                };
                Crease {
                    id,
                    vertices: e.ends.map(|v| VertexId(v as u32)),
                    kind,
                    made_at: if kind == CreaseKind::Border { 0 } else { step },
                }
            })
            .collect();
        // Active creases and the border own any coincident stretch. Deduplicate
        // first, then merge split export fragments so import is idempotent.
        marks = crease_marks::carry(&marks, &arrangement.vertices, &creases);
        marks.retain(|m| {
            !creases.iter().any(|c| {
                c.kind == CreaseKind::Border && {
                    let [a, b] = c.vertices.map(|v| arrangement.vertices[v.index()]);
                    crease_marks::covered(m, a, b).is_some()
                }
            })
        });
        marks = crease_marks::merge(marks);
        summary.precreases += marks.len();
        let faces: Vec<Face> = arrangement
            .faces
            .iter()
            .enumerate()
            .map(|(f, ring)| Face {
                id: FaceId(f as u32),
                ring: ring.iter().map(|&v| VertexId(v as u32)).collect(),
                parent: None,
                born: step,
            })
            .collect();
        let (anchor, root_isometry) = target.anchor(&sheet);
        let root = root_face(&arrangement, anchor);
        let parts = StateParts {
            sheet,
            vertices: arrangement.vertices,
            creases,
            faces,
            root: FaceId(root as u32),
            root_isometry,
            order: LayerOrder::new(),
            view: target.view(),
            step,
            marks,
        };
        let unordered = Unordered::new(parts.clone(), unknown)
            .map_err(|refusal| not_flat_foldable(refusal, &parts, &placement))?;
        Ok(ImportedPattern {
            unordered,
            placement,
            summary,
        })
    }

    pub fn summary(&self) -> &ImportSummary {
        &self.summary
    }

    pub fn sheet(&self) -> &Sheet {
        &self.unordered.parts().sheet
    }

    /// The parts, view and constraint problem, before the order.
    pub fn unordered(&self) -> &Unordered {
        &self.unordered
    }

    /// An input point in sheet coordinates.
    pub fn to_sheet(&self, p: Point) -> Point {
        self.placement.to_sheet(p)
    }

    /// A sheet point in the input's coordinates.
    pub fn to_input(&self, p: Point) -> Point {
        self.placement.to_input(p)
    }

    /// Every order the imported letters allow (U creases stay open).
    pub fn complete(&self, limits: &CompletionLimits) -> Result<Completions, ImportRefusal> {
        self.complete_with(&[], limits)
    }

    /// Every order the imported letters and `fixed` allow.
    pub fn complete_with(
        &self,
        fixed: &[FixedPair],
        limits: &CompletionLimits,
    ) -> Result<Completions, ImportRefusal> {
        let mut all = self.unordered.letter_seeds();
        all.extend_from_slice(fixed);
        self.unordered
            .complete(&all, limits)
            .map_err(|r| self.refused_order(r))
    }

    /// A session over the imported letters, for checking choices one after
    /// another (the Layer order dialog). Each check's pairs are added to the
    /// letters, as [`ImportedPattern::complete_with`] adds them.
    pub fn session(&self, limits: &CompletionLimits) -> Result<CompletionSession, ImportRefusal> {
        self.unordered
            .session(&self.unordered.letter_seeds(), limits)
            .map_err(|r| self.refused_order(r))
    }

    /// The state with a chosen order, its unknown letters derived from it.
    pub fn state(&self, order: LayerOrder) -> Result<State, ImportRefusal> {
        self.unordered
            .state(order)
            .map_err(|refusal| not_flat_foldable(refusal, self.unordered.parts(), &self.placement))
    }

    /// Replay a stored `orderJson` against this pattern (plan D6): its
    /// witnesses and the letters must decide one order.
    pub fn replay(
        &self,
        stored: &WitnessOrder,
        limits: &CompletionLimits,
    ) -> Result<State, Broken> {
        self.unordered
            .replay(stored, &self.unordered.letter_seeds(), limits)
    }

    /// Seeds from Oriedita's relations, for "Start from Edit's folded
    /// figure" (plan D16): `start` is an interior point of Oriedita's
    /// starting face and each relation `[upper, lower]` interior points of
    /// two faces, in the input's coordinates and Oriedita's convention (upper
    /// is nearer a viewer of the starting face's front; layer order's
    /// `from_oriedita`).
    pub fn oriedita_seeds(
        &self,
        start: Point,
        relations: &[[Point; 2]],
    ) -> Result<Vec<FixedPair>, ImportRefusal> {
        let face = |p: Point| {
            self.unordered
                .face_at(self.placement.to_sheet(p))
                .ok_or(ImportRefusal::WitnessNotInFace { point: p })
        };
        let start_face = face(start)?;
        let start_front_up = self
            .unordered
            .isometry(start_face)
            .is_some_and(|t| t.front_up());
        let mut mapped = Vec::with_capacity(relations.len());
        for &[upper, lower] in relations {
            let (upper_face, lower_face) = (face(upper)?, face(lower)?);
            if upper_face == lower_face {
                return Err(ImportRefusal::RelationOneFace {
                    points: [upper, lower],
                });
            }
            mapped.push(OrieditaRelation {
                upper_face,
                lower_face,
            });
        }
        let order = LayerOrder::from_oriedita(&mapped, start_front_up).map_err(|e| match e {
            LayerOrderError::ContradictoryOrder { pair } => {
                self.refused_order(CompletionRefusal::FixedContradictory { pair })
            }
            other => ImportRefusal::Internal {
                message: other.to_string(),
            },
        })?;
        Ok(order
            .pairs()
            .filter_map(|(pair, lo_above)| {
                let [upper, lower] = if lo_above? {
                    [pair.lo(), pair.hi()]
                } else {
                    [pair.hi(), pair.lo()]
                };
                Some(FixedPair {
                    upper,
                    lower,
                    kind: FixedKind::Seed,
                })
            })
            .collect())
    }

    /// Edit's folded figure as a state: Oriedita's relations and the letters
    /// must decide every pair. When they leave a choice the refusal says how
    /// many orders there are; [`ImportedPattern::complete_with`] over the
    /// [`ImportedPattern::oriedita_seeds`] offers them.
    pub fn from_oriedita(
        &self,
        start: Point,
        relations: &[[Point; 2]],
        limits: &CompletionLimits,
    ) -> Result<State, ImportRefusal> {
        let seeds = self.oriedita_seeds(start, relations)?;
        let completions = self.complete_with(&seeds, limits)?;
        if !completions.is_unique() {
            return Err(ImportRefusal::OrderOpen {
                orders: completions.count(),
            });
        }
        let order = completions
            .order(&vec![0; completions.components().len()])
            .ok_or_else(|| ImportRefusal::Internal {
                message: "a unique completion has no order".to_string(),
            })?;
        self.state(order)
    }

    fn refused_order(&self, refusal: CompletionRefusal) -> ImportRefusal {
        let points = refusal
            .faces()
            .iter()
            .filter_map(|&f| self.unordered.face_witness(f))
            .map(|p| self.placement.to_input(p))
            .collect();
        match refusal {
            CompletionRefusal::AmbiguousOverlap { .. } => {
                ImportRefusal::AmbiguousOverlap { points }
            }
            CompletionRefusal::BudgetExceeded { limit, nodes } => {
                ImportRefusal::BudgetExceeded { limit, nodes }
            }
            CompletionRefusal::InvalidProblem { message } => ImportRefusal::Internal { message },
            refusal => ImportRefusal::NoOrder { refusal, points },
        }
    }
}

/// The root: the face containing `p`. When `p` lies on a crease (the centre
/// of most square patterns is a vertex), of the faces around it the first
/// counter-clockwise from +x by the direction of its centroid. The choice
/// must not depend on numbering: the stored order is in model-frame terms,
/// and a root of the other orientation would see the model from behind.
fn root_face(arrangement: &arrangement::Arrangement, p: Point) -> usize {
    let polygons: Vec<Vec<Point>> = arrangement
        .faces
        .iter()
        .map(|ring| ring.iter().map(|&v| arrangement.vertices[v]).collect())
        .collect();
    let mut inside = (0..polygons.len()).filter(|&f| convex::contains_point(&polygons[f], p, TOL));
    if let (Some(f), None) = (inside.next(), inside.next()) {
        return f;
    }
    let bearing = |f: usize| {
        convex::centroid(&polygons[f]).map_or(f64::INFINITY, |c| {
            (c[1] - p[1])
                .atan2(c[0] - p[0])
                .rem_euclid(std::f64::consts::TAU)
        })
    };
    (0..polygons.len())
        .filter(|&f| convex::contains_point(&polygons[f], p, -TOL))
        .min_by(|&f, &g| bearing(f).total_cmp(&bearing(g)))
        .unwrap_or(0)
}

/// The gate's refusal of the imported parts as Import CP says it: the face
/// cap and the stacking cap under their own codes, anything else as not
/// folding flat, with the points it names in the input's coordinates.
fn not_flat_foldable(
    refusal: FoldRefusal,
    parts: &StateParts,
    placement: &Placement,
) -> ImportRefusal {
    match refusal {
        FoldRefusal::TooManyFaces { face_count, limit } => {
            return ImportRefusal::TooManyFaces { face_count, limit };
        }
        FoldRefusal::StackedTooDeep {
            deepest,
            triples,
            limit,
        } => {
            return ImportRefusal::StackedTooDeep {
                deepest,
                triples,
                limit,
            };
        }
        _ => {}
    }
    ImportRefusal::NotFlatFoldable {
        points: points_of(&refusal, parts)
            .into_iter()
            .map(|p| placement.to_input(p))
            .collect(),
        refusal,
    }
}

/// The sheet points a refusal names: its vertices and its faces' centroids.
fn points_of(refusal: &FoldRefusal, parts: &StateParts) -> Vec<Point> {
    let vertices = refusal
        .vertices()
        .into_iter()
        .filter_map(|v| parts.vertices.get(v.index()).copied());
    let faces = refusal.faces().into_iter().filter_map(|id| {
        let face = parts.faces.iter().find(|f| f.id == id)?;
        let ring: Vec<Point> = face
            .ring
            .iter()
            .filter_map(|v| parts.vertices.get(v.index()).copied())
            .collect();
        convex::centroid(&ring)
    });
    vertices.chain(faces).collect()
}
