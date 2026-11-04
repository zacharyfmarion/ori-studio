//! The solver's folded view of exactly the faces a host folded
//! (`implementation-plans/layer-order-dialog.md`, approach 2; engine research
//! §2.2).
//!
//! A host hands over what it folded as a [`FoldSource`]: the creases as the
//! fold took them, its starting face and their face-ring digest. The CP
//! kernel's own wireframe of those creases ([`FoldedRenderInputs`]) becomes a
//! [`FoldedView`], so **face *k* here is Oriedita face *k***, and an order the
//! solver finds goes back to the host by index, with no bridge between two
//! sets of faces. Any sheet shape and any selection works, and the aux lines
//! stay out of the problem, as they do in Edit.
//!
//! # The edge rule is Oriedita's
//!
//! Every wireframe line that borders two distinct faces is a fold: a mountain
//! if it is `Red1`, otherwise a valley, so an interior `Black0` line folds as
//! a valley, exactly as `initial_hierarchy_from_graph` reads it. Only a line
//! that borders one face is the paper's edge, and constrains nothing. The
//! letters ([`crate::complete::letter_seeds`]) are therefore Oriedita's
//! initial hierarchy, relation for relation and in its order.
//!
//! # Frame
//!
//! Crease-pattern coordinates (y down) are mapped to the solver's (y up) with
//! the paper's longer side 1 ([`PaperFrame`]), so [`TOL`] is what it is in
//! Fold: 1e-6 of the sheet, Edit's line-identity tolerance rounded up
//! (`oristudio_geometry::tol`). A face is front-up when Oriedita's parity puts
//! it on the starting face's side (`position % 2 == 1`, what the drawer
//! colours by), so the starting face is front-up and the viewer at +z is the
//! front pass's. Oriedita's `upper_face` is then the solver's above
//! ([`LayerOrder::to_oriedita`] with a front-up start).
//!
//! # What v1 refuses
//!
//! [`SourceRefusal`], each with a stable code: a non-convex face (a reflex
//! corner of the paper or a selection with no crease into it, decision D4),
//! an overlap the tolerance cannot decide, a tolerance failure (a face or
//! crease too thin, a crease off its face, an overlap Oriedita's subfaces
//! see and the solver's view does not), the face cap and the dialog's own
//! stacking cap ([`LAYER_ORDER_MAX_STACKED_TRIPLES`]), and a wireframe Edit
//! could not draw either.
//!
//! # Fold-only pairs
//!
//! The solver's view can call a pair overlapping that shares no Oriedita
//! subface: two faces that only touch, at the tolerance. Edit cannot draw an
//! order on such a pair, so [`LayerSource::oriedita_relations`] leaves them
//! out and [`LayerSource::fold_only_pairs`] names them; the dialog does not
//! offer them.

use std::collections::HashSet;
use std::fmt;

use oristudio_cp::folding::{FoldedRenderInputs, HierarchyRelation};
use oristudio_cp::geometry::{LineColor, Point as KernelPoint};
use oristudio_cp::session::{EngineError, FoldSource};
use oristudio_geometry::convex;
use oristudio_layer_order::{
    Ambiguity, ConstraintProblem, Edge, EdgeKind, Face, FacePair, FoldedView, LayerOrder,
    LayerOrderError, Letter, MAX_FACES,
};
use serde::Serialize;
use thiserror::Error;

use crate::complete::{self, CompletionLimits, CompletionRefusal, CompletionSession, FixedPair};
use crate::numerics::TOL;
use crate::pattern::FaceId;

