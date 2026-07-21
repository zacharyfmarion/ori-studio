//! Port of Oriedita's `origami.data.quadTree.QuadTree`, the spatial index used
//! to prune candidate faces / line pairs during equivalence-condition setup.
//!
//! Only the two query shapes the fold path needs are exposed:
//! [`QuadTree::collect_rectangle`] (Oriedita's `RectangleCollector`, over folded
//! faces with the `Expand` comparator) and
//! [`QuadTree::collect_potential_collision`] (`CollisionCollector` /
//! `getPotentialCollision`, over folded line segments with the `Shrink`
//! comparator). Both return item indices in ascending order, matching the
//! upstream `StaticMinHeap` iteration order.

use crate::geometry::{Epsilon, Point};

const CAPACITY: usize = 8;
/// `QuadTreeComparator.EPSILON` — node containment slack.
const NODE_EPS: f64 = Epsilon::UNKNOWN_001;
/// `QuadTreeItem.EPSILON` — item-overlap slack.
const ITEM_EPS: f64 = Epsilon::QUAD_TREE_ITEM;

/// Axis-aligned bounding box (`QuadTreeItem`).
#[derive(Clone, Copy)]
pub struct BBox {
    pub l: f64,
    pub r: f64,
    pub b: f64,
    pub t: f64,
}

impl BBox {
    pub fn from_points(points: &[Point]) -> Option<Self> {
        let first = points.first()?;
        let mut bbox = Self {
            l: first.x,
            r: first.x,
            b: first.y,
            t: first.y,
        };
        for p in &points[1..] {
            bbox.l = bbox.l.min(p.x);
            bbox.r = bbox.r.max(p.x);
            bbox.b = bbox.b.min(p.y);
            bbox.t = bbox.t.max(p.y);
        }
        Some(bbox)
    }

    pub fn from_segment(a: Point, b: Point) -> Self {
        Self {
            l: a.x.min(b.x),
            r: a.x.max(b.x),
            b: a.y.min(b.y),
            t: a.y.max(b.y),
        }
    }

    /// `QuadTreeItem.mightOverlap`.
    fn might_overlap(&self, other: &BBox) -> bool {
        other.r >= self.l - ITEM_EPS
            && other.l <= self.r + ITEM_EPS
            && other.t >= self.b - ITEM_EPS
            && other.b <= self.t + ITEM_EPS
    }
}

/// `QuadTreeComparator`. `Expand` builds a better tree for faces but cannot be
/// used for collision detection; `Shrink` is required for `getPotentialCollision`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Comparator {
    Shrink,
    Expand,
}

impl Comparator {
    fn contains(&self, node: &Node, l: f64, r: f64, b: f64, t: f64) -> bool {
        match self {
            Comparator::Expand => {
                l > node.l - NODE_EPS
                    && r < node.r + NODE_EPS
                    && b > node.b - NODE_EPS
                    && t < node.t + NODE_EPS
            }
            Comparator::Shrink => {
                l > node.l + NODE_EPS
                    && r < node.r - NODE_EPS
                    && b > node.b + NODE_EPS
                    && t < node.t - NODE_EPS
            }
        }
    }

    fn contains_item(&self, node: &Node, item: &BBox) -> bool {
        self.contains(node, item.l, item.r, item.b, item.t)
    }
}

struct Node {
    l: f64,
    r: f64,
    b: f64,
    t: f64,
    children: Option<[usize; 4]>,
    parent: Option<usize>,
    size: usize,
    /// Index of the first item in this node's intrusive list, or `-1`.
    head: i64,
}

impl Node {
    fn new(l: f64, r: f64, b: f64, t: f64, parent: Option<usize>) -> Self {
        Self {
            l,
            r,
            b,
            t,
            children: None,
            parent,
            size: 0,
            head: -1,
        }
    }
}

pub struct QuadTree {
    items: Vec<BBox>,
    nodes: Vec<Node>,
    /// `next[i]` is the next item index in the same node's list, or `-1`.
    next: Vec<i64>,
    /// `node_of[i]` is the node index currently holding item `i`.
    node_of: Vec<usize>,
    comparator: Comparator,
}

