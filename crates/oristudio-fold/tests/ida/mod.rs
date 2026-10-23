//! The traditional crane by Ida's route, as Beloch writes it (`crane.bel`;
//! Ida 2020, Fig. 7.19), as a sequence of the engine's own steps: the
//! triangle; the preliminary base by two inside reverses; the bird base by
//! four more, of the side corners onto the centre line, and the two petal
//! folds; the legs narrowed by four plain folds; then the neck, the tail and
//! the head reversed. Every step is kept with the state it starts from and
//! what it lands, for `tests/crane.rs` to check against Beloch's frames and
//! `examples/reverse.rs` to time.
//!
//! The lines are Beloch's, in its table frame (`notes/2026-09-25-crane-
//! oracle.md` gives each as Ida's ray), taken to the model frame by the
//! sequence's `to_model`: the triangle's corner c = (1, 1), the centre line
//! y = x, the point L = (1 − √2/4, 1 − √2/4) where the side corners land.
//! Anchors and depths are sheet points: the paper's corners a = (0, 0),
//! b = (1, 0), c = (1, 1), d = (0, 1) and its centre o.

#![allow(dead_code)]

use oristudio_fold::{
    CreasePatternInput, Direction, FaceId, ImportKind, Isometry, PlainFold, ReverseChoices,
    ReverseFold, ReverseFolded, ReverseKind, ReverseOutcome, Seed, Side, State, VertexId,
};
use oristudio_geometry::{Line, convex};

type Point = [f64; 2];

pub const SQRT2: f64 = std::f64::consts::SQRT_2;

/// Where the side corners land on the centre line.
pub const L: Point = [1.0 - SQRT2 / 4.0, 1.0 - SQRT2 / 4.0];

pub const A: Point = [0.0, 0.0];
pub const B: Point = [1.0, 0.0];
pub const C: Point = [1.0, 1.0];
pub const D: Point = [0.0, 1.0];
pub const O: Point = [0.5, 0.5];

/// The legs' tip in the bird base, where b and d land.
const TIP: Point = [1.0, 1.0];

/// One step as the engine took it.
pub enum Op {
    Fold(PlainFold),
    Reverse(ReverseFold, ReverseChoices),
}

pub struct Step {
    pub name: String,
    pub parent: State,
    pub op: Op,
    pub state: State,
    /// For a reverse fold, what it reported.
    pub reverse: Option<ReverseFolded>,
}

/// Steps from a state whose model frame is Beloch's table after `to_model`.
pub struct Sequence {
    pub start: State,
    pub steps: Vec<Step>,
    /// Table to model.
    pub to_model: Isometry,
}

fn line_through(p: Point, q: Point) -> Line {
    Line::from_points(p, q).unwrap_or_else(|| panic!("{p:?} = {q:?}"))
}

fn at_angle(p: Point, degrees: f64) -> Line {
    let t = degrees.to_radians();
    Line::from_point_direction(p, [t.cos(), t.sin()]).unwrap_or_else(|| unreachable!())
}

fn side_of(line: &Line, p: Point) -> Side {
    Side::of_point(line, p).unwrap_or_else(|| panic!("{p:?} is on the line"))
}

/// The petal folds' line, perpendicular to the centre line through L.
pub fn petal_line() -> Line {
    Line::new([1.0, 1.0], 2.0 * L[0]).unwrap_or_else(|| unreachable!())
}

/// Whether face `f`'s sheet polygon holds every point, its boundary
/// included.
fn holds_all(state: &State, f: FaceId, points: &[Point]) -> bool {
    let polygon: Vec<Point> = state
        .face(f)
        .map(|face| {
            face.ring
                .iter()
                .map(|v| state.vertices()[v.0 as usize])
                .collect()
        })
        .unwrap_or_default();
    points
        .iter()
        .all(|&p| convex::contains_point(&polygon, p, -1e-9))
}

/// The image of the sheet vertex at `p`.
pub fn vertex_image(state: &State, p: Point) -> Point {
    let v = state
        .vertices()
        .iter()
        .position(|q| (q[0] - p[0]).abs() < 1e-12 && (q[1] - p[1]).abs() < 1e-12)
        .unwrap_or_else(|| panic!("no vertex at {p:?}"));
    state.vertex_image(VertexId(v as u32)).unwrap_or_default()
}

impl Sequence {
    pub fn new(start: State, to_model: Isometry) -> Sequence {
        Sequence {
            start,
            steps: Vec::new(),
            to_model,
        }
    }

    pub fn state(&self) -> &State {
        self.steps.last().map_or(&self.start, |s| &s.state)
    }

    fn point(&self, table: Point) -> Point {
        self.to_model.apply(table)
    }

