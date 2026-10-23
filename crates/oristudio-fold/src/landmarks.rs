//! Landmarks: the features of a folded form a construction can use (plan
//! Phase 3, research §8) — vertex images, edges, crossings and Divide-line
//! marks — each with its provenance and its visibility.
//!
//! # Provenance
//!
//! Stacked layers make features coincide: corners stack, and edges of
//! different layers lie on one line. A landmark is one place or one line in
//! the model frame, deduplicated within the tolerance by [`PointGrid`] and
//! [`LineIndex`], and it keeps **every** source: the crease-pattern vertex or
//! crease, and the anchor a step stores to name it (a sheet point or a
//! [`SheetSegment`], plan D6), so a step's inputs survive later steps.
//!
//! - **Segments**: every raw edge and bend, and every flat crease the viewer
//!   can see some of. A segment is one crease; its image is one segment
//!   because the isometries of the faces on either side agree along it.
//! - **Lines**: the distinct lines segments lie on.
//! - **Points**: vertex images; crossings of two segments, one source per
//!   segment, each with the sheet point on its own layer; marks, which
//!   are annotations outside the state (plan D6) and come in as sheet points;
//!   and the crease marks' ends and crossings (below).
//! - **Crease marks** (partial creases, `crate::crease_marks`) are state: each
//!   mark's part on each face it crosses, with the visibility a crease on
//!   that layer has. Their ends are points, and so are their crossings with
//!   segments and with one another, one source per feature as for a
//!   crossing of two segments. They are not among the segments and lines,
//!   which are creases, what the existing-crease line mode folds along; an
//!   axiom can still take a mark's sheet segment as a line input, as it can
//!   any straight piece of paper (`crate::anchor`).
//!
//! Midpoints are not landmarks: a step that needs one makes it, with an O2
//! fold or a Divide-line mark.
//!
//! # Visibility
//!
//! From the layer order as the viewer sees it, so a turned-over view sees the
//! model frame's bottom layer on top. A feature is visible where one of the
//! faces it lies on is not covered by a face the viewer sees above that face.
//!
//! Every feature lies on the boundary of the faces it belongs to, and a layer
//! above often has its own edge or crease exactly over it (a crease folded
//! through several layers; a corner stacked on a corner). So coverage is not
//! tested at the feature, where such a layer only touches it, but at a probe
//! a tenth of the minimum feature inside each of its faces: a feature on the
//! silhouette, or along the edge of the layer above it, is visible, and one
//! under a stacked twin is not. A segment is visible over the parts where
//! that holds; a visible part shorter than half the minimum feature (a gap
//! between two covering faces, say) is no part.

use oristudio_geometry::convex::{self, HalfPlane};
use oristudio_geometry::{Line, LineIndex, PointGrid};
use serde::Serialize;

use crate::anchor::SheetSegment;
use crate::index::BoxIndex;
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::{CreaseKind, EdgeId, FaceId, Letter, VertexId};
use crate::state::State;

type Point = [f64; 2];

/// How far inside one of its faces a feature's coverage is probed: far above
/// the tolerance, so a face whose edge runs along the feature still holds the
/// probe by more than it, and far below the half minimum feature every face
/// is wide, so the probe stays next to the feature.
const PROBE: f64 = MIN_FEATURE / 10.0;

/// What a segment is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentKind {
    /// The paper's raw edge.
    RawEdge,
    /// A folded crease: where the paper turns, an edge of the folded form.
    Bend,
    /// A flat crease on the paper: a precrease, or a fold since unfolded.
    Crease,
}

/// One crease's image.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SegmentLandmark {
    pub edge: EdgeId,
    pub kind: SegmentKind,
    /// The crease's ends in sheet coordinates: the anchor a step stores.
    pub sheet: SheetSegment,
    /// Its image in the model frame, `at[0]` the image of `sheet.a`.
    pub at: [Point; 2],
    /// The line it lies on, an index into [`Landmarks::lines`].
    pub line: usize,
    /// The parts the viewer sees, as fractions of the way from `at[0]` to
    /// `at[1]`, ascending and disjoint.
    pub visible: Vec<[f64; 2]>,
}

/// One line of the model frame that segments lie on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LineLandmark {
    pub line: Line,
    /// Indices into [`Landmarks::segments`], ascending.
    pub segments: Vec<usize>,
    /// Whether the viewer sees part of one of them.
    pub visible: bool,
}

/// What is at a point landmark.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum PointKind {
    /// A crease-pattern vertex.
    Vertex { vertex: VertexId },
    /// The crossing of two segments, on `segment` (whose layer the sheet point
    /// is on), crossing `other`; both index [`Landmarks::segments`].
    Crossing { segment: usize, other: usize },
    /// A mark the caller passed in, by its index.
    Mark { mark: usize },
    /// An end of a crease mark (a partial crease), by its index in the
    /// state's crease marks.
    CreaseMarkEnd { crease_mark: usize },
    /// Where a crease mark crosses a segment or another crease mark, on
    /// `on` (whose layer the sheet point is on), crossing `other`.
    CreaseMarkCrossing { on: Feature, other: Feature },
}

/// A feature a crease mark crosses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Feature {
    /// An index into [`Landmarks::segments`].
    Segment(usize),
    /// A crease mark, by its index in the state's crease marks.
    CreaseMark(usize),
}

/// One crease mark's part on one face: a partial crease.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CreaseMarkLandmark {
    /// The mark, by its index in the state's crease marks.
    pub crease_mark: usize,
    /// Front-relative.
    pub letter: Letter,
    /// The part's ends in sheet coordinates.
    pub sheet: SheetSegment,
    /// Its image in the model frame, `at[0]` the image of `sheet.a`.
    pub at: [Point; 2],
    /// The parts the viewer sees, as fractions of the way from `at[0]` to
    /// `at[1]`, ascending and disjoint: none on a hidden layer.
    pub visible: Vec<[f64; 2]>,
}