impl QuadTree {
    /// Build a tree over `items`, sizing the root from `points` (all vertices of
    /// the underlying figure, as Oriedita's `PointSetAdapter` does).
    pub fn new(items: Vec<BBox>, points: &[Point], comparator: Comparator) -> Self {
        let mut root_bounds = BBox::from_points(points)
            .or_else(|| {
                // Fall back to the items' own extent if no points were supplied.
                let mut acc: Option<BBox> = None;
                for item in &items {
                    acc = Some(match acc {
                        None => *item,
                        Some(a) => BBox {
                            l: a.l.min(item.l),
                            r: a.r.max(item.r),
                            b: a.b.min(item.b),
                            t: a.t.max(item.t),
                        },
                    });
                }
                acc
            })
            .unwrap_or(BBox {
                l: 0.0,
                r: 0.0,
                b: 0.0,
                t: 0.0,
            });
        // QuadTreeComparator.createRoot: enlarge (asymmetrically) to dodge rounding.
        root_bounds = BBox {
            l: root_bounds.l - 2.0 * NODE_EPS,
            r: root_bounds.r + 5.0 * NODE_EPS,
            b: root_bounds.b - 2.0 * NODE_EPS,
            t: root_bounds.t + 5.0 * NODE_EPS,
        };

        let item_count = items.len();
        let mut tree = Self {
            items,
            nodes: vec![Node::new(
                root_bounds.l,
                root_bounds.r,
                root_bounds.b,
                root_bounds.t,
                None,
            )],
            next: vec![-1; item_count],
            node_of: vec![0; item_count],
            comparator,
        };
        for i in 0..item_count {
            tree.add_item(0, i);
        }
        tree
    }

    fn add_item(&mut self, node_idx: usize, i: usize) -> bool {
        let item = self.items[i];
        if !self.comparator.contains_item(&self.nodes[node_idx], &item) {
            return false;
        }
        if self.nodes[node_idx].size >= CAPACITY {
            if self.nodes[node_idx].children.is_none() {
                self.split(node_idx);
            }
            let children = self.nodes[node_idx].children.unwrap();
            for c in children {
                if self.add_item(c, i) {
                    return true;
                }
            }
        }
        self.add_index(node_idx, i);
        true
    }

    fn add_index(&mut self, node_idx: usize, i: usize) {
        self.next[i] = self.nodes[node_idx].head;
        self.node_of[i] = node_idx;
        self.nodes[node_idx].head = i as i64;
        self.nodes[node_idx].size += 1;
    }

    fn split(&mut self, node_idx: usize) {
        let (l, r, b, t) = {
            let n = &self.nodes[node_idx];
            (n.l, n.r, n.b, n.t)
        };
        let w = (r - l) / 2.0;
        let h = (t - b) / 2.0;
        let base = self.nodes.len();
        self.nodes.push(Node::new(l, l + w, b, b + h, Some(node_idx)));
        self.nodes.push(Node::new(l + w, r, b, b + h, Some(node_idx)));
        self.nodes.push(Node::new(l, l + w, b + h, t, Some(node_idx)));
        self.nodes.push(Node::new(l + w, r, b + h, t, Some(node_idx)));
        let children = [base, base + 1, base + 2, base + 3];

        // Redistribute the existing list into the children (one level down).
        let mut cursor = self.nodes[node_idx].head;
        self.nodes[node_idx].head = -1;
        self.nodes[node_idx].size = 0;
        self.nodes[node_idx].children = Some(children);
        while cursor != -1 {
            let i = cursor as usize;
            let saved_next = self.next[i];
            let item = self.items[i];
            let mut placed = false;
            for c in children {
                if self.comparator.contains_item(&self.nodes[c], &item) {
                    self.add_index(c, i);
                    placed = true;
                    break;
                }
            }
            if !placed {
                self.add_index(node_idx, i);
            }
            cursor = saved_next;
        }
    }

    /// `RecursiveCollector.findInitial`: the deepest node that fully contains
    /// `query`, or the root if no child does.
    fn find_initial_containing(&self, query: &BBox) -> usize {
        if let Some(children) = self.nodes[0].children {
            for c in children {
                if let Some(node) = self.find_initial_recursive(c, query) {
                    return node;
                }
            }
        }
        0
    }

    fn find_initial_recursive(&self, node_idx: usize, query: &BBox) -> Option<usize> {
        if !self.comparator.contains_item(&self.nodes[node_idx], query) {
            return None;
        }
        if let Some(children) = self.nodes[node_idx].children {
            for c in children {
                if let Some(node) = self.find_initial_recursive(c, query) {
                    return Some(node);
                }
            }
        }
        Some(node_idx)
    }

