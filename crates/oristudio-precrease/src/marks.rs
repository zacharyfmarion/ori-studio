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

    /// Record that `line` is creased along `spans` — **in addition to** whatever
    /// it was creased along before.
    ///
    /// A union, not a replacement. The first version replaced, which was
    /// invisible while every line was recorded exactly once, and would have
    /// been the first thing to break the moment a press step recorded a second
    /// run on a line: the pattern's own creases would vanish and only the pinch
    /// remain. A line already creased everywhere stays so. Empty `spans` add
    /// nothing; a whole-chord fold is [`Creased::add_whole`], said out loud.
    pub fn add_spans(
        &mut self,
        state: &State,
        line_id: usize,
        line: &Line,
        spans: &[[[f64; 2]; 2]],
    ) {
        self.widen(state);
        let Some(Some(runs)) = self.runs.get_mut(line_id) else {
            return;
        };
        runs.extend(spans.iter().map(|[a, b]| {
            let (u, v) = (line.parameter_of(*a), line.parameter_of(*b));
            if u <= v { (u, v) } else { (v, u) }
        }));
    }

    /// Record a fold creased along its whole chord.
    pub fn add_whole(&mut self, state: &State, line_id: usize) {
        self.widen(state);
        if let Some(entry) = self.runs.get_mut(line_id) {
            *entry = None;
        }
    }

    /// Whether `line_id` has been folded at all — creased somewhere, or
    /// everywhere. A sheet edge always has.
    pub fn is_folded(&self, line_id: usize) -> bool {
        match self.runs.get(line_id) {
            None => false,
            Some(None) => true,
            Some(Some(runs)) => !runs.is_empty(),
        }
    }

    /// The creased runs on `line_id` as parameter intervals along the line,
    /// or `None` when it is creased everywhere (or unknown).
    pub fn runs_of(&self, line_id: usize) -> Option<&[(f64, f64)]> {
        self.runs.get(line_id).and_then(|r| r.as_deref())
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

/// The creased runs of `line_id` as parameter intervals along its line — the
/// whole in-paper chord when it is creased everywhere.
fn creased_intervals(state: &State, creased: &Creased, line_id: usize) -> Vec<(f64, f64)> {
    match creased.runs_of(line_id) {
        Some(runs) => runs.to_vec(),
        None => state
            .sheet()
            .clip_parameters(state.line(line_id))
            .map(|(t0, t1)| vec![(t0, t1)])
            .unwrap_or_default(),
    }
}

/// Whether some creased part of `line_id`, carried across `fold`, lands on
/// some creased part of `onto`.
///
/// This is what makes a line usable as a reference: the folder aligns crease
/// to crease, and a line that is only creased where the fold does not take it
/// cannot be aligned to anything. `onto` may be `line_id` itself — folding a
/// line onto itself — in which case the question is whether the crease on one
/// side of the fold reaches across to crease on the other. Reflection is its
/// own inverse, so which of the two lines actually moves does not change the
/// answer.
pub fn crease_lands_on(
    state: &State,
    creased: &Creased,
    fold: &Line,
    line_id: usize,
    onto: usize,
) -> bool {
    let from = state.line(line_id);
    let to = state.line(onto);
    let landing: Vec<(f64, f64)> = creased_intervals(state, creased, line_id)
        .into_iter()
        .map(|(u, v)| {
            let a = fold.reflect_point(from.point_at(u));
            let b = fold.reflect_point(from.point_at(v));
            let (x, y) = (to.parameter_of(a), to.parameter_of(b));
            if x <= y { (x, y) } else { (y, x) }
        })
        .collect();
    creased_intervals(state, creased, onto)
        .into_iter()
        .any(|(p, q)| landing.iter().any(|&(x, y)| x <= q + TOL && p <= y + TOL))
}

/// Whether a mark, carried across `fold`, lands on a creased part of `line_id`.
pub fn point_lands_on(
    state: &State,
    creased: &Creased,
    fold: &Line,
    point: usize,
    line_id: usize,
) -> bool {
    let Some(p) = state.points().get(point) else {
        return false;
    };
    let r = fold.reflect_point(p.p);
    state.line(line_id).distance_to_point(r) <= TOL && creased.reaches(state, line_id, r)
}

/// Whether every alignment `w` asks the folder to make is between creases
/// that are on the paper — the line-input counterpart of
/// [`witness_marks_exist`].
///
/// `State` certified the witness against infinite lines; this asks whether
/// the creases the pattern actually put on those lines reach the places the
/// fold uses them. A perpendicular to a line whose crease stops short of the
/// foot is constructible and cannot be folded, because there is nothing there
/// to fold onto itself.
pub fn witness_aligns(state: &State, creased: &Creased, fold: &Line, w: &Witness) -> bool {
    let id = |i: usize| w.inputs.get(i).map(|r| r.id());
    match w.axiom {
        3 => match (id(0), id(1)) {
            (Some(a), Some(b)) => crease_lands_on(state, creased, fold, a, b),
            _ => true,
        },
        4 => id(1).is_none_or(|l| crease_lands_on(state, creased, fold, l, l)),
        // [pivot, p, m]: p lands on m.
        5 => match (id(1), id(2)) {
            (Some(p), Some(m)) => point_lands_on(state, creased, fold, p, m),
            _ => true,
        },
        // [p1, m1, p2, m2].
        6 => match (id(0), id(1), id(2), id(3)) {
            (Some(p1), Some(m1), Some(p2), Some(m2)) => {
                point_lands_on(state, creased, fold, p1, m1)
                    && point_lands_on(state, creased, fold, p2, m2)
            }
            _ => true,
        },
        // [p, m, l]: p lands on m, l folds onto itself.
        7 => match (id(0), id(1), id(2)) {
            (Some(p), Some(m), Some(l)) => {
                point_lands_on(state, creased, fold, p, m)
                    && crease_lands_on(state, creased, fold, l, l)
            }
            _ => true,
        },
        _ => true,
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::Sheet;

    fn state_with(lines: &[Line]) -> State {
        let mut state = State::new(Sheet::unit_square(), 10_000);
        for l in lines {
            state.add_line(*l, LineTag::Cp).expect("line");
        }
        state
    }

    /// The first press on a line must not erase the creases the pattern put
    /// there. This is the bug that would have bitten first.
    #[test]
    fn a_second_run_on_a_line_joins_the_first_rather_than_replacing_it() {
        let diagonal = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        let state = state_with(&[diagonal]);
        let id = state.line_count() - 1;
        let mut creased = Creased::new(&state);
        // The pattern: creased at both ends, blank in the middle.
        creased.add_spans(
            &state,
            id,
            &diagonal,
            &[[[0.0, 0.0], [0.25, 0.25]], [[0.75, 0.75], [1.0, 1.0]]],
        );
        assert!(creased.reaches(&state, id, [0.1, 0.1]));
        assert!(!creased.reaches(&state, id, [0.5, 0.5]));
        // A press in the middle.
        creased.add_spans(&state, id, &diagonal, &[[[0.45, 0.45], [0.55, 0.55]]]);
        assert!(
            creased.reaches(&state, id, [0.5, 0.5]),
            "the press is there"
        );
        assert!(
            creased.reaches(&state, id, [0.1, 0.1]),
            "and the pattern's crease still is"
        );
        assert!(creased.reaches(&state, id, [0.9, 0.9]));
        assert!(
            !creased.reaches(&state, id, [0.35, 0.35]),
            "and nothing was invented"
        );
    }

    #[test]
    fn a_line_creased_everywhere_stays_so() {
        let diagonal = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        let state = state_with(&[diagonal]);
        let id = state.line_count() - 1;
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, id);
        creased.add_spans(&state, id, &diagonal, &[[[0.1, 0.1], [0.2, 0.2]]]);
        assert!(creased.reaches(&state, id, [0.9, 0.9]));
    }
}
