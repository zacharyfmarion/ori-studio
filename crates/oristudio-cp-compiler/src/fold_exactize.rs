//! Snap a FOLD crease pattern to *exactly* flat-foldable geometry.
//!
//! TreeMaker (and any float optimizer) emits crease patterns whose interior
//! vertices miss Kawasaki's angle condition by ~1e-3° — well above CAMV's
//! `Epsilon::FLAT = 1e-6°` bar — so the CP shows spurious "Flat-foldability
//! violation: Angles" warnings in the editor. This pass adapts the FOLD into an
//! [`ExactSolveInput`], runs the exact solver (topology + assignments fixed;
//! only coordinates move), and — if the result actually clears the CAMV bar —
//! returns an exactized FOLD in the *input's* coordinate frame.
//!
//! The solver only enforces Kawasaki, so it clears the `Angles` (Kawasaki) CAMV
//! violations but not `LittleBigLittle` — an assignment/foldability condition
//! TreeMaker leaves for the user. (A large fraction of TreeMaker creases are
//! `Flat` — 122 of 434 on `tmModelTester_5` — but every one of those is an
//! `UNFOLDED_HINGE`, upstream's own name for a crease that does not fold, not
//! an unresolved one. They round-trip into the editor as `Cyan3`, which CAMV
//! skips, and the solver excludes them from its fans for the same reason.)
//!
//! We therefore adopt the result when it is **Kawasaki-clean (0
//! `Angles` violations) and has strictly fewer total CAMV violations** than the
//! input; the residual `LittleBigLittle`/assignment warnings are the user's to fix
//! manually. Otherwise the original FOLD is returned. Exactize never throws and is
//! never worse than the input (checked against the real oristudio-cp CAMV checker).
//!
//! Square (unit-quadrilateral) paper is supported. The solver also supports a
//! convex-`Polygon` boundary policy for non-square paper, but it needs a boundary
//! precision fix first — it keeps ~3e-6 transform error at the paper edge that the
//! square path scrubs by snapping to exact coords, and CAMV's 1e-6° tolerance
//! amplifies it (see `ENABLE_POLYGON_EXACTIZE`), so non-square paper falls back.

use crate::candidate_graph::{
    BoundaryModel, BoundaryReconstructionPolicy, BoundarySide, BoundarySideModel,
    CandidateCarrierGeometry, CandidateVertex, CandidateVertexKind, CandidateVertexMovementPolicy,
};
use crate::fold_export::export_exact_solved_to_fold_document;
use crate::{
    AssignmentEvidence, AssignmentEvidenceSource, AssignmentLabel, CandidateCreaseSourceKind,
    CandidateCreaseSpan, CandidateCreaseSpanKind, CandidateGraphProvenance,
    CandidateSelectionPolicy, CandidateSourceAdapter, CostModel, ExactSolveInput,
    ExactSolveOptions, Point2, Provenance, solve_exact,
};
use std::collections::BTreeMap;
use treemaker_fold::{Assignment, FoldDocument};

/// Minimum turn (degrees) at a boundary vertex for it to count as a paper corner.
const CORNER_TURN_DEGREES: f64 = 45.0;
/// How close the mapped corners must sit to the unit square to accept the paper
/// as square (in unit-square units).
const UNIT_SQUARE_CORNER_TOLERANCE: f64 = 1e-3;
/// The convex-polygon (non-square) path is off pending a numerical-precision fix.
/// ROOT CAUSE (verified): the square path pins corners to the EXACT unit square and
/// slides boundary vertices on EXACT axis-aligned lines (`corner_points` and
/// `side_point` hardcode 0.0/1.0), which scrubs the ~3e-6 float error the FOLD→frame
/// transform leaves at the paper edge. The `Polygon` path pins corners and slides
/// boundary vertices at their ACTUAL transformed positions, keeping that ~3e-6
/// error. CAMV's Kawasaki tolerance is 1e-6°, so that boundary error propagates to
/// interior vertices and inflates the count (6 -> 136 on tmModelTester_5). Proof:
/// snapping the flipped-polygon input's corners + boundary vertices to exact
/// coordinates recovers 6. FIX: snap boundary vertices exactly onto their
/// corner-defined segments (and pin corners consistently) before solving. Then
/// flip this to `true`. The solver's `Polygon` policy itself is correct.
const ENABLE_POLYGON_EXACTIZE: bool = false;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExactizeStatus {
    /// The FOLD was snapped to flat-foldable and replaced.
    Exactized,
    /// The original FOLD was returned unchanged (see `fallback_reason`).
    Unchanged,
}

/// Result of [`exactize_fold`]: the (possibly replaced) FOLD plus a small report
/// suitable for telemetry.
#[derive(Debug, Clone)]
pub struct ExactizeOutcome {
    pub fold: FoldDocument,
    pub status: ExactizeStatus,
    pub fallback_reason: Option<String>,
    /// CAMV flat-foldability violations in the original and resulting FOLD.
    pub camv_violations_before: usize,
    pub camv_violations_after: usize,
    /// Max vertex displacement, in unit-square units (paper edge == 1.0).
    pub max_vertex_movement: f64,
}

