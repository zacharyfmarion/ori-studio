import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/queryResponse.json';
import { createExploriDocument, type ExploriDocument } from './document';
import {
  exploriQueryLeafSide,
  layoutExploriTree,
  matchExploriTrees,
  treeCenter,
  type ExploriTreeLayout,
} from './treeLayout';
import type { ExploriGraph } from './types';

/**
 * The mirror fan, on trees built by hand for each rule and — where the archive's
 * database files are present — on real result trees from them, tagged by the
 * Python twin of this module. That data is private and lives only in an ignored
 * artifact (`scripts/explori/README.md`), so those tests skip elsewhere.
 */

type Edge = [number | string, number | string, number?];

function graph(nodes: (number | string)[], edges: Edge[]): ExploriGraph {
  return {
    nodes: nodes.map((id) => ({ id })),
    edges: edges.map(([u, v, length]) => ({ u, v, ...(length === undefined ? {} : { length }) })),
  };
}

interface LocalTree {
  N: number;
  symmetry: string;
  tilingId: number;
  tree: { nodes: number[]; edges: [number, number, number][] };
  mirror: { kind: string; pairCount: number; tiltedCount: number; nodeCount: number };
}

function localGraph(tree: LocalTree): ExploriGraph {
  return {
    nodes: tree.tree.nodes.map((id) => ({ id })),
    edges: tree.tree.edges.map(([u, v, length]) => ({ u, v, length })),
  };
}

// Vitest runs with `apps/web` as its root; the artifact is two up.
const SAMPLE = resolve(process.cwd(), '../../artifacts/explori/local-trees-sample.json');
const sample: LocalTree[] = existsSync(SAMPLE)
  ? (JSON.parse(readFileSync(SAMPLE, 'utf8')) as { trees: LocalTree[] }).trees
  : [];
const byId = (combo: string, tilingId: number) =>
  sample.find((tree) => `${tree.N}_${tree.symmetry}` === combo && tree.tilingId === tilingId);

function at(layout: ExploriTreeLayout, id: number | string): [number, number] {
  const position = layout.positions.get(String(id));
  if (!position) throw new Error(`no position for ${id}`);
  return position;
}

function longestEdge(graph: ExploriGraph): number {
  return Math.max(1e-9, ...graph.edges.map((edge) => edge.length ?? 1));
}

/** Every edge is drawn at exactly its length. */
function expectLengthsKept(graph: ExploriGraph, layout: ExploriTreeLayout) {
  const scale = longestEdge(graph);
  for (const edge of graph.edges) {
    const a = layout.positions.get(String(edge.u));
    const b = layout.positions.get(String(edge.v));
    if (!a || !b) continue;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(edge.length ?? 1, 9 - Math.log10(scale));
  }
}

/** Nodes under a tilted root, including the root, are exempt from the global mirror. */
function underTilt(layout: ExploriTreeLayout, id: string): boolean {
  const tilted = new Set(layout.tilted);
  let current: string | null | undefined = id;
  while (current) {
    if (tilted.has(current)) return true;
    current = layout.parentOf.get(current);
  }
  return false;
}

/** σ is a reflection about `x = 0` everywhere the drawing promises one. */
function expectMirrored(layout: ExploriTreeLayout, scale = 1) {
  for (const [id, [x, y]] of layout.positions) {
    const partner = layout.mirrorOf.get(id);
    expect(partner, `σ defined for ${id}`).toBeDefined();
    if (underTilt(layout, id)) continue;
    const [px, py] = at(layout, partner as string);
    expect(Math.abs(px + x)).toBeLessThan(1e-9 * scale);
    expect(Math.abs(py - y)).toBeLessThan(1e-9 * scale);
  }
}

