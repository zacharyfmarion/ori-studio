//! The scalars a caller reads about a 3D folded figure.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! A **sibling** of [`crate::folding::FoldedFigureSnapshot`], not an extension
//! of it. That type's `wireframe` is 2D by construction and is half of the
//! frontend's "will we draw this" predicate; `estimation_step` and
//! `display_style` are Oriedita enums with upstream meaning the 3D path does not
//! have. Filling any of them with a plausible value is exactly the
//! plausible-picture-with-no-error failure this feature is defined against, so
//! the 3D figure carries its own snapshot and the flat one is untouched.
//!
//! Four fields are shared **by name and by meaning** —
//! [`Fold3dSnapshot::discovered_fold_cases`],
//! [`Fold3dSnapshot::current_fold_case`],
//! [`Fold3dSnapshot::find_another_overlap_valid`] and
//! [`Fold3dSnapshot::has_next_solution`] — so the cycling UI derives its one
//! solution verb from a 3D figure with the same expression it already uses.
//!
//! `text_result` is deliberately **not** among them. On the flat path it is
//! Oriedita's raw English status line, nothing in the frontend renders it, and
//! the eight-locale gate cannot see a Rust string literal. Copy is the
//! frontend's; this type carries numbers and codes.
//!
//! Everything here is O(planes) + O(1) in size — about 2 KB on the largest
//! admitted corpus model — so it is the half of the boundary that is safe to
//! persist. [`crate::folding3d::model::Folded3dRenderModel`] is not.

use serde::{Deserialize, Serialize};

use crate::folding::FoldedFigureModel;
use crate::folding3d::admit::Admission;
use crate::folding3d::cells::CellIndex;
use crate::folding3d::census::Fold3dCensus;
use crate::folding3d::model::Folded3dRenderModel;
use crate::folding3d::order::Fold3dOrdering;
use crate::folding3d::planes::PlaneIndex;
use crate::folding3d::wire::{Fold3dCrossingWire, Fold3dTolerancesWire, Fold3dVerdict};
use crate::geometry::Point;

/// The current [`Fold3dSnapshot`] layout.
pub const FOLD_3D_SNAPSHOT_SCHEMA_VERSION: u32 = 1;

/// How many local crossings and how many face-vs-face crossings a snapshot
/// lists. The counts beside them stay exact.
pub const MAX_REPORTED: usize = 16;

/// What one 3D fold produced, minus the geometry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Fold3dSnapshot {
    pub schema_version: u32,
    /// The display model, as given to the fold. Mirrors
    /// [`crate::folding::FoldedFigureSnapshot::model`].
    pub model: FoldedFigureModel,

    // --- shared with the flat snapshot by name and meaning --------------------
    /// Forward-only high-water mark of solutions reached. **Never** an eager
    /// product over components: per-component totals are not knowable in
    /// advance, so no "k of N" is expressible and none is offered.
    pub discovered_fold_cases: usize,
    /// 1-based index of the solution being shown.
    #[serde(default)]
    pub current_fold_case: usize,
    /// Whether another solution is reachable without wrapping.
    pub find_another_overlap_valid: bool,
    /// Alias of [`Self::find_another_overlap_valid`] under the name the 3D
    /// enumerator uses internally. Both are emitted so a reader of either
    /// vocabulary is right; they can never disagree, because one is assigned
    /// from the other.
    pub has_next_solution: bool,

    // --- 3D only -------------------------------------------------------------
    /// The headline conclusion. See [`Fold3dVerdict`] for the precedence rule
    /// among the three non-`Folded` conditions, and note that `Folded` means
    /// *no crossing was detected*, never *no crossing exists*.
    pub verdict: Fold3dVerdict,
    pub diagnostics: Fold3dDiagnosticsSummary,
    pub census: Fold3dCensusSummary,
    pub planes: Vec<Fold3dPlaneSummary>,
    /// Ordering-variable count per constraint component, **descending**. Empty
    /// when the ordering solver did not answer.
    pub components: Vec<usize>,
    /// Ordering variables the solver left undecided.
    pub undetermined_pairs: usize,
    /// Arrangement cells with at least one undecided intra-cell pair.
    pub undetermined_cells: usize,
    /// Cross-plane couplings the constraints carried.
    pub couplings: usize,
    /// Up to [`MAX_REPORTED`] crossings; `crossing_count` is exact.
    pub crossings: Vec<Fold3dCrossingWire>,
    pub crossing_count: usize,
}

