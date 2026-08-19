import type { Point } from './geometry';

/**
 * Model-agnostic symmetry math: a symmetry axis and the reflect / project / snap /
 * side operations over plain points. Shared by both the TreeMaker authoring adapter
 * ({@link ./symmetryAuthoring}) and the Box-Pleating tree adapter
 * ({@link ./bpTreeSymmetry}) so the geometry has a single source of truth. Nothing
 * here knows about any node/tree model — it takes only {@link Point}s and an axis.
 */

export const SYMMETRY_AUTHORING_TOLERANCE = 0.015;

export interface SymmetryAxis {
  loc: Point;
  angle: number;
}

export function axisDirection(axis: SymmetryAxis): Point {
  const radians = (axis.angle * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

export function projectOntoSymmetryAxis(point: Point, axis: SymmetryAxis): Point {
  const direction = axisDirection(axis);
  const dx = point.x - axis.loc.x;
  const dy = point.y - axis.loc.y;
  const dot = dx * direction.x + dy * direction.y;
  return {
    x: axis.loc.x + dot * direction.x,
    y: axis.loc.y + dot * direction.y,
  };
}

export function reflectPointAcrossSymmetryAxis(point: Point, axis: SymmetryAxis): Point {
  const projected = projectOntoSymmetryAxis(point, axis);
  return {
    x: 2 * projected.x - point.x,
    y: 2 * projected.y - point.y,
  };
}

export function distanceToSymmetryAxis(point: Point, axis: SymmetryAxis): number {
  const direction = axisDirection(axis);
  const dx = point.x - axis.loc.x;
  const dy = point.y - axis.loc.y;
  return Math.abs(dx * direction.y - dy * direction.x);
}

export function symmetrySide(
  point: Point,
  axis: SymmetryAxis,
  tolerance = SYMMETRY_AUTHORING_TOLERANCE,
): -1 | 0 | 1 {
  const direction = axisDirection(axis);
  const dx = point.x - axis.loc.x;
  const dy = point.y - axis.loc.y;
  const cross = dx * direction.y - dy * direction.x;
  if (Math.abs(cross) <= tolerance) return 0;
  return cross < 0 ? -1 : 1;
}

export function snapPointToSymmetryAxis(
  point: Point,
  axis: SymmetryAxis,
  tolerance = SYMMETRY_AUTHORING_TOLERANCE,
): { point: Point; snapped: boolean; distance: number } {
  const distance = distanceToSymmetryAxis(point, axis);
  if (distance > tolerance) return { point, snapped: false, distance };
  return { point: projectOntoSymmetryAxis(point, axis), snapped: true, distance };
}
