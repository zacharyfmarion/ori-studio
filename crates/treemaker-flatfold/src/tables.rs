//! The search's tables in a form its innermost loop can read without
//! allocating or searching.
//!
//! Upstream keys every variable and constraint by an encoded string
//! (`M.encode`), looks pairs up in a `Map` (`BI`) and keeps each face's
//! taco-tortilla components in a `Map` (`CC`). The port mirrored that with
//! `Vec<u16>` keys, a per-face binary search and `BTreeMap`s. The answers do
//! not depend on any of it, so these tables hold the same relations in flat
//! arrays: a variable's faces, its constraints by family in one buffer, the
//! variable of a pair of faces, and each face's components. What is stored
//! is exactly what upstream stores; only how it is found changes
//! (PORTING.md, Flat-Folder, "Performance-only divergences").

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::hash::{BuildHasherDefault, Hasher};

use crate::constraints::{TACO_TACO, TACO_TORTILLA, TORTILLA_TORTILLA, TRANSITIVITY};

/// A constraint's faces as the search reads them. A family with three faces
/// (taco-tortilla, transitivity) repeats its third in the fourth slot, which
/// no family reads.
pub(crate) type Faces = [u32; 4];

/// Each family's faces per constraint, by family index.
pub(crate) const ARITY: [usize; 4] = [4, 3, 4, 3];

/// Up to this many faces, the pair and component tables are dense arrays,
/// indexed by face numbers. Above it they are hash maps, whose size follows
/// the overlapping pairs rather than the square of the faces.
///
/// At the limit the two dense tables take 25 MB together (the pair table a
/// `u32` per ordered pair of faces, 16.8 MB; the component table a `u16`
/// per ordered pair, 8.4 MB), a fraction of what the constraint problem of
/// a model that size already holds. At Import CP's cap of 4,096 faces they
/// would take 100 MB whether the faces overlap or not, too much to hold for
/// the lifetime of a session in a browser tab. Above the limit pairs are
/// hashed (about 20 bytes per overlapping pair) and components are kept per
/// face as upstream keeps them (8 bytes per taco-tortilla membership). The
/// iguana (850 faces) takes 4.3 MB.
pub(crate) const DENSE_FACE_LIMIT: usize = 2048;

/// SplitMix64's finalizer over the one `u64` key. The keys are two face
/// numbers, never chosen by an adversary, and SipHash would cost more than
/// the lookup; but the table picks a bucket by the hash's low bits, which a
/// bare multiply (FxHash) leaves depending on the key's low bits alone,
/// that is on one face: every pair of a face would share a probe chain.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct PairHasher(u64);

impl Hasher for PairHasher {
    fn finish(&self) -> u64 {
        let mut z = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.write_u64(u64::from(byte));
        }
    }

    fn write_u64(&mut self, value: u64) {
        self.0 = self.0.rotate_left(32) ^ value;
    }
}

type FastMap<V> = HashMap<u64, V, BuildHasherDefault<PairHasher>>;

/// Two face numbers as one map key.
fn key(a: usize, b: usize) -> Option<u64> {
    Some((u64::from(u32::try_from(a).ok()?) << 32) | u64::from(u32::try_from(b).ok()?))
}

/// The variable of each unordered pair of faces (upstream `BI`).
#[derive(Debug, Clone)]
pub(crate) enum PairLookup {
    /// The face × face table, both orders of each pair: `a * faces + b`,
    /// and `u32::MAX` marks no variable. Transitivity reads a pair's third
    /// faces in ascending order, so reading the rows of the pair's faces
    /// walks them in order.
    Dense {
        faces: usize,
        table: Vec<u32>,
    },
    Hashed(FastMap<u32>),
}

impl PairLookup {
    /// An empty lookup for faces `0..faces`, dense up to `dense_limit` faces.
    pub(crate) fn new(faces: usize, variables: usize, dense_limit: usize) -> PairLookup {
        if faces <= dense_limit {
            PairLookup::Dense {
                faces,
                table: vec![u32::MAX; faces * faces],
            }
        } else {
            let mut map = FastMap::default();
            map.reserve(variables);
            PairLookup::Hashed(map)
        }
    }

    #[inline]
    fn slot(faces: usize, a: usize, b: usize) -> Option<usize> {
        (a != b && a < faces && b < faces).then(|| a * faces + b)
    }