    fn collect_node(&self, node_idx: usize, keep: &mut impl FnMut(usize) -> bool, out: &mut Vec<usize>) {
        let mut cursor = self.nodes[node_idx].head;
        while cursor != -1 {
            let i = cursor as usize;
            if keep(i) {
                out.push(i);
            }
            cursor = self.next[i];
        }
    }

    fn collect_downwards(
        &self,
        node_idx: usize,
        keep: &mut impl FnMut(usize) -> bool,
        out: &mut Vec<usize>,
    ) {
        self.collect_node(node_idx, keep, out);
        if let Some(children) = self.nodes[node_idx].children {
            for c in children {
                self.collect_downwards(c, keep, out);
            }
        }
    }

    /// Walk down from `start` then up to the root, collecting items for which
    /// `keep` holds. Shared drive for the two collector shapes (both `goDown`).
    fn collect_from(&self, start: usize, mut keep: impl FnMut(usize) -> bool) -> Vec<usize> {
        let mut out = Vec::new();
        self.collect_downwards(start, &mut keep, &mut out);
        let mut node = self.nodes[start].parent;
        while let Some(idx) = node {
            self.collect_node(idx, &mut keep, &mut out);
            node = self.nodes[idx].parent;
        }
        out.sort_unstable();
        out
    }

    /// `qt.collect(RectangleCollector(p, q))`: item indices whose bbox might
    /// overlap `query`, ascending.
    pub fn collect_rectangle(&self, query: BBox) -> Vec<usize> {
        if self.items.is_empty() {
            return Vec::new();
        }
        let start = self.find_initial_containing(&query);
        self.collect_from(start, |i| self.items[i].might_overlap(&query))
    }

    /// `qt.getPotentialCollision(i)`: item indices greater than `i` that share a
    /// node region with `i`, ascending. The caller must still confirm the actual
    /// geometric relationship.
    pub fn collect_potential_collision(&self, i: usize) -> Vec<usize> {
        if i >= self.items.len() {
            return Vec::new();
        }
        let start = self.node_of[i];
        self.collect_from(start, |j| j > i)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    /// Brute-force reference: every item whose bbox overlaps the query.
    fn brute_rectangle(items: &[BBox], query: &BBox) -> Vec<usize> {
        (0..items.len())
            .filter(|&i| items[i].might_overlap(query))
            .collect()
    }

    #[test]
    fn rectangle_matches_brute_force_on_a_grid() {
        // A 10x10 grid of unit boxes.
        let mut items = Vec::new();
        let mut points = Vec::new();
        for gx in 0..10 {
            for gy in 0..10 {
                let (x, y) = (gx as f64, gy as f64);
                items.push(BBox::from_segment(pt(x, y), pt(x + 0.9, y + 0.9)));
                points.push(pt(x, y));
                points.push(pt(x + 0.9, y + 0.9));
            }
        }
        let tree = QuadTree::new(items.clone(), &points, Comparator::Expand);
        for &(qx, qy, qw) in &[(2.5, 3.5, 1.0), (0.0, 0.0, 0.5), (5.1, 5.1, 3.0), (9.0, 9.0, 2.0)] {
            let query = BBox::from_segment(pt(qx, qy), pt(qx + qw, qy + qw));
            let mut expected = brute_rectangle(&items, &query);
            expected.sort_unstable();
            assert_eq!(
                tree.collect_rectangle(query),
                expected,
                "rectangle query ({qx},{qy},{qw}) mismatch"
            );
        }
    }

    #[test]
    fn potential_collision_is_a_superset_of_true_overlaps() {
        let mut items = Vec::new();
        let mut points = Vec::new();
        for k in 0..40 {
            let x = (k % 7) as f64 * 1.3;
            let y = (k / 7) as f64 * 1.1;
            items.push(BBox::from_segment(pt(x, y), pt(x + 1.0, y + 0.5)));
            points.push(pt(x, y));
            points.push(pt(x + 1.0, y + 0.5));
        }
        let tree = QuadTree::new(items.clone(), &points, Comparator::Shrink);
        for i in 0..items.len() {
            let got: std::collections::HashSet<usize> =
                tree.collect_potential_collision(i).into_iter().collect();
            // Every actually-overlapping j > i must be present.
            for j in (i + 1)..items.len() {
                if items[i].might_overlap(&items[j]) {
                    assert!(
                        got.contains(&j),
                        "collision {i}->{j} overlaps but was not reported"
                    );
                }
            }
            // And nothing <= i is ever returned.
            assert!(got.iter().all(|&j| j > i));
        }
    }
}
