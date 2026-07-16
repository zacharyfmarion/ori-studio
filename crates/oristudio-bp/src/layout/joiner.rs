use super::LayoutRepository;
use super::pattern::{PatternGadget, PatternPiece};
use crate::error::{BpError, BpResult};
use crate::math::BpFraction;
use crate::math::geometry::{
    Line, PathPoint, Point as ExactPoint, Vector as ExactVector, is_inside, triangle_transform,
};
use crate::math::gops::{JsonPiece, generate as generate_gops};
use crate::model::{AddOn, Anchor, Device, Gadget, Junction, Overlap, Piece, Point, Strategy};
use crate::shared::{QuadrantDirection, opposite};
use crate::tree::BpTree;
use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq)]
pub struct Joiner {
    g1: Vec<Piece>,
    g2: Vec<Piece>,
    s1: Option<Point>,
    s2: Option<Point>,
    oriented: bool,
    is_clockwise: bool,
    intersection_dist: f64,
    q1: QuadrantDirection,
    q2: QuadrantDirection,
    w1: f64,
    w2: f64,
    q: QuadrantDirection,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Joinee {
    pub p: PatternPiece,
    pub e: Line,
    offset: Point,
    v: ExactVector,
    pt: Point,
    anchors: Vec<Option<Anchor>>,
}

impl Joinee {
    pub fn new(
        p: PatternPiece,
        offset: Point,
        anchors: Vec<Option<Anchor>>,
        pt: &ExactPoint,
        q: QuadrantDirection,
        additional_offset: Option<ExactVector>,
    ) -> BpResult<Self> {
        let additional_offset = additional_offset.unwrap_or(ExactVector::ZERO);
        let v = add_vectors(&exact_vector(offset)?, &additional_offset).negated();
        let pt = exact_point_to_json(&pt.add_vector(&v));
        let e = p
            .shape()?
            .ridges
            .get(q as usize)
            .ok_or_else(|| BpError::InvalidInput("joinee ridge is missing".to_string()))?
            .add(&additional_offset);
        Ok(Self {
            p,
            e,
            offset,
            v,
            pt,
            anchors,
        })
    }

    pub fn setup_detour(&mut self, raw_detour: &[ExactPoint], reverse: bool) {
        let mut detour = raw_detour
            .iter()
            .map(|point| exact_point_to_json(&point.add_vector(&self.v)))
            .collect::<Vec<_>>();
        detour.push(self.pt);
        if reverse {
            detour.reverse();
        }
        self.p.clear_detour();
        self.p.add_detour(detour);
    }

    pub fn contains(&self, point: &ExactPoint) -> BpResult<bool> {
        let point = exact_point_to_path_point(&point.add_vector(&self.v));
        Ok(is_inside(
            point,
            &exact_path_to_path_points(&self.p.original_contour()?),
        ))
    }

    pub fn to_gadget(
        &self,
        should_clone: bool,
        oriented: bool,
        offset: Option<Point>,
    ) -> BpResult<Gadget> {
        let _ = should_clone;
        let mut gadget_offset = self.offset;
        if let Some(offset) = offset {
            gadget_offset = Point {
                x: gadget_offset.x + offset.x,
                y: gadget_offset.y + offset.y,
            };
        }
        let gadget_offset =
            (gadget_offset.x != 0.0 || gadget_offset.y != 0.0).then_some(gadget_offset);
        let mut result = PatternGadget::new(Gadget {
            pieces: vec![self.p.to_json()],
            offset: gadget_offset,
            anchors: Some(self.anchors.clone()),
        });
        for q in [QuadrantDirection::Ul, QuadrantDirection::Lr] {
            let point = &result.anchor_map()?[q as usize].point;
            if !point.is_integral() {
                let x = point.x.value();
                let fractional_part = x - x.floor();
                let slack = if oriented {
                    1.0 - fractional_part
                } else {
                    fractional_part
                };
                result.add_slack(q, slack);
            }
        }
        Ok(result.to_json())
    }

    pub fn is_steeper_than(&self, that: &Self) -> BpResult<bool> {
        Ok(self
            .p
            .direction()?
            .slope()?
            .gt(&that.p.direction()?.slope()?))
    }

