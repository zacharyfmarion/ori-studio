"""Mirror structure of an ExplOri result tree.

The Python twin of `apps/web/src/explori/treeLayout.ts`: the same maximal
pairing at the tree's centre, the same axis-slot rule, the same tie-breaks. It
exists so the exported corpus can carry each tree's classification and the
web corpus test can assert that the TypeScript implementation agrees with it on
every local tree. Keep the two in step; a divergence is a bug in one of them.

Vocabulary, shared with the TypeScript module:

- A **pair** is two sibling subtrees that are mirror images — same edge length
  to the parent, same metric canonical form. Pairing is maximal: a class of k
  isomorphic siblings yields k // 2 pairs.
- A **fixed** child is the odd one out of a class. Its subtree is self-mirrored.
- At a node on the mirror line, the first fixed child (deepest fixed chain,
  then largest, then canonical key, then longest edge, then file order)
  continues the line; the root offers two such slots. Every other fixed child
  is **tilted**: drawn off the line although it is self-mirrored.
- Two centres whose halves are mirror images give a **crossing** layout: the
  central edge crosses the line and nothing is fixed.

Kinds: `empty` (no nodes), `rigid` (no pairs at all), `crossing`, `strict`
(pairs, nothing tilted) and `tilted`.
"""

from __future__ import annotations

import collections
import math
from dataclasses import dataclass, field

REL_QUANTUM = 1e-6


@dataclass
class Mirror:
    kind: str
    node_count: int
    pair_count: int
    tilted_count: int
    crossing: bool
    component_count: int
    centers: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "nodeCount": self.node_count,
            "pairCount": self.pair_count,
            "tiltedCount": self.tilted_count,
            "crossing": self.crossing,
            "componentCount": self.component_count,
        }


def analyze(node_ids, edges) -> Mirror:
    """`node_ids` in file order; `edges` as (u, v, length) triples."""
    order = {}
    for node in node_ids:
        order.setdefault(node, len(order))
    if not order:
        return Mirror("empty", 0, 0, 0, False, 0)

    adjacency = {node: [] for node in order}
    seen = set()
    for u, v, length in edges:
        if u == v or u not in order or v not in order:
            continue
        key = (u, v) if order[u] <= order[v] else (v, u)
        if key in seen:
            continue
        seen.add(key)
        if not (isinstance(length, (int, float)) and math.isfinite(length) and length > 0):
            length = 1.0
        adjacency[u].append((v, float(length)))
        adjacency[v].append((u, float(length)))

    # Largest component, ties to the one holding the earliest node.
    visited = set()
    components = []
    for node in order:
        if node in visited:
            continue
        component = []
        queue = collections.deque([node])
        visited.add(node)
        while queue:
            current = queue.popleft()
            component.append(current)
            for neighbour, _ in adjacency[current]:
                if neighbour not in visited:
                    visited.add(neighbour)
                    queue.append(neighbour)
        components.append(component)
    component = max(components, key=lambda c: (len(c), -order[c[0]]))
    members = set(component)

    if len(component) == 1:
        return Mirror("rigid", 1, 0, 0, False, len(components), component)

    max_length = max(length for node in component for _, length in adjacency[node])
    quantum = max_length * REL_QUANTUM

    def bucket(length: float) -> int:
        return int(round(length / quantum))

    # Centre by leaf stripping.
    degree = {node: len(adjacency[node]) for node in component}
    remaining = set(component)
    layer = [node for node in component if degree[node] <= 1]
    while len(remaining) > 2:
        next_layer = []
        for leaf in layer:
            remaining.discard(leaf)
            for neighbour, _ in adjacency[leaf]:
                if neighbour in remaining:
                    degree[neighbour] -= 1
                    if degree[neighbour] == 1:
                        next_layer.append(neighbour)
        layer = next_layer
        if not layer:
            break
    centers = sorted(remaining, key=lambda node: order[node])

    canon_memo: dict = {}
    size_memo: dict = {}
    decompose_memo: dict = {}
    depth_memo: dict = {}

    def children_of(v, parent):
        return [(c, length) for c, length in adjacency[v] if c != parent]

    def canon(v, parent) -> str:
        key = (v, parent)
        if key in canon_memo:
            return canon_memo[key]
        parts = sorted(f"{bucket(length)}:{canon(c, v)}" for c, length in children_of(v, parent))
        result = "(" + ",".join(parts) + ")"
        canon_memo[key] = result
        return result

    def size(v, parent) -> int:
        key = (v, parent)
        if key in size_memo:
            return size_memo[key]
        result = 1 + sum(size(c, v) for c, _ in children_of(v, parent))
        size_memo[key] = result
        return result

    def decompose(v, parent):
        key = (v, parent)
        if key in decompose_memo:
            return decompose_memo[key]
        classes = collections.OrderedDict()
        for c, length in children_of(v, parent):
            classes.setdefault((bucket(length), canon(c, v)), []).append((c, length))
        pairs = []
        fixed = []
        for (edge_bucket, child_canon), members_ in classes.items():
            members_.sort(key=lambda entry: order[entry[0]])
            for index in range(0, len(members_) - 1, 2):
                pairs.append((members_[index][0], members_[index + 1][0]))
            if len(members_) % 2 == 1:
                fixed.append((members_[-1][0], edge_bucket, child_canon))
        fixed.sort(
            key=lambda entry: (
                -fixed_depth(entry[0], v),
                -size(entry[0], v),
                entry[2],
                -entry[1],
                order[entry[0]],
            )
        )
        result = (pairs, [entry[0] for entry in fixed])
        decompose_memo[key] = result
        return result

    def fixed_depth(v, parent) -> int:
        key = (v, parent)
        if key in depth_memo:
            return depth_memo[key]
        _, fixed = decompose(v, parent)
        result = 1 + max([fixed_depth(u, v) for u in fixed], default=0)
        depth_memo[key] = result
        return result

    counts = {"pairs": 0, "tilted": 0}

    def walk(v, parent, slots, on_axis):
        pairs, fixed = decompose(v, parent)
        counts["pairs"] += sum(size(left, v) for left, _ in pairs)
        axis = set(fixed[:slots]) if on_axis else set()
        if on_axis:
            counts["tilted"] += max(0, len(fixed) - slots)
        for u in fixed:
            walk(u, v, 1, on_axis and u in axis)

    crossing = False
    if len(centers) == 2:
        c1, c2 = centers
        if canon(c1, c2) == canon(c2, c1):
            crossing = True
            counts["pairs"] = size(c1, c2)
        else:
            walk(c1, c2, 1, True)
            walk(c2, c1, 1, True)
    else:
        walk(centers[0], None, 2, True)

    if counts["pairs"] == 0:
        kind = "rigid"
    elif crossing:
        kind = "crossing"
    elif counts["tilted"] > 0:
        kind = "tilted"
    else:
        kind = "strict"
    return Mirror(kind, len(component), counts["pairs"], counts["tilted"], crossing, len(components), centers)


def graph_to_lists(graph):
    """A networkx tree as the (node_ids, edges) pair `analyze` takes."""
    nodes = sorted(graph.nodes(), key=lambda node: (str(type(node)), node))
    edges = []
    for u, v, data in graph.edges(data=True):
        a, b = (u, v) if nodes.index(u) <= nodes.index(v) else (v, u)
        edges.append((a, b, float(data.get("length", 1.0))))
    edges.sort(key=lambda edge: (nodes.index(edge[0]), nodes.index(edge[1])))
    return nodes, edges
