//! The vertex spike's named states (research `r2-spike-squash-petal-rabbit`,
//! `build.mjs` and `cases.mjs`), folded through the engine: the squash
//! routes to the preliminary and waterbomb bases, the petal folds to the
//! bird base, and the rabbit ears and swivel vertices of its case 3.
//! Self-contained, so `crates/oracle-tests` checks the same states (through
//! `#[path]`).
//!
//! The spike's points are model-frame points of its states. Its turn-over
//! composed into the geometry; here it turns the view, so the layer a step
//! names is the one the viewer sees on top ([`seen_top`]).

#![allow(dead_code)]

use oristudio_fold::{
    CompoundRefused, Direction, PetalFold, PetalHinge, PlainFold, RabbitEar, Seed, Sheet, Side,
    Squash, StartSide, State, Swivel, VertexChoices, VertexFolded, VertexOutcome,
};
use oristudio_geometry::Line;

pub type Point = [f64; 2];

pub fn square() -> State {
    State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
}

/// The point mirrored in x ↦ 1 − x when `mirror`.
pub fn m(mirror: bool, p: Point) -> Point {
    if mirror { [1.0 - p[0], p[1]] } else { p }
}

fn line(p: Point, q: Point) -> Line {
    Line::from_points(p, q).unwrap_or_else(|| panic!("{p:?} = {q:?}"))
}

fn side(line: &Line, p: Point) -> Side {
    Side::of_point(line, p).unwrap_or_else(|| panic!("{p:?} is on the line"))
}

/// A valley through every layer on `toward`'s side of `p q`.
pub fn valley(state: &State, p: Point, q: Point, toward: Point) -> State {
    let l = line(p, q);
    state
        .fold(&PlainFold::new(l, side(&l, toward), Direction::Valley))
        .unwrap_or_else(|e| panic!("{e}"))
        .state
}

/// A valley precrease along `p q`, `toward`'s side moving, with `seed`.
pub fn precrease(state: &State, p: Point, q: Point, toward: Point, seed: Seed) -> State {
    let l = line(p, q);
    state
        .precrease(&PlainFold::new(l, side(&l, toward), Direction::Valley).with_seed(seed))
        .unwrap_or_else(|e| panic!("{e}"))
        .state
}

/// The sheet point under the model point `p` on the layer the viewer sees
/// on top there.
pub fn seen_top(state: &State, p: Point) -> Point {
    let mut stack = state.stack_at(p).unwrap_or_default();
    if state.view().flipped {
        stack.reverse();
    }
    let top = *stack.first().unwrap_or_else(|| panic!("nothing at {p:?}"));
    state.isometry(top).unwrap_or_default().inverse().apply(p)
}

/// The same on the layer seen at the bottom.
pub fn seen_bottom(state: &State, p: Point) -> Point {
    let mut stack = state.stack_at(p).unwrap_or_default();
    if !state.view().flipped {
        stack.reverse();
    }
    let bottom = *stack.first().unwrap_or_else(|| panic!("nothing at {p:?}"));
    state
        .isometry(bottom)
        .unwrap_or_default()
        .inverse()
        .apply(p)
}

/// A vertex fold that must land as it is.
pub fn landed(outcome: Result<VertexOutcome, CompoundRefused>) -> VertexFolded {
    match outcome {
        Ok(VertexOutcome::Landed(folded)) => *folded,
        Ok(VertexOutcome::ChooseOrder(choice)) => {
            panic!("choose an order of {:?}", choice.count())
        }
        Err(e) => panic!("{e} {e:?}"),
    }
}

/// Every state a vertex fold can land: the one, or each order offered.
pub fn every(outcome: Result<VertexOutcome, CompoundRefused>) -> Vec<VertexFolded> {
    match outcome {
        Ok(VertexOutcome::Landed(folded)) => vec![*folded],
        Ok(VertexOutcome::ChooseOrder(choice)) => {
            let mut picks: Vec<Vec<usize>> = vec![Vec::new()];
            for component in choice.completions().components() {
                picks = picks
                    .into_iter()
                    .flat_map(|p| {
                        (0..component.orders.len()).map(move |k| {
                            let mut q = p.clone();
                            q.push(k);
                            q
                        })
                    })
                    .collect();
            }
            picks
                .iter()
                .map(|pick| choice.pick(pick).unwrap_or_else(|e| panic!("{e}")))
                .collect()
        }
        Err(_) => Vec::new(),
    }
}

