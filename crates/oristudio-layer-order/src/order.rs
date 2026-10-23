//! The layer order: which face of an overlapping pair is nearer the viewer.
//!
//! Stored per pair in absolute terms (`above` = nearer the viewer at +z),
//! antisymmetric by construction. It is a relation, not a stack: a woven state
//! orders three faces cyclically where no point lies in all three, so no
//! global z-index exists (research §2.1; the FOLD spec's square twist). A pair
//! can be present but *undetermined*, for a completion that left it free; the
//! checker reports such pairs instead of guessing.
//!
//! # Conventions
//!
//! | Form | Rule |
//! |---|---|
//! | Ours | `above(f, g)`: f is nearer the viewer at +z where they overlap |
//! | FOLD `faceOrders` | `[f, g, s]`: s = +1 iff f lies on the side g's front normal points to, so s = +1 iff `above(f, g) == front_up(g)`; s = 0 is an unknown order |
//! | Oriedita | `upper_face` is nearer a viewer of the *starting face's* front, so `upper = above` when the starting face is front-up and `upper = below` otherwise |
//!
//! The FOLD rule matches Flat-Folder's `edges_Ff_2_FO`. The Oriedita rule was
//! calibrated on 1,685 states (research r3-reuse-solver §2): every order
//! verified under it, and 1,667 were contradicted under the opposite rule.
//! A FOLD triple is independent of the view: turning the model over inverts
//! both `above` and `front_up`.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::error::LayerOrderError;
use crate::table::PairTable;
use crate::view::{FaceId, FoldedView};

/// An unordered pair of distinct faces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct FacePair {
    lo: FaceId,
    hi: FaceId,
}

impl FacePair {
    /// The pair of `a` and `b` in either order; `None` when they are the same
    /// face.
    pub fn new(a: FaceId, b: FaceId) -> Option<FacePair> {
        match a.cmp(&b) {
            std::cmp::Ordering::Less => Some(FacePair { lo: a, hi: b }),
            std::cmp::Ordering::Greater => Some(FacePair { lo: b, hi: a }),
            std::cmp::Ordering::Equal => None,
        }
    }

    /// The face with the smaller id.
    pub fn lo(&self) -> FaceId {
        self.lo
    }

    /// The face with the larger id.
    pub fn hi(&self) -> FaceId {
        self.hi
    }

    pub fn faces(&self) -> [FaceId; 2] {
        [self.lo, self.hi]
    }

    pub fn contains(&self, face: FaceId) -> bool {
        self.lo == face || self.hi == face
    }
}

impl fmt::Display for FacePair {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {})", self.lo, self.hi)
    }
}

/// Where one face lies relative to another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stacking {
    Above,
    Below,
    /// The pair is part of the order, but which face is on top is open.
    Undetermined,
}

/// Oriedita's form of one relation (`folding::HierarchyRelation`), on our
/// face ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct OrieditaRelation {
    pub upper_face: FaceId,
    pub lower_face: FaceId,
}

/// The pairwise layer order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LayerOrder {
    /// `Some(true)`: the pair's `lo` face is above its `hi` face.
    pairs: BTreeMap<FacePair, Option<bool>>,
}

impl LayerOrder {
    pub fn new() -> LayerOrder {
        LayerOrder::default()
    }

    /// Record that `upper` lies above `lower`, replacing any earlier entry
    /// for the pair.
    pub fn set_above(&mut self, upper: FaceId, lower: FaceId) -> Result<(), LayerOrderError> {
        let pair = FacePair::new(upper, lower).ok_or(LayerOrderError::SameFace(upper))?;
        self.pairs.insert(pair, Some(pair.lo == upper));
        Ok(())
    }

    /// Record the pair with its order open, replacing any earlier entry.
    pub fn set_undetermined(&mut self, a: FaceId, b: FaceId) -> Result<(), LayerOrderError> {
        let pair = FacePair::new(a, b).ok_or(LayerOrderError::SameFace(a))?;
        self.pairs.insert(pair, None);
        Ok(())
    }

    /// Drop the pair; whether it was there.
    pub fn remove(&mut self, a: FaceId, b: FaceId) -> bool {
        FacePair::new(a, b).is_some_and(|pair| self.pairs.remove(&pair).is_some())
    }

