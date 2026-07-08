import type { FoldDocument } from '../engine/types';
import {
  buildSegmentFold,
  flatPlaneAxes,
  type CpSegment,
} from './creasePatternSegmentation';
import {
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  type OristudioCpLineStyle,
} from './creasePatternViewport';

const SIZE = 1024;
const MARGIN = 48;
// Export viewBox (1024) is larger than the editable canvas viewBox (~720); scale
// stroke widths / point radii so exports look like the live crease-pattern view.
const VIEW_SCALE = SIZE / 720;

export type CreaseExportFormat = 'svg' | 'png';

/** Which crease pattern to export: a specific segment, or all of them. */
export interface CreaseExportOptions {
  /** Segment id to export, or null for the whole document (all patterns). */
  segmentId: number | null;
  lineStyle: OristudioCpLineStyle;
  lineWidth: number;
  pointSize: number;
  includeUnassigned: boolean;
  showBackgroundColor: boolean;
}

export const DEFAULT_CREASE_EXPORT_OPTIONS: CreaseExportOptions = {
  segmentId: null,
  lineStyle: DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  lineWidth: DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  // Points are off by default for exports (they add visual noise to a CP image).
  pointSize: 0,
  includeUnassigned: true,
  showBackgroundColor: true,
};

// Crease colors, matching the live crease-pattern view (theme --fold-* tokens).
const ASSIGNMENT_COLOR: Record<string, string> = {
  M: '#ff4d5d',
  V: '#60a5fa',
  B: '#111417',
  F: '#64c8c8',
  U: '#9aa4ad',
};

function isUnassigned(assignment: string): boolean {
  return assignment === 'F' || assignment === 'U' || assignment === 'C' || assignment === 'J';
}

interface EdgeAppearance {
  stroke: string;
  dash: string;
}

// Line-style rules mirroring the editable crease-pattern view. In the "color"
// style, mountain and valley are distinguished by color alone (solid red /
// solid blue); the black/shape styles use dash patterns instead.
function edgeAppearance(assignment: string, lineStyle: OristudioCpLineStyle): EdgeAppearance {
  const black = lineStyle === 'black-one-dot' || lineStyle === 'black-two-dot';
  let stroke: string;
  if (lineStyle === 'black-white') {
    stroke = assignment === 'V' ? '#a2a2a2' : '#000000';
  } else if (black) {
    stroke = '#000000';
  } else {
    stroke = ASSIGNMENT_COLOR[assignment] ?? ASSIGNMENT_COLOR.U!;
  }

  let dash = '';
  if (assignment === 'V') {
    if (lineStyle === 'color') dash = ''; // solid blue
    else if (lineStyle === 'black-white') dash = scaleDash([10, 7]);
    else dash = scaleDash([8, 8]); // color-and-shape / dot styles
  } else if (assignment === 'M') {
    // 'color' and 'black-white' keep mountains solid; the shape/dot styles use a
    // dash-dot chain (kept fairly sparse so it doesn't read as dense).
    if (lineStyle === 'color-and-shape' || lineStyle === 'black-one-dot') dash = scaleDash([16, 6, 4, 6]);
    else if (lineStyle === 'black-two-dot') dash = scaleDash([16, 6, 4, 6, 4, 6]);
  }
  return { stroke, dash };
}

function scaleDash(pattern: number[]): string {
  return pattern.map((value) => (value * VIEW_SCALE).toFixed(2)).join(' ');
}

function foldProjector(fold: FoldDocument): {
  project: (vertex: number) => { x: number; y: number };
} {
  const coords = fold.vertices_coords ?? [];
  const axes = flatPlaneAxes(fold);
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const coord of coords) {
    const u = coord[axes[0]] ?? 0;
    const v = coord[axes[1]] ?? 0;
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }
  if (!Number.isFinite(minU)) {
    minU = 0;
    minV = 0;
    maxU = 1;
    maxV = 1;
  }
  const spanU = Math.max(maxU - minU, 1e-6);
  const spanV = Math.max(maxV - minV, 1e-6);
  const span = SIZE - MARGIN * 2;
  const scale = Math.min(span / spanU, span / spanV);
  const width = (maxU - minU) * scale;
  const height = (maxV - minV) * scale;
  const offsetX = (SIZE - width) / 2;
  const offsetY = (SIZE - height) / 2;
  const project = (vertex: number) => {
    const coord = coords[vertex];
    const u = coord?.[axes[0]] ?? 0;
    const v = coord?.[axes[1]] ?? 0;
    return {
      x: offsetX + (u - minU) * scale,
      // Flip so paper-up maps to screen-up.
      y: offsetY + (maxV - v) * scale,
    };
  };
  return { project };
}

/**
 * Serialize a crease pattern (the whole document, or a single segment) to a
 * standalone SVG that matches the live editable view: the same line style,
 * width, and point size options, no M/V "view mode" toggle. `fold` is the
 * document's simulation fold; `segments` come from `segmentFoldDocument`.
 */
export function serializeCreasePatternSvg(
  fold: FoldDocument,
  segments: CpSegment[],
  options: CreaseExportOptions = DEFAULT_CREASE_EXPORT_OPTIONS
): string {
  const segment =
    options.segmentId != null ? segments.find((entry) => entry.id === options.segmentId) : undefined;
  const targetFold = segment ? buildSegmentFold(fold, segment) : fold;
  const { project } = foldProjector(targetFold);

  const faces = targetFold.faces_vertices ?? [];
  const edges = targetFold.edges_vertices ?? [];
  const assignments = targetFold.edges_assignment ?? [];
  const strokeWidth = Math.max(0.5, options.lineWidth * 1.5 * VIEW_SCALE);

  const backgrounds =
    options.showBackgroundColor && faces.length
      ? faces
          .map((face) => {
            const points = face
              .map(project)
              .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
              .join(' ');
            return `  <polygon points="${points}" fill="#f8f5ec" stroke="none"/>`;
          })
          .join('\n')
      : '';

  const lines = edges
    .map((edge, index) => {
      const assignment = assignments[index] ?? 'U';
      if (!options.includeUnassigned && isUnassigned(assignment)) return '';
      const { stroke, dash } = edgeAppearance(assignment, options.lineStyle);
      const a = project(edge[0]);
      const b = project(edge[1]);
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
      return `  <line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${stroke}" stroke-width="${strokeWidth.toFixed(2)}"${dashAttr} stroke-linecap="round"/>`;
    })
    .filter(Boolean)
    .join('\n');

  let points = '';
  if (options.pointSize > 0) {
    const radius = options.pointSize * 1.6 * VIEW_SCALE;
    const drawn = new Set<number>();
    const dots: string[] = [];
    for (const edge of edges) {
      for (const vertex of edge) {
        if (drawn.has(vertex)) continue;
        drawn.add(vertex);
        const point = project(vertex);
        dots.push(
          `  <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="#111417"/>`
        );
      }
    }
    points = dots.join('\n');
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Crease pattern">`,
    '  <rect width="100%" height="100%" fill="#ffffff"/>',
    backgrounds,
    lines,
    points,
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');
}

async function svgToPng(svg: string): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to render crease pattern SVG'));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas rendering is unavailable');
    ctx.drawImage(image, 0, 0);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode crease pattern PNG'));
      }, 'image/png');
    });
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function renderCreasePatternPng(
  fold: FoldDocument,
  segments: CpSegment[],
  options: CreaseExportOptions = DEFAULT_CREASE_EXPORT_OPTIONS
): Promise<Uint8Array> {
  return svgToPng(serializeCreasePatternSvg(fold, segments, options));
}
