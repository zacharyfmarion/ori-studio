//! The cross-section along a fold line (plan D14, "the cross-section,
//! specified") and the depth-choice preview (research §4.5): what the layer
//! picker, the flap chips and the Step pane's "Layers" read.
//!
//! # Intervals
//!
//! The section is the paper just on ℓ's moving side, where a fold along ℓ
//! creases or turns it. Each face's moving piece (its image clipped to the
//! moving side, as the closure cuts it) touches ℓ along a segment, at a point
//! or not at all. ℓ is cut wherever such a segment starts or ends, which is
//! where a subface boundary crosses it, and each interval between two cuts
//! carries the faces touching it all along, top first as the viewer sees
//! them; neighbours with one stack are one interval. A face touching ℓ at a
//! point only is in no interval: it is not crossed.
//!
//! # Display layers
//!
//! Rows, row counts and picker targets are *display layers*, never faces: a
//! display layer is a set of faces joined across unfolded (F) creases, one
//! flat region of paper with one isometry, so one physical layer crossed by a
//! precrease is one row.
//!
//! Rows are ordered by a topological sort of the relation the interval stacks
//! give ("directly above in some interval"). Rows that are free together are
//! never in one interval, so their spans along ℓ are disjoint; the tie goes to
//! the row whose span starts first, then to its least face, and such pairs are
//! reported as unordered. On a valid state the relation should be acyclic
//! [derived]: a display layer is convex (the faces of the folded-crease
//! arrangement are, research §3), so it meets ℓ in one interval; a face
//! crossing its F crease is held to one side of both its faces
//! (tortilla-tortilla); and intervals on a line that pairwise meet share a
//! point, where the gate has checked the stack. Should grouping make a cycle
//! all the same (a woven layer), the section says so, and its per-interval
//! stacks are what to show at the cursor.
//!
//! Each row lies in one flap (plan D3): its faces are joined across creases
//! that reach the moving side, which is the closure's rule (i). "Layers" is
//! the most rows any interval stacks.

use std::collections::{BTreeMap, BTreeSet};

use oristudio_geometry::{Line, convex};
use serde::Serialize;

use crate::fold::PlainFold;
use crate::fold::closure::{Closure, MovingSide, moving_side};
use crate::fold::line::{Axis, Classified, classify_for_selection};
use crate::numerics::TOL;
use crate::pattern::{CreaseKind, FaceId};
use crate::refusal::{Flap, FoldRefusal, Refused, Side};
use crate::scene::{ScenePoint, top_first};
use crate::state::{State, sort_top_first};
use crate::view::Direction;

type Point = [f64; 2];

/// ℓ's moving side, measured along ℓ.
pub(crate) struct Along {
    pub(crate) classified: Classified,
    pub(crate) moving: MovingSide,
    /// The moving side's unit normal, in the model frame.
    pub(crate) normal: Point,
    /// The model-frame point at parameter 0, and the unit direction the
    /// parameter runs in: with the moving side on its left as the viewer
    /// sees it.
    origin: Point,
    direction: Point,
    /// Between consecutive cuts, in order along ℓ, the gaps left out.
    pub(crate) runs: Vec<Run>,
}

/// One interval between two cuts of ℓ.
pub(crate) struct Run {
    pub(crate) t: [f64; 2],
    /// `(face position, flap)` of every face whose piece touches ℓ all along
    /// it, top first in the model frame.
    pub(crate) faces: Vec<(usize, usize)>,
}

