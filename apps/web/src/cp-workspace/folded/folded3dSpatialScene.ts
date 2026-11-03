import {
  bounds,
  createLineClipper,
  pickSpread,
  spatialVisibility,
  visibleFragments,
  type Point,
  type Point3,
  type ProjectedSpread,
  type Triangle,
} from '@oristudio/layer-spread';
import {
  toViewSpace,
  projectViewPoint,
  shadeFor,
  edgeBoundaryFlags,
  EDGE_BOUNDARY_A,
  EDGE_BOUNDARY_B,
  type CameraUniforms,
  type PaperScene,
  type PaperItem,
  type PaperLineRole,
} from '@treemaker/origami-simulator';
import type { Folded3dMesh } from './folded3dMesh';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { lightVector } from '../../lib/paper/paperStyleResolve';

interface Corner {
  view: Point3;
  weights: Point3;
}
export interface SpatialProjection {
  projected: ProjectedSpread;
  /** Clipped corners still refer to the original material triangle. */
  corners: Corner[];
  sourceTriangles: number[];
  view: Point3[];
}
const mix = (a: Point3, b: Point3, t: number): Point3 =>
  a.map((v, i) => v + t * (b[i]! - v)) as Point3;

/** Homogeneous near/far clipping precedes perspective division. Reciprocal
 * eye distance is affine on screen and orders intersecting planes correctly. */
export function projectSpatialMesh(
  mesh: Folded3dMesh,
  camera: CameraUniforms
): SpatialProjection {
  if (!mesh.spatial) throw new Error('Missing spatial visibility');
  const view: Point3[] = Array.from(
    { length: mesh.positions.length / 3 },
    (_, v) =>
      toViewSpace(
        mesh.positions[3 * v]!,
        mesh.positions[3 * v + 1]!,
        mesh.positions[3 * v + 2]!,
        camera
      )
  );
  const corners: Corner[] = [],
    positions: Point3[] = [],
    triangles: Triangle[] = [],
    sourceTriangles: number[] = [],
    triangleFaces: number[] = [];
  const near = camera.camDist * 0.1,
    far = camera.camDist + 2 * camera.depthRange;
  for (let t = 0; t < mesh.topology.faceIndices.length / 3; t++) {
    let polygon: Corner[] = [0, 1, 2].map((k) => ({
      view: view[mesh.topology.faceIndices[3 * t + k]!]!,
      weights: [0, 1, 2].map((i) => (i === k ? 1 : 0)) as Point3,
    }));
    for (const signed of [
      (p: Point3) => camera.camDist - p[2] - near,
      (p: Point3) => far - camera.camDist + p[2],
    ]) {
      const out: Corner[] = [];
      polygon.forEach((a, i) => {
        const b = polygon[(i + 1) % polygon.length]!,
          da = signed(a.view),
          db = signed(b.view);
        if (da >= 0) out.push(a);
        if (da >= 0 !== db >= 0) {
          const u = da / (da - db);
          out.push({
            view: mix(a.view, b.view, u),
            weights: mix(a.weights, b.weights, u),
          });
        }
      });
      polygon = out;
    }
    const start = corners.length;
    for (const c of polygon) {
      corners.push(c);
      positions.push([
        ...projectViewPoint(c.view, camera),
        1 / (camera.camDist - c.view[2]),
      ]);
    }
    for (let k = 1; k + 1 < polygon.length; k++) {
      triangles.push([start, start + k, start + k + 1]);
      sourceTriangles.push(t);
      triangleFaces.push(mesh.spatial.triangleFaces[t]!);
    }
  }
  const eye = camera.center.map(
    (v, i) => v + camera.camDist * camera.rotation[6 + i]!
  ) as Point3;
  return {
    projected: {
      positions,
      triangles,
      triangleFaces,
      visibility: spatialVisibility(
        mesh.spatial.ranges.length,
        mesh.spatial.planes,
        eye
      ),
    },
    corners,
    sourceTriangles,
    view,
  };
}

/** A pick returns perspective-correct weights on the original material triangle. */
export function pickSpatialMesh(
  mesh: Folded3dMesh,
  camera: CameraUniforms,
  point: Point
) {
  const projection = projectSpatialMesh(mesh, camera),
    picked = pickSpread(projection.projected, point);
  if (!picked) return null;
  const ids = projection.projected.triangles[picked.triangle]!;
  const reciprocal = ids.map(
    (v, k) => picked.weights[k]! * projection.projected.positions[v]![2]
  );
  const sum = reciprocal.reduce((a, b) => a + b, 0);
  const weights = [0, 1, 2].map((axis) =>
    ids.reduce(
      (s, v, k) =>
        s + (reciprocal[k]! / sum) * projection.corners[v]!.weights[axis]!,
      0
    )
  ) as Point3;
  return {
    face: picked.face,
    triangle: projection.sourceTriangles[picked.triangle]!,
    weights,
    depth: picked.depth,
  };
}

