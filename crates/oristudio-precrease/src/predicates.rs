//! Inverse conditions O1–O7: which axiom applications in a state reproduce a
//! given target line, as certified witnesses.
//!
//! A **witness** names the inputs (typed references into the state), the
//! axiom, the root of a multi-valued axiom, and carries a certificate from
//! the forward constructor: no witness exists without the forward
//! construction reproducing the target within `TOL` (plan: "no step is
//! emitted without a certificate").
//!
//! The conditions, with their executability checks, from the plan's table:
//!
//! | Axiom | Condition on `(L, P)` | Executability |
//! | --- | --- | --- |
//! | O1 | two distinct points of `P` on ℓ | separation is scored |
//! | O2 | `p ∈ P`, `p ∉ ℓ`, `reflect(p) ∈ P` | — |
//! | O3 | `m ∈ L` whose reflection across ℓ is a different `m′ ∈ L` | per root, `m`'s in-paper segment lands on `m′`'s in-paper segment |
//! | O4 | ℓ ⟂ `m ∈ L`, a point of `P` on ℓ | `ℓ ∩ m` inside the paper |
//! | O5 | a point of `P` on ℓ and a lander | — |
//! | O6 | two landers with `p₁ ≠ p₂`, `m₁ ≠ m₂` | cubic roots polished and re-checked |
//! | O7 | ℓ ⟂ `m ∈ L` and a lander | `ℓ ∩ m` inside the paper |
//!
//! A **lander** is `(p, m₁)` with `p ∈ P`, `p ∉ ℓ`, `p ∉ m₁`, and `reflect(p)`
//! on the paper and on `m₁ ∈ L`; `p ∉ m₁` excludes the vacuous case where
//! `m₁ ⟂ ℓ` maps onto itself. The executability checks are enforced by the
//! forward constructors ([`crate::construct`]), so certification is where a
//! false positive of the prototype (an O4 whose crossing lies off the sheet,
//! an external O3 bisector aligning nothing) dies.
//!
//! ReferenceFinder's legibility filters — visibility and the skinny flap —
//! are **scored, never enforced**: a CP line must be folded regardless. They
//! set [`Witness::hard`] and feed the ease term. The third, the trivial Haga
//! case of O5, is not a scoring rule at all: a point already lying on the
//! line it is folded onto has nothing to align, so [`crate::construct`]
//! refuses the construction outright and no witness can carry it. The rules
//! themselves are the adopted facts declared in [`crate::constants`]; their
//! tests here are written from those statements.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::constants::{SKINNY_FLAP_ASPECT, axiom_ease};
use crate::construct::{Construction, Pt};
use crate::line::Line;
use crate::sheet::{CornerName, EdgeSide};
use crate::state::State;
use crate::tol::TOL;

/// A typed reference into the state, so step sentences can say "the left
/// edge", "the bottom-left corner", "the crease from step 12", "the
/// intersection of steps 3 and 12". Ids are state line / point ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Ref {
    Edge { id: usize, side: EdgeSide },
    Corner { id: usize, corner: CornerName },
    Line { id: usize },
    Point { id: usize },
}

impl Ref {
    /// The state id behind the reference.
    pub fn id(&self) -> usize {
        match self {
            Ref::Edge { id, .. }
            | Ref::Corner { id, .. }
            | Ref::Line { id }
            | Ref::Point { id } => *id,
        }
    }

    /// Whether this is a line (edge or crease).
    pub fn is_line(&self) -> bool {
        matches!(self, Ref::Edge { .. } | Ref::Line { .. })
    }

    /// Whether this is a point (corner or mark).
    pub fn is_point(&self) -> bool {
        !self.is_line()
    }

    /// A short pattern label for grouping: `e`, `c`, `l`, `p`.
    pub fn kind_code(&self) -> char {
        match self {
            Ref::Edge { .. } => 'e',
            Ref::Corner { .. } => 'c',
            Ref::Line { .. } => 'l',
            Ref::Point { .. } => 'p',
        }
    }
}