    fn line(&self, table: Line) -> Line {
        let foot = table.foot();
        let dir = table.direction();
        line_through(
            self.point(foot),
            self.point([foot[0] + dir[0], foot[1] + dir[1]]),
        )
    }

    fn push(&mut self, name: &str, op: Op, state: State, reverse: Option<ReverseFolded>) {
        let parent = self.state().clone();
        self.steps.push(Step {
            name: name.to_string(),
            parent,
            op,
            state,
            reverse,
        });
    }

    /// Every layer on `toward`'s side of `line` (table), valley.
    pub fn fold_all(&mut self, name: &str, line: Line, toward: Point) {
        let line = self.line(line);
        let op = PlainFold::new(line, side_of(&line, self.point(toward)), Direction::Valley);
        let folded = self
            .state()
            .fold(&op)
            .unwrap_or_else(|e| panic!("{name}: {e} {:?}", e.fixes));
        self.push(name, Op::Fold(op), folded.state, None);
    }

    /// The layers from the top (valley) or the bottom (mountain) down to the
    /// face whose sheet polygon holds every one of `holds`, counted at the
    /// table point `at`, which moves, folded along `line` (table).
    pub fn fold_to(
        &mut self,
        name: &str,
        line: Line,
        direction: Direction,
        at: Point,
        holds: &[Point],
    ) {
        let (line, at) = (self.line(line), self.point(at));
        let state = self.state();
        let stack = state
            .stack_at(at)
            .unwrap_or_else(|| panic!("{name}: no stack at {at:?}"));
        let k = stack
            .iter()
            .position(|&f| holds_all(state, f, holds))
            .unwrap_or_else(|| panic!("{name}: no face holding {holds:?} at {at:?}"));
        let layers = match direction {
            Direction::Valley => k + 1,
            Direction::Mountain => stack.len() - k,
        };
        let seed = Seed::Depth {
            at: state
                .isometry(stack[k])
                .unwrap_or_default()
                .inverse()
                .apply(at),
            layers,
        };
        let op = PlainFold::new(line, side_of(&line, at), direction).with_seed(seed);
        let folded = state
            .fold(&op)
            .unwrap_or_else(|e| panic!("{name}: {e} {:?}", e.fixes));
        self.push(name, Op::Fold(op), folded.state, None);
    }

    /// An inside reverse fold along `line` (table) of the tip on `toward`'s
    /// side, grown from the face holding the sheet point `anchor`, opened
    /// along `spine` (table) when it opens several ways.
    pub fn reverse(
        &mut self,
        name: &str,
        line: Line,
        toward: Point,
        anchor: Point,
        spine: Option<Line>,
    ) {
        let line = self.line(line);
        let op = ReverseFold {
            line,
            side: side_of(&line, self.point(toward)),
            anchor: Seed::Flaps { at: vec![anchor] },
            kind: ReverseKind::Inside,
        };
        let spine = spine.map(|s| self.line(s));
        self.reverse_op(name, op, spine);
    }

    /// `op`, opened along the model line `spine` when it opens several
    /// ways.
    pub fn reverse_op(&mut self, name: &str, op: ReverseFold, spine: Option<Line>) {
        let state = self.state();
        let choices = match state.reverse_fold(&op, &ReverseChoices::default()) {
            Ok(ReverseOutcome::ChooseOpening(asked)) => {
                let spine = spine.unwrap_or_else(|| panic!("{name} opens several ways"));
                let opening = asked.flaps[0]
                    .openings
                    .iter()
                    .find(|o| o.spine.is_some_and(|line| line.approx_eq(&spine)))
                    .unwrap_or_else(|| panic!("{name}: no opening along {spine:?}"));
                ReverseChoices {
                    openings: vec![opening.stored.clone()],
                    order: None,
                }
            }
            _ => ReverseChoices::default(),
        };
        let folded = match state.reverse_fold(&op, &choices) {
            Ok(ReverseOutcome::Landed(folded)) => *folded,
            Ok(_) => panic!("{name}: leaves a choice"),
            Err(e) => panic!("{name}: {e}"),
        };
        let landed = folded.state.clone();
        self.push(name, Op::Reverse(op, choices), landed, Some(folded));
    }

