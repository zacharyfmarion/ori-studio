import type { Point } from '../../lib/geometry';
import type {
  OristudioCpDiagnosticEntry,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { readCssVarColor } from '../renderer/cssColor';
import { MARKER_SHAPE } from '../renderer/types';
import type { MarkerGeometry, Rgba, StrokeGeometry, WedgeGeometry } from '../renderer/types';
import { cpDiagnosticClass } from './severity';

/**
 * Pure builders that turn CAMV / check-fix diagnostic entries into the WebGL surface's
 * GPU geometry — shape markers, segment highlights, and big-little-big sector wedges
 * — plus the shared style/tone/bounds derivation. No DOM/React: colours are resolved
 * from the theme root once and injected, so these stay unit-testable. Extracted from
 * `CreasePatternPanel` (Phase 8 decompose).
 */

export interface CpDiagnosticBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  center: Point;
}

export type CpDiagnosticMarkerShape =
  | 'generic'
  | 'triangle'
  | 'square'
  | 'circle'
  | 'ring'
  | 'big-little-big'
  | 'self-intersection'
  // A vertex with an answer waiting: a diamond, filled. Not one of Oriedita's
  // shapes, because it is not one of Oriedita's facts — every marker upstream
  // draws means "this is wrong", and this one means "this is not settled".
  | 'undecided'
  // A vertex nothing can be said about: the same diamond, hollow. Sharing the
  // silhouette is deliberate — the two are the same kind of statement, and the
  // fill is what says whether there is something to do about it.
  | 'unexamined'
  | 'none';

export type CpDiagnosticMarkerTone =
  | 'danger'
  | 'warning'
  | 'mountain'
  | 'valley'
  | 'neutral'
  | 'unknown'
  /** Neither good nor bad: the check has not decided. */
  | 'info';

export interface CpDiagnosticMarkerStyle {
  shape: CpDiagnosticMarkerShape;
  tone: CpDiagnosticMarkerTone;
}

/** Rim radius (CSS px) of the big-little-big sector wedges; shared with the SVG. */
export const CP_DIAGNOSTIC_BLB_RADIUS = 18;

const CP_DIAGNOSTIC_MARKER_SHAPE_ID: Record<CpDiagnosticMarkerShape, number | null> = {
  triangle: MARKER_SHAPE.triangle,
  square: MARKER_SHAPE.square,
  circle: MARKER_SHAPE.disc,
  ring: MARKER_SHAPE.ring,
  'big-little-big': MARKER_SHAPE.pentagon,
  // Self-intersection has no Oriedita marker to inherit — it is a check the
  // upstream does not have. The cross reads as "these cross", which is the
  // thing being reported.
  'self-intersection': MARKER_SHAPE.cross,
  undecided: MARKER_SHAPE.diamond,
  unexamined: MARKER_SHAPE.diamond,
  generic: MARKER_SHAPE.cross,
  none: null,
};
const CP_DIAGNOSTIC_MARKER_PX = 10;

/**
 * Undecided and unexamined markers, smaller.
 *
 * They are the only diagnostics that appear in bulk on a *healthy* document — a
 * pattern a fraction of the way through design carries hundreds — so at the
 * error size they would be the loudest thing on the canvas, and the loudest
 * thing would be the part that is going fine.
 */
const CP_DIAGNOSTIC_QUIET_MARKER_PX = 7;

function isQuietMarker(shape: CpDiagnosticMarkerShape): boolean {
  return shape === 'undecided' || shape === 'unexamined';
}

// Fill opacity for the big-little-big sectors: the violating sectors read strongly,
// the rest stay lighter (but still legible) so the angular breakdown reads without
// dominating. The wedge program also strokes every sector edge for definition.
const CP_DIAGNOSTIC_BLB_VIOLATING_ALPHA = 0.48;
const CP_DIAGNOSTIC_BLB_QUIET_ALPHA = 0.16;

