//! Whether a placement describes real paper.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! Every question here is answered by a check that already ships. Nothing in
//! this file re-derives closure, spherical simplicity or interior cuts — it
//! consumes [`dispatched_camv`], applies the bar once, and adds the two
//! questions no shipped check asks: is the arrangement's dual graph connected,
//! and is the placement path-independent.

use crate::checks_spatial::{Indeterminate, Vec3, cross, dispatched_camv, dot, norm};
use crate::fold_graph::FoldGraph;
use crate::folding3d::placement::{Placement3d, place_faces};
use crate::folding3d::{Fold3dRefusal, Fold3dTolerances};
use crate::geometry::{LineSegment, Point};
use crate::model::CreasePatternModel;

/// What the admission gate concluded, before any layer ordering runs.
///
/// The third arm of the three-way verdict — no valid layer order — belongs to
/// the ordering solver and is not reachable from here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fold3dOutcome {
    /// The placement is consistent and every examined vertex link is embedded.
    Folded,
    /// The placement is consistent, but the folded paper passes through itself
    /// at one or more vertices.
    ///
    /// **Not a refusal.** The geometry is computed and drawable, and naming the
    /// vertices is more use than declining to answer; whether the product draws
    /// it is a presentation decision, not this gate's.
    LocalCrossing,
}

/// Numbers the gate measured.
#[derive(Debug, Clone, PartialEq)]
pub struct Fold3dDiagnostics {
    pub tolerances: Fold3dTolerances,
    /// Longer side of the unfolded bounding box.
    pub span: f64,
    /// Creases pulled to an exact full fold by the flat snap, in this gate's own
    /// copy of the segments.
    pub snapped_creases: usize,
    /// Vertices the closure check examined.
    pub spatial_vertices: usize,
    /// Worst closure residual over those, in degrees.
    pub worst_closure_residual_degrees: f64,
    /// Vertices whose folded link crosses itself.
    pub local_crossings: Vec<Point>,
    /// Parallel-plane separations, binned by decade relative to the span:
    /// `<1e-12`, `1e-12..1e-9`, `1e-9..1e-6`, `1e-6..1e-3`, `>=1e-3`.
    ///
    /// **Reported, never gated.** A minimum separation cannot gate: measured on
    /// real models it is `+inf` on 6 of 16 (no two parallel distinct planes at
    /// all, certifying nothing) and, where finite, frequently below the drawing
    /// epsilon. The shape of the spectrum is the question, and it is not the
    /// same shape on every model — `penguin_freeform` is clean, admitted, and
    /// has no separation above 1e-3 of span at all, which is why an expectation
    /// that a gap exists cannot be a gate either.
    ///
    /// Plane *classification* is not this phase's work. This is a measurement of
    /// the placement, and the normal grouping it uses is deliberately the
    /// crudest one that can produce it.
    pub separation_bins: [usize; 5],
    /// Smallest strictly positive separation between parallel planes, in paper
    /// units. `None` when no normal class held two distinct offsets.
    pub min_plane_separation: Option<f64>,
}

/// A crease pattern admitted for a 3D fold.
#[derive(Debug, Clone, PartialEq)]
pub struct Admission {
    pub placement: Placement3d,
    pub diagnostics: Fold3dDiagnostics,
}

impl Admission {
    pub fn outcome(&self) -> Fold3dOutcome {
        if self.diagnostics.local_crossings.is_empty() {
            Fold3dOutcome::Folded
        } else {
            Fold3dOutcome::LocalCrossing
        }
    }
}

/// Decide whether `segments` can be folded in 3D, and place them if so.
///
/// Takes the segments and nothing else. A gate that took a document *and* a
/// slice of it could have the two disagree about what is being folded, which is
/// the whole shape of the bug where an all-classic selection inside a mixed
/// document takes the 3D path.
pub fn admit(segments: &[LineSegment], starting_face_id: i32) -> Result<Admission, Fold3dRefusal> {
    admit_with(segments, starting_face_id, Fold3dTolerances::DEFAULT)
}

