//! The view-independent 3D geometry a renderer draws.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! # What this is not
//!
//! It carries **no camera, no projection, no screen-space quantity and no
//! colour**. Every appearance decision belongs to the frontend, and every
//! quantity here is a fact about the paper. It is emitted once per fold and once
//! per "another solution" — there is deliberately no per-frame way to ask for
//! it.
//!
//! # Cells, not faces, are the drawable unit
//!
//! A per-face scalar "layer" cannot express what the ordering solver computes: a
//! cyclic panel order is legal (He & Guest's square twist orders four panels
//! `a > b > c > d > a`), and no scalar survives that. What always exists is a
//! winner **per arrangement cell**, so the fill stream is a list of cells, each
//! carrying its own face stack top-first. Faces are still emitted, because the
//! stack names them and because their normals decide shading — but a renderer
//! that fills faces rather than cells is drawing something the kernel did not
//! order.
//!
//! Every face appears in at least one cell: a face inside an overlap group is
//! covered by that group's arrangement, and a face that overlaps nothing gets a
//! single cell that is its own ring. [`RenderModelError::FaceInNoCell`] is the
//! check, not the hope.
//!
//! # Struct of arrays
//!
//! Flat `Vec<f64>` / `Vec<i32>` rather than nested per-face objects. Measured on
//! the largest admitted corpus model (`origamisimulator`, 2,637 faces, 9,792
//! ring vertices): the nested `Vec<Vec<[f64; 3]>>` shape serializes to 609,322
//! bytes of JSON and materializes ~12,000 JS arrays, against 235,008 bytes for
//! the flat one. The layout is also chosen so that moving to transferable typed
//! arrays later is a pure substitution of the `set_f64_array` / `set_i32_array`
//! helpers the wasm bridge already has, with no shape change.
//!
//! Every `*_start` is an index in **elements of its own logical unit** (a
//! vertex, a face id), never a byte or a float offset.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::checks_spatial::{Vec3, dot};
use crate::folding3d::cells::CellIndex;
use crate::folding3d::order::Fold3dOrdering;
use crate::folding3d::placement::Placement3d;
use crate::folding3d::planes::PlaneIndex;

/// `[plane, ring_start, ring_len, facing]`.
pub const FOLDED_3D_FACE_ATTR_STRIDE: usize = 4;
/// `[plane, ring_start, ring_len, stack_start, stack_len, determinacy, draw_rank]`.
pub const FOLDED_3D_CELL_ATTR_STRIDE: usize = 7;
/// `up(3), origin(3), u(3), v(3)`.
pub const FOLDED_3D_PLANE_FRAME_STRIDE: usize = 12;
/// `[face_a, face_b, line, kind]`.
pub const FOLDED_3D_EDGE_ATTR_STRIDE: usize = 4;

/// A cell every intra-cell pair of which the solver decided.
pub const FOLDED_3D_CELL_DETERMINED: i32 = 0;
/// A cell at least one of whose intra-cell pairs the solver left undecided.
pub const FOLDED_3D_CELL_UNDETERMINED: i32 = 1;

/// An edge with paper on one side only.
pub const FOLDED_3D_EDGE_BORDER: i32 = 0;
/// An edge with paper on both sides and a known fold angle.
pub const FOLDED_3D_EDGE_CREASE: i32 = 1;
/// An edge with paper on both sides and **no** known fold angle. The admission
/// gate refuses these ([`crate::folding3d::Fold3dRefusal::NonCreaseJoin`]), so
/// it is reachable only from the ungated measurement path.
pub const FOLDED_3D_EDGE_UNKNOWN: i32 = 2;

/// The current [`Folded3dRenderModel`] layout.
pub const FOLDED_3D_RENDER_SCHEMA_VERSION: u32 = 1;

/// A render model that does not describe itself.
///
/// Every arm is an internal invariant. They exist because the measured
/// alternative elsewhere in this pipeline is not a crash but a plausible
/// picture: an out-of-range face id makes the shipped layer search report
/// success with that face missing from every stack, and no error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderModelError {
    /// A face no cell covers, so a renderer drawing only cells would lose it.
    FaceInNoCell { face: usize },
    /// A `start`/`len` pair runs off the end of the array it indexes.
    SliceOutOfRange {
        field: &'static str,
        index: usize,
        start: usize,
        len: usize,
        available: usize,
    },
    /// A stack names a face that does not exist.
    StackFaceOutOfRange {
        cell: usize,
        face: usize,
        face_count: usize,
    },
    /// An array's length is not a whole number of strides.
    StrideMismatch {
        field: &'static str,
        len: usize,
        stride: usize,
    },
}