/// One feature at a point landmark.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PointSource {
    /// The sheet point that names it: the anchor a step stores.
    pub sheet: Point,
    /// Whether the viewer sees it.
    pub visible: bool,
    #[serde(flatten)]
    pub kind: PointKind,
}

/// One place in the model frame where features coincide.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PointLandmark {
    pub at: Point,
    /// Every feature here: vertices first (by id), then crossings, then
    /// marks, then crease marks' ends and crossings.
    pub sources: Vec<PointSource>,
    /// Whether the viewer sees one of them.
    pub visible: bool,
}

/// A state's landmarks.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Landmarks {
    pub points: Vec<PointLandmark>,
    pub lines: Vec<LineLandmark>,
    pub segments: Vec<SegmentLandmark>,
    /// The crease marks' parts, one per face each crosses, by mark; left out
    /// when there are none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub crease_marks: Vec<CreaseMarkLandmark>,
}

impl Landmarks {
    /// The point landmark within the tolerance of a model-frame point.
    pub fn point_at(&self, at: Point) -> Option<&PointLandmark> {
        self.points
            .iter()
            .map(|p| (distance(p.at, at), p))
            .filter(|(d, _)| *d <= TOL)
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, p)| p)
    }

    /// The line landmark equal to `line` within the tolerance.
    pub fn line_of(&self, line: &Line) -> Option<&LineLandmark> {
        self.lines.iter().find(|l| l.line.approx_eq(line))
    }

    /// The existing-crease line mode (plan D14): the visible crease or bend
    /// whose visible part passes nearest the model-frame point, within
    /// `radius`. Its `sheet` segment is what the step stores; its line is the
    /// fold line.
    pub fn existing_crease(&self, at: Point, radius: f64) -> Option<&SegmentLandmark> {
        self.segments
            .iter()
            .filter(|s| s.kind != SegmentKind::RawEdge)
            .filter_map(|s| {
                s.visible
                    .iter()
                    .map(|&[u0, u1]| distance_to_segment(at, lerp(s.at, u0), lerp(s.at, u1)))
                    .min_by(f64::total_cmp)
                    .map(|d| (d, s))
            })
            .filter(|(d, _)| *d <= radius)
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, s)| s)
    }
}

impl State {
    /// Every landmark of this state, with `marks` (sheet points; plan D6)
    /// among the points. A mark off the paper is left out.
    pub fn landmarks(&self, marks: &[Point]) -> Landmarks {
        let cover = Cover::new(self);
        let mut lines = LineIndex::new(TOL);
        let mut line_segments: Vec<Vec<usize>> = Vec::new();
        let mut segments = Vec::new();
        for (mut segment, line) in self.segment_landmarks(&cover) {
            let (id, inserted) = lines.insert(line);
            if inserted {
                line_segments.push(Vec::new());
            }
            line_segments[id].push(segments.len());
            segment.line = id;
            segments.push(segment);
        }
        let lines: Vec<LineLandmark> = line_segments
            .into_iter()
            .enumerate()
            .map(|(id, members)| LineLandmark {
                line: *lines.get(id),
                visible: members.iter().any(|&i| !segments[i].visible.is_empty()),
                segments: members,
            })
            .collect();

        let mut points = Points::default();
        let geometry = self.geometry();
        let mut vertex_faces: Vec<Vec<usize>> = vec![Vec::new(); self.vertices().len()];
        for (f, face) in self.faces().iter().enumerate() {
            for v in &face.ring {
                vertex_faces[v.index()].push(f);
            }
        }
        for (v, holders) in vertex_faces.iter().enumerate() {
            if holders.is_empty() {
                continue;
            }
            let at = geometry.vertex_images[v];
            points.add(
                at,
                PointSource {
                    sheet: self.vertices()[v],
                    visible: cover.point_visible(at, holders),
                    kind: PointKind::Vertex {
                        vertex: VertexId(v as u32),
                    },
                },
            );
        }
        for (i, j, at, [ui, uj]) in crossings(&segments) {
            let (si, sj) = (&segments[i], &segments[j]);
            let visible = crossing_seen((si.at, &si.visible, ui), (sj.at, &sj.visible, uj));
            for (segment, other, u) in [(i, j, ui), (j, i, uj)] {
                points.add(
                    at,
                    PointSource {
                        sheet: segments[segment].sheet.at(u),
                        visible,
                        kind: PointKind::Crossing { segment, other },
                    },
                );
            }
        }
        for (mark, &sheet) in marks.iter().enumerate() {
            let holders = self.holding_positions(sheet);
            let Some(&f) = holders.first() else {
                continue;
            };
            let at = geometry.isometries[f].apply(sheet);
            points.add(
                at,
                PointSource {
                    sheet,
                    visible: cover.point_visible(at, &holders),
                    kind: PointKind::Mark { mark },
                },
            );
        }
        let crease_marks = self.crease_mark_landmarks(&cover, &segments, &mut points);

        Landmarks {
            points: points.finish(),
            lines,
            segments,
            crease_marks,
        }
    }

