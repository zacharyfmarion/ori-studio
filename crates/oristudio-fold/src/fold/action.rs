//! What a step's picture draws on the state it starts from (plan D12, per
//! step; research §11): the fold line with its visible and hidden spans, the
//! faces that move, and a grip on the moving paper with its image, for the
//! arrow. Everything is in the parent's scene frame, so it overlays the
//! parent's [`crate::scene::FoldScene`].
//!
//! - **The line** is ℓ across the folded silhouette (every face image), first
//!   paper to last.
//! - **Spans** are the stretches of ℓ along which moving paper meets it on the
//!   moving side (the cross-section's intervals, [`super::section`], that
//!   hold a moving face). A span is *visible* where the top layer there, as
//!   the viewer sees it, moves, and *hidden* where a layer that stays covers
//!   the crease: a mountain fold of the back flap, drawn as a line behind.
//! - **The grip** sits on the moving paper: on the longest visible interval
//!   (the longest hidden one when none is visible), at its middle, a fraction
//!   of the way across the moving paper from ℓ, measured along ℓ's normal; the
//!   first of a few fractions whose point lies inside a moving face rather
//!   than on a crease. Its image is its reflection across ℓ, where the fold
//!   puts it. Each end counts the layers over it as the viewer sees them; the
//!   image's count needs the landed state.
//! - **Push and pleat** are for compound folds; a plain fold has neither.
//! - **A partial precrease** draws all of this along its extent only: the
//!   line is the pinch or the segment, and so are the spans and the grip's
//!   foot.

use std::collections::BTreeSet;

use oristudio_geometry::convex;
use serde::Serialize;

use crate::fold::section::{Along, clip_line};
use crate::fold::{FoldAnalysis, Folded};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::FaceId;
use crate::refusal::Refused;
use crate::scene::{ScenePoint, top_first};
use crate::state::State;
use crate::view::Direction;

type Point = [f64; 2];

/// Fractions of the moving paper's reach from ℓ tried for the grip, in turn.
/// Not the halves and quarters a crease pattern so often has.
const GRIP_REACH: [f64; 5] = [0.7, 0.6, 0.8, 0.45, 0.9];

/// What kind of step the geometry draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    /// A valley or mountain fold.
    Fold,
    /// Fold and unfold.
    Precrease,
}

/// One step's geometry on its parent state (see the module docs).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FoldActionGeometry {
    pub kind: ActionKind,
    /// As the viewer sees it.
    pub direction: Direction,
    /// ℓ across the silhouette; none when it misses the paper.
    pub line: Option<[ScenePoint; 2]>,
    /// Along ℓ, in order.
    pub spans: Vec<FoldLineSpan>,
    /// The parent's faces that move, in id order.
    pub moving: Vec<FaceId>,
    pub grip: Option<Grip>,
    /// A compound fold's push; none for a plain fold.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub push: Option<Push>,
    /// A compound fold's pleat; none for a plain fold.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pleat: Option<Pleat>,
}

/// A stretch of ℓ where moving paper is creased or turned.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct FoldLineSpan {
    pub from: ScenePoint,
    pub to: ScenePoint,
    /// A layer that stays covers it, as the viewer sees it.
    pub hidden: bool,
}

/// The arrow's ends.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Grip {
    /// On the moving paper.
    pub at: ScenePoint,
    /// Where the fold puts that paper.
    pub image: ScenePoint,
    /// The layers over the grip's face at `at`, as the viewer sees them.
    pub hidden_at: usize,
    /// The layers over it at `image` once landed; none without the landed
    /// state, or when the landed state does not put it there (a precrease
    /// unfolds it again).
    pub hidden_image: Option<usize>,
}

/// A push arrow (reverse folds, sinks, squashes).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Push {
    pub at: ScenePoint,
    pub toward: ScenePoint,
}

/// A pleat arrow.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Pleat {
    pub from: ScenePoint,
    pub to: ScenePoint,
    pub kinks: u8,
}

/// Where a compound fold's picture looks along ℓ, beside what a plain fold's
/// does: a vertex fold's crease is a ray from its vertex, not a whole line,
/// and the paper turning across it may lie beside paper that turns some other
/// way, which its grip must not land on.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Within<'a> {
    /// Only the ray of ℓ from this model point toward this unit direction:
    /// its line, its spans and its grip.
    pub(crate) ray: Option<(Point, Point)>,
    /// The model-frame polygons the grip reaches across from ℓ, in place of
    /// the moving faces' pieces: the paper that turns across ℓ alone.
    pub(crate) reach: Option<&'a [Vec<Point>]>,
}

