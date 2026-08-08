//! The stateful object behind a 3D folded-figure handle.
//!
//! **Ori Studio native.** See [`crate::folding3d`].
//!
//! This is the one place the five earlier stages are composed, and it is
//! deliberately the *only* one: a caller that wanted a placement, a census and
//! an ordering would otherwise have to know the order they run in and which of
//! them may be skipped, and two callers knowing that is two callers to keep in
//! step.
//!
//! # What the boundary promises, and what it does not
//!
//! It promises a **stream contract** and says nothing about how enumeration is
//! implemented: deterministic, forward-only, restartable from the beginning,
//! with a monotone discovered count and a repeatable wrap. Solution *N* is the
//! same solution on every run of the same segments — components are ordered by
//! variable count with ties broken by lowest member face, and nothing in the
//! search reaches a hash iteration.
//!
//! It does **not** promise a layer order. When the ordering solver cannot
//! answer, that is the third arm of the verdict and not a refusal: the figure
//! still places, still draws, and every cell it could not decide is annotated.
//! The stream then has exactly one element.
//!
//! # Refusal versus verdict
//!
//! [`Fold3dRefusal`] means *no figure*. [`crate::folding3d::wire::Fold3dVerdict`]
//! means *a figure, and here is what is true about it*. They are different types
//! because they have different consequences at the UI: a refusal offers the
//! inline simulator, a verdict draws.

use crate::folding::FoldedFigureModel;
use crate::folding3d::admit::{Admission, admit_with};
use crate::folding3d::cells::CellIndex;
use crate::folding3d::census::{Fold3dCensus, census_placement, tolerance_refusal};
use crate::folding3d::interchange::{FoldedFormTooLarge, folded_form_frame};
use crate::folding3d::model::{Folded3dRenderModel, RenderModelError, render_model};
use crate::folding3d::order::{Advance, Fold3dOrderEnumerator, Fold3dOrderError};
use crate::folding3d::planes::PlaneIndex;
use crate::folding3d::snapshot::{Fold3dSnapshot, snapshot};
use crate::folding3d::{Fold3dRefusal, Fold3dTolerances};
use crate::geometry::LineSegment;
use treemaker_fold::FoldDocument;

/// Why a 3D fold could not be produced or stepped.
///
/// [`Self::Render`] is an internal invariant of
/// [`crate::folding3d::model::render_model`] and is not expected to be
/// reachable; it exists because the alternative in this pipeline is never a
/// crash but a plausible picture.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Fold3dSessionError {
    Refused(Fold3dRefusal),
    Order(Fold3dOrderError),
    Render(RenderModelError),
}

