//! The spots of a folded figure and what is stacked on each, for an order.
//!
//! A *spot* (a cell, Oriedita's subface) is one subface the paper scene
//! draws, numbered as [`FoldedPaperScene::subfaces`] numbers them
//! ([`FoldedRenderInputs::scene_subface_face_ids`]), so a pane that holds
//! one scene can restack it for another order without asking for a new
//! scene, and a hit test on a scene's subface reads the stack of the same
//! number.
//!
//! [`FoldedPaperScene::subfaces`]: oristudio_cp::folding::FoldedPaperScene::subfaces

use oristudio_cp::folding::FoldedRenderInputs;
use oristudio_layer_order::FacePair;
use serde::Serialize;
use treemaker_flatfold::PairOrder;

/// Which side of the folded paper is seen: the front pass (a viewer at +z,
/// who sees the starting face's front) or the back pass (Oriedita's `Back1`,
/// the figure turned over).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewSide {
    Front,
    Back,
}

/// Per spot, its faces from the top as seen from one side: exactly the
/// paper scene's `faces_top_to_bottom` for that side and order. Packed: spot
/// `i`'s faces are `faces[offsets[i]..offsets[i + 1]]`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Stacks {
    offsets: Vec<u32>,
    faces: Vec<u32>,
}

impl Stacks {
    /// How many spots.
    pub fn len(&self) -> usize {
        self.offsets.len().saturating_sub(1)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Spot `i`'s faces, top first; empty past the last spot.
    pub fn spot(&self, i: usize) -> &[u32] {
        match (self.offsets.get(i), self.offsets.get(i + 1)) {
            (Some(&a), Some(&b)) => &self.faces[a as usize..b as usize],
            _ => &[],
        }
    }

    /// The face on top of spot `i`.
    pub fn top(&self, i: usize) -> Option<u32> {
        self.spot(i).first().copied()
    }

    /// `len() + 1` offsets into [`Self::faces`], from 0.
    pub fn offsets(&self) -> &[u32] {
        &self.offsets
    }

    /// Every spot's faces, one after another.
    pub fn faces(&self) -> &[u32] {
        &self.faces
    }

    /// The same stacks seen from the other side.
    fn turned_over(&self) -> Stacks {
        let mut faces = Vec::with_capacity(self.faces.len());
        for i in 0..self.len() {
            faces.extend(self.spot(i).iter().rev());
        }
        Stacks {
            offsets: self.offsets.clone(),
            faces,
        }
    }

    /// These front stacks as seen from `side`.
    pub(crate) fn seen_from(&self, side: ViewSide) -> Stacks {
        match side {
            ViewSide::Front => self.clone(),
            ViewSide::Back => self.turned_over(),
        }
    }

    /// The face on top of spot `i` from `side`, for these front stacks.
    fn top_from(&self, i: usize, side: ViewSide) -> Option<u32> {
        let spot = self.spot(i);
        match side {
            ViewSide::Front => spot.first().copied(),
            ViewSide::Back => spot.last().copied(),
        }
    }
}

/// The spots whose top face differs between two orders, per side, ascending:
/// what a preview marks and what Add, remove, undo and Clear all flash.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ChangedSpots {
    pub front: Vec<u32>,
    pub back: Vec<u32>,
}

impl ChangedSpots {
    /// Between two front stacks over the same spots.
    pub(crate) fn between(before: &Stacks, after: &Stacks) -> ChangedSpots {
        let changed = |side| {
            (0..before.len().min(after.len()))
                .filter(|&i| before.top_from(i, side) != after.top_from(i, side))
                .map(|i| i as u32)
                .collect()
        };
        ChangedSpots {
            front: changed(ViewSide::Front),
            back: changed(ViewSide::Back),
        }
    }

    /// Whether no spot changed from either side.
    pub fn is_empty(&self) -> bool {
        self.front.is_empty() && self.back.is_empty()
    }
}

/// The spots and the faces under each, as the kernel lists them.
#[derive(Debug, Clone)]
pub(crate) struct Spots {
    offsets: Vec<u32>,
    faces: Vec<u32>,
    face_count: usize,
}

