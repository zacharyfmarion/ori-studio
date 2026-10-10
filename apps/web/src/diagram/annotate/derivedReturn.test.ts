import { describe, expect, it } from 'vitest';
import { cubicPoint, measurePath, type Vec2 } from '../../lib/cubicBezier';
import { DIAGRAM_FOLD_RETURN_INK } from '../../cp-workspace/references/diagram/diagramInk';
import { arcThroughPoints, pathReturn, returnStroke } from '../../cp-workspace/references/stepDiagramGeometry';
import type { DiagramPathNode, KnownDiagramAnnotation } from '../document/diagramDocument';
import { arcToPath } from './annotationPath';
import { ARROW_BEND, MAX_PATH_NODES, arrowApex, pathCubics } from './annotationModel';
import { INK_UNITS } from './canvasInk';
import { RETURN_FIT_INKS, arcReturn, derivedReturn } from './derivedReturn';

const unfold = (bend: number): KnownDiagramAnnotation => ({
  id: 'u',
  kind: 'fold-unfold-arrow',
  from: [0.2, 0.5],
  to: [0.5, 0.5],
  bend,
});

/** An S whose return, kept to one side, is cut where it would loop inside the second bend. */
const S_PATH: DiagramPathNode[] = [
  { at: [0.1, 0.5], out: [0.2, 0.3] },
  { at: [0.4, 0.5], in: [0.3, 0.6], out: [0.5, 0.4] },
  { at: [0.7, 0.5], in: [0.6, 0.7] },
];

/** A tall arch on two nodes, its handles long. */
const ARCH: DiagramPathNode[] = [
  { at: [0.15, 0.6], out: [0.2, 0.35] },
  { at: [0.6, 0.6], in: [0.55, 0.35] },
];

/** The return as the canvas draws it from `out`. */
function drawnReturn(out: readonly DiagramPathNode[]): Vec2[] {
  const cubics = pathCubics(out);
  const length = measurePath(cubics).length;
  const offset = Math.min(DIAGRAM_FOLD_RETURN_INK.offset * INK_UNITS, DIAGRAM_FOLD_RETURN_INK.ofChord * length);
  return pathReturn(cubics, offset, length * 1e-4)!;
}