/// The most [`StackDepth::triples`](oristudio_layer_order::StackDepth) the
/// Layer order dialog's source takes: the dialog's own cap, and so the host
/// engine's, which restores what the dialog saves on the same source. It is
/// higher than Fold's
/// ([`MAX_STACKED_TRIPLES`](oristudio_layer_order::MAX_STACKED_TRIPLES),
/// 12,000,000), which the Fold workspace keeps: Fold's is set so that a
/// step replays in about 3 s, while the dialog opens one figure, behind
/// "Working out the layer orders…" with Cancel, against a 60 s deadline, and
/// a host's restore, which its Stop ends, has 60 s too (`LAYER_ORDER_LIMITS`,
/// `apps/web/src/layer-order/engine/layerOrderEngine.ts`). A count, not a
/// clock, as Fold's is, so a figure is refused, or not, alike on every
/// machine.
///
/// Chosen from the eight cpoogle designs Fold's cap refuses, the only real
/// designs over it, measured on 2026-10-26 with this cap lifted, through the
/// built Fold bridge in Node 22, making the calls the dialog's worker and the
/// host engine make (census 2's harness, `scripts/layer-order-census.mjs`),
/// one design at a time on an Apple Silicon Mac that was running other work
/// (load 7–17 on 10 cores, up to 53 on the last runs). Open is
/// `layer_open_showing` on Edit's order,
/// building the source included; previews are 13 single flips; restore is a
/// fresh instance restoring the record the dialog saved; memory is each
/// instance's wasm memory at its peak. The designs at 19.0 and 51.4 million
/// were run three and five times (two of those with the dialog's own 60 s
/// limits); each figure is the slowest of its runs:
///
/// | triples | deepest | faces | open | previews p50 / max | restore | memory, dialog / host |
/// | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
/// | 12.6 M | 204 | 1,990 | 5.3 s | 48 / 203 ms | 5.2 s | 157 / 154 MiB |
/// | 12.8 M | 324 | 1,110 | 4.6 s | 258 / 504 ms | 4.3 s | 101 / 99 MiB |
/// | 17.9 M | 302 | 1,056 | 3.5 s | 4 / 4 ms | 3.3 s | 109 / 107 MiB |
/// | 19.0 M | 261 | 1,524 | 18.6 s | 83 / 118 ms | 19.8 s | 143 / 140 MiB |
/// | 51.4 M | 320 | 3,449 | 38.7 s | 147 / 215 ms | 39.2 s | 361 / 353 MiB |
/// | 67.9 M | 370 | 3,224 | 54.5 s | 339 ms / 1.5 s | none: its record is over budget | 391 MiB |
/// | 68.3 M | 604 | 3,119 | 50.1 s | 809 / 887 ms | 65.4 s | 269 / 262 MiB |
/// | 79.8 M | 358 | 3,332 | 60.8 s | 380 ms / 3.1 s | 81.3 s | 418 / 408 MiB |
///
/// Previews stay quick at every depth, and memory stays far under wasm32's
/// 4 GB with Fold's own instance live too (it refuses these designs at import,
/// holding 8–29 MiB). What grows with the triples is the open and the
/// restore, the completion session's deduction and first order, and both
/// swing with the machine's load: the design at 19.0 million opened in
/// 11–19 s and restored in 12–20 s over its runs, the slowest at load 13.
///
/// The five designs up to 51.4 million open and restore within the 60 s
/// deadlines on every run. The one at 51.4 million, the slowest, opened in
/// 33–39 s and restored in 30–39 s; in Chromium, opened through Edit's Fold
/// with layer order…, the dialog was ready 29–44 s after it showed, and the
/// host engine restored its record in 29–31 s. Above it, none is usable at
/// 60 s: the one at 67.9 million opens in 54.5 s, but its record is over the
/// 1 MB budget, so its Apply would refuse; the two at 68.3 and 79.8 million
/// restore in 65 and 81 s. No real design lies between 51.4 and 67.9
/// million, so the cap sits just above the last one that fits. (It was
/// 20,000,000, just above the design at 19.0 million, while both deadlines
/// were 30 s.)
pub const LAYER_ORDER_MAX_STACKED_TRIPLES: u64 = 52_000_000;

/// How crease-pattern coordinates map to the solver's: y up, the paper's
/// longer side 1, the corner of its bounding box with the least x and the
/// greatest y at the origin.
///
/// The box is the folded creases' own, so for a selection it is the
/// selection's.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PaperFrame {
    /// The bounding box's least x, in crease-pattern units.
    pub x0: f64,
    /// The bounding box's greatest y, in crease-pattern units (y down there).
    pub y1: f64,
    /// The box's longer side, in crease-pattern units.
    pub side: f64,
}