/// A valley squash of the flap the viewer sees on top at the model point
/// `p`, symmetric or with the spine landing toward `target`.
pub fn squash_op(state: &State, p: Point, target: Option<Point>) -> Squash {
    Squash {
        flap: seen_top(state, p),
        target,
        direction: Direction::Valley,
        hinge: None,
    }
}

pub fn squash(state: &State, p: Point) -> VertexFolded {
    landed(state.squash(&squash_op(state, p, None), &VertexChoices::default()))
}

/// The diagonal route's start (`build.mjs` `smallTriangle`): the square
/// folded on bd onto a, then on ac: a four-layer triangle.
pub fn small_triangle(mirror: bool) -> State {
    let s = valley(
        &square(),
        m(mirror, [1.0, 0.0]),
        m(mirror, [0.0, 1.0]),
        m(mirror, [1.0, 1.0]),
    );
    valley(
        &s,
        m(mirror, [0.0, 0.0]),
        m(mirror, [1.0, 1.0]),
        m(mirror, [1.0, 0.0]),
    )
}

/// The midline route's start (`smallSquare`): folded in half twice.
pub fn small_square() -> State {
    let s = valley(&square(), [0.5, 0.0], [0.5, 1.0], [1.0, 0.5]);
    valley(&s, [0.0, 0.5], [1.0, 0.5], [0.5, 1.0])
}

/// The steps of a route: each parent and what landed on it.
pub struct Route {
    pub steps: Vec<(State, VertexFolded)>,
}

impl Route {
    pub fn last(&self) -> &State {
        &self.steps[self.steps.len() - 1].1.state
    }
}

/// Spike case 1b: the diagonal route squashed, turned over and squashed
/// again: the preliminary base (`mirror` folds the mirror image).
pub fn preliminary(mirror: bool) -> Route {
    let start = small_triangle(mirror);
    let first = squash(&start, m(mirror, [0.1, 0.5]));
    let turned = first.state.turn_over();
    let second = squash(&turned, m(mirror, [0.1, 0.7]));
    Route {
        steps: vec![(start, first), (turned, second)],
    }
}

/// Spike case 1a: the midline route squashed, turned and squashed: the
/// waterbomb base, not the preliminary one.
pub fn waterbomb() -> Route {
    let start = small_square();
    let first = squash(&start, [0.2, 0.1]);
    let turned = first.state.turn_over();
    let second = squash(&turned, [0.1, 0.2]);
    Route {
        steps: vec![(start, first), (turned, second)],
    }
}

/// The landmarks a petal fold on the preliminary base folds by (`cases.mjs`
/// case 2), in the model frame: the closed point T, the open corner, the
/// side corners, H's ends a tan(π/8)/2 along the closed edges from them,
/// and points to seed the kite precreases at.
pub struct PetalMarks {
    pub t: Point,
    pub open: Point,
    pub sides: [Point; 2],
    pub ends: [Point; 2],
    pub near: [Point; 2],
    pub petal: Point,
}

pub fn petal_marks(mirror: bool) -> PetalMarks {
    let t22 = (std::f64::consts::PI / 8.0).tan() * 0.5;
    let at = |p: Point| m(mirror, p);
    PetalMarks {
        t: at([0.5, 0.5]),
        open: at([0.0, 0.0]),
        sides: [at([0.0, 0.5]), at([0.5, 0.0])],
        ends: [at([t22, 0.5]), at([0.5, t22])],
        near: [at([0.03, 0.44]), at([0.44, 0.03])],
        petal: at([0.26, 0.2]),
    }
}