    pub fn setup_anchor(&mut self, upper_left: bool, anchor: &ExactPoint) {
        let q = if upper_left {
            QuadrantDirection::Ul
        } else {
            QuadrantDirection::Lr
        };
        set_anchor(
            &mut self.anchors,
            q,
            Anchor {
                slack: None,
                location: Some(exact_point_to_json(&anchor.add_vector(&self.v))),
            },
        );
    }
}

#[derive(Debug)]
pub struct JoineeBuilder<'a> {
    p: PatternPiece,
    q: QuadrantDirection,
    joiner: &'a Joiner,
    anchors: Vec<Option<Anchor>>,
    offset: Point,
    additional_offset: Option<ExactVector>,
}

#[derive(Debug, Clone, PartialEq)]
struct JoinData {
    size: f64,
    offset: Option<Point>,
    pt: ExactPoint,
    bv: ExactVector,
    org: ExactPoint,
    add_ons: Option<Vec<AddOn>>,
}

#[derive(Debug, Clone, PartialEq)]
struct JoinLogic<'a> {
    joiner: &'a Joiner,
    data: JoinData,
    j1: Joinee,
    j2: Joinee,
    f: i8,
}

type JoinResult = (Device, f64);

impl<'a> JoineeBuilder<'a> {
    pub fn new(p: PatternPiece, q: QuadrantDirection, joiner: &'a Joiner) -> Self {
        Self {
            p,
            q,
            joiner,
            anchors: Vec::new(),
            offset: Point { x: 0.0, y: 0.0 },
            additional_offset: None,
        }
    }

    pub fn setup(
        &mut self,
        that: &mut Self,
        f: i8,
        shift: Point,
        sx: f64,
    ) -> BpResult<Option<f64>> {
        let Some(intersection) =
            self.joiner
                .relay_join_intersection(&that.p, shift, opposite(self.q))?
        else {
            return Ok(None);
        };
        if !intersection.is_integral() {
            return Ok(None);
        }

        let int = exact_point_to_json(&intersection);
        let rx = if self.joiner.oriented {
            int.x
        } else {
            that.p.sx() - int.x
        };
        if self.p.sx() + rx > sx {
            return Ok(None);
        }

        if self.joiner.oriented {
            self.offset = int;
            self.p.set_offset(int);
            set_anchor(
                &mut self.anchors,
                self.joiner.q,
                Anchor {
                    slack: None,
                    location: Some(Point {
                        x: -int.x,
                        y: -int.y,
                    }),
                },
            );
            Ok(Some(int.x))
        } else {
            let f = f as f64;
            let offset = Point {
                x: f * (that.p.sx() - int.x),
                y: f * (that.p.sy() - int.y),
            };
            if f == 1.0 {
                that.offset = offset;
                that.p.set_offset(offset);
            } else {
                self.offset = offset;
                self.p.set_offset(offset);
            }
            set_anchor(
                &mut self.anchors,
                self.joiner.q,
                Anchor {
                    slack: None,
                    location: Some(Point {
                        x: self.p.sx() + f * offset.x,
                        y: self.p.sy() + f * offset.y,
                    }),
                },
            );
            Ok(Some(f * offset.x))
        }
    }

    pub fn set_additional_offset(&mut self, offset: Point) -> BpResult<()> {
        self.additional_offset = Some(exact_vector(offset)?);
        Ok(())
    }

    pub fn anchor(&self) -> BpResult<ExactPoint> {
        let anchors = self.p.anchors()?;
        let mut anchor = anchors[self.joiner.q as usize]
            .clone()
            .ok_or_else(|| BpError::InvalidInput("joinee builder anchor is missing".to_string()))?;
        if let Some(additional_offset) = &self.additional_offset {
            anchor = anchor.add_vector(additional_offset);
        }
        Ok(anchor)
    }

