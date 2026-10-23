//! What the tools and the panes ask of a reverse fold beside landing it
//! (plan D12, D14, Phase 9): its picture on the state it starts from, its
//! summary, and the orders a choice lists.
//!
//! - **The picture** is a plain fold's of the whole tip ([`State::fold_action`]:
//!   ℓ across the silhouette, the spans where the tip meets it, the faces that
//!   move and the grip with its image), since the geometry is a plain fold's
//!   (research §5.2), in the direction the near layer turns:
//! - **The direction.** An inside fold turns each flap's upper block down
//!   between the layers and its lower block up, an outside fold the reverse
//!   ([`StepMotion`](super::motion::StepMotion)). The viewer sees the upper
//!   blocks — or, with the view turned over, the lower ones turning the
//!   other way — so an inside fold is a mountain as the viewer sees it and
//!   an outside fold a valley.
//! - **The push** is where a folder pushes the spine in for an inside fold:
//!   an arrow at the opening's spine, from the side of it with no paper, a
//!   share of the way from ℓ to where the spine's creases end on the tip
//!   side. The first opening's; an outside fold wraps round and is not
//!   pushed.
//! - **The summary** is a fold's (`crate::summary`): the child's counts, the
//!   crease-pattern diff by geometry (the spine creases are *reversed*), and
//!   the display layers along ℓ in the parent.
//! - **The orders to choose from**, when the completion leaves several, are
//!   the product of each component's listed orders, in order, capped.

use oristudio_geometry::Line;

use crate::compound::CompoundRefused;
use crate::compound::reverse::{
    Opening, ReverseChoice, ReverseChoices, ReverseFold, ReverseFolded, ReverseKind,
};
use crate::fold::{ActionKind, FoldActionGeometry, FoldAnalysis, Push, Snap};
use crate::numerics::{MIN_FEATURE, TOL};
use crate::pattern::FaceId;
use crate::refusal::{Refused, Side};
use crate::scene::ScenePoint;
use crate::state::State;
use crate::summary::StepSummary;
use crate::view::Direction;

type Point = [f64; 2];

/// How far along the spine's tip-side reach the push lands, and how long
/// its shaft is, as shares of that reach.
const PUSH_AT: f64 = 0.4;
const PUSH_LENGTH: f64 = 0.5;

impl ReverseKind {
    /// How the viewer sees the near layer turn: an inside fold is a
    /// mountain, an outside fold a valley (see the module docs).
    pub fn seen_direction(self) -> Direction {
        match self {
            ReverseKind::Inside => Direction::Mountain,
            ReverseKind::Outside => Direction::Valley,
        }
    }
}

impl State {
    /// The picture of the reverse fold `op` with `choices` on this state,
    /// before it lands: no grip image's cover. The opening drawn is the one
    /// `choices` names, or the first listed.
    pub fn reverse_action(
        &self,
        op: &ReverseFold,
        choices: &ReverseChoices,
    ) -> Result<FoldActionGeometry, CompoundRefused> {
        let analysis = self.analyse_reverse(op).map_err(CompoundRefused::Refused)?;
        let named = |o: &&Opening| choices.openings.contains(&o.stored);
        let openings = analysis.flaps.iter().flat_map(|flap| &flap.openings);
        let opening = openings
            .clone()
            .find(named)
            .or_else(|| openings.clone().next());
        let mut action = self
            .fold_action(
                &tip_analysis(
                    self,
                    analysis.line,
                    analysis.side,
                    analysis.snap,
                    op.kind,
                    &analysis.tip,
                ),
                ActionKind::Fold,
                None,
            )
            .map_err(CompoundRefused::Refused)?;
        action.push = opening.and_then(|o| push(self, &analysis.line, analysis.side, op.kind, o));
        Ok(action)
    }
}

impl ReverseFolded {
    /// Its picture on `parent`, the state it folded, with the landed state's
    /// cover at the grip's image.
    pub fn action(&self, parent: &State) -> Result<FoldActionGeometry, Refused> {
        let report = &self.report;
        let mut action = parent.fold_action(
            &tip_analysis(
                parent,
                report.line,
                report.side,
                report.snap,
                report.kind,
                &report.fold.moving,
            ),
            ActionKind::Fold,
            Some(&self.state),
        )?;
        action.push = report
            .openings
            .first()
            .and_then(|o| push(parent, &report.line, report.side, report.kind, o));
        Ok(action)
    }