impl Along {
    /// Snap and classify `line` as a fold along it would, then measure the
    /// moving side's paper along it.
    pub(crate) fn new(state: &State, line: &Line, side: Side) -> Result<Along, Refused> {
        let classified =
            classify_for_selection(&state.geometry().vertex_images, Axis::new(line, side))?;
        let moving = moving_side(state, &classified)?;
        let (line, side) = classified.axis.line_and_side();
        let normal = match side {
            Side::Positive => line.n,
            Side::Negative => [-line.n[0], -line.n[1]],
        };
        // A turn-over mirrors the display, which swaps left and right.
        let direction = if state.view().flipped {
            [-normal[1], normal[0]]
        } else {
            [normal[1], -normal[0]]
        };
        let origin = line.foot();
        let param =
            |p: Point| (p[0] - origin[0]) * direction[0] + (p[1] - origin[1]) * direction[1];

        // Each piece's contact with ℓ: the extent of its points on ℓ.
        let contacts: Vec<Option<([f64; 2], usize)>> = moving
            .pieces
            .iter()
            .zip(&moving.flap_of)
            .map(|(piece, flap)| {
                let (piece, flap) = (piece.as_ref()?, (*flap)?);
                let on: Vec<f64> = piece
                    .iter()
                    .filter(|&&p| classified.axis.distance(p) <= TOL)
                    .map(|&p| param(p))
                    .collect();
                let lo = on.iter().copied().fold(f64::INFINITY, f64::min);
                let hi = on.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                (hi - lo > TOL).then_some(([lo, hi], flap))
            })
            .collect();

        let mut ends: Vec<f64> = contacts.iter().flatten().flat_map(|(t, _)| *t).collect();
        ends.sort_by(f64::total_cmp);
        let mut cuts: Vec<f64> = Vec::with_capacity(ends.len());
        for t in ends {
            if cuts.last().is_none_or(|&c| t - c > TOL) {
                cuts.push(t);
            }
        }
        let mut runs = Vec::new();
        for pair in cuts.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let touching: BTreeMap<FaceId, (usize, usize)> = contacts
                .iter()
                .enumerate()
                .filter_map(|(f, c)| match c {
                    Some(([lo, hi], flap)) if *lo <= a + TOL && *hi >= b - TOL => {
                        Some((state.faces()[f].id, (f, *flap)))
                    }
                    _ => None,
                })
                .collect();
            if touching.is_empty() {
                continue;
            }
            let ids: Vec<FaceId> = touching.keys().copied().collect();
            let faces = top_first(state, &ids)
                .into_iter()
                .filter_map(|id| touching.get(&id).copied())
                .collect();
            runs.push(Run { t: [a, b], faces });
        }
        Ok(Along {
            classified,
            moving,
            normal,
            origin,
            direction,
            runs,
        })
    }

    /// The model-frame point at parameter `t`.
    pub(crate) fn at(&self, t: f64) -> Point {
        [
            self.origin[0] + t * self.direction[0],
            self.origin[1] + t * self.direction[1],
        ]
    }

    /// The parameter of a model-frame point's foot on ℓ.
    pub(crate) fn param(&self, p: Point) -> f64 {
        (p[0] - self.origin[0]) * self.direction[0] + (p[1] - self.origin[1]) * self.direction[1]
    }

    /// The parameters along ℓ of the ray from the model point `from` toward
    /// the unit direction `toward`: `[lo, hi]`, one end unbounded.
    pub(crate) fn ray(&self, from: Point, toward: Point) -> [f64; 2] {
        let t = self.param(from);
        if toward[0] * self.direction[0] + toward[1] * self.direction[1] >= 0.0 {
            [t, f64::INFINITY]
        } else {
            [f64::NEG_INFINITY, t]
        }
    }

    /// The parameter interval of ℓ within `margin` of a convex
    /// counter-clockwise polygon (see [`clip_line`]).
    pub(crate) fn clip(&self, polygon: &[Point], margin: f64) -> Option<[f64; 2]> {
        clip_line(polygon, self.origin, self.direction, margin)
    }
}

/// The parameter interval of `origin + t · direction` (a unit direction)
/// within `margin` of a convex counter-clockwise polygon, its boundary
/// included; none when that is no longer than the tolerance.
pub(crate) fn clip_line(
    polygon: &[Point],
    origin: Point,
    direction: Point,
    margin: f64,
) -> Option<[f64; 2]> {
    let (mut lo, mut hi) = (f64::NEG_INFINITY, f64::INFINITY);
    let n = polygon.len();
    let mut any = false;
    for i in 0..n {
        let Some(plane) = convex::HalfPlane::left_of(polygon[i], polygon[(i + 1) % n]) else {
            continue;
        };
        any = true;
        let at = plane.signed_distance(origin) + margin;
        let rate = plane.normal()[0] * direction[0] + plane.normal()[1] * direction[1];
        if rate.abs() < 1e-15 {
            if at < 0.0 {
                return None;
            }
            continue;
        }
        let t = -at / rate;
        if rate > 0.0 {
            lo = lo.max(t);
        } else {
            hi = hi.min(t);
        }
    }
    (any && hi - lo > TOL).then_some([lo, hi])
}