    pub fn j_anchor(&self) -> BpResult<ExactPoint> {
        self.anchors
            .get(self.joiner.q as usize)
            .and_then(Option::as_ref)
            .and_then(|anchor| anchor.location)
            .ok_or_else(|| {
                BpError::InvalidInput("joinee builder join anchor is missing".to_string())
            })
            .and_then(exact_point)
    }

    pub fn build(self, pt: &ExactPoint) -> BpResult<Joinee> {
        Joinee::new(
            self.p,
            self.offset,
            self.anchors,
            pt,
            self.q,
            self.additional_offset,
        )
    }
}

impl<'a> JoinLogic<'a> {
    fn new(joiner: &'a Joiner, p1: PatternPiece, p2: PatternPiece) -> BpResult<Option<Self>> {
        let p1_json = p1.to_json();
        let p2_json = p2.to_json();
        let p1_sx = p1.sx();
        let p1_sy = p1.sy();
        let p2_sx = p2.sx();
        let p2_sy = p2.sy();
        let mut size = p1.sx() + p2.sx();
        let mut builder1 = JoineeBuilder::new(p1, joiner.q1, joiner);
        let mut builder2 = JoineeBuilder::new(p2, joiner.q2, joiner);

        if let Some(s1) = joiner.s1 {
            let Some(dx) = builder1.setup(&mut builder2, 1, s1, joiner.w1)? else {
                return Ok(None);
            };
            size += dx;
        }
        if let Some(s2) = joiner.s2 {
            let Some(dx) = builder2.setup(&mut builder1, -1, s2, joiner.w2)? else {
                return Ok(None);
            };
            size += dx;
        }

        let mut offset = None;
        if !joiner.oriented {
            let additional = Point {
                x: p1_sx - p2_sx,
                y: p1_sy - p2_sy,
            };
            builder2.set_additional_offset(additional)?;
            offset = Some(additional);
        }

        let pt = if joiner.s1.is_some() {
            builder1.anchor()?
        } else {
            builder2.anchor()?
        };
        let bv = ExactVector::from_numbers(
            p1_json.ox * p2_json.u + p2_json.ox * p1_json.u + 2.0 * p1_json.u * p2_json.u,
            p1_json.ox * p2_json.ox + p1_json.ox * p2_json.u + p2_json.ox * p1_json.u,
        )?;
        let f = if joiner.oriented { 1 } else { -1 };
        let org = if joiner.oriented {
            ExactPoint::ZERO
        } else if joiner.s1.is_some() {
            builder1.j_anchor()?
        } else {
            builder1.anchor()?
        };
        let j1 = builder1.build(&pt)?;
        let j2 = builder2.build(&pt)?;

        Ok(Some(Self {
            joiner,
            data: JoinData {
                size,
                offset,
                pt,
                bv,
                org,
                add_ons: None,
            },
            j1,
            j2,
            f,
        }))
    }

    fn delta_pt(&self) -> BpResult<ExactPoint> {
        let f = self.f as f64;
        let org = exact_point_to_json(&self.data.org);
        let j1 = self.j1.p.to_json();
        let j2 = self.j2.p.to_json();
        ExactPoint::from_numbers(
            org.x
                + (self.joiner.intersection_dist
                    - if self.joiner.is_clockwise {
                        j2.ox
                    } else {
                        j1.ox
                    })
                    * f,
            org.y
                + (self.joiner.intersection_dist
                    - if self.joiner.is_clockwise {
                        j1.oy
                    } else {
                        j2.oy
                    })
                    * f,
        )
    }

    fn base_join_intersections(&self) -> BpResult<BaseJoinContext> {
        let delta_pt = self.delta_pt()?;
        let delta =
            Line::from_point_vector(delta_pt.clone(), &quadrant_vector(QuadrantDirection::Ur));
        Ok(BaseJoinContext {
            d1: self.j1.e.intersection(
                &delta_pt,
                &quadrant_vector(QuadrantDirection::Ur),
                false,
                false,
            ),
            d2: self.j2.e.intersection(
                &delta_pt,
                &quadrant_vector(QuadrantDirection::Ur),
                false,
                false,
            ),
            b1: self
                .j1
                .e
                .intersection(&self.data.pt, &self.data.bv, false, false),
            b2: self
                .j2
                .e
                .intersection(&self.data.pt, &self.data.bv, false, false),
            delta,
        })
    }