export function diagnosticEntryPoints(entry: OristudioCpDiagnosticEntry): Point[] {
  const points: Point[] = [];
  if (entry.point) points.push(entry.point);
  for (const segment of entry.segments ?? []) {
    points.push(segment.a, segment.b);
  }
  for (const sector of entry.big_little_big ?? []) {
    points.push(sector.segment.a, sector.segment.b);
  }
  return points;
}

export function boundsFromPoints(points: Point[]): CpDiagnosticBounds | null {
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    minX,
    minY,
    maxX,
    maxY,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

export function diagnosticEntryBounds(entry: OristudioCpDiagnosticEntry): CpDiagnosticBounds | null {
  return boundsFromPoints(diagnosticEntryPoints(entry));
}

function isUndecidedOrUnexamined(entry: OristudioCpDiagnosticEntry): boolean {
  const kind = cpDiagnosticClass(entry);
  return kind === 'undecided' || kind === 'unexamined';
}

function isFlatFoldabilityDiagnostic(entry: OristudioCpDiagnosticEntry): boolean {
  return (
    entry.kind === 'Check4' ||
    entry.kind === 'CheckCamv' ||
    entry.rule === 'NumberOfFolds' ||
    entry.rule === 'Angles' ||
    entry.rule === 'Maekawa' ||
    entry.rule === 'BigLittleBig'
  );
}

export function cpDiagnosticMarkerTone(entry: OristudioCpDiagnosticEntry): CpDiagnosticMarkerTone {
  // Ahead of the colour table, because these entries carry no violation colour
  // and the table's default arm is `danger`. An undecided vertex drawn in the
  // error colour would be the plan's bug inverted: silence read as success, and
  // now an ordinary unfinished crease reading as a fault.
  if (isUndecidedOrUnexamined(entry)) return 'info';
  switch (entry.violation_color) {
    case 'NotEnoughMountain':
      return 'mountain';
    case 'NotEnoughValley':
      return 'valley';
    case 'Equal':
    case 'Correct':
      return 'neutral';
    case 'Unknown':
      return 'unknown';
    default:
      return entry.severity === 'warning' ? 'warning' : 'danger';
  }
}

export function cpDiagnosticMarkerStyle(entry: OristudioCpDiagnosticEntry): CpDiagnosticMarkerStyle {
  // The paper passing through itself is its own failure, distinct from the
  // vertex not closing — the angles agree, the result is just not reachable.
  if (entry.rule === 'SelfIntersection') {
    return { shape: 'self-intersection', tone: 'danger' };
  }

  // One silhouette for "not settled", filled when there is something to apply
  // and hollow when there is not. Ahead of the flat-foldability table, whose
  // `CheckCamv` kind these entries also carry.
  if (isUndecidedOrUnexamined(entry)) {
    return {
      shape: cpDiagnosticClass(entry) === 'undecided' ? 'undecided' : 'unexamined',
      tone: 'info',
    };
  }

  if (!isFlatFoldabilityDiagnostic(entry)) {
    return {
      shape: 'generic',
      tone: cpDiagnosticMarkerTone(entry),
    };
  }

  switch (entry.rule) {
    case 'NumberOfFolds':
      return { shape: 'triangle', tone: cpDiagnosticMarkerTone(entry) };
    case 'Angles':
      return {
        shape: entry.violation_color === 'Correct' ? 'ring' : 'circle',
        tone: cpDiagnosticMarkerTone(entry),
      };
    case 'Maekawa':
      return { shape: 'square', tone: cpDiagnosticMarkerTone(entry) };
    case 'BigLittleBig':
      return { shape: 'big-little-big', tone: cpDiagnosticMarkerTone(entry) };
    case 'None':
      return { shape: 'none', tone: cpDiagnosticMarkerTone(entry) };
    default:
      return { shape: 'generic', tone: cpDiagnosticMarkerTone(entry) };
  }
}

/** Resolve each diagnostic tone to its themed base colour (matches theme.css). */
export function resolveCpDiagnosticToneColors(root: Element): Record<CpDiagnosticMarkerTone, Rgba> {
  return {
    danger: readCssVarColor(root, '--status-danger', [0.9, 0.24, 0.33, 1]),
    warning: readCssVarColor(root, '--status-warning', [0.95, 0.68, 0.2, 1]),
    mountain: readCssVarColor(root, '--fold-mountain', [1, 0.3, 0.36, 1]),
    valley: readCssVarColor(root, '--fold-valley', [0.38, 0.65, 0.98, 1]),
    neutral: readCssVarColor(root, '--fold-unassigned', [0.6, 0.6, 0.65, 1]),
    unknown: readCssVarColor(root, '--diagnostic-unknown', [1, 0, 0.576, 1]),
    info: readCssVarColor(root, '--status-info', [0.49, 0.718, 0.91, 1]),
  };
}

function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], color[3] * alpha];
}