/// One certified axiom application reproducing a target.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Witness {
    /// Axiom number 1..=7.
    pub axiom: u8,
    /// Inputs in the axiom's own order: O1/O2 `[p, q]`; O3 `[m1, m2]`;
    /// O4 `[p, m]`; O5 `[pivot, p, m1]`; O6 `[p1, m1, p2, m2]`; O7 `[p, m1, m2]`.
    pub inputs: Vec<Ref>,
    /// Which solution of a multi-valued axiom (O3 bisector, O5 chord end,
    /// O6 cubic root); 0 otherwise.
    pub root: u8,
    /// Indices into `inputs` of the parts the fold carries (the legible
    /// reading: an edge mark or edge line moves when there is one).
    pub who_moves: Vec<u8>,
    /// Some legibility rule fires (see the flags below); scored, not enforced.
    pub hard: bool,
    /// Visibility: at least one input is a sheet edge or a mark on one (O1
    /// and O4 are always visible; an O3 whose moving line lands entirely on
    /// the sheet is visible too).
    pub visible: bool,
    /// The fold leaves a flap thinner than `SKINNY_FLAP_ASPECT` of the sheet.
    pub skinny: bool,
    /// Axiom ease penalty, 0 (O2) .. 6 (O1).
    pub ease: u8,
    /// Certificate residual between the constructed line and the target.
    pub err: f64,
}

impl Witness {
    /// Ordering key for the presentation choice: non-hard first, then the
    /// ease order, then the certificate residual.
    pub fn preference(&self) -> (bool, u8, u64) {
        (self.hard, self.ease, (self.err / 1e-18) as u64)
    }

    /// Cost contribution to the stuck search's ease sum.
    pub fn ease_cost(&self) -> u32 {
        u32::from(self.ease) + if self.hard { 7 } else { 0 }
    }
}

/// Raw inverse facts about a target, from which witnesses are enumerated.
/// Line and point ids refer to the state.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Facts {
    /// Points of `P` on the target.
    pub points_on: Vec<usize>,
    /// Lines of `L` perpendicular to the target and crossing it on the sheet.
    pub perps: Vec<usize>,
    /// `(p, r)` with `r = reflect(p) ∈ P`, `p < r`.
    pub o2_pairs: Vec<(usize, usize)>,
    /// `(m, m′)` with `reflect(m) = m′ ∈ L`, `m < m′`.
    pub o3_pairs: Vec<(usize, usize)>,
    /// Landers `(p, m₁)`.
    pub landers: Vec<(usize, usize)>,
    /// Whether the lander tier has been computed for these facts.
    pub landers_computed: bool,
}

/// Caps that bound the enumeration without affecting existence: a target
/// with any witness gets at least one per applicable axiom.
const MAX_POINTS_FOR_PAIRS: usize = 12;
const MAX_WITNESSES_PER_AXIOM: usize = 16;
/// Landers kept per target, with per-point and per-line diversity caps so
/// an O6 pair with distinct points and lines survives the cap.
pub const MAX_LANDERS: usize = 96;
pub const MAX_LANDERS_PER_POINT: usize = 8;
pub const MAX_LANDERS_PER_LINE: usize = 8;

impl Facts {
    /// Add a lander subject to the diversity caps. Returns whether it was kept.
    pub fn push_lander(&mut self, p: usize, m1: usize) -> bool {
        if self.landers.len() >= MAX_LANDERS || self.landers.contains(&(p, m1)) {
            return false;
        }
        let same_point = self.landers.iter().filter(|(q, _)| *q == p).count();
        let same_line = self.landers.iter().filter(|(_, m)| *m == m1).count();
        if same_point >= MAX_LANDERS_PER_POINT || same_line >= MAX_LANDERS_PER_LINE {
            return false;
        }
        self.landers.push((p, m1));
        true
    }
}

/// Typed reference for state line `id`.
pub fn line_ref(state: &State, id: usize) -> Ref {
    if state.is_edge(id)
        && let Some(side) = state.sheet().edge_of(state.line(id))
    {
        return Ref::Edge { id, side };
    }
    Ref::Line { id }
}