describe('the recorded archive result', () => {
  // 4b.61865: a hub with two equal leaves, one short leaf branch and one
  // short branch carrying two equal leaves. Strictly mirrored, fixed part
  // 6–2–5 on the line.
  const tree = fixture.results[0].tree as ExploriGraph;

  it('finds the mirror and draws it exactly', () => {
    const layout = layoutExploriTree(tree);
    expect(layout.kind).toBe('strict');
    expect(layout.strict).toBe(true);
    expect(layout.pairCount).toBe(2);
    expect(layout.tilted).toEqual([]);
    expect(layout.mirrorOf.get('0')).toBe('1');
    expect(layout.mirrorOf.get('7')).toBe('8');
    for (const id of ['2', '5', '6']) {
      expect(layout.mirrorOf.get(id)).toBe(id);
      expect(Math.abs(at(layout, id)[0])).toBeLessThan(1e-12);
    }
    expectMirrored(layout);
    expectLengthsKept(tree, layout);
  });

  it('puts the leaves below the root unless told otherwise', () => {
    const down = layoutExploriTree(tree);
    const up = layoutExploriTree(tree, { leafSide: 1 });
    const centroid = (layout: ExploriTreeLayout) =>
      ['0', '1', '6', '7', '8'].reduce((sum, id) => sum + at(layout, id)[1], 0) / 5;
    expect(centroid(down)).toBeLessThan(0);
    expect(centroid(up)).toBeGreaterThan(0);
    // The two are top-for-bottom reflections of one another, nothing more.
    for (const [id, [x, y]] of down.positions) {
      expect(at(up, id)[0]).toBeCloseTo(x, 12);
      expect(at(up, id)[1]).toBeCloseTo(-y, 12);
    }
  });

  it('draws the same picture whatever the ids and their order', () => {
    const relabel = new Map(tree.nodes.map((node, index) => [String(node.id), `n${97 - index}`]));
    const shuffled: ExploriGraph = {
      nodes: [...tree.nodes].reverse().map((node) => ({ id: relabel.get(String(node.id)) as string })),
      edges: [...tree.edges]
        .reverse()
        .map((edge) => ({ ...edge, u: relabel.get(String(edge.u)) as string, v: relabel.get(String(edge.v)) as string })),
    };
    const key = (layout: ExploriTreeLayout) =>
      [...layout.positions.values()]
        .map(([x, y]) => `${x.toFixed(9)},${y.toFixed(9)}`)
        .sort()
        .join(' ');
    expect(key(layoutExploriTree(shuffled))).toBe(key(layoutExploriTree(tree)));
  });
});