/// What the admission gate measured.
///
/// **Every bar the gate applied is here as its residual, beside the tolerance it
/// was compared against.** A caller that wants a different bar — a tighter one
/// for an export, a looser one for a preview — re-applies it to these numbers
/// rather than re-running the fold with [`Fold3dTolerances`] overridden. The
/// three the gate actually decides on are the closure residual, the loop gap and
/// the plane partition's intra/inter separations, and all three are below.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Fold3dDiagnosticsSummary {
    pub tolerances: Fold3dTolerancesWire,
    /// Longer side of the unfolded bounding box.
    pub span: f64,
    /// Creases the gate pulled to an exact full fold **in its own copy** of the
    /// segments. The user's document is never written back.
    pub snapped_creases: usize,
    pub spatial_vertices: usize,
    pub worst_closure_residual_degrees: f64,
    /// Worst rotation disagreement over the non-tree dual adjacencies, radians.
    /// Reported for reading; it is not what the gate compares.
    pub loop_gap_radians: f64,
    /// Worst placement disagreement about where a shared crease lands, relative
    /// to the span — **the exact quantity the gate compares against
    /// `tolerances.distance_relative`**, so re-applying a different bar needs
    /// nothing else.
    pub loop_gap_offset_relative: f64,
    /// How many independent consistency conditions the two numbers above are
    /// maxima over. **Zero means they certify nothing**: the dual graph is a
    /// tree, the placement has no self-check on this model at all, and the `0.0`
    /// is vacuous rather than tight. A caller re-applying a bar must read this
    /// first, which is why it travels with them.
    pub loop_gap_non_tree_edges: usize,
    /// The same disagreement localised to elementary per-vertex dual cycles, and
    /// how many there were. The whole-sheet maximum above propagates outward and
    /// lands nowhere near its cause; this one does not.
    pub worst_vertex_cycle_radians: f64,
    pub vertex_cycles: usize,
    /// Up to [`MAX_REPORTED`] vertices whose folded link crosses itself.
    pub local_crossings: Vec<Point>,
    pub local_crossing_count: usize,
    /// Parallel-plane separations binned by decade relative to the span.
    /// **Reported, never gated** — a minimum separation cannot gate, because on
    /// real models it is frequently absent entirely.
    pub separation_bins: [usize; 5],
    /// Worst intra-plane deviations from the plane representative — residuals,
    /// not verdicts. The angle one is the tight coordinate: measured worst over
    /// the admitted corpus is 2.8e-8 rad against a 1e-7 bar.
    pub worst_intra_normal_radians: f64,
    pub worst_intra_offset_relative: f64,
    /// Smallest gap between two distinct parallel planes, relative to the span.
    /// `None` means no two distinct planes are parallel at all — a real and
    /// common answer, **not** an infinity.
    pub min_inter_separation_relative: Option<f64>,
    /// How many tolerance alarms the plane partition raised. Non-zero means the
    /// fold would have been refused; a snapshot therefore always reports 0.
    pub tolerance_alarms: usize,
}

/// The coplanar-overlap census, minus the pair list.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Fold3dCensusSummary {
    pub plane_count: usize,
    pub patch_count: usize,
    pub face_count: usize,
    /// The ordering-variable count. On an all-180 document this equals the flat
    /// path's own variable count, pair for pair.
    pub overlapping_pair_count: usize,
    pub non_adjacent_pair_count: usize,
    pub faces_in_overlap: usize,
    pub full_fold_creases: usize,
    /// `overlapping_pair_count >= full_fold_pairs` is a theorem — a full fold
    /// lays two faces into one plane on the same side of a shared edge. The
    /// converse is **false** and must never be assumed: a five-panel strip at
    /// four 90-degree creases has no full fold and a census of 1.
    pub full_fold_pairs: usize,
    pub min_accepted_area_relative: Option<f64>,
    pub max_rejected_area_relative: f64,
    /// Arrangement cells across every plane, including the one-face cells a
    /// face that overlaps nothing gets.
    pub cell_count: usize,
    /// Maximal covering sets — the stacks the ordering search ran over.
    pub subface_count: usize,
}