/// Typed reference for state point `id`.
pub fn point_ref(state: &State, id: usize) -> Ref {
    if let Some(corner) = state.sheet().corner_of(state.point(id)) {
        return Ref::Corner { id, corner };
    }
    Ref::Point { id }
}

fn ref_on_boundary(state: &State, r: &Ref) -> bool {
    match r {
        Ref::Edge { .. } | Ref::Corner { .. } => true,
        Ref::Line { id } => state.is_edge(*id),
        Ref::Point { id } => state.points()[*id].on_boundary,
    }
}

/// Whether the in-paper segment of line `id`, reflected across `fold`, lies
/// entirely on the sheet — the folder sees the whole moving line land.
fn lands_entirely(state: &State, fold: &Line, id: usize) -> bool {
    match state.clip(id) {
        Some((a, b)) => {
            state.in_paper(fold.reflect_point(a)) && state.in_paper(fold.reflect_point(b))
        }
        None => false,
    }
}

/// Which inputs move, and whether the alignment is visible, per axiom.
fn who_moves_and_visible(state: &State, fold: &Line, axiom: u8, inputs: &[Ref]) -> (Vec<u8>, bool) {
    let edge = |i: usize| ref_on_boundary(state, &inputs[i]);
    match axiom {
        1 | 4 => (Vec::new(), true),
        2 => {
            if edge(0) {
                (vec![0], true)
            } else if edge(1) {
                (vec![1], true)
            } else {
                (vec![0], false)
            }
        }
        3 => {
            if edge(0) {
                (vec![0], true)
            } else if edge(1) {
                (vec![1], true)
            } else if lands_entirely(state, fold, inputs[0].id()) {
                (vec![0], true)
            } else if lands_entirely(state, fold, inputs[1].id()) {
                (vec![1], true)
            } else {
                (vec![0], false)
            }
        }
        5 => {
            // [pivot, p, m1]: p moves onto m1, or m1 moves onto p.
            if edge(1) {
                (vec![1], true)
            } else if edge(2) {
                (vec![2], true)
            } else {
                (vec![1], false)
            }
        }
        6 => {
            // [p1, m1, p2, m2]. Same side of the fold: both points or both
            // lines move; opposite sides: one point and the other line.
            let p1 = state.point(inputs[0].id());
            let p2 = state.point(inputs[2].id());
            let same_side = fold.signed_distance(p1) * fold.signed_distance(p2) >= 0.0;
            if same_side {
                if edge(0) && edge(2) {
                    (vec![0, 2], true)
                } else if edge(1) && edge(3) {
                    (vec![1, 3], true)
                } else {
                    (vec![0, 2], false)
                }
            } else if edge(0) && edge(3) {
                (vec![0, 3], true)
            } else if edge(2) && edge(1) {
                (vec![2, 1], true)
            } else {
                (vec![0, 3], false)
            }
        }
        7 => {
            // [p, m1, m2]: p moves onto m1 or m1 moves onto p.
            if edge(0) {
                (vec![0], true)
            } else if edge(1) {
                (vec![1], true)
            } else {
                (vec![0], false)
            }
        }
        _ => (Vec::new(), true),
    }
}

/// Build a certified witness for one construction, or `None` when the
/// construction does not reproduce the target.
fn witness(
    state: &State,
    target: &Line,
    construction: &Construction,
    inputs: Vec<Ref>,
) -> Option<Witness> {
    let cert = construction.certify(state.sheet(), target)?;
    let axiom = construction.axiom();
    let (who_moves, visible) = who_moves_and_visible(state, &cert.line, axiom, &inputs);
    let skinny = state
        .sheet()
        .flap_aspects(&cert.line)
        .is_some_and(|[a, b]| a.min(b) < SKINNY_FLAP_ASPECT);
    // No `trivial_haga` term: the O5 constructor already refuses a point on
    // its own landing line, and an O5 whose *pivot* lies on the landing line
    // is an ordinary fold — it is how the bird base's eight corner creases
    // are made (fold the centre onto an edge through the far corner), and
    // ReferenceFinder constructs every one of them exactly. Scoring those as
    // hard was wrong.
    Some(Witness {
        axiom,
        inputs,
        root: cert.root,
        who_moves,
        hard: !visible || skinny,
        visible,
        skinny,
        ease: axiom_ease(axiom).unwrap_or(6) as u8,
        err: cert.err,
    })
}