/// The kite precreases on the flap the viewer sees on top (each through its
/// top layer, which the closure takes with the one hinged to it).
pub fn kites(state: &State, marks: &PetalMarks) -> State {
    let mut s = state.clone();
    for k in 0..2 {
        let at = seen_top(&s, marks.near[k]);
        s = precrease(
            &s,
            marks.open,
            marks.ends[k],
            marks.sides[k],
            Seed::Depth { at, layers: 1 },
        );
    }
    s
}

/// A valley petal fold whose H is the precrease through the marks' ends.
pub fn petal_op(state: &State, marks: &PetalMarks) -> PetalFold {
    PetalFold {
        hinge: PetalHinge::Crease {
            line: line(marks.ends[0], marks.ends[1]),
        },
        petal: seen_top(state, marks.petal),
        direction: Direction::Valley,
    }
}

/// The same petal fold with H through the marks' ends, creased or not.
pub fn petal_points_op(state: &State, marks: &PetalMarks) -> PetalFold {
    PetalFold {
        hinge: PetalHinge::Points {
            from: marks.ends[0],
            to: marks.ends[1],
        },
        ..petal_op(state, marks)
    }
}

/// Spike case 2: the preliminary base, kite creases and H precreased, petal
/// folded; turned over, kite creases again, petal folded: the bird base.
/// The route's steps are the two petal folds.
pub fn bird_base(mirror: bool) -> Route {
    let marks = petal_marks(mirror);
    let base = preliminary(mirror).last().clone();
    let front = kites(&base, &marks);
    let front = precrease(&front, marks.ends[0], marks.ends[1], marks.t, Seed::All);
    let first = landed(front.petal_fold(&petal_op(&front, &marks), &VertexChoices::default()));
    let back = kites(&first.state.turn_over(), &marks);
    let second = landed(back.petal_fold(&petal_op(&back, &marks), &VertexChoices::default()));
    Route {
        steps: vec![(front, first), (back, second)],
    }
}

/// Spike case 2 with H named by its ends and never precreased: the
/// preliminary base petal folded with H through two points, turned over and
/// petal folded the same way. The kite creases are precreased first when
/// `kites_first`; otherwise the folds crease them too. The route's steps are
/// the two petal folds.
pub fn bird_base_points(mirror: bool, kites_first: bool) -> Route {
    let marks = petal_marks(mirror);
    let base = preliminary(mirror).last().clone();
    let front = if kites_first {
        kites(&base, &marks)
    } else {
        base
    };
    let first =
        landed(front.petal_fold(&petal_points_op(&front, &marks), &VertexChoices::default()));
    let turned = first.state.turn_over();
    let back = if kites_first {
        kites(&turned, &marks)
    } else {
        turned
    };
    let second =
        landed(back.petal_fold(&petal_points_op(&back, &marks), &VertexChoices::default()));
    Route {
        steps: vec![(front, first), (back, second)],
    }
}

/// The bird base's H at tan(π/8)/2 along each closed edge from its side
/// corner.
pub fn bird_base_share() -> f64 {
    (std::f64::consts::PI / 8.0).tan() * 0.5
}

/// The preliminary base, nothing precreased, and valley petal folds of its
/// front flap with H through two points `s` along each closed edge from its
/// side corner: one every fortieth of the sheet but the bird base's own, the
/// petal below H off the flap's centre crease.
pub fn petal_sweep() -> (State, Vec<(f64, PetalFold)>) {
    let base = preliminary(false).last().clone();
    let ops = (1..20)
        .map(|k| 0.5 * k as f64 / 20.0)
        .filter(|s| (s - bird_base_share()).abs() > 1e-3)
        .map(|s| {
            let op = PetalFold {
                hinge: PetalHinge::Points {
                    from: [s, 0.5],
                    to: [0.5, s],
                },
                petal: seen_top(&base, [0.55 * s, 0.45 * s]),
                direction: Direction::Valley,
            };
            (s, op)
        })
        .collect();
    (base, ops)
}

/// The incenter and bisector rays of a triangle, with its emergent
/// candidates (degrees from the x axis, rounded).
pub fn candidates_of(state: &State, op: &RabbitEar) -> Vec<(i32, Point)> {
    let analysis = state
        .analyse_rabbit_ear(op)
        .unwrap_or_else(|e| panic!("{e}"));
    analysis
        .candidates
        .iter()
        .map(|&c| {
            (
                (c[1].atan2(c[0]).to_degrees().round() as i32).rem_euclid(360),
                c,
            )
        })
        .collect()
}

