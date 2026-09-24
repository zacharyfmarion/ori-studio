import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutExploriTree, type ExploriTreeLayout } from './treeLayout';
import type { ExploriGraph } from './types';

/**
 * The mirror fan over every tree in the local ExplOri archive — 6,451 of them
 * across six databases — against the classification `scripts/explori/mirror.py`
 * gave each one when `export-local-trees.py` wrote the corpus.
 *
 * Skipped when the corpus has not been exported; it is an ignored artifact
 * built from database files that live on one machine. Run
 * `scripts/explori/export-local-trees.py` (see `scripts/explori/README.md`) and
 * this runs.
 */

// Vitest runs with `apps/web` as its root, so the repository root is two up.
const CORPUS = resolve(process.cwd(), '../../artifacts/explori/local-trees.json');
const REPORT = resolve(process.cwd(), '../../artifacts/explori/tree-layout-report.txt');
const available = existsSync(CORPUS);

interface CorpusTree {
  N: number;
  symmetry: string;
  tilingId: number;
  tree: { nodes: number[]; edges: [number, number, number][] };
  mirror: {
    kind: string;
    pairCount: number;
    tiltedCount: number;
    nodeCount: number;
    crossing: boolean;
  };
}

function toGraph(tree: CorpusTree): ExploriGraph {
  return {
    nodes: tree.tree.nodes.map((id) => ({ id })),
    edges: tree.tree.edges.map(([u, v, length]) => ({ u, v, length })),
  };
}

function underTilt(layout: ExploriTreeLayout, tilted: Set<string>, id: string): boolean {
  let current: string | null | undefined = id;
  while (current) {
    if (tilted.has(current)) return true;
    current = layout.parentOf.get(current);
  }
  return false;
}

/** Proper crossings between drawn edges that share no endpoint. */
function crossings(graph: ExploriGraph, layout: ExploriTreeLayout): number {
  const segments: [string, string, [number, number], [number, number]][] = [];
  for (const edge of graph.edges) {
    const a = layout.positions.get(String(edge.u));
    const b = layout.positions.get(String(edge.v));
    if (a && b) segments.push([String(edge.u), String(edge.v), a, b]);
  }
  const orient = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  let count = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const [u1, v1, p1, q1] = segments[i];
      const [u2, v2, p2, q2] = segments[j];
      if (u1 === u2 || u1 === v2 || v1 === u2 || v1 === v2) continue;
      const o1 = orient(p1, q1, p2);
      const o2 = orient(p1, q1, q2);
      const o3 = orient(p2, q2, p1);
      const o4 = orient(p2, q2, q1);
      if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4) count += 1;
    }
  }
  return count;
}

describe.skipIf(!available)('the mirror fan over the local archive', () => {
  const corpus = available
    ? (JSON.parse(readFileSync(CORPUS, 'utf8')) as { trees: CorpusTree[] }).trees.filter(
        (tree) => tree.mirror.kind !== 'empty'
      )
    : [];

  it('agrees with the Python classifier on every tree, and keeps every promise', () => {
    const started = performance.now();
    const perDb = new Map<string, Record<string, number>>();
    let coincident = 0;
    let crossed = 0;
    let crossingsTotal = 0;
    const disagreements: string[] = [];
    for (const tree of corpus) {
      const graph = toGraph(tree);
      const layout = layoutExploriTree(graph);
      const label = `${tree.N}${tree.symmetry[0]}.${tree.tilingId}`;
      if (
        layout.kind !== tree.mirror.kind ||
        layout.pairCount !== tree.mirror.pairCount ||
        layout.tilted.length !== tree.mirror.tiltedCount ||
        layout.positions.size !== tree.mirror.nodeCount
      ) {
        disagreements.push(
          `${label}: ts ${layout.kind}/${layout.pairCount}/${layout.tilted.length}/${layout.positions.size} ` +
            `py ${tree.mirror.kind}/${tree.mirror.pairCount}/${tree.mirror.tiltedCount}/${tree.mirror.nodeCount}`
        );
      }
      const scale = Math.max(...graph.edges.map((edge) => edge.length ?? 1));
      // Lengths kept, coordinates finite.
      for (const edge of graph.edges) {
        const a = layout.positions.get(String(edge.u));
        const b = layout.positions.get(String(edge.v));
        if (!a || !b) throw new Error(`${label}: edge ${edge.u}-${edge.v} lost a node`);
        const drawn = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (!Number.isFinite(drawn) || Math.abs(drawn - (edge.length ?? 1)) > 1e-9 * scale) {
          throw new Error(`${label}: edge ${edge.u}-${edge.v} drawn at ${drawn}, not ${edge.length}`);
        }
      }
      // The mirror, exact everywhere it is promised.
      const tilted = new Set(layout.tilted);
      for (const [id, [x, y]] of layout.positions) {
        const partner = layout.mirrorOf.get(id);
        if (partner === undefined) throw new Error(`${label}: σ undefined for ${id}`);
        if (underTilt(layout, tilted, id)) continue;
        const image = layout.positions.get(partner);
        if (!image || Math.abs(image[0] + x) > 1e-9 * scale || Math.abs(image[1] - y) > 1e-9 * scale) {
          throw new Error(`${label}: ${id} and σ${id}=${partner} are not reflections`);
        }
      }
      // Metrics, reported rather than promised.
      const seen = new Set<string>();
      let coincidentHere = false;
      for (const [x, y] of layout.positions.values()) {
        const key = `${Math.round(x / (scale * 1e-6))},${Math.round(y / (scale * 1e-6))}`;
        if (seen.has(key)) coincidentHere = true;
        seen.add(key);
      }
      if (coincidentHere) coincident += 1;
      const crossed_ = crossings(graph, layout);
      if (crossed_ > 0) crossed += 1;
      crossingsTotal += crossed_;
      const db = `${tree.N} ${tree.symmetry}`;
      const counts = perDb.get(db) ?? {};
      counts[layout.kind] = (counts[layout.kind] ?? 0) + 1;
      perDb.set(db, counts);
    }
    const elapsed = performance.now() - started;
    const lines = [...perDb.entries()].map(
      ([db, counts]) =>
        `${db.padEnd(8)} ${Object.entries(counts)
          .sort()
          .map(([kind, count]) => `${kind}=${count}`)
          .join(' ')}`
    );
    const report = [
      `mirror fan over ${corpus.length} local trees in ${elapsed.toFixed(0)} ms`,
      ...lines,
      `trees with coincident nodes: ${coincident}`,
      `trees with a crossing: ${crossed} (${crossingsTotal} crossings in all)`,
    ].join('\n');
    console.log(report);
    // Beside the corpus, for reading after the run: vitest keeps its console
    // quiet, and these numbers are what the plan's checklist records.
    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, `${report}\n`);
    expect(disagreements, disagreements.slice(0, 10).join('\n')).toEqual([]);
    expect(coincident).toBe(0);
  });

  it('is deterministic', () => {
    for (const tree of corpus.slice(0, 500)) {
      const graph = toGraph(tree);
      const first = layoutExploriTree(graph);
      const second = layoutExploriTree(graph);
      expect([...second.positions]).toEqual([...first.positions]);
    }
  });
});