    /// The crease marks' parts, and among the points their ends and their
    /// crossings with `segments` and with one another.
    ///
    /// A mark crosses a crease of its own layer where its part on one face
    /// ends and its part on the next begins, so a crossing at the end of a
    /// part counts, once per mark and feature; at the mark's own ends it is
    /// the end. A crease mark lies on one layer like any crease, so its
    /// visibility is a crease's, and one on a hidden layer is not seen.
    fn crease_mark_landmarks(
        &self,
        cover: &Cover<'_>,
        segments: &[SegmentLandmark],
        points: &mut Points,
    ) -> Vec<CreaseMarkLandmark> {
        let marks = self.crease_marks();
        if marks.is_empty() {
            return Vec::new();
        }
        let geometry = self.geometry();
        // Each piece, and the span of its mark it covers.
        let mut pieces: Vec<(CreaseMarkLandmark, [f64; 2])> = Vec::new();
        for piece in self.mark_pieces() {
            let mark = &marks[piece.mark];
            let [u0, u1] = piece.span;
            let sheet = SheetSegment::new(mark.at(u0), mark.at(u1));
            let t = geometry.isometries[piece.face];
            let at = [t.apply(sheet.a), t.apply(sheet.b)];
            pieces.push((
                CreaseMarkLandmark {
                    crease_mark: piece.mark,
                    letter: mark.letter,
                    sheet,
                    at,
                    visible: cover.visible_spans(at, &[piece.face]),
                },
                piece.span,
            ));
        }

        for (k, mark) in marks.iter().enumerate() {
            for end in [mark.a, mark.b] {
                let holders = self.holding_positions(end);
                let Some(&f) = holders.first() else {
                    continue;
                };
                let at = geometry.isometries[f].apply(end);
                points.add(
                    at,
                    PointSource {
                        sheet: end,
                        visible: cover.point_visible(at, &holders),
                        kind: PointKind::CreaseMarkEnd { crease_mark: k },
                    },
                );
            }
        }

        // Crossings: (mark, its fraction, feature, the feature's sheet point
        // and fraction along it, the point), deduplicated by mark, feature
        // and fraction.
        let mut seen: Vec<(usize, Feature, f64)> = Vec::new();
        let mut first_time = |mark: usize, feature: Feature, s: f64| {
            let slack = TOL / marks[mark].length().max(f64::MIN_POSITIVE);
            let new = !seen
                .iter()
                .any(|&(m, f, t)| m == mark && f == feature && (t - s).abs() <= slack);
            if new {
                seen.push((mark, feature, s));
            }
            new
        };
        for (piece, span) in &pieces {
            let mark = piece.crease_mark;
            // Another mark's parts are taken from the lower-numbered mark of
            // the two, so each crossing of two marks is found from one side.
            let others = segments
                .iter()
                .enumerate()
                .map(|(j, s)| (Feature::Segment(j), s.at, &s.visible, s.sheet))
                .chain(
                    pieces
                        .iter()
                        .filter(|(other, _)| other.crease_mark > mark)
                        .map(|(other, _)| {
                            (
                                Feature::CreaseMark(other.crease_mark),
                                other.at,
                                &other.visible,
                                other.sheet,
                            )
                        }),
                );
            let piece_slack = TOL / distance(piece.at[0], piece.at[1]).max(f64::MIN_POSITIVE);
            let mark_slack = TOL / marks[mark].length().max(f64::MIN_POSITIVE);
            for (feature, other_at, other_visible, other_sheet) in others {
                let Some((x, u, v)) = crossing(piece.at, other_at) else {
                    continue;
                };
                // On this part, and along the mark short of its ends; along
                // the other, short of a segment's ends (its vertices), or
                // anywhere on another mark's part.
                if u < -piece_slack || u > 1.0 + piece_slack {
                    continue;
                }
                let s = span[0] + u * (span[1] - span[0]);
                if s <= mark_slack || s >= 1.0 - mark_slack {
                    continue;
                }
                let other_slack = TOL / distance(other_at[0], other_at[1]).max(f64::MIN_POSITIVE);
                let other_inside = match feature {
                    Feature::Segment(_) => v > other_slack && v < 1.0 - other_slack,
                    Feature::CreaseMark(_) => v >= -other_slack && v <= 1.0 + other_slack,
                };
                if !other_inside || !first_time(mark, feature, s) {
                    continue;
                }
                let visible =
                    crossing_seen((piece.at, &piece.visible, u), (other_at, other_visible, v));
                let on = Feature::CreaseMark(mark);
                for (where_, crossed, sheet) in [
                    (on, feature, piece.sheet.at(u)),
                    (feature, on, other_sheet.at(v)),
                ] {
                    points.add(
                        x,
                        PointSource {
                            sheet,
                            visible,
                            kind: PointKind::CreaseMarkCrossing {
                                on: where_,
                                other: crossed,
                            },
                        },
                    );
                }
            }
        }
        pieces.into_iter().map(|(piece, _)| piece).collect()
    }

    /// The face the viewer sees at a model-frame point inside a face, and the
    /// sheet point there: where a mark made by a pick goes ("on the top
    /// visible layer at the pick", plan D6). None off the paper or on a
    /// crease.
    pub fn top_visible_at(&self, at: Point) -> Option<(FaceId, Point)> {
        let stack = self.stack_at(at)?;
        let top = if self.view().flipped {
            stack.last()
        } else {
            stack.first()
        }?;
        let t = self.isometry(*top)?;
        Some((*top, t.inverse().apply(at)))
    }

