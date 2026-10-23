//! A dense table over pairs of a view's face positions, for the loops that
//! visit every pair of every cell (Σ ply² lookups: tens of millions on a
//! 300-face state with stacks 200 deep, where ordered-map lookups cost
//! hundreds of milliseconds); and a set of face ids for the rebuilds, which
//! ask whether each pair and constraint of the previous problem was touched.

use std::collections::BTreeSet;

use crate::order::LayerOrder;
use crate::view::{FaceId, FoldedView, MAX_FACES};

/// A set of face ids: a table on the id when its largest id is small enough
/// for one (the engine's and FOLD's are), else the ordered set.
pub(crate) enum IdSet {
    Dense(Vec<bool>),
    Sparse(BTreeSet<FaceId>),
}

impl IdSet {
    pub(crate) fn new(set: &BTreeSet<FaceId>) -> IdSet {
        match set.last() {
            Some(&FaceId(last)) if (last as usize) < 64 * set.len() + 4096 => {
                let mut dense = vec![false; last as usize + 1];
                for &FaceId(id) in set {
                    dense[id as usize] = true;
                }
                IdSet::Dense(dense)
            }
            Some(_) => IdSet::Sparse(set.clone()),
            None => IdSet::Dense(Vec::new()),
        }
    }

    pub(crate) fn contains(&self, face: FaceId) -> bool {
        match self {
            IdSet::Dense(dense) => dense.get(face.0 as usize).copied().unwrap_or(false),
            IdSet::Sparse(set) => set.contains(&face),
        }
    }

    /// Whether any of the faces is in the set.
    pub(crate) fn any(&self, faces: &[FaceId]) -> bool {
        faces.iter().any(|&f| self.contains(f))
    }
}

pub(crate) struct PairTable<T> {
    n: usize,
    entries: Vec<T>,
}

impl<T: Copy + Default> PairTable<T> {
    pub(crate) fn new(n: usize) -> PairTable<T> {
        PairTable::filled(n, T::default())
    }
}

impl<T: Copy> PairTable<T> {
    /// `n` is a view's face count, which [`FoldedView::new`] keeps to
    /// [`MAX_FACES`]: what bounds the `n²` entries.
    pub(crate) fn filled(n: usize, value: T) -> PairTable<T> {
        debug_assert!(n <= MAX_FACES, "a table over {n} faces");
        PairTable {
            n,
            entries: vec![value; n * n],
        }
    }

    pub(crate) fn get(&self, i: usize, j: usize) -> T {
        self.entries[i * self.n + j]
    }

    pub(crate) fn set(&mut self, i: usize, j: usize, value: T) {
        self.entries[i * self.n + j] = value;
    }
}

impl PairTable<i8> {
    /// The order on the view's faces: `1` where row lies above column, `-1`
    /// below, `0` when absent or undetermined.
    pub(crate) fn of_order(view: &FoldedView, order: &LayerOrder) -> PairTable<i8> {
        let mut table = PairTable::new(view.faces().len());
        for (pair, lo_above) in order.pairs() {
            let (Some(lo), Some(hi), Some(lo_above)) =
                (view.index_of(pair.lo()), view.index_of(pair.hi()), lo_above)
            else {
                continue;
            };
            let v = if lo_above { 1 } else { -1 };
            table.set(lo, hi, v);
            table.set(hi, lo, -v);
        }
        table
    }
}