    /// Record `variable` for faces `a` and `b`, returning the variable they
    /// already had. `None` also when the pair cannot be stored (one face, or
    /// a face out of range), which the callers rule out first.
    pub(crate) fn insert(&mut self, a: usize, b: usize, variable: usize) -> Option<usize> {
        let value = u32::try_from(variable).ok()?;
        match self {
            PairLookup::Dense { faces, table } => {
                let (ab, ba) = (Self::slot(*faces, a, b)?, Self::slot(*faces, b, a)?);
                let previous = *table.get(ab)?;
                *table.get_mut(ab)? = value;
                *table.get_mut(ba)? = value;
                (previous != u32::MAX).then_some(previous as usize)
            }
            PairLookup::Hashed(map) => {
                if a == b {
                    return None;
                }
                map.insert(key(a.min(b), a.max(b))?, value)
                    .map(|previous| previous as usize)
            }
        }
    }

    /// The variable of faces `a` and `b`, in either order.
    #[inline]
    pub(crate) fn get(&self, a: usize, b: usize) -> Option<usize> {
        match self {
            PairLookup::Dense { faces, table } => {
                let value = *table.get(Self::slot(*faces, a, b)?)?;
                (value != u32::MAX).then_some(value as usize)
            }
            PairLookup::Hashed(map) => {
                if a == b {
                    return None;
                }
                map.get(&key(a.min(b), a.max(b))?).map(|&v| v as usize)
            }
        }
    }
}

/// Upstream `FC_BF_BI_BT_2_CC`: per face `c`, the connected components of
/// the faces that form tacos around it. Only whether two faces share a
/// component of the same `c` is ever read, so a component is a number
/// starting at 1, and 0 is no component.
#[derive(Debug, Clone)]
pub(crate) enum TacoComponents {
    /// `table[c * faces + f]`.
    Dense { faces: usize, table: Vec<u16> },
    /// Per face `c`, its `(f, component)` by ascending `f`, as upstream's
    /// per-face map: most faces have none, which answers at once.
    Rows(Vec<Vec<(u32, u32)>>),
}

impl TacoComponents {
    /// From the taco-tortilla constraints `[a, b, c]`: a and b are joined in
    /// c's graph. Components are numbered as upstream numbers them, by first
    /// face in the graph, though only their equality is read.
    pub(crate) fn build<'a>(
        faces: usize,
        taco_tortillas: impl IntoIterator<Item = &'a Faces>,
        dense_limit: usize,
    ) -> TacoComponents {
        let mut graphs = vec![BTreeMap::<usize, BTreeSet<usize>>::new(); faces];
        for &[a, b, c, _] in taco_tortillas {
            let (a, b, c) = (a as usize, b as usize, c as usize);
            if let Some(graph) = graphs.get_mut(c) {
                graph.entry(a).or_default().insert(b);
                graph.entry(b).or_default().insert(a);
            }
        }
        // The dense table holds a component in a `u16`. A face's components
        // number fewer than the faces, so that fits up to `u16::MAX` faces;
        // past it the rows hold every component, whatever `dense_limit`
        // says (only tests raise it past `DENSE_FACE_LIMIT`).
        let mut out = if faces <= dense_limit && faces <= usize::from(u16::MAX) {
            TacoComponents::Dense {
                faces,
                table: vec![0; faces * faces],
            }
        } else {
            TacoComponents::Rows(vec![Vec::new(); faces])
        };
        for (c, graph) in graphs.iter().enumerate() {
            let mut component_by_face = BTreeMap::new();
            let mut component = 0usize;
            for &face in graph.keys() {
                if component_by_face.contains_key(&face) {
                    continue;
                }
                component += 1;
                let mut queue = vec![face];
                component_by_face.insert(face, component);
                let mut next = 0usize;
                while next < queue.len() {
                    let current = queue[next];
                    next += 1;
                    for &neighbor in graph.get(&current).into_iter().flatten() {
                        if component_by_face.contains_key(&neighbor) {
                            continue;
                        }
                        queue.push(neighbor);
                        component_by_face.insert(neighbor, component);
                    }
                }
            }
            for (face, component) in component_by_face {
                out.set(c, face, component);
            }
        }
        out
    }

    fn set(&mut self, c: usize, f: usize, component: usize) {
        match self {
            TacoComponents::Dense { faces, table } => {
                // `build` keeps this table to at most `u16::MAX` faces, and a
                // face has fewer components than there are faces.
                let value = u16::try_from(component);
                debug_assert!(value.is_ok(), "component {component} past a u16");
                if let (true, Ok(value)) = (f < *faces, value)
                    && let Some(slot) = table.get_mut(c * *faces + f)
                {
                    *slot = value;
                }
            }
            // Set in ascending `f` for each `c` (`build` walks a `BTreeMap`).
            TacoComponents::Rows(rows) => {
                if let (Some(row), Ok(f), Ok(value)) =
                    (rows.get_mut(c), u32::try_from(f), u32::try_from(component))
                {
                    debug_assert!(row.last().is_none_or(|&(last, _)| last < f));
                    row.push((f, value));
                }
            }
        }
    }

    /// The component of face `f` around face `c`, or 0 for none.
    #[inline]
    pub(crate) fn get(&self, c: usize, f: usize) -> u32 {
        match self {
            TacoComponents::Dense { faces, table } => {
                if f >= *faces {
                    return 0;
                }
                table.get(c * *faces + f).map_or(0, |&v| u32::from(v))
            }
            TacoComponents::Rows(rows) => {
                let Some(row) = rows.get(c).filter(|row| !row.is_empty()) else {
                    return 0;
                };
                let Ok(f) = u32::try_from(f) else {
                    return 0;
                };
                row.binary_search_by_key(&f, |&(face, _)| face)
                    .map_or(0, |at| row[at].1)
            }
        }
    }
}