    /// The bird base from the square folded into the triangle: nine steps,
    /// `bird-base-petal.fold`'s frames 1 to 9.
    pub fn bird_base(&mut self) {
        self.fold_all("triangle", line_through(B, D), A);
        self.reverse(
            "b onto c",
            Line::new([0.0, 1.0], 0.5).unwrap_or_else(|| unreachable!()),
            [0.9, 0.2],
            [0.9, 0.05],
            None,
        );
        self.reverse(
            "d onto c",
            Line::new([1.0, 0.0], 0.5).unwrap_or_else(|| unreachable!()),
            [0.2, 0.9],
            [0.05, 0.9],
            None,
        );
        // The side corners .sr = m_ab, .sl = m_da, .br = m_bc and
        // .bl = m_cd, each onto the centre line through c: along the line
        // through c and the midpoint of the corner and L.
        for (name, corner, anchor) in [
            ("sr", [1.0, 0.5], [0.55, 0.02]),
            ("sl", [0.5, 1.0], [0.02, 0.55]),
            ("br", [1.0, 0.5], [0.98, 0.45]),
            ("bl", [0.5, 1.0], [0.45, 0.98]),
        ] {
            let mid = [(corner[0] + L[0]) / 2.0, (corner[1] + L[1]) / 2.0];
            self.reverse(name, line_through(C, mid), corner, anchor, None);
        }
        // The petals: the front valley up to the face holding a and o, the
        // back mountain up to the face holding c and o, at c.
        self.fold_to(
            "front petal",
            petal_line(),
            Direction::Valley,
            [0.97, 0.97],
            &[A, O],
        );
        self.fold_to(
            "back petal",
            petal_line(),
            Direction::Mountain,
            [0.97, 0.97],
            &[C, O],
        );
    }

    /// From a bird base: the legs narrowed, the neck and the tail reversed.
    pub fn neck_and_tail(&mut self) {
        // Each leg's outer edge, through the leg tip at 67.5° (front right)
        // or 22.5° (left), onto the centre line, along the bisector at
        // 56.25° or 33.75°: the front layers valley, the back mountain, each
        // up to the face holding the leg's corner and the centre, at a point
        // just inside the leg by the petal crease.
        let edge = at_angle(TIP, 67.5)
            .intersect(&petal_line())
            .unwrap_or_else(|| unreachable!());
        let centre = (edge[0] + edge[1] + 1.0) / 3.0;
        let e1 = [
            edge[0] + 0.05 * (centre - edge[0]),
            edge[1] + 0.05 * (centre - edge[1]),
        ];
        let e2 = [e1[1], e1[0]];
        for (name, degrees, at, corner, direction) in [
            ("narrow b front", 56.25, e1, B, Direction::Valley),
            ("narrow d front", 33.75, e2, D, Direction::Valley),
            ("narrow b back", 56.25, e1, B, Direction::Mountain),
            ("narrow d back", 33.75, e2, D, Direction::Mountain),
        ] {
            self.fold_to(name, at_angle(TIP, degrees), direction, at, &[corner, O]);
        }
        // The neck and the tail: each leg reversed about the perpendicular
        // to its narrowed edge through L, opening along the centre line.
        let centre_line = line_through(O, C);
        self.reverse(
            "neck",
            at_angle(L, 146.25),
            TIP,
            [0.98, 0.01],
            Some(centre_line),
        );
        self.reverse(
            "tail",
            at_angle(L, 123.75),
            TIP,
            [0.01, 0.98],
            Some(centre_line),
        );
    }

    /// The head: an inside reverse of the neck by b along `line` (model).
    pub fn head(&mut self, line: Line) {
        let b = vertex_image(self.state(), B);
        let op = ReverseFold {
            line,
            side: side_of(&line, b),
            anchor: Seed::Flaps {
                at: vec![[0.98, 0.01]],
            },
            kind: ReverseKind::Inside,
        };
        self.reverse_op("head", op, None);
    }
}

/// The line, in `state`'s model frame, of the creases `pattern` has that
/// `state` lacks: each lies inside one of the state's faces, which takes it
/// to the model frame. The head is a free choice in folding practice; this
/// reads Beloch's off its finished crane.
pub fn new_crease_line(state: &State, pattern: &CreasePatternInput) -> Line {
    let mut images: Vec<Point> = Vec::new();
    for segment in &pattern.segments {
        if segment.kind == ImportKind::Border {
            continue;
        }
        let mid = [
            (segment.from[0] + segment.to[0]) / 2.0,
            (segment.from[1] + segment.to[1]) / 2.0,
        ];
        if state.crease_at(mid).is_some() {
            continue;
        }
        let face = state
            .face_at(mid)
            .unwrap_or_else(|| panic!("a new crease at {mid:?} lies in no face"));
        let t = state.isometry(face).unwrap_or_default();
        images.extend([t.apply(segment.from), t.apply(segment.to)]);
    }
    assert!(images.len() >= 4, "no new creases");
    let (p, q) = images
        .iter()
        .flat_map(|&p| images.iter().map(move |&q| (p, q)))
        .max_by(|a, b| {
            let length = |(p, q): &(Point, Point)| (p[0] - q[0]).hypot(p[1] - q[1]);
            length(a).total_cmp(&length(b))
        })
        .unwrap_or_else(|| unreachable!());
    let line = line_through(p, q);
    assert!(images.iter().all(|&x| line.signed_distance(x).abs() < 1e-9));
    line
}