impl PaperFrame {
    /// The frame of `points`' bounding box; `None` when it has no finite
    /// point or no extent.
    fn of(points: &[KernelPoint]) -> Option<PaperFrame> {
        let finite = points.iter().filter(|p| p.x.is_finite() && p.y.is_finite());
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for p in finite {
            x0 = x0.min(p.x);
            y0 = y0.min(p.y);
            x1 = x1.max(p.x);
            y1 = y1.max(p.y);
        }
        let side = (x1 - x0).max(y1 - y0);
        (side.is_finite() && side > 0.0).then_some(PaperFrame { x0, y1, side })
    }

    /// A crease-pattern point in the solver's frame.
    pub fn to_sheet(&self, [x, y]: [f64; 2]) -> [f64; 2] {
        [(x - self.x0) / self.side, (self.y1 - y) / self.side]
    }

    /// A point of the solver's frame in crease-pattern coordinates.
    pub fn to_paper(&self, [x, y]: [f64; 2]) -> [f64; 2] {
        [self.x0 + x * self.side, self.y1 - y * self.side]
    }

    fn kernel_to_sheet(&self, p: KernelPoint) -> [f64; 2] {
        self.to_sheet([p.x, p.y])
    }
}

/// Why a [`FoldSource`] cannot be ordered here. Faces are Oriedita's indices
/// (0-based, as [`HierarchyRelation`] names them); `line` is a wireframe line,
/// which is the source's segment of that index.
#[derive(Debug, Clone, PartialEq, Serialize, Error)]
#[serde(tag = "code")]
pub enum SourceRefusal {
    /// The creases trace no faces.
    #[serde(rename = "source_no_faces")]
    #[error("the creases trace no faces")]
    NoFaces,
    /// The CP kernel could not trace them; `kernel_code` is its error's code.
    #[serde(rename = "source_kernel")]
    #[error("the CP kernel could not trace the creases: {message}")]
    Kernel {
        kernel_code: &'static str,
        message: String,
    },
    /// The creases trace other faces than the digest the host sent names, or
    /// number them differently: an order would name the wrong faces.
    #[serde(rename = "source_digest_mismatch")]
    #[error("the creases trace faces {actual}, not the {expected} the host sent")]
    DigestMismatch { expected: String, actual: String },
    /// A fold joins two faces of one parity, which neither Oriedita nor the
    /// solver can fold (Oriedita's `SameParityAdjacentFaces`).
    #[serde(rename = "source_same_parity")]
    #[error("line {line} folds faces {faces:?}, which lie on one side of the paper")]
    SameParityFaces { line: usize, faces: [FaceId; 2] },
    /// A face with a reflex corner (decision D4: refused in v1).
    #[serde(rename = "source_non_convex_face")]
    #[error("face {face} is not convex")]
    NonConvexFace { face: FaceId },
    /// More faces than the solver's tables take
    /// ([`oristudio_layer_order::MAX_FACES`]).
    #[serde(rename = "source_too_many_faces")]
    #[error("the fold has {face_count} faces, over the {limit} cap")]
    TooManyFaces { face_count: usize, limit: usize },
    /// Stacked too deep to order in time ([`LAYER_ORDER_MAX_STACKED_TRIPLES`],
    /// the dialog's own cap); `deepest` is what the dialog's notice names.
    #[serde(rename = "source_stacked_too_deep")]
    #[error("the fold stacks {deepest} faces deep, {triples} triples over the {limit} cap")]
    StackedTooDeep {
        deepest: usize,
        triples: u64,
        limit: u64,
    },
    /// Pairs the tolerance cannot decide whether they overlap.
    #[serde(rename = "source_ambiguous_overlap")]
    #[error("the tolerance cannot decide {} overlapping pair(s)", ambiguities.len())]
    AmbiguousOverlap { ambiguities: Vec<Ambiguity> },
    /// The geometry and the tolerance disagree; see [`ToleranceCause`].
    #[serde(rename = "source_tolerance")]
    #[error("the folded geometry fails at the tolerance: {cause:?}")]
    Tolerance { cause: ToleranceCause },
    /// The kernel's wireframe broke an invariant it keeps: a defect, never the
    /// creases' fault.
    #[serde(rename = "source_internal")]
    #[error("the wireframe is malformed: {message}")]
    Internal { message: String },
}