/** The angular sectors around a big-little-big vertex (or a segment fallback). */
export function cpBlbSectors(
  entry: OristudioCpDiagnosticEntry
): { segment: OristudioCpLineSegment; violating: boolean }[] {
  return entry.big_little_big && entry.big_little_big.length > 0
    ? entry.big_little_big
    : (entry.segments ?? []).map((segment) => ({ segment, violating: false }));
}

/** True when an BLB entry has enough sectors to draw wedges (else it falls back to a marker). */
export function cpHasBlbWedges(entry: OristudioCpDiagnosticEntry): boolean {
  return (
    cpDiagnosticMarkerStyle(entry).shape === 'big-little-big' && cpBlbSectors(entry).length >= 2
  );
}

/** Build screen-space marker geometry for the diagnostic entries. */
export function buildCpDiagnosticMarkers(
  entries: readonly OristudioCpDiagnosticEntry[],
  toneColors: Record<CpDiagnosticMarkerTone, Rgba>
): MarkerGeometry {
  const markers: { center: Point; shape: number; sizePx: number; fill: Rgba; stroke: Rgba }[] = [];
  for (const entry of entries) {
    if (!entry.point) continue;
    // BLB vertices with real sectors render as wedges, not the pentagon fallback.
    if (cpHasBlbWedges(entry)) continue;
    const style = cpDiagnosticMarkerStyle(entry);
    const shape = CP_DIAGNOSTIC_MARKER_SHAPE_ID[style.shape];
    if (shape === null) continue;
    const base = toneColors[style.tone];
    // Hollow says "nothing is filled in here" in both places it is used: the
    // ring, where Oriedita means only the angles are wrong, and the unexamined
    // diamond, where the check has no answer to put inside it.
    const hollow = style.shape === 'ring' || style.shape === 'unexamined';
    markers.push({
      center: entry.point,
      shape,
      sizePx: isQuietMarker(style.shape)
        ? CP_DIAGNOSTIC_QUIET_MARKER_PX
        : CP_DIAGNOSTIC_MARKER_PX,
      fill: hollow ? [base[0], base[1], base[2], 0] : withAlpha(base, 0.18),
      stroke: withAlpha(base, 0.7),
    });
  }
  const count = markers.length;
  const center = new Float32Array(count * 2);
  const size = new Float32Array(count);
  const shape = new Float32Array(count);
  const fill = new Float32Array(count * 4);
  const stroke = new Float32Array(count * 4);
  markers.forEach((m, i) => {
    center[i * 2] = m.center.x;
    center[i * 2 + 1] = m.center.y;
    size[i] = m.sizePx;
    shape[i] = m.shape;
    fill.set(m.fill, i * 4);
    stroke.set(m.stroke, i * 4);
  });
  return { center, size, shape, fill, stroke, count };
}