/// The paper along a fold line, as the layer picker shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CrossSection {
    /// The line as a fold along it would fold (snapped), in the model frame,
    /// and its moving side.
    pub line: Line,
    pub side: Side,
    /// Where the section starts and ends, in the scene frame (the view
    /// applied). It runs with the moving side on its left as the viewer sees
    /// it; every `start`, `end` and span below is a distance from `from`.
    pub from: ScenePoint,
    pub to: ScenePoint,
    pub intervals: Vec<SectionInterval>,
    /// Display layers, top to bottom as the viewer sees them (by span
    /// position for a woven section).
    pub rows: Vec<SectionRow>,
    pub order: RowOrder,
    /// The flaps on the moving side (plan D3), as a fold along this line
    /// reports them; each row names one.
    pub flaps: Vec<Flap>,
    /// "Layers": the most rows one interval stacks.
    pub layers: usize,
}

/// A stretch of ℓ with one stack.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SectionInterval {
    pub start: f64,
    pub end: f64,
    /// Top first as the viewer sees them.
    pub faces: Vec<FaceId>,
    /// The rows of those faces, top first.
    pub rows: Vec<usize>,
}

/// A display layer: faces joined across F creases.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SectionRow {
    /// Ascending.
    pub faces: Vec<FaceId>,
    /// Where it meets ℓ, `[start, end]`, in order.
    pub spans: Vec<[f64; 2]>,
    /// Its flap: an index into [`CrossSection::flaps`].
    pub flap: usize,
}

/// How the rows are ordered.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum RowOrder {
    /// Topologically. `unordered` lists the pairs of rows `[i, j]`, `i < j`,
    /// that no interval relates, directly or through other rows: they meet ℓ
    /// apart, and their places in the list are by span position only.
    Layered { unordered: Vec<[usize; 2]> },
    /// Grouping faces into rows made a cycle: read the interval at the
    /// cursor instead.
    Woven,
}

impl CrossSection {
    /// The rows whose faces are among `moving` (a fold's U, which is a union
    /// of flaps, so a row moves whole or not at all): "n of m layers moving".
    pub fn moving_rows(&self, moving: &[FaceId]) -> Vec<usize> {
        let moving: BTreeSet<FaceId> = moving.iter().copied().collect();
        (0..self.rows.len())
            .filter(|&r| self.rows[r].faces.iter().any(|f| moving.contains(f)))
            .collect()
    }

    /// The interval at a distance from `from`, for a woven section's cursor.
    pub fn interval_at(&self, distance: f64) -> Option<&SectionInterval> {
        self.intervals
            .iter()
            .find(|i| i.start - TOL <= distance && distance <= i.end + TOL)
    }
}

/// One stack of layers a depth seed can pick: what moving the top `layers`
/// at a point (the bottom ones for a mountain) takes along.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DepthChoice {
    /// The fewest layers at the point that move this set: the depth to store.
    pub layers: usize,
    /// The most layers that move the same set.
    pub through: usize,
    /// U: the faces that move, in id order.
    pub moving: Vec<FaceId>,
    /// The flaps the depth picks, and those the closure adds.
    pub picked: Vec<usize>,
    pub added: Vec<usize>,
}

impl State {
    /// The cross-section of the paper along `line` on its `side` (see the
    /// module docs). This describes all layers before selection, including
    /// layers a near miss would prevent from moving. Depth choices and fold
    /// analysis validate the selected paper. Unsafe snapping or no paper on
    /// the moving side still refuses the section.
    pub fn cross_section(&self, line: &Line, side: Side) -> Result<CrossSection, Refused> {
        let along = Along::new(self, line, side)?;
        Ok(section(self, &along))
    }

