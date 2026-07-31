//! SPIKE — throwaway exploration, not production code.
//!
//! Enumerates the involutive automorphisms of an edge-weighted tree, which is
//! what determines a valid mirror pairing of flaps for symmetric layout.
//!
//! Approach:
//!   1. Root the tree at its metric centre (all automorphisms fix it).
//!   2. Canonically hash every rooted subtree, keyed on edge length + the
//!      sorted multiset of child hashes. Equal hash <=> interchangeable.
//!   3. An involution is built by choosing, at each node reachable from the
//!      fixed centre, how many of each group of identical children to pair off
//!      and how many to leave setwise-fixed (recursing into those).
//!      Choices only matter as counts, not labellings, so the enumeration up to
//!      isomorphism is tiny.

#![allow(dead_code, unused_imports, clippy::all)]

use oristudio_bp::optimizer::kernel::{KernelFlap, KernelHierarchy, OptimizerSheet};
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct Tree {
    pub parent: Vec<Option<usize>>,
    pub length: Vec<f64>,
    pub children: Vec<Vec<usize>>,
    pub label: Vec<String>,
}

impl Tree {
    pub fn new() -> Self {
        Self {
            parent: Vec::new(),
            length: Vec::new(),
            children: Vec::new(),
            label: Vec::new(),
        }
    }

    pub fn add(&mut self, parent: Option<usize>, length: f64, label: &str) -> usize {
        let id = self.parent.len();
        self.parent.push(parent);
        self.length.push(length);
        self.children.push(Vec::new());
        self.label.push(label.to_string());
        if let Some(p) = parent {
            self.children[p].push(id);
        }
        id
    }

    pub fn is_leaf(&self, n: usize) -> bool {
        self.children[n].is_empty()
    }

    pub fn leaves(&self) -> Vec<usize> {
        (0..self.parent.len())
            .filter(|&n| self.is_leaf(n))
            .collect()
    }

    fn dist_from_root(&self, mut n: usize) -> f64 {
        let mut d = 0.0;
        while let Some(p) = self.parent[n] {
            d += self.length[n];
            n = p;
        }
        d
    }

    fn depth(&self, mut n: usize) -> usize {
        let mut d = 0;
        while let Some(p) = self.parent[n] {
            d += 1;
            n = p;
        }
        d
    }

    pub fn leaf_distance(&self, a: usize, b: usize) -> f64 {
        let (mut x, mut y) = (a, b);
        let (mut dx, mut dy) = (self.depth(x), self.depth(y));
        while dx > dy {
            x = self.parent[x].unwrap();
            dx -= 1;
        }
        while dy > dx {
            y = self.parent[y].unwrap();
            dy -= 1;
        }
        while x != y {
            x = self.parent[x].unwrap();
            y = self.parent[y].unwrap();
        }
        self.dist_from_root(a) + self.dist_from_root(b) - 2.0 * self.dist_from_root(x)
    }

    /// Build the optimizer hierarchy; flap index `k` corresponds to
    /// `self.leaves()[k]`.
    pub fn hierarchy(&self, sheet: OptimizerSheet) -> KernelHierarchy {
        let leaves = self.leaves();
        let flaps = (0..leaves.len())
            .map(|index| KernelFlap {
                id: index as u32,
                width: 0,
                height: 0,
            })
            .collect::<Vec<_>>();
        let mut dist_map = Vec::new();
        for i in 0..leaves.len() {
            for j in (i + 1)..leaves.len() {
                dist_map.push((i, j, self.leaf_distance(leaves[i], leaves[j]) as i32));
            }
        }
        KernelHierarchy {
            sheet,
            flaps,
            dist_map,
            parents: Vec::new(),
            parent_map: Default::default(),
        }
    }

    /// Convert an involution (keyed on node ids) into flap-index form.
    pub fn partner_indices(&self, inv: &Involution) -> Vec<usize> {
        let leaves = self.leaves();
        let position: BTreeMap<usize, usize> = leaves
            .iter()
            .enumerate()
            .map(|(index, &node)| (node, index))
            .collect();
        leaves
            .iter()
            .map(|node| position[&inv.partner[node]])
            .collect()
    }
}

/// Undirected adjacency, so we can re-root anywhere.
fn adjacency(tree: &Tree) -> Vec<Vec<(usize, f64)>> {
    let mut adj = vec![Vec::new(); tree.parent.len()];
    for n in 0..tree.parent.len() {
        if let Some(p) = tree.parent[n] {
            adj[n].push((p, tree.length[n]));
            adj[p].push((n, tree.length[n]));
        }
    }
    adj
}