pub fn admit_with(
    segments: &[LineSegment],
    starting_face_id: i32,
    tolerances: Fold3dTolerances,
) -> Result<Admission, Fold3dRefusal> {
    // 1. Flat snap, into our own copy. Snapping a user's 179.9 to 180 in the
    //    document would silently destroy their angle; doing it here is sound
    //    because a half-turn about a line in a plane maps that plane to itself
    //    exactly, and because below the closure bar nothing else in the
    //    pipeline can tell the two apart.
    let (segments, snapped_creases) = snap_to_flat(segments, tolerances.flat_snap_degrees);
    let model = CreasePatternModel {
        line_segments: segments.clone(),
        ..CreasePatternModel::default()
    };

    // 2. The shipped check, dispatched per vertex: Oriedita's flat rules where
    //    every incident crease is a full fold, the closure condition where one
    //    is not. `dispatched_camv` rather than `spatial_vertex_reports` because
    //    only the former routes a mixed pattern's flat vertices to the flat
    //    check at all.
    let camv = dispatched_camv(&model);

    // 3. A border with paper on both sides is a cut, not a hinge, and every
    //    vertex on it was declined — so the clean verdict above covers geometry
    //    nothing examined. First, because it is the one refusal that says the
    //    other verdicts are worth less than they look.
    if let Some(border) = camv.interior_borders.first() {
        return Err(Fold3dRefusal::InteriorCut {
            line: border.segment,
            point: border.point,
        });
    }
    if let Some(violation) = camv.flat.first() {
        return Err(Fold3dRefusal::FlatFoldability {
            point: violation.point,
            rule: violation.rule,
        });
    }

    let mut spatial_vertices = 0usize;
    let mut worst_closure_residual_degrees: f64 = 0.0;
    let mut local_crossings = Vec::new();
    for report in &camv.spatial {
        // The same classification `spatial_closure_diagnostics` makes: set
        // aside what cannot be evaluated, apply the bar, then ask the second
        // and independent question. It differs in one way, and deliberately:
        // that function reports nothing for an indeterminate vertex because a
        // false positive is worse than silence, while a fold has to place the
        // vertex and cannot.
        let Some(residual) = report.residual else {
            return Err(Fold3dRefusal::VertexIndeterminate {
                point: report.point,
                cause: report
                    .indeterminate
                    .unwrap_or(Indeterminate::UnassignedCrease),
            });
        };
        spatial_vertices += 1;
        let residual_degrees = residual.to_degrees();
        worst_closure_residual_degrees = worst_closure_residual_degrees.max(residual_degrees);
        if residual_degrees > crate::CLOSURE_RESIDUAL_BAR_DEGREES {
            return Err(Fold3dRefusal::VertexClosure {
                point: report.point,
                residual_degrees,
            });
        }
        if report.link.is_some_and(|link| link.self_intersects()) {
            local_crossings.push(report.point);
        }
    }

    // 4. Place, propagating the walk's own typed refusals.
    let graph = FoldGraph::from_segments(&segments, true);
    let placement = place_faces(&graph, starting_face_id)?;

    // 5. The loop gap gates. On simply connected paper it follows from
    //    per-vertex closure — but the closure check declines every vertex a
    //    border touches, so "it follows" is a statement about coverage rather
    //    than about paper, and the coverage is what step 3 above is for.
    let relative = placement.loop_gap.offset / placement.span;
    if relative > tolerances.distance_relative {
        return Err(Fold3dRefusal::LoopNotClosed {
            worst_edge: placement.loop_gap.worst_edge,
            gap_radians: placement.loop_gap.rotation_radians,
            gap_offset: placement.loop_gap.offset,
        });
    }

    // 6. The separation spectrum, measured and reported.
    let (separation_bins, min_plane_separation) =
        plane_separations(&placement, tolerances.angle_radians);

    Ok(Admission {
        diagnostics: Fold3dDiagnostics {
            tolerances,
            span: placement.span,
            snapped_creases,
            spatial_vertices,
            worst_closure_residual_degrees,
            local_crossings,
            separation_bins,
            min_plane_separation,
        },
        placement,
    })
}

/// Pull every near-full crease to an exact full fold, in a fresh copy.
///
/// Returns the copy and how many creases moved. The input is never touched, and
/// there is no variant of this that writes back.
fn snap_to_flat(segments: &[LineSegment], window_degrees: f64) -> (Vec<LineSegment>, usize) {
    let mut snapped = 0usize;
    let out = segments
        .iter()
        .map(|segment| {
            let Some(magnitude) = segment.fold_magnitude else {
                return segment.clone();
            };
            if magnitude.is_full() || (180.0 - magnitude.degrees()).abs() > window_degrees {
                return segment.clone();
            }
            snapped += 1;
            let mut segment = segment.clone();
            // `None` is the canonical classic form: `is_classic_crease` accepts
            // it and `crease_fold_angle` reads the full angle off the colour.
            segment.fold_magnitude = None;
            segment
        })
        .collect();
    (out, snapped)
}

/// Consecutive offset differences within each parallel-normal class, binned by
/// decade relative to the paper span.
///
/// The sign of a normal is resolved **against the class it is being compared
/// to**, never by a global rule. A global rule ("flip if the first non-zero
/// component is negative") splits two normals differing by 1e-17 across an axis
/// into opposite signs and turns their equal offsets into a separation of twice
/// the offset — measured, that invented a 50-unit gap on a 400-unit sheet.
fn plane_separations(placement: &Placement3d, angle_tolerance: f64) -> ([usize; 5], Option<f64>) {
    let mut classes: Vec<(Vec3, Vec<f64>)> = Vec::new();
    for (face, normal) in placement.face_normals.iter().enumerate() {
        let ring = &placement.face_points[face];
        if ring.is_empty() {
            continue;
        }
        let mut centroid = [0.0; 3];
        for point in ring {
            centroid = [
                centroid[0] + point[0],
                centroid[1] + point[1],
                centroid[2] + point[2],
            ];
        }
        let count = ring.len() as f64;
        let centroid = [
            centroid[0] / count,
            centroid[1] / count,
            centroid[2] / count,
        ];

        let mut placed = false;
        for (class_normal, offsets) in classes.iter_mut() {
            let signed = if dot(*class_normal, *normal) < 0.0 {
                [-normal[0], -normal[1], -normal[2]]
            } else {
                *normal
            };
            let angle = norm(cross(*class_normal, signed)).atan2(dot(*class_normal, signed));
            if angle.abs() <= angle_tolerance {
                offsets.push(dot(*class_normal, centroid));
                placed = true;
                break;
            }
        }
        if !placed {
            classes.push((*normal, vec![dot(*normal, centroid)]));
        }
    }

    let mut bins = [0usize; 5];
    let mut minimum: Option<f64> = None;
    for (_, offsets) in classes.iter_mut() {
        offsets.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        for window in offsets.windows(2) {
            let separation = (window[1] - window[0]).abs();
            let bin = match separation / placement.span {
                relative if relative < 1e-12 => 0,
                relative if relative < 1e-9 => 1,
                relative if relative < 1e-6 => 2,
                relative if relative < 1e-3 => 3,
                _ => 4,
            };
            bins[bin] += 1;
            if bin > 0 {
                minimum = Some(minimum.map_or(separation, |m: f64| m.min(separation)));
            }
        }
    }
    (bins, minimum)
}
