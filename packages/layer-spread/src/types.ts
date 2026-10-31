/** Shared wire contracts. Coordinates are normalized, Y up; orders are lower → upper. */
export type Point = [number, number];
export type Point3 = [number, number, number];
export type Triangle = [number, number, number];
export interface SpreadInput {
  xy: Point[];
  faces: number[][];
  triangles: Triangle[];
  triangleFaces: number[];
  orders: Point[];
  planeGroups?: number[];
  cells: { faces: number[]; point: Point; area: number }[];
}
export interface SpreadReference {
  plane: Point3;
  center: Point3;
  samples: number;
  rms: number;
}
export interface SpreadSolution {
  version: 'normalized-50-v1';
  heights: number[];
  references: [SpreadReference, SpreadReference];
  diagnostics: {
    status: string;
    iterations: number;
    qp_seconds: number;
    variables: number;
    constraints: number;
    overlap_regions: number;
    crossing_weight: number;
    opening_scale: number;
    max_relative_warp: number;
    max_slope: number;
    max_crossing: number;
    rms_crossing: number;
    mean_gap: number;
  };
}
export interface ConnectedSpread {
  kind: 'connected';
  version: 1;
  amount: number;
  reveal: Point;
}
export interface ProjectedSpread {
  /** Screen X/Y and physical depth toward the eye; affine across each triangle. */
  positions: Point3[];
  triangles: Triangle[];
  triangleFaces: number[];
  visibility: Visibility;
}
export interface Visibility {
  /** Null for a cyclic graph, otherwise longest-path ranks. */
  ranks: number[] | null;
  /** Direct known blockers, without transitive closure. */
  above: number[][];
}
export interface SpreadPick {
  triangle: number;
  face: number;
  weights: Point3;
  depth: number;
}
