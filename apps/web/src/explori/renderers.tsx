import { useMemo } from 'react';
import { exploriCpVertices } from './foldExport';
import type { ExploriCp, ExploriFold, ExploriGraph, ExploriLineType } from './types';

/**
 * Small SVG views of a search result: crease pattern, flap packing, folded form,
 * and the tiling's own tree.
 *
 * Ported from ExplOri's `interface/static/js/renderers.js` so a thumbnail here
 * reads the same as one there — someone comparing the two should not have to
 * work out whether they are looking at the same tiling.
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
function projector(bounds: Bounds, size: number) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const scale = Math.min((size - PAD * 2) / spanX, (size - PAD * 2) / spanY);
  const offsetX = PAD + (size - PAD * 2 - spanX * scale) / 2;
  const offsetY = PAD + (size - PAD * 2 - spanY * scale) / 2;
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
 * Where to draw a graph's nodes.
 *
 * A tiling's `tree` arrives with **no positions** — upstream serializes it with
 * no `pos` argument — so there is nothing to place. Upstream's own renderer has
 * the same hole and falls back to the origin, stacking every node on one point,
 * so there is nothing to copy here either.
 *
 * It does carry `length` on every edge, though, which is a real metric. So the
 * layout is radial from the graph's root: walk it breadth-first, give each
 * subtree an angular wedge in proportion to how many leaves it carries, and put
 * each node at its parent plus `length` along its wedge's bisector. Deterministic,
 * no iteration, and it draws the tree the lengths actually describe.
 *
 * Positions that *are* supplied — `topology` and `solved_tiling` carry them —
 * are used as they come.
 */
export function layoutExploriGraph(graph: ExploriGraph): Map<string, [number, number]> {
  const supplied = new Map<string, [number, number]>();
  for (const node of graph.nodes) {
    if (node.pos) supplied.set(String(node.id), node.pos);
  }
  if (supplied.size > 0) return supplied;
  if (graph.nodes.length === 0) return supplied;

  const adjacency = new Map<string, { id: string; length: number }[]>();
  for (const node of graph.nodes) adjacency.set(String(node.id), []);
  for (const edge of graph.edges) {
    const u = String(edge.u);
    const v = String(edge.v);
    const length = edge.length && edge.length > 0 ? edge.length : 1;
    adjacency.get(u)?.push({ id: v, length });
    adjacency.get(v)?.push({ id: u, length });
  }

  // Root at the most-connected node, which for a metric tree is the one the
  // drawing reads best from — a leaf root would push everything into a fan.
  const root = [...adjacency.entries()].reduce(
    (best, entry) => (entry[1].length > (adjacency.get(best)?.length ?? 0) ? entry[0] : best),
    String(graph.nodes[0].id)
  );

  // Children first, so a wedge can be sized by the leaves below it.
  const parent = new Map<string, string | null>([[root, null]]);
  const order: string[] = [root];
  for (let i = 0; i < order.length; i += 1) {
    for (const next of adjacency.get(order[i]) ?? []) {
      if (parent.has(next.id)) continue;
      parent.set(next.id, order[i]);
      order.push(next.id);
    }
  }
  const leafCount = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    const children = (adjacency.get(id) ?? []).filter((edge) => parent.get(edge.id) === id);
    leafCount.set(
      id,
      children.length === 0
        ? 1
        : children.reduce((sum, child) => sum + (leafCount.get(child.id) ?? 1), 0)
    );
  }

  const points = new Map<string, [number, number]>([[root, [0, 0]]]);
  const wedge = new Map<string, [number, number]>([[root, [0, Math.PI * 2]]]);
  for (const id of order) {
    const [from, to] = wedge.get(id) ?? [0, Math.PI * 2];
    const children = (adjacency.get(id) ?? []).filter((edge) => parent.get(edge.id) === id);
    const total = children.reduce((sum, child) => sum + (leafCount.get(child.id) ?? 1), 0) || 1;
    let cursor = from;
    for (const child of children) {
      const span = ((to - from) * (leafCount.get(child.id) ?? 1)) / total;
      const angle = cursor + span / 2;
      const origin = points.get(id) ?? [0, 0];
      points.set(child.id, [
        origin[0] + Math.cos(angle) * child.length,
        origin[1] + Math.sin(angle) * child.length,
      ]);
      wedge.set(child.id, [cursor, cursor + span]);
      cursor += span;
    }
  }
  return points;
}

export function ExploriGraphFigure({ graph, size }: { graph: ExploriGraph; size: number }) {
  const positioned = useMemo(() => layoutExploriGraph(graph), [graph]);
  const project = useMemo(
    () => projector(boundsOf([...positioned.values()]), size),
    [positioned, size]
  );
  if (positioned.size === 0) return null;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="explori-figure" role="presentation">
      {graph.edges.map((edge, index) => {
        const a = positioned.get(String(edge.u));
        const b = positioned.get(String(edge.v));
        if (!a || !b) return null;
        const [x1, y1] = project(a[0], a[1]);
        const [x2, y2] = project(b[0], b[1]);
        return <line key={index} className="explori-graph-edge" x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      {[...positioned.entries()].map(([id, point]) => {
        const [cx, cy] = project(point[0], point[1]);
        return <circle key={id} className="explori-graph-node" cx={cx} cy={cy} r={3} />;
      })}
    </svg>
  );
}

/** Which crease types a legend should mention, in reading order. */
export const EXPLORI_LINE_TYPES: readonly ExploriLineType[] = ['b', 'm', 'v', 'h'];
