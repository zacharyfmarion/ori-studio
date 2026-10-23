//! The crease pattern and its faces, in sheet coordinates (plan D2,
//! research §3).
//!
//! # Identity
//!
//! - **Vertices** are only ever appended, so a vertex id is its index.
//! - **Creases** get a fresh id when they are made or split; a split crease's
//!   halves keep its kind and the step that made it.
//! - **Faces** get a fresh id when they are split and remember the face they
//!   came from (their lineage); a face no fold splits keeps its id, which is
//!   what lets the layer order and its constraint problem update only what a
//!   fold touched.
//!
//! Ids only grow: every new id is above every id before it, so the next one is
//! the largest present plus one and no id is ever reused.
//!
//! # Letters
//!
//! Letters are front-relative: a folded crease is a valley iff the face of its
//! two that shows its front lies below the other (research §3.1). That is what
//! is stored and what every export carries; turning the model over changes no
//! letter.

use std::fmt;

pub use oristudio_layer_order::{FaceId, Letter};
use serde::{Deserialize, Serialize};

/// A crease-pattern vertex: its index in [`crate::State::vertices`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct VertexId(pub u32);

impl VertexId {
    pub(crate) fn index(self) -> usize {
        self.0 as usize
    }
}

impl fmt::Display for VertexId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "v{}", self.0)
    }
}

/// A crease's identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EdgeId(pub u32);

impl fmt::Display for EdgeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "e{}", self.0)
    }
}

/// What a crease is now: `B | M | V | F`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "letter")]
pub enum CreaseKind {
    /// The paper's raw edge.
    Border,
    /// Folded, with its front-relative letter.
    Folded(Letter),
    /// Unfolded (a precrease, or a fold since undone), remembering the letter
    /// it had when it was last folded.
    Flat(Letter),
}

impl CreaseKind {
    pub fn is_folded(self) -> bool {
        matches!(self, CreaseKind::Folded(_))
    }

    /// The letter it has (folded) or remembers (flat); none for a border.
    pub fn letter(self) -> Option<Letter> {
        match self {
            CreaseKind::Border => None,
            CreaseKind::Folded(l) | CreaseKind::Flat(l) => Some(l),
        }
    }
}

/// One crease-pattern edge.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Crease {
    pub id: EdgeId,
    pub vertices: [VertexId; 2],
    pub kind: CreaseKind,
    /// The step that made the crease; 0 for the sheet's border. The halves of
    /// a split crease keep it.
    pub made_at: u32,
}

/// One face: a convex vertex ring, counter-clockwise in sheet coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Face {
    pub id: FaceId,
    pub ring: Vec<VertexId>,
    /// The face this one was split from; none for the sheet's face.
    pub parent: Option<FaceId>,
    /// The step that made the face.
    pub born: u32,
}

/// The other letter.
pub fn opposite(letter: Letter) -> Letter {
    match letter {
        Letter::Mountain => Letter::Valley,
        Letter::Valley => Letter::Mountain,
    }
}