impl State {
    /// The geometry of a fold of this state that `analysis` describes
    /// ([`State::analyse_fold`], or an applied fold's report), with the
    /// landed state when there is one (see the module docs).
    pub fn fold_action(
        &self,
        analysis: &FoldAnalysis,
        kind: ActionKind,
        landed: Option<&State>,
    ) -> Result<FoldActionGeometry, Refused> {
        self.fold_action_within(analysis, kind, landed, Within::default())
    }

    /// [`State::fold_action`] looking only where `within` says.
    pub(crate) fn fold_action_within(
        &self,
        analysis: &FoldAnalysis,
        kind: ActionKind,
        landed: Option<&State>,
        within: Within<'_>,
    ) -> Result<FoldActionGeometry, Refused> {
        self.fold_action_along(analysis, kind, landed, within, None)
    }

    /// [`State::fold_action_within`], and only between the model points
    /// `extent` on ℓ: a partial precrease's stretch of its line.
    fn fold_action_along(
        &self,
        analysis: &FoldAnalysis,
        kind: ActionKind,
        landed: Option<&State>,
        within: Within<'_>,
        extent: Option<[Point; 2]>,
    ) -> Result<FoldActionGeometry, Refused> {
        let along = Along::new(self, &analysis.line, analysis.side)?;
        let to_scene = self.view().transform();
        let scene = |p: Point| ScenePoint::from(to_scene.apply(p));
        let moving: BTreeSet<usize> = analysis
            .moving
            .iter()
            .filter_map(|&id| self.face_position(id))
            .collect();
        let geometry = self.geometry();
        // The stretch of ℓ looked along: all of it, or the ray, within the
        // extent.
        let [from, to] = within
            .ray
            .map_or([f64::NEG_INFINITY, f64::INFINITY], |(at, toward)| {
                along.ray(at, toward)
            });
        let [from, to] = extent.map_or([from, to], |[a, b]| {
            let (a, b) = (along.param(a), along.param(b));
            [from.max(a.min(b)), to.min(a.max(b))]
        });
        let keep = |[lo, hi]: [f64; 2]| {
            let (lo, hi) = (lo.max(from), hi.min(to));
            (hi - lo > TOL).then_some([lo, hi])
        };

        let silhouette = geometry
            .images
            .iter()
            .filter_map(|image| along.clip(image, TOL))
            .filter_map(keep)
            .fold(None, |extent: Option<[f64; 2]>, [lo, hi]| {
                Some(extent.map_or([lo, hi], |[a, b]| [a.min(lo), b.max(hi)]))
            });

        // The runs that hold moving paper, and whether the top of each moves.
        let flipped = self.view().flipped;
        let mut stretches: Vec<([f64; 2], bool)> = Vec::new();
        for run in &along.runs {
            if !run.faces.iter().any(|(f, _)| moving.contains(f)) {
                continue;
            }
            let Some(t) = keep(run.t) else {
                continue;
            };
            let top = if flipped {
                run.faces.last()
            } else {
                run.faces.first()
            };
            let hidden = !top.is_some_and(|(f, _)| moving.contains(f));
            stretches.push((t, hidden));
        }
        let mut spans: Vec<([f64; 2], bool)> = Vec::new();
        for &(t, hidden) in &stretches {
            match spans.last_mut() {
                Some((span, h)) if *h == hidden && span[1] == t[0] => span[1] = t[1],
                _ => spans.push((t, hidden)),
            }
        }

        let grip = grip(self, &along, &moving, &stretches, landed, within.reach).map(|g| Grip {
            at: scene(g.at),
            image: scene(g.image),
            hidden_at: g.hidden_at,
            hidden_image: g.hidden_image,
        });
        Ok(FoldActionGeometry {
            kind,
            direction: self.view().model_direction(analysis.direction),
            line: silhouette.map(|[a, b]| [scene(along.at(a)), scene(along.at(b))]),
            spans: spans
                .into_iter()
                .map(|(t, hidden)| FoldLineSpan {
                    from: scene(along.at(t[0])),
                    to: scene(along.at(t[1])),
                    hidden,
                })
                .collect(),
            moving: analysis.moving.clone(),
            grip,
            push: None,
            pleat: None,
        })
    }
}

