import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/queryResponse.json';
import { exploriCpVertices } from './foldExport';
import { drawExploriTree } from './drawTree';
import { exploriPaperFrame, exploriPaperPositions, exploriPatternMirror, orientExploriTree } from './paperTree';
import { layoutExploriTree } from './treeLayout';
import type { ExploriCp, ExploriGraph, ExploriSymmetry } from './types';

/**
 * Paper positions recovered from the packing, on the recorded public result and
 * — where the archive's database files are present — on real tilings rebuilt
 * from them, and the orientation they give the drawing. That data is private
 * and lives only in an ignored artifact (`scripts/explori/README.md`), so the
 * tests over it skip elsewhere.
 */

interface RawResult {
  N: number;
  symmetry: string;
  tiling_id: number;
  cp: ExploriCp;
  packing: ExploriCp;
  tree: ExploriGraph;
}

// Vitest runs with `apps/web` as its root; the bundles are two up.
const DIR = resolve(process.cwd(), '../../artifacts/explori/local-tilings');
const fixtures = (existsSync(DIR) ? readdirSync(DIR) : [])
  .filter((name) => name.endsWith('.json'))
  .sort()
  .flatMap((name) => (JSON.parse(readFileSync(resolve(DIR, name), 'utf8')) as { results: RawResult[] }).results)
  .map((result) => ({ label: `${result.N}${result.symmetry[0]}.${result.tiling_id}`, result }));
const local = fixtures.length > 0;

/** Four-node stars: a base with no single axis, where upstream's choice of axis is not ours. */
const DEGENERATE = new Set(['2d.4', '2n.50', '3d.96']);

const byLabel = (label: string) => fixtures.find((entry) => entry.label === label)?.result as RawResult;

/**
 * Whether reflecting the crease pattern across the line through the paper's
 * centre with direction `axis` lands every crease on a crease. Hinge creases
 * are left out on both sides: upstream adds them asymmetrically.
 */