/// A rabbit ear case: its parent, the op with its emergent ray unset, and
/// the name the spike gave it.
pub struct EarCase {
    pub name: &'static str,
    pub state: State,
    pub op: RabbitEar,
}

fn ear(state: &State, corners: [Point; 3], layers: Seed, stayer_at: Point) -> RabbitEar {
    RabbitEar {
        corners,
        emergent: [1.0, 0.0],
        layers,
        stayer: seen_bottom(state, stayer_at),
        direction: Direction::Valley,
    }
}

/// The spike's cases 3a–3e: a two-layer triangle through both layers and
/// the top one; Beloch's incenter ear on the flat square; the fish base's
/// first ear; an ear on a kite flap.
pub fn ear_cases() -> Vec<EarCase> {
    let tri = valley(&square(), [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]);
    let triangle = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]];
    let top = seen_top(&tri, [0.3, 0.3]);
    let flat = precrease(&square(), [0.0, 0.0], [1.0, 1.0], [0.0, 1.0], Seed::All);
    let fish = precrease(&square(), [1.0, 0.0], [0.0, 1.0], [1.0, 1.0], Seed::All);
    let tq = (std::f64::consts::PI / 8.0).tan();
    let kite = precrease(&square(), [0.0, 0.0], [1.0, 1.0], [1.0, 0.0], Seed::All);
    let kite = valley(&kite, [0.0, 0.0], [1.0, tq], [1.0, 0.0]);
    let kite = valley(&kite, [0.0, 0.0], [tq, 1.0], [0.0, 1.0]);
    let kite_corners = [
        [0.0, 0.0],
        [1.0, tq],
        [
            std::f64::consts::FRAC_1_SQRT_2,
            std::f64::consts::FRAC_1_SQRT_2,
        ],
    ];
    let incenter = oristudio_fold::incenter(&kite_corners).unwrap_or_default();
    let flap = seen_top(&kite, incenter);
    vec![
        EarCase {
            name: "3a both layers",
            op: ear(&tri, triangle, Seed::All, [0.6, 0.35]),
            state: tri.clone(),
        },
        EarCase {
            name: "3b top layer",
            op: ear(
                &tri,
                triangle,
                Seed::Depth { at: top, layers: 1 },
                [0.6, 0.35],
            ),
            state: tri,
        },
        EarCase {
            name: "3c flat square",
            op: ear(
                &flat,
                [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]],
                Seed::Flaps {
                    at: vec![[0.8, 0.2]],
                },
                [0.2, 0.8],
            ),
            state: flat,
        },
        EarCase {
            name: "3d fish ear 1",
            op: ear(
                &fish,
                triangle,
                Seed::Flaps {
                    at: vec![[0.2, 0.2]],
                },
                [0.6, 0.6],
            ),
            state: fish,
        },
        EarCase {
            name: "3e kite flap",
            op: ear(
                &kite,
                kite_corners,
                Seed::Flaps { at: vec![flap] },
                [0.55, 0.27],
            ),
            state: kite,
        },
    ]
}