    /// The distinct moving sets of the top 1, 2, … layers at the sheet point
    /// `at` (the bottom ones for a mountain), each with the depths that give
    /// it, fewest layers first: the preview a depth picker shows before
    /// anything is committed (research §4.5). `op` gives the line, side,
    /// direction and placement; its seed is replaced, and the closure always
    /// includes what it adds, which each choice reports. A depth whose
    /// analysis is refused (everything would move, say) is left out; the
    /// choices are analysed, not landed, so one can still be refused when it
    /// lands (a sliver).
    ///
    /// Each depth's answer is what [`State::analyse_fold`] gives for a
    /// [`Seed::Depth`](crate::Seed::Depth) of that many layers, but the
    /// closure is grown one layer at a time rather than redone per depth (see
    /// `closure::Closure`): a layer already in U moves nothing new, and once
    /// a depth is refused, every deeper one is too.
    pub fn depth_choices(&self, op: &PlainFold, at: Point) -> Result<Vec<DepthChoice>, Refused> {
        let classified =
            classify_for_selection(&self.geometry().vertex_images, Axis::new(&op.line, op.side))?;
        let side = moving_side(self, &classified)?;
        let face = self
            .face_at(at)
            .and_then(|id| self.face_position(id))
            .ok_or(FoldRefusal::WitnessNotInFace { point: at })?;
        let geometry = self.geometry();
        let image = geometry.isometries[face].apply(at);
        if classified.axis.distance(image) <= TOL {
            return Err(FoldRefusal::SeedNotOnMovingSide { point: at }.into());
        }
        // The layers at the point on the moving side, as a depth seed reads
        // them: top first in the model frame, from the bottom for a mountain.
        let ids: Vec<FaceId> = geometry
            .images
            .iter()
            .zip(&side.pieces)
            .enumerate()
            .filter(|(_, (polygon, piece))| {
                piece.is_some() && convex::contains_point(polygon, image, TOL)
            })
            .map(|(f, _)| self.faces()[f].id)
            .collect();
        let direction = self.view().model_direction(op.direction);
        // A stack with a pair missing, or a tuck target in no face, refuses
        // every depth alike.
        let Some(mut stack) = sort_top_first(&ids, self.order()) else {
            return Ok(Vec::new());
        };
        if direction == Direction::Mountain {
            stack.reverse();
        }
        let Ok(mut closure) = Closure::new(self, classified, direction, side, &op.placement) else {
            return Ok(Vec::new());
        };
        let mut seed: Vec<usize> = Vec::with_capacity(stack.len());
        let mut choices: Vec<DepthChoice> = Vec::new();
        for (k, id) in stack.into_iter().enumerate() {
            let layers = k + 1;
            let Some(f) = self.face_position(id) else {
                break;
            };
            seed.push(f);
            // Refused only for an overlap whose pair the order lacks, which
            // the gate never lets a state have.
            let Ok(grew) = closure.grow(&[f]) else {
                break;
            };
            match choices.last_mut() {
                Some(choice) if !grew => choice.through = layers,
                _ => {
                    if closure.refusal().is_some() {
                        break;
                    }
                    let picked = closure.picked(&seed);
                    choices.push(DepthChoice {
                        layers,
                        through: layers,
                        moving: closure.moved_faces(),
                        added: closure.added(&picked),
                        picked,
                    });
                }
            }
        }
        Ok(choices)
    }
}

/// A row while the section is gathered.
struct Draft {
    faces: BTreeSet<FaceId>,
    spans: Vec<[f64; 2]>,
    flap: usize,
}