impl Spots {
    pub(crate) fn of(inputs: &FoldedRenderInputs, face_count: usize) -> Spots {
        let mut offsets = vec![0u32];
        let mut faces = Vec::new();
        for spot in inputs.scene_subface_face_ids() {
            faces.extend(spot.iter().map(|&f| f as u32));
            offsets.push(faces.len() as u32);
        }
        Spots {
            offsets,
            faces,
            face_count,
        }
    }

    /// Spots from their faces' lists, for a problem with `face_count` faces
    /// that no kernel folded (the solution count's own tests).
    #[cfg(test)]
    pub(crate) fn from_lists(lists: &[Vec<u32>], face_count: usize) -> Spots {
        let mut offsets = vec![0u32];
        let mut faces = Vec::new();
        for spot in lists {
            faces.extend_from_slice(spot);
            offsets.push(faces.len() as u32);
        }
        Spots {
            offsets,
            faces,
            face_count,
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.offsets.len() - 1
    }

    /// Spot `i`'s faces, as the kernel lists them.
    pub(crate) fn spot(&self, i: usize) -> &[u32] {
        &self.faces[self.offsets[i] as usize..self.offsets[i + 1] as usize]
    }

    /// How many faces the view has.
    pub(crate) fn face_count(&self) -> usize {
        self.face_count
    }

    /// Every face named is a face of the view.
    pub(crate) fn faces_in_range(&self) -> bool {
        self.faces.iter().all(|&f| (f as usize) < self.face_count)
    }

    /// Every spot's faces stacked by the complete order `values` (one per
    /// variable of `variables`), top first from the front: the kernel's own
    /// rule (`subface_top_stack`), a face's place from the top being one more
    /// than the number of the spot's faces above it, and a face that has no
    /// place of its own left out. A complete order that fits is total on
    /// every spot, so then every face has one.
    pub(crate) fn stacks(&self, variables: &[FacePair], values: &[PairOrder]) -> Stacks {
        let above = AboveTable::of(self.face_count, variables, values);
        let mut faces = Vec::with_capacity(self.faces.len());
        let mut slots: Vec<Option<u32>> = Vec::new();
        let mut offsets = Vec::with_capacity(self.offsets.len());
        offsets.push(0u32);
        for w in self.offsets.windows(2) {
            let spot = &self.faces[w[0] as usize..w[1] as usize];
            let k = spot.len();
            slots.clear();
            slots.resize(k, None);
            for &f in spot {
                let above_count = spot
                    .iter()
                    .filter(|&&g| g != f && above.above(f, g))
                    .count();
                if let Some(slot) = k.checked_sub(above_count + 1).map(|p| &mut slots[p]) {
                    *slot = Some(f);
                }
            }
            faces.extend(slots.iter().flatten());
            offsets.push(faces.len() as u32);
        }
        Stacks { offsets, faces }
    }
}

/// Which face of every pair lies above, as a bit per pair `lo < hi` set when
/// `lo` lies above: `n²/2` bits, 1 MB at the face cap.
struct AboveTable {
    n: usize,
    bits: Vec<u64>,
}

impl AboveTable {
    fn of(n: usize, variables: &[FacePair], values: &[PairOrder]) -> AboveTable {
        let mut table = AboveTable {
            n,
            bits: vec![0; (n * n).div_ceil(64)],
        };
        for (pair, value) in variables.iter().zip(values) {
            if *value == PairOrder::FirstAbove {
                let i = pair.lo().0 as usize * n + pair.hi().0 as usize;
                table.bits[i / 64] |= 1 << (i % 64);
            }
        }
        table
    }

    /// Whether `f` lies above `g`. Every pair of faces sharing a spot is a
    /// variable (the source refuses a fold where one is not), so the table
    /// has every pair it is asked about.
    fn above(&self, f: u32, g: u32) -> bool {
        let (lo, hi) = if f < g { (f, g) } else { (g, f) };
        let i = lo as usize * self.n + hi as usize;
        let lo_above = self
            .bits
            .get(i / 64)
            .is_some_and(|w| w & (1 << (i % 64)) != 0);
        lo_above == (f == lo)
    }
}