    /// Where `f` lies relative to `g`; `None` when the pair is not in the
    /// order.
    pub fn stacking(&self, f: FaceId, g: FaceId) -> Option<Stacking> {
        let pair = FacePair::new(f, g)?;
        let lo_above = self.pairs.get(&pair)?;
        Some(match lo_above {
            None => Stacking::Undetermined,
            Some(lo_above) if *lo_above == (pair.lo == f) => Stacking::Above,
            Some(_) => Stacking::Below,
        })
    }

    /// Whether `f` lies above `g`; `None` when the pair is absent or
    /// undetermined.
    pub fn above(&self, f: FaceId, g: FaceId) -> Option<bool> {
        match self.stacking(f, g)? {
            Stacking::Above => Some(true),
            Stacking::Below => Some(false),
            Stacking::Undetermined => None,
        }
    }

    pub fn contains(&self, a: FaceId, b: FaceId) -> bool {
        FacePair::new(a, b).is_some_and(|pair| self.pairs.contains_key(&pair))
    }

    pub fn len(&self) -> usize {
        self.pairs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pairs.is_empty()
    }

    /// Every pair, in pair order, with whether its `lo` face is above (`None`
    /// when undetermined).
    pub fn pairs(&self) -> impl Iterator<Item = (FacePair, Option<bool>)> + '_ {
        self.pairs.iter().map(|(pair, lo_above)| (*pair, *lo_above))
    }

    /// The pairs whose order is open.
    pub fn undetermined(&self) -> impl Iterator<Item = FacePair> + '_ {
        self.pairs
            .iter()
            .filter(|(_, lo_above)| lo_above.is_none())
            .map(|(pair, _)| *pair)
    }

    /// The order seen after turning the model over: every `above` inverts.
    pub fn turned_over(&self) -> LayerOrder {
        LayerOrder {
            pairs: self
                .pairs
                .iter()
                .map(|(pair, lo_above)| (*pair, lo_above.map(|a| !a)))
                .collect(),
        }
    }

    /// FOLD `faceOrders`, one `[f, g, s]` per determined pair with `f` its
    /// smaller id; faces are named by their [`FaceId`] value. A writer whose
    /// face indices differ from the ids maps them.
    pub fn to_fold_face_orders(&self, view: &FoldedView) -> Result<Vec<[i64; 3]>, LayerOrderError> {
        let mut out = Vec::with_capacity(self.pairs.len());
        for (pair, lo_above) in &self.pairs {
            let Some(lo_above) = lo_above else {
                continue;
            };
            let hi_front_up = view
                .front_up(pair.hi)
                .ok_or(LayerOrderError::FaceNotInView(pair.hi))?;
            if view.face(pair.lo).is_none() {
                return Err(LayerOrderError::FaceNotInView(pair.lo));
            }
            let s = if *lo_above == hi_front_up { 1 } else { -1 };
            out.push([i64::from(pair.lo.0), i64::from(pair.hi.0), s]);
        }
        Ok(out)
    }

    /// The order a FOLD `faceOrders` array states, faces named by
    /// [`FaceId`] value. `s = 0` records the pair as undetermined; an entry
    /// and its reverse may both appear if they agree.
    pub fn from_fold_face_orders(
        face_orders: &[[i64; 3]],
        view: &FoldedView,
    ) -> Result<LayerOrder, LayerOrderError> {
        let mut order = LayerOrder::new();
        for (index, &[f, g, s]) in face_orders.iter().enumerate() {
            let invalid = |reason| LayerOrderError::InvalidFaceOrder { index, reason };
            let id = |x: i64| u32::try_from(x).map(FaceId);
            let (Ok(f), Ok(g)) = (id(f), id(g)) else {
                return Err(invalid("a face index is not a face id"));
            };
            let pair = FacePair::new(f, g).ok_or(invalid("a face is ordered against itself"))?;
            if view.face(f).is_none() || view.face(g).is_none() {
                return Err(invalid("a face is not in the view"));
            }
            let lo_above = match s {
                0 => None,
                1 | -1 => {
                    let g_front_up = view.front_up(g).ok_or(LayerOrderError::FaceNotInView(g))?;
                    let f_above = (s == 1) == g_front_up;
                    Some(f_above == (pair.lo == f))
                }
                _ => return Err(invalid("the sign is not -1, 0 or 1")),
            };
            order.merge(pair, lo_above)?;
        }
        Ok(order)
    }

    /// Oriedita's relations for a starting face that is front-up
    /// (`start_front_up`) or not; undetermined pairs are left out.
    pub fn to_oriedita(&self, start_front_up: bool) -> Vec<OrieditaRelation> {
        self.pairs
            .iter()
            .filter_map(|(pair, lo_above)| {
                let lo_upper = (*lo_above)? == start_front_up;
                let (upper_face, lower_face) = if lo_upper {
                    (pair.lo, pair.hi)
                } else {
                    (pair.hi, pair.lo)
                };
                Some(OrieditaRelation {
                    upper_face,
                    lower_face,
                })
            })
            .collect()
    }

    /// The order Oriedita's relations state, for a starting face that is
    /// front-up (`start_front_up`) or not.
    pub fn from_oriedita(
        relations: &[OrieditaRelation],
        start_front_up: bool,
    ) -> Result<LayerOrder, LayerOrderError> {
        let mut order = LayerOrder::new();
        for r in relations {
            let pair = FacePair::new(r.upper_face, r.lower_face)
                .ok_or(LayerOrderError::SameFace(r.upper_face))?;
            let lo_upper = pair.lo == r.upper_face;
            order.merge(pair, Some(lo_upper == start_front_up))?;
        }
        Ok(order)
    }

    /// Add an entry, refusing one that contradicts an earlier one. A
    /// determined entry settles an undetermined one.
    fn merge(&mut self, pair: FacePair, lo_above: Option<bool>) -> Result<(), LayerOrderError> {
        match (self.pairs.get(&pair).copied(), lo_above) {
            (Some(Some(a)), Some(b)) if a != b => Err(LayerOrderError::ContradictoryOrder { pair }),
            (Some(Some(_)), _) => Ok(()),
            _ => {
                self.pairs.insert(pair, lo_above);
                Ok(())
            }
        }
    }
}

