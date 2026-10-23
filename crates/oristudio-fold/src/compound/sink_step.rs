//! What the tools and the panes ask of a sink beside landing it (plan D12,
//! D14, Phase 11): its picture on the state it starts from, before it lands
//! and once it has.
//!
//! - **The picture** is a plain fold's of the whole point
//!   ([`State::fold_action`]: ℓ across the silhouette, the spans where the
//!   point meets it, the faces that move and the grip with its image), since
//!   the geometry is a plain fold's (research §5.4: each tip piece lands at
//!   R_ℓ ∘ T), in the direction the near layer turns as the viewer sees it:
//!   a sink pushes the point in, away from the viewer — a mountain, as an
//!   inside reverse fold is — and an unsink pulls it back out toward them, a
//!   valley.
//! - **The push** is where a folder pushes the point in: a hollow arrow onto
//!   its crown (the paper farthest from ℓ, the middle of it where a sink
//!   before left the top flat), along ℓ's normal toward ℓ, from beyond the
//!   tip. An open and a closed sink are pushed alike: what differs is inside.
//!   An unsink is pulled, not pushed, and has none.

use oristudio_geometry::Line;

use crate::compound::sink::{SinkFold, SinkFolded, SinkKind, SinkStep, Unsink};
use crate::fold::{ActionKind, FoldActionGeometry, FoldAnalysis, Push, Snap};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::FaceId;
use crate::refusal::{Refused, Side};
use crate::scene::ScenePoint;
use crate::state::State;
use crate::view::Direction;

type Point = [f64; 2];

/// How long the push's shaft is, as a share of the crown's height above ℓ,
/// and at least, in model units (the sheet's): a shallow sink's arrow stays
/// long enough to read.
const PUSH_LENGTH: f64 = 0.5;
const PUSH_MIN_LENGTH: f64 = 0.1;

impl SinkStep {
    /// How the viewer sees the near layer turn: a sink pushes the point in, a
    /// mountain; an unsink pulls it back out, a valley (see the module docs).
    pub fn seen_direction(self) -> Direction {
        match self {
            SinkStep::Open | SinkStep::Closed => Direction::Mountain,
            SinkStep::Unsink => Direction::Valley,
        }
    }
}

impl State {
    /// The picture of the sink `op` on this state, before it lands: the
    /// point moving, and the push onto its crown. Refused as
    /// [`State::analyse_sink`] is.
    pub fn sink_action(&self, op: &SinkFold) -> Result<FoldActionGeometry, Refused> {
        let point = self.analyse_sink(op)?;
        let step = match op.kind {
            SinkKind::Open => SinkStep::Open,
            SinkKind::Closed => SinkStep::Closed,
        };
        picture(
            self,
            Moving {
                line: point.line,
                side: point.side,
                snap: point.snap,
                step,
                faces: &point.point.faces,
            },
            None,
        )
    }

    /// The picture of the unsink `op` on this state, before it lands: the
    /// sunk tip moving back out. Refused as [`State::analyse_unsink`] is.
    pub fn unsink_action(&self, op: &Unsink) -> Result<FoldActionGeometry, Refused> {
        let tip = self.analyse_unsink(op)?;
        picture(
            self,
            Moving {
                line: tip.line,
                side: tip.side,
                snap: tip.snap,
                step: SinkStep::Unsink,
                faces: &tip.faces,
            },
            None,
        )
    }
}

impl SinkFolded {
    /// Its picture on `parent`, the state it folded, with the landed state's
    /// cover at the grip's image.
    pub fn action(&self, parent: &State) -> Result<FoldActionGeometry, Refused> {
        let report = &self.report;
        picture(
            parent,
            Moving {
                line: report.line,
                side: report.side,
                snap: report.snap,
                step: report.step,
                faces: &report.fold.moving,
            },
            Some(&self.state),
        )
    }
}

/// What a sink's picture is drawn from: the line, the side the moving paper
/// starts on, and that paper.
struct Moving<'a> {
    line: Line,
    side: Side,
    snap: Snap,
    step: SinkStep,
    faces: &'a [FaceId],
}

/// The plain fold's picture of the moving paper, with a sink's push.
fn picture(
    state: &State,
    moving: Moving<'_>,
    landed: Option<&State>,
) -> Result<FoldActionGeometry, Refused> {
    let analysis = FoldAnalysis {
        line: moving.line,
        side: moving.side,
        snap: moving.snap,
        direction: state.view().model_direction(moving.step.seen_direction()),
        flaps: Vec::new(),
        picked: Vec::new(),
        added: Vec::new(),
        moving: moving.faces.to_vec(),
    };
    let mut action = state.fold_action(&analysis, ActionKind::Fold, landed)?;
    action.push = match moving.step {
        SinkStep::Open | SinkStep::Closed => push(state, &moving.line, moving.side, moving.faces),
        SinkStep::Unsink => None,
    };
    Ok(action)
}

/// The push onto the point's crown, in the scene frame (see the module
/// docs); none when the point does not reach past ℓ.
fn push(state: &State, line: &Line, side: Side, faces: &[FaceId]) -> Option<Push> {
    let toward_tip = match side {
        Side::Positive => 1.0,
        Side::Negative => -1.0,
    };
    // Every corner of the point's faces, with its height above ℓ on the tip
    // side; corners past ℓ, of faces it cuts, are below it.
    let corners: Vec<(Point, f64)> = faces
        .iter()
        .filter_map(|&id| state.face_image(id))
        .flatten()
        .map(|&p| (p, toward_tip * line.signed_distance(p)))
        .collect();
    let crown = corners
        .iter()
        .map(|&(_, h)| h)
        .fold(f64::NEG_INFINITY, f64::max);
    if crown.is_nan() || crown < MIN_FEATURE {
        return None;
    }
    // The middle of the crown along ℓ: the tip itself for a closed point,
    // the middle of its flat top where a sink before left one.
    let along = line.direction();
    let reach = |p: Point| p[0] * along[0] + p[1] * along[1];
    let (mut low, mut high): (Option<Point>, Option<Point>) = (None, None);
    for &(p, h) in &corners {
        if h < crown - TOL {
            continue;
        }
        if low.is_none_or(|q| reach(p) < reach(q)) {
            low = Some(p);
        }
        if high.is_none_or(|q| reach(p) > reach(q)) {
            high = Some(p);
        }
    }
    let (low, high) = (low?, high?);
    let toward: Point = [(low[0] + high[0]) / 2.0, (low[1] + high[1]) / 2.0];
    let length = (PUSH_LENGTH * crown).max(PUSH_MIN_LENGTH);
    let out = [toward_tip * line.n[0], toward_tip * line.n[1]];
    let from: Point = [toward[0] + length * out[0], toward[1] + length * out[1]];
    let to_scene = state.view().transform();
    Some(Push {
        at: ScenePoint::from(to_scene.apply(from)),
        toward: ScenePoint::from(to_scene.apply(toward)),
    })
}