fn farthest(adj: &[Vec<(usize, f64)>], from: usize) -> (usize, f64, Vec<Option<usize>>) {
    let n = adj.len();
    let mut dist = vec![f64::NEG_INFINITY; n];
    let mut prev = vec![None; n];
    let mut stack = vec![from];
    dist[from] = 0.0;
    while let Some(u) = stack.pop() {
        for &(v, w) in &adj[u] {
            if dist[v] == f64::NEG_INFINITY {
                dist[v] = dist[u] + w;
                prev[v] = Some(u);
                stack.push(v);
            }
        }
    }
    let mut best = from;
    for v in 0..n {
        if dist[v] > dist[best] {
            best = v;
        }
    }
    (best, dist[best], prev)
}

/// The metric centre of the tree: either a node, or a point partway along an
/// edge. Every automorphism fixes it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Center {
    Node(usize),
    /// A point on the edge between `a` and `b`, at distance `da` from `a` and
    /// `db` from `b`.
    Edge(usize, usize, f64, f64),
}

fn find_center(tree: &Tree) -> Center {
    let adj = adjacency(tree);
    let (a, _, _) = farthest(&adj, 0);
    let (b, diameter, prev) = farthest(&adj, a);

    // walk the diameter path from b back to a, find the point at diameter/2
    let mut path = vec![b];
    let mut cur = b;
    while let Some(p) = prev[cur] {
        path.push(p);
        cur = p;
    }
    let half = diameter / 2.0;
    let mut travelled = 0.0;
    for window in path.windows(2) {
        let (u, v) = (window[0], window[1]);
        let w = adj[u].iter().find(|(t, _)| *t == v).unwrap().1;
        if travelled + w >= half - 1e-9 {
            if (travelled - half).abs() < 1e-9 {
                return Center::Node(u);
            }
            if (travelled + w - half).abs() < 1e-9 {
                return Center::Node(v);
            }
            let da = half - travelled;
            return Center::Edge(u, v, da, w - da);
        }
        travelled += w;
    }
    Center::Node(b)
}

/// Rooted view of the tree from an arbitrary root (or edge midpoint).
struct Rooted {
    kids: Vec<Vec<usize>>,
    /// length of the edge to the parent
    up_len: Vec<f64>,
    root_children: Vec<usize>,
    /// synthetic root marker
    center: Center,
}

fn reroot(tree: &Tree, center: Center) -> Rooted {
    let adj = adjacency(tree);
    let n = tree.parent.len();
    let mut kids = vec![Vec::new(); n];
    let mut up_len = vec![0.0; n];
    let mut parent_of = vec![usize::MAX; n];

    // seeds: (node, parent, length up to parent)
    let (seeds, root_children): (Vec<(usize, usize, f64)>, Vec<usize>) = match center {
        Center::Node(r) => (
            vec![(r, usize::MAX, 0.0)],
            adj[r].iter().map(|(v, _)| *v).collect(),
        ),
        Center::Edge(a, b, da, db) => (vec![(a, usize::MAX, da), (b, usize::MAX, db)], vec![a, b]),
    };

    let mut queue: Vec<(usize, usize, f64)> = seeds;
    let mut visited = vec![false; n];
    while let Some((node, parent, len)) = queue.pop() {
        if visited[node] {
            continue;
        }
        visited[node] = true;
        parent_of[node] = parent;
        up_len[node] = len;
        for &(v, w) in &adj[node] {
            // for an edge centre, the two seeds must not descend into each other
            let blocked = match center {
                Center::Edge(ea, eb, _, _) => (node == ea && v == eb) || (node == eb && v == ea),
                Center::Node(_) => false,
            };
            if !visited[v] && !blocked && v != parent {
                kids[node].push(v);
                queue.push((v, node, w));
            }
        }
    }
    Rooted {
        kids,
        up_len,
        root_children,
        center,
    }
}

/// Canonical string for a rooted subtree; equal strings <=> isomorphic as
/// weighted rooted trees.
fn canon(rooted: &Rooted, node: usize, memo: &mut BTreeMap<usize, String>) -> String {
    if let Some(c) = memo.get(&node) {
        return c.clone();
    }
    let mut child = rooted.kids[node]
        .iter()
        .map(|&c| canon(rooted, c, memo))
        .collect::<Vec<_>>();
    child.sort();
    let key = format!("({:.6}:{})", rooted.up_len[node], child.join(","));
    memo.insert(node, key.clone());
    key
}

