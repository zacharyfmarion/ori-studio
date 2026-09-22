// What the scene producer reads off a projected mesh before ordering it:
// which triangles are worth drawing and which side of the paper each shows,
// which edges are creases and of what kind, and the screen-with-depth points
// the BSP cuts in. Kept apart from `paperScene.ts` so a second producer (the
// 3D folded figure's mesh path) reads the same facts rather than restating
// them — which is how two outputs would stop agreeing.
import type { ProjectedVertices } from './webgl/camera.js';
import type { MeshTopology } from './webgl/meshRenderer.js';
import type { Vec3 } from './bsp.js';
import { EDGE_CODE } from './edgeCodes.js';

/**
 * What a vector renderer needs of {@link MeshTopology}: everything except the
 * solver's texture edge, which is how the vertex shader finds a position and
 * means nothing here. A full `MeshTopology` satisfies this.
 */
export type SvgMeshTopology = Omit<MeshTopology, 'textureDim'>;

/**
 * Screen area below which a triangle is dropped.
 *
 * A zero-area triangle is the signature of a solver NaN reaching the renderer
 * (see `prepareFoldModel`'s guard), and it also cannot cover a pixel, so
 * emitting it would add an invisible degenerate polygon per occurrence.
 */
export const MIN_SCREEN_AREA = 1e-6;

/**
 * How far toward the eye a crease is nudged, in the NDC depth units the edge
 * shader biases by, so the two agree about when a crease clears its own faces.
 */
export const CREASE_DEPTH_BIAS_NDC = 0.0008;

export interface Triangle {
  a: number;
  b: number;
  c: number;
  /** Index into `faceIndices`, for looking up which source face this came from. */
  source: number;
  depth: number;
  /**
   * Signed screen area, negated so positive means front. Which side of the paper
   * faces the viewer — see the note where it is computed.
   */
  winding: number;
}

export interface Crease {
  from: number;
  to: number;
  /** The edge's index in the topology. */
  edge: number;
  assignment: number;
}

/** Triangles worth drawing, with the side of the paper each one shows. */
export function collectFaces(topology: SvgMeshTopology, projected: ProjectedVertices): Triangle[] {
  const triangles: Triangle[] = [];
  const faceCount = Math.floor(topology.faceIndices.length / 3);

  for (let face = 0; face < faceCount; face += 1) {
    const a = topology.faceIndices[face * 3]!;
    const b = topology.faceIndices[face * 3 + 1]!;
    const c = topology.faceIndices[face * 3 + 2]!;
    if (!screenFinite(projected, a) || !screenFinite(projected, b) || !screenFinite(projected, c)) {
      continue;
    }
    if (Math.abs(screenArea(projected, a, b, c)) < MIN_SCREEN_AREA) continue;

    const depth =
      (projected.view[a * 3 + 2]! + projected.view[b * 3 + 2]! + projected.view[c * 3 + 2]!) / 3;
    // Winding from *screen* space — after the perspective scale — because that is
    // where `gl_FrontFacing` decides it, and negated because pixel y points down
    // while view y points up.
    //
    // View space is not equivalent here. The vertex shader does not do a real
    // perspective divide (it leaves `gl_Position.w` at 1) and instead scales x
    // and y by a per-vertex `camDist/(camDist - depth)`. That is a nonlinear
    // warp, not a projective map, so it can reorder a triangle's vertices —
    // measured at 1-7% of faces on a folded Miura, which showed up as patches of
    // the paper's back side in an export that the GPU drew as front.
    triangles.push({ a, b, c, source: face, depth, winding: -screenArea(projected, a, b, c) });
  }

  return triangles;
}

/**
 * Edges worth drawing: those whose code passes `drawn`. Unassigned edges read
 * as border (see `EDGE_CODE`); facet edges are never a crease, whatever the
 * caller asks for.
 */
export function collectCreases(
  topology: SvgMeshTopology,
  projected: ProjectedVertices,
  drawn: (code: number) => boolean
): Crease[] {
  const creases: Crease[] = [];
  for (let edge = 0; edge < topology.edgeAssignments.length; edge += 1) {
    const assignment = topology.edgeAssignments[edge]!;
    if (assignment === EDGE_CODE.facet || !drawn(assignment)) continue;
    const from = topology.edgeIndices[edge * 2]!;
    const to = topology.edgeIndices[edge * 2 + 1]!;
    if (!screenFinite(projected, from) || !screenFinite(projected, to)) continue;
    creases.push({ from, to, edge, assignment });
  }
  return creases;
}

/**
 * Screen position with view depth as the third axis — the space the BSP cuts in.
 * See the note in `meshToPaperScene`.
 */
export function screenPoints(
  projected: ProjectedVertices,
  indices: readonly number[],
  depthBias = 0
): Vec3[] {
  return indices.map((v) => [
    projected.screen[v * 2]!,
    projected.screen[v * 2 + 1]!,
    projected.view[v * 3 + 2]! + depthBias,
  ]);
}

/**
 * View-space `x, y, depth` — the space the BSP cuts in under
 * `MeshToPaperSceneOptions.layers`, where the mesh's planes are planes.
 */
export function viewPoints(projected: ProjectedVertices, indices: readonly number[]): Vec3[] {
  return indices.map((v) => [
    projected.view[v * 3]!,
    projected.view[v * 3 + 1]!,
    projected.view[v * 3 + 2]!,
  ]);
}

/**
 * The triangle's geometric normal in view space, unnormalised — what the face
 * shader's flat lighting reads, oriented by `shadeFor` toward the viewer.
 */
export function viewNormal(triangle: Triangle, projected: ProjectedVertices): Vec3 {
  const at = (vertex: number) =>
    [
      projected.view[vertex * 3]!,
      projected.view[vertex * 3 + 1]!,
      projected.view[vertex * 3 + 2]!,
    ] as const;
  const [ax, ay, az] = at(triangle.a);
  const [bx, by, bz] = at(triangle.b);
  const [cx, cy, cz] = at(triangle.c);
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of a set of point lists, ignoring non-finite points. Null when empty. */
export function pointBounds(
  pointLists: Iterable<ReadonlyArray<readonly [number, number]>>
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const points of pointLists) {
    for (const [x, y] of points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

function screenFinite(projected: ProjectedVertices, vertex: number): boolean {
  return (
    Number.isFinite(projected.screen[vertex * 2]) &&
    Number.isFinite(projected.screen[vertex * 2 + 1])
  );
}

function screenArea(projected: ProjectedVertices, a: number, b: number, c: number): number {
  const ax = projected.screen[a * 2]!;
  const ay = projected.screen[a * 2 + 1]!;
  return (
    ((projected.screen[b * 2]! - ax) * (projected.screen[c * 2 + 1]! - ay) -
      (projected.screen[b * 2 + 1]! - ay) * (projected.screen[c * 2]! - ax)) /
    2
  );
}