/// Everything the propagation and the search read about the variables:
/// upstream's `BF` (each variable's faces), `BT` (its constraints by family),
/// `BI` (the variable of a pair) and `CC`.
#[derive(Debug, Clone)]
pub(crate) struct SearchData {
    pairs: Vec<[u32; 2]>,
    /// Variable `v`'s family `t` is `tuples[offsets[3 * v + t]..offsets[3 * v + t + 1]]`.
    offsets: Vec<usize>,
    tuples: Vec<Faces>,
    lookup: PairLookup,
    components: TacoComponents,
}

/// Builds [`SearchData`] one variable at a time, in variable order.
pub(crate) struct SearchDataBuilder {
    faces: usize,
    dense_limit: usize,
    pairs: Vec<[u32; 2]>,
    offsets: Vec<usize>,
    tuples: Vec<Faces>,
    lookup: PairLookup,
}

impl SearchDataBuilder {
    pub(crate) fn new(faces: usize, variables: usize, dense_limit: usize) -> SearchDataBuilder {
        let mut offsets = Vec::with_capacity(3 * variables + 1);
        offsets.push(0);
        SearchDataBuilder {
            faces,
            dense_limit,
            pairs: Vec::with_capacity(variables),
            offsets,
            tuples: Vec::new(),
            lookup: PairLookup::new(faces, variables, dense_limit),
        }
    }

    /// Add the next variable, faces `a < b < faces`. Returns the variable
    /// that already had this pair, if any; the pair then names the new one.
    pub(crate) fn variable(&mut self, a: usize, b: usize) -> Option<usize> {
        let index = self.pairs.len();
        self.pairs.push([a as u32, b as u32]);
        self.lookup.insert(a, b, index)
    }

    /// The variable of a pair added so far.
    pub(crate) fn pair(&self, a: usize, b: usize) -> Option<usize> {
        self.lookup.get(a, b)
    }

    /// Add a constraint to the current variable's current family. Its
    /// families come in order (taco-taco, taco-tortilla, tortilla-tortilla),
    /// each closed by [`Self::end_family`].
    pub(crate) fn push_constraint(&mut self, faces: &[usize]) {
        let mut out = [0u32; 4];
        for (slot, face) in out.iter_mut().zip(faces.iter().chain(faces.last())) {
            *slot = *face as u32;
        }
        self.tuples.push(out);
    }

    pub(crate) fn end_family(&mut self) {
        self.offsets.push(self.tuples.len());
    }

    pub(crate) fn finish(self) -> SearchData {
        let SearchDataBuilder {
            faces,
            dense_limit,
            pairs,
            offsets,
            tuples,
            lookup,
        } = self;
        let mut data = SearchData {
            pairs,
            offsets,
            tuples,
            lookup,
            components: TacoComponents::Dense {
                faces: 0,
                table: Vec::new(),
            },
        };
        data.components = TacoComponents::build(
            faces,
            (0..data.pairs.len()).flat_map(|v| data.bucket(v, TACO_TORTILLA)),
            dense_limit,
        );
        data
    }
}

impl SearchData {
    /// Variable `v`'s two faces, smaller first.
    #[inline]
    pub(crate) fn faces(&self, v: usize) -> [usize; 2] {
        let [a, b] = self.pairs[v];
        [a as usize, b as usize]
    }

    /// Variable `v`'s constraints of one family other than transitivity.
    #[inline]
    pub(crate) fn bucket(&self, v: usize, family: usize) -> &[Faces] {
        debug_assert!(family < TRANSITIVITY);
        let at = 3 * v + family;
        &self.tuples[self.offsets[at]..self.offsets[at + 1]]
    }