/// One candidate involution.
#[derive(Debug, Clone)]
pub struct Involution {
    /// leaf id -> partner leaf id (self = on the axis)
    pub partner: BTreeMap<usize, usize>,
    pub fixed_leaves: Vec<usize>,
    pub swapped_pairs: usize,
}

/// All leaves under `node`.
fn subtree_leaves(rooted: &Rooted, node: usize, tree: &Tree, out: &mut Vec<usize>) {
    if rooted.kids[node].is_empty() && tree.is_leaf(node) {
        out.push(node);
        return;
    }
    if rooted.kids[node].is_empty() {
        // re-rooting can turn an internal node into a rooted leaf; only real
        // leaves count
        if tree.is_leaf(node) {
            out.push(node);
        }
        return;
    }
    for &c in &rooted.kids[node] {
        subtree_leaves(rooted, c, tree, out);
    }
}

/// Map leaves of subtree `a` onto leaves of the isomorphic subtree `b`,
/// following the canonical ordering so the correspondence is a real isomorphism.
fn map_subtrees(
    rooted: &Rooted,
    tree: &Tree,
    a: usize,
    b: usize,
    memo: &mut BTreeMap<usize, String>,
    out: &mut BTreeMap<usize, usize>,
) {
    if tree.is_leaf(a) && tree.is_leaf(b) {
        out.insert(a, b);
        out.insert(b, a);
        return;
    }
    let mut ka = rooted.kids[a].clone();
    let mut kb = rooted.kids[b].clone();
    ka.sort_by_key(|&c| canon(rooted, c, memo));
    kb.sort_by_key(|&c| canon(rooted, c, memo));
    for (x, y) in ka.iter().zip(kb.iter()) {
        map_subtrees(rooted, tree, *x, *y, memo, out);
    }
}

/// Enumerate involutions of the subtree rooted at `node`, fixing `node`.
/// Returns (partner map over this subtree's leaves, number of swapped pairs).
fn involutions_at(
    rooted: &Rooted,
    tree: &Tree,
    node: usize,
    memo: &mut BTreeMap<usize, String>,
    budget: usize,
) -> Vec<(BTreeMap<usize, usize>, usize)> {
    if tree.is_leaf(node) {
        let mut m = BTreeMap::new();
        m.insert(node, node);
        return vec![(m, 0)];
    }
    // group children by canonical form
    let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for &c in &rooted.kids[node] {
        groups.entry(canon(rooted, c, memo)).or_default().push(c);
    }

    let mut results: Vec<(BTreeMap<usize, usize>, usize)> = vec![(BTreeMap::new(), 0)];
    for (_, members) in groups {
        let k = members.len();
        let mut group_options: Vec<(BTreeMap<usize, usize>, usize)> = Vec::new();
        for pairs in 0..=(k / 2) {
            // pair the first 2*pairs members off; recurse into the rest
            let mut base = BTreeMap::new();
            for p in 0..pairs {
                let (a, b) = (members[2 * p], members[2 * p + 1]);
                map_subtrees(rooted, tree, a, b, memo, &mut base);
            }
            let rest = &members[2 * pairs..];
            let mut combos: Vec<(BTreeMap<usize, usize>, usize)> = vec![(base, pairs)];
            for &r in rest {
                let sub = involutions_at(rooted, tree, r, memo, budget);
                let mut next = Vec::new();
                for (acc, np) in &combos {
                    for (s, sp) in &sub {
                        let mut merged = acc.clone();
                        merged.extend(s.iter().map(|(k, v)| (*k, *v)));
                        next.push((merged, np + sp));
                        if next.len() >= budget {
                            break;
                        }
                    }
                    if next.len() >= budget {
                        break;
                    }
                }
                combos = next;
            }
            group_options.extend(combos);
            if group_options.len() >= budget {
                break;
            }
        }
        let mut merged_results = Vec::new();
        for (acc, np) in &results {
            for (g, gp) in &group_options {
                let mut m = acc.clone();
                m.extend(g.iter().map(|(k, v)| (*k, *v)));
                merged_results.push((m, np + gp));
                if merged_results.len() >= budget {
                    break;
                }
            }
            if merged_results.len() >= budget {
                break;
            }
        }
        results = merged_results;
    }
    results
}