    /// A segment landmark per raw edge and bend, and per flat crease with a
    /// visible part, in crease id order, with the line each lies on (whose
    /// index the caller sets).
    fn segment_landmarks(&self, cover: &Cover<'_>) -> Vec<(SegmentLandmark, Line)> {
        let geometry = self.geometry();
        let topology = self.topology();
        let mut out = Vec::new();
        for (k, crease) in self.creases().iter().enumerate() {
            let holders = &topology.crease_faces[k];
            let Some(&f) = holders.first() else {
                continue;
            };
            let kind = match crease.kind {
                CreaseKind::Border => SegmentKind::RawEdge,
                CreaseKind::Folded(_) => SegmentKind::Bend,
                CreaseKind::Flat(_) => SegmentKind::Crease,
            };
            let [a, b] = crease.vertices.map(|v| self.vertices()[v.index()]);
            let t = geometry.isometries[f];
            let at = [t.apply(a), t.apply(b)];
            // Creases are at least the minimum feature long, so this holds.
            let Some(line) = Line::from_points(at[0], at[1]) else {
                continue;
            };
            let visible = cover.visible_spans(at, holders);
            if kind == SegmentKind::Crease && visible.is_empty() {
                continue;
            }
            let segment = SegmentLandmark {
                edge: crease.id,
                kind,
                sheet: SheetSegment::new(a, b),
                at,
                line: 0,
                visible,
            };
            out.push((segment, line));
        }
        out
    }
}

/// Point landmarks under construction: one grid place per landmark.
struct Points {
    grid: PointGrid,
    sources: Vec<Vec<PointSource>>,
}

impl Default for Points {
    fn default() -> Points {
        Points {
            grid: PointGrid::new(TOL),
            sources: Vec::new(),
        }
    }
}

impl Points {
    fn add(&mut self, at: Point, source: PointSource) {
        let (id, inserted) = self.grid.find_or_insert(at, TOL);
        if inserted {
            self.sources.push(Vec::new());
        }
        self.sources[id].push(source);
    }

    fn finish(self) -> Vec<PointLandmark> {
        let grid = self.grid;
        self.sources
            .into_iter()
            .enumerate()
            .map(|(id, sources)| PointLandmark {
                at: grid.point(id),
                visible: sources.iter().any(|s| s.visible),
                sources,
            })
            .collect()
    }
}

/// Which faces the viewer sees above which, and where they cover the paper.
struct Cover<'s> {
    state: &'s State,
    index: BoxIndex,
    /// Per face position, an interior point of its image.
    centres: Vec<Point>,
}