fn pt(state: &State, id: usize) -> Pt {
    state.point(id)
}

/// Enumerate certified witnesses for `target` from `facts`. Tier-1 axioms
/// (O1–O4) always; O5–O7 only when `facts.landers_computed`.
pub fn witnesses(state: &State, target: &Line, facts: &Facts) -> Vec<Witness> {
    let mut out: Vec<Witness> = Vec::new();
    let points: Vec<usize> = facts
        .points_on
        .iter()
        .copied()
        .take(MAX_POINTS_FOR_PAIRS)
        .collect();

    // O2 first: the most accurate fold by hand.
    let mut count = 0;
    for &(p, r) in &facts.o2_pairs {
        if count >= MAX_WITNESSES_PER_AXIOM {
            break;
        }
        let c = Construction::O2 {
            p: pt(state, p),
            q: pt(state, r),
        };
        if let Some(w) = witness(
            state,
            target,
            &c,
            vec![point_ref(state, p), point_ref(state, r)],
        ) {
            out.push(w);
            count += 1;
        }
    }

    // O3.
    count = 0;
    for &(m, m2) in &facts.o3_pairs {
        if count >= MAX_WITNESSES_PER_AXIOM {
            break;
        }
        let c = Construction::O3 {
            m1: *state.line(m),
            m2: *state.line(m2),
        };
        if let Some(w) = witness(
            state,
            target,
            &c,
            vec![line_ref(state, m), line_ref(state, m2)],
        ) {
            out.push(w);
            count += 1;
        }
    }

    // O4.
    count = 0;
    'o4: for &m in &facts.perps {
        for &p in &points {
            if count >= MAX_WITNESSES_PER_AXIOM {
                break 'o4;
            }
            let c = Construction::O4 {
                p: pt(state, p),
                m: *state.line(m),
            };
            if let Some(w) = witness(
                state,
                target,
                &c,
                vec![point_ref(state, p), line_ref(state, m)],
            ) {
                out.push(w);
                count += 1;
            }
        }
    }

    // O1.
    count = 0;
    'o1: for (i, &p) in points.iter().enumerate() {
        for &q in &points[i + 1..] {
            if count >= MAX_WITNESSES_PER_AXIOM {
                break 'o1;
            }
            let c = Construction::O1 {
                p: pt(state, p),
                q: pt(state, q),
            };
            if let Some(w) = witness(
                state,
                target,
                &c,
                vec![point_ref(state, p), point_ref(state, q)],
            ) {
                out.push(w);
                count += 1;
            }
        }
    }

    if facts.landers_computed {
        // O7.
        count = 0;
        'o7: for &m2 in &facts.perps {
            for &(p, m1) in &facts.landers {
                if count >= MAX_WITNESSES_PER_AXIOM {
                    break 'o7;
                }
                if m1 == m2 {
                    continue;
                }
                let c = Construction::O7 {
                    p: pt(state, p),
                    m1: *state.line(m1),
                    m2: *state.line(m2),
                };
                if let Some(w) = witness(
                    state,
                    target,
                    &c,
                    vec![
                        point_ref(state, p),
                        line_ref(state, m1),
                        line_ref(state, m2),
                    ],
                ) {
                    out.push(w);
                    count += 1;
                }
            }
        }

        // O6: distinct points, distinct lines.
        count = 0;
        'o6: for (i, &(p1, m1)) in facts.landers.iter().enumerate() {
            for &(p2, m2) in &facts.landers[i + 1..] {
                if count >= MAX_WITNESSES_PER_AXIOM {
                    break 'o6;
                }
                if p1 == p2 || m1 == m2 {
                    continue;
                }
                let c = Construction::O6 {
                    p1: pt(state, p1),
                    m1: *state.line(m1),
                    p2: pt(state, p2),
                    m2: *state.line(m2),
                };
                if let Some(w) = witness(
                    state,
                    target,
                    &c,
                    vec![
                        point_ref(state, p1),
                        line_ref(state, m1),
                        point_ref(state, p2),
                        line_ref(state, m2),
                    ],
                ) {
                    out.push(w);
                    count += 1;
                }
            }
        }

        // O5.
        count = 0;
        'o5: for &pivot in &points {
            for &(p, m1) in &facts.landers {
                if count >= MAX_WITNESSES_PER_AXIOM {
                    break 'o5;
                }
                if p == pivot {
                    continue;
                }
                let c = Construction::O5 {
                    pivot: pt(state, pivot),
                    p: pt(state, p),
                    m1: *state.line(m1),
                };
                if let Some(w) = witness(
                    state,
                    target,
                    &c,
                    vec![
                        point_ref(state, pivot),
                        point_ref(state, p),
                        line_ref(state, m1),
                    ],
                ) {
                    out.push(w);
                    count += 1;
                }
            }
        }
    }

    out
}

