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

export function ExploriGraphFigure({ graph, size }: { graph: ExploriGraph; size: number }) {
  const positioned = useMemo(() => {
    const points = new Map<string, [number, number]>();
    for (const node of graph.nodes) {
      if (node.pos) points.set(String(node.id), node.pos);
    }
    return points;
  }, [graph]);
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