    #[inline]
    pub(crate) fn lookup(&self) -> &PairLookup {
        &self.lookup
    }

    #[inline]
    pub(crate) fn components(&self) -> &TacoComponents {
        &self.components
    }

    /// The first constraint, by family and then by faces, that a variable it
    /// reads does not list in its bucket, or `None` when every constraint is
    /// listed by all of its variables, as upstream's `add_constraint` lists
    /// it. Each family's listings are sorted by faces, then by the variable
    /// listing them; a listing repeated in one bucket counts once.
    pub(crate) fn one_sided_constraint(&self) -> Option<OneSided> {
        // A listing: the faces as two keys that sort as the faces do, and
        // the variable whose bucket lists them.
        let pack = |faces: &Faces| {
            (
                (u64::from(faces[0]) << 32) | u64::from(faces[1]),
                (u64::from(faces[2]) << 32) | u64::from(faces[3]),
            )
        };
        let unpack = |(high, low): (u64, u64)| -> Faces {
            [
                (high >> 32) as u32,
                high as u32,
                (low >> 32) as u32,
                low as u32,
            ]
        };
        let mut listed: Vec<(u64, u64, usize)> = Vec::new();
        let mut starts: Vec<usize> = Vec::new();
        for family in [TACO_TACO, TACO_TORTILLA, TORTILLA_TORTILLA] {
            let listings = (0..self.pairs.len())
                .flat_map(|v| self.bucket(v, family).iter().map(move |faces| (faces, v)));
            // Group by first face (count, then place), so that one sort per
            // group puts the whole family in order: half the time of one
            // sort over all of it on the iguana.
            let groups = listings
                .clone()
                .map(|(faces, _)| faces[0] as usize + 1)
                .max()
                .unwrap_or(0);
            starts.clear();
            starts.resize(groups + 1, 0);
            for (faces, _) in listings.clone() {
                starts[faces[0] as usize + 1] += 1;
            }
            for group in 1..starts.len() {
                starts[group] += starts[group - 1];
            }
            listed.clear();
            listed.resize(starts[groups], (0, 0, 0));
            let mut next = starts.clone();
            for (faces, v) in listings {
                let at = &mut next[faces[0] as usize];
                let (high, low) = pack(faces);
                listed[*at] = (high, low, v);
                *at += 1;
            }
            for group in starts.windows(2) {
                let group = &mut listed[group[0]..group[1]];
                group.sort_unstable();
                for same in group.chunk_by(|x, y| (x.0, x.1) == (y.0, y.1)) {
                    let faces = unpack((same[0].0, same[0].1));
                    for &[a, b] in pairs_of(family, &faces).as_slice() {
                        let Some(variable) = self.lookup.get(a, b) else {
                            continue;
                        };
                        if same
                            .binary_search_by_key(&variable, |&(_, _, v)| v)
                            .is_err()
                        {
                            return Some(OneSided {
                                family,
                                faces,
                                variable,
                            });
                        }
                    }
                }
            }
        }
        None
    }
}

/// A constraint missing from the bucket of a variable it reads
/// ([`SearchData::one_sided_constraint`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OneSided {
    pub(crate) family: usize,
    pub(crate) faces: Faces,
    /// A variable the constraint reads whose bucket does not list it.
    pub(crate) variable: usize,
}

/// A constraint's faces as upstream decodes its key: the family's arity.
pub(crate) fn faces_vec(family: usize, faces: &Faces) -> Vec<usize> {
    faces[..ARITY[family]].iter().map(|&f| f as usize).collect()
}

/// The pairs, one per variable, that a constraint of a family reads
/// (upstream `CON.pair_maps`), in the order its valid-state strings list
/// them. At most six.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PairList {
    items: [[usize; 2]; 6],
    len: usize,
}

impl PairList {
    #[inline]
    pub(crate) fn as_slice(&self) -> &[[usize; 2]] {
        &self.items[..self.len]
    }
}

/// [`PairList`] of a constraint of `family` on `faces`.
#[inline]
pub(crate) fn pairs_for_type(family: usize, faces: &[usize]) -> PairList {
    let mut items = [[0usize; 2]; 6];
    let len = match family {
        TACO_TACO => {
            items = [
                [faces[0], faces[1]],
                [faces[2], faces[3]],
                [faces[2], faces[1]],
                [faces[0], faces[3]],
                [faces[0], faces[2]],
                [faces[1], faces[3]],
            ];
            6
        }
        TACO_TORTILLA => {
            items[0] = [faces[0], faces[2]];
            items[1] = [faces[2], faces[1]];
            2
        }
        TORTILLA_TORTILLA => {
            items[0] = [faces[0], faces[2]];
            items[1] = [faces[1], faces[3]];
            2
        }
        TRANSITIVITY => {
            items[0] = [faces[0], faces[1]];
            items[1] = [faces[1], faces[2]];
            items[2] = [faces[2], faces[0]];
            3
        }
        _ => 0,
    };
    PairList { items, len }
}