/// CAMV flat-foldability check for a FOLD, using oristudio-cp's own checker — the
/// ground truth the editor uses. Returns `(total, angles)` where `angles` counts
/// only the `Angles` (Kawasaki) violations. `(MAX, MAX)` if the FOLD can't be
/// round-tripped (treated as "not clean / can't adopt").
fn camv_counts(fold: &FoldDocument) -> (usize, usize) {
    let Ok(json) = serde_json::to_string(fold) else {
        return (usize::MAX, usize::MAX);
    };
    let Ok(doc) = oristudio_cp::io::fold::import_fold_file_document_json(&json) else {
        return (usize::MAX, usize::MAX);
    };
    let violations = oristudio_cp::checks::check_camv_task(&doc.crease_pattern).violations;
    let angles = violations
        .iter()
        .filter(|v| v.rule == oristudio_cp::checks::FlatFoldabilityRule::Angles)
        .count();
    (violations.len(), angles)
}

/// Snap `fold` to flat-foldable geometry, or return it unchanged.
///
/// The exact-solve enforces Kawasaki, which clears the `Angles` CAMV violations
/// but not `LittleBigLittle` (an assignment/foldability condition TreeMaker leaves
/// unresolved — most TreeMaker creases are `Flat`). So we adopt the result iff it
/// is **Kawasaki-clean (0 `Angles`) and has strictly fewer total CAMV violations**
/// than the input; the residual assignment-type warnings are for the user to fix.
/// On any failure or no net improvement the original FOLD is returned verbatim.
pub fn exactize_fold(fold: &FoldDocument, options: ExactSolveOptions) -> ExactizeOutcome {
    let (before, _) = camv_counts(fold);
    let (input, xform) = match fold_to_exact_solve_input(fold) {
        Ok(v) => v,
        Err(reason) => return unchanged(fold.clone(), reason, before, before, 0.0),
    };
    let before_points: Vec<Point2> = input.vertices.iter().map(|v| v.point).collect();

    let solved = solve_exact(&input, options);
    let movement = max_movement(&before_points, &solved.vertices_exact);

    let mut out = match export_exact_solved_to_fold_document(&input, &solved) {
        Ok(doc) => doc,
        Err(err) => {
            return unchanged(
                fold.clone(),
                format!("FOLD export failed: {err}"),
                before,
                before,
                movement,
            );
        }
    };

    // The solve ran in a normalized frame; map coordinates back into the input's
    // frame so the exactized FOLD is a drop-in replacement.
    for coord in &mut out.vertices_coords {
        let p = xform.invert(Point2::new(coord[0], coord[1]));
        coord[0] = p.x;
        coord[1] = p.y;
    }
    out.frame_title = fold.frame_title.clone();
    out.file_title = fold.file_title.clone();

    let (after, angles_after) = camv_counts(&out);
    if angles_after != 0 || after >= before {
        return unchanged(
            fold.clone(),
            format!(
                "not adopted: {angles_after} Angles + {after} total violations remain (was {before})"
            ),
            before,
            after,
            movement,
        );
    }

    ExactizeOutcome {
        fold: out,
        status: ExactizeStatus::Exactized,
        fallback_reason: None,
        camv_violations_before: before,
        camv_violations_after: after,
        max_vertex_movement: movement,
    }
}

/// String-in / string-out [`exactize_fold`] over FOLD JSON, for the wasm binding.
/// Returns the exactized FOLD JSON, or the input JSON verbatim on any parse/solve
/// failure — never errors, so callers can treat it as a transparent pass-through.
pub fn exactize_fold_json(fold_json: &str, options: ExactSolveOptions) -> String {
    let Ok(fold) = serde_json::from_str::<FoldDocument>(fold_json) else {
        return fold_json.to_owned();
    };
    let outcome = exactize_fold(&fold, options);
    serde_json::to_string(&outcome.fold).unwrap_or_else(|_| fold_json.to_owned())
}

fn unchanged(
    fold: FoldDocument,
    reason: String,
    before: usize,
    after: usize,
    movement: f64,
) -> ExactizeOutcome {
    ExactizeOutcome {
        fold,
        status: ExactizeStatus::Unchanged,
        fallback_reason: Some(reason),
        camv_violations_before: before,
        camv_violations_after: after,
        max_vertex_movement: movement,
    }
}

/// Angle-preserving similarity (rotate + uniform scale + optional reflection +
/// translate) mapping the input FOLD frame to the axis-aligned unit square.
/// The similarity that carries a FOLD's own coordinates onto the unit square the
/// solver works in — and, through [`Similarity::invert`], carries an answer back.
///
/// Serializable because the browser owns the second half of that round trip: it
/// rebuilds an input over the bridge, solves it, and has to put the moved
/// vertices back where the user's creases are. Handing it the transform is what
/// replaces the frame *hypothesis* the web used to apply and then verify by
/// looking for the solver's vertices among the crease ends.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Similarity {
    /// The paper corner the frame is measured from, in FOLD coordinates.
    pub origin: Point2,
    /// Unit vector along the first paper side.
    pub ux: (f64, f64),
    /// Unit vector along the perpendicular side.
    pub uy: (f64, f64),
    /// Paper side length in FOLD units — the scale factor.
    pub side: f64,
    /// `-1.0` when the paper had to be reflected to land in +y, else `1.0`.
    pub flip: f64,
}

impl Similarity {
    /// FOLD coordinates -> unit-square coordinates.
    pub fn apply(&self, p: Point2) -> Point2 {
        let d = (p.x - self.origin.x, p.y - self.origin.y);
        Point2::new(
            (d.0 * self.ux.0 + d.1 * self.ux.1) / self.side,
            self.flip * (d.0 * self.uy.0 + d.1 * self.uy.1) / self.side,
        )
    }