function isMirrorOfPattern(cp: ExploriCp, axis: [number, number]): boolean {
  const points = exploriCpVertices(cp);
  const segments: [[number, number], [number, number]][] = [];
  for (const [a, b, type] of cp.edges) {
    if (String(type).toLowerCase() === 'h' || !points[a] || !points[b]) continue;
    segments.push([points[a], points[b]]);
  }
  const reflect = (p: [number, number]): [number, number] => {
    const x = p[0] - 0.5;
    const y = p[1] - 0.5;
    const along = x * axis[0] + y * axis[1];
    return [0.5 + 2 * along * axis[0] - x, 0.5 + 2 * along * axis[1] - y];
  };
  const onSome = (p: [number, number]) =>
    segments.some(([a, b]) => {
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
      return Math.abs(cross) < 1e-6 && dot >= -1e-6 && dot <= (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + 1e-6;
    });
  return segments.every(([a, b]) =>
    [0.25, 0.5, 0.75].every((t) => onSome(reflect([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])))
  );
}

/** The pattern with one crease gone — one that lies on no midline or diagonal, so no mirror survives. */
function withoutOneCrease(cp: ExploriCp): ExploriCp {
  const points = exploriCpVertices(cp);
  const offLines = (edge: ExploriCp['edges'][number]) => {
    const [a, b, type] = edge;
    if (type !== 'm' && type !== 'v') return false;
    const x = (points[a][0] + points[b][0]) / 2;
    const y = (points[a][1] + points[b][1]) / 2;
    return [x - 0.5, y - 0.5, x - y, x + y - 1].every((value) => Math.abs(value) > 0.02);
  };
  const victim = cp.edges.find(offLines);
  return { ...cp, edges: cp.edges.filter((edge) => edge !== victim) };
}

describe('paper positions from the packing', () => {
  it('recovers the recorded result', () => {
    const result = fixture.results[0] as unknown as RawResult;
    const positions = exploriPaperPositions(result.tree, result.cp, result.packing);
    expect(positions?.size).toBe(result.tree.nodes.length);
  });
});

describe.skipIf(!local)('paper positions from the packing, over the local archive', () => {
  it.each(fixtures.map((entry) => [entry.label, entry.result] as const))(
    '%s: a position for every node, unless the base has no single axis',
    (label, result) => {
      const positions = exploriPaperPositions(result.tree, result.cp, result.packing);
      if (DEGENERATE.has(label)) {
        expect(positions).toBeNull();
        return;
      }
      expect(positions).not.toBeNull();
      expect(positions?.size).toBe(result.tree.nodes.length);
      for (const [x, y] of positions?.values() ?? []) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(1 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  );

  it('puts 2b.7’s four long flaps at the corners and its short one at the centre, on its hub', () => {
    const result = byLabel('2b.7');
    const positions = exploriPaperPositions(result.tree, result.cp, result.packing) as Map<string, [number, number]>;
    const degree = new Map<string, number>();
    for (const edge of result.tree.edges) {
      degree.set(String(edge.u), (degree.get(String(edge.u)) ?? 0) + 1);
      degree.set(String(edge.v), (degree.get(String(edge.v)) ?? 0) + 1);
    }
    const leaves = [...positions].filter(([id]) => degree.get(id) === 1).map(([, p]) => p.map((c) => Math.round(c * 1000) / 1000).join(','));
    expect(leaves.sort()).toEqual(['0,0', '0,1', '0.5,0.5', '1,0', '1,1']);
    const hub = [...positions].find(([id]) => degree.get(id) === 5)?.[1] as [number, number];
    expect(hub[0]).toBeCloseTo(0.5, 9);
    expect(hub[1]).toBeCloseTo(0.5, 9);
  });

});

describe.skipIf(!local)('the pattern\u2019s mirror', () => {
  const LINES: [number, number][] = [
    [1, 0],
    [Math.SQRT1_2, Math.SQRT1_2],
    [0, 1],
    [-Math.SQRT1_2, Math.SQRT1_2],
  ];

  it.each(fixtures.map((entry) => [entry.label, entry.result] as const))(
    '%s: found exactly when the pattern has one, and then a true mirror',
    (_label, result) => {
      // Not every pattern from a `book` database mirrors — `6 book` has three
      // in this pool that do not — so the claim is checked against an
      // independent test of the creases, both ways round.
      const mirror = exploriPatternMirror(result.cp, result.symmetry as ExploriSymmetry);
      const truly = LINES.filter((line) => isMirrorOfPattern(result.cp, line));
      expect(mirror === null).toBe(truly.length === 0);
      if (!mirror) return;
      const eighths = Math.atan2(mirror[1], mirror[0]) / (Math.PI / 4);
      expect(Math.abs(eighths - Math.round(eighths))).toBeLessThan(1e-9);
      expect(isMirrorOfPattern(result.cp, mirror)).toBe(true);
    }
  );

  it('is not claimed for a pattern with a crease missing', () => {
    expect(exploriPatternMirror(withoutOneCrease(byLabel('2b.7').cp), 'book')).toBeNull();
    expect(exploriPatternMirror(withoutOneCrease(byLabel('3d.960').cp), 'diag')).toBeNull();
  });
});

describe.skipIf(!local)('turning the drawing to the paper', () => {
  const mirrored = fixtures.filter(
    ({ label, result }) => result.symmetry !== 'none' && !DEGENERATE.has(label) && layoutExploriTree(result.tree).pairCount > 0
  );

  it.each(mirrored.map((entry) => [entry.label, entry.result] as const))(
    '%s: the line is the pattern\u2019s mirror or absent with it, and the tree faces the pattern\u2019s way',
    (_label, result) => {
      const frame = exploriPaperFrame(result.tree, result.cp, result.packing, result.symmetry as ExploriSymmetry);
      const paper = frame.positions as Map<string, [number, number]>;
      expect(paper).not.toBeNull();
      const drawn = drawExploriTree(result.tree, null, frame);
      if (!frame.mirror) {
        // A pattern with no mirror gets no line, whatever its tree pairs up.
        expect(drawn.axis).toBeNull();
        return;
      }
      const axis = drawn.axis as [number, number];
      expect(axis).toEqual(frame.mirror);
      expect(isMirrorOfPattern(result.cp, axis)).toBe(true);
      // Along the line, the nodes drawn on it run the way they run on the paper.
      const fan = layoutExploriTree(result.tree);
      const onLine = [...fan.mirrorOf].filter(([id, twin]) => id === twin).map(([id]) => id);
      const along = (p: [number, number]) => p[0] * axis[0] + p[1] * axis[1];
      const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
      const drawnAlong = onLine.map((id) => along(drawn.positions.get(id) as [number, number]));
      const paperAlong = onLine.map((id) => along(paper.get(id) as [number, number]));
      const dm = mean(drawnAlong);
      const pm = mean(paperAlong);
      let correlation = 0;
      onLine.forEach((_, i) => {
        correlation += (drawnAlong[i] - dm) * (paperAlong[i] - pm);
      });
      expect(correlation).toBeGreaterThanOrEqual(-1e-9);
      // Turning is rigid: every edge keeps its length.
      for (const edge of result.tree.edges) {
        const a = drawn.positions.get(String(edge.u)) as [number, number];
        const b = drawn.positions.get(String(edge.v)) as [number, number];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(edge.length ?? 1, 9);
      }
    }
  );

  it('recovers a known turn exactly', () => {
    // A hub with a mirrored pair and a lone flap on the line, then "paper"
    // positions that are that drawing rotated a quarter turn — so the mirror
    // runs across — and flipped.
    const tree: ExploriGraph = {
      nodes: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      edges: [
        { u: 0, v: 1, length: 1 },
        { u: 0, v: 2, length: 1 },
        { u: 0, v: 3, length: 0.6 },
        { u: 3, v: 4, length: 0.3 },
      ],
    };
    const fan = layoutExploriTree(tree);
    const paper = new Map<string, [number, number]>();
    for (const [id, [x, y]] of fan.positions) paper.set(id, [0.5 + 0.2 * y, 0.5 - 0.2 * x]);
    const turned = orientExploriTree(fan.positions, paper);
    for (const [id, [x, y]] of fan.positions) {
      const p = turned.get(id) as [number, number];
      expect(p[0]).toBeCloseTo(y, 9);
      expect(p[1]).toBeCloseTo(-x, 9);
    }
  });

  it('leaves a drawing alone when nothing on the paper matches it', () => {
    const fan = layoutExploriTree(fixture.results[0].tree as ExploriGraph);
    expect([...orientExploriTree(fan.positions, new Map())]).toEqual([...fan.positions]);
  });
});