/// One plane, without its faces.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Fold3dPlaneSummary {
    /// The plane's chosen orientation: the placed normal of its lowest-indexed
    /// member face. **The one place a stack's "up" is decided**, and it is data
    /// the payload carries rather than something a consumer re-derives — a
    /// different seed gives a different chirality and reversed stacks that look
    /// entirely plausible.
    pub up: [f64; 3],
    pub origin: [f64; 3],
    pub face_count: usize,
    pub patch_count: usize,
    pub cell_count: usize,
    pub overlap_pairs: usize,
    pub normal_diameter_radians: f64,
    pub offset_diameter: f64,
}

/// Assemble the snapshot for one solution.
pub(crate) fn snapshot(
    model: FoldedFigureModel,
    admission: &Admission,
    index: &PlaneIndex,
    census: &Fold3dCensus,
    cells: &CellIndex,
    ordering: Result<&Fold3dOrdering, crate::folding3d::order::Fold3dOrderError>,
    render: &Folded3dRenderModel,
) -> Fold3dSnapshot {
    let verdict = verdict_of(admission, ordering);
    // No ordering means one drawable state and nothing to cycle through.
    // `discovered_fold_cases` stays 1 rather than 0 so the cycling UI reads
    // "showing solution 1 of at least 1", which is true, instead of "no
    // solutions", which would contradict the figure being on screen.
    let solutions = ordering.map_or_else(|_| Solutions::none(), Solutions::of);

    Fold3dSnapshot {
        schema_version: FOLD_3D_SNAPSHOT_SCHEMA_VERSION,
        model,
        discovered_fold_cases: solutions.discovered,
        current_fold_case: solutions.current,
        find_another_overlap_valid: solutions.has_next,
        has_next_solution: solutions.has_next,
        verdict,
        diagnostics: diagnostics_summary(admission, index),
        census: census_summary(census, cells, render.cell_count as usize),
        planes: plane_summaries(index, census, cells),
        components: solutions.components,
        undetermined_pairs: solutions.undetermined_pairs,
        undetermined_cells: render.undetermined_cells as usize,
        couplings: solutions.couplings,
        crossings: solutions.crossings,
        crossing_count: solutions.crossing_count,
    }
}

/// The fields an ordering contributes, in one place so the "no ordering" case
/// is a single readable fallback rather than a wide tuple.
struct Solutions {
    discovered: usize,
    current: usize,
    has_next: bool,
    components: Vec<usize>,
    undetermined_pairs: usize,
    couplings: usize,
    crossings: Vec<Fold3dCrossingWire>,
    crossing_count: usize,
}

impl Solutions {
    fn of(ordering: &Fold3dOrdering) -> Self {
        Self {
            discovered: ordering.discovered_cases,
            current: ordering.current_case,
            has_next: ordering.has_next,
            components: ordering.component_sizes.clone(),
            undetermined_pairs: ordering.undetermined.len(),
            couplings: ordering.couplings,
            crossings: ordering
                .crossings
                .iter()
                .take(MAX_REPORTED)
                .map(|&crossing| Fold3dCrossingWire::from(crossing))
                .collect(),
            crossing_count: ordering.crossing_count,
        }
    }

    fn none() -> Self {
        Self {
            discovered: 1,
            current: 1,
            has_next: false,
            components: Vec::new(),
            undetermined_pairs: 0,
            couplings: 0,
            crossings: Vec::new(),
            crossing_count: 0,
        }
    }
}

/// Apply the one documented precedence among conditions that co-occur.
///
/// Every count the choice hides is still on the snapshot, so nothing is lost by
/// collapsing them to one headline.
fn verdict_of(
    admission: &Admission,
    ordering: Result<&Fold3dOrdering, crate::folding3d::order::Fold3dOrderError>,
) -> Fold3dVerdict {
    match ordering {
        Err(error) => Fold3dVerdict::NoLayerOrder {
            reason: error.into(),
        },
        Ok(ordering) if ordering.crossing_count > 0 => Fold3dVerdict::TransversalCrossing {
            crossings: ordering.crossing_count,
        },
        Ok(_) if !admission.diagnostics.local_crossings.is_empty() => {
            Fold3dVerdict::LocalCrossing {
                vertices: admission.diagnostics.local_crossings.len(),
            }
        }
        Ok(_) => Fold3dVerdict::Folded,
    }
}