    /// Unit-square coordinates -> FOLD coordinates. The inverse of [`Self::apply`].
    pub fn invert(&self, q: Point2) -> Point2 {
        let fx = q.x * self.side;
        let fy = self.flip * q.y * self.side;
        Point2::new(
            self.origin.x + fx * self.ux.0 + fy * self.uy.0,
            self.origin.y + fx * self.ux.1 + fy * self.uy.1,
        )
    }
}

/// Build an [`ExactSolveInput`] from a FOLD document, plus the similarity used to
/// map it into the unit square. `Err(reason)` when the paper is not a square
/// quadrilateral (unsupported until the boundary generalization lands).
/// Policy-specific boundary classification produced by [`plan_boundary`].
struct BoundaryPlan {
    xform: Similarity,
    policy: BoundaryReconstructionPolicy,
    /// Corner vertex ids in `BoundaryModel.corners` order.
    corners: [usize; 4],
    /// Per side: (label, `[cornerA, cornerB]`, contact vertex ids in slide order).
    sides: Vec<(BoundarySide, [usize; 2], Vec<usize>)>,
    /// Boundary-side label per vertex id; `None` for corners and interior vertices.
    vertex_side: Vec<Option<BoundarySide>>,
}

/// Rebuild an [`ExactSolveInput`] from a FOLD crease pattern, with the
/// [`Similarity`] that maps between the two frames.
///
/// **This is the seam that lets a solve run on what the user is actually looking
/// at.** A detection attaches its input to the region at import, and for a long
/// time that attachment was the only thing a re-solve could consume — so a
/// hand-repaired topology (a merged degree-2 vertex, a recoloured crease, a
/// corner joined into one point) was invisible to the solver, which then
/// reported blockers the user had already fixed. Running this over the current
/// document instead is what closes that gap; see `useCpRegionSolve.ts`.
///
/// The topology, assignments and boundary all come from the FOLD. What it cannot
/// recover is the detector's own per-crease confidence, so every vertex gets
/// `support: 1.0` and every span `AssignmentEvidenceSource::Inferred` — the
/// pattern is taken as *stated* rather than as *guessed*, which is the right
/// reading of geometry a user has been editing by hand.
pub fn exact_solve_input_from_fold(
    fold: &FoldDocument,
) -> Result<(ExactSolveInput, Similarity), String> {
    validate_fold(fold)?;
    fold_to_exact_solve_input(fold)
}

/// Refuse a FOLD that the rest of this module would index its way off the end of.
///
/// Everything below is written against a FOLD that our own exporter produced, so
/// it indexes `edges_assignment[id]` by an `edges_vertices` position and
/// `vertices_coords[v]` by an edge endpoint without checking either. That was
/// fine while the only caller was `exactize_fold` on a document the kernel had
/// just serialized. It is not fine now: [`exact_solve_input_from_fold`] is
/// public and reached from the browser, and a hand-assembled or truncated FOLD
/// arriving over the bridge must come back as a refusal the UI can show, never
/// as a wasm trap that takes the worker down with no message.
///
/// Checked once, here, so the code after it can keep indexing plainly — the
/// alternative is a `get()` and a `?` at each of a dozen sites, which would
/// bury the geometry in bounds handling for invariants that hold everywhere but
/// the door.
fn validate_fold(fold: &FoldDocument) -> Result<(), String> {
    let n = fold.vertices_coords.len();
    if n == 0 {
        return Err("empty FOLD".to_owned());
    }
    if let Some(bad) = fold.vertices_coords.iter().position(|v| v.len() < 2) {
        return Err(format!("vertex {bad} has fewer than 2 coordinates"));
    }
    if let Some(bad) = fold
        .vertices_coords
        .iter()
        .position(|v| !v[0].is_finite() || !v[1].is_finite())
    {
        return Err(format!("vertex {bad} is not finite"));
    }
    if fold.edges_assignment.len() != fold.edges_vertices.len() {
        return Err(format!(
            "FOLD has {} edges but {} assignments",
            fold.edges_vertices.len(),
            fold.edges_assignment.len()
        ));
    }
    if let Some(bad) = fold
        .edges_vertices
        .iter()
        .position(|e| e[0] >= n || e[1] >= n)
    {
        return Err(format!("edge {bad} names a vertex that does not exist"));
    }
    if let Some(bad) = fold.edges_vertices.iter().position(|e| e[0] == e[1]) {
        return Err(format!("edge {bad} starts and ends at the same vertex"));
    }
    Ok(())
}

fn fold_to_exact_solve_input(fold: &FoldDocument) -> Result<(ExactSolveInput, Similarity), String> {
    let raw: Vec<Point2> = fold
        .vertices_coords
        .iter()
        .map(|v| Point2::new(v[0], v[1]))
        .collect();
    if raw.is_empty() {
        return Err("empty FOLD".to_owned());
    }
    let plan = plan_boundary(fold, &raw)?;
    Ok(build_input(fold, &raw, plan))
}