impl std::fmt::Display for RenderModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FaceInNoCell { face } => {
                write!(f, "face {face} is covered by no cell")
            }
            Self::SliceOutOfRange {
                field,
                index,
                start,
                len,
                available,
            } => write!(
                f,
                "{field}[{index}] spans {start}..{} of {available}",
                start + len
            ),
            Self::StackFaceOutOfRange {
                cell,
                face,
                face_count,
            } => write!(
                f,
                "cell {cell} stacks face {face} with only {face_count} faces"
            ),
            Self::StrideMismatch { field, len, stride } => {
                write!(f, "{field} has {len} entries, not a multiple of {stride}")
            }
        }
    }
}

impl std::error::Error for RenderModelError {}

/// Everything a renderer needs, and nothing about how it looks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Folded3dRenderModel {
    pub schema_version: u32,
    /// Longer side of the **unfolded** bounding box. The scale every relative
    /// quantity in the pipeline is relative to.
    pub span: f64,
    pub face_count: u32,
    pub plane_count: u32,
    pub cell_count: u32,
    pub edge_count: u32,
    /// `[x, y, z, ...]` — every face ring, concatenated in face order.
    pub ring_points: Vec<f64>,
    /// [`FOLDED_3D_FACE_ATTR_STRIDE`] per face. `ring_start` and `ring_len` are
    /// in **vertices** of [`Self::ring_points`]. `facing` is `+1` when that
    /// face's paper front points along its plane's `up`, `-1` otherwise.
    pub face_attr: Vec<i32>,
    /// 3 per face — the image of `+z` under that face's rigid transform, i.e.
    /// the side the paper's front faces.
    pub face_normals: Vec<f64>,
    /// [`FOLDED_3D_PLANE_FRAME_STRIDE`] per plane.
    pub plane_frames: Vec<f64>,
    /// `[x, y, z, ...]` — every cell ring, concatenated in cell order, already
    /// lifted into world coordinates.
    pub cell_points: Vec<f64>,
    /// [`FOLDED_3D_CELL_ATTR_STRIDE`] per cell. `ring_start` / `ring_len` index
    /// [`Self::cell_points`] in vertices; `stack_start` / `stack_len` index
    /// [`Self::cell_stack`] in face ids.
    pub cell_attr: Vec<i32>,
    /// Face ids per cell, **top first** with respect to that cell's plane `up`.
    pub cell_stack: Vec<u32>,
    /// 6 per edge: `ax, ay, az, bx, by, bz`.
    pub edge_points: Vec<f64>,
    /// [`FOLDED_3D_EDGE_ATTR_STRIDE`] per edge. `face_b` is `-1` on a border and
    /// `line` is `-1` when no input segment was found for the edge.
    pub edge_attr: Vec<i32>,
    /// Signed fold angle per edge in **degrees**, `0.0` on a border. Signed
    /// rather than a mountain/valley code so the payload bakes in no convention
    /// the frontend then has to agree with.
    pub edge_fold_degrees: Vec<f64>,
    /// Cells with at least one undecided intra-cell pair. An annotation, not a
    /// mode: it fires on pairs the solver could not decide, never merely because
    /// the census is non-zero.
    pub undetermined_cells: u32,
}