/// A [`LayerOrder`] as a table on a view's face positions, for the loops that
/// ask about every pair of every cell: Σ ply² lookups, which through the
/// order's map cost a painter over a hundred milliseconds on a 256-face state
/// with stacks fifty deep. It holds `n²` bytes for `n` faces, as the checker's
/// own table does.
pub struct OrderTable {
    table: PairTable<i8>,
    n: usize,
}

impl OrderTable {
    pub fn new(view: &FoldedView, order: &LayerOrder) -> OrderTable {
        OrderTable {
            table: PairTable::of_order(view, order),
            n: view.faces().len(),
        }
    }

    /// Whether the face at view position `i` lies above the one at `j`, as
    /// [`LayerOrder::above`] says of their ids: `None` when the pair is
    /// absent or undetermined, or a position is not the view's.
    pub fn above(&self, i: usize, j: usize) -> Option<bool> {
        if i >= self.n || j >= self.n {
            return None;
        }
        match self.table.get(i, j) {
            1 => Some(true),
            -1 => Some(false),
            _ => None,
        }
    }

    /// Faces that all overlap one another (a cell's, say), as view
    /// positions, top first: ranked by how many of the others each lies
    /// above. `None` unless the ranks are 0, 1, …, n − 1, a strict total
    /// order; a valid state's cells always are.
    pub fn top_first(&self, positions: &[usize]) -> Option<Vec<usize>> {
        let n = positions.len();
        let mut ranked: Vec<(usize, usize)> = Vec::with_capacity(n);
        for &i in positions {
            let mut below = 0;
            for &j in positions {
                if i != j && self.above(i, j)? {
                    below += 1;
                }
            }
            ranked.push((below, i));
        }
        ranked.sort_unstable_by(|a, b| b.cmp(a));
        ranked
            .iter()
            .enumerate()
            .all(|(r, &(below, _))| below == n - 1 - r)
            .then(|| ranked.into_iter().map(|(_, i)| i).collect())
    }
}

/// A new [`LayerOrder`] set pair by pair, as [`LayerOrder::set_above`] and
/// [`LayerOrder::set_undetermined`] set one, and built at the end in one
/// sort rather than a tree insertion per pair: a fold sets thousands at once.
/// The same calls refuse the same pairs, and a later entry for a pair still
/// replaces an earlier one.
#[derive(Debug, Clone, Default)]
pub struct LayerOrderBuilder {
    entries: Vec<(FacePair, Option<bool>)>,
}

impl LayerOrderBuilder {
    pub fn with_capacity(pairs: usize) -> LayerOrderBuilder {
        LayerOrderBuilder {
            entries: Vec::with_capacity(pairs),
        }
    }