fn section(state: &State, along: &Along) -> CrossSection {
    let flipped = state.view().flipped;
    let (line, side) = along.classified.axis.line_and_side();
    let start = along.runs.first().map_or(0.0, |r| r.t[0]);
    let end = along.runs.last().map_or(start, |r| r.t[1]);
    let scene = |t: f64| ScenePoint::from(state.view().transform().apply(along.at(t)));

    // Runs as seen, neighbours with one stack joined.
    let mut stretches: Vec<Run> = Vec::new();
    for run in &along.runs {
        let mut faces = run.faces.clone();
        if flipped {
            faces.reverse();
        }
        match stretches.last_mut() {
            Some(last) if last.t[1] == run.t[0] && last.faces == faces => last.t[1] = run.t[1],
            _ => stretches.push(Run { t: run.t, faces }),
        }
    }

    // Display layers, numbered as they first appear.
    let layer_of = flat_components(state);
    let mut row_of_layer: BTreeMap<usize, usize> = BTreeMap::new();
    let mut drafts: Vec<Draft> = Vec::new();
    let mut stacks: Vec<Vec<usize>> = Vec::with_capacity(stretches.len());
    for Run { t, faces } in &stretches {
        let mut stack: Vec<usize> = Vec::with_capacity(faces.len());
        for &(f, flap) in faces {
            let r = *row_of_layer.entry(layer_of[f]).or_insert_with(|| {
                drafts.push(Draft {
                    faces: BTreeSet::new(),
                    spans: Vec::new(),
                    flap,
                });
                drafts.len() - 1
            });
            let draft = &mut drafts[r];
            draft.faces.insert(state.faces()[f].id);
            match draft.spans.last_mut() {
                Some(span) if (span[1] - t[0]).abs() <= TOL => span[1] = t[1],
                _ => draft.spans.push(*t),
            }
            if !stack.contains(&r) {
                stack.push(r);
            }
        }
        stacks.push(stack);
    }

    let keys: Vec<(f64, FaceId)> = drafts
        .iter()
        .map(|d| {
            (
                d.spans.first().map_or(0.0, |s| s[0]),
                d.faces.first().copied().unwrap_or(FaceId(u32::MAX)),
            )
        })
        .collect();
    let (sequence, order) = match order_rows(&keys, &stacks) {
        Some((sequence, unordered)) => (sequence, RowOrder::Layered { unordered }),
        None => {
            let mut sequence: Vec<usize> = (0..drafts.len()).collect();
            sequence.sort_by(|&a, &b| by_key(keys[a], keys[b]));
            (sequence, RowOrder::Woven)
        }
    };
    let mut position = vec![0; drafts.len()];
    for (at, &r) in sequence.iter().enumerate() {
        position[r] = at;
    }

    let intervals: Vec<SectionInterval> = stretches
        .iter()
        .zip(&stacks)
        .map(|(run, stack)| SectionInterval {
            start: run.t[0] - start,
            end: run.t[1] - start,
            faces: run
                .faces
                .iter()
                .map(|&(f, _)| state.faces()[f].id)
                .collect(),
            rows: stack.iter().map(|&r| position[r]).collect(),
        })
        .collect();
    let mut drafts: Vec<Option<Draft>> = drafts.into_iter().map(Some).collect();
    let rows = sequence
        .iter()
        .filter_map(|&r| drafts[r].take())
        .map(|d| SectionRow {
            faces: d.faces.into_iter().collect(),
            spans: d
                .spans
                .iter()
                .map(|s| [s[0] - start, s[1] - start])
                .collect(),
            flap: d.flap,
        })
        .collect();
    CrossSection {
        line,
        side,
        from: scene(start),
        to: scene(end),
        layers: intervals.iter().map(|i| i.rows.len()).max().unwrap_or(0),
        intervals,
        rows,
        order,
        flaps: along.moving.flaps.clone(),
    }
}

/// Per face position, its display layer: the least position joined to it
/// across F creases.
fn flat_components(state: &State) -> Vec<usize> {
    flat_components_within(state, |_| true)
}

/// [`flat_components`] joined only across F creases between two faces
/// `within` admits: a face it refuses is a layer of its own, and no layer
/// reaches through it.
pub(crate) fn flat_components_within(state: &State, within: impl Fn(usize) -> bool) -> Vec<usize> {
    let n = state.faces().len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn root(parent: &mut [usize], mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        x
    }
    for (k, crease) in state.creases().iter().enumerate() {
        if !matches!(crease.kind, CreaseKind::Flat(_)) {
            continue;
        }
        if let [f, g] = state.topology().crease_faces[k][..]
            && within(f)
            && within(g)
        {
            let (a, b) = (root(&mut parent, f), root(&mut parent, g));
            parent[a.max(b)] = a.min(b);
        }
    }
    (0..n).map(|f| root(&mut parent, f)).collect()
}

fn by_key(a: (f64, FaceId), b: (f64, FaceId)) -> std::cmp::Ordering {
    a.0.total_cmp(&b.0).then(a.1.cmp(&b.1))
}

