/** Experimental lift → camera drawing, with layer order or diagnostic BSP depth. */
import { buildBsp, traverseBsp, type BspItem, type Vec3 } from '@treemaker/origami-simulator';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PaperItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { foldedFlatPaperScene } from './foldedFlatScene';
import { cameraSpreadLift, liftWeights, type CameraSpreadLift } from './cameraSpreadLift';
import { cameraPaintPlans } from './cameraSpreadVisibility';

export interface CameraSpreadOptions {
  /** Total depth bound as a fraction of original folded extent. */
  amount: number;
  /** Azimuth around the paper, degrees from screen right toward screen down. */
  directionDeg: number;
  /** 0 is top-down, 90 edge-on, 180 the underside. Diagram mode stops at 80. */
  inclinationDeg: number;
  projection: 'diagram' | 'orthographic' | 'perspective';
  /** Authored diagram order by default; raw depth is an explicit diagnostic. */
  visibility?: 'layers' | 'depth';
}
interface FaceStyle {
  face: number;
  front: boolean;
  orientation: number;
}
interface EdgeStyle {
  role: 'edge' | 'aux';
}
interface PreparedDrawing {
  tree: ReturnType<typeof buildBsp>;
  faces: FaceStyle[];
  edges: EdgeStyle[];
  centre: ScenePoint;
}
const drawings = new WeakMap<CameraSpreadLift, PreparedDrawing>();

function drawing(mesh: CameraSpreadLift, kernel: OristudioCpFoldedPaperScene): PreparedDrawing {
  const held = drawings.get(mesh);
  if (held) return held;
  // Bent panels produce many BSP splits. The live explorer uses GPU visibility;
  // this experimental vector path refuses large meshes rather than freezing UI.
  if (mesh.triangles.length > 2000) {
    throw new Error('Experimental camera vector projection exceeds its 2,000-triangle budget');
  }
  const items: BspItem[] = [];
  const faces: FaceStyle[] = [];
  const edges: EdgeStyle[] = [];
  const rank = new Int32Array(kernel.faces.length);
  mesh.order.forEach((f, i) => {
    rank[f] = i;
  });
  const point = (v: number): Vec3 => [mesh.xy[v]!.x, mesh.xy[v]!.y, mesh.heights[v]!];
  for (const { vertices, face } of mesh.triangles) {
    const points = vertices.map(point);
    const [a, b, c] = points as [Vec3, Vec3, Vec3];
    faces.push({
      face,
      front: kernel.faces[face]!.front_up,
      orientation: Math.sign(area(a, b, c)),
    });
    items.push({
      kind: 0,
      ref: faces.length - 1,
      points,
      order: rank[face]! * 2,
    });
  }
  const edge = (points: Vec3[], face: number, role: EdgeStyle['role']) => {
    edges.push({ role });
    items.push({
      kind: 1,
      ref: edges.length - 1,
      points,
      order: rank[face]! * 2 + 1,
    });
  };
  mesh.faceVertices.forEach((ring, f) => {
    for (let i = 0; i < ring.length; i++)
      edge(
        [point(ring[i]!), point(ring[(i + 1) % ring.length]!)],
        f,
        kernel.faces[f]!.edges[i]?.kind === 'flat' ? 'aux' : 'edge'
      );
  });
  // Auxiliary lines must be split at the lifted triangulation, since their
  // height is piecewise linear. Clip them against each triangle in XY.
  for (const line of kernel.aux_lines) {
    const a = {
      x: (line.from.x - mesh.origin.x) / mesh.size,
      y: (line.from.y - mesh.origin.y) / mesh.size,
    };
    const b = {
      x: (line.to.x - mesh.origin.x) / mesh.size,
      y: (line.to.y - mesh.origin.y) / mesh.size,
    };
    for (const t of mesh.faceTriangles[line.face] ?? []) {
      const ring = mesh.triangles[t]!.vertices.map((v) => mesh.xy[v]!);
      let lo = 0;
      let hi = 1;
      const sign = Math.sign(
        (ring[1]!.x - ring[0]!.x) * (ring[2]!.y - ring[0]!.y) -
          (ring[1]!.y - ring[0]!.y) * (ring[2]!.x - ring[0]!.x)
      );
      for (let j = 0; j < 3; j++) {
        const u = ring[j]!;
        const v = ring[(j + 1) % 3]!;
        const side = (p: typeof a) => sign * ((v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x));
        const s = side(a);
        const e = side(b);
        if (s < 0 && e < 0) {
          hi = -1;
          break;
        }
        if (s < 0) lo = Math.max(lo, s / (s - e));
        if (e < 0) hi = Math.min(hi, s / (s - e));
      }
      if (hi - lo < 1e-9) continue;
      const points = [lo, hi].map((u): Vec3 => {
        const p = { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) };
        const w = liftWeights(mesh, line.face, p);
        return [p.x, p.y, w?.reduce((sum, [v, weight]) => sum + weight * mesh.heights[v]!, 0) ?? 0];
      });
      edge(points, line.face, 'aux');
    }
  }
  const xs = mesh.xy.map((p) => p.x);
  const ys = mesh.xy.map((p) => p.y);
  const centre: ScenePoint = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  const result = {
    tree: buildBsp(items, { coplanarEps: 1e-9, orderBeforeKind: true }),
    faces,
    edges,
    centre,
  };
  drawings.set(mesh, result);
  return result;
}

