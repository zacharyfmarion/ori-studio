//! The axioms on flat and folded forms (plan Phase 3): each axiom on a flat
//! sheet against `oristudio-geometry`'s constructions on the rectangle; each
//! on folded forms with stacked references; O6 with its points on opposite
//! sides of the fold, from either side; replay of a stored
//! root after an inserted earlier step; the existing-crease line mode; the
//! mover check; and narrow overlaps without changing the located line.

mod support;

use std::collections::BTreeMap;

use oristudio_fold::{
    AnchoredFold, AnchoredRefused, Axiom, AxiomCandidate, Direction, FoldLine, Landmarks,
    LineRefusal, PlainFold, Seed, Sheet, SheetSegment, Side, StartSide, State,
};
use oristudio_geometry::construct::line_residual;
use oristudio_geometry::{Construction, Line, Paper, Sheet as Rectangle};
use support::*;

use Direction::{Mountain, Valley};

fn flat(sheet: Sheet) -> State {
    State::flat(sheet, StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

fn seg(a: Point, b: Point) -> SheetSegment {
    SheetSegment::new(a, b)
}

/// The book fold: the right half over the left, everything in
/// x ∈ [0, 0.5]. Corners stack in pairs: sheet (0, 0) and (1, 0) at (0, 0),
/// sheet (0, 1) and (1, 1) at (0, 1).
fn book() -> State {
    fold(&flat(Sheet::square()), &all(x_eq(0.5), [0.75, 0.5], Valley)).state
}

/// The book fold, then its top half down: four layers in [0, 0.5]².
fn quarters() -> State {
    fold(&book(), &all(y_eq(0.5), [0.25, 0.75], Valley)).state
}

fn candidates(state: &State, axiom: &Axiom) -> Vec<AxiomCandidate> {
    state
        .axiom_candidates(axiom)
        .unwrap_or_else(|e| panic!("{axiom:?}: {e}"))
}

fn find(candidates: &[AxiomCandidate], line: &Line) -> AxiomCandidate {
    *candidates
        .iter()
        .find(|c| c.line.approx_eq_within(line, 1e-9))
        .unwrap_or_else(|| panic!("{line:?} not among {candidates:?}"))
}

/// Fold along a candidate of the axiom, every layer, valley.
fn along(state: &State, axiom: &Axiom, root: &Line, toward: Option<Point>) -> State {
    let mut op = AnchoredFold::new(
        FoldLine::Axiom {
            axiom: axiom.clone(),
            root: *root,
        },
        Valley,
    );
    op.toward = toward;
    let landed = state
        .fold_anchored(&op)
        .unwrap_or_else(|e| panic!("{axiom:?}: {e} ({e:?})"))
        .state;
    assert_valid(&landed);
    landed
}

fn image(state: &State, sheet: Point) -> Point {
    state
        .resolve_point(sheet)
        .unwrap_or_else(|| panic!("{sheet:?} is off the paper"))
}

fn near(a: Point, b: Point) -> bool {
    (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }

    fn below(&mut self, n: usize) -> usize {
        ((self.next() * n as f64) as usize).min(n - 1)
    }

    /// A point inside a random face of the state: what a pick hands the
    /// engine.
    fn point(&mut self, state: &State) -> Point {
        let face = &state.faces()[self.below(state.faces().len())];
        let ring: Vec<Point> = face
            .ring
            .iter()
            .map(|v| state.vertices()[v.0 as usize])
            .collect();
        let weights: Vec<f64> = ring.iter().map(|_| self.next() + 0.05).collect();
        let total: f64 = weights.iter().sum();
        let mut p = [0.0, 0.0];
        for (q, w) in ring.iter().zip(&weights) {
            p[0] += q[0] * w / total;
            p[1] += q[1] * w / total;
        }
        p
    }

    /// A segment through `at` in a random direction, kept when it names a
    /// line (no folded crease bends it).
    fn segment_through(&mut self, state: &State, at: Point) -> Option<SheetSegment> {
        let t = self.next() * std::f64::consts::PI;
        let (u, v) = (0.03 + 0.1 * self.next(), 0.03 + 0.1 * self.next());
        let s = seg(
            [at[0] - u * t.cos(), at[1] - u * t.sin()],
            [at[0] + v * t.cos(), at[1] + v * t.sin()],
        );
        state.resolve_segment(&s).is_some().then_some(s)
    }

    fn segment(&mut self, state: &State) -> Option<SheetSegment> {
        let at = self.point(state);
        self.segment_through(state, at)
    }

    /// A line through two points of the sheet.
    fn fold(&mut self, state: &State) -> Option<Line> {
        let (a, b) = (self.point(state), self.point(state));
        ((a[0] - b[0]).hypot(a[1] - b[1]) > 0.2)
            .then(|| Line::from_points(a, b))
            .flatten()
    }

    /// A point of the sheet whose reflection across `fold` is on it too, and
    /// that reflection.
    fn lander(&mut self, state: &State, fold: &Line) -> Option<(Point, Point)> {
        let p = self.point(state);
        let r = fold.reflect_point(p);
        state.resolve_point(r).map(|_| (p, r))
    }

    /// An axiom with random inputs; the movers' landing lines pass through
    /// where a random fold takes them, so O5, O6 and O7 often have roots.
    fn axiom(&mut self, state: &State, number: u8) -> Option<Axiom> {
        Some(match number {
            1 => Axiom::O1 {
                p: self.point(state),
                q: self.point(state),
            },
            2 => Axiom::O2 {
                p: self.point(state),
                q: self.point(state),
            },
            3 => Axiom::O3 {
                m1: self.segment(state)?,
                m2: self.segment(state)?,
            },
            4 => Axiom::O4 {
                p: self.point(state),
                m: self.segment(state)?,
            },
            5 => {
                let fold = self.fold(state)?;
                let (p, r) = self.lander(state, &fold)?;
                let pivot = fold.project_point(self.point(state));
                state.resolve_point(pivot)?;
                Axiom::O5 {
                    pivot,
                    p,
                    m1: self.segment_through(state, r)?,
                }
            }
            6 => {
                let fold = self.fold(state)?;
                let (p1, r1) = self.lander(state, &fold)?;
                let (p2, r2) = self.lander(state, &fold)?;
                Axiom::O6 {
                    p1,
                    m1: self.segment_through(state, r1)?,
                    p2,
                    m2: self.segment_through(state, r2)?,
                }
            }
            _ => {
                let fold = self.fold(state)?;
                let (p, r) = self.lander(state, &fold)?;
                let x = fold.project_point(self.point(state));
                let n = fold.n;
                let m2 = seg(
                    [x[0] - 0.05 * n[0], x[1] - 0.05 * n[1]],
                    [x[0] + 0.05 * n[0], x[1] + 0.05 * n[1]],
                );
                state.resolve_segment(&m2)?;
                Axiom::O7 {
                    p,
                    m1: self.segment_through(state, r)?,
                    m2,
                }
            }
        })
    }
}

/// The sides an axiom's root moves, worked out from the definitions alone:
/// `None` when the root is dropped (a mover on the line), `Some(None)` when
/// the step chooses (an O6 with its points on opposite sides among them).
fn expected_side(axiom: &Axiom, line: &Line) -> Option<Option<Side>> {
    let of = |p: Point| Side::of_point(line, p);
    match axiom {
        Axiom::O1 { .. } | Axiom::O4 { .. } => Some(None),
        Axiom::O2 { p, .. } | Axiom::O5 { p, .. } | Axiom::O7 { p, .. } => of(*p).map(Some),
        Axiom::O3 { m1, .. } => match (of(m1.a), of(m1.b)) {
            (None, None) => None,
            (Some(s), None) | (None, Some(s)) => Some(Some(s)),
            (Some(s), Some(t)) => Some((s == t).then_some(s)),
        },
        Axiom::O6 { p1, p2, .. } => match (of(*p1), of(*p2)) {
            (Some(s), Some(t)) => Some((s == t).then_some(s)),
            _ => None,
        },
    }
}

/// On a flat sheet — a square, a rectangle, a square with precreases — the
/// model frame is the sheet frame, and every axiom's candidates are the
/// rectangle's construction roots, less those who-moves drops.
#[test]
fn each_axiom_on_a_flat_sheet_is_the_construction_on_the_rectangle() {
    let precreased = {
        let s = flat(Sheet::square());
        let s = precrease(
            &s,
            &all(through([0.0, 0.0], [1.0, 1.0]), [0.9, 0.1], Valley),
        )
        .state;
        precrease(&s, &all(y_eq(0.3), [0.5, 0.9], Valley)).state
    };
    let cases = [
        (flat(Sheet::square()), Rectangle::unit_square()),
        (
            flat(Sheet::rectangle(1.0, 0.6).unwrap_or_else(|e| panic!("{e}"))),
            Rectangle::new(1.0, 0.6).unwrap_or_else(|| unreachable!()),
        ),
        (precreased, Rectangle::unit_square()),
    ];
    let mut compared = [0usize; 8];
    let mut dropped = [0usize; 8];
    let mut opposite = 0usize;
    let mut rng = Rng(0x00a1_c0de);
    for (state, rectangle) in &cases {
        assert!(state.faces().len() == 1 || state.faces().len() == 4);
        for _ in 0..600 {
            let number = 1 + rng.below(7) as u8;
            let Some(axiom) = rng.axiom(state, number) else {
                continue;
            };
            let construction = state
                .axiom_construction(&axiom)
                .unwrap_or_else(|e| panic!("{axiom:?}: {e}"));
            let roots = construction.lines(rectangle);
            let got = candidates(state, &axiom);
            for c in &got {
                assert!(
                    roots
                        .iter()
                        .any(|r| r.root == c.root && line_residual(&r.line, &c.line) < 1e-12),
                    "{axiom:?}: {c:?} is no root of {roots:?}"
                );
            }
            for r in &roots {
                let side = expected_side(&axiom, &r.line);
                match got.iter().find(|c| c.root == r.root) {
                    Some(c) => {
                        assert_eq!(Some(c.side), side, "{axiom:?} root {r:?}");
                        compared[number as usize] += 1;
                        opposite += usize::from(number == 6 && c.side.is_none());
                    }
                    None => {
                        assert_eq!(side, None, "{axiom:?} dropped {r:?}");
                        dropped[number as usize] += 1;
                    }
                }
            }
        }
    }
    // On 2026-10-08, about 110 to 430 roots per axiom, and no O6 root
    // dropped: a random point is never on a root's line.
    for (number, &count) in compared.iter().enumerate().skip(1) {
        assert!(count >= 100, "O{number}: {count} roots compared");
    }
    assert!(opposite > 0, "no O6 root with its points on opposite sides");
    assert_eq!(dropped[6], 0);
}

/// An O6 whose points lie on opposite sides of a root keeps the root and
/// leaves the side to the step: (0, 0) onto the top edge and (1, 1) onto the
/// bottom has two folds, the midline and the anti-diagonal. Folding either
/// side lands both alignments — the moving point on its line, and the moving
/// line through the point that stays. A pair on one side keeps its side.
#[test]
fn o6_roots_with_the_points_on_opposite_sides_leave_the_side_to_the_step() {
    let s = flat(Sheet::square());
    let opposite = Axiom::O6 {
        p1: [0.0, 0.0],
        m1: seg([0.0, 1.0], [1.0, 1.0]),
        p2: [1.0, 1.0],
        m2: seg([0.0, 0.0], [1.0, 0.0]),
    };
    let got = candidates(&s, &opposite);
    for line in [y_eq(0.5), through([1.0, 0.0], [0.0, 1.0])] {
        let c = find(&got, &line);
        assert_eq!(c.side, None, "{c:?}");
        // Without a side the step must name one.
        let op = AnchoredFold::new(
            FoldLine::Axiom {
                axiom: opposite.clone(),
                root: c.line,
            },
            Valley,
        );
        assert_eq!(
            s.fold_anchored(&op).err().map(|e| e.code()),
            Some("no_side")
        );
        for toward in [[0.0, 0.0], [1.0, 1.0]] {
            let landed = along(&s, &opposite, &c.line, Some(toward));
            // (0, 0) meets the top edge's point above or across it, and
            // (1, 1) the bottom edge's.
            let (r1, r2) = (
                line.reflect_point([0.0, 0.0]),
                line.reflect_point([1.0, 1.0]),
            );
            assert!(near(image(&landed, [0.0, 0.0]), image(&landed, r1)));
            assert!(near(image(&landed, [1.0, 1.0]), image(&landed, r2)));
        }
    }
    assert_eq!(
        s.axiom_root(&opposite, &y_eq(0.5))
            .map(|r| r.candidate.side),
        Ok(None)
    );

    // (0, 0) onto x = 1 and (0, 0.5) onto x + y = 1.5: x = 0.5 takes both,
    // from the left.
    let same = Axiom::O6 {
        p1: [0.0, 0.0],
        m1: seg([1.0, 0.0], [1.0, 1.0]),
        p2: [0.0, 0.5],
        m2: seg([1.0, 0.5], [0.5, 1.0]),
    };
    let c = find(&candidates(&s, &same), &x_eq(0.5));
    assert_eq!(c.side, Some(side(&x_eq(0.5), [0.0, 0.0])));
    let landed = along(&s, &same, &c.line, None);
    assert!(near(image(&landed, [0.0, 0.0]), [1.0, 0.0]));
    assert!(near(image(&landed, [0.0, 0.5]), [1.0, 0.5]));
}

/// Every axiom on the book fold, where the corners and raw edges stack: each
/// expected line is a candidate, the candidates are the construction's roots
/// on the silhouette less the dropped ones, the axiom's mover decides the
/// side, and folding every layer lands both stacked copies of a mover on its
/// target.
#[test]
fn each_axiom_on_a_folded_form_with_stacked_references() {
    let s = book();
    let bend = seg([0.5, 0.0], [0.5, 1.0]);
    let silhouette_roots = |axiom: &Axiom| {
        s.axiom_construction(axiom)
            .unwrap_or_else(|e| panic!("{e}"))
            .lines(&s.silhouette())
    };
    let consistent = |axiom: &Axiom, got: &[AxiomCandidate]| {
        let roots = silhouette_roots(axiom);
        let kept = roots
            .iter()
            .filter(|r| expected_side(&model(&s, axiom), &r.line).is_some())
            .count();
        assert_eq!(kept, got.len(), "{axiom:?}: {roots:?} against {got:?}");
    };

    // O1 through the stacked corner at (0, 0), named by the top layer's
    // copy, and the bend's top end: no side of its own.
    let o1 = Axiom::O1 {
        p: [1.0, 0.0],
        q: [0.5, 1.0],
    };
    let got = candidates(&s, &o1);
    consistent(&o1, &got);
    let c = find(&got, &through([0.0, 0.0], [0.5, 1.0]));
    assert_eq!(c.side, None);
    let op = AnchoredFold::new(
        FoldLine::Axiom {
            axiom: o1.clone(),
            root: c.line,
        },
        Valley,
    );
    assert_eq!(
        s.fold_anchored(&op).err().map(|e| e.code()),
        Some("no_side")
    );
    along(&s, &o1, &c.line, Some([0.75, 0.25]));

    // O2: the stacked corner at (0, 1), named by the bottom layer's copy,
    // onto the bend's bottom end. Both copies land there.
    let o2 = Axiom::O2 {
        p: [0.0, 1.0],
        q: [0.5, 0.0],
    };
    let got = candidates(&s, &o2);
    consistent(&o2, &got);
    let bisector =
        Line::perpendicular_bisector([0.0, 1.0], [0.5, 0.0]).unwrap_or_else(|| unreachable!());
    let c = find(&got, &bisector);
    assert_eq!(c.side, Some(side(&bisector, [0.0, 1.0])));
    let landed = along(&s, &o2, &c.line, None);
    assert!(near(image(&landed, [0.0, 1.0]), [0.5, 0.0]));
    assert!(near(image(&landed, [1.0, 1.0]), [0.5, 0.0]));

    // O3: the stacked raw edges at x = 0 onto the stacked bottom edges: the
    // diagonal y = x; the other bisector only touches the paper.
    let o3 = Axiom::O3 {
        m1: seg([1.0, 0.0], [1.0, 1.0]),
        m2: seg([0.5, 0.0], [1.0, 0.0]),
    };
    let got = candidates(&s, &o3);
    consistent(&o3, &got);
    assert_eq!(got.len(), 1, "{got:?}");
    let diagonal = through([0.0, 0.0], [1.0, 1.0]);
    let c = find(&got, &diagonal);
    assert_eq!(c.side, Some(side(&diagonal, [0.0, 1.0])));
    let landed = along(&s, &o3, &c.line, None);
    for corner in [[0.0, 1.0], [1.0, 1.0]] {
        assert!(near(image(&landed, corner), [1.0, 0.0]));
    }

    // O4 through a point of the top layer, perpendicular to the bend:
    // y = 0.5, the quarter fold.
    let o4 = Axiom::O4 {
        p: [0.75, 0.5],
        m: bend,
    };
    let got = candidates(&s, &o4);
    consistent(&o4, &got);
    let c = find(&got, &y_eq(0.5));
    assert_eq!(c.side, None);
    let landed = along(&s, &o4, &c.line, Some([0.75, 0.9]));
    assert_eq!(landed.faces().len(), 4);

    // O5 about the stacked corner at (0, 0), carrying the stacked corner at
    // (0, 1) onto the bend: it lands at (0.5, √3/2); the other chord end is
    // off the paper.
    let o5 = Axiom::O5 {
        pivot: [1.0, 0.0],
        p: [0.0, 1.0],
        m1: bend,
    };
    let got = candidates(&s, &o5);
    consistent(&o5, &got);
    assert_eq!(got.len(), 1, "{got:?}");
    let lands = [0.5, 0.75f64.sqrt()];
    let fold_line =
        Line::perpendicular_bisector([0.0, 1.0], lands).unwrap_or_else(|| unreachable!());
    let c = find(&got, &fold_line);
    assert_eq!(c.side, Some(side(&fold_line, [0.0, 1.0])));
    let landed = along(&s, &o5, &c.line, None);
    for corner in [[0.0, 1.0], [1.0, 1.0]] {
        assert!(near(image(&landed, corner), lands));
    }

    // O7: the stacked corner at (0, 1) onto the bend, perpendicular to the
    // bottom edge: x = 0.25.
    let o7 = Axiom::O7 {
        p: [0.0, 1.0],
        m1: bend,
        m2: seg([0.0, 0.0], [0.5, 0.0]),
    };
    let got = candidates(&s, &o7);
    consistent(&o7, &got);
    let c = find(&got, &x_eq(0.25));
    assert_eq!(c.side, Some(side(&x_eq(0.25), [0.0, 1.0])));
    let landed = along(&s, &o7, &c.line, None);
    for corner in [[0.0, 1.0], [1.0, 1.0]] {
        assert!(near(image(&landed, corner), [0.5, 1.0]));
    }

    // O6 on the book fold: (0, 0) onto the bend and (0.5, 1) onto x = 0 are
    // only taken by folds that leave the two on opposite sides, so the step
    // names the side.
    let o6 = Axiom::O6 {
        p1: [0.0, 0.0],
        m1: bend,
        p2: [0.5, 1.0],
        m2: seg([0.0, 0.0], [0.0, 1.0]),
    };
    let got = candidates(&s, &o6);
    consistent(&o6, &got);
    assert!(!got.is_empty());
    assert!(got.iter().all(|c| c.side.is_none()), "{got:?}");
}

/// O6 on the book fold with its points on opposite sides of x + y = 0.3,
/// which cuts the corner at (0, 0) off both layers and keeps clear of the
/// bend. `p1`, the top layer's copy of (0.12, 0.05), reaches x = 0.25 at
/// (0.25, 0.18); `p2` at (0.2, 0.15) is reached by y = 0.1, the top layer's
/// segment in the corner. Folding the corner lands `p1` on x = 0.25 and
/// brings y = 0.1 through `p2`; folding the rest lands `p2` on y = 0.1 and
/// brings x = 0.25 through `p1`. A seed that moves only the top layer carries
/// the top layer's `p1`, and refuses the bottom layer's.
#[test]
fn an_o6_with_its_points_on_opposite_sides_lands_from_either_side_on_a_folded_form() {
    let s = book();
    let corner = through([0.3, 0.0], [0.0, 0.3]);
    let o6 = |p1: Point| Axiom::O6 {
        p1,
        m1: seg([0.25, 0.1], [0.25, 0.4]),
        p2: [0.2, 0.15],
        m2: seg([0.97, 0.1], [0.83, 0.1]),
    };
    let top = o6([0.88, 0.05]);
    let c = find(&candidates(&s, &top), &corner);
    assert_eq!(c.side, None);
    assert!(near(image(&s, [0.88, 0.05]), [0.12, 0.05]));

    // The corner moves: p1 onto x = 0.25, and y = 0.1 through p2.
    let landed = along(&s, &top, &c.line, Some([0.88, 0.05]));
    assert!(near(image(&landed, [0.88, 0.05]), [0.25, 0.18]));
    assert!(near(image(&landed, [0.2, 0.15]), [0.2, 0.15]));
    let moved = line_of(&landed, &seg([0.97, 0.1], [0.83, 0.1]));
    assert!(on(&moved, [0.2, 0.15], 1e-9), "{moved:?}");

    // The rest moves: p2 onto y = 0.1, and x = 0.25 through p1.
    let landed = along(&s, &top, &c.line, Some([0.2, 0.15]));
    assert!(near(image(&landed, [0.2, 0.15]), [0.15, 0.1]));
    assert!(near(image(&landed, [0.88, 0.05]), [0.12, 0.05]));
    let moved = line_of(&landed, &seg([0.25, 0.1], [0.25, 0.4]));
    assert!(on(&moved, [0.12, 0.05], 1e-9), "{moved:?}");

    // Only the top layer's corner moves: its p1 goes with it, the bottom
    // layer's stays behind.
    let top_layer = |axiom: Axiom| {
        AnchoredFold::new(
            FoldLine::Axiom {
                axiom,
                root: c.line,
            },
            Valley,
        )
        .with_seed(Seed::Depth {
            at: [0.95, 0.05],
            layers: 1,
        })
    };
    let landed = s
        .fold_anchored(&top_layer(top))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_valid(&landed.state);
    assert_eq!(landed.report.analysis.moving.len(), 1);
    assert!(near(image(&landed.state, [0.88, 0.05]), [0.25, 0.18]));
    assert_eq!(
        s.fold_anchored(&top_layer(o6([0.12, 0.05]))).err(),
        Some(AnchoredRefused::Line(LineRefusal::MoverStays {
            point: [0.12, 0.05]
        }))
    );
}

/// Every O6 root on the flat square with its points on opposite sides, over
/// random points and the sheet's edges as lines (the review's probe, seed
/// 7): each is a candidate that leaves the side to the step, and folding
/// either side brings each point together with the point of its line it
/// reaches. On the flat square the sheet is the model frame, so that point is
/// the point's reflection.
#[test]
fn opposite_side_o6_roots_on_the_flat_square_fold_from_either_side() {
    let s = flat(Sheet::square());
    let edges = [
        seg([0.0, 0.0], [1.0, 0.0]),
        seg([1.0, 0.0], [1.0, 1.0]),
        seg([1.0, 1.0], [0.0, 1.0]),
        seg([0.0, 1.0], [0.0, 0.0]),
    ];
    let mut rng = oristudio_fold::random::Rng::new(7);
    let (mut opposite, mut folded) = (0, 0);
    for _ in 0..4000 {
        let p1 = [rng.next_f64(), rng.next_f64()];
        let p2 = [rng.next_f64(), rng.next_f64()];
        let (m1, m2) = (edges[rng.below(4)], edges[rng.below(4)]);
        let axiom = Axiom::O6 { p1, m1, p2, m2 };
        let Ok(construction) = s.axiom_construction(&axiom) else {
            continue;
        };
        let got = candidates(&s, &axiom);
        for root in construction.lines(&s.silhouette()) {
            let sides = [p1, p2].map(|p| Side::of_point(&root.line, p));
            let [Some(a), Some(b)] = sides else {
                continue;
            };
            if a == b {
                continue;
            }
            opposite += 1;
            let c = find(&got, &root.line);
            assert_eq!(c.side, None, "{axiom:?} {c:?}");
            let (r1, r2) = (root.line.reflect_point(p1), root.line.reflect_point(p2));
            for toward in [p1, p2] {
                let landed = along(&s, &axiom, &c.line, Some(toward));
                for (p, r) in [(p1, r1), (p2, r2)] {
                    let (i, j) = (image(&landed, p), image(&landed, r));
                    assert!(
                        (i[0] - j[0]).hypot(i[1] - j[1]) < 1e-9,
                        "{axiom:?} along {:?} toward {toward:?}: {p:?} at {i:?}, {r:?} at {j:?}",
                        c.line
                    );
                }
                folded += 1;
            }
        }
    }
    // 123 such roots on 2026-10-08, each folded from both sides.
    assert!(opposite >= 100, "{opposite} opposite-side roots");
    assert_eq!(folded, 2 * opposite);
}

/// O6 on four stacked layers: the corner (0, 0) onto the vertical bend and
/// (0, 0.2) on the stacked raw edges onto the horizontal bend: the
/// anti-diagonal x + y = 0.5 takes both.
#[test]
fn o6_on_four_stacked_layers() {
    let s = quarters();
    let o6 = Axiom::O6 {
        p1: [0.0, 0.0],
        m1: seg([0.5, 0.0], [0.5, 0.5]),
        p2: [0.0, 0.2],
        m2: seg([0.0, 0.5], [0.5, 0.5]),
    };
    let got = candidates(&s, &o6);
    let diagonal = through([0.5, 0.0], [0.0, 0.5]);
    let c = find(&got, &diagonal);
    assert_eq!(c.side, Some(side(&diagonal, [0.0, 0.0])));
    for other in &got {
        let [a, b] = [[0.0, 0.0], [0.0, 0.2]].map(|p| Side::of_point(&other.line, p));
        assert!(a.is_some() && a == b, "{other:?}");
    }
    let landed = along(&s, &o6, &c.line, None);
    // Every layer's copy of the corner lands on the far corner.
    for corner in [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]] {
        assert!(near(image(&landed, corner), [0.5, 0.5]), "{corner:?}");
    }
}

/// The folded silhouette, not the sheet, filters the roots: on the book fold
/// the circle about (0, 0) through (0, 1) meets the bottom edge's line at
/// (1, 0), a corner of the square but off the folded form.
#[test]
fn the_silhouette_filters_roots_the_flat_sheet_keeps() {
    let s = book();
    let o5 = Axiom::O5 {
        pivot: [0.0, 0.0],
        p: [0.0, 1.0],
        m1: seg([0.0, 0.0], [0.5, 0.0]),
    };
    let construction = s.axiom_construction(&o5).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(construction.lines(&Rectangle::unit_square()).len(), 1);
    assert!(!s.silhouette().contains([1.0, 0.0], 1e-6));
    assert!(candidates(&s, &o5).is_empty());
}

/// A stored root replays to the nearest candidate. Inserting a precrease
/// first renumbers every face and vertex the inputs touch and leaves the
/// line exactly where it was; inserting a fold that takes the paper away
/// from one root's landing point leaves that root out, so the stored root is
/// first in the list where it was second, and the line still finds it. A
/// stored line that drifted by 1e-5 still resolves, where certifying to the
/// tolerance would not.
#[test]
fn replay_takes_the_nearest_root_after_an_inserted_step() {
    // About (0.5, 0.5), (0.5, 0.1) lands on y = 0.3 at x = 0.5 ± √0.12.
    let o5 = Axiom::O5 {
        pivot: [0.5, 0.5],
        p: [0.5, 0.1],
        m1: seg([0.3, 0.3], [1.0, 0.3]),
    };
    let s = flat(Sheet::square());
    let first = candidates(&s, &o5);
    assert_eq!(first.len(), 2, "{first:?}");
    let h = 0.12f64.sqrt();
    let right =
        Line::perpendicular_bisector([0.5, 0.1], [0.5 + h, 0.3]).unwrap_or_else(|| unreachable!());
    let chosen = find(&first, &right);
    let position = first.iter().position(|c| *c == chosen);
    assert_eq!(position, Some(1), "the stored root is the second candidate");
    let stored = chosen.line;
    let original = along(&s, &o5, &stored, None);

    // A precrease first, across the sheet: new vertices, new faces.
    let e = precrease(&s, &all(y_eq(0.7), [0.5, 0.9], Valley)).state;
    assert_eq!(
        (e.vertices().len(), e.faces().len()),
        (s.vertices().len() + 2, 2)
    );
    let replay = e
        .axiom_root(&o5, &stored)
        .unwrap_or_else(|err| panic!("{err}"));
    assert!(replay.err < 1e-12, "{replay:?}");
    assert_eq!(replay.candidate.root, chosen.root);
    let replayed = along(&e, &o5, &stored, None);
    for p in [[0.5, 0.1], [0.9, 0.05], [0.1, 0.0]] {
        assert!(near(image(&replayed, p), image(&original, p)), "{p:?}");
    }

    // A fold that takes the left strip off x < 0.2, where the other root
    // lands (0.5 − √0.12 ≈ 0.154).
    let e = fold(&s, &all(x_eq(0.2), [0.1, 0.5], Valley)).state;
    let now = candidates(&e, &o5);
    assert_eq!(now.len(), 1, "{now:?}");
    assert_eq!(now[0].root, chosen.root);
    let replay = e
        .axiom_root(&o5, &stored)
        .unwrap_or_else(|err| panic!("{err}"));
    assert!(replay.err < 1e-12);
    let replayed = along(&e, &o5, &stored, None);
    assert!(near(image(&replayed, [0.5, 0.1]), [0.5 + h, 0.3]));

    // A stored line that drifted.
    let drifted = Line::new(stored.n, stored.d + 1e-5).unwrap_or_else(|| unreachable!());
    let construction = s.axiom_construction(&o5).unwrap_or_else(|e| panic!("{e}"));
    assert!(construction.certify(&s.silhouette(), &drifted).is_none());
    let replay = s
        .axiom_root(&o5, &drifted)
        .unwrap_or_else(|err| panic!("{err}"));
    assert_eq!(replay.candidate, chosen);
    assert!((replay.err - 1e-5).abs() < 1e-12);
    // The resolved fold folds along the candidate, not the drifted line.
    let resolved = s
        .resolve_anchored(&AnchoredFold::new(
            FoldLine::Axiom {
                axiom: o5.clone(),
                root: drifted,
            },
            Valley,
        ))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(resolved.fold.line, chosen.line);
}

/// A segment anchor that a precrease inserted before its step splits still
/// names its line: an O7 carrying (0.3, 0.4) onto the bottom edge,
/// perpendicular to the left edge, is y = 0.2 on the flat square, and on the
/// square precreased at x = 0.5, which splits the bottom edge in two. So is
/// an O3 whose moving edge the precrease splits. A fold that bends the edge
/// still refuses it.
#[test]
fn a_segment_anchor_split_by_an_inserted_precrease_replays() {
    let bottom = seg([0.0, 0.0], [1.0, 0.0]);
    let o7 = Axiom::O7 {
        p: [0.3, 0.4],
        m1: bottom,
        m2: seg([0.0, 0.0], [0.0, 1.0]),
    };
    let s = flat(Sheet::square());
    let chosen = find(&candidates(&s, &o7), &y_eq(0.2));
    let original = along(&s, &o7, &chosen.line, None);

    let e = precrease(&s, &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    assert_eq!(e.faces_holding_segment(&bottom).len(), 2);
    let replay = e
        .axiom_root(&o7, &chosen.line)
        .unwrap_or_else(|err| panic!("{err}"));
    assert!(replay.err < 1e-12, "{replay:?}");
    assert_eq!(replay.candidate.side, chosen.side);
    let replayed = along(&e, &o7, &chosen.line, None);
    for p in [[0.3, 0.4], [0.9, 0.9], [0.1, 1.0]] {
        assert!(near(image(&replayed, p), image(&original, p)), "{p:?}");
    }
    assert!(near(image(&replayed, [0.3, 0.4]), [0.3, 0.0]));

    // O3: the split bottom edge onto the top edge, y = 0.5; both halves of
    // the edge move and land on it.
    let o3 = Axiom::O3 {
        m1: bottom,
        m2: seg([0.0, 1.0], [1.0, 1.0]),
    };
    let c = find(&candidates(&e, &o3), &y_eq(0.5));
    assert_eq!(c.side, Some(side(&y_eq(0.5), [0.5, 0.0])));
    let landed = along(&e, &o3, &c.line, None);
    for p in [[0.0, 0.0], [0.5, 0.0], [1.0, 0.0]] {
        assert!((image(&landed, p)[1] - 1.0).abs() < 1e-9, "{p:?}");
    }

    // Bent by a fold, the edge names no line.
    let bent = fold(&e, &all(x_eq(0.5), [0.75, 0.5], Valley)).state;
    assert_eq!(
        bent.axiom_candidates(&o7),
        Err(LineRefusal::SegmentNotOnAFace { segment: bottom })
    );
}

/// The existing-crease mode: the book fold's bend, picked from the
/// landmarks, unfolds the top flap; a precrease picked the same way refolds.
#[test]
fn the_existing_crease_mode_unfolds_and_refolds() {
    let s = book();
    let landmarks = s.landmarks(&[]);
    let bend = landmarks
        .existing_crease([0.49, 0.5], 0.05)
        .unwrap_or_else(|| panic!("no bend"));
    let op = AnchoredFold::new(
        FoldLine::Crease {
            segment: bend.sheet,
        },
        Valley,
    )
    .with_seed(Seed::Flaps {
        at: vec![[0.75, 0.5]],
    });
    let flat_again = s
        .fold_anchored(&op)
        .unwrap_or_else(|e| panic!("{e} ({e:?})"))
        .state;
    assert_valid(&flat_again);
    assert!(flat_again.order().is_empty(), "nothing overlaps");
    assert!(near(image(&flat_again, [1.0, 0.0]), [1.0, 0.0]));
    assert!(!kind_at(&flat_again, [0.5, 0.5]).is_folded());

    // The precrease is offered and refolds the right half over.
    let landmarks = flat_again.landmarks(&[]);
    let crease = landmarks
        .existing_crease([0.51, 0.3], 0.05)
        .unwrap_or_else(|| panic!("no crease"));
    let op = AnchoredFold::new(
        FoldLine::Crease {
            segment: crease.sheet,
        },
        Valley,
    )
    .toward([0.75, 0.5]);
    let refolded = flat_again
        .fold_anchored(&op)
        .unwrap_or_else(|e| panic!("{e}"));
    assert_valid(&refolded.state);
    assert_eq!(refolded.report.refolded.len(), 1);
    assert!(near(image(&refolded.state, [1.0, 0.0]), [0.0, 0.0]));

    // A crease that no longer lies on one face is refused by name.
    let bent = seg([0.0, 0.0], [1.0, 0.0]);
    let op = AnchoredFold::new(FoldLine::Crease { segment: bent }, Valley).toward([0.75, 0.5]);
    assert_eq!(
        s.fold_anchored(&op).err(),
        Some(AnchoredRefused::Line(LineRefusal::SegmentNotOnAFace {
            segment: bent
        }))
    );
}

/// The mover must be on a layer that moves: fold the stacked corner at
/// (0, 0) onto (0.3, 0.3), along x + y = 0.3, moving only the top layer (the
/// line keeps clear of the bend, so nothing joins it). Named by the top
/// layer's copy it lands; named by the bottom layer's, which stays, it is
/// refused.
#[test]
fn a_mover_left_behind_is_refused() {
    let s = book();
    let top_only = |p: Point| {
        let axiom = Axiom::O2 { p, q: [0.3, 0.3] };
        let root = candidates(&s, &axiom)[0].line;
        assert!(root.approx_eq(&through([0.3, 0.0], [0.0, 0.3])));
        AnchoredFold::new(FoldLine::Axiom { axiom, root }, Valley).with_seed(Seed::Depth {
            at: [0.95, 0.05],
            layers: 1,
        })
    };
    let landed = s
        .fold_anchored(&top_only([1.0, 0.0]))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_valid(&landed.state);
    assert_eq!(landed.report.analysis.moving.len(), 1);
    assert!(near(image(&landed.state, [1.0, 0.0]), [0.3, 0.3]));
    assert!(near(image(&landed.state, [0.0, 0.0]), [0.0, 0.0]));
    assert_eq!(
        s.fold_anchored(&top_only([0.0, 0.0])).err(),
        Some(AnchoredRefused::Line(LineRefusal::MoverStays {
            point: [0.0, 0.0]
        }))
    );
    assert_eq!(
        s.analyse_anchored(&top_only([0.0, 0.0]))
            .err()
            .map(|e| e.code()),
        Some("mover_stays")
    );
}

/// Free lines need their points apart in the model frame: two stacked
/// corners are one place.
#[test]
fn a_free_line_through_one_place_is_refused() {
    let s = book();
    let op = AnchoredFold::new(
        FoldLine::Free {
            a: [0.0, 0.0],
            b: [1.0, 0.0],
        },
        Valley,
    )
    .toward([0.25, 0.5]);
    assert_eq!(
        s.fold_anchored(&op).err().map(|e| e.code()),
        Some("free_line_too_short")
    );
    let op = AnchoredFold::new(
        FoldLine::Free {
            a: [0.25, 0.0],
            b: [0.25, 1.0],
        },
        Valley,
    )
    .toward([0.1, 0.5]);
    assert_valid(&s.fold_anchored(&op).unwrap_or_else(|e| panic!("{e}")).state);
}

/// The strip of `golden.rs`'s sliver: its left end folded over at x = 0.3
/// covers x ∈ [0.3, 0.6]; folding the right end at x = 0.79995 lands its
/// corners 1e-4 inside that layer.
fn strip() -> State {
    let s = flat(Sheet::rectangle(1.0, 0.5).unwrap_or_else(|e| panic!("{e}")));
    fold(&s, &all(x_eq(0.3), [0.1, 0.25], Valley)).state
}

/// Each construction keeps its exact line when the narrow overlap is fully
/// represented by the overlay. It must not be moved to a nearby contact line.
#[test]
fn resolved_narrow_overlaps_preserve_axiom_and_free_lines() {
    let s = strip();
    let bottom = seg([0.3, 0.0], [1.0, 0.0]);
    let o4 = Axiom::O4 {
        p: [0.79995, 0.25],
        m: bottom,
    };
    let o2 = Axiom::O2 {
        p: [1.0, 0.25],
        q: [0.5999, 0.25],
    };
    let free = FoldLine::Free {
        a: [0.79995, 0.0],
        b: [0.79995, 0.5],
    };
    for line in [
        free,
        FoldLine::Axiom {
            root: candidates(&s, &o4)[0].line,
            axiom: o4,
        },
        FoldLine::Axiom {
            root: candidates(&s, &o2)[0].line,
            axiom: o2,
        },
    ] {
        let op = AnchoredFold::new(line, Valley).toward([0.9, 0.25]);
        let landed = s.fold_anchored(&op).unwrap();
        assert_valid(&landed.state);
        for corner in [[1.0, 0.0], [1.0, 0.5]] {
            assert!((image(&landed.state, corner)[0] - 0.5999).abs() < 1e-9);
        }
    }
}

/// What a folded-form test means by an axiom's movers: the same axiom with
/// its anchors replaced by their model-frame images, so `expected_side` can
/// read them.
fn model(state: &State, axiom: &Axiom) -> Axiom {
    let p = |q: &Point| image(state, *q);
    let m = |s: &SheetSegment| seg(p(&s.a), p(&s.b));
    match axiom {
        Axiom::O1 { p: a, q } => Axiom::O1 { p: p(a), q: p(q) },
        Axiom::O2 { p: a, q } => Axiom::O2 { p: p(a), q: p(q) },
        Axiom::O3 { m1, m2 } => Axiom::O3 {
            m1: m(m1),
            m2: m(m2),
        },
        Axiom::O4 { p: a, m: l } => Axiom::O4 { p: p(a), m: m(l) },
        Axiom::O5 { pivot, p: a, m1 } => Axiom::O5 {
            pivot: p(pivot),
            p: p(a),
            m1: m(m1),
        },
        Axiom::O6 { p1, m1, p2, m2 } => Axiom::O6 {
            p1: p(p1),
            m1: m(m1),
            p2: p(p2),
            m2: m(m2),
        },
        Axiom::O7 { p: a, m1, m2 } => Axiom::O7 {
            p: p(a),
            m1: m(m1),
            m2: m(m2),
        },
    }
}

#[test]
fn the_construction_is_the_axiom_in_the_model_frame() {
    let s = book();
    let o7 = Axiom::O7 {
        p: [1.0, 1.0],
        m1: seg([0.5, 0.0], [0.5, 1.0]),
        m2: seg([0.5, 0.0], [1.0, 0.0]),
    };
    let Ok(Construction::O7 { p, m1, m2 }) = s.axiom_construction(&o7) else {
        panic!("not an O7");
    };
    assert!(near(p, [0.0, 1.0]));
    assert!(m1.approx_eq(&x_eq(0.5)));
    assert!(m2.approx_eq(&y_eq(0.0)));
    let off = Axiom::O2 {
        p: [1.5, 0.0],
        q: [0.0, 0.0],
    };
    assert_eq!(
        s.axiom_candidates(&off),
        Err(LineRefusal::PointOffPaper { point: [1.5, 0.0] })
    );
    let short = seg([0.1, 0.1], [0.1, 0.1005]);
    assert_eq!(
        s.axiom_candidates(&Axiom::O4 {
            p: [0.2, 0.2],
            m: short
        }),
        Err(LineRefusal::SegmentTooShort { segment: short })
    );
}

/// A random folded form: up to `folds` folds of every layer, along lines
/// through or between two vertex images, each kept only when it lands.
fn random_form(rng: &mut Rng, folds: u32) -> State {
    let mut s = flat(Sheet::square());
    for _ in 0..folds * 6 {
        if s.step() >= folds {
            break;
        }
        let points: Vec<Point> = (0..s.vertices().len())
            .filter_map(|v| s.vertex_image(oristudio_fold::VertexId(v as u32)))
            .collect();
        let (a, b) = (
            points[rng.below(points.len())],
            points[rng.below(points.len())],
        );
        let line = if rng.next() < 0.5 {
            Line::from_points(a, b)
        } else {
            Line::perpendicular_bisector(a, b)
        };
        let Some(line) = line else {
            continue;
        };
        let side = if rng.next() < 0.5 {
            Side::Positive
        } else {
            Side::Negative
        };
        let direction = if rng.next() < 0.5 { Valley } else { Mountain };
        if let Ok(f) = s.fold(&PlainFold::new(line, side, direction)) {
            s = f.state;
        }
    }
    s
}

/// A random point anchor among the landmarks' sources.
fn landmark_point(l: &Landmarks, rng: &mut Rng) -> Point {
    let p = &l.points[rng.below(l.points.len())];
    p.sources[rng.below(p.sources.len())].sheet
}

fn landmark_segment(l: &Landmarks, rng: &mut Rng) -> SheetSegment {
    l.segments[rng.below(l.segments.len())].sheet
}

/// An O6 with a root through a fold between landmarks. Drawn from landmarks
/// alone, an O6 almost never has a root with both points on one side: when
/// `p1` lies on `m2` and `p2` on `m1`, as vertices on edges often do, the
/// bisector of `p1 p2` is a root with the two points on opposite sides — an
/// O2 in disguise. So take two landmark points at least 0.05 off a line
/// between two others, on one side of it or on opposite sides, and aim each
/// at a short segment through its reflection, on the layer seen there. Each
/// segment lies whole on the side its point does not: when only the other
/// point moves, it moves with it and carries its line through the point that
/// stays.
fn o6_through_a_fold(s: &State, l: &Landmarks, rng: &mut Rng) -> Option<Axiom> {
    (0..100).find_map(|_| o6_attempt(s, l, rng))
}

fn o6_attempt(s: &State, l: &Landmarks, rng: &mut Rng) -> Option<Axiom> {
    let (a, b) = (
        l.points[rng.below(l.points.len())].at,
        l.points[rng.below(l.points.len())].at,
    );
    let fold = Line::perpendicular_bisector(a, b)?;
    let (p1, p2) = (landmark_point(l, rng), landmark_point(l, rng));
    let (i1, i2) = (image(s, p1), image(s, p2));
    if fold.distance_to_point(i1) < 0.05
        || fold.distance_to_point(i2) < 0.05
        || (i1[0] - i2[0]).hypot(i1[1] - i2[1]) < 0.05
    {
        return None;
    }
    let mut aim = |p: Point| {
        let (_, sheet) = s.top_visible_at(fold.reflect_point(p))?;
        let t = rng.next() * std::f64::consts::PI;
        let m = seg(
            [sheet[0] - 0.02 * t.cos(), sheet[1] - 0.02 * t.sin()],
            [sheet[0] + 0.02 * t.cos(), sheet[1] + 0.02 * t.sin()],
        );
        s.resolve_segment(&m).map(|_| m)
    };
    Some(Axiom::O6 {
        p1,
        m1: aim(i1)?,
        p2,
        m2: aim(i2)?,
    })
}

/// The model-frame line a segment anchor names.
fn line_of(state: &State, s: &SheetSegment) -> Line {
    state
        .resolve_segment(s)
        .unwrap_or_else(|| panic!("{s:?} names no line"))
}

fn on(line: &Line, p: Point, tol: f64) -> bool {
    line.distance_to_point(p) <= tol
}

/// The axiom's statement about `fold` in the model frame of `state`, to
/// `tol`: what a candidate must satisfy.
fn states(state: &State, axiom: &Axiom, fold: &Line, tol: f64) -> bool {
    let p = |q: &Point| image(state, *q);
    let m = |s: &SheetSegment| line_of(state, s);
    let onto = |q: &Point, s: &SheetSegment| on(&m(s), fold.reflect_point(p(q)), tol);
    let perpendicular = |s: &SheetSegment| fold.dot(&m(s)).abs() <= tol;
    match axiom {
        Axiom::O1 { p: a, q } => on(fold, p(a), tol) && on(fold, p(q), tol),
        Axiom::O2 { p: a, q } => {
            let r = fold.reflect_point(p(a));
            (r[0] - p(q)[0]).hypot(r[1] - p(q)[1]) <= tol
        }
        Axiom::O3 { m1, m2 } => fold
            .reflect_line(&m(m1))
            .is_some_and(|l| l.approx_eq_within(&m(m2), tol)),
        Axiom::O4 { p: a, m: l } => on(fold, p(a), tol) && perpendicular(l),
        Axiom::O5 { pivot, p: a, m1 } => on(fold, p(pivot), tol) && onto(a, m1),
        Axiom::O6 { p1, m1, p2, m2 } => onto(p1, m1) && onto(p2, m2),
        Axiom::O7 { p: a, m1, m2 } => perpendicular(m2) && onto(a, m1),
    }
}

/// After the fold, the movers are where the axiom says, read from the landed
/// state's own isometries: each point carried onto its line or point, and
/// the points a crease passes through left in place.
fn landed_as_stated(before: &State, after: &State, axiom: &Axiom, tol: f64) -> bool {
    let was = |q: &Point| image(before, *q);
    let now = |q: &Point| image(after, *q);
    let lands_on = |q: &Point, s: &SheetSegment| on(&line_of(before, s), now(q), tol);
    let stays = |q: &Point| {
        let (a, b) = (was(q), now(q));
        (a[0] - b[0]).hypot(a[1] - b[1]) <= tol
    };
    match axiom {
        Axiom::O1 { p, q } => stays(p) && stays(q),
        Axiom::O2 { p, q } => {
            let (a, b) = (now(p), was(q));
            (a[0] - b[0]).hypot(a[1] - b[1]) <= tol
        }
        // Each end of m1 lands on m2, or stays put on the side that does not
        // move (an m1 that straddles the fold lands only its moving half).
        Axiom::O3 { m1, m2 } => {
            let target = line_of(before, m2);
            [m1.a, m1.b]
                .iter()
                .all(|e| on(&target, now(e), tol) || stays(e))
        }
        Axiom::O4 { p, .. } => stays(p),
        Axiom::O5 { pivot, p, m1 } => stays(pivot) && lands_on(p, m1),
        // Each point lands on its line, or stays while its line comes to it:
        // with the points on opposite sides, one point and the other's line
        // move. A segment that moved whole carries its line through the
        // point; one the fold left in place or split names the line only
        // before the fold, where `states` holds it.
        Axiom::O6 { p1, m1, p2, m2 } => [(p1, m1), (p2, m2)].iter().all(|&(p, m)| {
            if !stays(p) {
                return lands_on(p, m);
            }
            let moved = !stays(&m.a) && !stays(&m.b);
            !moved
                || after
                    .resolve_segment(m)
                    .is_some_and(|line| on(&line, now(p), tol))
        }),
        Axiom::O7 { p, m1, .. } => lands_on(p, m1),
    }
}

/// Whether an O6 fold moved one point and the other's segment whole: what
/// [`landed_as_stated`] checks in the folded state when the points were on
/// opposite sides.
fn moved_one_point_and_a_line(before: &State, after: &State, axiom: &Axiom) -> bool {
    let Axiom::O6 { p1, m1, p2, m2 } = axiom else {
        return false;
    };
    let moved = |q: &Point| {
        let (a, b) = (image(before, *q), image(after, *q));
        (a[0] - b[0]).hypot(a[1] - b[1]) > 1e-5
    };
    let whole = |m: &SheetSegment| moved(&m.a) && moved(&m.b);
    (moved(p1) && !moved(p2) && whole(m2)) || (moved(p2) && !moved(p1) && whole(m1))
}

/// Axioms over the landmarks of random folded forms — every input a
/// landmark source's anchor, stacked layers included — hold for every
/// candidate, and every candidate that lands carries its movers where the
/// axiom says. Every refusal is a typed one.
#[test]
fn axioms_over_landmarks_hold_after_the_fold_on_random_forms() {
    let mut rng = Rng(0x0f01_d5ee);
    let mut landed = [0usize; 8];
    let mut opposite = 0usize;
    let mut refused: BTreeMap<&'static str, usize> = BTreeMap::new();
    for form in 0..36 {
        let s = random_form(&mut rng, 1 + form % 3);
        let l = s.landmarks(&[]);
        for _ in 0..60 {
            // O6 drawn three times as often: an O6 with a root takes a search.
            let number = [1, 2, 3, 4, 5, 6, 6, 6, 7][rng.below(9)];
            let mut point = || landmark_point(&l, &mut rng);
            let axiom = match number {
                1 => Axiom::O1 {
                    p: point(),
                    q: point(),
                },
                2 => Axiom::O2 {
                    p: point(),
                    q: point(),
                },
                3 => Axiom::O3 {
                    m1: landmark_segment(&l, &mut rng),
                    m2: landmark_segment(&l, &mut rng),
                },
                4 => Axiom::O4 {
                    p: landmark_point(&l, &mut rng),
                    m: landmark_segment(&l, &mut rng),
                },
                5 => Axiom::O5 {
                    pivot: landmark_point(&l, &mut rng),
                    p: landmark_point(&l, &mut rng),
                    m1: landmark_segment(&l, &mut rng),
                },
                6 => match o6_through_a_fold(&s, &l, &mut rng) {
                    Some(axiom) => axiom,
                    None => continue,
                },
                _ => Axiom::O7 {
                    p: landmark_point(&l, &mut rng),
                    m1: landmark_segment(&l, &mut rng),
                    m2: landmark_segment(&l, &mut rng),
                },
            };
            let got = s
                .axiom_candidates(&axiom)
                .unwrap_or_else(|e| panic!("landmark anchors resolve: {e}"));
            for c in got {
                assert!(states(&s, &axiom, &c.line, 2e-6), "{axiom:?} {c:?}");
                let mut op = AnchoredFold::new(
                    FoldLine::Axiom {
                        axiom: axiom.clone(),
                        root: c.line,
                    },
                    if rng.next() < 0.5 { Valley } else { Mountain },
                );
                if c.side.is_none() {
                    // Name a side by a landmark well off the line.
                    let off: Vec<Point> = l
                        .points
                        .iter()
                        .filter(|p| c.line.distance_to_point(p.at) > 0.01)
                        .map(|p| p.sources[0].sheet)
                        .collect();
                    if off.is_empty() {
                        continue;
                    }
                    op.toward = Some(off[rng.below(off.len())]);
                }
                match s.fold_anchored(&op) {
                    Ok(f) => {
                        assert_valid(&f.state);
                        assert!(
                            landed_as_stated(&s, &f.state, &axiom, 1e-5),
                            "{axiom:?} along {:?}",
                            f.report.analysis.line
                        );
                        landed[number as usize] += 1;
                        opposite += usize::from(moved_one_point_and_a_line(&s, &f.state, &axiom));
                    }
                    Err(e) => *refused.entry(e.code()).or_default() += 1,
                }
            }
        }
    }
    // On 2026-10-08: 32 to 179 landed folds per axiom, 21 of the 69 O6 folds
    // moving one point and the other's line; the 255 refusals were all
    // "nothing stays" (lines along the folded form's edges).
    for (number, &count) in landed.iter().enumerate().skip(1) {
        assert!(count >= 20, "O{number}: {count} landed ({refused:?})");
    }
    assert!(
        opposite >= 10,
        "{opposite} O6 folds moved one point and the other's line"
    );
}

/// Swap, one rule for every axiom that implies a side: a side the step
/// names (`toward`) beats it. Each axiom that carries something, on the
/// flat square and on the book fold's stacked layers: named nothing, the
/// side the root implies moves and its mover lands where the axiom says;
/// named the other side, that side moves — the mover stays put and what it
/// was carried onto comes to it — the fold, mountain or a precrease alike,
/// along the same line.
#[test]
fn a_side_the_step_names_beats_the_side_the_axiom_implies() {
    /// One axiom fold, and what its two sides do.
    struct Case<'a> {
        name: &'a str,
        state: &'a State,
        axiom: Axiom,
        line: Line,
        /// The mover (a sheet point) and where it lands, model frame.
        mover: Point,
        target: Point,
        /// A sheet point on the other side, and a point of that side with
        /// where it lands once that side moves instead.
        other: Point,
        partner: Point,
        onto: Point,
    }
    let square = flat(Sheet::square());
    let book = book();
    let bend = seg([0.5, 0.0], [0.5, 1.0]);
    let lands = [0.5, 0.75f64.sqrt()];
    let bisector =
        |p: Point, q: Point| Line::perpendicular_bisector(p, q).unwrap_or_else(|| unreachable!());
    let cases = [
        // The owner's: the top-left corner onto the bottom-right one.
        Case {
            name: "O2",
            state: &square,
            axiom: Axiom::O2 {
                p: [0.0, 1.0],
                q: [1.0, 0.0],
            },
            line: through([0.0, 0.0], [1.0, 1.0]),
            mover: [0.0, 1.0],
            target: [1.0, 0.0],
            other: [0.9, 0.1],
            partner: [1.0, 0.0],
            onto: [0.0, 1.0],
        },
        Case {
            name: "O2 on the book",
            state: &book,
            axiom: Axiom::O2 {
                p: [0.0, 1.0],
                q: [0.5, 0.0],
            },
            line: bisector([0.0, 1.0], [0.5, 0.0]),
            mover: [0.0, 1.0],
            target: [0.5, 0.0],
            other: [0.45, 0.05],
            partner: [0.5, 0.0],
            onto: [0.0, 1.0],
        },
        Case {
            name: "O3 on the book",
            state: &book,
            axiom: Axiom::O3 {
                m1: seg([1.0, 0.0], [1.0, 1.0]),
                m2: seg([0.5, 0.0], [1.0, 0.0]),
            },
            line: through([0.0, 0.0], [1.0, 1.0]),
            mover: [0.0, 1.0],
            target: [1.0, 0.0],
            other: [0.4, 0.1],
            partner: [0.5, 0.0],
            onto: [0.0, 0.5],
        },
        Case {
            name: "O5 on the book",
            state: &book,
            axiom: Axiom::O5 {
                pivot: [1.0, 0.0],
                p: [0.0, 1.0],
                m1: bend,
            },
            line: bisector([0.0, 1.0], lands),
            mover: [0.0, 1.0],
            target: lands,
            other: [0.45, 0.05],
            partner: lands,
            onto: [0.0, 1.0],
        },
        Case {
            name: "O6 on the square",
            state: &square,
            axiom: Axiom::O6 {
                p1: [0.0, 0.0],
                m1: seg([1.0, 0.0], [1.0, 1.0]),
                p2: [0.0, 0.5],
                m2: seg([1.0, 0.5], [0.5, 1.0]),
            },
            line: x_eq(0.5),
            mover: [0.0, 0.0],
            target: [1.0, 0.0],
            other: [0.9, 0.5],
            partner: [1.0, 0.0],
            onto: [0.0, 0.0],
        },
        Case {
            name: "O7 on the book",
            state: &book,
            axiom: Axiom::O7 {
                p: [0.0, 1.0],
                m1: bend,
                m2: seg([0.0, 0.0], [0.5, 0.0]),
            },
            line: x_eq(0.25),
            mover: [0.0, 1.0],
            target: [0.5, 1.0],
            other: [0.45, 0.5],
            partner: [0.5, 1.0],
            onto: [0.0, 1.0],
        },
    ];
    for Case {
        name,
        state: s,
        axiom,
        line,
        mover,
        target,
        other,
        partner,
        onto,
    } in cases
    {
        let c = find(&candidates(s, &axiom), &line);
        let implied = side(&line, image(s, mover));
        assert_eq!(c.side, Some(implied), "{name}");
        let op = |toward: Option<Point>, direction| {
            let mut op = AnchoredFold::new(
                FoldLine::Axiom {
                    axiom: axiom.clone(),
                    root: c.line,
                },
                direction,
            );
            op.toward = toward;
            op
        };
        // Named nothing: the axiom's side, its mover carried.
        let landed = along(s, &axiom, &c.line, None);
        assert!(near(image(&landed, mover), target), "{name}");
        // Named the other side: it moves, onto the mover, which stays.
        let resolved = s
            .resolve_anchored(&op(Some(other), Valley))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(resolved.fold.side, implied.opposite(), "{name}");
        let swapped = along(s, &axiom, &c.line, Some(other));
        assert!(
            near(image(&swapped, mover), image(s, mover)),
            "{name}: the mover moved"
        );
        assert!(
            near(image(&swapped, partner), onto),
            "{name}: {partner:?} at {:?}, not {onto:?}",
            image(&swapped, partner)
        );
        // A point on the axiom's side names that side, as nothing does.
        let named = s
            .resolve_anchored(&op(Some(mover), Valley))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(named.fold.side, implied, "{name}");
        // A mountain and a precrease take the named side too.
        for (kind, folded) in [
            ("mountain", s.fold_anchored(&op(Some(other), Mountain))),
            ("precrease", s.precrease_anchored(&op(Some(other), Valley))),
        ] {
            let folded = folded.unwrap_or_else(|e| panic!("{name} {kind}: {e}"));
            assert_eq!(
                folded.report.analysis.side,
                implied.opposite(),
                "{name} {kind}"
            );
        }
    }
}