impl SourceRefusal {
    /// The stable code, as the wire spells it.
    pub fn code(&self) -> &'static str {
        match self {
            SourceRefusal::NoFaces => "source_no_faces",
            SourceRefusal::Kernel { .. } => "source_kernel",
            SourceRefusal::DigestMismatch { .. } => "source_digest_mismatch",
            SourceRefusal::SameParityFaces { .. } => "source_same_parity",
            SourceRefusal::NonConvexFace { .. } => "source_non_convex_face",
            SourceRefusal::TooManyFaces { .. } => "source_too_many_faces",
            SourceRefusal::StackedTooDeep { .. } => "source_stacked_too_deep",
            SourceRefusal::AmbiguousOverlap { .. } => "source_ambiguous_overlap",
            SourceRefusal::Tolerance { .. } => "source_tolerance",
            SourceRefusal::Internal { .. } => "source_internal",
        }
    }

    fn internal(message: &str) -> SourceRefusal {
        SourceRefusal::Internal {
            message: message.to_string(),
        }
    }
}

/// Which test of the solver's view the folded geometry fails at [`TOL`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToleranceCause {
    /// A face has fewer than three points apart.
    CollapsedFace { face: FaceId },
    /// A face no wider than the tolerance.
    ThinFace { face: FaceId },
    /// A fold no longer than the tolerance.
    ShortCrease { line: usize },
    /// A fold that is not on its face's boundary, or that the face straddles.
    CreaseOffFace { line: usize, face: FaceId },
    /// A fold whose two faces lie on opposite sides of it.
    CreaseSides { line: usize },
    /// Two faces share an Oriedita subface, but the solver's view does not see
    /// them overlap.
    OverlapDisagrees { faces: [FaceId; 2] },
}

impl ToleranceCause {
    /// The stable code of the cause.
    pub fn code(&self) -> &'static str {
        match self {
            ToleranceCause::CollapsedFace { .. } => "collapsed_face",
            ToleranceCause::ThinFace { .. } => "thin_face",
            ToleranceCause::ShortCrease { .. } => "short_crease",
            ToleranceCause::CreaseOffFace { .. } => "crease_off_face",
            ToleranceCause::CreaseSides { .. } => "crease_sides",
            ToleranceCause::OverlapDisagrees { .. } => "overlap_disagrees",
        }
    }
}

/// See the module docs.
pub struct LayerSource {
    source: FoldSource,
    inputs: FoldedRenderInputs,
    frame: PaperFrame,
    view: FoldedView,
    problem: ConstraintProblem,
    letters: Vec<FixedPair>,
    /// Per face, its ring on the unfolded sheet in the solver's frame,
    /// counter-clockwise.
    paper: Vec<Vec<[f64; 2]>>,
    shared: SharedPairs,
}

impl fmt::Debug for LayerSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LayerSource")
            .field("digest", &self.source.digest)
            .field("faces", &self.view.faces().len())
            .field("folds", &self.view.edges().len())
            .field("pairs", &self.problem.variables().len())
            .field("letters", &self.letters.len())
            .finish_non_exhaustive()
    }
}