impl<'s> Cover<'s> {
    fn new(state: &'s State) -> Cover<'s> {
        let geometry = state.geometry();
        let centres = geometry
            .images
            .iter()
            .map(|image| convex::centroid(image).unwrap_or_else(|| mean(image)))
            .collect();
        Cover {
            state,
            index: BoxIndex::new(geometry.boxes.clone()),
            centres,
        }
    }

    /// Whether the viewer sees the face at position `g` above the one at `f`.
    fn seen_above(&self, g: usize, f: usize) -> bool {
        let faces = self.state.faces();
        self.state.seen_above(faces[g].id, faces[f].id) == Some(true)
    }

    /// Whether a feature at `at` on the faces at positions `holders` is seen:
    /// a probe into one of them is held by no face seen above it.
    fn point_visible(&self, at: Point, holders: &[usize]) -> bool {
        let images = &self.state.geometry().images;
        holders.iter().any(|&f| {
            let probe = toward(at, self.centres[f], PROBE);
            !self
                .index
                .query(&[probe[0], probe[1], probe[0], probe[1]], 0.0)
                .into_iter()
                .any(|g| {
                    g != f
                        && convex::contains_point(&images[g], probe, TOL)
                        && self.seen_above(g, f)
                })
        })
    }

    /// The parts of the segment `at` on the faces `holders` that the viewer
    /// sees: where, for one of the holders, the segment moved [`PROBE`] into
    /// it is held by no face seen above it.
    fn visible_spans(&self, at: [Point; 2], holders: &[usize]) -> Vec<[f64; 2]> {
        let images = &self.state.geometry().images;
        let mut hidden: Option<Vec<[f64; 2]>> = None;
        for &f in holders {
            let shift = into(at, self.centres[f], PROBE);
            let probe = at.map(|p| [p[0] + shift[0], p[1] + shift[1]]);
            let over = union(
                self.index
                    .query(&convex::bounding_box(&probe), 0.0)
                    .into_iter()
                    .filter(|&g| g != f && self.seen_above(g, f))
                    .filter_map(|g| span_inside(probe, &images[g], TOL))
                    .collect(),
            );
            hidden = Some(match hidden {
                None => over,
                Some(h) => intersection(&h, &over),
            });
        }
        let length = distance(at[0], at[1]).max(f64::MIN_POSITIVE);
        complement(&hidden.unwrap_or_default(), MIN_FEATURE / 2.0 / length)
    }
}

/// The point `step` from `from` toward `to`; `from` itself when they meet.
fn toward(from: Point, to: Point, step: f64) -> Point {
    let d = distance(from, to);
    if d == 0.0 {
        return from;
    }
    let k = step.min(d) / d;
    [
        from[0] + k * (to[0] - from[0]),
        from[1] + k * (to[1] - from[1]),
    ]
}

/// The shift `step` long, perpendicular to the segment `at`, toward the side
/// `inside` is on.
fn into(at: [Point; 2], inside: Point, step: f64) -> Point {
    let d = [at[1][0] - at[0][0], at[1][1] - at[0][1]];
    let length = d[0].hypot(d[1]);
    if length == 0.0 {
        return [0.0, 0.0];
    }
    let mut n = [-d[1] / length, d[0] / length];
    if n[0] * (inside[0] - at[0][0]) + n[1] * (inside[1] - at[0][1]) < 0.0 {
        n = [-n[0], -n[1]];
    }
    [step * n[0], step * n[1]]
}

fn mean(points: &[Point]) -> Point {
    let n = points.len().max(1) as f64;
    let sum = points
        .iter()
        .fold([0.0, 0.0], |s, p| [s[0] + p[0], s[1] + p[1]]);
    [sum[0] / n, sum[1] / n]
}

/// Every proper crossing of two segments on different lines: their
/// positions, the point, and how far along each it is. A crossing within the
/// tolerance of either segment's end is the vertex there, already a point.
fn crossings(segments: &[SegmentLandmark]) -> Vec<(usize, usize, Point, [f64; 2])> {
    let boxes: Vec<[f64; 4]> = segments
        .iter()
        .map(|s| convex::bounding_box(&s.at))
        .collect();
    let index = BoxIndex::new(boxes.clone());
    let mut out = Vec::new();
    for (i, si) in segments.iter().enumerate() {
        for j in index.query(&boxes[i], TOL) {
            let sj = &segments[j];
            if j <= i || si.line == sj.line {
                continue;
            }
            let (Some(li), Some(lj)) = (
                Line::from_points(si.at[0], si.at[1]),
                Line::from_points(sj.at[0], sj.at[1]),
            ) else {
                continue;
            };
            let Some(x) = li.intersect(&lj) else {
                continue;
            };
            let (Some(ui), Some(uj)) = (interior(si.at, x), interior(sj.at, x)) else {
                continue;
            };
            out.push((i, j, x, [ui, uj]));
        }
    }
    out
}

/// Where the lines of two segments meet, and how far along each that is, as
/// fractions of the way from its first end; none when they are parallel.
fn crossing(a: [Point; 2], b: [Point; 2]) -> Option<(Point, f64, f64)> {
    let x = Line::from_points(a[0], a[1])?.intersect(&Line::from_points(b[0], b[1])?)?;
    let fraction = |at: [Point; 2]| {
        let d = [at[1][0] - at[0][0], at[1][1] - at[0][1]];
        ((x[0] - at[0][0]) * d[0] + (x[1] - at[0][1]) * d[1]) / (d[0] * d[0] + d[1] * d[1])
    };
    Some((x, fraction(a), fraction(b)))
}

/// How far along `at` the point `x` (on its line) is, when it is more than
/// the tolerance from both ends.
fn interior(at: [Point; 2], x: Point) -> Option<f64> {
    let d = [at[1][0] - at[0][0], at[1][1] - at[0][1]];
    let length = d[0].hypot(d[1]);
    let along = ((x[0] - at[0][0]) * d[0] + (x[1] - at[0][1]) * d[1]) / length;
    (along > TOL && along < length - TOL).then(|| along / length)
}

/// Whether the viewer sees where two segments (or crease mark parts) cross,
/// each given by its image, its visible parts and the crossing's fraction
/// along it: the crossing is in, or at the end of, a visible part of both.
///
/// So a crossing at a flap's edge, where the edge on top runs over the
/// other segment and hides the rest of it, is seen: the corner the two make
/// is in view. One under other paper, or where either is covered on both
/// sides, is not.
///
/// A visible part's end is measured on the segment moved [`PROBE`] into its
/// face ([`Cover::visible_spans`]), so where the covering face's edge (the
/// other segment) crosses it at the angle θ, the end is `PROBE·cot θ` along
/// it from the crossing, and `TOL / sin θ` more for the margin: far beyond
/// the tolerance. The end is allowed that far, and never more than the half
/// minimum feature the parts are resolved to.
fn crossing_seen(a: ([Point; 2], &[[f64; 2]], f64), b: ([Point; 2], &[[f64; 2]], f64)) -> bool {
    let d = |at: [Point; 2]| [at[1][0] - at[0][0], at[1][1] - at[0][1]];
    let (da, db) = (d(a.0), d(b.0));
    let norms = (distance(a.0[0], a.0[1]) * distance(b.0[0], b.0[1])).max(f64::MIN_POSITIVE);
    let sin = (da[0] * db[1] - da[1] * db[0]).abs() / norms;
    let cos = (da[0] * db[0] + da[1] * db[1]).abs() / norms;
    let slack = ((PROBE * cos + 2.0 * TOL) / sin.max(f64::MIN_POSITIVE)).min(MIN_FEATURE / 2.0);
    covers(a.1, a.2, &a.0, slack) && covers(b.1, b.2, &b.0, slack)
}

/// Whether the fraction `u` of the way along `at` is in a visible part, or
/// within `slack` (a distance) of one.
fn covers(spans: &[[f64; 2]], u: f64, at: &[Point; 2], slack: f64) -> bool {
    let slack = slack.max(TOL) / distance(at[0], at[1]).max(f64::MIN_POSITIVE);
    spans
        .iter()
        .any(|&[u0, u1]| u >= u0 - slack && u <= u1 + slack)
}

/// The part of the segment `at` inside a counter-clockwise convex polygon by
/// more than `margin`, as fractions of the way along it; none when there is
/// none.
fn span_inside(at: [Point; 2], polygon: &[Point], margin: f64) -> Option<[f64; 2]> {
    let (mut u0, mut u1) = (0.0_f64, 1.0_f64);
    let mut any = false;
    for i in 0..polygon.len() {
        let Some(plane) = HalfPlane::left_of(polygon[i], polygon[(i + 1) % polygon.len()]) else {
            continue;
        };
        any = true;
        let da = plane.signed_distance(at[0]) - margin;
        let db = plane.signed_distance(at[1]) - margin;
        if da <= 0.0 && db <= 0.0 {
            return None;
        }
        if da < 0.0 {
            u0 = u0.max(da / (da - db));
        } else if db < 0.0 {
            u1 = u1.min(da / (da - db));
        }
        if u1 <= u0 {
            return None;
        }
    }
    any.then_some([u0, u1])
}

/// Spans merged where they overlap, ascending.
fn union(mut spans: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    spans.sort_by(|a, b| a[0].total_cmp(&b[0]));
    let mut out: Vec<[f64; 2]> = Vec::with_capacity(spans.len());
    for [u0, u1] in spans {
        match out.last_mut() {
            Some(last) if u0 <= last[1] => last[1] = last[1].max(u1),
            _ => out.push([u0, u1]),
        }
    }
    out
}

/// The intersection of two ascending, disjoint span lists.
fn intersection(a: &[[f64; 2]], b: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let (mut i, mut j) = (0, 0);
    let mut out = Vec::new();
    while i < a.len() && j < b.len() {
        let lo = a[i][0].max(b[j][0]);
        let hi = a[i][1].min(b[j][1]);
        if lo < hi {
            out.push([lo, hi]);
        }
        if a[i][1] < b[j][1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    out
}

/// `[0, 1]` less ascending, disjoint `hidden` spans, keeping the parts longer
/// than `min`.
fn complement(hidden: &[[f64; 2]], min: f64) -> Vec<[f64; 2]> {
    let mut out = Vec::new();
    let mut from = 0.0_f64;
    for &[h0, h1] in hidden {
        if h0 - from > min {
            out.push([from, h0]);
        }
        from = from.max(h1);
    }
    if 1.0 - from > min {
        out.push([from, 1.0]);
    }
    out
}

fn lerp(at: [Point; 2], u: f64) -> Point {
    [
        at[0][0] + u * (at[1][0] - at[0][0]),
        at[0][1] + u * (at[1][1] - at[0][1]),
    ]
}

fn distance(a: Point, b: Point) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}

fn distance_to_segment(p: Point, a: Point, b: Point) -> f64 {
    let d = [b[0] - a[0], b[1] - a[1]];
    let len2 = d[0] * d[0] + d[1] * d[1];
    if len2 == 0.0 {
        return distance(p, a);
    }
    let t = (((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2).clamp(0.0, 1.0);
    distance(p, [a[0] + t * d[0], a[1] + t * d[1]])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fold::PlainFold;
    use crate::refusal::Side;
    use crate::sheet::Sheet;
    use crate::view::{Direction, StartSide};

    fn line(n: Point, d: f64) -> Line {
        Line::new(n, d).unwrap_or_else(|| unreachable!())
    }

    fn square() -> State {
        State::flat(Sheet::square(), StartSide::Front).unwrap_or_else(|e| panic!("{e}"))
    }

    fn fold(state: &State, l: Line, toward: Point) -> State {
        let side = Side::of_point(&l, toward).unwrap_or_else(|| unreachable!());
        let op = PlainFold::new(l, side, Direction::Valley);
        state.fold(&op).unwrap_or_else(|e| panic!("{e}")).state
    }

    fn precrease(state: &State, l: Line, toward: Point) -> State {
        let side = Side::of_point(&l, toward).unwrap_or_else(|| unreachable!());
        let op = PlainFold::new(l, side, Direction::Valley);
        state.precrease(&op).unwrap_or_else(|e| panic!("{e}")).state
    }

    fn vertices_at(landmarks: &Landmarks, at: Point) -> Vec<Point> {
        let Some(p) = landmarks.point_at(at) else {
            panic!("no landmark at {at:?}");
        };
        p.sources
            .iter()
            .filter(|s| matches!(s.kind, PointKind::Vertex { .. }))
            .map(|s| s.sheet)
            .collect()
    }

    /// The book fold stacks the corners and the raw edges in pairs.
    #[test]
    fn stacked_features_are_one_landmark_with_every_source() {
        let s = fold(&square(), line([1.0, 0.0], 0.5), [0.75, 0.5]);
        let l = s.landmarks(&[]);
        assert_eq!(l.points.len(), 4, "{:?}", l.points);
        assert_eq!(vertices_at(&l, [0.0, 0.0]), vec![[0.0, 0.0], [1.0, 0.0]]);
        assert_eq!(vertices_at(&l, [0.0, 1.0]), vec![[1.0, 1.0], [0.0, 1.0]]);
        assert_eq!(vertices_at(&l, [0.5, 0.0]).len(), 1);
        // Seven creases on four lines: the stacked raw edges pair up.
        assert_eq!(l.segments.len(), 7);
        assert_eq!(l.lines.len(), 4);
        let left = l
            .line_of(&line([1.0, 0.0], 0.0))
            .unwrap_or_else(|| panic!("x = 0"));
        assert_eq!(left.segments.len(), 2);
        let bend = l
            .line_of(&line([1.0, 0.0], 0.5))
            .unwrap_or_else(|| panic!("x = 0.5"));
        assert_eq!(bend.segments.len(), 1);
        assert_eq!(l.segments[bend.segments[0]].kind, SegmentKind::Bend);
        // Every place and line is on the silhouette, so seen; of each stacked
        // pair, the moved half's feature is seen and the one under it is not.
        assert!(l.points.iter().all(|p| p.visible));
        assert!(l.lines.iter().all(|p| p.visible));
        for s in &l.segments {
            let on_top = s.sheet.a[0] >= 0.5 - 1e-12 && s.sheet.b[0] >= 0.5 - 1e-12;
            let want = if on_top { vec![[0.0, 1.0]] } else { Vec::new() };
            assert_eq!(s.visible, want, "{s:?}");
        }
        let corner = l
            .point_at([0.0, 0.0])
            .unwrap_or_else(|| panic!("no corner"));
        let seen: Vec<(Point, bool)> = corner
            .sources
            .iter()
            .map(|s| (s.sheet, s.visible))
            .collect();
        assert_eq!(seen, vec![([0.0, 0.0], false), ([1.0, 0.0], true)]);
    }

    /// Two precreases crossing at (0.6, 0.5), then the right strip folded
    /// over at x = 0.75, which covers x ∈ [0.5, 0.75].
    fn covered() -> State {
        let s = precrease(&square(), line([1.0, 0.0], 0.6), [0.9, 0.5]);
        let s = precrease(&s, line([0.0, 1.0], 0.5), [0.5, 0.9]);
        fold(&s, line([1.0, 0.0], 0.75), [0.9, 0.5])
    }

    #[test]
    fn the_layer_order_decides_what_is_seen() {
        let s = covered();
        let marks = [[0.65, 0.25], [0.85, 0.25], [0.2, 0.2]];
        let l = s.landmarks(&marks);
        // The crossing of the precreases is under the strip.
        let p = l
            .point_at([0.6, 0.5])
            .unwrap_or_else(|| panic!("no vertex"));
        assert!(!p.visible);
        // So is all of x = 0.6: no landmark.
        assert!(l.line_of(&line([1.0, 0.0], 0.6)).is_none());
        // y = 0.5 is seen on the body left of the strip, and on the strip.
        let y = l
            .line_of(&line([0.0, 1.0], 0.5))
            .unwrap_or_else(|| panic!("y = 0.5"));
        let mut seen: Vec<(f64, f64)> = y
            .segments
            .iter()
            .flat_map(|&i| {
                let s = &l.segments[i];
                s.visible.iter().map(move |&[u0, u1]| {
                    let (a, b) = (lerp(s.at, u0)[0], lerp(s.at, u1)[0]);
                    (a.min(b), a.max(b))
                })
            })
            .collect();
        seen.sort_by(|a, b| a.0.total_cmp(&b.0));
        assert_eq!(seen.len(), 2, "{seen:?}");
        assert!(
            seen[0].0.abs() < 1e-9 && (seen[0].1 - 0.5).abs() < 1e-5,
            "{seen:?}"
        );
        assert!((seen[1].0 - 0.5).abs() < 1e-9 && (seen[1].1 - 0.75).abs() < 1e-9);
        // The strip's corner where its crease meets its raw edge lands on the
        // body's crease, which ends under it there: a vertex, no crossing.
        let joint = l.point_at([0.5, 0.5]).unwrap_or_else(|| panic!("no joint"));
        assert!(joint.visible);
        let sheet: Vec<Point> = joint.sources.iter().map(|s| s.sheet).collect();
        assert_eq!(sheet, vec![[1.0, 0.5]]);
        // Marks: under the strip, on it, and on the open body.
        let mark = |i: usize| {
            l.points
                .iter()
                .flat_map(|p| &p.sources)
                .find(|s| s.kind == PointKind::Mark { mark: i })
                .unwrap_or_else(|| panic!("mark {i}"))
                .visible
        };
        assert!(!mark(0));
        assert!(mark(1));
        assert!(mark(2));

        // Turned over, the body is on top.
        let t = s.turn_over();
        let l = t.landmarks(&marks);
        assert!(l.point_at([0.6, 0.5]).is_some_and(|p| p.visible));
        assert!(l.line_of(&line([1.0, 0.0], 0.6)).is_some());
        let mark = |i: usize| {
            l.points
                .iter()
                .flat_map(|p| &p.sources)
                .find(|s| s.kind == PointKind::Mark { mark: i })
                .is_some_and(|s| s.visible)
        };
        assert!(mark(0));
        assert!(!mark(1));
    }

    /// A corner folded over a precrease: the corner's raw edge crosses the
    /// body's crease, one source on each layer.
    #[test]
    fn crossings_name_a_sheet_point_on_each_layer() {
        let s = precrease(&square(), line([0.0, 1.0], 0.5), [0.5, 0.9]);
        // y = x − 0.4 takes (1, 0) to (0.4, 0.6); the corner's bottom edge
        // lands on x = 0.4, y ∈ [0, 0.6].
        let corner = Line::from_points([0.4, 0.0], [1.0, 0.6]).unwrap_or_else(|| unreachable!());
        let s = fold(&s, corner, [0.9, 0.1]);
        let l = s.landmarks(&[]);
        let p = l
            .point_at([0.4, 0.5])
            .unwrap_or_else(|| panic!("no crossing"));
        let mut sheet: Vec<Point> = p
            .sources
            .iter()
            .filter(|s| matches!(s.kind, PointKind::Crossing { .. }))
            .map(|s| s.sheet)
            .collect();
        sheet.sort_by(|a, b| a[0].total_cmp(&b[0]));
        assert_eq!(sheet.len(), 2, "{:?}", p.sources);
        assert!((sheet[0][0] - 0.4).abs() < 1e-12 && (sheet[0][1] - 0.5).abs() < 1e-12);
        assert!((sheet[1][0] - 0.9).abs() < 1e-12 && sheet[1][1].abs() < 1e-12);
        // Both lines are seen at the crossing: the corner's edge on top, the
        // body's crease just beyond it.
        assert!(p.visible && p.sources.iter().all(|s| s.visible));
        // The body's crease is hidden under the corner, x ∈ (0.4, 0.9).
        let under = l
            .segments
            .iter()
            .find(|s| s.kind == SegmentKind::Crease && (s.sheet.a[0] - s.sheet.b[0]).abs() > 0.8)
            .unwrap_or_else(|| panic!("no body crease"));
        let [[u0, u1]] = under.visible[..] else {
            panic!("{:?}", under.visible);
        };
        let ends = [lerp(under.at, u0)[0], lerp(under.at, u1)[0]];
        assert!(ends.iter().any(|x| x.abs() < 1e-12), "{ends:?}");
        assert!(ends.iter().any(|x| (x - 0.4).abs() < 1e-5), "{ends:?}");
    }

    /// The owner's intersection.osf in small: a triangle, and a flap folded
    /// over it whose edge crosses the triangle's edges at slants. Where the
    /// triangle's edge goes under the flap, the two make a corner the viewer
    /// sees, so a point; it was not one, because a visible part's end is
    /// measured a probe into its face, which at a slant moves it along the
    /// edge, short of the crossing when the flap lies over that face. Once
    /// paper is folded over one of the crossings, that one is not seen.
    #[test]
    fn a_crossing_at_a_flaps_edge_is_seen_and_one_under_paper_is_not() {
        let through =
            |a: Point, b: Point| Line::from_points(a, b).unwrap_or_else(|| unreachable!());
        let crossing_near = |l: &Landmarks, at: Point| -> bool {
            let p = l
                .points
                .iter()
                .find(|p| {
                    distance(p.at, at) < 2e-3
                        && p.sources
                            .iter()
                            .any(|s| matches!(s.kind, PointKind::Crossing { .. }))
                })
                .unwrap_or_else(|| panic!("no crossing near {at:?}: {:?}", l.points));
            p.visible
        };
        // The triangle (0, 0), (1, 0), (1, 1), two layers.
        let s = fold(&square(), line([1.0, -1.0], 0.0), [0.1, 0.9]);
        // Its right corner over to the left: the flap's edge, the image of
        // x = 1, runs from about (0.503, -0.036) to (0.360, 0.954), crossing
        // the bottom at about (0.497, 0) and the bend y = x at (0.435, 0.435).
        let s = fold(&s, through([0.75, 0.0], [0.7, 0.7]), [0.9, 0.1]);
        let (bottom, bend) = ([0.4974, 0.0], [0.4350, 0.4350]);
        let l = s.landmarks(&[]);
        assert!(crossing_near(&l, bottom));
        assert!(crossing_near(&l, bend));
        // Everything above y = 0.6 folded down: the flap's top lands over
        // the crossing on the bend; the one on the bottom stays in view.
        let s = fold(&s, line([0.0, 1.0], 0.6), [0.5, 0.9]);
        let l = s.landmarks(&[]);
        assert!(crossing_near(&l, bottom));
        assert!(!crossing_near(&l, bend));
    }

    #[test]
    fn the_existing_crease_mode_offers_visible_creases_and_bends() {
        let s = covered();
        let l = s.landmarks(&[]);
        // Under the strip there is nothing to fold along.
        assert!(l.existing_crease([0.6, 0.3], 0.05).is_none());
        // The bend at x = 0.75.
        let bend = l
            .existing_crease([0.74, 0.3], 0.05)
            .unwrap_or_else(|| panic!("no bend"));
        assert_eq!(bend.kind, SegmentKind::Bend);
        // The strip's crease, not the body's under it.
        let top = l
            .existing_crease([0.6, 0.51], 0.05)
            .unwrap_or_else(|| panic!("no crease"));
        assert_eq!(top.kind, SegmentKind::Crease);
        assert!(top.sheet.a[0] >= 0.75 - 1e-9 && top.sheet.b[0] >= 0.75 - 1e-9);
        // The body's, left of the strip.
        let body = l
            .existing_crease([0.3, 0.51], 0.05)
            .unwrap_or_else(|| panic!("no crease"));
        assert!(body.sheet.a[0] <= 0.6 + 1e-9 && body.sheet.b[0] <= 0.6 + 1e-9);
        // Raw edges are not offered.
        assert!(l.existing_crease([0.01, 0.25], 0.02).is_none());
    }

    #[test]
    fn a_pick_marks_the_top_visible_layer() {
        let s = covered();
        let (_, sheet) = s
            .top_visible_at([0.65, 0.25])
            .unwrap_or_else(|| panic!("no face"));
        assert!((sheet[0] - 0.85).abs() < 1e-12 && (sheet[1] - 0.25).abs() < 1e-12);
        let (_, sheet) = s
            .turn_over()
            .top_visible_at([0.65, 0.25])
            .unwrap_or_else(|| panic!("no face"));
        assert!((sheet[0] - 0.65).abs() < 1e-12);
        assert!(s.top_visible_at([1.5, 0.5]).is_none());
    }

    #[test]
    fn spans_combine_by_union_intersection_and_complement() {
        assert_eq!(
            union(vec![[0.5, 0.7], [0.1, 0.2], [0.15, 0.3]]),
            vec![[0.1, 0.3], [0.5, 0.7]]
        );
        assert_eq!(
            intersection(&[[0.0, 0.5], [0.6, 0.9]], &[[0.4, 0.7]]),
            vec![[0.4, 0.5], [0.6, 0.7]]
        );
        assert_eq!(
            complement(&[[0.2, 0.4], [0.4 + 1e-9, 0.6]], 1e-6),
            vec![[0.0, 0.2], [0.6, 1.0]]
        );
        assert_eq!(complement(&[], 0.1), vec![[0.0, 1.0]]);
        let square = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        assert_eq!(
            span_inside([[-1.0, 0.5], [3.0, 0.5]], &square, 0.0),
            Some([0.25, 0.5])
        );
        assert_eq!(span_inside([[-1.0, 0.0], [3.0, 0.0]], &square, TOL), None);
    }
}