/** Matching vector surface, with original hidden material retained for editing. */
export function spatialPaperScene(
  mesh: Folded3dMesh,
  camera: CameraUniforms,
  style: PaperStyle
): PaperScene {
  const projection = projectSpatialMesh(mesh, camera),
    { projected } = projection;
  const fragments = visibleFragments(projected);
  const items: PaperItem[] = [];
  const light = lightVector(style.light.azimuth, style.light.elevation);
  const attributes = projected.triangles.map((ids) => {
    const [a, b, c] = ids.map((v) => projection.corners[v]!.view) as [
      Point3,
      Point3,
      Point3,
    ];
    const u = b.map((v, i) => v - a[i]!),
      v = c.map((v, i) => v - a[i]!);
    const normal: Point3 = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    const [x, y, z] = ids.map((i) => projected.positions[i]!) as [
      Point3,
      Point3,
      Point3,
    ];
    // Canvas y is down; GL's front winding is CCW in y-up NDC.
    const front =
      (y[0] - x[0]) * (z[1] - x[1]) - (y[1] - x[1]) * (z[0] - x[0]) < 0;
    return {
      side: front ? ('front' as const) : ('back' as const),
      shade: style.light.enabled ? shadeFor(normal, light) : 1,
    };
  });
  projected.triangles.forEach((ids, t) =>
    items.push({
      kind: 'face',
      face: projected.triangleFaces[t]!,
      ...attributes[t]!,
      rings: [ids.map((v) => projected.positions[v]!.slice(0, 2) as Point)],
      hidden: true,
    })
  );
  for (const f of fragments)
    items.push({
      kind: 'face',
      face: f.face,
      ...attributes[f.triangle]!,
      rings: [f.polygon],
      hidden: false,
    });
  const clip = createLineClipper(projected);
  const boundary = edgeBoundaryFlags(mesh.topology);
  const roles: PaperLineRole[] = ['edge', 'mountain', 'valley', 'aux'];
  const near = camera.camDist * 0.1,
    far = camera.camDist + 2 * camera.depthRange;
  const bias = 1e-5 / ((2 * far * near) / (far - near));
  for (let e = 0; e < mesh.topology.edgeAssignments.length; e++) {
    const role = roles[mesh.topology.edgeAssignments[e]!];
    if (!role) continue;
    const a = projection.view[mesh.topology.edgeIndices[2 * e]!]!,
      b = projection.view[mesh.topology.edgeIndices[2 * e + 1]!]!;
    // Material displacement bounds keep ordinary cameras outside the model;
    // captures at custom cameras clip ink at exactly the face near/far planes.
    let lo = 0,
      hi = 1;
    for (const signed of [
      (p: Point3) => camera.camDist - p[2] - near,
      (p: Point3) => far - camera.camDist + p[2],
    ]) {
      const da = signed(a),
        db = signed(b);
      if (da < 0 && db < 0) {
        hi = -1;
        break;
      }
      if (da < 0) lo = Math.max(lo, da / (da - db));
      else if (db < 0) hi = Math.min(hi, da / (da - db));
    }
    if (hi < lo) continue;
    const p = mix(a, b, lo),
      q = mix(a, b, hi);
    const pa: Point3 = [
        ...projectViewPoint(p, camera),
        1 / (camera.camDist - p[2]) + bias,
      ],
      pb: Point3 = [
        ...projectViewPoint(q, camera),
        1 / (camera.camDist - q[2]) + bias,
      ];
    const face = mesh.spatial!.edgeFaces[e]!;
    const onBoundary: [boolean, boolean] = [
      (boundary[e]! & EDGE_BOUNDARY_A) !== 0,
      (boundary[e]! & EDGE_BOUNDARY_B) !== 0,
    ];
    const whole = {
      a: pa.slice(0, 2) as Point,
      b: pb.slice(0, 2) as Point,
      onBoundary,
    };
    items.push({ kind: 'line', role, face, ...whole, hidden: true });
    for (const [s, t] of clip(face, pa, pb))
      items.push({
        kind: 'line',
        role,
        face,
        a: mix(pa, pb, s).slice(0, 2) as Point,
        b: mix(pa, pb, t).slice(0, 2) as Point,
        onBoundary,
        whole,
        hidden: false,
      });
  }
  const points = projected.positions;
  const [minX, minY, maxX, maxY] = points.length
    ? bounds(points)
    : [0, 0, 0, 0];
  // Editable hidden ink must stay under the visible paper when an export keeps
  // hidden pieces. Interleaving it after fills would paint buried creases on top.
  items.sort((a, b) => Number(b.hidden) - Number(a.hidden));
  return {
    sheet: mesh.sheet * camera.scale,
    bounds: { minX, minY, maxX, maxY },
    items,
  };
}
