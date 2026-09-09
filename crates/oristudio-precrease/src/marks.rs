//! What is actually on the paper: where the creases are, and which marks a
//! folder can therefore find.
//!
//! [`State`] reasons about infinite lines clipped to the sheet, and records a
//! point wherever two of them cross. That is the right model for whether a fold
//! is *constructible* — the geometry is the geometry — and the wrong one for
//! whether a folder can *perform* it, because a fold only leaves a crease where
//! the pattern asked for one. Two chords meeting is not two creases meeting.
//!
//! So this module answers two questions the state cannot:
//!
//! - **Is the mark at this point on the paper?** Two creases have to reach it,
//!   and cross squarely enough to locate it. [`mark_exists`].
//! - **Can I find where this crease begins and ends?** Its ends must be on the
//!   sheet's edge or at a mark that exists. [`ends_are_found`].
//!
//! One implementation, used twice and deliberately: the closure asks the second
//! question to decide what to fold next, and the ordering pass asks the first to
//! decide how to describe a step. They must not be able to disagree about what
//! is on the paper.

use crate::constants::MIN_ANGLE_SINE;
use crate::line::Line;
use crate::predicates::{Ref, Witness};
use crate::state::{LineTag, State};
use crate::tol::TOL;

/// Where each line of a state is creased, grown one fold at a time.
///
/// Line parameters along each line's own direction, as [`Line::parameter_of`]
/// measures them. `None` means creased everywhere it exists — a sheet edge, or
/// an auxiliary fold, which the pinch pass may narrow later but only ever to
/// the marks that are used. An empty run list means not creased at all yet.
#[derive(Debug, Clone, Default)]
pub struct Creased {
    runs: Vec<Option<Vec<(f64, f64)>>>,
}

impl Creased {
    /// Nothing creased yet but the sheet's own edges.
    pub fn new(state: &State) -> Creased {
        let mut runs = vec![Some(Vec::new()); state.line_count()];
        for (id, l) in state.lines().iter().enumerate() {
            if l.tag == LineTag::Edge {
                runs[id] = None;
            }
        }
        Creased { runs }
    }

    /// Grow to cover a state that has gained lines since this was built.
    fn widen(&mut self, state: &State) {
        while self.runs.len() < state.line_count() {
            let id = self.runs.len();
            let edge = state
                .lines()
                .get(id)
                .is_some_and(|l| l.tag == LineTag::Edge);
            self.runs.push(if edge { None } else { Some(Vec::new()) });
        }
    }

    /// Record a fold that creases `line` only along `spans`.
    pub fn add_spans(
        &mut self,
        state: &State,
        line_id: usize,
        line: &Line,
        spans: &[[[f64; 2]; 2]],
    ) {
        self.widen(state);
        let Some(entry) = self.runs.get_mut(line_id) else {
            return;
        };
        if spans.is_empty() {
            *entry = None;
            return;
        }
        *entry = Some(
            spans
                .iter()
                .map(|[a, b]| {
                    let (u, v) = (line.parameter_of(*a), line.parameter_of(*b));
                    if u <= v { (u, v) } else { (v, u) }
                })
                .collect(),
        );
    }

    /// Record a fold creased along its whole chord.
    pub fn add_whole(&mut self, state: &State, line_id: usize) {
        self.widen(state);
        if let Some(entry) = self.runs.get_mut(line_id) {
            *entry = None;
        }
    }

    /// Whether the crease on `line_id` reaches `p`.
    pub fn reaches(&self, state: &State, line_id: usize, p: [f64; 2]) -> bool {
        match self.runs.get(line_id) {
            None => false,
            Some(None) => true,
            Some(Some(runs)) => {
                let t = state.line(line_id).parameter_of(p);
                runs.iter().any(|&(u, v)| t >= u - TOL && t <= v + TOL)
            }
        }
    }
}

/// Whether the mark at `p` is on the paper, not merely in the state.
///
/// Two creases have to meet there — both made, and both pressed at that spot —
/// and they have to cross squarely enough to locate it, which is the same
/// conditioning floor the ordering pass applies to a witness's inputs.
pub fn mark_exists(state: &State, creased: &Creased, p: [f64; 2], lines: &[usize]) -> bool {
    let present: Vec<usize> = lines
        .iter()
        .copied()
        .filter(|&l| creased.reaches(state, l, p))
        .collect();
    present.iter().enumerate().any(|(i, &a)| {
        present[i + 1..]
            .iter()
            .any(|&b| state.line(a).cross(state.line(b)).abs() >= MIN_ANGLE_SINE)
    })
}