function distanceToRuns(p: Vec2, runs: readonly Vec2[]): number {
  let least = Infinity;
  for (let i = 1; i < runs.length; i += 1) {
    const a = runs[i - 1]!;
    const b = runs[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const run = dx * dx + dy * dy;
    const t = run > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / run)) : 0;
    least = Math.min(least, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return least;
}

/** How far the curve through `nodes` strays from `runs`, at most, sampled densely. */
function strays(nodes: readonly DiagramPathNode[], runs: readonly Vec2[]): number {
  let worst = 0;
  for (const cubic of pathCubics(nodes)) {
    for (let step = 0; step <= 100; step += 1) worst = Math.max(worst, distanceToRuns(cubicPoint(cubic, step / 100), runs));
  }
  return worst;
}

describe('a fold-and-unfold arrow’s return, as nodes', () => {
  const outs = {
    'a 60° arc': arcToPath(unfold(ARROW_BEND)).path!,
    'a half circle': arcToPath(unfold(0.5)).path!,
    'an S': S_PATH,
    'a tall arch': ARCH,
  };

  it.each(Object.entries(outs))('follows the return drawn for %s to within a tenth of an ink, from the tip to its end', (_, out) => {
    const nodes = derivedReturn(out)!;
    const drawn = drawnReturn(out);
    expect(strays(nodes, drawn)).toBeLessThanOrEqual(RETURN_FIT_INKS * INK_UNITS);
    expect(nodes[0]!.at).toEqual(out[out.length - 1]!.at);
    expect(nodes[0]!.in).toBeUndefined();
    expect(nodes.at(-1)!.at).toEqual(drawn.at(-1));
    expect(nodes.at(-1)!.out).toBeUndefined();
  });

  it('has a node for each of an arc’s, the return of a sweep as simple as the sweep', () => {
    expect(derivedReturn(arcToPath(unfold(ARROW_BEND)).path!)).toHaveLength(2);
    expect(derivedReturn(arcToPath(unfold(0.5)).path!)).toHaveLength(3);
  });

  it('puts a corner where the drawing cuts out a loop, and smooth nodes everywhere else', () => {
    const nodes = derivedReturn(S_PATH)!;
    const corners = nodes.flatMap((node, index) => (node.type === 'corner' ? [index] : []));
    expect(corners).toHaveLength(1);
    // A corner's handles leave it in two directions, not one line.
    const corner = nodes[corners[0]!]!;
    const into: Vec2 = [corner.at[0] - corner.in![0], corner.at[1] - corner.in![1]];
    const away: Vec2 = [corner.out![0] - corner.at[0], corner.out![1] - corner.at[1]];
    const turn = Math.atan2(Math.abs(into[0] * away[1] - into[1] * away[0]), into[0] * away[0] + into[1] * away[1]);
    expect(turn).toBeGreaterThan(Math.PI / 9);
    for (const node of derivedReturn(ARCH)!) expect(node.type).toBeUndefined();
  });

  it('has no more nodes than a return holds, however many its path has', () => {
    const many: DiagramPathNode[] = Array.from({ length: MAX_PATH_NODES }, (_, index) => {
      const x = 0.1 + index * 0.03;
      const y = 0.5 + (index % 2 === 0 ? 0 : 0.04);
      return { at: [x, y], ...(index > 0 ? { in: [x - 0.01, y - 0.03] } : {}), ...(index < MAX_PATH_NODES - 1 ? { out: [x + 0.01, y - 0.03] } : {}) };
    });
    expect(derivedReturn(many)!.length).toBeLessThanOrEqual(MAX_PATH_NODES);
  });

  it('has none for a path of no length', () => {
    expect(arcReturn([0.3, 0.3], [0.3, 0.3], ARROW_BEND)).toBeNull();
    expect(derivedReturn([{ at: [0.3, 0.3] }, { at: [0.3, 0.3] }])).toBeNull();
  });
});

describe('an arc fold-and-unfold arrow’s return, as nodes', () => {
  it.each([ARROW_BEND, 0.22, -0.4])('is the return arc the arc drawing builds, exactly, from the tip (bend %s)', (bend) => {
    const arrow = unfold(bend);
    const nodes = arcReturn(arrow.from, arrow.to, bend)!;
    const up = ([x, y]: readonly [number, number]): [number, number] => [x, -y];
    const out = arcThroughPoints(up(arrow.from), up(arrowApex(arrow.from, arrow.to, bend)), up(arrow.to))!;
    const chord = Math.hypot(arrow.to[0] - arrow.from[0], arrow.to[1] - arrow.from[1]);
    const back = returnStroke(out, Math.min(DIAGRAM_FOLD_RETURN_INK.offset * INK_UNITS, DIAGRAM_FOLD_RETURN_INK.ofChord * chord))!;
    // The return turns a quarter: one cubic.
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.at).toEqual(arrow.to);
    const end = [back.center[0] + back.radius * Math.cos(back.to), -(back.center[1] + back.radius * Math.sin(back.to))];
    expect(nodes[1]!.at[0]).toBeCloseTo(end[0]!, 12);
    expect(nodes[1]!.at[1]).toBeCloseTo(end[1]!, 12);
    // Every point of the cubic on the circle, as near as a quarter turn's cubic comes (0.03% of its radius).
    for (let step = 0; step <= 50; step += 1) {
      const [x, y] = cubicPoint(pathCubics(nodes)[0]!, step / 50);
      expect(Math.abs(Math.hypot(x - back.center[0], -y - back.center[1]) - back.radius)).toBeLessThan(3e-4 * back.radius);
    }
  });
});