    /// Its summary: `parent` is the state it folded, whose cross-section
    /// along ℓ gives the layers.
    pub fn summary(&self, parent: &State) -> Result<StepSummary, Refused> {
        let section = parent.cross_section(&self.report.line, self.report.side)?;
        Ok(StepSummary::new(parent, &self.state, Some(section.layers)))
    }
}

impl ReverseChoice {
    /// The first `cap` orders to choose from, each as one listed order per
    /// component ([`ReverseChoice::pick`]'s argument), and whether there are
    /// more ([`Completions::picks`](crate::complete::Completions::picks)).
    pub fn choices(&self, cap: usize) -> (Vec<Vec<usize>>, bool) {
        self.completions().picks(cap)
    }
}

/// The plain-fold analysis the picture is drawn from: the whole tip moving,
/// in the model frame's direction of what the viewer sees.
fn tip_analysis(
    state: &State,
    line: Line,
    side: Side,
    snap: Snap,
    kind: ReverseKind,
    tip: &[FaceId],
) -> FoldAnalysis {
    FoldAnalysis {
        line,
        side,
        snap,
        direction: state.view().model_direction(kind.seen_direction()),
        flaps: Vec::new(),
        picked: Vec::new(),
        added: Vec::new(),
        moving: tip.to_vec(),
    }
}

/// The push arrow of an inside fold's opening, in the scene frame (see the
/// module docs); none for an outside fold, a bent pocket boundary with no
/// single push edge, or a spine parallel to ℓ or not reaching past it.
fn push(
    state: &State,
    line: &Line,
    side: Side,
    kind: ReverseKind,
    opening: &Opening,
) -> Option<Push> {
    if kind != ReverseKind::Inside {
        return None;
    }
    let spine = opening.spine.as_ref()?;
    let at = spine.intersect(line)?;
    // Along the spine toward the tip side of ℓ.
    let mut along = spine.direction();
    let toward_tip =
        line.signed_distance([at[0] + along[0], at[1] + along[1]]) - line.signed_distance(at);
    let tip_sign = match side {
        Side::Positive => 1.0,
        Side::Negative => -1.0,
    };
    if toward_tip * tip_sign < 0.0 {
        along = [-along[0], -along[1]];
    }
    // How far the spine's creases reach into the tip.
    let reach = opening
        .across
        .iter()
        .filter_map(|&edge| state.crease(edge))
        .flat_map(|crease| crease.vertices)
        .filter_map(|v| state.vertex_image(v))
        .map(|p| (p[0] - at[0]) * along[0] + (p[1] - at[1]) * along[1])
        .fold(0.0_f64, f64::max);
    if reach < MIN_FEATURE {
        return None;
    }
    // Which side of the spine the opening's paper is on: a folded crease has
    // both its faces on one side, so the faces' middles say. The push comes
    // from the other side.
    let paper: f64 = opening
        .lower
        .iter()
        .chain(&opening.upper)
        .filter_map(|&id| state.face_image(id))
        .filter(|image| !image.is_empty())
        .map(|image| {
            let n = image.len() as f64;
            let middle = image
                .iter()
                .fold([0.0, 0.0], |m, p| [m[0] + p[0] / n, m[1] + p[1] / n]);
            spine.signed_distance(middle)
        })
        .sum();
    if paper.abs() <= TOL {
        return None;
    }
    let out = if paper > 0.0 {
        [-spine.n[0], -spine.n[1]]
    } else {
        spine.n
    };
    let toward: Point = [
        at[0] + PUSH_AT * reach * along[0],
        at[1] + PUSH_AT * reach * along[1],
    ];
    let from: Point = [
        toward[0] + PUSH_LENGTH * reach * out[0],
        toward[1] + PUSH_LENGTH * reach * out[1],
    ];
    let to_scene = state.view().transform();
    Some(Push {
        at: ScenePoint::from(to_scene.apply(from)),
        toward: ScenePoint::from(to_scene.apply(toward)),
    })
}