impl LayerSource {
    /// The solver's view of what `source` folds (engine research §2.2): the
    /// kernel's wireframe of exactly those creases, checked against the
    /// digest the host sent, as faces and folds in the solver's frame; the
    /// constraint problem; and the letters as seeds.
    pub fn from_oriedita(source: &FoldSource) -> Result<LayerSource, SourceRefusal> {
        let inputs = FoldedRenderInputs::from_segments(&source.segments, source.starting_face_id)
            .map_err(|error| {
                let error = EngineError::from(error);
                SourceRefusal::Kernel {
                    kernel_code: error.code,
                    message: error.message,
                }
            })?
            .ok_or(SourceRefusal::NoFaces)?;
        let actual = inputs.face_ring_digest().to_string();
        if actual != source.digest {
            return Err(SourceRefusal::DigestMismatch {
                expected: source.digest.clone(),
                actual,
            });
        }
        let wireframe = inputs.wireframe();
        let face_count = wireframe.faces.len();
        if face_count == 0 {
            return Err(SourceRefusal::NoFaces);
        }
        // Before anything per face is built, as the view would refuse it.
        if face_count > MAX_FACES {
            return Err(SourceRefusal::TooManyFaces {
                face_count,
                limit: MAX_FACES,
            });
        }
        let frame = PaperFrame::of(inputs.flat_points()).ok_or(SourceRefusal::NoFaces)?;
        let read = Reading {
            inputs: &inputs,
            frame,
        };

        let (edges, edge_lines) = read.folds()?;
        let view =
            FoldedView::new(read.faces()?, edges).map_err(|e| view_refusal(e, &edge_lines))?;
        let problem = ConstraintProblem::build_within(&view, LAYER_ORDER_MAX_STACKED_TRIPLES)
            .map_err(|e| view_refusal(e, &edge_lines))?;
        if !problem.ambiguities().is_empty() {
            return Err(SourceRefusal::AmbiguousOverlap {
                ambiguities: problem.ambiguities().to_vec(),
            });
        }

        // Every pair Edit's drawer stacks must be a pair the solver orders.
        let shared = SharedPairs::of(face_count, inputs.subface_face_ids())?;
        if let Some((a, b)) = shared.pairs().find(|&(a, b)| !problem.is_variable(a, b)) {
            return Err(SourceRefusal::Tolerance {
                cause: ToleranceCause::OverlapDisagrees { faces: [a, b] },
            });
        }

        let paper = read.paper_rings()?;
        let letters = complete::letter_seeds(&view);
        Ok(LayerSource {
            source: source.clone(),
            inputs,
            frame,
            view,
            problem,
            letters,
            paper,
            shared,
        })
    }

    /// What the host folded, as it sent it.
    pub fn fold_source(&self) -> &FoldSource {
        &self.source
    }

    /// The kernel's derivation of those creases: the paper scene of an order
    /// is drawn from it (`oristudio_cp::folding::folded_paper_scene_with_order`).
    pub fn render_inputs(&self) -> &FoldedRenderInputs {
        &self.inputs
    }

    /// The map from crease-pattern coordinates to the solver's.
    pub fn frame(&self) -> PaperFrame {
        self.frame
    }

    /// The faces and folds as the solver sees them; face *k* is Oriedita face
    /// *k*.
    pub fn view(&self) -> &FoldedView {
        &self.view
    }

    /// The layer-order constraint problem of [`Self::view`].
    pub fn problem(&self) -> &ConstraintProblem {
        &self.problem
    }

    /// The orders the letters fix, one per fold in line order: Oriedita's
    /// initial hierarchy, upper face first.
    pub fn letter_seeds(&self) -> &[FixedPair] {
        &self.letters
    }

    /// A completion session over the letters: what they force, and a first
    /// order.
    pub fn session(
        &self,
        limits: &CompletionLimits,
    ) -> Result<CompletionSession, CompletionRefusal> {
        CompletionSession::open(&self.view, &self.problem, &self.letters, limits)
    }

    /// Whether faces `a` and `b` share an Oriedita subface: the pairs Edit's
    /// drawer stacks, and the only ones an order can be handed back on.
    pub fn shares_subface(&self, a: FaceId, b: FaceId) -> bool {
        self.shared.get(a, b)
    }

    /// How many pairs share an Oriedita subface.
    pub fn subface_pairs(&self) -> usize {
        self.shared.count()
    }

    /// The pairs the solver's view calls overlapping that share no Oriedita
    /// subface, ascending: Edit cannot draw an order on them.
    pub fn fold_only_pairs(&self) -> Vec<FacePair> {
        self.problem
            .variables()
            .iter()
            .filter(|pair| !self.shared.get(pair.lo(), pair.hi()))
            .copied()
            .collect()
    }