describe('the rules, one tree each', () => {
  it('draws four equal flaps as an X', () => {
    const layout = layoutExploriTree(graph([0, 1, 2, 3, 4], [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]]));
    expect(layout.kind).toBe('strict');
    expect(layout.pairCount).toBe(2);
    const leaves = [1, 2, 3, 4].map((id) => at(layout, id));
    for (const [x, y] of leaves) {
      expect(Math.abs(x)).toBeCloseTo(Math.SQRT1_2, 12);
      expect(Math.abs(y)).toBeCloseTo(Math.SQRT1_2, 12);
    }
    expect(new Set(leaves.map(([x, y]) => `${Math.sign(x)}${Math.sign(y)}`)).size).toBe(4);
    expectMirrored(layout);
  });

  it('draws two equal flaps across the line', () => {
    const layout = layoutExploriTree(graph([0, 1, 2], [[0, 1, 2], [0, 2, 2]]));
    expect(layout.kind).toBe('strict');
    expect(at(layout, 1)[1]).toBeCloseTo(0, 12);
    expect(at(layout, 2)[1]).toBeCloseTo(0, 12);
    expect(at(layout, 1)[0]).toBeCloseTo(-at(layout, 2)[0], 12);
  });

  it('draws a chain of unequal flaps straight along the line, with no mirror', () => {
    const layout = layoutExploriTree(graph([0, 1, 2, 3], [[0, 1, 1], [1, 2, 2], [2, 3, 3]]));
    expect(layout.kind).toBe('rigid');
    expect(layout.pairCount).toBe(0);
    expect(layout.strict).toBe(false);
    for (const id of [0, 1, 2, 3]) expect(Math.abs(at(layout, id)[0])).toBeLessThan(1e-12);
    expectLengthsKept(graph([0, 1, 2, 3], [[0, 1, 1], [1, 2, 2], [2, 3, 3]]), layout);
  });

  it('tilts the third of three unequal flaps at the root', () => {
    // The one rigid tree in the local `2 diag` database has this shape.
    const layout = layoutExploriTree(graph([0, 1, 2, 3], [[0, 1, 0.3], [0, 2, 0.2], [0, 3, 0.1]]));
    expect(layout.kind).toBe('rigid');
    expect(layout.tilted).toHaveLength(1);
    const onLine = [1, 2, 3].filter((id) => Math.abs(at(layout, id)[0]) < 1e-12);
    expect(onLine).toHaveLength(2);
  });

  it('pairs isomorphic subtrees, not just leaves', () => {
    // Two identical two-leaf branches off the root, plus one lone flap.
    const edges: Edge[] = [
      [0, 1, 1], [1, 2, 0.5], [1, 3, 0.25],
      [0, 4, 1], [4, 5, 0.5], [4, 6, 0.25],
      [0, 7, 0.8],
    ];
    const layout = layoutExploriTree(graph([0, 1, 2, 3, 4, 5, 6, 7], edges));
    expect(layout.kind).toBe('strict');
    expect(layout.pairCount).toBe(3);
    expect(layout.mirrorOf.get('1')).toBe('4');
    expect(layout.mirrorOf.get('2')).toBe('5');
    expect(layout.mirrorOf.get('3')).toBe('6');
    expect(Math.abs(at(layout, 7)[0])).toBeLessThan(1e-12);
    expectMirrored(layout);
  });

  it('draws two mirror-image halves across the line', () => {
    const edges: Edge[] = [
      [1, 2, 1],
      [1, 3, 0.5], [1, 4, 0.3],
      [2, 5, 0.5], [2, 6, 0.3],
    ];
    const g = graph([1, 2, 3, 4, 5, 6], edges);
    const layout = layoutExploriTree(g);
    expect(layout.kind).toBe('crossing');
    expect(layout.crossing).toBe(true);
    expect(layout.strict).toBe(true);
    expect(layout.pairCount).toBe(3);
    expect(at(layout, 1)).toEqual([-0.5, 0]);
    expect(at(layout, 2)).toEqual([0.5, 0]);
    expect(layout.mirrorOf.get('1')).toBe('2');
    expect(layout.mirrorOf.get('3')).toBe('5');
    expect(layout.parentOf.get('5')).toBe('2');
    expectMirrored(layout);
    expectLengthsKept(g, layout);
  });

  it('puts both centres on the line when the halves differ', () => {
    const g = graph([1, 2, 3, 4, 5], [[1, 2, 1], [1, 3, 0.5], [1, 4, 0.5], [2, 5, 0.7]]);
    const layout = layoutExploriTree(g);
    expect(layout.kind).toBe('strict');
    expect(layout.crossing).toBe(false);
    for (const id of [1, 2, 5]) expect(Math.abs(at(layout, id)[0])).toBeLessThan(1e-12);
    expect(layout.mirrorOf.get('3')).toBe('4');
    expectMirrored(layout);
  });

  it.skipIf(sample.length === 0)('gives the line to the longer of two self-mirrored flaps and tilts the other', () => {
    // `2 book` #2: node 6 carries three equal short flaps (one pair, one
    // odd one out) and a lone long flap. The long flap continues the line;
    // the odd short one is drawn beside it.
    const local = byId('2_book', 2);
    expect(local).toBeDefined();
    const g = localGraph(local as LocalTree);
    const layout = layoutExploriTree(g);
    expect(layout.kind).toBe('tilted');
    expect(layout.tilted).toHaveLength(1);
    expect(Math.abs(at(layout, 0)[0])).toBeLessThan(1e-12);
    const tilted = layout.tilted[0];
    expect(Math.abs(at(layout, tilted)[0])).toBeGreaterThan(1e-6);
    expect(g.edges.find((edge) => String(edge.u) === tilted || String(edge.v) === tilted)?.length).toBeCloseTo(0.146447, 5);
    expect(layout.strict).toBe(false);
    // Everything not under the tilt is still an exact reflection.
    expectMirrored(layout);
    expectLengthsKept(g, layout);
  });

  it('pairs lengths that differ only by rounding and not those that differ', () => {
    const rounded = layoutExploriTree(graph([0, 1, 2], [[0, 1, 0.5], [0, 2, 0.5 + 1e-9]]));
    expect(rounded.pairCount).toBe(1);
    const different = layoutExploriTree(graph([0, 1, 2], [[0, 1, 0.5], [0, 2, 0.501]]));
    expect(different.pairCount).toBe(0);
  });
});