/** Cached unit-height geometry survives positive depth scales and camera changes. */
export function cameraSpreadScene(
  kernel: OristudioCpFoldedPaperScene,
  options: CameraSpreadOptions
): PaperScene {
  const { amount, directionDeg, inclinationDeg, projection } = options;
  if (![amount, directionDeg, inclinationDeg].every(Number.isFinite) || amount < 0 || amount > 0.2) {
    throw new Error('Camera spread needs finite controls and amount in [0, 0.2]');
  }
  // Exact original path, including its handling of woven coplanar stacks.
  if (amount === 0)
    return foldedFlatPaperScene(kernel, {
      markHidden: false,
      toScenePx: (p) => [p.x, p.y],
      scale: 1,
    });
  const mesh = cameraSpreadLift(kernel);
  const geometric = options.visibility === 'depth';
  const prepared = geometric ? drawing(mesh, kernel) : null;
  const phi = (directionDeg * Math.PI) / 180;
  const theta =
    ((projection === 'diagram' ? Math.min(80, Math.max(0, inclinationDeg)) : inclinationDeg) * Math.PI) / 180;
  const u = Math.cos(phi);
  const v = Math.sin(phi);
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  const xs = mesh.xy.map((p) => p.x),
    ys = mesh.xy.map((p) => p.y);
  const [cx, cy] = prepared?.centre ?? [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  // Inverse of the depth scaling maps the eye into the cached BSP's frame.
  const distance = projection === 'perspective' ? 2.5 : 1e8;
  const eye: Vec3 = [cx + distance * sin * u, cy + distance * sin * v, (distance * cos) / amount];
  const project = ([x, y, height]: Vec3): ScenePoint => {
    const px = x - cx;
    const py = y - cy;
    const z = height * amount;
    const along = px * u + py * v;
    const across = -px * v + py * u;
    let horizontal = along * cos - z * sin;
    let vertical = across;
    if (projection === 'diagram') horizontal /= cos;
    if (projection === 'perspective') {
      const factor = distance / (distance - along * sin - z * cos);
      horizontal *= factor;
      vertical *= factor;
    }
    return [
      mesh.origin.x + mesh.size * (cx + horizontal * u - vertical * v),
      mesh.origin.y + mesh.size * (cy + horizontal * v + vertical * u),
    ];
  };
  const plan = prepared ? null : cameraPaintPlans(mesh, kernel)[cos < 0 ? 'back' : 'front'];
  const ordered = prepared
    ? traverseBsp(prepared.tree, eye)
    : plan!.pieces.map((p, ref) => ({ kind: p.kind === 'face' ? 0 : 1, ref, points: p.points }));
  const items: PaperItem[] = [];
  for (const piece of ordered) {
    const points = piece.points.map(project);
    if (piece.kind === 0) {
      const p = plan?.pieces[piece.ref];
      const style = prepared
        ? prepared.faces[piece.ref]!
        : {
            face: p!.face,
            front: kernel.faces[p!.face]!.front_up,
            orientation: Math.sign(area(p!.points[0]!, p!.points[1]!, p!.points[2]!)),
          };
      const signed = polygonArea(points);
      if (Math.abs(signed) < 1e-10 * mesh.size ** 2) continue;
      const sameSide = Math.sign(signed) === style.orientation;
      items.push({
        kind: 'face',
        face: style.face,
        side: sameSide === style.front ? 'front' : 'back',
        shade: 1,
        rings: [points],
        hidden: false,
      });
    } else {
      items.push({
        kind: 'line',
        role: prepared ? prepared.edges[piece.ref]!.role : plan!.pieces[piece.ref]!.role!,
        a: points[0]!,
        b: points[1]!,
        onBoundary: [false, false],
        hidden: false,
      });
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items)
    for (const [x, y] of item.kind === 'face'
      ? item.rings.flat()
      : item.kind === 'line'
        ? [item.a, item.b]
        : []) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return { items, sheet: kernel.sheet, bounds: { minX, minY, maxX, maxY } };
}

function area(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  return (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
}
function polygonArea(points: ScenePoint[]): number {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
}