    fn setup_detour(&mut self, dt1: &[ExactPoint], dt2: &[ExactPoint]) {
        let should_reverse = self.joiner.is_clockwise;
        self.j1.setup_detour(dt1, !should_reverse);
        self.j2.setup_detour(dt2, should_reverse);
    }

    fn setup_anchor(&mut self, anchor: &ExactPoint) -> BpResult<bool> {
        let f = self.f as f64;
        if anchor.x.value() * f > self.delta_pt()?.x.value() * f {
            return Ok(false);
        }
        self.j1
            .setup_anchor(self.joiner.oriented != self.joiner.is_clockwise, anchor);
        self.j2
            .setup_anchor(self.joiner.oriented == self.joiner.is_clockwise, anchor);
        Ok(true)
    }

    fn result(&mut self, should_clone: bool, extra_size: f64) -> BpResult<JoinResult> {
        let add_ons = self.data.add_ons.take();
        let g1 = self
            .j1
            .to_gadget(should_clone, self.joiner.oriented, None)?;
        let g2 = self
            .j2
            .to_gadget(should_clone, self.joiner.oriented, self.data.offset)?;
        Ok((
            Device {
                gadgets: vec![g1, g2],
                offset: None,
                add_ons,
            },
            self.data.size + extra_size * 10.0,
        ))
    }
}

#[derive(Debug, Clone, PartialEq)]
struct BaseJoinContext {
    d1: Option<ExactPoint>,
    d2: Option<ExactPoint>,
    b1: Option<ExactPoint>,
    b2: Option<ExactPoint>,
    delta: Line,
}

impl Joiner {
    pub fn new(
        overlaps: &[Overlap],
        repo: &mut LayoutRepository,
        tree: &BpTree,
    ) -> BpResult<Option<Self>> {
        if overlaps.len() < 2 {
            return Err(BpError::InvalidInput(
                "joiner requires two overlaps".to_string(),
            ));
        }
        let o1 = &overlaps[0];
        let o2 = &overlaps[1];
        if o1.ox == o2.ox || o1.oy == o2.oy {
            return Ok(None);
        }

        let j1 = repo.junctions.get(o1.parent).cloned().ok_or_else(|| {
            BpError::InvalidInput(format!("missing joiner junction {}", o1.parent))
        })?;
        let j2 = repo.junctions.get(o2.parent).cloned().ok_or_else(|| {
            BpError::InvalidInput(format!("missing joiner junction {}", o2.parent))
        })?;
        let g1 = generate_pieces(o1, &j1)?;
        let g2 = generate_pieces(o2, &j2)?;
        let oriented =
            j1.c.first().and_then(|corner| corner.e) == j2.c.first().and_then(|corner| corner.e);
        let is_clockwise = o1.ox > o2.ox;
        let q = if oriented {
            QuadrantDirection::Ur
        } else {
            QuadrantDirection::Ll
        };
        let [q1, q2] = quadrant_combination(oriented, is_clockwise);
        let intersection_dist = repo.get_max_intersection_distance(tree, &j1, &j2, oriented)?;
        let (s1, s2) = if oriented {
            (o1.shift, o2.shift)
        } else {
            (reverse_shift(o1, &j1), reverse_shift(o2, &j2))
        };

        Ok(Some(Self {
            g1,
            g2,
            s1,
            s2,
            oriented,
            is_clockwise,
            intersection_dist,
            q1,
            q2,
            w1: j1.sx,
            w2: j2.sx,
            q,
        }))
    }

    pub fn pieces(&self) -> (&[Piece], &[Piece]) {
        (&self.g1, &self.g2)
    }

    pub fn shifts(&self) -> (Option<Point>, Option<Point>) {
        (self.s1, self.s2)
    }

    pub fn oriented(&self) -> bool {
        self.oriented
    }

    pub fn is_clockwise(&self) -> bool {
        self.is_clockwise
    }

    pub fn intersection_dist(&self) -> f64 {
        self.intersection_dist
    }