describe('inputs that are not quite trees', () => {
  it('draws nothing for nothing, and a dot for one node', () => {
    expect(layoutExploriTree(graph([], [])).kind).toBe('empty');
    const one = layoutExploriTree(graph([7], []));
    expect(one.kind).toBe('rigid');
    expect(at(one, 7)).toEqual([0, 0]);
  });

  it('ignores self-loops, duplicates and edges to nowhere', () => {
    const g = graph([0, 1, 2], [[0, 1, 1], [0, 1, 1], [1, 0, 1], [1, 1, 1], [0, 9, 1], [0, 2, 1]]);
    const layout = layoutExploriTree(g);
    expect(layout.positions.size).toBe(3);
    expect(layout.kind).toBe('strict');
    expect(layout.pairCount).toBe(1);
  });

  it('lays out the largest component and leaves the rest undrawn', () => {
    const g = graph([0, 1, 2, 3, 4, 5], [[0, 1, 1], [1, 2, 1], [3, 4, 1]]);
    const layout = layoutExploriTree(g);
    expect([...layout.positions.keys()].sort()).toEqual(['0', '1', '2']);
  });

  it('cuts a cycle rather than recursing over it', () => {
    // Not a tree, which nothing upstream of the layout checks. The edge that
    // closes the cycle is dropped; everything is still drawn.
    const g = graph([0, 1, 2, 3], [[0, 1, 1], [1, 2, 1], [2, 0, 1], [0, 3, 0.5]]);
    const layout = layoutExploriTree(g);
    expect(layout.positions.size).toBe(4);
    expect([...layout.positions.values()].every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(matchExploriTrees(g, g)).not.toBeNull();
  });

  it('treats a missing or nonsense length as one', () => {
    const layout = layoutExploriTree(graph([0, 1, 2], [[0, 1], [0, 2, -3]]));
    expect(layout.pairCount).toBe(1);
    expect(Math.hypot(...at(layout, 1))).toBeCloseTo(1, 12);
  });
});

describe.skipIf(sample.length === 0)('real trees from the local archive', () => {
  it('has a sample of every kind', () => {
    const kinds = new Set(sample.map((tree) => tree.mirror.kind));
    expect([...kinds].sort()).toEqual(['crossing', 'rigid', 'strict', 'tilted']);
  });

  it.each(sample.map((tree) => [`${tree.N}${tree.symmetry[0]}.${tree.tilingId}`, tree] as const))(
    '%s agrees with the Python classification and keeps its promises',
    (_label, tree) => {
      const g = localGraph(tree);
      const layout = layoutExploriTree(g);
      expect(layout.kind).toBe(tree.mirror.kind);
      expect(layout.pairCount).toBe(tree.mirror.pairCount);
      expect(layout.tilted).toHaveLength(tree.mirror.tiltedCount);
      expect(layout.positions.size).toBe(tree.mirror.nodeCount);
      for (const [x, y] of layout.positions.values()) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      }
      expectLengthsKept(g, layout);
      expectMirrored(layout, longestEdge(g));
      // No two nodes on one spot.
      const seen = new Set<string>();
      for (const [x, y] of layout.positions.values()) {
        const key = `${x.toFixed(9)},${y.toFixed(9)}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  );
});

describe('the centre', () => {
  it('is one node or the two ends of the middle edge', () => {
    const adjacency = (g: ExploriGraph) => {
      const map = new Map<string, { id: string; length: number }[]>();
      for (const node of g.nodes) map.set(String(node.id), []);
      for (const edge of g.edges) {
        map.get(String(edge.u))?.push({ id: String(edge.v), length: 1 });
        map.get(String(edge.v))?.push({ id: String(edge.u), length: 1 });
      }
      return map;
    };
    const path3 = graph([0, 1, 2], [[0, 1], [1, 2]]);
    expect(treeCenter(['0', '1', '2'], adjacency(path3))).toEqual(['1']);
    const path4 = graph([0, 1, 2, 3], [[0, 1], [1, 2], [2, 3]]);
    expect(treeCenter(['0', '1', '2', '3'], adjacency(path4)).sort()).toEqual(['1', '2']);
    const star = graph([0, 1, 2, 3], [[0, 1], [0, 2], [0, 3]]);
    expect(treeCenter(['0', '1', '2', '3'], adjacency(star))).toEqual(['0']);
  });
});

describe('what the drawn tree tells a result', () => {
  function documentWith(nodes: [number, number][], edges: [number, number][]): ExploriDocument {
    const document = createExploriDocument();
    return {
      ...document,
      nodes: nodes.map(([x, y], id) => ({ id, loc: { x, y }, name: '' })),
      edges: edges.map(([u, v], index) => ({ id: index + 1, vertices: [u, v] as [number, number], length: 1 })),
    };
  }

  it('says which way a symmetric query leans', () => {
    const up = documentWith([[0, 0], [1, 1], [-1, 1], [0, 2]], [[0, 1], [0, 2], [0, 3]]);
    expect(exploriQueryLeafSide(up)).toBe(1);
    const down = documentWith([[0, 0], [1, -1], [-1, -1], [0, -2]], [[0, 1], [0, 2], [0, 3]]);
    expect(exploriQueryLeafSide(down)).toBe(-1);
  });

  it('says nothing for a balanced or an asymmetric query', () => {
    const balanced = documentWith([[0, 0], [1, 1], [-1, 1], [0, -2]], [[0, 1], [0, 2], [0, 3]]);
    expect(exploriQueryLeafSide(balanced)).toBeNull();
    const askew = documentWith([[0, 0], [1, 1], [-1, 1.5], [0, 2]], [[0, 1], [0, 2], [0, 3]]);
    expect(exploriQueryLeafSide(askew)).toBeNull();
    expect(exploriQueryLeafSide(createExploriDocument())).toBeNull();
  });
});

describe('when the paper decides the line', () => {
  // A hub with three self-mirrored branches — a long two-edge branch, a short
  // two-edge chain and a stub — and a mirrored pair. The hub is the tree's
  // centre. Without the paper the line goes by depth, size and length; with
  // it, by how far each branch reaches along the mirror.
  const tree = graph(
    [0, 1, 6, 2, 3, 8, 4, 5],
    [[0, 1, 0.8], [1, 6, 0.2], [0, 2, 0.2], [2, 3, 0.2], [0, 8, 0.15], [0, 4, 0.5], [0, 5, 0.5]]
  );
  const x = (layout: ExploriTreeLayout, id: number) => at(layout, id)[0];
  const y = (layout: ExploriTreeLayout, id: number) => at(layout, id)[1];

  it('goes by depth, size and length when it knows nothing else', () => {
    const layout = layoutExploriTree(tree);
    for (const id of [1, 6, 2, 3]) expect(Math.abs(x(layout, id))).toBeLessThan(1e-12);
    expect(layout.tilted).toEqual(['8']);
  });

  it('gives the line to the branch reaching farthest along the mirror, and points it the paper\u2019s way', () => {
    // On the paper the long branch runs up the mirror to the edge, the stub
    // runs down it, and the chain runs up but not as far.
    const paper = new Map<string, [number, number]>([
      ['0', [0.5, 0.5]],
      ['1', [0.5, 0.8]],
      ['6', [0.5, 1.0]],
      ['2', [0.5, 0.62]],
      ['3', [0.5, 0.74]],
      ['8', [0.5, 0.3]],
      ['4', [0.2, 0.5]],
      ['5', [0.8, 0.5]],
    ]);
    const layout = layoutExploriTree(tree, { paper: { positions: paper, mirror: [0, 1] } });
    expect(Math.abs(x(layout, 1))).toBeLessThan(1e-12);
    expect(y(layout, 1)).toBeGreaterThan(0);
    expect(Math.abs(x(layout, 8))).toBeLessThan(1e-12);
    expect(y(layout, 8)).toBeLessThan(0);
    expect(layout.tilted).toEqual(['2']);
    expect(Math.abs(x(layout, 2))).toBeGreaterThan(1e-6);
    expectLengthsKept(tree, layout);
    expectMirrored(layout);
  });

  it('tilts every self-mirrored branch that has no room on the line', () => {
    // All three run up the mirror: the farthest keeps the line, the other two
    // are perturbed, and nothing is drawn pointing down.
    const paper = new Map<string, [number, number]>([
      ['0', [0.5, 0.5]],
      ['1', [0.5, 0.8]],
      ['6', [0.5, 1.0]],
      ['2', [0.5, 0.62]],
      ['3', [0.5, 0.74]],
      ['8', [0.5, 0.6]],
      ['4', [0.2, 0.5]],
      ['5', [0.8, 0.5]],
    ]);
    const layout = layoutExploriTree(tree, { paper: { positions: paper, mirror: [0, 1] } });
    expect(Math.abs(x(layout, 1))).toBeLessThan(1e-12);
    expect(y(layout, 1)).toBeGreaterThan(0);
    expect(layout.tilted).toEqual(['2', '8']);
    expect(Math.abs(x(layout, 2))).toBeGreaterThan(1e-6);
    expect(Math.abs(x(layout, 8))).toBeGreaterThan(1e-6);
  });
});
