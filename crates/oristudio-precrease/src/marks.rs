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
///
/// A **pinch** is kept apart from the creases. It is a crease a pinch-length
/// long, made to put a mark on the paper, and it is a mark: something a
/// fold can be sighted *at*, never something a fold can be lined up *along*
/// — too short to lay another crease against. So [`Creased::reaches`], which
/// asks whether a spot is marked, sees pinches, and [`Creased::crease_reaches`]
/// and [`Creased::runs_of`], which ask where the crease is, do not.
///
/// A **pinchable** spot is a pinch the folder could have made while the line
/// was folded, and has not: where the line crosses a crease that was already
/// on the paper then, beyond the crease the fold left. The fold is made once
/// and pressed at the pattern's crease; pressing it at the crossing as well
/// costs no step of its own, only a pinch's length of crease. So a mark there
/// is on the paper the moment a fold needs it — [`mark_exists`] counts it,
/// and the ordering pass adds the pinch to the making step — but it is not a
/// crease, and not a crease end: nothing is drawn there until a fold asks.
#[derive(Debug, Clone, Default)]
pub struct Creased {
    runs: Vec<Option<Vec<(f64, f64)>>>,
    pinches: Vec<Vec<(f64, f64)>>,
    pinchable: Vec<Vec<f64>>,
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
        Creased {
            pinches: vec![Vec::new(); runs.len()],
            pinchable: vec![Vec::new(); runs.len()],
            runs,
        }
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
            self.pinches.push(Vec::new());
            self.pinchable.push(Vec::new());
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
        // Kept merged: a crease pattern splits a line at every crossing and
        // every change of assignment, so one continuous crease arrives as
        // dozens of pieces, and anything that asks how *long* a crease is —
        // whether two creases lie along each other far enough to align, where
        // a crease's end is — must see the crease, not the pieces. Same merge
        // as `crease_runs`, for the same reason.
        runs.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut merged: Vec<(f64, f64)> = Vec::with_capacity(runs.len());
        for &(u, v) in runs.iter() {
            match merged.last_mut() {
                Some(last) if u <= last.1 + TOL => last.1 = last.1.max(v),
                _ => merged.push((u, v)),
            }
        }
        *runs = merged;
    }

    /// Record a pinch on `line` along `span`: a mark, not a crease — see the
    /// type's doc.
    pub fn add_pinch(&mut self, state: &State, line_id: usize, line: &Line, span: [[f64; 2]; 2]) {
        self.widen(state);
        let Some(pinches) = self.pinches.get_mut(line_id) else {
            return;
        };
        let (u, v) = (line.parameter_of(span[0]), line.parameter_of(span[1]));
        pinches.push(if u <= v { (u, v) } else { (v, u) });
    }

    /// Note where `line_id`, just folded, could be pinched while it is:
    /// every point of the state on it that its crease stops short of, where
    /// a line already creased there crosses it squarely. Called once, by
    /// whoever records the fold, with the paper as it stands at that moment
    /// — a crease made later is not something the folder could have sighted
    /// the pinch from then.
    pub fn note_pinchable(&mut self, state: &State, line_id: usize) {
        self.widen(state);
        let Some(line) = state.lines().get(line_id) else {
            return;
        };
        let mut spots = Vec::new();
        for &point in &line.points {
            let Some(pt) = state.points().get(point) else {
                continue;
            };
            if self.crease_reaches(state, line_id, pt.p) {
                continue;
            }
            let seen = pt.lines.iter().any(|&s| {
                s != line_id
                    && state.line(s).cross(&line.line).abs() >= MIN_ANGLE_SINE
                    && self.reaches(state, s, pt.p)
            });
            if seen {
                spots.push(line.line.parameter_of(pt.p));
            }
        }
        if let Some(entry) = self.pinchable.get_mut(line_id) {
            entry.extend(spots);
        }
    }

    /// Whether `p` on `line_id` is a spot the folder could have pinched
    /// while the line was folded — see the type's doc. False wherever the
    /// line is actually creased or pinched: that is [`Creased::reaches`].
    pub fn pinchable_at(&self, state: &State, line_id: usize, p: [f64; 2]) -> bool {
        !self.reaches(state, line_id, p) && {
            let t = state.line(line_id).parameter_of(p);
            self.pinchable
                .get(line_id)
                .is_some_and(|spots| spots.iter().any(|&u| (u - t).abs() <= TOL))
        }
    }

    /// Record a fold creased along its whole chord.
    pub fn add_whole(&mut self, state: &State, line_id: usize) {
        self.widen(state);
        if let Some(entry) = self.runs.get_mut(line_id) {
            *entry = None;
        }
    }

    /// Whether `line_id` has been folded at all — creased somewhere, or
    /// everywhere, or pinched. A sheet edge always has.
    pub fn is_folded(&self, line_id: usize) -> bool {
        match self.runs.get(line_id) {
            None => false,
            Some(None) => true,
            Some(Some(runs)) => {
                !runs.is_empty() || self.pinches.get(line_id).is_some_and(|p| !p.is_empty())
            }
        }
    }

    /// The creased runs on `line_id` as parameter intervals along the line —
    /// pinches not among them — or `None` when it is creased everywhere (or
    /// unknown).
    pub fn runs_of(&self, line_id: usize) -> Option<&[(f64, f64)]> {
        self.runs.get(line_id).and_then(|r| r.as_deref())
    }

    /// The pinches on `line_id` as parameter intervals along the line.
    pub fn pinches_of(&self, line_id: usize) -> &[(f64, f64)] {
        self.pinches.get(line_id).map_or(&[], Vec::as_slice)
    }

    /// Whether `p` is marked on `line_id`: the crease reaches it, or a pinch
    /// does. The question for a mark.
    pub fn reaches(&self, state: &State, line_id: usize, p: [f64; 2]) -> bool {
        self.crease_reaches(state, line_id, p) || {
            let t = state.line(line_id).parameter_of(p);
            self.pinches_of(line_id)
                .iter()
                .any(|&(u, v)| t >= u - TOL && t <= v + TOL)
        }
    }

    /// Whether the crease proper on `line_id` reaches `p` — a pinch does not
    /// count. The question for a line to be aligned along.
    pub fn crease_reaches(&self, state: &State, line_id: usize, p: [f64; 2]) -> bool {
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
/// conditioning floor the ordering pass applies to a witness's inputs. One of
/// the two may be a spot the folder could have pinched while its line was
/// folded ([`Creased::pinchable_at`]): the other is the crease that pinch is
/// sighted from, so it has to be there in fact.
pub fn mark_exists(state: &State, creased: &Creased, p: [f64; 2], lines: &[usize]) -> bool {
    let present: Vec<usize> = lines
        .iter()
        .copied()
        .filter(|&l| creased.reaches(state, l, p))
        .collect();
    let squarely = |a: usize, b: usize| state.line(a).cross(state.line(b)).abs() >= MIN_ANGLE_SINE;
    present
        .iter()
        .enumerate()
        .any(|(i, &a)| present[i + 1..].iter().any(|&b| squarely(a, b)))
        || lines
            .iter()
            .any(|&l| creased.pinchable_at(state, l, p) && present.iter().any(|&s| squarely(s, l)))
}

/// Whether the mark at `p` is on the paper in fact — two creases meeting
/// there, neither of them a pinch still to be made. [`mark_exists`] without
/// the pinchable spots: the question for a pick between witnesses, where a
/// mark that costs a pinch, however cheap, should not beat one that is there.
pub fn mark_is_real(state: &State, creased: &Creased, p: [f64; 2], lines: &[usize]) -> bool {
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

/// Whether every mark this witness sights is on the paper in fact — see
/// [`mark_is_real`].
pub fn witness_marks_real(state: &State, creased: &Creased, w: &Witness) -> bool {
    w.inputs.iter().all(|r| match r {
        Ref::Point { id } => state
            .points()
            .get(*id)
            .is_some_and(|point| mark_is_real(state, creased, point.p, &point.lines)),
        _ => true,
    })
}

/// The lines through `p`, out of `lines`, whose mark there is only a spot
/// the folder could have pinched — each with a crease that reaches `p` and
/// crosses it squarely, to sight the pinch from. Empty when two creases
/// already meet at `p`, or when nothing can be pinched there.
pub fn pinchable_lines_at(
    state: &State,
    creased: &Creased,
    p: [f64; 2],
    lines: &[usize],
) -> Vec<(usize, usize)> {
    let present: Vec<usize> = lines
        .iter()
        .copied()
        .filter(|&l| creased.reaches(state, l, p))
        .collect();
    let squarely = |a: usize, b: usize| state.line(a).cross(state.line(b)).abs() >= MIN_ANGLE_SINE;
    if present
        .iter()
        .enumerate()
        .any(|(i, &a)| present[i + 1..].iter().any(|&b| squarely(a, b)))
    {
        return Vec::new();
    }
    lines
        .iter()
        .filter(|&&l| creased.pinchable_at(state, l, p))
        .filter_map(|&l| {
            present
                .iter()
                .copied()
                .find(|&s| squarely(s, l))
                .map(|s| (l, s))
        })
        .collect()
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

/// The least a crease has to lie along another for a folder to line the two
/// up: a pinch's length. Shorter than that is a crossing, not an alignment —
/// two creases that merely touch at a point "overlap" there and say nothing
/// about the angle, and a crease that ends exactly at the fold meets its own
/// reflection at that end and nowhere else.
pub const MIN_ALIGNMENT: f64 = 2.0 * crate::pinch::PINCH_HALF_LENGTH;

/// How far some creased part of `line_id`, carried across `fold`, lies along
/// some creased part of `onto` — the longest such stretch, or zero.
///
/// This is what makes a line usable as a reference: the folder aligns crease
/// to crease, and a line that is only creased where the fold does not take it
/// cannot be aligned to anything. `onto` may be `line_id` itself — folding a
/// line onto itself — in which case the question is whether the crease on one
/// side of the fold reaches across to crease on the other. Reflection is its
/// own inverse, so which of the two lines actually moves does not change the
/// answer. Nor does a crease that lands off the sheet: `onto`'s crease is on
/// the sheet, so the overlap is too.
pub fn crease_overlap(
    state: &State,
    creased: &Creased,
    fold: &Line,
    line_id: usize,
    onto: usize,
) -> f64 {
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
        .flat_map(|(p, q)| landing.iter().map(move |&(x, y)| y.min(q) - x.max(p)))
        .fold(0.0, f64::max)
}

/// Whether [`crease_overlap`] is at least [`MIN_ALIGNMENT`].
pub fn crease_lands_on(
    state: &State,
    creased: &Creased,
    fold: &Line,
    line_id: usize,
    onto: usize,
) -> bool {
    crease_overlap(state, creased, fold, line_id, onto) >= MIN_ALIGNMENT - TOL
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

/// The shortest crease-to-crease stretch `w` asks the folder to line up,
/// in sheet units — `None` when it asks for none (no line is folded onto a
/// line), zero when some required alignment has no overlap at all. Marks that
/// must land on a line are a separate, yes-or-no question and are not here.
///
/// `State` certified the witness against infinite lines; this asks whether
/// the creases the pattern actually put on those lines reach the places the
/// fold uses them, and by how much. A perpendicular to a line whose crease
/// stops short of the foot is constructible and cannot be folded, because
/// there is nothing there to fold onto itself; one across a line 0.02 from
/// the sheet's edge can be folded, but only 0.04 of it ever lines up.
pub fn witness_alignment(
    state: &State,
    creased: &Creased,
    fold: &Line,
    w: &Witness,
) -> Option<f64> {
    let id = |i: usize| w.inputs.get(i).map(|r| r.id());
    match w.axiom {
        3 => match (id(0), id(1)) {
            (Some(a), Some(b)) => Some(crease_overlap(state, creased, fold, a, b)),
            _ => None,
        },
        4 => id(1).map(|l| crease_overlap(state, creased, fold, l, l)),
        // [p, m, l]: l folds onto itself.
        7 => id(2).map(|l| crease_overlap(state, creased, fold, l, l)),
        _ => None,
    }
}

/// Whether every mark `w` brings onto a line lands on crease that is there.
pub fn witness_landings_exist(state: &State, creased: &Creased, fold: &Line, w: &Witness) -> bool {
    let id = |i: usize| w.inputs.get(i).map(|r| r.id());
    match w.axiom {
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
        // [p, m, l]: p lands on m.
        7 => match (id(0), id(1)) {
            (Some(p), Some(m)) => point_lands_on(state, creased, fold, p, m),
            _ => true,
        },
        _ => true,
    }
}

/// Whether every alignment `w` asks for is between creases that are on the
/// paper and lie along each other for at least [`MIN_ALIGNMENT`] — the
/// line-input counterpart of [`witness_marks_exist`], at the bar a folder can
/// line up to.
pub fn witness_aligns(state: &State, creased: &Creased, fold: &Line, w: &Witness) -> bool {
    witness_landings_exist(state, creased, fold, w)
        && witness_alignment(state, creased, fold, w).is_none_or(|l| l >= MIN_ALIGNMENT - TOL)
}

/// Whether `w` can be folded at all: its marks land on crease, and every
/// alignment has *some* length. A sliver of alignment is a fold a folder can
/// make, imprecisely; none is not a fold.
pub fn witness_aligns_at_all(state: &State, creased: &Creased, fold: &Line, w: &Witness) -> bool {
    witness_landings_exist(state, creased, fold, w)
        && witness_alignment(state, creased, fold, w).is_none_or(|l| l > TOL)
}

/// Whether the two lines a bisector `w` folds onto each other meet on the
/// paper: their creases both reach their crossing. True for every other
/// axiom, and for two parallel lines, which have no crossing to reach.
///
/// A line-onto-line fold is the bisector of an angle, and the folder finds
/// the angle at its vertex. Two creases that would cross somewhere neither
/// of them goes — a diagonal that stops at the sheet's centre, folded onto
/// the edge it would meet a hand further on — leave nothing to see the angle
/// by, and lining them up is guesswork even where they overlap once folded.
pub fn witness_lines_meet(state: &State, creased: &Creased, w: &Witness) -> bool {
    if w.axiom != 3 {
        return true;
    }
    let (Some(a), Some(b)) = (w.inputs.first(), w.inputs.get(1)) else {
        return true;
    };
    let (a, b) = (a.id(), b.id());
    let Some(x) = state.line(a).intersect(state.line(b)) else {
        return true;
    };
    if !state.in_paper(x) {
        return false;
    }
    creased.crease_reaches(state, a, x) && creased.crease_reaches(state, b, x)
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

/// Whether the folder can sight `w` for the fold along `line` on the paper as
/// it stands: every mark it names is there, every alignment it asks for is
/// between creases that are there, and the creases a bisector needs meet.
/// The one question, asked by the closure to decide what to fold now and by
/// the ordering pass to decide what to show — so the two cannot disagree.
pub fn witness_sightable(state: &State, creased: &Creased, line: &Line, w: &Witness) -> bool {
    witness_marks_exist(state, creased, w)
        && witness_aligns(state, creased, line, w)
        && witness_lines_meet(state, creased, w)
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

/// [`end_is_found`], counting only ends whose extent is settled: the sheet's
/// boundary, or a crossing with a pattern line creased there. An auxiliary
/// line is recorded as creased along its whole chord until the pinch pass
/// reduces it to marks, so a crossing with one cannot be promised to the
/// folder — the rule a press's far end is chosen by.
pub fn settled_end_is_found(state: &State, creased: &Creased, line: &Line, end: [f64; 2]) -> bool {
    state.sheet().on_boundary(end)
        || (0..state.line_count()).any(|id| {
            let l = &state.lines()[id];
            !matches!(l.tag, LineTag::Aux | LineTag::RfAux)
                && l.line.distance_to_point(end) <= TOL
                && l.line.cross(line).abs() >= MIN_ANGLE_SINE
                && creased.reaches(state, id, end)
        })
}

/// The nearest parameter beyond `t` along `line` — past it in the direction
/// `forward` says — at which a crease's end would be found by the settled
/// rule: the sheet's boundary, or the crossing with a line of settled extent
/// that is creased there and crosses squarely. The boundary always
/// qualifies, so the answer is always on the sheet.
///
/// This is where a press runs to, and where a fold's own crease is carried
/// to (see [`reach`]): a crease that stops short of anything is an
/// instruction to stop *somewhere*.
pub fn findable_end_beyond(
    state: &State,
    creased: &Creased,
    line: &Line,
    t: f64,
    forward: bool,
) -> Option<f64> {
    let (lo, hi) = state.sheet().clip_parameters(line)?;
    let mut t_far = if forward { hi } else { lo };
    for (id, other) in state.lines().iter().enumerate() {
        if matches!(other.tag, LineTag::Aux | LineTag::RfAux)
            || other.line.cross(line).abs() < MIN_ANGLE_SINE
        {
            continue;
        }
        let Some(x) = other.line.intersect(line) else {
            continue;
        };
        let u = line.parameter_of(x);
        let beyond = if forward { u > t + TOL } else { u < t - TOL };
        if beyond && (u - t).abs() < (t_far - t).abs() && creased.reaches(state, id, x) {
            t_far = u;
        }
    }
    Some(t_far)
}

/// The crease a fold along `line` makes for the pattern's `spans`: the
/// pieces joined where nothing between them is a reference, each run
/// referenced at one end at least, and carried to a reference at the other
/// when that costs no more crease than the run already is.
///
/// A diagram's instruction is a crease with a reference at each end — the
/// sheet's edge, or a crease already there. The pattern's own crease on a
/// line often is not: it arrives in pieces, and each stops wherever the
/// design stops needing it. What is minimised is the number of ends the
/// folder cannot find, and crease is the price:
///
/// 1. **A gap between two pieces with no reference in it is creased
///    through.** The folder makes the fold once; pressing it in three
///    separate stretches is three times the fussing, and joining removes
///    two unfound ends for the gap's length. A gap that holds references
///    is different: each piece runs out to the nearest one in the gap and
///    stops there, and the blank between two references stays blank.
/// 2. **No run is left with both ends unfound.** A run neither of whose
///    ends is somewhere the folder can find is carried to the nearer
///    reference, whatever that costs: a crease floating on blank paper
///    cannot be placed at all, while one anchored at a reference is "from
///    here, this far".
/// 3. **The other end is carried to its reference** — always, unless
///    `allow_dangling`, when it is carried there only if the extension is
///    no longer than the run already is: the crease with both ends found
///    is then under twice the crease with one, the same 2× a single short
///    crease is judged by, so a fifth of a sheet is not creased top to
///    bottom for its second reference while a crease already most of the
///    way across is finished.
///
/// An end that [`settled_end_is_found`] finds stays exactly where the
/// pattern put it; nothing ever moves inward. Empty for empty spans, which
/// mean the whole chord and already end on the edge.
pub fn reach(
    state: &State,
    creased: &Creased,
    line: &Line,
    spans: &[[[f64; 2]; 2]],
    allow_dangling: bool,
) -> Vec<[[f64; 2]; 2]> {
    let mut pieces: Vec<(f64, f64)> = crease_runs(line, spans)
        .into_iter()
        .map(|(a, b)| (line.parameter_of(a), line.parameter_of(b)))
        .collect();
    pieces.sort_by(|a, b| a.0.total_cmp(&b.0));
    let found = |t: f64| settled_end_is_found(state, creased, line, line.point_at(t));
    let beyond = |t: f64, forward: bool| findable_end_beyond(state, creased, line, t, forward);

    // 1. Gaps: through, or out to the references in them.
    let mut runs: Vec<(f64, f64)> = Vec::with_capacity(pieces.len());
    for (lo, hi) in pieces {
        let Some(last) = runs.last_mut() else {
            runs.push((lo, hi));
            continue;
        };
        let up = beyond(last.1, true).filter(|&t| t < lo - TOL);
        let down = beyond(lo, false).filter(|&t| t > last.1 + TOL);
        match (up, down) {
            (Some(up), Some(down)) => {
                if !found(last.1) {
                    last.1 = up;
                }
                runs.push((if found(lo) { lo } else { down }, hi));
            }
            _ => last.1 = hi,
        }
    }

    // 2 and 3. The outer ends of each run.
    for run in &mut runs {
        let (mut lo_found, mut hi_found) = (found(run.0), found(run.1));
        let below = beyond(run.0, false);
        let above = beyond(run.1, true);
        if !lo_found && !hi_found {
            match (below, above) {
                (Some(b), Some(a)) if run.0 - b <= a - run.1 => {
                    run.0 = b;
                    lo_found = true;
                }
                (_, Some(a)) => {
                    run.1 = a;
                    hi_found = true;
                }
                (Some(b), None) => {
                    run.0 = b;
                    lo_found = true;
                }
                (None, None) => {}
            }
        }
        let len = run.1 - run.0;
        let worth = |extension: f64| !allow_dangling || extension <= len + TOL;
        if !lo_found
            && let Some(b) = below
            && worth(run.0 - b)
        {
            run.0 = b;
        }
        if !hi_found
            && let Some(a) = above
            && worth(a - run.1)
        {
            run.1 = a;
        }
    }

    // Runs that meet at a reference are one crease.
    runs.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut merged: Vec<(f64, f64)> = Vec::with_capacity(runs.len());
    for (u, v) in runs {
        match merged.last_mut() {
            Some(last) if u <= last.1 + TOL => last.1 = last.1.max(v),
            _ => merged.push((u, v)),
        }
    }
    merged
        .into_iter()
        .map(|(u, v)| [line.point_at(u), line.point_at(v)])
        .collect()
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

    /// A crease that arrives in pieces is one crease. iguana-c0's midline is
    /// twenty CP segments of 0.02–0.04; asked whether it lies along another
    /// crease for a pinch's length, piece by piece it never does.
    /// A crease left short of a crossing with a crease that was already
    /// there could have been pinched at the crossing while it was made, so
    /// the mark counts as on the paper — for a witness. It is not a crease
    /// end: a fold stopping there would stop on blank paper. And a crossing
    /// with a crease made *later* is nothing of the kind: the folder had
    /// nothing to sight the pinch from.
    #[test]
    fn a_crossing_the_fold_could_have_pinched_is_a_mark_but_not_an_end() {
        let up = Line::new([1.0, 0.0], 0.5).expect("line");
        let across = Line::new([0.0, 1.0], 0.6).expect("line");
        let later = Line::new([0.0, 1.0], 0.3).expect("line");
        let state = state_with(&[up, across, later]);
        let id_of = |l: &Line| state.find_line(l).expect("a state line");
        let (up_id, across_id, later_id) = (id_of(&up), id_of(&across), id_of(&later));
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, up_id);
        // The pattern wants a tenth of the horizontal, from the left edge.
        creased.add_spans(&state, across_id, &across, &[[[0.0, 0.6], [0.1, 0.6]]]);
        creased.note_pinchable(&state, across_id);
        let crossing = state.find_point([0.5, 0.6]).expect("a state point");
        assert!(creased.pinchable_at(&state, across_id, [0.5, 0.6]));
        assert!(
            !creased.pinchable_at(&state, across_id, [0.05, 0.6]),
            "where the crease is, it is creased, not pinchable"
        );
        assert!(!creased.reaches(&state, across_id, [0.5, 0.6]));
        assert!(point_mark_exists(&state, &creased, crossing), "a mark");
        assert_eq!(
            pinchable_lines_at(
                &state,
                &creased,
                [0.5, 0.6],
                &state.points()[crossing].lines
            ),
            vec![(across_id, up_id)],
            "the horizontal is pinched there, sighted from the vertical"
        );
        assert!(
            !end_is_found(&state, &creased, &up, [0.5, 0.6]),
            "but not an end for a crease along the vertical to stop at"
        );
        // The lower horizontal, folded afterwards and creased whole: its
        // crossing with the vertical is a real mark, but nothing on the
        // upper horizontal changes — and the *lower* one, folded after the
        // upper, cannot have been pinched at a crossing with it either way.
        creased.add_whole(&state, later_id);
        creased.note_pinchable(&state, later_id);
        assert!(!creased.pinchable_at(&state, later_id, [0.5, 0.3]));
        // Once the pinch is made, the spot is marked in fact.
        creased.add_pinch(&state, across_id, &across, [[0.47, 0.6], [0.53, 0.6]]);
        assert!(creased.reaches(&state, across_id, [0.5, 0.6]));
        assert!(!creased.pinchable_at(&state, across_id, [0.5, 0.6]));
        assert!(
            pinchable_lines_at(
                &state,
                &creased,
                [0.5, 0.6],
                &state.points()[crossing].lines
            )
            .is_empty()
        );
    }

    #[test]
    fn touching_pieces_are_one_run() {
        let midline = Line::new([1.0, 0.0], 0.5).expect("line");
        let state = state_with(&[midline]);
        let id = state.line_count() - 1;
        let mut creased = Creased::new(&state);
        let pieces: Vec<[[f64; 2]; 2]> = (0..20)
            .map(|k| [[0.5, k as f64 * 0.05], [0.5, (k + 1) as f64 * 0.05]])
            .collect();
        creased.add_spans(&state, id, &midline, &pieces);
        let runs = creased.runs_of(id).expect("runs");
        assert_eq!(runs.len(), 1, "{runs:?}");
        assert!((runs[0].1 - runs[0].0 - 1.0).abs() < 1e-9, "{runs:?}");
    }

    /// The pattern's pieces on a line are one crease, and each end of it is
    /// somewhere: *Abra*'s diagonal arrives as three runs with blank paper
    /// between them, folded corner to corner.
    #[test]
    fn the_pieces_of_a_line_are_one_crease_from_reference_to_reference() {
        let diagonal = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("line");
        let state = state_with(&[diagonal]);
        let creased = Creased::new(&state);
        let [run] = reach(
            &state,
            &creased,
            &diagonal,
            &[
                [[0.0, 0.0], [0.1, 0.1]],
                [[0.25, 0.25], [0.75, 0.75]],
                [[0.9, 0.9], [1.0, 1.0]],
            ],
            true,
        )[..] else {
            panic!("one run");
        };
        let ends = [diagonal.parameter_of(run[0]), diagonal.parameter_of(run[1])];
        let (lo, hi) = state.sheet().clip_parameters(&diagonal).expect("clip");
        assert!(
            (ends[0] - lo).abs() < 1e-9 && (ends[1] - hi).abs() < 1e-9,
            "{run:?}"
        );
    }

    /// markhor's step 101: pieces at each edge and in the middle of a line,
    /// with creases crossing the blank between them. Each piece runs out to
    /// the nearest crossing and no further — three creases, each ending at
    /// a reference, and the blank between the references is left blank.
    #[test]
    fn the_pieces_stop_at_the_references_between_them() {
        let across = Line::new([0.0, 1.0], 0.125).expect("line");
        let mut state = State::new(Sheet::unit_square(), 10_000);
        state.add_line(across, LineTag::Cp).expect("line");
        let mut creased = Creased::new(&state);
        for x in [0.15, 0.35, 0.65, 0.85] {
            let up = Line::new([1.0, 0.0], x).expect("line");
            let id = state.add_line(up, LineTag::Cp).expect("line").id;
            creased.add_whole(&state, id);
        }
        let runs = reach(
            &state,
            &creased,
            &across,
            &[
                [[0.0, 0.125], [0.05, 0.125]],
                [[0.45, 0.125], [0.55, 0.125]],
                [[0.95, 0.125], [1.0, 0.125]],
            ],
            true,
        );
        let mut xs: Vec<[f64; 2]> = runs
            .iter()
            .map(|[a, b]| {
                let mut x = [a[0], b[0]];
                x.sort_by(f64::total_cmp);
                x
            })
            .collect();
        xs.sort_by(|a, b| a[0].total_cmp(&b[0]));
        let want = [[0.0, 0.15], [0.35, 0.65], [0.85, 1.0]];
        assert_eq!(xs.len(), 3, "{xs:?}");
        for (got, want) in xs.iter().zip(want) {
            assert!(
                (got[0] - want[0]).abs() < 1e-9 && (got[1] - want[1]).abs() < 1e-9,
                "{xs:?}"
            );
        }
    }

    /// An end on the sheet's edge, or on a crease crossing squarely, is
    /// found and stays where the pattern put it — the bias toward more line
    /// is only for an end that has nothing.
    #[test]
    fn a_found_end_stays_put() {
        let midline = Line::new([1.0, 0.0], 0.5).expect("line");
        let across = Line::new([0.0, 1.0], 0.3).expect("line");
        let state = state_with(&[midline, across]);
        let mut creased = Creased::new(&state);
        let across_id = state.line_count() - 1;
        creased.add_whole(&state, across_id);
        // From the bottom edge up to the crossing with `across`.
        let [run] = reach(
            &state,
            &creased,
            &midline,
            &[[[0.5, 0.0], [0.5, 0.3]]],
            true,
        )[..] else {
            panic!("one run");
        };
        let ys = {
            let mut ys = [run[0][1], run[1][1]];
            ys.sort_by(f64::total_cmp);
            ys
        };
        assert!(ys[0].abs() < 1e-9 && (ys[1] - 0.3).abs() < 1e-9, "{run:?}");
    }

    /// An end nowhere goes to the nearest settled reference beyond it: a
    /// crease crossing squarely, not an auxiliary line's crossing nearer in.
    #[test]
    fn a_lost_end_reaches_the_nearest_settled_reference() {
        let midline = Line::new([1.0, 0.0], 0.5).expect("line");
        let below = Line::new([0.0, 1.0], 0.15).expect("line");
        let aux = Line::new([0.0, 1.0], 0.45).expect("line");
        let cp = Line::new([0.0, 1.0], 0.5).expect("line");
        let mut state = State::new(Sheet::unit_square(), 10_000);
        state.add_line(midline, LineTag::Cp).expect("line");
        let below_id = state.add_line(below, LineTag::Cp).expect("line").id;
        let aux_id = state.add_line(aux, LineTag::Aux).expect("line").id;
        let cp_id = state.add_line(cp, LineTag::Cp).expect("line").id;
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, below_id);
        creased.add_whole(&state, aux_id);
        creased.add_whole(&state, cp_id);
        // A crease in the middle: the low end a settled crossing at 0.15,
        // the high end an aux crossing at 0.45 and a settled one at 0.5.
        let [run] = reach(
            &state,
            &creased,
            &midline,
            &[[[0.5, 0.2], [0.5, 0.4]]],
            true,
        )[..] else {
            panic!("one run");
        };
        let mut ys = [run[0][1], run[1][1]];
        ys.sort_by(f64::total_cmp);
        assert!(
            (ys[0] - 0.15).abs() < 1e-9,
            "to the crossing below: {run:?}"
        );
        assert!(
            (ys[1] - 0.5).abs() < 1e-9,
            "to the settled crossing: {run:?}"
        );
    }

    /// A crease is never left with both ends unfound, and its second
    /// reference is reached when that costs no more crease than there is.
    /// Nothing crosses the midline here, so the edges are the only
    /// references.
    #[test]
    fn a_crease_is_anchored_at_one_end_and_finished_when_that_is_cheap() {
        let midline = Line::new([1.0, 0.0], 0.5).expect("line");
        let state = state_with(&[midline]);
        let creased = Creased::new(&state);
        let ends_of = |spans: &[[[f64; 2]; 2]]| -> [f64; 2] {
            let [run] = reach(&state, &creased, &midline, spans, true)[..] else {
                panic!("one run");
            };
            let mut ys = [run[0][1], run[1][1]];
            ys.sort_by(f64::total_cmp);
            ys
        };
        let near = |got: [f64; 2], want: [f64; 2]| {
            assert!(
                (got[0] - want[0]).abs() < 1e-9 && (got[1] - want[1]).abs() < 1e-9,
                "{got:?} vs {want:?}"
            );
        };
        // A fifth of a sheet near the top: anchored at the top edge, a
        // tenth away; the bottom edge is 0.7 further for a crease of 0.3,
        // so the bottom end stays where the pattern has it.
        near(ends_of(&[[[0.5, 0.7], [0.5, 0.9]]]), [0.7, 1.0]);
        // The same crease in the middle: anchored at one edge (0.4 away,
        // either), and the other edge is then 0.4 more for a crease of 0.6
        // — cheaper than the crease, so the whole line.
        near(ends_of(&[[[0.5, 0.4], [0.5, 0.6]]]), [0.0, 1.0]);
        // Twice as long is the line: a crease of 0.2 anchored at the bottom
        // edge is 0.4, and the top edge is 0.6 away.
        near(ends_of(&[[[0.5, 0.2], [0.5, 0.4]]]), [0.0, 0.4]);
        // Already anchored at one end: the other edge at 0.5 for a crease
        // of 0.5 is taken; at 0.6 for a crease of 0.4 it is not.
        near(ends_of(&[[[0.5, 0.0], [0.5, 0.5]]]), [0.0, 1.0]);
        near(ends_of(&[[[0.5, 0.0], [0.5, 0.4]]]), [0.0, 0.4]);
        // With no dangling fold allowed, the second reference is reached
        // whatever it costs.
        let [run] = reach(
            &state,
            &creased,
            &midline,
            &[[[0.5, 0.7], [0.5, 0.9]]],
            false,
        )[..] else {
            panic!("one run");
        };
        let mut ys = [run[0][1], run[1][1]];
        ys.sort_by(f64::total_cmp);
        near(ys, [0.0, 1.0]);
    }

    /// markhor step 4: three short pieces along a line with nothing
    /// crossing the blank between them, the top one at the edge. One fold,
    /// pressed in three places with two unfound ends each side of every gap,
    /// is not an instruction; the gaps are creased through, and with the
    /// joined crease most of the sheet long the bottom edge is reached too.
    #[test]
    fn pieces_with_nothing_between_them_are_one_crease() {
        let up = Line::new([1.0, 0.0], 0.375).expect("line");
        let across = Line::new([1.0, 0.0], 0.5).expect("line");
        let mut state = State::new(Sheet::unit_square(), 10_000);
        state.add_line(up, LineTag::Cp).expect("line");
        // A parallel line is creased but crosses nothing.
        let other = state.add_line(across, LineTag::Cp).expect("line").id;
        let mut creased = Creased::new(&state);
        creased.add_whole(&state, other);
        let [run] = reach(
            &state,
            &creased,
            &up,
            &[
                [[0.375, 0.271], [0.375, 0.345]],
                [[0.375, 0.448], [0.375, 0.521]],
                [[0.375, 0.948], [0.375, 1.0]],
            ],
            true,
        )[..] else {
            panic!("one run");
        };
        let mut ys = [run[0][1], run[1][1]];
        ys.sort_by(f64::total_cmp);
        assert!(ys[0].abs() < 1e-9 && (ys[1] - 1.0).abs() < 1e-9, "{run:?}");
    }

    /// A pinch is a mark a fold can be sighted at, so a crease may end on
    /// it; and the whole chord needs nothing.
    #[test]
    fn a_pinch_is_a_reference_and_the_whole_chord_needs_none() {
        let midline = Line::new([1.0, 0.0], 0.5).expect("line");
        let across = Line::new([0.0, 1.0], 0.7).expect("line");
        let state = state_with(&[midline, across]);
        let mut creased = Creased::new(&state);
        let across_id = state.line_count() - 1;
        creased.add_pinch(&state, across_id, &across, [[0.48, 0.7], [0.52, 0.7]]);
        let [run] = reach(
            &state,
            &creased,
            &midline,
            &[[[0.5, 0.0], [0.5, 0.7]]],
            true,
        )[..] else {
            panic!("one run");
        };
        let mut ys = [run[0][1], run[1][1]];
        ys.sort_by(f64::total_cmp);
        assert!((ys[1] - 0.7).abs() < 1e-9, "stops at the pinch: {run:?}");
        assert!(reach(&state, &creased, &midline, &[], true).is_empty());
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
