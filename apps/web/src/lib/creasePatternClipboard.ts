import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import type { Point } from './geometry';
import type { OristudioCpSelection } from './creasePatternViewport';

const DEFAULT_PASTE_OFFSET = 8;
const ROTATION_SNAP_DEGREES = 22.5;

export interface CpLineSelectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  center: Point;
}

export interface CpLineSelectionFrame {
  center: Point;
  axisX: Point;
  axisY: Point;
  width: number;
  height: number;
  angleDegrees: number;
  corners: {
    topLeft: Point;
    topRight: Point;
    bottomRight: Point;
    bottomLeft: Point;
  };
}

export interface CpLineClipboardPayload {
  kind: 'cp-lines';
  lines: OristudioCpLineSegment[];
  bounds: CpLineSelectionBounds;
}

export type CpSelectionTransform =
  | { kind: 'translate'; delta: Point }
  | {
      kind: 'scale';
      frame: CpLineSelectionFrame;
      anchor: Point;
      scaleX: number;
      scaleY: number;
    }
  | { kind: 'rotate'; angleDegrees: number; center?: Point }
  | { kind: 'flip-horizontal'; center?: Point; swapMountainValley?: boolean }
  | { kind: 'flip-vertical'; center?: Point; swapMountainValley?: boolean };

export function selectedCpLineSegments(
  document: OristudioCpDocumentSnapshot | null | undefined,
  selection: OristudioCpSelection
): OristudioCpLineSegment[] {
  if (!document || selection.lines.length === 0) return [];
  return selection.lines
    .map((id) => document.crease_pattern.line_segments[id - 1])
    .filter((line): line is OristudioCpLineSegment => Boolean(line))
    .map(cloneCpLineSegment);
}

export function isOrieditaFoldableLineColor(color: OristudioCpLineSegment['color']): boolean {
  return color === 'Black0' || color === 'Red1' || color === 'Blue2';
}

export function selectedFoldableCpLineIds(
  document: OristudioCpDocumentSnapshot | null | undefined,
  selection: OristudioCpSelection
): number[] {
  if (!document || selection.lines.length === 0) return [];
  return selection.lines.filter((id) => {
    const line = document.crease_pattern.line_segments[id - 1];
    return Boolean(line && isOrieditaFoldableLineColor(line.color));
  });
}

export function buildCpLineClipboardPayload(
  document: OristudioCpDocumentSnapshot | null | undefined,
  selection: OristudioCpSelection
): CpLineClipboardPayload | null {
  const lines = selectedCpLineSegments(document, selection);
  const bounds = cpLineSelectionBounds(lines);
  return bounds ? { kind: 'cp-lines', lines, bounds } : null;
}

export function cpLineSelectionBounds(
  lines: readonly OristudioCpLineSegment[]
): CpLineSelectionBounds | null {
  if (lines.length === 0) return null;
  const points = lines.flatMap((line) => [line.a, line.b]);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    },
  };
}

export function cpLineSelectionMoveAnchorPoints(
  lines: readonly OristudioCpLineSegment[],
  angleDegrees = 0
): Point[] {
  const frame = cpLineSelectionFrame(lines, angleDegrees);
  if (!frame) return [];
  return [
    ...lines.flatMap((line) => [line.a, line.b]),
    frame.corners.topLeft,
    frame.corners.topRight,
    frame.corners.bottomRight,
    frame.corners.bottomLeft,
  ];
}

export function cpLineSelectionFrame(
  lines: readonly OristudioCpLineSegment[],
  angleDegrees = 0
): CpLineSelectionFrame | null {
  const points = uniquePoints(lines.flatMap((line) => [line.a, line.b]));
  if (points.length === 0) return null;
  return frameForAngle(points, (angleDegrees * Math.PI) / 180);
}

export function offsetCpLineSegmentsForPaste(
  lines: readonly OristudioCpLineSegment[],
  pasteCount: number
): OristudioCpLineSegment[] {
  const offset = DEFAULT_PASTE_OFFSET * ((pasteCount % 6) + 1);
  return lines.map((line) =>
    transformLinePoints(line, (point) => ({ x: point.x + offset, y: point.y - offset }))
  );
}