    /// `order` as Oriedita's relations, for `fold_with_order`: each
    /// determined pair that shares an Oriedita subface, ascending, its
    /// `upper_face` the face above. The starting face is front-up here, so
    /// Oriedita's upper (nearer a viewer of the starting face's front) is the
    /// solver's above. Pairs on no shared subface are left out: the drawer
    /// never reads them, and the closure could only be misled by them.
    pub fn oriedita_relations(&self, order: &LayerOrder) -> Vec<HierarchyRelation> {
        order
            .to_oriedita(true)
            .into_iter()
            .filter(|r| self.shared.get(r.upper_face, r.lower_face))
            .map(|r| HierarchyRelation {
                upper_face: r.upper_face.0 as usize,
                lower_face: r.lower_face.0 as usize,
            })
            .collect()
    }

    /// An interior point of `face` on the unfolded paper, in crease-pattern
    /// coordinates: what a saved record names the face by.
    pub fn paper_point(&self, face: FaceId) -> Option<[f64; 2]> {
        let ring = self.paper.get(face.0 as usize)?;
        convex::centroid(ring).map(|p| self.frame.to_paper(p))
    }

    /// The point a saved record names `face` by, in crease-pattern
    /// coordinates: its centroid ([`Self::paper_point`]) when
    /// [`Self::face_at_paper`] finds the face there, and otherwise, for a face
    /// so thin its centroid lies within the tolerance of an edge, the most
    /// interior of a few points that lie further in: the incenters of the
    /// triangles each corner makes with its neighbours and with the centroid.
    /// The choice depends on the face's ring alone, so the same face gives the
    /// same point, which a restore compares with the one saved. A face
    /// narrower than twice the tolerance has no point the face is found at,
    /// and gives its most interior one anyway (a restore then reports it
    /// gone, never silently).
    pub fn interior_point(&self, face: FaceId) -> Option<[f64; 2]> {
        let centroid = self.paper_point(face)?;
        if self.face_at_paper(centroid) == Some(face) {
            return Some(centroid);
        }
        let ring = self.paper.get(face.0 as usize)?;
        let planes = convex::edge_planes(ring);
        let clearance = |p: [f64; 2]| {
            planes
                .iter()
                .map(|plane| plane.signed_distance(p))
                .fold(f64::INFINITY, f64::min)
        };
        let middle = self.frame.to_sheet(centroid);
        let n = ring.len();
        let mut best = (clearance(middle), middle);
        for i in 0..n {
            let (before, at, after) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
            for triangle in [[before, at, after], [middle, at, after]] {
                if let Some(p) = incenter(triangle)
                    && clearance(p) > best.0
                {
                    best = (clearance(p), p);
                }
            }
        }
        Some(self.frame.to_paper(best.1))
    }

    /// `face`'s area on the unfolded paper, in crease-pattern units squared:
    /// what tells a split or merged face from the one a record saved.
    pub fn paper_area(&self, face: FaceId) -> Option<f64> {
        let ring = self.paper.get(face.0 as usize)?;
        Some(convex::signed_area(ring) * self.frame.side * self.frame.side)
    }

    /// The one face whose paper ring holds `point` (crease-pattern
    /// coordinates) by more than the tolerance; `None` off the paper, on a
    /// crease, or in two faces.
    pub fn face_at_paper(&self, point: [f64; 2]) -> Option<FaceId> {
        let p = self.frame.to_sheet(point);
        let mut hits = self
            .paper
            .iter()
            .enumerate()
            .filter(|(_, ring)| convex::contains_point(ring, p, TOL));
        let (first, _) = hits.next()?;
        hits.next().is_none().then_some(face_id(first))
    }
}

/// Face `k`'s id. A view takes at most [`MAX_FACES`], so the index fits.
fn face_id(k: usize) -> FaceId {
    FaceId(k as u32)
}