    /// [`LayerOrder::set_above`].
    pub fn set_above(&mut self, upper: FaceId, lower: FaceId) -> Result<(), LayerOrderError> {
        let pair = FacePair::new(upper, lower).ok_or(LayerOrderError::SameFace(upper))?;
        self.entries.push((pair, Some(pair.lo == upper)));
        Ok(())
    }

    /// [`LayerOrder::set_undetermined`].
    pub fn set_undetermined(&mut self, a: FaceId, b: FaceId) -> Result<(), LayerOrderError> {
        let pair = FacePair::new(a, b).ok_or(LayerOrderError::SameFace(a))?;
        self.entries.push((pair, None));
        Ok(())
    }

    pub fn build(mut self) -> LayerOrder {
        // Stable, so a pair's entries keep their order and the last is kept.
        self.entries.sort_by_key(|&(pair, _)| pair);
        let mut kept: Vec<(FacePair, Option<bool>)> = Vec::with_capacity(self.entries.len());
        for entry in self.entries {
            match kept.last_mut() {
                Some(last) if last.0 == entry.0 => *last = entry,
                _ => kept.push(entry),
            }
        }
        LayerOrder {
            pairs: kept.into_iter().collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::view::{Face, FoldedView};

    fn f(id: u32) -> FaceId {
        FaceId(id)
    }

    /// Two coincident unit squares, face 0 front-up and face 1 not (a valley
    /// fold's two halves).
    fn two_layers() -> FoldedView {
        let square = vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        let face = |id, front_up| Face {
            id: FaceId(id),
            polygon: square.clone(),
            front_up,
        };
        FoldedView::new(vec![face(0, true), face(1, false)], Vec::new())
            .unwrap_or_else(|e| panic!("{e}"))
    }

    #[test]
    fn pairs_are_antisymmetric() {
        let mut order = LayerOrder::new();
        assert!(order.set_above(f(5), f(2)).is_ok());
        assert_eq!(order.above(f(5), f(2)), Some(true));
        assert_eq!(order.above(f(2), f(5)), Some(false));
        assert_eq!(order.stacking(f(2), f(5)), Some(Stacking::Below));
        assert_eq!(order.stacking(f(2), f(9)), None);
        // Setting the reverse replaces the entry.
        assert!(order.set_above(f(2), f(5)).is_ok());
        assert_eq!(order.above(f(5), f(2)), Some(false));
        assert_eq!(order.len(), 1);
        assert_eq!(
            order.set_above(f(3), f(3)),
            Err(LayerOrderError::SameFace(f(3)))
        );
        assert!(order.remove(f(5), f(2)));
        assert!(!order.remove(f(5), f(2)));
        assert!(order.is_empty());
    }

    /// A builder gives what the same calls on an order give: pairs set in
    /// any order, set again either way round or left open, and the same
    /// refusal.
    #[test]
    fn a_builder_sets_pairs_as_an_order_does() {
        let mut state = 0x5eed_u64;
        let mut next = |n: u64| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (state >> 33) % n
        };
        let mut order = LayerOrder::new();
        let mut builder = LayerOrderBuilder::with_capacity(4000);
        for _ in 0..4000 {
            let (a, b) = (f(next(60) as u32), f(next(60) as u32));
            let undetermined = next(10) == 0;
            let (set, built) = if undetermined {
                (order.set_undetermined(a, b), builder.set_undetermined(a, b))
            } else {
                (order.set_above(a, b), builder.set_above(a, b))
            };
            assert_eq!(set, built);
        }
        assert!(order.len() > 1000);
        assert_eq!(builder.build(), order);
        assert_eq!(LayerOrderBuilder::default().build(), LayerOrder::new());
    }

    /// The table answers as the order does, by view position, and stacks a
    /// strict order top first; a cycle, a missing pair or an undetermined
    /// one has no stack.
    #[test]
    fn a_table_answers_as_the_order_and_stacks_it() {
        let square = vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        // Ids out of position order: the table is by position.
        let ids = [7, 3, 9, 4];
        let view = FoldedView::new(
            ids.iter()
                .map(|&id| Face {
                    id: f(id),
                    polygon: square.clone(),
                    front_up: true,
                })
                .collect(),
            Vec::new(),
        )
        .unwrap_or_else(|e| panic!("{e}"));
        let mut order = LayerOrder::new();
        // 4 above 7 above 9 above 3, every pair given.
        for (upper, lower) in [(4, 7), (4, 9), (4, 3), (7, 9), (7, 3), (9, 3)] {
            assert!(order.set_above(f(upper), f(lower)).is_ok());
        }
        let table = OrderTable::new(&view, &order);
        for (i, &a) in ids.iter().enumerate() {
            for (j, &b) in ids.iter().enumerate() {
                assert_eq!(table.above(i, j), order.above(f(a), f(b)), "{a} {b}");
            }
        }
        assert_eq!(table.above(0, 4), None);
        // Positions of 4, 7, 9, 3.
        assert_eq!(table.top_first(&[0, 1, 2, 3]), Some(vec![3, 0, 2, 1]));
        assert_eq!(table.top_first(&[1, 2]), Some(vec![2, 1]));
        assert_eq!(table.top_first(&[]), Some(vec![]));

        let mut cyclic = order.clone();
        assert!(cyclic.set_above(f(3), f(4)).is_ok());
        assert_eq!(
            OrderTable::new(&view, &cyclic).top_first(&[0, 1, 2, 3]),
            None
        );
        let mut open = order.clone();
        assert!(open.set_undetermined(f(7), f(9)).is_ok());
        assert_eq!(OrderTable::new(&view, &open).top_first(&[0, 2]), None);
        assert!(order.remove(f(9), f(3)));
        assert_eq!(OrderTable::new(&view, &order).top_first(&[1, 2]), None);
    }

    #[test]
    fn undetermined_pairs_are_kept_and_reported() {
        let mut order = LayerOrder::new();
        assert!(order.set_undetermined(f(1), f(0)).is_ok());
        assert!(order.set_above(f(1), f(2)).is_ok());
        assert!(order.contains(f(0), f(1)));
        assert_eq!(order.above(f(0), f(1)), None);
        assert_eq!(order.stacking(f(0), f(1)), Some(Stacking::Undetermined));
        let open: Vec<FacePair> = order.undetermined().collect();
        assert_eq!(
            open,
            FacePair::new(f(0), f(1)).into_iter().collect::<Vec<_>>()
        );
    }

    #[test]
    fn cyclic_orders_are_representable() {
        let mut order = LayerOrder::new();
        for (upper, lower) in [(0, 1), (1, 2), (2, 0)] {
            assert!(order.set_above(f(upper), f(lower)).is_ok());
        }
        assert_eq!(order.above(f(0), f(1)), Some(true));
        assert_eq!(order.above(f(1), f(2)), Some(true));
        assert_eq!(order.above(f(2), f(0)), Some(true));
    }

    #[test]
    fn turning_over_inverts_every_pair() {
        let mut order = LayerOrder::new();
        assert!(order.set_above(f(0), f(1)).is_ok());
        assert!(order.set_undetermined(f(1), f(2)).is_ok());
        let turned = order.turned_over();
        assert_eq!(turned.above(f(0), f(1)), Some(false));
        assert_eq!(turned.stacking(f(1), f(2)), Some(Stacking::Undetermined));
        assert_eq!(turned.turned_over(), order);
    }

    #[test]
    fn fold_face_orders_follow_the_back_face_normal() {
        // The front-down face 1 on top of the front-up face 0 (a valley):
        // 1 lies on 0's front side and 0 on 1's front side, so both triples
        // are +1.
        let view = two_layers();
        let mut order = LayerOrder::new();
        assert!(order.set_above(f(1), f(0)).is_ok());
        assert_eq!(order.to_fold_face_orders(&view), Ok(vec![[0, 1, 1]]));
        for triples in [vec![[0, 1, 1]], vec![[1, 0, 1]], vec![[0, 1, 1], [1, 0, 1]]] {
            assert_eq!(
                LayerOrder::from_fold_face_orders(&triples, &view),
                Ok(order.clone())
            );
        }
        // A mountain is -1 both ways.
        let mut mountain = LayerOrder::new();
        assert!(mountain.set_above(f(0), f(1)).is_ok());
        assert_eq!(mountain.to_fold_face_orders(&view), Ok(vec![[0, 1, -1]]));
        assert_eq!(
            LayerOrder::from_fold_face_orders(&[[1, 0, -1]], &view),
            Ok(mountain)
        );
        // s = 0 is an unknown order.
        let open = LayerOrder::from_fold_face_orders(&[[0, 1, 0]], &view);
        assert_eq!(open.map(|o| o.undetermined().count()), Ok(1));
    }

    #[test]
    fn same_orientation_triples_flip_sign_with_the_pair() {
        // Two front-up faces, 0 above 1: [0, 1, +1] and [1, 0, -1].
        let square = vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        let face = |id| Face {
            id: FaceId(id),
            polygon: square.clone(),
            front_up: true,
        };
        let view =
            FoldedView::new(vec![face(0), face(1)], Vec::new()).unwrap_or_else(|e| panic!("{e}"));
        let from = |t: &[[i64; 3]]| {
            LayerOrder::from_fold_face_orders(t, &view).map(|o| o.above(f(0), f(1)))
        };
        assert_eq!(from(&[[0, 1, 1]]), Ok(Some(true)));
        assert_eq!(from(&[[1, 0, -1]]), Ok(Some(true)));
        assert_eq!(from(&[[1, 0, 1]]), Ok(Some(false)));
    }

    #[test]
    fn malformed_fold_face_orders_are_refused() {
        let view = two_layers();
        let err = |t: &[[i64; 3]]| LayerOrder::from_fold_face_orders(t, &view).err();
        assert!(matches!(
            err(&[[0, 0, 1]]),
            Some(LayerOrderError::InvalidFaceOrder { .. })
        ));
        assert!(matches!(
            err(&[[0, 1, 2]]),
            Some(LayerOrderError::InvalidFaceOrder { .. })
        ));
        assert!(matches!(
            err(&[[0, 7, 1]]),
            Some(LayerOrderError::InvalidFaceOrder { .. })
        ));
        assert!(matches!(
            err(&[[-1, 0, 1]]),
            Some(LayerOrderError::InvalidFaceOrder { .. })
        ));
        assert!(matches!(
            err(&[[0, 1, 1], [0, 1, -1]]),
            Some(LayerOrderError::ContradictoryOrder { .. })
        ));
        // A determined entry settles an earlier unknown one.
        let settled = LayerOrder::from_fold_face_orders(&[[0, 1, 0], [0, 1, 1]], &view);
        assert_eq!(settled.map(|o| o.above(f(1), f(0))), Ok(Some(true)));
        let mut absent = LayerOrder::new();
        assert!(absent.set_above(f(0), f(9)).is_ok());
        assert_eq!(
            absent.to_fold_face_orders(&view),
            Err(LayerOrderError::FaceNotInView(f(9)))
        );
    }

    #[test]
    fn fold_triples_survive_turning_over() {
        let view = two_layers();
        let turned_view = FoldedView::new(
            view.faces()
                .iter()
                .map(|face| Face {
                    front_up: !face.front_up,
                    ..face.clone()
                })
                .collect(),
            Vec::new(),
        )
        .unwrap_or_else(|e| panic!("{e}"));
        let mut order = LayerOrder::new();
        assert!(order.set_above(f(1), f(0)).is_ok());
        assert_eq!(
            order.to_fold_face_orders(&view),
            order.turned_over().to_fold_face_orders(&turned_view)
        );
    }

    #[test]
    fn oriedita_upper_is_relative_to_the_starting_face() {
        let mut order = LayerOrder::new();
        assert!(order.set_above(f(1), f(0)).is_ok());
        let upper_lower = |upper, lower| OrieditaRelation {
            upper_face: f(upper),
            lower_face: f(lower),
        };
        // Starting face front-up: Oriedita's viewer is ours.
        assert_eq!(order.to_oriedita(true), vec![upper_lower(1, 0)]);
        // Starting face front-down: its front faces away from us.
        assert_eq!(order.to_oriedita(false), vec![upper_lower(0, 1)]);
        for start_front_up in [true, false] {
            let back =
                LayerOrder::from_oriedita(&order.to_oriedita(start_front_up), start_front_up);
            assert_eq!(back, Ok(order.clone()));
        }
        assert!(matches!(
            LayerOrder::from_oriedita(&[upper_lower(0, 1), upper_lower(1, 0)], true),
            Err(LayerOrderError::ContradictoryOrder { .. })
        ));
        assert_eq!(
            LayerOrder::from_oriedita(&[upper_lower(2, 2)], true),
            Err(LayerOrderError::SameFace(f(2)))
        );
    }
}