impl std::fmt::Display for Fold3dSessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(refusal) => refusal.fmt(f),
            Self::Order(error) => error.fmt(f),
            Self::Render(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for Fold3dSessionError {}

impl From<Fold3dRefusal> for Fold3dSessionError {
    fn from(refusal: Fold3dRefusal) -> Self {
        Self::Refused(refusal)
    }
}

impl From<RenderModelError> for Fold3dSessionError {
    fn from(error: RenderModelError) -> Self {
        Self::Render(error)
    }
}

impl From<Fold3dOrderError> for Fold3dSessionError {
    fn from(error: Fold3dOrderError) -> Self {
        Self::Order(error)
    }
}

/// One 3D folded figure, and its stream of layer orders.
#[derive(Debug, Clone)]
pub struct Fold3dSession {
    admission: Admission,
    index: PlaneIndex,
    census: Fold3dCensus,
    cells: CellIndex,
    model: FoldedFigureModel,
    /// `None` when the ordering solver could not answer; `order_error` says why
    /// and the verdict carries it. Exactly one of the two is `Some`.
    enumerator: Option<Fold3dOrderEnumerator>,
    order_error: Option<Fold3dOrderError>,
    render: Folded3dRenderModel,
}

impl Fold3dSession {
    /// Place, measure and order a segment set.
    ///
    /// Takes the segments and nothing else besides the starting face and the
    /// display model — never a document plus a slice of it, which is the shape
    /// of the bug where the two disagree about what is being folded.
    pub fn new(
        segments: &[LineSegment],
        starting_face_id: i32,
        model: FoldedFigureModel,
    ) -> Result<Self, Fold3dSessionError> {
        Self::with_tolerances(segments, starting_face_id, model, Fold3dTolerances::DEFAULT)
    }

    pub fn with_tolerances(
        segments: &[LineSegment],
        starting_face_id: i32,
        model: FoldedFigureModel,
        tolerances: Fold3dTolerances,
    ) -> Result<Self, Fold3dSessionError> {
        let admission = admit_with(segments, starting_face_id, tolerances)?;
        let (index, census) = census_placement(&admission.placement, tolerances);
        if let Some(refusal) = tolerance_refusal(&index, admission.placement.span) {
            return Err(refusal.into());
        }

        // The arrangement is the expensive half, and both the ordering search
        // and the render model consume it. A failure here is a verdict, not a
        // refusal — the placement is sound and the figure draws.
        let (cells, mut order_error) = match crate::folding3d::cells::cell_index(
            &index,
            &census,
            admission.placement.span,
            tolerances,
        ) {
            Ok(cells) => (cells, None),
            Err(error) => (empty_cells(), Some(Fold3dOrderError::from(error))),
        };
        let enumerator = if order_error.is_some() {
            None
        } else {
            match Fold3dOrderEnumerator::with_cells(
                &admission.placement,
                &index,
                &census,
                &cells,
                tolerances,
            ) {
                Ok(enumerator) => Some(enumerator),
                Err(error) => {
                    order_error = Some(error);
                    None
                }
            }
        };

        let render = render_model(
            &admission.placement,
            &index,
            &cells,
            enumerator.as_ref().map(Fold3dOrderEnumerator::current),
        )?;

        Ok(Self {
            admission,
            index,
            census,
            cells,
            model,
            enumerator,
            order_error,
            render,
        })
    }

    /// The scalars, for this solution.
    pub fn snapshot(&self) -> Fold3dSnapshot {
        snapshot(
            self.model.clone(),
            &self.admission,
            &self.index,
            &self.census,
            &self.cells,
            self.ordering(),
            &self.render,
        )
    }

    /// The geometry, for this solution.
    ///
    /// A borrow rather than a build: it is emitted once per fold and once per
    /// [`Self::advance`], and there is deliberately no per-frame way to ask for
    /// it.
    pub fn render_model(&self) -> &Folded3dRenderModel {
        &self.render
    }

    /// This solution as a FOLD `foldedForm` frame.
    ///
    /// Interchange, not a second render path — see
    /// [`crate::folding3d::interchange`] for what it carries and what it
    /// deliberately refuses to claim. Built on demand rather than held, because
    /// it is written once per export and nothing reads it in between.
    pub fn folded_form_frame(
        &self,
        title: Option<String>,
    ) -> Result<FoldDocument, FoldedFormTooLarge> {
        folded_form_frame(
            &self.admission.placement,
            &self.index,
            self.enumerator.as_ref().map(Fold3dOrderEnumerator::current),
            title,
        )
    }

    /// Replace the display model. Geometry and ordering are untouched.
    pub fn set_model(&mut self, model: FoldedFigureModel) {
        self.model = model;
    }

    pub fn model(&self) -> &FoldedFigureModel {
        &self.model
    }

    pub fn admission(&self) -> &Admission {
        &self.admission
    }

    pub fn planes(&self) -> &PlaneIndex {
        &self.index
    }

    pub fn census(&self) -> &Fold3dCensus {
        &self.census
    }

    /// Whether another solution is reachable without wrapping.
    pub fn can_advance(&self) -> bool {
        self.enumerator
            .as_ref()
            .is_some_and(Fold3dOrderEnumerator::can_advance)
    }

    /// Step to the next solution, wrapping to the first when exhausted.
    ///
    /// With no ordering there is exactly one state, so this reports
    /// [`Advance::WrappedToFirst`] without doing anything — the same answer a
    /// one-solution model gives, which is what keeps the cycling UI from
    /// needing to know the difference.
    pub fn advance(&mut self) -> Result<Advance, Fold3dSessionError> {
        let Some(enumerator) = self.enumerator.as_mut() else {
            return Ok(Advance::WrappedToFirst);
        };
        let advance = enumerator.advance()?;
        self.render = render_model(
            &self.admission.placement,
            &self.index,
            &self.cells,
            Some(enumerator.current()),
        )?;
        Ok(advance)
    }

    fn ordering(&self) -> Result<&crate::folding3d::order::Fold3dOrdering, Fold3dOrderError> {
        match (&self.enumerator, self.order_error) {
            (Some(enumerator), _) => Ok(enumerator.current()),
            (None, Some(error)) => Err(error),
            // Unreachable by construction: `new` sets exactly one of the two.
            // Reported as a search failure rather than unwrapped, because a
            // panic at the engine boundary takes the whole session with it.
            (None, None) => Err(Fold3dOrderError::SearchFailed { component: 0 }),
        }
    }
}

fn empty_cells() -> CellIndex {
    CellIndex {
        cells: Vec::new(),
        subfaces: Vec::new(),
        subface_plane: Vec::new(),
        groups: 0,
        components: 0,
        cells_below_bar: 0,
    }
}