/// The center of a triangle's inscribed circle; `None` for a degenerate one.
fn incenter([a, b, c]: [[f64; 2]; 3]) -> Option<[f64; 2]> {
    let length = |p: [f64; 2], q: [f64; 2]| (p[0] - q[0]).hypot(p[1] - q[1]);
    let (la, lb, lc) = (length(b, c), length(c, a), length(a, b));
    let perimeter = la + lb + lc;
    (perimeter > 0.0 && perimeter.is_finite()).then(|| {
        [
            (la * a[0] + lb * b[0] + lc * c[0]) / perimeter,
            (la * a[1] + lb * b[1] + lc * c[1]) / perimeter,
        ]
    })
}

/// The kernel's wireframe read in the solver's frame.
struct Reading<'a> {
    inputs: &'a FoldedRenderInputs,
    frame: PaperFrame,
}

impl Reading<'_> {
    /// Wireframe point `point` where the fold puts it.
    fn folded(&self, point: usize) -> Result<[f64; 2], SourceRefusal> {
        let p =
            self.inputs.wireframe().points.get(point).ok_or_else(|| {
                SourceRefusal::internal("a ring names a point the wireframe lacks")
            })?;
        let q = self.frame.kernel_to_sheet(*p);
        if q.iter().all(|c| c.is_finite()) {
            Ok(q)
        } else {
            Err(SourceRefusal::internal("a folded point is not finite"))
        }
    }

    /// Whether face `face` lies on the starting face's side: Oriedita's odd
    /// position, which the drawer colours as the front.
    fn front_up(&self, face: usize) -> Result<bool, SourceRefusal> {
        self.inputs
            .wireframe()
            .face_positions
            .get(face)
            .map(|position| position % 2 == 1)
            .ok_or_else(|| SourceRefusal::internal("a face has no position"))
    }

    /// Face `k` is Oriedita face `k`: its ring through the folded points.
    fn faces(&self) -> Result<Vec<Face>, SourceRefusal> {
        let wireframe = self.inputs.wireframe();
        let mut faces = Vec::with_capacity(wireframe.faces.len());
        for (k, ring) in wireframe.faces.iter().enumerate() {
            faces.push(Face {
                id: face_id(k),
                polygon: ring
                    .iter()
                    .map(|&p| self.folded(p))
                    .collect::<Result<_, _>>()?,
                front_up: self.front_up(k)?,
            });
        }
        Ok(faces)
    }

    /// One fold per line between two faces, in line order, so the letters
    /// come out as Oriedita's initial hierarchy lists them; and each fold's
    /// line.
    fn folds(&self) -> Result<(Vec<Edge>, Vec<usize>), SourceRefusal> {
        let mut edges = Vec::new();
        let mut lines = Vec::new();
        for (line, wire) in self.inputs.wireframe().lines.iter().enumerate() {
            let Some((f, g)) = self.inputs.line_face_border(line) else {
                continue;
            };
            if f == g {
                continue;
            }
            if self.front_up(f)? == self.front_up(g)? {
                return Err(SourceRefusal::SameParityFaces {
                    line,
                    faces: [face_id(f), face_id(g)],
                });
            }
            let letter = if wire.color == LineColor::Red1 {
                Letter::Mountain
            } else {
                Letter::Valley
            };
            edges.push(Edge {
                faces: [face_id(f), face_id(g)],
                segment: [self.folded(wire.begin)?, self.folded(wire.end)?],
                kind: EdgeKind::Folded(Some(letter)),
            });
            lines.push(line);
        }
        Ok((edges, lines))
    }

    /// Each face's ring on the unfolded sheet, counter-clockwise.
    fn paper_rings(&self) -> Result<Vec<Vec<[f64; 2]>>, SourceRefusal> {
        let flat = self.inputs.flat_points();
        self.inputs
            .wireframe()
            .faces
            .iter()
            .map(|ring| {
                ring.iter()
                    .map(|&p| {
                        flat.get(p)
                            .map(|&q| self.frame.kernel_to_sheet(q))
                            .ok_or_else(|| SourceRefusal::internal("a ring names no sheet point"))
                    })
                    .collect::<Result<Vec<_>, _>>()
                    .map(|ring| convex::normalize(&ring))
            })
            .collect()
    }
}

