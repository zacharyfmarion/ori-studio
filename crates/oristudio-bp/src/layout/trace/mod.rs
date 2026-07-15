mod core;
mod hinge_segment;

pub use core::{
    RepoTrace, Ridge, RidgeIntersection, SideDiagonal, Trace, TraceLine, TraceNode,
    get_next_intersection,
};
pub use hinge_segment::{HingeSegment, create_hinge_segments};