/// [`pairs_for_type`] of a stored constraint.
#[inline]
pub(crate) fn pairs_of(family: usize, faces: &Faces) -> PairList {
    let wide = [
        faces[0] as usize,
        faces[1] as usize,
        faces[2] as usize,
        faces[3] as usize,
    ];
    pairs_for_type(family, &wide)
}

/// Marks reused by every transitivity derivation of one search, so a pair
/// visit allocates nothing.
#[derive(Debug, Default, Clone)]
pub(crate) struct Scratch {
    /// Per face: met as a third face of the current pair.
    pub(crate) met: Vec<bool>,
    /// Per cell: covered by the current pair's first face.
    pub(crate) shared: Vec<bool>,
    pub(crate) candidates: Vec<usize>,
    /// The current pair's transitivity triples.
    pub(crate) out: Vec<Faces>,
}

impl Scratch {
    pub(crate) fn new(faces: usize, cells: usize) -> Scratch {
        Scratch {
            met: vec![false; faces],
            shared: vec![false; cells],
            candidates: Vec::new(),
            out: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dense_and_hashed_lookups_agree() {
        let pairs = [[0, 1], [2, 5], [1, 4], [3, 4], [0, 5]];
        let mut dense = PairLookup::new(6, pairs.len(), usize::MAX);
        let mut hashed = PairLookup::new(6, pairs.len(), 0);
        assert!(matches!(dense, PairLookup::Dense { .. }));
        assert!(matches!(hashed, PairLookup::Hashed(_)));
        for (v, [a, b]) in pairs.iter().enumerate() {
            assert_eq!(dense.insert(*a, *b, v), None);
            assert_eq!(hashed.insert(*a, *b, v), None);
        }
        assert_eq!(dense.insert(5, 2, 9), Some(1));
        assert_eq!(hashed.insert(5, 2, 9), Some(1));
        for a in 0..8 {
            for b in 0..8 {
                assert_eq!(dense.get(a, b), hashed.get(a, b), "{a} {b}");
            }
        }
        assert_eq!(dense.get(4, 1), Some(2));
        assert_eq!(dense.get(2, 5), Some(9));
        assert_eq!(dense.get(3, 3), None);
        assert_eq!(dense.get(0, 7), None);
    }

    #[test]
    fn components_match_upstreams_maps() {
        // Around face 4, 0–1 and 1–2 join one component, 3–5 another;
        // around face 0, 2–3 is one.
        let tuples: Vec<Faces> = vec![[0, 1, 4, 4], [1, 2, 4, 4], [3, 5, 4, 4], [2, 3, 0, 0]];
        for limit in [usize::MAX, 0] {
            let cc = TacoComponents::build(6, &tuples, limit);
            assert_ne!(cc.get(4, 0), 0);
            assert_eq!(cc.get(4, 0), cc.get(4, 2));
            assert_ne!(cc.get(4, 0), cc.get(4, 3));
            assert_eq!(cc.get(4, 3), cc.get(4, 5));
            assert_eq!(cc.get(4, 4), 0);
            assert_eq!(cc.get(0, 2), cc.get(0, 3));
            assert_eq!(cc.get(0, 1), 0);
            assert_eq!(cc.get(1, 0), 0);
            assert_eq!(cc.get(5, 9), 0);
        }
    }

    #[test]
    fn a_component_past_u16_is_kept_whatever_the_dense_limit() {
        // Around face 0, 65,536 separate tacos: the last one's component is
        // 65,536, one past what the dense table's `u16` holds.
        let tacos = 1usize << 16;
        let tuples: Vec<Faces> = (0..tacos as u32)
            .map(|k| [2 * k + 1, 2 * k + 2, 0, 0])
            .collect();
        let faces = 2 * tacos + 1;
        let cc = TacoComponents::build(faces, &tuples, usize::MAX);
        assert!(matches!(cc, TacoComponents::Rows(_)));
        let (first, last) = (cc.get(0, 1), cc.get(0, faces - 1));
        assert_eq!(last, 1 << 16);
        assert_eq!(cc.get(0, faces - 2), last);
        assert_ne!(first, 0);
        assert_ne!(first, last);
    }
}