/// A view or problem refusal as the source's, naming wireframe lines rather
/// than view edges.
fn view_refusal(error: LayerOrderError, edge_lines: &[usize]) -> SourceRefusal {
    let line = |edge: usize| edge_lines.get(edge).copied().unwrap_or(edge);
    let tolerance = |cause| SourceRefusal::Tolerance { cause };
    match error {
        LayerOrderError::TooManyFaces { face_count, limit } => {
            SourceRefusal::TooManyFaces { face_count, limit }
        }
        LayerOrderError::StackedTooDeep {
            deepest,
            triples,
            limit,
        } => SourceRefusal::StackedTooDeep {
            deepest,
            triples,
            limit,
        },
        LayerOrderError::NonConvexFace(face) => SourceRefusal::NonConvexFace { face },
        LayerOrderError::InvalidPolygon { face, .. } => {
            tolerance(ToleranceCause::CollapsedFace { face })
        }
        LayerOrderError::DegenerateFace(face) => tolerance(ToleranceCause::ThinFace { face }),
        LayerOrderError::DegenerateEdge { edge, .. } => {
            tolerance(ToleranceCause::ShortCrease { line: line(edge) })
        }
        LayerOrderError::EdgeOffFace { edge, face } => tolerance(ToleranceCause::CreaseOffFace {
            line: line(edge),
            face,
        }),
        LayerOrderError::EdgeKindMismatch { edge, .. } => {
            tolerance(ToleranceCause::CreaseSides { line: line(edge) })
        }
        other => SourceRefusal::Internal {
            message: other.to_string(),
        },
    }
}

/// Which face pairs share an Oriedita subface: a bit per pair `lo < hi`,
/// `n²` bits for `n` faces (2 MB at the face cap).
struct SharedPairs {
    n: usize,
    bits: Vec<u64>,
    count: usize,
}

impl SharedPairs {
    fn of<'a>(
        n: usize,
        subfaces: impl Iterator<Item = &'a [usize]>,
    ) -> Result<SharedPairs, SourceRefusal> {
        let mut shared = SharedPairs {
            n,
            bits: vec![0; (n * n).div_ceil(64)],
            count: 0,
        };
        // Many subfaces of a deep stack carry the same faces; each set once.
        let mut seen: HashSet<&[usize]> = HashSet::new();
        for faces in subfaces {
            if !seen.insert(faces) {
                continue;
            }
            if faces.iter().any(|&f| f >= n) {
                return Err(SourceRefusal::internal(
                    "a subface names a face out of range",
                ));
            }
            for (i, &a) in faces.iter().enumerate() {
                for &b in &faces[i + 1..] {
                    shared.set(a, b);
                }
            }
        }
        Ok(shared)
    }

    fn index(&self, a: usize, b: usize) -> Option<usize> {
        let (lo, hi) = if a < b { (a, b) } else { (b, a) };
        (lo != hi && hi < self.n).then_some(lo * self.n + hi)
    }

    fn set(&mut self, a: usize, b: usize) {
        if let Some(i) = self.index(a, b) {
            let (word, bit) = (i / 64, 1u64 << (i % 64));
            if self.bits[word] & bit == 0 {
                self.bits[word] |= bit;
                self.count += 1;
            }
        }
    }

    fn get(&self, a: FaceId, b: FaceId) -> bool {
        self.index(a.0 as usize, b.0 as usize)
            .is_some_and(|i| self.bits[i / 64] & (1u64 << (i % 64)) != 0)
    }

    fn count(&self) -> usize {
        self.count
    }

    /// Every shared pair, ascending.
    fn pairs(&self) -> impl Iterator<Item = (FaceId, FaceId)> + '_ {
        let n = self.n;
        self.bits
            .iter()
            .enumerate()
            .filter(|(_, word)| **word != 0)
            .flat_map(move |(w, &word)| {
                let mut rest = word;
                std::iter::from_fn(move || {
                    (rest != 0).then(|| {
                        let i = w * 64 + rest.trailing_zeros() as usize;
                        rest &= rest - 1;
                        (face_id(i / n), face_id(i % n))
                    })
                })
            })
    }
}
