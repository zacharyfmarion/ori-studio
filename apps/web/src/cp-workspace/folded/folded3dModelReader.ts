/**
 * Reading the kernel's `Folded3dRenderModel` — the four strides, and nothing
 * else.
 *
 * The payload is struct-of-arrays (see {@link OristudioCpFolded3dRenderModel}),
 * so every consumer needs the same handful of index calculations. There are two
 * consumers now — the CPU projector, which is becoming the export path, and the
 * GPU mesh builder, which is becoming the live one — and the numbers they read
 * must be *the same numbers*, not the same formula written twice.
 *
 * {@link modelRadius} is the sharp case. It is what
 * `folded3dFrameRadius` sizes a figure's frame from and what the mesh scales its
 * layer displacement by, so a second copy that drifted by a hair would put the
 * model fractionally outside the window it is drawn in, at a size nobody could
 * explain from either file alone.
 *
 * Bodies here are lifted verbatim out of `foldedFigure3dProjection.ts`; the
 * projector's golden tests are the gate on that.
 */

import type { Vec3 } from '@treemaker/origami-simulator';
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_PLANE_FRAME_STRIDE,
  type OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';

/**
 * A plane's emitted frame.
 *
 * `u × v == up`, so counter-clockwise in `(u, v)` means the paper's front faces
 * `up` (`crates/oristudio-cp/src/folding3d/planes.rs`). **Emitted, never
 * recomputed** — a tangent re-derived from a local seed has a different
 * chirality, and every stack read off the projected winding then comes out
 * reversed.
 */
export interface PlaneFrame {
  up: Vec3;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

export function planeFrame(
  model: OristudioCpFolded3dRenderModel,
  plane: number
): PlaneFrame {
  const base = plane * FOLDED_3D_PLANE_FRAME_STRIDE;
  const at = (offset: number): Vec3 => [
    model.plane_frames[base + offset] ?? 0,
    model.plane_frames[base + offset + 1] ?? 0,
    model.plane_frames[base + offset + 2] ?? 0,
  ];
  return { up: at(0), origin: at(3), u: at(6), v: at(9) };
}

export function cellRing(model: OristudioCpFolded3dRenderModel, cell: number): Vec3[] {
  const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
  const start = model.cell_attr[base + 1] ?? 0;
  const length = model.cell_attr[base + 2] ?? 0;
  const ring: Vec3[] = [];
  for (let i = 0; i < length; i += 1) {
    const at = (start + i) * 3;
    ring.push([
      model.cell_points[at] ?? 0,
      model.cell_points[at + 1] ?? 0,
      model.cell_points[at + 2] ?? 0,
    ]);
  }
  return ring;
}

/** Face ids of one cell, **top first** with respect to that cell's plane `up`. */
export function cellStack(model: OristudioCpFolded3dRenderModel, cell: number): number[] {
  const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
  const start = model.cell_attr[base + 3] ?? 0;
  const length = model.cell_attr[base + 4] ?? 0;
  return model.cell_stack.slice(start, start + length);
}

/** The side that face's paper front faces, in world coordinates. */
export function faceNormal(model: OristudioCpFolded3dRenderModel, face: number): Vec3 {
  const at = face * 3;
  return [
    model.face_normals[at] ?? 0,
    model.face_normals[at + 1] ?? 0,
    model.face_normals[at + 2] ?? 0,
  ];
}

export function edgeEnds(
  model: OristudioCpFolded3dRenderModel,
  edge: number
): [Vec3, Vec3] {
  const at = edge * 6;
  return [
    [model.edge_points[at] ?? 0, model.edge_points[at + 1] ?? 0, model.edge_points[at + 2] ?? 0],
    [
      model.edge_points[at + 3] ?? 0,
      model.edge_points[at + 4] ?? 0,
      model.edge_points[at + 5] ?? 0,
    ],
  ];
}

/** Mean of every cell vertex — the point the projection is centred on. */
export function modelCentroid(model: OristudioCpFolded3dRenderModel): Vec3 {
  const count = Math.floor(model.cell_points.length / 3);
  if (count === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < count; i += 1) {
    x += model.cell_points[i * 3] ?? 0;
    y += model.cell_points[i * 3 + 1] ?? 0;
    z += model.cell_points[i * 3 + 2] ?? 0;
  }
  return [x / count, y / count, z / count];
}

/** Max distance of any cell vertex from {@link modelCentroid}. */
export function modelRadius(model: OristudioCpFolded3dRenderModel): number {
  const centre = modelCentroid(model);
  let radius = 0;
  const count = Math.floor(model.cell_points.length / 3);
  for (let i = 0; i < count; i += 1) {
    radius = Math.max(
      radius,
      Math.hypot(
        (model.cell_points[i * 3] ?? 0) - centre[0],
        (model.cell_points[i * 3 + 1] ?? 0) - centre[1],
        (model.cell_points[i * 3 + 2] ?? 0) - centre[2]
      )
    );
  }
  return radius;
}
