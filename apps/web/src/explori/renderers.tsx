import { useMemo } from 'react';
import { exploriCpVertices } from './foldExport';
import type { ExploriDocument } from './document';
import { drawExploriTree } from './drawTree';
import { exploriPaperFrame } from './paperTree';
import type { ExploriCp, ExploriFold, ExploriGraph, ExploriLineType, ExploriSymmetry } from './types';

/**
 * Small SVG views of a search result: crease pattern, flap packing, folded form,
 * and the tiling's own tree.
 *
 * The first three are ported from ExplOri's `interface/static/js/renderers.js`
 * so a thumbnail here reads the same as one there — someone comparing the two
 * should not have to work out whether they are looking at the same tiling.
 *
 * The tree is deliberately *not* a port. Upstream fans it out radially from its
 * busiest node, which ignores the one thing most results have — a mirror — and
 * the tree is here to be judged against the tree you drew and the pattern
 * beside it. Its layout is `treeLayout.ts`, a mirror fan, laid along the
 * pattern's own mirror when it has one (`drawTree.ts`).
 */

export type ExploriThumbMode = 'cp' | 'packing' | 'fold' | 'tree';

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const PAD = 8;

function boundsOf(points: readonly [number, number][]): Bounds {
  if (points.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

/** Maps model coordinates into the viewBox, y flipped, aspect preserved. */
function projector(bounds: Bounds, size: number, pad = PAD) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const scale = Math.min((size - pad * 2) / spanX, (size - pad * 2) / spanY);
  const offsetX = pad + (size - pad * 2 - spanX * scale) / 2;
  const offsetY = pad + (size - pad * 2 - spanY * scale) / 2;
  return (x: number, y: number): [number, number] => [
    offsetX + (x - bounds.minX) * scale,
    size - (offsetY + (y - bounds.minY) * scale),
  ];
}

interface Segment {
  type: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function cpSegments(cp: ExploriCp): Segment[] {
  const vertices = exploriCpVertices(cp);
  const segments: Segment[] = [];
  for (const [from, to, lineType] of cp.edges) {
    const a = vertices[from];
    const b = vertices[to];
    if (!a || !b) continue;
    segments.push({ type: String(lineType ?? '').trim().toLowerCase(), x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  }
  return segments;
}

/** Stroke weights that make the packing read as structure rather than creases. */
function packingStrokeWidth(type: string): number {
  if (type === 'h') return 2.5;
  if (type === 'b') return 2;
  return 0.7;
}

export function ExploriCpFigure({
  cp,
  size,
  variant = 'cp',
}: {
  cp: ExploriCp;
  size: number;
  variant?: 'cp' | 'packing';
}) {
  const segments = useMemo(() => cpSegments(cp), [cp]);
  const project = useMemo(
    () =>
      projector(
        boundsOf(segments.flatMap((s) => [[s.x1, s.y1] as [number, number], [s.x2, s.y2] as [number, number]])),
        size
      ),
    [segments, size]
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="explori-figure" role="presentation">
      {segments.map((segment, index) => {
        const [x1, y1] = project(segment.x1, segment.y1);
        const [x2, y2] = project(segment.x2, segment.y2);
        const width = variant === 'packing' ? packingStrokeWidth(segment.type) : segment.type === 'h' ? 1 : 2;
        return (
          <line
            key={index}
            className={`explori-crease explori-crease--${segment.type || 'unknown'}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            strokeWidth={width}
          />
        );
      })}
    </svg>
  );
}

/**
 * Layer count as opacity, which is how the archive's own thumbnails convey
 * depth: `1 − (1 − α)^layers`, with upstream's α for tracing paper.
 */
const LAYER_ALPHA = 0.1;

export function ExploriFoldFigure({ fold, size }: { fold: ExploriFold; size: number }) {
  const project = useMemo(
    () => projector(boundsOf(fold.faces.flat()), size),
    [fold, size]
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="explori-figure" role="presentation">
      {fold.faces.map((face, index) => {
        const layers = fold.multiplicities[index] ?? 1;
        const points = face
          .map(([x, y]) => {
            const [px, py] = project(x, y);
            return `${px},${py}`;
          })
          .join(' ');
        return (
          <polygon
            key={index}
            className="explori-facet"
            points={points}
            fillOpacity={1 - (1 - LAYER_ALPHA) ** layers}
          />
        );
      })}
    </svg>
  );
}

/**
 * Room around the tree, as a fraction of the box. Wider than the other figures'
 * because the marks below are sized in screen pixels and would otherwise be
 * clipped at the edge of a small card.
 */
const TREE_PAD_FRACTION = 0.05;

/** `point` reflected across the line through the origin with direction `axis`. */
function reflectAcrossAxis(point: [number, number], axis: [number, number]): [number, number] {
  const along = point[0] * axis[0] + point[1] * axis[1];
  return [2 * along * axis[0] - point[0], 2 * along * axis[1] - point[1]];
}

/**
 * Where the mirror line leaves the figure: the line through `anchor` along
 * `direction` (both in SVG units), clipped to the square inset by `inset`.
 */
function axisEndpoints(
  anchor: [number, number],
  direction: [number, number],
  size: number,
  inset: number
): [[number, number], [number, number]] | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  for (const i of [0, 1] as const) {
    if (Math.abs(direction[i]) < 1e-9) {
      // Parallel to this edge of the box: inside it or missing it entirely.
      if (anchor[i] < inset || anchor[i] > size - inset) return null;
      continue;
    }
    const t1 = (inset - anchor[i]) / direction[i];
    const t2 = (size - inset - anchor[i]) / direction[i];
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin > tMax) return null;
  return [
    [anchor[0] + tMin * direction[0], anchor[1] + tMin * direction[1]],
    [anchor[0] + tMax * direction[0], anchor[1] + tMax * direction[1]],
  ];
}

export function ExploriGraphFigure({
  graph,
  size,
  symmetry = 'none',
  query = null,
  cp = null,
  packing = null,
}: {
  graph: ExploriGraph;
  size: number;
  /**
   * The database the result came from. Only a preference: when the pattern
   * mirrors across several lines, its own kind of line is taken. Whether a
   * mirror line is drawn at all is decided by the pattern itself.
   */
  symmetry?: ExploriSymmetry;
  /** The drawn tree, whose lean a result follows when its paper cannot say which way is up. */
  query?: ExploriDocument | null;
  /** The result's crease pattern and packing: the pattern's mirror, and the tree's positions on it. */
  cp?: ExploriCp | null;
  packing?: ExploriCp | null;
}) {
  // Read once per result: it is the costly step, and the query changes with
  // every stroke in the editor while the result does not.
  const paper = useMemo(
    () => (cp && packing ? exploriPaperFrame(graph, cp, packing, symmetry) : null),
    [graph, cp, packing, symmetry]
  );
  const drawn = useMemo(() => drawExploriTree(graph, query, paper), [graph, query, paper]);
  const degree = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.edges) {
      const u = String(edge.u);
      const v = String(edge.v);
      if (u === v || !drawn.positions.has(u) || !drawn.positions.has(v)) continue;
      counts.set(u, (counts.get(u) ?? 0) + 1);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return counts;
  }, [graph, drawn]);
  const pad = size * TREE_PAD_FRACTION;
  const project = useMemo(() => {
    const points = [...drawn.positions.values()];
    // A mirrored tree is framed about its axis — the reflection of every node
    // counts toward the bounds — so the line sits at the centre of every card.
    if (drawn.axis) {
      const axis = drawn.axis;
      points.push(...[...drawn.positions.values()].map((point) => reflectAcrossAxis(point, axis)));
    }
    return projector(boundsOf(points), size, pad);
  }, [drawn, size, pad]);
  if (drawn.positions.size === 0) return null;
  const axisLine =
    drawn.axis &&
    axisEndpoints(project(0, 0), [drawn.axis[0], -drawn.axis[1]], size, pad / 2);
  // Marks are sized in screen pixels, as ExplOri's are: `non-scaling-stroke`
  // keeps a 3px edge a 3px edge whatever the card's width, and a node is a
  // zero-length line with round caps, which is the one SVG mark whose radius
  // can be in screen pixels too — a dot over a wider rim.
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="explori-figure explori-figure--tree"
      role="presentation"
    >
      {axisLine && (
        <line
          className="explori-graph-axis"
          x1={axisLine[0][0]}
          y1={axisLine[0][1]}
          x2={axisLine[1][0]}
          y2={axisLine[1][1]}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {graph.edges.map((edge, index) => {
        const a = drawn.positions.get(String(edge.u));
        const b = drawn.positions.get(String(edge.v));
        if (!a || !b) return null;
        const [x1, y1] = project(a[0], a[1]);
        const [x2, y2] = project(b[0], b[1]);
        return (
          <line
            key={index}
            className="explori-graph-edge"
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {[...drawn.positions.entries()].map(([id, point]) => {
        const [cx, cy] = project(point[0], point[1]);
        const leaf = (degree.get(id) ?? 0) <= 1;
        return (
          <g
            key={id}
            className={`explori-graph-node ${leaf ? 'explori-graph-node--leaf' : 'explori-graph-node--branch'}`}
          >
            <line className="explori-graph-node__rim" x1={cx} y1={cy} x2={cx} y2={cy} vectorEffect="non-scaling-stroke" />
            <line className="explori-graph-node__dot" x1={cx} y1={cy} x2={cx} y2={cy} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </svg>
  );
}

/** Which crease types a legend should mention, in reading order. */
export const EXPLORI_LINE_TYPES: readonly ExploriLineType[] = ['b', 'm', 'v', 'h'];