/// Takes the whole [`Admission`] rather than its `diagnostics` alone, because
/// the loop gap is measured on the **placement** and copying it into
/// `Fold3dDiagnostics` first would be a second place for it to live.
fn diagnostics_summary(admission: &Admission, index: &PlaneIndex) -> Fold3dDiagnosticsSummary {
    let diagnostics = &admission.diagnostics;
    let loop_gap = &admission.placement.loop_gap;
    Fold3dDiagnosticsSummary {
        tolerances: diagnostics.tolerances.into(),
        span: diagnostics.span,
        snapped_creases: diagnostics.snapped_creases,
        spatial_vertices: diagnostics.spatial_vertices,
        worst_closure_residual_degrees: diagnostics.worst_closure_residual_degrees,
        loop_gap_radians: loop_gap.rotation_radians,
        // Divided here, once, by the same expression `admit_with` gates on, so a
        // caller re-applying the bar compares like with like instead of dividing
        // by a span it read from somewhere else.
        loop_gap_offset_relative: loop_gap.offset / diagnostics.span,
        loop_gap_non_tree_edges: loop_gap.non_tree_edges,
        worst_vertex_cycle_radians: loop_gap.worst_vertex_cycle_radians,
        vertex_cycles: loop_gap.vertex_cycles,
        local_crossings: diagnostics
            .local_crossings
            .iter()
            .take(MAX_REPORTED)
            .copied()
            .collect(),
        local_crossing_count: diagnostics.local_crossings.len(),
        separation_bins: diagnostics.separation_bins,
        worst_intra_normal_radians: index.worst_intra_normal_radians,
        worst_intra_offset_relative: index.worst_intra_offset_relative,
        min_inter_separation_relative: index.min_inter_separation_relative,
        tolerance_alarms: index.alarm_count,
    }
}

fn census_summary(
    census: &Fold3dCensus,
    cells: &CellIndex,
    cell_count: usize,
) -> Fold3dCensusSummary {
    Fold3dCensusSummary {
        plane_count: census.plane_count,
        patch_count: census.patch_count,
        face_count: census.face_count,
        overlapping_pair_count: census.overlapping_pair_count,
        non_adjacent_pair_count: census.non_adjacent_pair_count,
        faces_in_overlap: census.faces_in_overlap,
        full_fold_creases: census.full_fold_creases,
        full_fold_pairs: census.full_fold_pairs,
        min_accepted_area_relative: census.min_accepted_area_relative,
        max_rejected_area_relative: census.max_rejected_area_relative,
        // Read off the render model rather than re-derived, so the number a
        // caller sees and the number a renderer draws cannot drift: every face
        // that overlaps nothing becomes its own cell there, and a second
        // derivation of that rule is a second thing to keep in step.
        cell_count,
        subface_count: cells.subfaces.len(),
    }
}

fn plane_summaries(
    index: &PlaneIndex,
    census: &Fold3dCensus,
    cells: &CellIndex,
) -> Vec<Fold3dPlaneSummary> {
    let mut pairs = vec![0usize; index.planes.len()];
    for pair in &census.pairs {
        if let Some(slot) = pairs.get_mut(pair.plane) {
            *slot += 1;
        }
    }
    let mut cell_counts = vec![0usize; index.planes.len()];
    for cell in &cells.cells {
        if let Some(slot) = cell_counts.get_mut(cell.plane) {
            *slot += 1;
        }
    }
    index
        .planes
        .iter()
        .enumerate()
        .map(|(id, plane)| Fold3dPlaneSummary {
            up: plane.up,
            origin: plane.origin,
            face_count: plane.faces.len(),
            patch_count: plane.patches.len(),
            cell_count: cell_counts[id],
            overlap_pairs: pairs[id],
            normal_diameter_radians: plane.normal_diameter_radians,
            offset_diameter: plane.offset_diameter,
        })
        .collect()
}