/// Assemble the `ExactSolveInput` from a boundary plan. Split out so the polygon
/// path can be exercised directly in tests.
fn build_input(
    fold: &FoldDocument,
    raw: &[Point2],
    plan: BoundaryPlan,
) -> (ExactSolveInput, Similarity) {
    let n = raw.len();
    let pts: Vec<Point2> = raw.iter().map(|&p| plan.xform.apply(p)).collect();
    let corner_set: std::collections::BTreeSet<usize> = plan.corners.iter().copied().collect();
    let is_corner = |i: usize| corner_set.contains(&i);

    let vertices: Vec<CandidateVertex> = (0..n)
        .map(|i| {
            let p = pts[i];
            let side = if is_corner(i) {
                None
            } else {
                plan.vertex_side[i]
            };
            let (kind, policy) = if is_corner(i) {
                (
                    CandidateVertexKind::Corner,
                    CandidateVertexMovementPolicy::Locked,
                )
            } else if side.is_some() {
                (
                    CandidateVertexKind::BoundaryContact,
                    CandidateVertexMovementPolicy::BoundaryOnly,
                )
            } else {
                (
                    CandidateVertexKind::InteriorJunction,
                    CandidateVertexMovementPolicy::Movable,
                )
            };
            CandidateVertex {
                id: i,
                point: p,
                kind,
                support: 1.0,
                movement_policy: policy,
                boundary_side: side,
                source_vertex_ids: vec![i],
                source_carrier_ids: vec![],
                source_adapter: CandidateSourceAdapter::Legacy,
                provenance: vec![Provenance::LegacyDecoder],
            }
        })
        .collect();

    let mut spans = Vec::with_capacity(fold.edges_vertices.len());
    let mut border_span_ids = Vec::new();
    let mut carrier_ids = BTreeMap::new();
    for (id, edge) in fold.edges_vertices.iter().enumerate() {
        let (a, b) = (edge[0], edge[1]);
        let label = assignment_label(fold.edges_assignment[id]);
        let (carrier, t_interval) = carrier_from(pts[a], pts[b]);
        let is_border = label == AssignmentLabel::Boundary;
        if is_border {
            border_span_ids.push(id);
        }
        // Collinear folding creases share a carrier (same angle/rho bin the solver
        // uses) so pass-through creases stay straight during the solve.
        let source_carrier_ids = if is_border {
            vec![]
        } else {
            vec![carrier_id_for(&mut carrier_ids, &carrier)]
        };
        spans.push(CandidateCreaseSpan {
            id,
            kind: if is_border {
                CandidateCreaseSpanKind::BorderSpan
            } else {
                CandidateCreaseSpanKind::AtomicInterval
            },
            vertices: [a, b],
            carrier,
            t_interval,
            assignment_evidence: evidence(label),
            presence_probability: 0.99,
            line_support_min: 1.0,
            line_support_mean: 1.0,
            line_support_max: 1.0,
            style_support: 0.0,
            non_crease_support: 0.0,
            source_kind: if is_border {
                CandidateCreaseSourceKind::BorderGenerated
            } else {
                CandidateCreaseSourceKind::LegacySelected
            },
            selection_policy: CandidateSelectionPolicy::Locked,
            boundary_role: Default::default(),
            source_edge_ids: vec![id],
            source_atomic_edge_ids: vec![id],
            source_carrier_ids,
            replaced_span_ids: vec![],
            replaced_atomic_edge_ids: vec![],
            collapsed_vertex_ids: vec![],
            provenance: vec![Provenance::LegacyDecoder],
            reasons: vec![],
        });
    }

    let sides: Vec<BoundarySideModel> = plan
        .sides
        .iter()
        .map(|(side, pair, contacts)| BoundarySideModel {
            side: *side,
            corner_vertices: *pair,
            contact_vertices: contacts.clone(),
        })
        .collect();

    let input = ExactSolveInput {
        schema: "oristudio/cp-compiler/exact-solve-input-v1".to_owned(),
        coordinate_space: "fold_normalized".to_owned(),
        image_size: None,
        vertices,
        selected_spans: spans,
        boundary: BoundaryModel {
            corners: plan.corners,
            sides,
            generated_border_span_ids: border_span_ids,
            reconstruction_policy: plan.policy,
        },
        cost_model: CostModel::default(),
        provenance: CandidateGraphProvenance {
            source_adapter: CandidateSourceAdapter::Legacy,
            source_ids: vec![],
            notes: vec!["treemaker fold_exactize".to_owned()],
        },
    };
    (input, plan.xform)
}

/// The paper boundary as a 4-corner cycle: the full boundary loop plus the four
/// corner vertex ids in loop order.
struct QuadBoundary {
    loop_ids: Vec<usize>,
    corners: [usize; 4],
}

/// Trace the `B`-edge boundary loop and pick the four sharpest-turn corners.
fn detect_quad(fold: &FoldDocument, raw: &[Point2]) -> Result<QuadBoundary, String> {
    let n = raw.len();
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (id, edge) in fold.edges_vertices.iter().enumerate() {
        if fold.edges_assignment[id] == Assignment::Boundary {
            adj[edge[0]].push(edge[1]);
            adj[edge[1]].push(edge[0]);
        }
    }
    if adj.iter().any(|a| !a.is_empty() && a.len() != 2) {
        return Err("paper boundary is not a simple cycle".to_owned());
    }
    let start = (0..n)
        .find(|&i| !adj[i].is_empty())
        .ok_or("no paper boundary")?;

    let mut loop_ids = vec![start];
    let mut prev = start;
    let mut cur = adj[start][0];
    while cur != start && loop_ids.len() <= n {
        loop_ids.push(cur);
        let next = *adj[cur].iter().find(|&&x| x != prev).unwrap_or(&prev);
        prev = cur;
        cur = next;
    }
    let m = loop_ids.len();

    let mut turns: Vec<(f64, usize)> = (0..m)
        .map(|k| {
            let a = raw[loop_ids[(k + m - 1) % m]];
            let b = raw[loop_ids[k]];
            let c = raw[loop_ids[(k + 1) % m]];
            let v1 = (b.x - a.x, b.y - a.y);
            let v2 = (c.x - b.x, c.y - b.y);
            let dot = v1.0 * v2.0 + v1.1 * v2.1;
            let cross = v1.0 * v2.1 - v1.1 * v2.0;
            (cross.atan2(dot).abs().to_degrees(), loop_ids[k])
        })
        .collect();
    turns.sort_by(|a, b| b.0.total_cmp(&a.0));
    if turns.len() < 4 || turns[3].0 < CORNER_TURN_DEGREES {
        return Err("paper is not a 4-corner quadrilateral".to_owned());
    }

    // Corners in polygon (loop) order so corner0->corner1 is a side.
    let mut corner_ids: Vec<usize> = turns.iter().take(4).map(|t| t.1).collect();
    corner_ids.sort_by_key(|c| loop_ids.iter().position(|x| x == c).unwrap());
    Ok(QuadBoundary {
        loop_ids,
        corners: [corner_ids[0], corner_ids[1], corner_ids[2], corner_ids[3]],
    })
}

