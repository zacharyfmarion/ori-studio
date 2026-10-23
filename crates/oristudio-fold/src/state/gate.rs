//! The gate every state passes (research §3.3, plan D4): the checks
//! [`super::State::make`] runs, in order, each refusal naming what failed.
//!
//! 1. Structure: no more faces than the layer order's cap
//!    (`oristudio_layer_order::MAX_FACES`), a view at a finite angle, unique
//!    ids, a root, every ring side a crease, every crease bounding one face
//!    (border) or two.
//! 2. Faces convex and counter-clockwise in sheet coordinates, covering the
//!    sheet: every vertex finite and on it, every border crease along one of
//!    its sides, every crease mark on it and along no crease or other mark
//!    (`crate::crease_marks`), and the faces' areas adding up to its area.
//!    With the faces on both sides of every other crease (step 5), that is
//!    coverage: the border winds once around the sheet, so each point of it
//!    lies in one face.
//! 3. Isometries from the root, whose own isometry must be a rigid motion,
//!    every vertex landing in one place (residual ≤ tol).
//! 4. Hinge consistency: a folded crease joins faces of opposite orientation,
//!    a flat one faces of the same. The residual alone once admitted a state
//!    that broke this (the squash spike, research §3.3).
//! 5. The folded image as the layer order sees it: convex face images, every
//!    crease on the boundary of both its faces with the sides its kind says.
//! 6. The constraint problem, built within the stacking cap
//!    (`oristudio_layer_order::MAX_STACKED_TRIPLES`): layers stacked too
//!    deeply for their order to be worked out are refused once their
//!    overlaps are counted, before a constraint is enumerated.
//! 7. The layer order through `oristudio-layer-order`'s checker: complete on
//!    overlapping pairs, transitive in every cell, the taco-taco,
//!    taco-tortilla and tortilla-tortilla families, and every letter derived
//!    from the order.
//!
//! Steps 1–5 are [`before_order`], which `Unordered` also runs on parts whose
//! order is still to be decided, and step 6 with them.

use std::collections::BTreeSet;
use std::sync::Arc;

use oristudio_geometry::convex;
use oristudio_layer_order::{
    ConstraintProblem, Edge, EdgeKind, Face as ViewFace, FacePair, FoldedView, LayerOrder,
    LayerOrderError, MAX_FACES, MAX_STACKED_TRIPLES, Scope, Violation, check_problem,
};

use crate::numerics::TOL;
use crate::pattern::{CreaseKind, EdgeId, FaceId, VertexId};
use crate::refusal::FoldRefusal;
use crate::state::derive::{Geometry, Topology};
use crate::state::{Derived, State, StateParts};

/// Run the gate. With a previous state and the faces an operation touched,
/// the layer-order problem is rebuilt incrementally and its constraints are
/// checked where they involve a touched face, or depend on one without
/// naming it (`ConstraintProblem::scope_for`); pair completeness is always
/// checked in full, so a pair an operation forgot to carry is never missed.
/// A `prebuilt` problem is that rebuild, done already for these faces; one
/// for other faces is not used.
pub(super) fn run(
    parts: &StateParts,
    previous: Option<(&State, &BTreeSet<FaceId>)>,
    prebuilt: Option<Arc<ConstraintProblem>>,
) -> Result<Derived, FoldRefusal> {
    let BeforeOrder {
        topology,
        geometry,
        view,
        edge_creases,
    } = before_order(parts, &BTreeSet::new())?;

    let prebuilt = prebuilt.filter(|problem| problem.is_for(&view));
    let refused = |e: LayerOrderError| folded_image(&e, parts, &topology, &edge_creases);
    let (problem, scope_faces) = match previous {
        Some((previous, touched)) => {
            let touched = touched_scope(parts, previous, touched);
            let problem = match prebuilt {
                Some(problem) => problem,
                None => Arc::new(
                    previous
                        .derived
                        .problem
                        .rebuild_within(&view, &touched, MAX_STACKED_TRIPLES)
                        .map_err(refused)?,
                ),
            };
            // Not only the touched faces: a constraint can be new over faces
            // it does not name (an unfold beside a folded crease's line).
            let scope = problem.scope_for(&touched);
            (problem, Some(scope))
        }
        None => match prebuilt {
            Some(problem) => (problem, None),
            None => (
                Arc::new(
                    ConstraintProblem::build_within(&view, MAX_STACKED_TRIPLES).map_err(refused)?,
                ),
                None,
            ),
        },
    };
    let scope = match &scope_faces {
        Some(faces) => Scope::Faces(faces),
        None => Scope::All,
    };
    let report = check_problem(&problem, &view, &parts.order, scope).map_err(refused)?;
    let mut violations: BTreeSet<Violation> = report.violations.into_iter().collect();
    if scope_faces.is_some() {
        violations.extend(pair_completeness(&problem, &parts.order));
    }
    if !violations.is_empty() {
        return Err(FoldRefusal::LayerOrder {
            violations: violations.into_iter().collect(),
        });
    }
    Ok(Derived {
        topology,
        geometry,
        view,
        problem,
    })
}