/// Cases 3a–3d folded the other way: a mountain ear through both layers of
/// the two-layer triangle, through its bottom layer alone (the layer
/// nearest the mountain's side, as the top one is a valley's), and on the
/// flat square and the fish base, the paper that stays seen from the other
/// side.
pub fn mountain_ear_cases() -> Vec<EarCase> {
    let tri = valley(&square(), [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]);
    let ear = |state: &State, layers: Seed| RabbitEar {
        corners: [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
        emergent: [1.0, 0.0],
        layers,
        stayer: seen_top(state, [0.6, 0.35]),
        direction: Direction::Mountain,
    };
    let bottom = seen_bottom(&tri, [0.3, 0.3]);
    let mut out = vec![
        EarCase {
            name: "3a both layers, mountain",
            op: ear(&tri, Seed::All),
            state: tri.clone(),
        },
        EarCase {
            name: "3b bottom layer, mountain",
            op: ear(
                &tri,
                Seed::Depth {
                    at: bottom,
                    layers: 1,
                },
            ),
            state: tri,
        },
    ];
    for valley in ear_cases() {
        let name = match valley.name {
            "3c flat square" => "3c flat square, mountain",
            "3d fish ear 1" => "3d fish ear 1, mountain",
            _ => continue,
        };
        out.push(EarCase {
            name,
            op: RabbitEar {
                direction: Direction::Mountain,
                ..valley.op
            },
            state: valley.state,
        });
    }
    out
}

/// Spike case 3f: a free four-ray vertex on the flat square (Beloch's
/// swivel-rabbit), its emergent ray unset.
pub fn swivel_case() -> (State, Swivel) {
    let h = 0.6;
    (
        square(),
        Swivel {
            vertex: [0.5, h / 2.0],
            toward: [[1.0, h], [0.0, h], [0.5, 0.0]],
            emergent: [1.0, 0.0],
            layers: Seed::All,
            stayer: [0.3, 0.9],
            direction: Direction::Valley,
        },
    )
}

// --- The swivel by its edge (`compound::swivel`) ----------------------------

use oristudio_fold::{SwivelByEdge, SwivelKind};

/// A swivel by its edge: its parent, the op, and the sheet segment of the
/// edge it names (its straight run).
pub struct EdgeSwivelCase {
    pub name: &'static str,
    pub state: State,
    pub op: SwivelByEdge,
    pub edge: [Point; 2],
}

/// The rabbit ear's inradius on a right isosceles triangle with legs 1.
pub fn inradius() -> f64 {
    (2.0 - std::f64::consts::SQRT_2) / 2.0
}

/// A valley swivel by its edge through every layer at its vertex.
pub fn by_edge(pivot: Point, edge: Point, target: Line) -> SwivelByEdge {
    SwivelByEdge {
        pivot,
        edge,
        target,
        layers: Seed::All,
        ridge: None,
        direction: Direction::Valley,
        fold: None,
        kind: SwivelKind::Open,
    }
}

/// The flat square with its diagonal a c (0, 0)–(1, 1) precreased: a centre
/// crease to swivel an edge onto.
pub fn diagonal_square() -> State {
    precrease(&square(), [0.0, 0.0], [1.0, 1.0], [0.0, 1.0], Seed::All)
}

/// The flat square with b d (1, 0)–(0, 1) precreased: the fish base's.
pub fn fish_square() -> State {
    precrease(&square(), [1.0, 0.0], [0.0, 1.0], [1.0, 1.0], Seed::All)
}

/// The fish base's second swivel, on the state its first landed: the top
/// edge onto b d, pivoting at the upper triangle's incenter, through the
/// upper triangle's layer (as spike case 3d's second ear).
pub fn fish_second() -> SwivelByEdge {
    let r = inradius();
    SwivelByEdge {
        layers: Seed::Flaps {
            at: vec![[0.8, 0.8]],
        },
        ..by_edge([1.0 - r, 1.0 - r], [0.5, 1.0], line([1.0, 0.0], [0.0, 1.0]))
    }
}

/// The classic swivels by their edge (the module docs of
/// `compound::swivel`), each through every layer at its vertex:
///
/// - **the rabbit ear** at the incenter of the flat square's half a b c,
///   the bottom edge onto the diagonal (spike case 3c's 270° ear);
/// - **the fish base's first ear**, the left edge onto b d at the incenter
///   of a b d (case 3d's 180° ear; [`fish_second`] is the second);
/// - **the bottom edge onto the centre crease** off the incenter, past it
///   along the bisector at x = 0.8: a swivel that is no rabbit ear;
/// - **a two-layer flap**: the square folded on b d, its raw bottom edge
///   onto the folded edge b d off the incenter;
/// - **a folded edge onto a raw one**: that flap's folded edge b d onto its
///   bottom edge's line;
/// - **the flat square at Beloch's `swivel-rabbit` pivot** (0.5, 0.3), the
///   bottom edge onto where Beloch's swivel lands it: the reflection of a b
///   across the hinge from b — the edge form computes its hinge up the
///   spine where Beloch's runs free.
pub fn edge_swivel_cases() -> Vec<EdgeSwivelCase> {
    let r = inradius();
    let t22 = (std::f64::consts::PI / 8.0).tan();
    let diagonal = line([0.0, 0.0], [1.0, 1.0]);
    let bd = line([1.0, 0.0], [0.0, 1.0]);
    let ab = line([0.0, 0.0], [1.0, 0.0]);
    let bottom = [[0.0, 0.0], [1.0, 0.0]];
    let tri = valley(&square(), [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]);
    let hinge_b = line([1.0, 0.0], [0.0, 0.6]);
    let beloch_target = hinge_b
        .reflect_line(&ab)
        .unwrap_or_else(|| panic!("no reflection"));
    vec![
        EdgeSwivelCase {
            name: "rabbit ear on the diagonal",
            state: diagonal_square(),
            op: by_edge([1.0 - r, r], [0.5, 0.0], diagonal),
            edge: bottom,
        },
        EdgeSwivelCase {
            name: "fish ear 1",
            state: fish_square(),
            op: by_edge([r, r], [0.0, 0.5], bd),
            edge: [[0.0, 0.0], [0.0, 1.0]],
        },
        EdgeSwivelCase {
            name: "bottom edge onto the centre crease",
            state: diagonal_square(),
            op: by_edge([0.8, 0.8 * t22], [0.5, 0.0], diagonal),
            edge: bottom,
        },
        EdgeSwivelCase {
            name: "two-layer flap",
            op: by_edge([0.15, 0.15], [0.5, 0.0], bd),
            state: tri.clone(),
            edge: bottom,
        },
        EdgeSwivelCase {
            name: "folded edge onto a raw one",
            op: by_edge([0.4, 0.2], [0.5, 0.5], ab),
            state: tri,
            edge: [[1.0, 0.0], [0.0, 1.0]],
        },
        EdgeSwivelCase {
            name: "at Beloch's swivel-rabbit pivot",
            state: square(),
            op: by_edge([0.5, 0.3], [0.5, 0.0], beloch_target),
            edge: bottom,
        },
    ]
}

// --- The swivel on a folded edge (`compound::swivel_on_edge`) ---------------

use oristudio_fold::{ReverseChoices, ReverseFold, ReverseKind, ReverseOutcome};

/// An inside reverse fold of every layer along `p q`, the tip on `toward`'s
/// side.
pub fn inside_reverse(state: &State, p: Point, q: Point, toward: Point) -> State {
    let l = line(p, q);
    let op = ReverseFold {
        line: l,
        side: side(&l, toward),
        anchor: Seed::All,
        kind: ReverseKind::Inside,
    };
    match state.reverse_fold(&op, &ReverseChoices::default()) {
        Ok(ReverseOutcome::Landed(folded)) => folded.state,
        Ok(_) => panic!("the reverse fold leaves a choice"),
        Err(e) => panic!("{e:?}"),
    }
}

/// tan(π/8): where a corner's bisector crosses the square's far edge.
pub fn t22() -> f64 {
    (std::f64::consts::PI / 8.0).tan()
}

/// The owner's `squash.osf` (the swivel-on-edge example's start), folded
/// through the engine: the square valley-folded on b d, a c precreased, the
/// two inside reverses that make the preliminary base (its closed point the
/// sheet's centre, its open corner the four corners), turned 1/8 of a turn
/// counter-clockwise so the open corner points down, and the front flap on
/// the right squashed into a kite.
pub fn abrashi_squash() -> State {
    let s = valley(&square(), [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]);
    let s = precrease(&s, [0.0, 0.0], [1.0, 1.0], [1.0, 0.0], Seed::All);
    let s = inside_reverse(&s, [0.5, 0.0], [0.5, 1.0], [1.0, 0.2]);
    let s = inside_reverse(&s, [0.0, 0.5], [1.0, 0.5], [0.2, 1.0]);
    let s = s.rotate(std::f64::consts::FRAC_PI_4);
    landed(s.squash(
        &Squash {
            flap: [0.8521078475219173, 0.5697560410122267],
            target: None,
            direction: Direction::Valley,
            hinge: None,
        },
        &VertexChoices::default(),
    ))
    .state
}

/// A swivel on a folded edge: its parent, the op (valley), the sheet
/// segment of the edge it names and of the folded edge its creases meet on.
pub struct FoldSwivelCase {
    pub name: &'static str,
    pub state: State,
    pub op: SwivelByEdge,
    pub edge: [Point; 2],
    pub fold: [Point; 2],
}

/// A valley swivel whose creases meet on the folded crease through the
/// sheet point `fold`, laying the edge through the sheet point `edge` on
/// the line of the crease through the sheet point `onto`.
pub fn on_fold(state: &State, fold: Point, edge: Point, onto: Point) -> SwivelByEdge {
    let target = state
        .crease_at(onto)
        .and_then(|c| state.crease_line(c.id))
        .unwrap_or_else(|| panic!("no crease at {onto:?}"));
    SwivelByEdge {
        pivot: state
            .resolve_point(fold)
            .unwrap_or_else(|| panic!("{fold:?} is off the paper")),
        edge,
        target,
        layers: Seed::All,
        ridge: None,
        direction: Direction::Valley,
        fold: Some(fold),
        kind: SwivelKind::Open,
    }
}

/// The kite base: a c precreased, then the bottom and left edges valley
/// folded onto it, their flaps hinged on the kite creases a q₁ and a q₂
/// (q₁ = (1, tan π/8), q₂ = (tan π/8, 1)).
pub fn kite_base() -> State {
    let t = t22();
    let s = precrease(&square(), [0.0, 0.0], [1.0, 1.0], [1.0, 0.0], Seed::All);
    let s = valley(&s, [0.0, 0.0], [1.0, t], [1.0, 0.0]);
    valley(&s, [0.0, 0.0], [t, 1.0], [0.0, 1.0])
}

/// The classic swivels on a folded edge (the module docs of
/// `compound::swivel_on_edge`):
///
/// - **Abrashi's "What is Swivel fold?"** on the owner's squashed
///   preliminary base ([`abrashi_squash`]): the kite's lower-left edge onto
///   the centre line, the creases meeting on its upper-left (folded) edge:
///   the swivel turns about the bottom tip, the top layer folds up along the
///   line to the kite's right corner;
/// - **the kite base narrowed at c**: the right edge's part q₁ c onto the
///   diagonal a c, its creases meeting on the kite crease a q₁ where the
///   bisector from c crosses it, the flap over it folding across the
///   diagonal; and the same on the other side (q₂ c, on a q₂).
pub fn fold_swivel_cases() -> Vec<FoldSwivelCase> {
    let t = t22();
    let squashed = abrashi_squash();
    let h = 1.0 / std::f64::consts::SQRT_2;
    let kite = kite_base();
    vec![
        FoldSwivelCase {
            name: "Abrashi's swivel",
            op: on_fold(
                &squashed,
                [0.75, (0.5 + h) / 2.0],
                [1.0, (h + 1.0) / 2.0],
                [0.75, 0.5],
            ),
            state: squashed,
            edge: [[1.0, h], [1.0, 1.0]],
            fold: [[0.5, 0.5], [1.0, h]],
        },
        FoldSwivelCase {
            name: "kite narrowed at c, right",
            op: on_fold(&kite, [0.5, t / 2.0], [1.0, (t + 1.0) / 2.0], [0.5, 0.5]),
            state: kite.clone(),
            edge: [[1.0, t], [1.0, 1.0]],
            fold: [[0.0, 0.0], [1.0, t]],
        },
        FoldSwivelCase {
            name: "kite narrowed at c, left",
            op: on_fold(&kite, [t / 2.0, 0.5], [(t + 1.0) / 2.0, 1.0], [0.5, 0.5]),
            state: kite,
            edge: [[t, 1.0], [1.0, 1.0]],
            fold: [[0.0, 0.0], [t, 1.0]],
        },
    ]
}