    pub fn quadrant_pair(&self) -> [QuadrantDirection; 2] {
        [self.q1, self.q2]
    }

    pub fn widths(&self) -> [f64; 2] {
        [self.w1, self.w2]
    }

    pub fn shared_quadrant(&self) -> QuadrantDirection {
        self.q
    }

    pub fn simple_join(&self, strategy: Option<Strategy>) -> BpResult<Vec<Device>> {
        self.join(
            |p1, p2| {
                let parallel = p1.direction()?.parallel(&p2.direction()?);
                if strategy == Some(Strategy::Perfect) && !parallel {
                    return Ok(false);
                }
                if (self.s1.is_some() || self.s2.is_some()) && parallel {
                    return Ok(false);
                }
                Ok(true)
            },
            simple_join_logic,
        )
    }

    pub fn base_join(&self) -> BpResult<Vec<Device>> {
        self.join(|_, _| Ok(true), base_join_logic)
    }

    pub fn standard_join(&self) -> BpResult<Vec<Device>> {
        let shift = self.s1.is_some() || self.s2.is_some();
        let mut counter = 0usize;
        self.join(
            |_, _| {
                if shift {
                    Ok(true)
                } else {
                    let ok = counter == 0;
                    counter += 1;
                    Ok(ok)
                }
            },
            standard_join_logic,
        )
    }

    pub fn relay_join_intersection(
        &self,
        piece: &PatternPiece,
        shift: Point,
        q: QuadrantDirection,
    ) -> BpResult<Option<ExactPoint>> {
        let test_vector = if self.oriented {
            quadrant_vector(QuadrantDirection::Ur)
        } else {
            quadrant_vector(QuadrantDirection::Ll)
        };
        let anchors = piece.anchors()?;
        let anchor = anchors[self.q as usize]
            .clone()
            .ok_or_else(|| BpError::InvalidInput("piece has no shared anchor".to_string()))?;
        let shift = ExactVector::from_numbers(shift.x, shift.y)?;
        let point = anchor.sub_vector(&shift);
        let shape = piece.shape()?;
        let ridge = shape
            .ridges
            .get(q as usize)
            .ok_or_else(|| BpError::InvalidInput("piece ridge is missing".to_string()))?;
        Ok(ridge.intersection(&point, &test_vector, false, false))
    }

    fn join(
        &self,
        mut precondition: impl FnMut(&PatternPiece, &PatternPiece) -> BpResult<bool>,
        mut logic: impl FnMut(JoinLogic<'_>) -> BpResult<Vec<JoinResult>>,
    ) -> BpResult<Vec<Device>> {
        let mut result = Vec::new();
        for p1 in &self.g1 {
            for p2 in &self.g2 {
                let p1 = PatternPiece::new(p1.clone());
                let p2 = PatternPiece::new(p2.clone());
                if !precondition(&p1, &p2)? {
                    continue;
                }
                if let Some(join_logic) = JoinLogic::new(self, p1, p2)? {
                    result.extend(logic(join_logic)?);
                }
            }
        }
        result.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal));
        Ok(result.into_iter().map(|(device, _)| device).collect())
    }
}

fn simple_join_logic(mut logic: JoinLogic<'_>) -> BpResult<Vec<JoinResult>> {
    let mut result = Vec::new();
    let Some(intersection) = logic.j1.e.intersect_line(&logic.j2.e, true) else {
        return Ok(result);
    };
    if !intersection
        .sub_point(&logic.data.pt)
        .parallel(&logic.data.bv)
    {
        return Ok(result);
    }
    if !logic.setup_anchor(&intersection)? {
        return Ok(result);
    }
    logic.setup_detour(
        std::slice::from_ref(&intersection),
        std::slice::from_ref(&intersection),
    );
    result.push(logic.result(false, 0.0)?);
    Ok(result)
}

fn base_join_logic(logic: JoinLogic<'_>) -> BpResult<Vec<JoinResult>> {
    let context = logic.base_join_intersections()?;
    let mut result = Vec::new();
    if let Some(join) = try_base_join(
        logic.clone(),
        context.b1.clone(),
        context.d2.clone(),
        true,
        true,
    )? {
        result.push(join);
    }
    if let Some(join) = try_base_join(logic, context.b2, context.d1, false, false)? {
        result.push(join);
    }
    Ok(result)
}