/// Choose a boundary plan: the unit-square path when the paper is (a rotation of)
/// a square, else the general convex-quadrilateral polygon path.
fn plan_boundary(fold: &FoldDocument, raw: &[Point2]) -> Result<BoundaryPlan, String> {
    let quad = detect_quad(fold, raw)?;
    if let Some(plan) = square_plan(raw, &quad) {
        return Ok(plan);
    }
    if ENABLE_POLYGON_EXACTIZE {
        polygon_plan(raw, &quad)
    } else {
        Err("non-square paper is not yet supported".to_owned())
    }
}

/// The similarity that de-rotates `corner0 -> corner1` onto the +x axis and scales
/// that side to length 1, reflecting so the paper lands in +y.
fn corner_aligned_transform(raw: &[Point2], corners: &[usize; 4]) -> Option<Similarity> {
    let c0 = raw[corners[0]];
    let c1 = raw[corners[1]];
    let ex = (c1.x - c0.x, c1.y - c0.y);
    let side = (ex.0 * ex.0 + ex.1 * ex.1).sqrt();
    // `!(side > 0.0)` rather than `side <= 0.0`, so a NaN scale is refused too.
    // Finite coordinates are not enough to guarantee a finite difference: two
    // corners at opposite ends of the f64 range overflow to an infinite `side`,
    // whose reciprocal makes every transformed point NaN — which used to reach a
    // `partial_cmp().unwrap()` further down.
    if side <= 0.0 || !side.is_finite() {
        return None;
    }
    let ux = (ex.0 / side, ex.1 / side);
    let uy = (-ux.1, ux.0);
    let mut xform = Similarity {
        origin: c0,
        ux,
        uy,
        side,
        flip: 1.0,
    };
    if xform.apply(raw[corners[2]]).y < 0.0 {
        xform.flip = -1.0;
    }
    Some(xform)
}

/// Unit-square plan (`LockedUnitSquareSortedContacts`), only when the four corners
/// map onto the axis-aligned unit square. `None` for non-square paper.
fn square_plan(raw: &[Point2], quad: &QuadBoundary) -> Option<BoundaryPlan> {
    let xform = corner_aligned_transform(raw, &quad.corners)?;
    let targets = [
        Point2::new(0.0, 0.0),
        Point2::new(1.0, 0.0),
        Point2::new(1.0, 1.0),
        Point2::new(0.0, 1.0),
    ];
    let corners: [usize; 4] = targets.map(|t| {
        *quad
            .corners
            .iter()
            .min_by(|&&i, &&j| {
                let di = (xform.apply(raw[i]).x - t.x).hypot(xform.apply(raw[i]).y - t.y);
                let dj = (xform.apply(raw[j]).x - t.x).hypot(xform.apply(raw[j]).y - t.y);
                di.total_cmp(&dj)
            })
            .unwrap()
    });
    let max_err = targets
        .iter()
        .zip(corners.iter())
        .map(|(t, &c)| {
            let p = xform.apply(raw[c]);
            (p.x - t.x).hypot(p.y - t.y)
        })
        .fold(0.0_f64, f64::max);
    if max_err > UNIT_SQUARE_CORNER_TOLERANCE {
        return None;
    }

    let n = raw.len();
    let pts: Vec<Point2> = raw.iter().map(|&p| xform.apply(p)).collect();
    let corner_set: std::collections::BTreeSet<usize> = corners.iter().copied().collect();
    let vertex_side: Vec<Option<BoundarySide>> = (0..n)
        .map(|i| {
            if corner_set.contains(&i) {
                None
            } else {
                side_of(pts[i])
            }
        })
        .collect();
    let sides = BoundarySide::all()
        .into_iter()
        .map(|side| {
            let pair = match side {
                BoundarySide::Top => [corners[0], corners[1]],
                BoundarySide::Right => [corners[1], corners[2]],
                BoundarySide::Bottom => [corners[3], corners[2]],
                BoundarySide::Left => [corners[0], corners[3]],
            };
            let mut contacts: Vec<usize> =
                (0..n).filter(|&i| vertex_side[i] == Some(side)).collect();
            contacts.sort_by(|&i, &j| {
                let key = |k: usize| match side {
                    BoundarySide::Top | BoundarySide::Bottom => pts[k].x,
                    BoundarySide::Left | BoundarySide::Right => pts[k].y,
                };
                key(i).total_cmp(&key(j))
            });
            (side, pair, contacts)
        })
        .collect();
    Some(BoundaryPlan {
        xform,
        policy: BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts,
        corners,
        sides,
        vertex_side,
    })
}