/// The marks a witness sights that are **not** on the paper, by point id.
///
/// Corners are the sheet's own and are always there; a line input is a whole
/// crease rather than a spot on one, so only points are asked about.
///
/// This lives here rather than in the pass that happens to need it, because two
/// passes need it and they must not be able to disagree — the closure asks
/// whether a fold can be *performed* now, the ordering pass asks how to describe
/// it, and one answer has to serve both. See the module header.
pub fn witness_missing_marks(state: &State, creased: &Creased, w: &Witness) -> Vec<usize> {
    w.inputs
        .iter()
        .filter_map(|r| match r {
            Ref::Point { id } if !point_mark_exists(state, creased, *id) => Some(*id),
            _ => None,
        })
        .collect()
}

/// Whether every mark this witness sights is on the paper.
pub fn witness_marks_exist(state: &State, creased: &Creased, w: &Witness) -> bool {
    w.inputs.iter().all(|r| match r {
        Ref::Point { id } => point_mark_exists(state, creased, *id),
        _ => true,
    })
}

/// The mark at a state point, by its id.
pub fn point_mark_exists(state: &State, creased: &Creased, id: usize) -> bool {
    let Some(point) = state.points().get(id) else {
        return false;
    };
    mark_exists(state, creased, point.p, &point.lines)
}

/// The maximal runs the pattern wants creased on `line`, end to end.
///
/// The pattern's segments are not creases. A CP splits a line wherever the
/// assignment changes, so one crease that runs the width of the sheet arrives
/// here as four segments meeting at three interior points — and those points
/// are not places the crease *stops*, they are places it changes colour. Only
/// the ends of the merged runs are ends.
pub fn crease_runs(line: &Line, spans: &[[[f64; 2]; 2]]) -> Vec<([f64; 2], [f64; 2])> {
    let mut ts: Vec<(f64, f64)> = spans
        .iter()
        .map(|[a, b]| {
            let (u, v) = (line.parameter_of(*a), line.parameter_of(*b));
            if u <= v { (u, v) } else { (v, u) }
        })
        .collect();
    ts.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut runs: Vec<(f64, f64)> = Vec::new();
    for (u, v) in ts {
        match runs.last_mut() {
            Some(last) if u <= last.1 + TOL => last.1 = last.1.max(v),
            _ => runs.push((u, v)),
        }
    }
    runs.into_iter()
        .map(|(u, v)| (line.point_at(u), line.point_at(v)))
        .collect()
}

/// Whether the creases the pattern wants on `line` cover `p`.
///
/// Empty spans mean the whole chord — an auxiliary fold, or a target the caller
/// supplied as a bare line.
pub fn runs_reach(line: &Line, spans: &[[[f64; 2]; 2]], p: [f64; 2]) -> bool {
    if spans.is_empty() {
        return true;
    }
    let t = line.parameter_of(p);
    crease_runs(line, spans)
        .into_iter()
        .any(|(a, b)| t >= line.parameter_of(a) - TOL && t <= line.parameter_of(b) + TOL)
}

/// Whether every end of every crease on `line` is somewhere the folder can find.
///
/// An end on the sheet's edge needs nothing — you crease to the edge of the
/// paper. Anywhere else needs a landmark: a crease that has already been made,
/// that reaches this spot, and that meets `line` squarely enough to say where
/// the spot is. One is enough, because the fold being made supplies the other
/// half of the crossing — you fold along the line and stop where the crease you
/// can see runs into it.
///
/// This is the question the closure's own test never asked. Sighting a fold
/// *line* and performing the *crease* the pattern wants along it are different
/// things, and the gap between them is an instruction that says "crease along
/// here and stop… somewhere".
pub fn ends_are_found(
    state: &State,
    creased: &Creased,
    line: &Line,
    spans: &[[[f64; 2]; 2]],
) -> bool {
    crease_runs(line, spans)
        .into_iter()
        .flat_map(|(a, b)| [a, b])
        .all(|end| end_is_found(state, creased, line, end))
}

/// One end of one crease: see [`ends_are_found`].
pub fn end_is_found(state: &State, creased: &Creased, line: &Line, end: [f64; 2]) -> bool {
    state.sheet().on_boundary(end)
        || (0..state.line_count()).any(|id| {
            let l = state.line(id);
            l.distance_to_point(end) <= TOL
                && l.cross(line).abs() >= MIN_ANGLE_SINE
                && creased.reaches(state, id, end)
        })
}