fn try_base_join(
    mut logic: JoinLogic<'_>,
    b: Option<ExactPoint>,
    d: Option<ExactPoint>,
    d_in_second: bool,
    should_clone: bool,
) -> BpResult<Option<JoinResult>> {
    let (Some(b), Some(d)) = (b, d) else {
        return Ok(None);
    };
    if !b.is_integral() || !d.is_integral() || b.equals(&d) {
        return Ok(None);
    }
    if d.x.value() * (logic.f as f64) > b.x.value() * (logic.f as f64)
        && logic.joiner.is_clockwise != logic.j1.is_steeper_than(&logic.j2)?
    {
        return Ok(None);
    }
    if !logic.setup_anchor(&d)? {
        return Ok(None);
    }
    if d_in_second {
        logic.setup_detour(std::slice::from_ref(&b), &[d, b.clone()]);
    } else {
        logic.setup_detour(&[d, b.clone()], std::slice::from_ref(&b));
    }
    Ok(Some(logic.result(should_clone, 0.0)?))
}

fn standard_join_logic(logic: JoinLogic<'_>) -> BpResult<Vec<JoinResult>> {
    let context = logic.base_join_intersections()?;
    let mut result = Vec::new();
    if let (Some(b1), Some(d2)) = (context.b1.clone(), context.d2.clone())
        && !b1.equals(&d2)
    {
        if d2.x.value() * (logic.f as f64) > b1.x.value() * (logic.f as f64) {
            result.extend(convex_standard_join(logic.clone(), b1, d2, 0)?);
        } else {
            result.extend(concave_standard_join(
                logic.clone(),
                b1,
                d2,
                1,
                &context.delta,
            )?);
        }
    }
    if let (Some(b2), Some(d1)) = (context.b2, context.d1)
        && !b2.equals(&d1)
    {
        if d1.x.value() * (logic.f as f64) > b2.x.value() * (logic.f as f64) {
            result.extend(convex_standard_join(logic, b2, d1, 1)?);
        } else {
            result.extend(concave_standard_join(logic, b2, d1, 0, &context.delta)?);
        }
    }
    Ok(result)
}

fn convex_standard_join(
    mut logic: JoinLogic<'_>,
    b: ExactPoint,
    d: ExactPoint,
    index: usize,
) -> BpResult<Vec<JoinResult>> {
    if b.is_integral() {
        return Ok(Vec::new());
    }
    if logic.joiner.is_clockwise != logic.j1.is_steeper_than(&logic.j2)? {
        return Ok(Vec::new());
    }
    if !logic.setup_anchor(&d)? {
        return Ok(Vec::new());
    }

    let Some((t, r)) = try_convex_transform(&logic, &b, &d, index)? else {
        return Ok(Vec::new());
    };
    let dir = if index == 1 {
        Line::new(t.clone(), r.clone()).reflect(&logic.j2.p.direction()?)?
    } else {
        Line::new(t.clone(), r.clone()).reflect(&logic.j1.p.direction()?)?
    };
    logic.data.add_ons = Some(vec![AddOn {
        contour: vec![
            exact_point_to_json(&d),
            exact_point_to_json(&t),
            exact_point_to_json(&r),
        ],
        dir: exact_vector_to_json(&dir),
    }]);
    if index == 1 {
        logic.setup_detour(&[d.clone(), r.clone()], &[t.clone(), r.clone()]);
    } else {
        logic.setup_detour(&[t.clone(), r.clone()], &[d.clone(), r.clone()]);
    }
    Ok(vec![logic.result(true, r.dist(&t))?])
}