/// Rows top to bottom from the interval stacks (each top first): Kahn's
/// algorithm over "directly above in some stack", taking the free row with
/// the least key each time; and the pairs of positions in that order that
/// the relation does not relate. None when the relation has a cycle.
fn order_rows(
    keys: &[(f64, FaceId)],
    stacks: &[Vec<usize>],
) -> Option<(Vec<usize>, Vec<[usize; 2]>)> {
    let n = keys.len();
    let mut below: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); n];
    let mut above_count = vec![0usize; n];
    for stack in stacks {
        for pair in stack.windows(2) {
            if pair[0] != pair[1] && below[pair[0]].insert(pair[1]) {
                above_count[pair[1]] += 1;
            }
        }
    }
    let mut sequence = Vec::with_capacity(n);
    let mut free: Vec<usize> = (0..n).filter(|&r| above_count[r] == 0).collect();
    while let Some((i, _)) = free
        .iter()
        .enumerate()
        .min_by(|a, b| by_key(keys[*a.1], keys[*b.1]))
    {
        let r = free.swap_remove(i);
        sequence.push(r);
        for &b in &below[r] {
            above_count[b] -= 1;
            if above_count[b] == 0 {
                free.push(b);
            }
        }
    }
    if sequence.len() < n {
        return None;
    }
    // What each row lies above, through any chain: bottom up.
    let mut reach: Vec<Vec<bool>> = vec![vec![false; n]; n];
    for &r in sequence.iter().rev() {
        let mut row = vec![false; n];
        for &b in &below[r] {
            row[b] = true;
            for (x, &reached) in reach[b].iter().enumerate() {
                row[x] |= reached;
            }
        }
        reach[r] = row;
    }
    let mut unordered = Vec::new();
    for i in 0..n {
        for j in i + 1..n {
            if !reach[sequence[i]][sequence[j]] {
                unordered.push([i, j]);
            }
        }
    }
    Some((sequence, unordered))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(t: f64, face: u32) -> (f64, FaceId) {
        (t, FaceId(face))
    }

    #[test]
    fn rows_follow_the_stacks() {
        // Row 2 over row 0 over row 1 in one interval.
        let keys = [key(0.0, 0), key(0.0, 1), key(0.0, 2)];
        let Some((sequence, unordered)) = order_rows(&keys, &[vec![2, 0, 1]]) else {
            panic!("a single stack is a cycle");
        };
        assert_eq!(sequence, vec![2, 0, 1]);
        assert!(unordered.is_empty());
    }

    #[test]
    fn rows_apart_are_unordered_and_placed_by_span() {
        // Rows 0 and 1 meet ℓ apart, both under row 2; row 1 starts first.
        let keys = [key(0.6, 0), key(0.1, 1), key(0.0, 2)];
        let stacks = [vec![2, 1], vec![2, 0]];
        let Some((sequence, unordered)) = order_rows(&keys, &stacks) else {
            panic!("cycle");
        };
        assert_eq!(sequence, vec![2, 1, 0]);
        assert_eq!(unordered, vec![[1, 2]]);
        // Related through a chain is ordered: 3 over 4 at one place, 4 over
        // 5 at another, so 3 and 5 are ordered without sharing an interval.
        let keys = [key(0.0, 3), key(0.0, 4), key(0.5, 5)];
        let Some((sequence, unordered)) = order_rows(&keys, &[vec![0, 1], vec![1, 2]]) else {
            panic!("cycle");
        };
        assert_eq!(sequence, vec![0, 1, 2]);
        assert!(unordered.is_empty());
    }

    #[test]
    fn a_woven_layer_has_no_row_order() {
        // One row over another in one interval and under it in the next: a
        // layer woven through another.
        let keys = [key(0.0, 0), key(0.0, 1)];
        assert_eq!(order_rows(&keys, &[vec![0, 1], vec![1, 0]]), None);
        // Three rows in a cycle, no two in more than one interval.
        let keys = [key(0.0, 0), key(0.2, 1), key(0.4, 2)];
        let stacks = [vec![0, 1], vec![1, 2], vec![2, 0]];
        assert_eq!(order_rows(&keys, &stacks), None);
    }

    #[test]
    fn lines_clip_to_convex_polygons() {
        let square = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        let hit = clip_line(&square, [-1.0, 0.5], [1.0, 0.0], 0.0);
        assert_eq!(hit, Some([1.0, 2.0]));
        // Along an edge, the boundary counts; just outside it, only within
        // the margin.
        assert_eq!(
            clip_line(&square, [0.0, 0.0], [1.0, 0.0], 0.0),
            Some([0.0, 1.0])
        );
        assert_eq!(
            clip_line(&square, [0.0, -0.5 * TOL], [1.0, 0.0], TOL),
            Some([-TOL, 1.0 + TOL])
        );
        assert_eq!(clip_line(&square, [0.0, -2.0 * TOL], [1.0, 0.0], TOL), None);
        // Missing it, and touching a corner.
        assert_eq!(clip_line(&square, [0.0, 2.0], [1.0, 0.0], TOL), None);
        let s = 0.5_f64.sqrt();
        assert_eq!(clip_line(&square, [-1.0, 1.0], [s, -s], 0.0), None);
    }
}