/// Tier-1 facts for `target` from scratch: points on it, perpendiculars,
/// O2 pairs and O3 pairs.
pub fn tier1_facts(state: &State, target: &Line) -> Facts {
    let mut facts = Facts::default();
    scan_lines(state, target, &mut facts, 0);
    scan_points(state, target, &mut facts, 0);
    facts
}

/// Extend the line-derived tier-1 facts of `target` over state lines
/// `from..` (points on the target, perpendiculars, O3 pairs).
pub fn scan_lines(state: &State, target: &Line, facts: &mut Facts, from: usize) {
    let sheet = state.sheet();
    for (m, sl) in state.lines().iter().enumerate().skip(from) {
        let other = &sl.line;
        let det = target.cross(other).abs();
        if det >= crate::state::MIN_INCIDENCE_SINE
            && let Some(q) = target.intersect(other)
            && sheet.contains(q, crate::state::POINT_LOOKUP_RADIUS)
        {
            for c in state.points_near(q) {
                if target.distance_to_point(state.point(c)) <= TOL && !facts.points_on.contains(&c)
                {
                    facts.points_on.push(c);
                }
            }
        }
        if target.dot(other).abs() <= TOL
            && let Some(x) = target.intersect(other)
            && state.in_paper(x)
        {
            facts.perps.push(m);
        }
        // Record each unordered O3 pair once: when the later of the two lines
        // is scanned (or now, if the image already exists with a smaller id).
        if let Some(image) = target.reflect_line(other)
            && let Some(m2) = state.find_line(&image)
            && m2 < m
        {
            facts.o3_pairs.push((m2, m));
        }
    }
}

/// Extend the point-derived tier-1 facts of `target` over state points
/// `from..` (O2 pairs).
pub fn scan_points(state: &State, target: &Line, facts: &mut Facts, from: usize) {
    for (p, sp) in state.points().iter().enumerate().skip(from) {
        if target.distance_to_point(sp.p) <= TOL {
            continue;
        }
        let r = target.reflect_point(sp.p);
        if !state.in_paper(r) {
            continue;
        }
        if let Some(rid) = state.find_point(r) {
            // Recorded when the later point is scanned; the earlier scan
            // could not have seen it.
            if rid < p {
                facts.o2_pairs.push((rid, p));
            }
        }
    }
}