/// The faces an incremental rebuild takes as touched: those an operation
/// touched, and any `previous` does not have. The check covers
/// `ConstraintProblem::scope_for` them.
pub(crate) fn touched_scope(
    parts: &StateParts,
    previous: &State,
    touched: &BTreeSet<FaceId>,
) -> BTreeSet<FaceId> {
    let mut scope: BTreeSet<FaceId> = touched.clone();
    scope.extend(
        parts
            .faces
            .iter()
            .map(|f| f.id)
            .filter(|&id| previous.face_position(id).is_none()),
    );
    scope
}

/// What steps 1–5 derive: everything the layer order does not decide.
pub(crate) struct BeforeOrder {
    pub(crate) topology: Topology,
    pub(crate) geometry: Geometry,
    /// The folded image as the layer order sees it.
    pub(crate) view: FoldedView,
    /// Per folded-view edge, its crease's position.
    pub(crate) edge_creases: Vec<usize>,
}

/// Steps 1–5 on parts whose faces and creases are in id order; their order
/// is not read. A folded crease in `unknown` enters the folded view without
/// a letter, for the order to decide (`crate::unordered`); the gate itself
/// passes none.
pub(crate) fn before_order(
    parts: &StateParts,
    unknown: &BTreeSet<EdgeId>,
) -> Result<BeforeOrder, FoldRefusal> {
    // Before anything is derived: every table the layer order builds is over
    // the faces' pairs.
    if parts.faces.len() > MAX_FACES {
        return Err(FoldRefusal::TooManyFaces {
            face_count: parts.faces.len(),
            limit: MAX_FACES,
        });
    }
    if !parts.view.rotation.is_finite() {
        return Err(FoldRefusal::ViewNotFinite);
    }
    for pair in parts.faces.windows(2) {
        if pair[0].id == pair[1].id {
            return Err(FoldRefusal::DuplicateId {
                what: "face",
                id: pair[0].id.0,
            });
        }
    }
    for pair in parts.creases.windows(2) {
        if pair[0].id == pair[1].id {
            return Err(FoldRefusal::DuplicateId {
                what: "crease",
                id: pair[0].id.0,
            });
        }
    }
    let root = parts
        .faces
        .binary_search_by_key(&parts.root, |f| f.id)
        .map_err(|_| FoldRefusal::UnknownRoot { face: parts.root })?;

    let topology = Topology::build(parts)?;

    on_the_sheet(parts)?;
    crate::crease_marks::check(parts)?;
    let mut area = 0.0;
    for face in &parts.faces {
        let ring: Vec<[f64; 2]> = face
            .ring
            .iter()
            .map(|v| parts.vertices[v.index()])
            .collect();
        if !convex::is_convex(&ring, TOL) {
            return Err(FoldRefusal::NonConvexFace { face: face.id });
        }
        area += convex::signed_area(&ring);
    }
    let sheet_area = parts.sheet.area();
    if (area - sheet_area).abs() > TOL {
        return Err(FoldRefusal::AreaMismatch {
            faces_area: area,
            sheet_area,
        });
    }

    // Every isometry is derived from the root's, so they all agree whatever
    // it is; only a rigid one makes them isometries.
    if !parts.root_isometry.is_rigid(TOL) {
        return Err(FoldRefusal::RootNotRigid { face: parts.root });
    }
    let geometry = Geometry::derive(parts, &topology, root, TOL)?;

    let mut edges = Vec::new();
    let mut edge_creases = Vec::new();
    for (k, crease) in parts.creases.iter().enumerate() {
        if crease.kind == CreaseKind::Border {
            continue;
        }
        let [f, g] = [topology.crease_faces[k][0], topology.crease_faces[k][1]];
        let folded = crease.kind.is_folded();
        let (f_up, g_up) = (
            geometry.isometries[f].front_up(),
            geometry.isometries[g].front_up(),
        );
        if folded == (f_up == g_up) {
            return Err(FoldRefusal::HingeOrientation {
                edge: crease.id,
                faces: [parts.faces[f].id, parts.faces[g].id],
                kind: if folded { "folded" } else { "flat" },
            });
        }
        let t = &geometry.isometries[f];
        edges.push(Edge {
            faces: [parts.faces[f].id, parts.faces[g].id],
            segment: crease.vertices.map(|v| t.apply(parts.vertices[v.index()])),
            kind: match crease.kind {
                CreaseKind::Folded(_) if unknown.contains(&crease.id) => EdgeKind::Folded(None),
                CreaseKind::Folded(letter) => EdgeKind::Folded(Some(letter)),
                _ => EdgeKind::Flat,
            },
        });
        edge_creases.push(k);
    }
    let faces = parts
        .faces
        .iter()
        .zip(&geometry.images)
        .zip(&geometry.isometries)
        .map(|((face, image), t)| ViewFace {
            id: face.id,
            polygon: image.clone(),
            front_up: t.front_up(),
        })
        .collect();
    let view = FoldedView::new(faces, edges)
        .map_err(|e| folded_image(&e, parts, &topology, &edge_creases))?;
    Ok(BeforeOrder {
        topology,
        geometry,
        view,
        edge_creases,
    })
}