export function transformCpLineSegments(
  lines: readonly OristudioCpLineSegment[],
  transform: CpSelectionTransform
): OristudioCpLineSegment[] {
  const bounds = cpLineSelectionBounds(lines);
  if (!bounds) return [];

  if (transform.kind === 'translate') {
    return translateCpLineSegments(lines, transform.delta);
  }

  if (transform.kind === 'scale') {
    return scaleCpLineSegments(
      lines,
      transform.frame,
      transform.anchor,
      transform.scaleX,
      transform.scaleY
    );
  }

  const center = transform.center ?? bounds.center;

  if (transform.kind === 'rotate') {
    const radians = (transform.angleDegrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return lines.map((line) =>
      transformLinePoints(line, (point) => {
        const x = point.x - center.x;
        const y = point.y - center.y;
        return {
          x: center.x + x * cos - y * sin,
          y: center.y + x * sin + y * cos,
        };
      })
    );
  }

  const swap = transform.swapMountainValley ?? false;
  return lines.map((line) => {
    const transformed = transformLinePoints(line, (point) =>
      transform.kind === 'flip-horizontal'
        ? { x: center.x * 2 - point.x, y: point.y }
        : { x: point.x, y: center.y * 2 - point.y }
    );
    return swap ? swapMountainValleyLine(transformed) : transformed;
  });
}

export function translateCpLineSegments(
  lines: readonly OristudioCpLineSegment[],
  delta: Point
): OristudioCpLineSegment[] {
  return lines.map((line) =>
    transformLinePoints(line, (point) => ({ x: point.x + delta.x, y: point.y + delta.y }))
  );
}

export function scaleCpLineSegments(
  lines: readonly OristudioCpLineSegment[],
  frame: CpLineSelectionFrame,
  anchor: Point,
  scaleX: number,
  scaleY: number
): OristudioCpLineSegment[] {
  return lines.map((line) =>
    transformLinePoints(line, (point) => {
      const local = cpFramePointToLocal(frame, point);
      return cpFrameLocalToPoint(frame, {
        x: anchor.x + (local.x - anchor.x) * scaleX,
        y: anchor.y + (local.y - anchor.y) * scaleY,
      });
    })
  );
}

export function cpFramePointToLocal(
  frame: Pick<CpLineSelectionFrame, 'axisX' | 'axisY' | 'center'>,
  point: Point
): Point {
  const dx = point.x - frame.center.x;
  const dy = point.y - frame.center.y;
  return {
    x: dx * frame.axisX.x + dy * frame.axisX.y,
    y: dx * frame.axisY.x + dy * frame.axisY.y,
  };
}

export function cpFrameLocalToPoint(
  frame: Pick<CpLineSelectionFrame, 'axisX' | 'axisY' | 'center'>,
  local: Point
): Point {
  return {
    x: frame.center.x + frame.axisX.x * local.x + frame.axisY.x * local.y,
    y: frame.center.y + frame.axisX.y * local.x + frame.axisY.y * local.y,
  };
}

export function snapRotationDegrees(angleDegrees: number): number {
  return Math.round(angleDegrees / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES;
}

export function rotationAngleFromCenter(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

export function cpSelectionTransformLabel(transform: CpSelectionTransform): string {
  switch (transform.kind) {
    case 'translate':
      return 'Move CP selection';
    case 'scale':
      return 'Scale CP selection';
    case 'flip-horizontal':
      return 'Flip CP selection horizontal';
    case 'flip-vertical':
      return 'Flip CP selection vertical';
    case 'rotate':
      return `Rotate CP selection ${formatAngle(transform.angleDegrees)}`;
  }
}

function uniquePoints(points: readonly Point[]): Point[] {
  const seen = new Set<string>();
  const unique: Point[] = [];
  for (const point of points) {
    const key = `${Math.round(point.x * 1e9)}:${Math.round(point.y * 1e9)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
  }
  return unique;
}

function frameForAngle(points: readonly Point[], angleRadians: number): CpLineSelectionFrame {
  const axisX = { x: Math.cos(angleRadians), y: Math.sin(angleRadians) };
  const axisY = { x: -Math.sin(angleRadians), y: Math.cos(angleRadians) };
  const localPoints = points.map((point) => ({
    x: point.x * axisX.x + point.y * axisX.y,
    y: point.x * axisY.x + point.y * axisY.y,
  }));
  const minX = Math.min(...localPoints.map((point) => point.x));
  const maxX = Math.max(...localPoints.map((point) => point.x));
  const minY = Math.min(...localPoints.map((point) => point.y));
  const maxY = Math.max(...localPoints.map((point) => point.y));
  const centerLocal = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
  const center = {
    x: axisX.x * centerLocal.x + axisY.x * centerLocal.y,
    y: axisX.y * centerLocal.x + axisY.y * centerLocal.y,
  };
  const frameBase = {
    center,
    axisX,
    axisY,
    width: maxX - minX,
    height: maxY - minY,
    angleDegrees: (angleRadians * 180) / Math.PI,
  };
  return {
    ...frameBase,
    corners: {
      topLeft: cpFrameLocalToPoint(frameBase, {
        x: minX - centerLocal.x,
        y: maxY - centerLocal.y,
      }),
      topRight: cpFrameLocalToPoint(frameBase, {
        x: maxX - centerLocal.x,
        y: maxY - centerLocal.y,
      }),
      bottomRight: cpFrameLocalToPoint(frameBase, {
        x: maxX - centerLocal.x,
        y: minY - centerLocal.y,
      }),
      bottomLeft: cpFrameLocalToPoint(frameBase, {
        x: minX - centerLocal.x,
        y: minY - centerLocal.y,
      }),
    },
  };
}

function formatAngle(angleDegrees: number): string {
  const rounded = Math.round(angleDegrees * 100) / 100;
  return `${rounded} deg`;
}

function transformLinePoints(
  line: OristudioCpLineSegment,
  transform: (point: Point) => Point
): OristudioCpLineSegment {
  return {
    ...cloneCpLineSegment(line),
    a: transform(line.a),
    b: transform(line.b),
  };
}

function cloneCpLineSegment(line: OristudioCpLineSegment): OristudioCpLineSegment {
  return {
    ...line,
    a: { ...line.a },
    b: { ...line.b },
    customized_color: { ...line.customized_color },
  };
}

function swapMountainValleyLine(line: OristudioCpLineSegment): OristudioCpLineSegment {
  if (line.color === 'Red1') return { ...line, color: 'Blue2' };
  if (line.color === 'Blue2') return { ...line, color: 'Red1' };
  return line;
}