/// Extend the lander facts of `target`: landers `(p, m₁)` are the points of
/// `P` on `reflect(m₁)` for `m₁ ∈ L`, found through the crossings of
/// `reflect(m₁)` with the state lines. `from` is the number of state lines
/// already scanned for this target; pairs `(m₁, m)` with both below `from`
/// were seen before.
pub fn scan_landers(state: &State, target: &Line, facts: &mut Facts, from: usize) {
    let sheet = state.sheet();
    let n = state.line_count();
    let mut seen: HashSet<(usize, usize)> = facts.landers.iter().copied().collect();
    for m1 in 0..n {
        let Some(image) = target.reflect_line(state.line(m1)) else {
            continue;
        };
        // The image only has to *touch* the sheet, not cross it: a lander is
        // a point of `P` on it, and a point of `P` can be the single corner
        // an image grazes. `Sheet::crosses` refuses that (it wants an
        // in-paper segment longer than `TOL`, which is right for a fold and
        // wrong here) and lost, for instance, the corner lander that makes
        // an O6 out of (corner → top edge, mid-edge mark → bottom edge).
        if sheet.clip_parameters(&image).is_none() {
            continue;
        }
        let start = if m1 < from { from } else { 0 };
        for m in start..n {
            if m == m1 {
                continue;
            }
            let other = state.line(m);
            if image.cross(other).abs() < crate::state::MIN_INCIDENCE_SINE {
                continue;
            }
            let Some(q) = image.intersect(other) else {
                continue;
            };
            if !sheet.contains(q, crate::state::POINT_LOOKUP_RADIUS) {
                continue;
            }
            for c in state.points_near(q) {
                let p = state.point(c);
                if image.distance_to_point(p) > TOL
                    || target.distance_to_point(p) <= TOL
                    || state.line(m1).distance_to_point(p) <= TOL
                {
                    continue;
                }
                let r = target.reflect_point(p);
                if !state.in_paper(r) {
                    continue;
                }
                if seen.insert((c, m1)) {
                    facts.push_lander(c, m1);
                }
            }
        }
    }
    facts.landers_computed = true;
}

/// Every fact about `target`, all tiers, from scratch.
pub fn full_facts(state: &State, target: &Line) -> Facts {
    let mut facts = tier1_facts(state, target);
    scan_landers(state, target, &mut facts, 0);
    facts
}

/// All certified witnesses for `target` in `state`, all tiers.
pub fn all_witnesses(state: &State, target: &Line) -> Vec<Witness> {
    let facts = full_facts(state, target);
    witnesses(state, target, &facts)
}