impl Folded3dRenderModel {
    /// Re-derive every offset and re-check every face id.
    ///
    /// Called once before the model leaves the kernel. It is not a debug assert:
    /// the arrays are built here, so a violation is a defect in this file, and
    /// this is the last place it is cheap to see.
    pub fn validate(&self) -> Result<(), RenderModelError> {
        stride(
            "face_attr",
            self.face_attr.len(),
            FOLDED_3D_FACE_ATTR_STRIDE,
        )?;
        stride(
            "cell_attr",
            self.cell_attr.len(),
            FOLDED_3D_CELL_ATTR_STRIDE,
        )?;
        stride(
            "edge_attr",
            self.edge_attr.len(),
            FOLDED_3D_EDGE_ATTR_STRIDE,
        )?;
        stride(
            "plane_frames",
            self.plane_frames.len(),
            FOLDED_3D_PLANE_FRAME_STRIDE,
        )?;
        stride("ring_points", self.ring_points.len(), 3)?;
        stride("cell_points", self.cell_points.len(), 3)?;
        stride("face_normals", self.face_normals.len(), 3)?;
        stride("edge_points", self.edge_points.len(), 6)?;
        stride("edge_fold_degrees", self.edge_fold_degrees.len(), 1)?;

        // A whole number of strides is not the same as **enough** of them, and
        // the two loops below index by the declared counts unconditionally. The
        // kernel's own path always agrees, but this type derives `Deserialize`,
        // so a round-tripped or hand-built model reaches here — and the one check
        // whose stated job is catching that shape of corruption must not be the
        // thing that panics on it.
        records(
            "face_attr",
            self.face_count as usize,
            FOLDED_3D_FACE_ATTR_STRIDE,
            self.face_attr.len(),
        )?;
        records(
            "cell_attr",
            self.cell_count as usize,
            FOLDED_3D_CELL_ATTR_STRIDE,
            self.cell_attr.len(),
        )?;

        let ring_vertices = self.ring_points.len() / 3;
        for face in 0..self.face_count as usize {
            let base = face * FOLDED_3D_FACE_ATTR_STRIDE;
            let start = self.face_attr[base + 1].max(0) as usize;
            let len = self.face_attr[base + 2].max(0) as usize;
            if start + len > ring_vertices {
                return Err(RenderModelError::SliceOutOfRange {
                    field: "ring_points",
                    index: face,
                    start,
                    len,
                    available: ring_vertices,
                });
            }
        }

        let cell_vertices = self.cell_points.len() / 3;
        for cell in 0..self.cell_count as usize {
            let base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
            let ring_start = self.cell_attr[base + 1].max(0) as usize;
            let ring_len = self.cell_attr[base + 2].max(0) as usize;
            if ring_start + ring_len > cell_vertices {
                return Err(RenderModelError::SliceOutOfRange {
                    field: "cell_points",
                    index: cell,
                    start: ring_start,
                    len: ring_len,
                    available: cell_vertices,
                });
            }
            let stack_start = self.cell_attr[base + 3].max(0) as usize;
            let stack_len = self.cell_attr[base + 4].max(0) as usize;
            if stack_start + stack_len > self.cell_stack.len() {
                return Err(RenderModelError::SliceOutOfRange {
                    field: "cell_stack",
                    index: cell,
                    start: stack_start,
                    len: stack_len,
                    available: self.cell_stack.len(),
                });
            }
            for &face in &self.cell_stack[stack_start..stack_start + stack_len] {
                if face as usize >= self.face_count as usize {
                    return Err(RenderModelError::StackFaceOutOfRange {
                        cell,
                        face: face as usize,
                        face_count: self.face_count as usize,
                    });
                }
            }
        }
        Ok(())
    }
}

fn stride(field: &'static str, len: usize, stride: usize) -> Result<(), RenderModelError> {
    if stride == 0 || len.is_multiple_of(stride) {
        Ok(())
    } else {
        Err(RenderModelError::StrideMismatch { field, len, stride })
    }
}

/// Whether an attribute array holds `count` records of `stride` each.
fn records(
    field: &'static str,
    count: usize,
    stride: usize,
    len: usize,
) -> Result<(), RenderModelError> {
    if count.saturating_mul(stride) <= len {
        return Ok(());
    }
    // Named as the first record that runs off the end, which is the one a reader
    // would go looking for.
    let index = len / stride.max(1);
    Err(RenderModelError::SliceOutOfRange {
        field,
        index,
        start: index.saturating_mul(stride),
        len: stride,
        available: len,
    })
}