/// Every vertex finite and on the sheet (outside it by at most the
/// tolerance), and every border crease along one of the sheet's sides. Runs
/// after [`Topology::build`], which found every crease's vertices.
fn on_the_sheet(parts: &StateParts) -> Result<(), FoldRefusal> {
    let sheet = &parts.sheet;
    for (v, p) in parts.vertices.iter().enumerate() {
        // A NaN coordinate compares as inside, so finiteness comes first.
        if !(p[0].is_finite() && p[1].is_finite() && sheet.contains(*p, -TOL)) {
            return Err(FoldRefusal::VertexOffSheet {
                vertex: VertexId(v as u32),
            });
        }
    }
    let outline = sheet.outline();
    let sides: Vec<convex::HalfPlane> = (0..outline.len())
        .filter_map(|i| convex::HalfPlane::left_of(outline[i], outline[(i + 1) % outline.len()]))
        .collect();
    for crease in parts
        .creases
        .iter()
        .filter(|c| c.kind == CreaseKind::Border)
    {
        let ends = crease.vertices.map(|v| parts.vertices[v.index()]);
        let along =
            |side: &convex::HalfPlane| ends.iter().all(|&p| side.signed_distance(p).abs() <= TOL);
        if !sides.iter().any(along) {
            return Err(FoldRefusal::BorderOffOutline { edge: crease.id });
        }
    }
    Ok(())
}

/// Missing, undetermined and extra pairs over the whole state, by one merge
/// of two sorted lists.
fn pair_completeness(problem: &ConstraintProblem, order: &LayerOrder) -> Vec<Violation> {
    let mut out = Vec::new();
    let variables = problem.variables();
    let mut pairs = order.pairs().peekable();
    let mut v = 0;
    loop {
        let next_var = variables.get(v).copied();
        let next_pair: Option<(FacePair, Option<bool>)> = pairs.peek().copied();
        match (next_var, next_pair) {
            (None, None) => break,
            (Some(var), None) => {
                out.push(Violation::MissingPair { pair: var });
                v += 1;
            }
            (None, Some((pair, _))) => {
                out.push(Violation::ExtraPair { pair });
                pairs.next();
            }
            (Some(var), Some((pair, lo_above))) => match var.cmp(&pair) {
                std::cmp::Ordering::Less => {
                    out.push(Violation::MissingPair { pair: var });
                    v += 1;
                }
                std::cmp::Ordering::Greater => {
                    out.push(Violation::ExtraPair { pair });
                    pairs.next();
                }
                std::cmp::Ordering::Equal => {
                    if lo_above.is_none() {
                        out.push(Violation::UndeterminedPair { pair });
                    }
                    v += 1;
                    pairs.next();
                }
            },
        }
    }
    out
}

/// A malformed folded image, with the faces it involves, or a view over one
/// of the layer order's caps under its own refusal. `edge_creases` maps the
/// folded view's edges to crease positions.
pub(crate) fn folded_image(
    error: &LayerOrderError,
    parts: &StateParts,
    topology: &Topology,
    edge_creases: &[usize],
) -> FoldRefusal {
    let faces = match error {
        // `before_order` refuses it first; a view is never asked for one.
        &LayerOrderError::TooManyFaces { face_count, limit } => {
            return FoldRefusal::TooManyFaces { face_count, limit };
        }
        &LayerOrderError::StackedTooDeep {
            deepest,
            triples,
            limit,
        } => {
            return FoldRefusal::StackedTooDeep {
                deepest,
                triples,
                limit,
            };
        }
        LayerOrderError::DuplicateFace(f)
        | LayerOrderError::NonConvexFace(f)
        | LayerOrderError::DegenerateFace(f)
        | LayerOrderError::SameFace(f)
        | LayerOrderError::FaceNotInView(f) => vec![*f],
        LayerOrderError::InvalidPolygon { face, .. }
        | LayerOrderError::UnknownEdgeFace { face, .. }
        | LayerOrderError::SelfEdge { face, .. }
        | LayerOrderError::EdgeOffFace { face, .. } => vec![*face],
        LayerOrderError::ContradictoryOrder { pair } => pair.faces().to_vec(),
        LayerOrderError::EdgeKindMismatch { edge, .. }
        | LayerOrderError::DegenerateEdge { edge, .. } => edge_creases
            .get(*edge)
            .map(|&k| {
                topology.crease_faces[k]
                    .iter()
                    .map(|&f| parts.faces[f].id)
                    .collect()
            })
            .unwrap_or_default(),
        LayerOrderError::InvalidFaceOrder { .. } | LayerOrderError::ProblemMismatch => Vec::new(),
    };
    FoldRefusal::FoldedImage {
        message: error.to_string(),
        faces,
    }
}