impl Folded {
    /// [`State::fold_action`] for this fold of `parent`, with its landed
    /// state; a partial precrease's along its extent only.
    pub fn action(&self, parent: &State, kind: ActionKind) -> Result<FoldActionGeometry, Refused> {
        parent.fold_action_along(
            &self.report.analysis,
            kind,
            Some(&self.state),
            Within::default(),
            self.extent,
        )
    }
}

/// The grip in the model frame.
struct ModelGrip {
    at: Point,
    image: Point,
    hidden_at: usize,
    hidden_image: Option<usize>,
}

fn grip(
    state: &State,
    along: &Along,
    moving: &BTreeSet<usize>,
    stretches: &[([f64; 2], bool)],
    landed: Option<&State>,
    reach: Option<&[Vec<Point>]>,
) -> Option<ModelGrip> {
    let longest = |hidden: bool| {
        stretches
            .iter()
            .filter(|(_, h)| *h == hidden)
            .max_by(|a, b| (a.0[1] - a.0[0]).total_cmp(&(b.0[1] - b.0[0])))
    };
    let (t, _) = longest(false).or_else(|| longest(true))?;
    let foot = along.at((t[0] + t[1]) / 2.0);
    let normal = along.normal;

    // How far the moving paper reaches from ℓ along the normal, without a
    // gap wider than the tolerance: the moving faces' pieces, or the paper
    // the picture says turns across ℓ.
    let pieces: Vec<&[Point]> = match reach {
        Some(polygons) => polygons.iter().map(Vec::as_slice).collect(),
        None => moving
            .iter()
            .filter_map(|&f| along.moving.pieces[f].as_deref())
            .collect(),
    };
    let mut reaches: Vec<[f64; 2]> = pieces
        .into_iter()
        .filter_map(|piece| clip_line(piece, foot, normal, TOL))
        .collect();
    reaches.sort_by(|a, b| a[0].total_cmp(&b[0]));
    let mut reach = 0.0_f64;
    for [lo, hi] in reaches {
        if lo > reach + TOL {
            break;
        }
        reach = reach.max(hi);
    }
    if reach < MIN_FEATURE {
        return None;
    }

    let geometry = state.geometry();
    GRIP_REACH.iter().find_map(|&fraction| {
        let s = fraction * reach;
        let at = [foot[0] + s * normal[0], foot[1] + s * normal[1]];
        let image = [foot[0] - s * normal[0], foot[1] - s * normal[1]];
        let (seen, hidden_at) = seen_stack(state, at)
            .into_iter()
            .enumerate()
            .find(|(_, f)| moving.contains(f))
            .map(|(i, f)| (f, i))?;
        let sheet_point = geometry.isometries[seen].inverse().apply(at);
        let hidden_image = landed.and_then(|landed| covered_at(landed, sheet_point, image));
        Some(ModelGrip {
            at,
            image,
            hidden_at,
            hidden_image,
        })
    })
}

/// The face positions whose images contain the model-frame point `p` by more
/// than the tolerance, top first as the viewer sees them.
fn seen_stack(state: &State, p: Point) -> Vec<usize> {
    let images = &state.geometry().images;
    let ids: Vec<FaceId> = state
        .faces()
        .iter()
        .zip(images)
        .filter(|(_, image)| convex::contains_point(image, p, TOL))
        .map(|(face, _)| face.id)
        .collect();
    let mut stack: Vec<usize> = top_first(state, &ids)
        .into_iter()
        .filter_map(|id| state.face_position(id))
        .collect();
    if state.view().flipped {
        stack.reverse();
    }
    stack
}

/// The layers over the face holding `sheet_point` at the model point `image`
/// of `state`, as the viewer sees them; none unless that face puts the sheet
/// point at `image`.
fn covered_at(state: &State, sheet_point: Point, image: Point) -> Option<usize> {
    let face = state.face_at(sheet_point)?;
    let f = state.face_position(face)?;
    let landed = state.geometry().isometries[f].apply(sheet_point);
    if (landed[0] - image[0]).hypot(landed[1] - image[1]) > TOL {
        return None;
    }
    seen_stack(state, image).iter().position(|&g| g == f)
}