/// Build the render model for one solution.
///
/// `ordering` is `Option` because the figure still draws when the solver could
/// not answer — that is the third arm of the verdict, not a refusal. With
/// `None`, every multi-face cell is reported undetermined and its stack falls
/// back to ascending face order.
pub fn render_model(
    placement: &Placement3d,
    index: &PlaneIndex,
    cells: &CellIndex,
    ordering: Option<&Fold3dOrdering>,
) -> Result<Folded3dRenderModel, RenderModelError> {
    let face_count = placement.rings.len();

    // --- faces ---------------------------------------------------------------
    let mut ring_points: Vec<f64> = Vec::new();
    let mut face_attr: Vec<i32> = Vec::with_capacity(face_count * FOLDED_3D_FACE_ATTR_STRIDE);
    let mut face_normals: Vec<f64> = Vec::with_capacity(face_count * 3);
    for face in 0..face_count {
        let plane = index.plane_of[face];
        let start = ring_points.len() / 3;
        for point in &placement.face_points[face] {
            ring_points.extend_from_slice(point);
        }
        let len = ring_points.len() / 3 - start;
        let normal = placement.face_normals[face];
        let facing = if dot(normal, index.planes[plane].up) >= 0.0 {
            1
        } else {
            -1
        };
        face_attr.extend_from_slice(&[plane as i32, start as i32, len as i32, facing]);
        face_normals.extend_from_slice(&normal);
    }

    // --- planes --------------------------------------------------------------
    let mut plane_frames: Vec<f64> =
        Vec::with_capacity(index.planes.len() * FOLDED_3D_PLANE_FRAME_STRIDE);
    for plane in &index.planes {
        plane_frames.extend_from_slice(&plane.up);
        plane_frames.extend_from_slice(&plane.origin);
        plane_frames.extend_from_slice(&plane.u);
        plane_frames.extend_from_slice(&plane.v);
    }

    // --- cells ---------------------------------------------------------------
    let above = relation_map(ordering);
    let mut covered = vec![false; face_count];
    let mut drafts: Vec<CellDraft> = Vec::new();
    for cell in &cells.cells {
        for &face in &cell.faces {
            if face < face_count {
                covered[face] = true;
            }
        }
        let frame = &index.planes[cell.plane];
        let ring: Vec<Vec3> = cell
            .ring
            .iter()
            .map(|point| lift(frame.origin, frame.u, frame.v, point.x, point.y))
            .collect();
        let (stack, determinate) = stack_of(&cell.faces, &above);
        drafts.push(CellDraft {
            plane: cell.plane,
            area: cell.area,
            ring,
            stack,
            determinate,
        });
    }
    // A face that overlaps nothing is its own cell. `cell_index` skips it on
    // purpose — it carries no ordering variable — but a renderer drawing only
    // cells would then lose the paper.
    for (face, seen) in covered.iter_mut().enumerate() {
        if *seen {
            continue;
        }
        let plane = index.plane_of[face];
        drafts.push(CellDraft {
            plane,
            area: crate::folding3d::overlap::signed_area(&index.projected[face]).abs(),
            ring: placement.face_points[face].clone(),
            stack: vec![face as u32],
            determinate: true,
        });
        *seen = true;
    }
    if let Some(face) = covered.iter().position(|seen| !seen) {
        return Err(RenderModelError::FaceInNoCell { face });
    }

    // Stable order: by plane, then descending area, then lowest stacked face.
    // The descending-area rule is also the intra-plane draw order — cells of one
    // plane are area-disjoint, so it normally decides nothing, and where a
    // decomposition slips a containment through it puts the contained cell on
    // top rather than leaving the outcome to array order.
    drafts.sort_by(|a, b| {
        a.plane
            .cmp(&b.plane)
            .then_with(|| {
                b.area
                    .partial_cmp(&a.area)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.stack.first().cmp(&b.stack.first()))
    });

    let mut cell_points: Vec<f64> = Vec::new();
    let mut cell_attr: Vec<i32> = Vec::with_capacity(drafts.len() * FOLDED_3D_CELL_ATTR_STRIDE);
    let mut cell_stack: Vec<u32> = Vec::new();
    let mut undetermined_cells = 0u32;
    let mut draw_rank = 0i32;
    let mut draw_plane = usize::MAX;
    for draft in &drafts {
        if draft.plane != draw_plane {
            draw_plane = draft.plane;
            draw_rank = 0;
        }
        let ring_start = cell_points.len() / 3;
        for point in &draft.ring {
            cell_points.extend_from_slice(point);
        }
        let ring_len = cell_points.len() / 3 - ring_start;
        let stack_start = cell_stack.len();
        cell_stack.extend_from_slice(&draft.stack);
        let determinacy = if draft.determinate {
            FOLDED_3D_CELL_DETERMINED
        } else {
            undetermined_cells += 1;
            FOLDED_3D_CELL_UNDETERMINED
        };
        cell_attr.extend_from_slice(&[
            draft.plane as i32,
            ring_start as i32,
            ring_len as i32,
            stack_start as i32,
            draft.stack.len() as i32,
            determinacy,
            draw_rank,
        ]);
        draw_rank += 1;
    }

    // --- edges ---------------------------------------------------------------
    let (edge_points, edge_attr, edge_fold_degrees) = edges(placement);

    let model = Folded3dRenderModel {
        schema_version: FOLDED_3D_RENDER_SCHEMA_VERSION,
        span: placement.span,
        face_count: face_count as u32,
        plane_count: index.planes.len() as u32,
        cell_count: drafts.len() as u32,
        edge_count: (edge_attr.len() / FOLDED_3D_EDGE_ATTR_STRIDE) as u32,
        ring_points,
        face_attr,
        face_normals,
        plane_frames,
        cell_points,
        cell_attr,
        cell_stack,
        edge_points,
        edge_attr,
        edge_fold_degrees,
        undetermined_cells,
    };
    model.validate()?;
    Ok(model)
}

struct CellDraft {
    plane: usize,
    area: f64,
    ring: Vec<Vec3>,
    stack: Vec<u32>,
    determinate: bool,
}

fn lift(origin: Vec3, u: Vec3, v: Vec3, x: f64, y: f64) -> Vec3 {
    [
        origin[0] + u[0] * x + v[0] * y,
        origin[1] + u[1] * x + v[1] * y,
        origin[2] + u[2] * x + v[2] * y,
    ]
}

/// `(min, max) -> "is the smaller index above the larger"`.
fn relation_map(ordering: Option<&Fold3dOrdering>) -> BTreeMap<(usize, usize), bool> {
    let mut map = BTreeMap::new();
    let Some(ordering) = ordering else {
        return map;
    };
    for relation in &ordering.relations {
        let (upper, lower) = (relation.upper_face, relation.lower_face);
        map.insert((upper.min(lower), upper.max(lower)), upper < lower);
    }
    map
}

/// Order one cell's faces top first, and say whether the order is complete.
///
/// Counting how many cell-mates each face is above is what makes the hole
/// visible: within a cell the relation is a total order, so the counts must be a
/// permutation of `0..n`. Anything else means at least one pair was left
/// undecided, and the count that repeats says so without a second pass.
///
/// Deliberately not [`crate::folding::subface_top_stack`]: that drops a tied
/// face into a hole and leaves its caller to pick an arbitrary survivor, which
/// is a silently invented stacking — the exact failure this feature is defined
/// against.
fn stack_of(faces: &[usize], above: &BTreeMap<(usize, usize), bool>) -> (Vec<u32>, bool) {
    let mut ranked: Vec<(usize, usize)> = Vec::with_capacity(faces.len());
    let mut seen = vec![0usize; faces.len()];
    for (slot, &face) in faces.iter().enumerate() {
        let mut count = 0usize;
        for &other in faces {
            if other == face {
                continue;
            }
            let key = (face.min(other), face.max(other));
            if let Some(&smaller_above) = above.get(&key)
                && smaller_above == (face < other)
            {
                count += 1;
            }
        }
        seen[slot] = count;
        ranked.push((count, face));
    }
    let mut counts = seen;
    counts.sort_unstable();
    let determinate = counts
        .iter()
        .enumerate()
        .all(|(expected, &count)| count == expected);
    // Descending count is top first: the top face is above every other.
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    (
        ranked.into_iter().map(|(_, face)| face as u32).collect(),
        determinate,
    )
}

/// Every arrangement edge once, with the faces on each side.
///
/// Keyed on the **vertex pair**, so a crease drawn as two collinear pieces is
/// two edges rather than one, matching what `FaceJoin` already keys on.
type Edges = (Vec<f64>, Vec<i32>, Vec<f64>);

fn edges(placement: &Placement3d) -> Edges {
    let mut by_key: BTreeMap<(usize, usize), (usize, Option<usize>, usize)> = BTreeMap::new();
    for (face, ring) in placement.rings.iter().enumerate() {
        for slot in 0..ring.len() {
            let a = ring[slot];
            let b = ring[(slot + 1) % ring.len()];
            let key = (a.min(b), a.max(b));
            match by_key.get_mut(&key) {
                Some(entry) => {
                    if entry.1.is_none() && entry.0 != face {
                        entry.1 = Some(face);
                    }
                }
                None => {
                    by_key.insert(key, (face, None, slot));
                }
            }
        }
    }

    let mut line_of: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for line in 0..placement.segment_count() {
        if let Some((a, b)) = placement.line_vertex_ends(line) {
            line_of.entry((a.min(b), a.max(b))).or_insert(line);
        }
    }

    let mut points = Vec::with_capacity(by_key.len() * 6);
    let mut attr = Vec::with_capacity(by_key.len() * FOLDED_3D_EDGE_ATTR_STRIDE);
    let mut fold_degrees = Vec::with_capacity(by_key.len());
    for (key, (face_a, face_b, slot)) in by_key {
        let ring = &placement.rings[face_a];
        let placed = &placement.face_points[face_a];
        let (Some(a), Some(b)) = (placed.get(slot), placed.get((slot + 1) % ring.len().max(1)))
        else {
            continue;
        };
        points.extend_from_slice(a);
        points.extend_from_slice(b);

        let line = line_of.get(&key).copied();
        let degrees = line
            .and_then(|line| placement.fold_angle_radians(line))
            .map(f64::to_degrees);
        let kind = match (face_b, degrees) {
            (None, _) => FOLDED_3D_EDGE_BORDER,
            (Some(_), Some(_)) => FOLDED_3D_EDGE_CREASE,
            (Some(_), None) => FOLDED_3D_EDGE_UNKNOWN,
        };
        attr.extend_from_slice(&[
            face_a as i32,
            face_b.map_or(-1, |face| face as i32),
            line.map_or(-1, |line| line as i32),
            kind,
        ]);
        fold_degrees.push(if kind == FOLDED_3D_EDGE_CREASE {
            degrees.unwrap_or(0.0)
        } else {
            0.0
        });
    }
    (points, attr, fold_degrees)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folding::HierarchyRelation;

    fn ordering_with(relations: Vec<(usize, usize)>) -> Fold3dOrdering {
        Fold3dOrdering {
            relations: relations
                .into_iter()
                .map(|(upper_face, lower_face)| HierarchyRelation {
                    upper_face,
                    lower_face,
                })
                .collect(),
            undetermined: Vec::new(),
            component_sizes: Vec::new(),
            crossings: Vec::new(),
            crossing_count: 0,
            variables: Vec::new(),
            component_of: Vec::new(),
            couplings: 0,
            current_case: 1,
            discovered_cases: 1,
            has_next: false,
        }
    }

    /// A complete order over three faces stacks them top first and says so.
    #[test]
    fn a_complete_cell_order_stacks_top_first() {
        let ordering = ordering_with(vec![(5, 3), (5, 9), (3, 9)]);
        let above = relation_map(Some(&ordering));
        let (stack, determinate) = stack_of(&[3, 5, 9], &above);
        assert_eq!(stack, vec![5, 3, 9]);
        assert!(determinate);
    }

    /// One missing pair is reported rather than tie-broken into a plausible
    /// stack. The order still comes out stable, but the cell is annotated.
    #[test]
    fn a_missing_pair_makes_the_cell_undetermined() {
        let ordering = ordering_with(vec![(5, 3)]);
        let above = relation_map(Some(&ordering));
        let (stack, determinate) = stack_of(&[3, 5, 9], &above);
        assert!(!determinate, "a hole in the order must not read as decided");
        assert_eq!(stack.len(), 3, "every face is still drawn");
    }

    /// A cyclic order over one cell is a hole, not a stack. The solver never
    /// emits one inside a single cell — a cycle *between* panels is legal and a
    /// cycle *within* one is what the search rejects — so this pins the reading
    /// rather than a behaviour.
    #[test]
    fn a_cycle_inside_one_cell_is_undetermined() {
        let ordering = ordering_with(vec![(3, 5), (5, 9), (9, 3)]);
        let above = relation_map(Some(&ordering));
        let (_, determinate) = stack_of(&[3, 5, 9], &above);
        assert!(!determinate);
    }

    /// No ordering at all still draws, with every multi-face cell annotated.
    #[test]
    fn no_ordering_leaves_a_single_face_cell_determined() {
        let above = relation_map(None);
        assert_eq!(stack_of(&[7], &above), (vec![7], true));
        assert!(!stack_of(&[7, 8], &above).1);
    }

    /// `validate` is not decoration: a hand-corrupted model fails it.
    #[test]
    fn validate_catches_a_stack_naming_a_face_that_does_not_exist() {
        let mut model = Folded3dRenderModel {
            schema_version: FOLDED_3D_RENDER_SCHEMA_VERSION,
            span: 1.0,
            face_count: 1,
            plane_count: 0,
            cell_count: 1,
            edge_count: 0,
            ring_points: vec![0.0; 9],
            face_attr: vec![0, 0, 3, 1],
            face_normals: vec![0.0, 0.0, 1.0],
            plane_frames: Vec::new(),
            cell_points: vec![0.0; 9],
            cell_attr: vec![0, 0, 3, 0, 1, FOLDED_3D_CELL_DETERMINED, 0],
            cell_stack: vec![0],
            edge_points: Vec::new(),
            edge_attr: Vec::new(),
            edge_fold_degrees: Vec::new(),
            undetermined_cells: 0,
        };
        assert_eq!(model.validate(), Ok(()));
        model.cell_stack = vec![4];
        assert_eq!(
            model.validate(),
            Err(RenderModelError::StackFaceOutOfRange {
                cell: 0,
                face: 4,
                face_count: 1,
            })
        );
    }

    /// And a slice that runs off the end of its array.
    #[test]
    fn validate_catches_a_slice_running_past_its_array() {
        let model = Folded3dRenderModel {
            schema_version: FOLDED_3D_RENDER_SCHEMA_VERSION,
            span: 1.0,
            face_count: 1,
            plane_count: 0,
            cell_count: 0,
            edge_count: 0,
            ring_points: vec![0.0; 9],
            face_attr: vec![0, 0, 5, 1],
            face_normals: vec![0.0, 0.0, 1.0],
            plane_frames: Vec::new(),
            cell_points: Vec::new(),
            cell_attr: Vec::new(),
            cell_stack: Vec::new(),
            edge_points: Vec::new(),
            edge_attr: Vec::new(),
            edge_fold_degrees: Vec::new(),
            undetermined_cells: 0,
        };
        assert_eq!(
            model.validate(),
            Err(RenderModelError::SliceOutOfRange {
                field: "ring_points",
                index: 0,
                start: 0,
                len: 5,
                available: 3,
            })
        );
    }

    /// A count that outruns its attribute array is an error, not a panic.
    ///
    /// The stride checks pass here — `face_attr` is a whole number of strides —
    /// and the face loop would then index straight past the end. This type
    /// derives `Deserialize`, so that is a reachable shape rather than a
    /// hypothetical one.
    #[test]
    fn validate_catches_a_count_its_attributes_cannot_cover() {
        let model = Folded3dRenderModel {
            schema_version: FOLDED_3D_RENDER_SCHEMA_VERSION,
            span: 1.0,
            face_count: 2,
            plane_count: 0,
            cell_count: 0,
            edge_count: 0,
            ring_points: vec![0.0; 9],
            face_attr: vec![0, 0, 3, 1],
            face_normals: vec![0.0, 0.0, 1.0],
            plane_frames: Vec::new(),
            cell_points: Vec::new(),
            cell_attr: Vec::new(),
            cell_stack: Vec::new(),
            edge_points: Vec::new(),
            edge_attr: Vec::new(),
            edge_fold_degrees: Vec::new(),
            undetermined_cells: 0,
        };
        assert_eq!(
            model.validate(),
            Err(RenderModelError::SliceOutOfRange {
                field: "face_attr",
                index: 1,
                start: FOLDED_3D_FACE_ATTR_STRIDE,
                len: FOLDED_3D_FACE_ATTR_STRIDE,
                available: FOLDED_3D_FACE_ATTR_STRIDE,
            })
        );
    }
}