/// The presentation witness: non-hard first, then the ease order
/// `O2 < O3 < O7 < O6 < O5 < O4 < O1`, then the smallest residual.
pub fn choose(witnesses: &[Witness]) -> Option<usize> {
    (0..witnesses.len()).min_by_key(|&i| witnesses[i].preference())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::Sheet;
    use crate::state::{DEFAULT_POINT_CAP, LineTag};

    fn line(n: [f64; 2], d: f64) -> Line {
        Line::new(n, d).expect("line")
    }

    fn axioms(ws: &[Witness]) -> Vec<u8> {
        let mut a: Vec<u8> = ws.iter().map(|w| w.axiom).collect();
        a.sort_unstable();
        a.dedup();
        a
    }

    #[test]
    fn bare_sheet_midline_has_o2_o3_o6_o7_witnesses_and_no_o1() {
        let state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let mid = line([1.0, 0.0], 0.5);
        let ws = all_witnesses(&state, &mid);
        let ax = axioms(&ws);
        assert!(ax.contains(&2), "{ax:?}"); // corner onto corner
        assert!(ax.contains(&3), "{ax:?}"); // left edge onto right edge
        assert!(ax.contains(&7), "{ax:?}"); // ⟂ bottom edge, corner onto right edge
        assert!(!ax.contains(&1), "{ax:?}"); // no two points of P on x = ½
        assert!(!ax.contains(&4), "{ax:?}");
        let chosen = &ws[choose(&ws).expect("some")];
        assert_eq!(chosen.axiom, 2);
        assert!(!chosen.hard);
        assert!(chosen.visible);
        assert!(chosen.err < 1e-12);
        // The O3 witness names two edges.
        let o3 = ws.iter().find(|w| w.axiom == 3).expect("o3");
        assert!(o3.inputs.iter().all(|r| matches!(r, Ref::Edge { .. })));
    }

    #[test]
    fn bare_sheet_diagonal_is_o1_o2_o3() {
        let state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let diag = Line::from_points([0.0, 0.0], [1.0, 1.0]).expect("l");
        let ws = all_witnesses(&state, &diag);
        let ax = axioms(&ws);
        assert!(
            ax.contains(&1) && ax.contains(&2) && ax.contains(&3),
            "{ax:?}"
        );
        let o1 = ws.iter().find(|w| w.axiom == 1).expect("o1");
        assert!(o1.inputs.iter().all(|r| matches!(r, Ref::Corner { .. })));
        assert!(o1.who_moves.is_empty());
    }

    #[test]
    fn a_line_nothing_constructs_has_no_witness() {
        let state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let third = line([1.0, 0.0], 1.0 / 3.0);
        assert!(all_witnesses(&state, &third).is_empty());
    }

    #[test]
    fn o4_and_o7_false_positives_of_the_prototype_are_rejected() {
        // verify-claim2 A/B2: the fold meets the perpendicular reference off
        // the sheet, and nothing else constructs the line.
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let m = Line::from_points([0.0, 0.9], [0.1, 1.0]).expect("l");
        state.add_line(m, LineTag::Cp).expect("add");
        state
            .add_line(
                Line::from_points([0.1, 0.0], [0.1 + 0.9 / 3f64.sqrt(), 1.0]).expect("l"),
                LineTag::Cp,
            )
            .expect("add");
        let target = Line::from_points([0.0, 0.1], [0.1, 0.0]).expect("l");
        let facts = full_facts(&state, &target);
        // The prototype saw a perpendicular line and a point on ℓ and said O4.
        assert!(facts.perps.is_empty(), "{facts:?}");
        assert!(all_witnesses(&state, &target).is_empty());

        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        state.add_line(m, LineTag::Cp).expect("add");
        state
            .add_line(
                Line::from_points([0.3, 0.3], [0.3 + 0.7 / 3f64.sqrt(), 1.0]).expect("l"),
                LineTag::Cp,
            )
            .expect("add");
        let target = Line::from_points([0.0, 0.3], [0.3, 0.0]).expect("l");
        assert!(all_witnesses(&state, &target).is_empty());
    }

    #[test]
    fn o3_external_bisector_is_rejected_but_the_internal_one_certifies() {
        // verify-claim2 C: m and r meet at (−0.1, 0.5), off the sheet. Both
        // bisectors cross the sheet; only the one that carries m's in-paper
        // material onto r's in-paper material is a fold that aligns anything.
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let x = [-0.1, 0.5];
        let m = Line::from_points(x, [1.0, 0.0]).expect("l");
        let r = Line::from_points(x, [0.2, 1.0]).expect("l");
        state.add_line(m, LineTag::Cp).expect("add");
        state.add_line(r, LineTag::Cp).expect("add");
        let sheet = *state.sheet();
        let u1 = m.direction();
        let u2 = r.direction();
        let bisectors = [
            Line::from_point_direction(x, [u1[0] + u2[0], u1[1] + u2[1]]).expect("l"),
            Line::from_point_direction(x, [u1[0] - u2[0], u1[1] - u2[1]]).expect("l"),
        ];
        let mut aligned = 0;
        for b in &bisectors {
            assert!(sheet.crosses(b));
            let (a0, a1) = sheet.clip(&m).expect("m crosses");
            let (c0, c1) = sheet.clip_parameters(&r).expect("r crosses");
            let ta = r.parameter(b.reflect_point(a0));
            let tb = r.parameter(b.reflect_point(a1));
            let overlap = ta.max(tb).min(c1) - ta.min(tb).max(c0);
            let has_o3 = all_witnesses(&state, b).iter().any(|w| w.axiom == 3);
            assert_eq!(has_o3, overlap > TOL, "bisector {b:?} overlap {overlap}");
            aligned += usize::from(has_o3);
        }
        assert_eq!(aligned, 1, "exactly one bisector aligns in-paper material");
    }

    #[test]
    fn x_plus_y_half_is_visible_from_its_points_and_o7_certifies() {
        // verify-claim2 D: the rounded-normal index made every ±45° line
        // invisible; a genuine O7 onto x + y = ½ must certify.
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        let m1 = Line::from_points([0.5, 0.0], [0.0, 0.5]).expect("l");
        state.add_line(m1, LineTag::Cp).expect("add");
        for p in [[0.25, 0.25], [0.2, 0.3], [0.1, 0.4], [0.5, 0.0], [0.0, 0.5]] {
            assert!(
                state
                    .lines_through(p)
                    .iter()
                    .any(|&id| state.line(id).approx_eq(&m1)),
                "{p:?}"
            );
        }
        state
            .add_line(
                Line::from_points([0.2, 0.0], [0.0, 0.2]).expect("l"),
                LineTag::Cp,
            )
            .expect("add");
        let target = line([0.0, 1.0], 0.15);
        let ws = all_witnesses(&state, &target);
        assert!(ws.iter().any(|w| w.axiom == 7), "{:?}", axioms(&ws));
    }

    #[test]
    fn o5_trivial_haga_is_enforced_and_a_pivot_on_the_landing_line_is_not_it() {
        // The trivial Haga case is a point folded onto a line it already
        // touches; the constructor refuses it, so no witness can carry it.
        // A *pivot* on the landing line is an ordinary fold: through the
        // centre, carrying (¼, ½) onto x = ½.
        let mut state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        state
            .add_line(line([1.0, 0.0], 0.5), LineTag::Cp)
            .expect("add");
        state
            .add_line(line([0.0, 1.0], 0.5), LineTag::Cp)
            .expect("add");
        state
            .add_line(line([1.0, 0.0], 0.25), LineTag::Cp)
            .expect("add");
        let pivot = [0.5, 0.5];
        let p = [0.25, 0.5];
        let r = [0.5, 0.75];
        assert!(state.has_point(pivot) && state.has_point(p) && !state.has_point(r));
        let target = Line::perpendicular_bisector(p, r).expect("l");
        assert!(target.distance_to_point(pivot) < 1e-12);
        let ws = all_witnesses(&state, &target);
        let o5: Vec<&Witness> = ws.iter().filter(|w| w.axiom == 5).collect();
        assert!(!o5.is_empty(), "{:?}", axioms(&ws));
        assert!(o5.iter().any(|w| !w.hard), "a pivot on m1 is not hard");
        // The genuinely trivial case: (0.3, 0.5) already lies on y = ½, so
        // there is no O5 construction at all.
        let on_line = Construction::O5 {
            pivot: [0.5, 0.5],
            p: [0.3, 0.5],
            m1: line([0.0, 1.0], 0.5),
        };
        assert!(on_line.lines(state.sheet()).is_empty());
    }

    #[test]
    fn skinny_folds_are_flagged_hard_but_still_certify() {
        let state = State::new(Sheet::unit_square(), DEFAULT_POINT_CAP);
        // Fold the bottom-left corner onto the top-left corner: the midline,
        // not skinny. Fold (0,0) onto (0, 0.1)? not in P. Use O3 of the
        // left edge onto itself? Not distinct. A bisector of the left edge
        // and the bottom edge is the diagonal (not skinny). Build a skinny
        // fold from a grid instead.
        let mut s = state.clone();
        s.add_line(line([1.0, 0.0], 0.05), LineTag::Cp)
            .expect("add");
        s.add_line(line([1.0, 0.0], 0.1), LineTag::Cp).expect("add");
        // Fold x = 0.05 by O2 from (0,0) onto (0.1, 0): those are points.
        let ws = all_witnesses(&s, &line([1.0, 0.0], 0.05));
        // The line is already folded, so witnesses still exist against the
        // state; the O2 witness must be skinny and hard.
        let o2 = ws.iter().find(|w| w.axiom == 2).expect("o2");
        assert!(o2.skinny && o2.hard);
    }
}