pub fn enumerate_involutions(tree: &Tree, budget: usize) -> (Center, Vec<Involution>) {
    let center = find_center(tree);
    let rooted = reroot(tree, center);
    let mut memo = BTreeMap::new();

    let raw: Vec<(BTreeMap<usize, usize>, usize)> = match center {
        Center::Node(r) => involutions_at(&rooted, tree, r, &mut memo, budget),
        Center::Edge(a, b, _, _) => {
            // the two halves either swap wholesale (only possible when they are
            // isomorphic, which also forces the centre to be the edge midpoint),
            // or each is independently symmetric about the axis
            let ca = canon(&rooted, a, &mut memo);
            let cb = canon(&rooted, b, &mut memo);
            let mut out = Vec::new();
            if ca == cb {
                let mut m = BTreeMap::new();
                map_subtrees(&rooted, tree, a, b, &mut memo, &mut m);
                out.push((m, 1));
            }
            let ia = involutions_at(&rooted, tree, a, &mut memo, budget);
            let ib = involutions_at(&rooted, tree, b, &mut memo, budget);
            for (x, xp) in &ia {
                for (y, yp) in &ib {
                    let mut m = x.clone();
                    m.extend(y.iter().map(|(k, v)| (*k, *v)));
                    out.push((m, xp + yp));
                    if out.len() >= budget {
                        break;
                    }
                }
            }
            out
        }
    };

    let leaves = tree.leaves();
    let mut seen = Vec::new();
    let mut involutions = Vec::new();
    for (map, pairs) in raw {
        // complete the map: anything unmentioned is fixed
        let mut partner = BTreeMap::new();
        for &l in &leaves {
            partner.insert(l, *map.get(&l).unwrap_or(&l));
        }
        let key = leaves
            .iter()
            .map(|l| partner[l].to_string())
            .collect::<Vec<_>>()
            .join(",");
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        let fixed_leaves = leaves
            .iter()
            .copied()
            .filter(|l| partner[l] == *l)
            .collect::<Vec<_>>();
        involutions.push(Involution {
            partner,
            fixed_leaves,
            swapped_pairs: pairs,
        });
    }
    involutions.sort_by_key(|i| (i.fixed_leaves.len(), usize::MAX - i.swapped_pairs));
    (center, involutions)
}

// ---------------------------------------------------------------- cases

pub fn bug(vertebrae: usize, spine: f64, leg: f64, head: f64) -> Tree {
    let mut t = Tree::new();
    let mut spine_nodes = Vec::new();
    for v in 0..vertebrae {
        let p = if v == 0 {
            None
        } else {
            Some(spine_nodes[v - 1])
        };
        let len = if v == 0 { 0.0 } else { spine };
        spine_nodes.push(t.add(p, len, &format!("s{v}")));
    }
    t.add(Some(spine_nodes[0]), head, "head");
    t.add(Some(spine_nodes[vertebrae - 1]), head, "tail");
    for v in 0..vertebrae {
        t.add(Some(spine_nodes[v]), leg, &format!("L{v}"));
        t.add(Some(spine_nodes[v]), leg, &format!("R{v}"));
    }
    t
}

pub fn star(n: usize, leg: f64) -> Tree {
    let mut t = Tree::new();
    let root = t.add(None, 0.0, "root");
    for i in 0..n {
        t.add(Some(root), leg, &format!("f{i}"));
    }
    t
}

/// Deliberately asymmetric: legs of different lengths.
pub fn lopsided() -> Tree {
    let mut t = Tree::new();
    let root = t.add(None, 0.0, "root");
    t.add(Some(root), 10.0, "a");
    t.add(Some(root), 10.0, "b");
    t.add(Some(root), 13.0, "c");
    t
}

pub fn report(name: &str, tree: &Tree) {
    let (center, involutions) = enumerate_involutions(tree, 64);
    println!("\n=== {name} ===");
    println!(
        "  centre: {}",
        match center {
            Center::Node(n) => format!("node {}", tree.label[n]),
            Center::Edge(a, b, da, db) => format!(
                "on edge {}-{} ({da:.2} from {}, {db:.2} from {})",
                tree.label[a], tree.label[b], tree.label[a], tree.label[b]
            ),
        }
    );
    println!("  {} distinct involution(s)", involutions.len());
    for (index, inv) in involutions.iter().take(6).enumerate() {
        let pairs = inv
            .partner
            .iter()
            .filter(|(a, b)| *a < *b)
            .map(|(a, b)| format!("{}~{}", tree.label[*a], tree.label[*b]))
            .collect::<Vec<_>>();
        let fixed = inv
            .fixed_leaves
            .iter()
            .map(|l| tree.label[*l].clone())
            .collect::<Vec<_>>();
        println!(
            "   [{index}] {} pair(s) {:<40} on-axis: {:?}",
            inv.swapped_pairs,
            pairs.join(" "),
            fixed
        );
    }
}