/// Convex-quadrilateral plan (`Polygon`): corners pinned to their (uniformly
/// scaled, un-rotated) positions; boundary vertices assigned to sides by walking
/// the loop between consecutive corners.
fn polygon_plan(raw: &[Point2], quad: &QuadBoundary) -> Result<BoundaryPlan, String> {
    // Require convexity: all four corner turns share a sign.
    let c: Vec<Point2> = quad.corners.iter().map(|&i| raw[i]).collect();
    let mut sign = 0.0_f64;
    for k in 0..4 {
        let a = c[k];
        let b = c[(k + 1) % 4];
        let d = c[(k + 2) % 4];
        let cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
        if sign == 0.0 {
            sign = cross;
        } else if sign * cross < 0.0 {
            return Err("paper is not a convex quadrilateral".to_owned());
        }
    }

    // Uniform scale so the first paper side has length 1 (matching the square
    // path's scale, so the solver's absolute sigmas behave the same), keeping the
    // paper's rotation. Translate corner0 to the origin.
    let c0 = c[0];
    let side_len = (c[1].x - c0.x).hypot(c[1].y - c0.y);
    if side_len <= 0.0 {
        return Err("degenerate paper side".to_owned());
    }
    let xform = Similarity {
        origin: c0,
        ux: (1.0, 0.0),
        uy: (0.0, 1.0),
        side: side_len,
        flip: 1.0,
    };

    let n = raw.len();
    let corner_pos: std::collections::BTreeMap<usize, usize> = quad
        .corners
        .iter()
        .map(|&c| (c, quad.loop_ids.iter().position(|x| *x == c).unwrap()))
        .collect();
    let m = quad.loop_ids.len();
    let mut vertex_side = vec![None; n];
    let mut sides = Vec::with_capacity(4);
    for (i, label) in BoundarySide::all().into_iter().enumerate() {
        let a = quad.corners[i];
        let b = quad.corners[(i + 1) % 4];
        // Walk the loop from corner a to corner b; the vertices between are contacts.
        let start = corner_pos[&a];
        let mut contacts = Vec::new();
        let mut k = (start + 1) % m;
        while quad.loop_ids[k] != b {
            let vid = quad.loop_ids[k];
            contacts.push(vid);
            vertex_side[vid] = Some(label);
            k = (k + 1) % m;
        }
        sides.push((label, [a, b], contacts));
    }

    Ok(BoundaryPlan {
        xform,
        policy: BoundaryReconstructionPolicy::Polygon,
        corners: quad.corners,
        sides,
        vertex_side,
    })
}

fn carrier_from(a: Point2, b: Point2) -> (CandidateCarrierGeometry, [f64; 2]) {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let len = (dx * dx + dy * dy).sqrt().max(1e-12);
    let dir = Point2::new(dx / len, dy / len);
    let mut normal = Point2::new(dir.y, -dir.x);
    let mut rho = a.x * normal.x + a.y * normal.y;
    if rho < 0.0 {
        normal = Point2::new(-normal.x, -normal.y);
        rho = -rho;
    }
    let ta = a.x * dir.x + a.y * dir.y;
    let tb = b.x * dir.x + b.y * dir.y;
    (
        CandidateCarrierGeometry {
            normal,
            direction: dir,
            rho,
        },
        [ta.min(tb), ta.max(tb)],
    )
}

/// The bin a carrier line falls in — the same 0.01 rad / 0.0025 grid the
/// solver's `CarrierGroupKey::Geometry` uses — so collinear creases share one.
fn carrier_bin(carrier: &CandidateCarrierGeometry) -> (i64, i64) {
    let rho_bin = (carrier.rho / 0.0025).round() as i64;
    let mut theta = carrier.normal.y.atan2(carrier.normal.x);
    // A line through the frame's origin has no offset, so the sign rule
    // `carrier_from` orients a normal by (rho >= 0) does not pick a direction
    // for it: the two halves of such a crease, drawn towards and away from the
    // origin, had normals a half-turn apart and were two carriers. Where the
    // offset bin is zero the angle is folded to a half-turn, where they are one.
    if rho_bin == 0 {
        theta = theta.rem_euclid(std::f64::consts::PI);
    }
    ((theta / 0.01).round() as i64, rho_bin)
}

/// A small, dense id per distinct bin, in first-seen order.
///
/// This used to be a hash of the bin folded into a `usize` — the angle bin
/// shifted by 20 bits, XOR the offset bin — which put a negative angle's id
/// just under 2^64. Two things broke on that. A `usize` is 32 bits in wasm, so
/// the same crease had a different id on the web than on the desktop. And a
/// JavaScript number holds 53 bits, so on the desktop, where the input crosses
/// the page as JSON between the rebuild and the solve, neighbouring ids rounded
/// to one value: on a 327-crease pattern two unrelated creases became one
/// carrier, the polish pinned them to one line, and the solve was refused for
/// seven crossings the pattern did not have. Dense ids fit every integer type
/// on every path; the solver reads them for equality only.
fn carrier_id_for(
    ids: &mut BTreeMap<(i64, i64), usize>,
    carrier: &CandidateCarrierGeometry,
) -> usize {
    let next = ids.len();
    *ids.entry(carrier_bin(carrier)).or_insert(next)
}

fn side_of(p: Point2) -> Option<BoundarySide> {
    let on = |v: f64, t: f64| (v - t).abs() < 1e-6;
    if on(p.y, 0.0) {
        Some(BoundarySide::Top)
    } else if on(p.y, 1.0) {
        Some(BoundarySide::Bottom)
    } else if on(p.x, 0.0) {
        Some(BoundarySide::Left)
    } else if on(p.x, 1.0) {
        Some(BoundarySide::Right)
    } else {
        None
    }
}