/** Build model-space segment-highlight strokes for the diagnostic entries. */
export function buildCpDiagnosticStrokes(
  entries: readonly OristudioCpDiagnosticEntry[],
  toneColors: Record<CpDiagnosticMarkerTone, Rgba>
): StrokeGeometry {
  const segs: { a: Point; b: Point; color: Rgba }[] = [];
  for (const entry of entries) {
    if (cpDiagnosticMarkerStyle(entry).shape === 'big-little-big') continue;
    const color = withAlpha(toneColors[cpDiagnosticMarkerTone(entry)], 0.85);
    for (const segment of entry.segments ?? []) segs.push({ a: segment.a, b: segment.b, color });
  }
  const count = segs.length;
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const widthMul = new Float32Array(count).fill(1.6);
  segs.forEach((s, i) => {
    a[i * 2] = s.a.x;
    a[i * 2 + 1] = s.a.y;
    b[i * 2] = s.b.x;
    b[i * 2 + 1] = s.b.y;
    color.set(s.color, i * 4);
  });
  return { a, b, color, widthMul, count };
}

/**
 * Build big-little-big sector wedges: for each pair of consecutive crease rays
 * around the vertex, a filled triangle out to a screen-radius rim (the boundary edge
 * closing the loop is skipped, matching the SVG). The renderer scales the rim by
 * markerScalePx so the wedges track the other diagnostic markers as the camera zooms.
 */
export function buildCpDiagnosticWedges(
  entries: readonly OristudioCpDiagnosticEntry[],
  toneColors: Record<CpDiagnosticMarkerTone, Rgba>
): WedgeGeometry {
  const wedges: { center: Point; dir0: Point; dir1: Point; color: Rgba }[] = [];
  for (const entry of entries) {
    if (!entry.point || !cpHasBlbWedges(entry)) continue;
    const vertex = entry.point;
    const base = toneColors[cpDiagnosticMarkerTone(entry)];
    const sectors = cpBlbSectors(entry);
    for (let i = 0; i < sectors.length; i += 1) {
      const sector = sectors[i];
      // The wrap-around wedge from the last ray is dropped when it is the boundary.
      if (i === sectors.length - 1 && sector.segment.color === 'Black0') continue;
      const next = sectors[(i + 1) % sectors.length];
      const e0 = diagnosticSegmentEndpoint(vertex, sector.segment);
      const e1 = diagnosticSegmentEndpoint(vertex, next.segment);
      wedges.push({
        center: vertex,
        dir0: { x: e0.x - vertex.x, y: e0.y - vertex.y },
        dir1: { x: e1.x - vertex.x, y: e1.y - vertex.y },
        color: withAlpha(
          base,
          sector.violating ? CP_DIAGNOSTIC_BLB_VIOLATING_ALPHA : CP_DIAGNOSTIC_BLB_QUIET_ALPHA
        ),
      });
    }
  }
  const count = wedges.length;
  const center = new Float32Array(count * 2);
  const dir0 = new Float32Array(count * 2);
  const dir1 = new Float32Array(count * 2);
  const radiusPx = new Float32Array(count).fill(CP_DIAGNOSTIC_BLB_RADIUS);
  const color = new Float32Array(count * 4);
  wedges.forEach((w, i) => {
    center[i * 2] = w.center.x;
    center[i * 2 + 1] = w.center.y;
    dir0[i * 2] = w.dir0.x;
    dir0[i * 2 + 1] = w.dir0.y;
    dir1[i * 2] = w.dir1.x;
    dir1[i * 2 + 1] = w.dir1.y;
    color.set(w.color, i * 4);
  });
  return { center, dir0, dir1, radiusPx, color, count };
}

export function diagnosticSegmentEndpoint(point: Point, segment: OristudioCpLineSegment): Point {
  const distanceA = squaredDistance(point, segment.a);
  const distanceB = squaredDistance(point, segment.b);
  return distanceA > distanceB ? segment.a : segment.b;
}

function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