fn try_convex_transform(
    logic: &JoinLogic<'_>,
    b: &ExactPoint,
    d: &ExactPoint,
    index: usize,
) -> BpResult<Option<(ExactPoint, ExactPoint)>> {
    let edge = if index == 1 { &logic.j2.e } else { &logic.j1.e };
    let p = if d.sub_point(b).slope()?.gt(&BpFraction::ONE) {
        line_x_intersection_number(edge, d.x.value())?
    } else {
        line_y_intersection_number(edge, d.y.value())?
    };
    let grid_points = closest_grid_points(&substitute_end(edge, b, logic.joiner.oriented), d)?;
    for t in grid_points {
        if t.equals(&edge.p1) || t.equals(&edge.p2) {
            continue;
        }
        let Some(r) = triangle_transform(&[d.clone(), p.clone(), b.clone()], &t) else {
            continue;
        };
        if r.x.value() * (logic.f as f64) < logic.data.pt.x.value() * (logic.f as f64) {
            continue;
        }
        let contains = if index == 1 {
            logic.j1.contains(&r)?
        } else {
            logic.j2.contains(&r)?
        };
        if !contains {
            continue;
        }
        return Ok(Some((t, r)));
    }
    Ok(None)
}

fn concave_standard_join(
    mut logic: JoinLogic<'_>,
    b: ExactPoint,
    d: ExactPoint,
    index: usize,
    delta: &Line,
) -> BpResult<Vec<JoinResult>> {
    if d.is_integral() {
        return Ok(Vec::new());
    }
    let edge = if index == 1 {
        logic.j2.e.clone()
    } else {
        logic.j1.e.clone()
    };
    let piece = if index == 1 {
        logic.j2.p.clone()
    } else {
        logic.j1.p.clone()
    };
    let Some(t) = closest_grid_points(&substitute_end(&edge, &d, logic.joiner.oriented), &b)?
        .into_iter()
        .next()
    else {
        return Ok(Vec::new());
    };
    if t.equals(&edge.p1) || t.equals(&edge.p2) {
        return Ok(Vec::new());
    }
    let p = if d.sub_point(&b).slope()?.gt(&BpFraction::ONE) {
        line_y_intersection_number(delta, t.y.value())?
    } else {
        line_x_intersection_number(delta, t.x.value())?
    };
    let Some(r) = triangle_transform(&[t.clone(), d, p], &b) else {
        return Ok(Vec::new());
    };
    if !logic.setup_anchor(&r)? {
        return Ok(Vec::new());
    }
    logic.data.add_ons = Some(vec![AddOn {
        contour: vec![
            exact_point_to_json(&b),
            exact_point_to_json(&t),
            exact_point_to_json(&r),
        ],
        dir: exact_vector_to_json(&Line::new(t.clone(), b.clone()).reflect(&piece.direction()?)?),
    }]);
    if index == 1 {
        logic.setup_detour(std::slice::from_ref(&b), &[t.clone(), b.clone()]);
    } else {
        logic.setup_detour(&[t.clone(), b.clone()], std::slice::from_ref(&b));
    }
    Ok(vec![logic.result(true, b.dist(&t))?])
}

pub fn reverse_shift(overlap: &Overlap, junction: &Junction) -> Option<Point> {
    let x = overlap.ox + overlap.shift.map_or(0.0, |shift| shift.x);
    let y = overlap.oy + overlap.shift.map_or(0.0, |shift| shift.y);
    if x == junction.ox && y == junction.oy {
        None
    } else {
        Some(Point {
            x: x - junction.ox,
            y: y - junction.oy,
        })
    }
}

fn quadrant_combination(oriented: bool, is_clockwise: bool) -> [QuadrantDirection; 2] {
    match (oriented, is_clockwise) {
        (true, true) => [QuadrantDirection::Ll, QuadrantDirection::Ul],
        (true, false) => [QuadrantDirection::Ul, QuadrantDirection::Ll],
        (false, true) => [QuadrantDirection::Ur, QuadrantDirection::Lr],
        (false, false) => [QuadrantDirection::Lr, QuadrantDirection::Ur],
    }
}

fn generate_pieces(overlap: &Overlap, junction: &Junction) -> BpResult<Vec<Piece>> {
    let ox = integer_dimension(overlap.ox, "join overlap ox")?;
    let oy = integer_dimension(overlap.oy, "join overlap oy")?;
    Ok(generate_gops(ox, oy, junction.sx)
        .into_iter()
        .map(piece_from_json)
        .collect())
}