fn assignment_label(a: Assignment) -> AssignmentLabel {
    match a {
        Assignment::Mountain => AssignmentLabel::Mountain,
        Assignment::Valley => AssignmentLabel::Valley,
        Assignment::Boundary => AssignmentLabel::Boundary,
        Assignment::Flat => AssignmentLabel::Flat,
        _ => AssignmentLabel::Unknown,
    }
}

fn evidence(label: AssignmentLabel) -> AssignmentEvidence {
    let mut e = AssignmentEvidence {
        mountain: 0.01,
        valley: 0.01,
        boundary: 0.01,
        auxiliary: 0.01,
        unknown: 0.02,
        observed_label: label,
        source: AssignmentEvidenceSource::LegacyColor,
        confidence: 0.999,
        margin: 0.99,
        ink_label: None,
    };
    match label {
        AssignmentLabel::Mountain => e.mountain = 0.999,
        AssignmentLabel::Valley => e.valley = 0.999,
        AssignmentLabel::Boundary => e.boundary = 0.999,
        _ => e.unknown = 0.999,
    }
    e
}

fn max_movement(before: &[Point2], after: &[Point2]) -> f64 {
    before
        .iter()
        .zip(after.iter())
        .map(|(b, a)| (a.x - b.x).hypot(a.y - b.y))
        .fold(0.0_f64, f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{analyze_candidate_topology, solve_exact};
    use treemaker_core::Tree;

    fn square_fold() -> FoldDocument {
        let mut tree = Tree::from_tmd_str(include_str!(
            "../../treemaker-core/testdata/tmModelTester_5.tmd5"
        ))
        .unwrap();
        tree.optimize_scale().unwrap();
        tree.build_polys_and_crease_pattern().unwrap();
        tree.to_fold_document().unwrap()
    }

    fn options() -> ExactSolveOptions {
        ExactSolveOptions {
            timeout_seconds: -1.0,
            ..Default::default()
        }
    }

    /// Reproduces the open bug in the convex-polygon path: forcing `Polygon` on the
    /// rotated raw square CP currently *worsens* CAMV (20 -> 134 violations) rather
    /// than clearing it, so `ENABLE_POLYGON_EXACTIZE` is off and non-square paper
    /// falls back. Ignored until the polygon solve is fixed; kept as the repro.
    #[test]
    #[ignore = "convex-polygon exactize path is not yet correct (worsens CAMV); see ENABLE_POLYGON_EXACTIZE"]
    fn polygon_path_clears_camv_on_rotated_square() {
        let fold = square_fold();
        let raw: Vec<Point2> = fold
            .vertices_coords
            .iter()
            .map(|v| Point2::new(v[0], v[1]))
            .collect();
        let quad = detect_quad(&fold, &raw).unwrap();
        let poly = polygon_plan(&raw, &quad).unwrap();
        assert_eq!(poly.policy, BoundaryReconstructionPolicy::Polygon);

        let (before, _) = camv_counts(&fold);
        assert!(before > 0, "precondition: raw CP fails CAMV");

        let (input, xform) = build_input(&fold, &raw, poly);
        let solved = solve_exact(&input, options());
        let mut out = export_exact_solved_to_fold_document(&input, &solved).unwrap();
        for coord in &mut out.vertices_coords {
            let p = xform.invert(Point2::new(coord[0], coord[1]));
            coord[0] = p.x;
            coord[1] = p.y;
        }
        let (after, _) = camv_counts(&out);
        assert_eq!(
            after, 0,
            "polygon-exactized CP still has {after} CAMV violations (before {before})"
        );
    }

    /// A hand-built square with one interior vertex, in document-ish coordinates.
    /// Not the unit square, so the transform has real work to do.
    fn simple_square() -> FoldDocument {
        let mut fold = FoldDocument::new(
            vec![
                vec![-200.0, -200.0],
                vec![200.0, -200.0],
                vec![200.0, 200.0],
                vec![-200.0, 200.0],
                vec![0.0, 0.0],
            ],
            vec![
                [0, 1],
                [1, 2],
                [2, 3],
                [3, 0],
                [0, 4],
                [1, 4],
                [2, 4],
                [3, 4],
            ],
        );
        fold.edges_assignment = vec![
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Boundary,
            Assignment::Mountain,
            Assignment::Valley,
            Assignment::Mountain,
            Assignment::Valley,
        ];
        fold.edges_fold_angle = vec![None; 8];
        fold
    }

    /// The carrier id used to be a hash folded into a `usize`, which put a
    /// negative angle's id just under 2^64: different on wasm's 32-bit `usize`
    /// than on the desktop, and beyond what a JavaScript number holds, so the
    /// JSON trip through the page rounded neighbouring ids together and the
    /// solver pinned unrelated creases to one line — seven spurious crossings on
    /// a 327-crease pattern. Dense ids survive every path.
    #[test]
    fn carrier_ids_are_dense_and_survive_a_javascript_number_round_trip() {
        let fold = simple_square();
        let (input, _) = exact_solve_input_from_fold(&fold).unwrap();
        let ids: Vec<Option<usize>> = input
            .selected_spans
            .iter()
            .map(|span| span.source_carrier_ids.first().copied())
            .collect();
        // Borders carry no carrier; the two diagonals are two carriers, each
        // shared by its two halves, numbered densely from zero.
        assert_eq!(ids[..4], [None, None, None, None]);
        assert_eq!(ids[4], ids[6]);
        assert_eq!(ids[5], ids[7]);
        assert_ne!(ids[4], ids[5]);
        assert_eq!(ids[4..].iter().flatten().max().copied(), Some(1));

        // Nothing in the serialized input is beyond 2^53, and rounding every
        // integer through a double — what `JSON.parse` does — changes nothing.
        let value = serde_json::to_value(&input).unwrap();
        fn max_integer(value: &serde_json::Value) -> u64 {
            match value {
                serde_json::Value::Array(items) => items.iter().map(max_integer).max().unwrap_or(0),
                serde_json::Value::Object(map) => map.values().map(max_integer).max().unwrap_or(0),
                serde_json::Value::Number(number) => number.as_u64().unwrap_or(0),
                _ => 0,
            }
        }
        assert!(max_integer(&value) < (1u64 << 53));
        let rounded: ExactSolveInput = serde_json::from_value(
            serde_json::from_str(&serde_json::to_string(&value).unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(
            rounded
                .selected_spans
                .iter()
                .map(|span| span.source_carrier_ids.clone())
                .collect::<Vec<_>>(),
            input
                .selected_spans
                .iter()
                .map(|span| span.source_carrier_ids.clone())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn rebuilds_an_input_from_a_document_fold_and_round_trips_its_frame() {
        let fold = simple_square();
        let (input, xform) = exact_solve_input_from_fold(&fold).unwrap();

        assert_eq!(input.vertices.len(), 5);
        assert_eq!(input.selected_spans.len(), 8);
        // The paper is 400 units across and lands on the unit square.
        assert!((xform.side - 400.0).abs() < 1e-9, "side {}", xform.side);

        // Every vertex maps back onto the coordinate it came from. This is the
        // half the browser owns: it solves in the unit square and has to put the
        // answer back where the user's creases are.
        for (i, vertex) in input.vertices.iter().enumerate() {
            let back = xform.invert(vertex.point);
            assert!(
                (back.x - fold.vertices_coords[i][0]).abs() < 1e-9
                    && (back.y - fold.vertices_coords[i][1]).abs() < 1e-9,
                "vertex {i} round-tripped to ({}, {})",
                back.x,
                back.y
            );
        }
    }

    /// The bug this adapter was made public for.
    ///
    /// A detection attaches an input at import; the user then repairs the
    /// topology. Solving the attachment reports blockers they already fixed —
    /// here, the odd-degree vertex left by a missing crease. Rebuilding from the
    /// document sees the repair.
    #[test]
    fn a_repaired_topology_reaches_the_solver() {
        let mut broken = simple_square();
        // Drop one of the four creases at the interior vertex: degree 3, odd.
        broken.edges_vertices.remove(7);
        broken.edges_assignment.remove(7);
        broken.edges_fold_angle.remove(7);
        let (stale, _) = exact_solve_input_from_fold(&broken).unwrap();
        assert_eq!(
            analyze_candidate_topology(&stale)
                .combinatorial
                .odd_degree_vertices,
            vec![4],
            "precondition: the unrepaired pattern has an odd-degree vertex"
        );

        // The user draws the missing crease back in. Same adapter, live geometry.
        let (repaired, _) = exact_solve_input_from_fold(&simple_square()).unwrap();
        assert!(
            analyze_candidate_topology(&repaired)
                .combinatorial
                .odd_degree_vertices
                .is_empty(),
            "the repair must be visible to the solver"
        );
    }

    /// Coordinates can be finite and still make the frame NaN: two corners at
    /// opposite ends of the f64 range overflow in the subtraction, so the paper
    /// side is infinite and every transformed point is NaN. That used to reach a
    /// `partial_cmp().unwrap()` in the boundary-contact sort — a panic no input
    /// validation on the *vertices* would have caught.
    #[test]
    fn an_overflowing_paper_is_refused_rather_than_going_nan() {
        let mut fold = simple_square();
        fold.vertices_coords[0] = vec![-f64::MAX, -f64::MAX];
        fold.vertices_coords[2] = vec![f64::MAX, f64::MAX];
        assert_eq!(
            exact_solve_input_from_fold(&fold).err().as_deref(),
            Some("non-square paper is not yet supported")
        );
    }

    /// Every one of these used to be an index panic, which over the wasm bridge
    /// is a trap that kills the worker with no message the UI can show.
    #[test]
    fn a_malformed_fold_is_refused_rather_than_panicking() {
        let cases: Vec<(&str, FoldDocument)> = vec![
            ("empty FOLD", FoldDocument::new(vec![], vec![])),
            ("vertex 1 has fewer than 2 coordinates", {
                let mut f = simple_square();
                f.vertices_coords[1] = vec![0.0];
                f
            }),
            ("vertex 2 is not finite", {
                let mut f = simple_square();
                f.vertices_coords[2] = vec![f64::NAN, 0.0];
                f
            }),
            ("FOLD has 8 edges but 7 assignments", {
                let mut f = simple_square();
                f.edges_assignment.pop();
                f
            }),
            ("edge 4 names a vertex that does not exist", {
                let mut f = simple_square();
                f.edges_vertices[4] = [0, 99];
                f
            }),
            ("edge 5 starts and ends at the same vertex", {
                let mut f = simple_square();
                f.edges_vertices[5] = [3, 3];
                f
            }),
        ];
        for (expected, fold) in cases {
            assert_eq!(
                exact_solve_input_from_fold(&fold).err().as_deref(),
                Some(expected)
            );
        }
    }
}