fn piece_from_json(piece: JsonPiece) -> Piece {
    Piece {
        ox: piece.ox,
        oy: piece.oy,
        u: piece.u,
        v: piece.v,
        detours: piece.detours.map(|detours| {
            detours
                .into_iter()
                .map(|path| {
                    path.into_iter()
                        .map(|point| Point {
                            x: point.x,
                            y: point.y,
                        })
                        .collect()
                })
                .collect()
        }),
        shift: piece.shift.map(|point| Point {
            x: point.x,
            y: point.y,
        }),
    }
}

fn integer_dimension(value: f64, name: &str) -> BpResult<i64> {
    if value.fract() == 0.0 {
        Ok(value as i64)
    } else {
        Err(BpError::InvalidInput(format!(
            "{name} must be integral for BP join generation"
        )))
    }
}

fn quadrant_vector(q: QuadrantDirection) -> ExactVector {
    match q {
        QuadrantDirection::Ur => ExactVector::from_integers(1, 1),
        QuadrantDirection::Ul => ExactVector::from_integers(-1, 1),
        QuadrantDirection::Ll => ExactVector::from_integers(-1, -1),
        QuadrantDirection::Lr => ExactVector::from_integers(1, -1),
    }
}

fn set_anchor(anchors: &mut Vec<Option<Anchor>>, q: QuadrantDirection, anchor: Anchor) {
    let q = q as usize;
    if anchors.len() <= q {
        anchors.resize_with(q + 1, || None);
    }
    anchors[q] = Some(anchor);
}

fn exact_point(point: Point) -> BpResult<ExactPoint> {
    ExactPoint::from_numbers(point.x, point.y)
}

fn exact_vector(point: Point) -> BpResult<ExactVector> {
    ExactVector::from_numbers(point.x, point.y)
}

fn line_x_intersection_number(line: &Line, x: f64) -> BpResult<ExactPoint> {
    let vector = line.vector();
    let f = BpFraction::from_number(x)?;
    Ok(ExactPoint::new(
        f.clone(),
        line.p1.y.sub(&vector.slope()?.mul(&line.p1.x.sub(&f))),
    ))
}

fn line_y_intersection_number(line: &Line, y: f64) -> BpResult<ExactPoint> {
    let vector = line.vector();
    let f = BpFraction::from_number(y)?;
    let mut ratio = line.p1.y.sub(&f);
    ratio.div_mut(&vector.slope()?)?;
    Ok(ExactPoint::new(line.p1.x.sub(&ratio), f))
}

fn closest_grid_points(line: &Line, point: &ExactPoint) -> BpResult<Vec<ExactPoint>> {
    let mut grid_points = line
        .grid_points()?
        .into_iter()
        .map(|grid_point| {
            let dist = grid_point.dist(point);
            (grid_point, dist)
        })
        .collect::<Vec<_>>();
    grid_points.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal));
    Ok(grid_points.into_iter().map(|(point, _)| point).collect())
}

fn substitute_end(line: &Line, point: &ExactPoint, oriented: bool) -> Line {
    let (p1, p2) = line.x_orient();
    Line::new(point.clone(), if oriented { p2 } else { p1 })
}

fn add_vectors(first: &ExactVector, second: &ExactVector) -> ExactVector {
    ExactVector::new(first.x.add(&second.x), first.y.add(&second.y))
}

fn exact_point_to_json(point: &ExactPoint) -> Point {
    Point {
        x: point.x.value(),
        y: point.y.value(),
    }
}

fn exact_vector_to_json(vector: &ExactVector) -> Point {
    Point {
        x: vector.x.value(),
        y: vector.y.value(),
    }
}

fn exact_point_to_path_point(point: &ExactPoint) -> PathPoint {
    PathPoint::new(point.x.value(), point.y.value())
}

fn exact_path_to_path_points(path: &[ExactPoint]) -> Vec<PathPoint> {
    path.iter().map(exact_point_to_path_point).collect()
}
