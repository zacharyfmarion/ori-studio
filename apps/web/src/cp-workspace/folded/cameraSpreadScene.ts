/** Experimental lift → camera drawing, with layer order or diagnostic BSP depth. */
import { buildBsp, traverseBsp, type BspItem, type Vec3 } from '@treemaker/origami-simulator';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PaperItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { foldedFlatPaperScene } from './foldedFlatScene';
import { cameraSpreadLift, type CameraSpreadLift } from './cameraSpreadLift';
import { cameraPaintPlans, type CameraPaintPlan } from './cameraSpreadVisibility';
import { cameraSpreadTransform, type CameraSpreadPose } from './cameraSpreadCamera';

/** Research control range; not a physical paper-strain guarantee. */
export const CAMERA_SPREAD_MAX_AMOUNT = 0.5;

export interface CameraSpreadOptions extends CameraSpreadPose {
  /** Total depth bound as a fraction of original folded extent. */
  amount: number;
  projection: 'diagram' | 'orthographic' | 'perspective';
  /** Strict layers in Diagram; geometric depth with layer ties in 3D. */
  visibility?: 'layers' | 'depth';
}

/** A flat stacking order cannot override geometric occlusion during a 3D orbit. */
export function cameraSpreadVisibilityMode(
  options: Pick<CameraSpreadOptions, 'projection' | 'visibility'>
): 'layers' | 'ties' | 'depth' {
  if (options.visibility === 'depth') return 'depth';
  return options.projection === 'diagram' ? 'layers' : 'ties';
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
const drawings = new WeakMap<CameraPaintPlan, Partial<Record<'ties' | 'depth', PreparedDrawing>>>();

function drawing(
  mesh: CameraSpreadLift,
  kernel: OristudioCpFoldedPaperScene,
  plan: CameraPaintPlan,
  mode: 'ties' | 'depth'
): PreparedDrawing {
  const cached = drawings.get(plan) ?? {};
  const held = cached[mode];
  if (held) return held;
  // Bent panels produce many BSP splits. The live explorer uses GPU visibility;
  // this experimental vector path refuses large meshes rather than freezing UI.
  if (mesh.triangles.length > 2000) {
    throw new Error('Experimental camera vector projection exceeds its 2,000-triangle budget');
  }
  const items: BspItem[] = [];
  const faces: FaceStyle[] = [];
  const edges: EdgeStyle[] = [];
  // Reuse the GPU's clipped triangles/ink. Local woven patches only resolve
  // coplanar ties here: a BSP orders separated pieces by their actual surface.
  for (const piece of plan.pieces) {
    if (mode === 'depth' && piece.patch) continue;
    if (piece.kind === 'face') {
      const [a, b, c] = piece.points as [Vec3, Vec3, Vec3];
      faces.push({
        face: piece.face,
        front: kernel.faces[piece.face]!.front_up,
        orientation: Math.sign(area(a, b, c)),
      });
      items.push({ kind: 0, ref: faces.length - 1, points: piece.points, order: piece.rank });
    } else {
      edges.push({ role: piece.role! });
      items.push({ kind: 1, ref: edges.length - 1, points: piece.points, order: piece.rank });
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
  cached[mode] = result;
  drawings.set(plan, cached);
  return result;
}

/** Cached unit-height geometry survives positive depth scales and camera changes. */
export function cameraSpreadScene(
  kernel: OristudioCpFoldedPaperScene,
  options: CameraSpreadOptions
): PaperScene {
  const { amount, directionDeg, inclinationDeg, projection } = options;
  if (
    ![amount, directionDeg, inclinationDeg, options.rollDeg ?? 0].every(Number.isFinite) ||
    amount < 0 ||
    amount > CAMERA_SPREAD_MAX_AMOUNT
  ) {
    throw new Error(`Camera spread needs finite controls and amount in [0, ${CAMERA_SPREAD_MAX_AMOUNT}]`);
  }
  // Exact original path, including its handling of woven coplanar stacks.
  if (amount === 0 && projection === 'diagram')
    return foldedFlatPaperScene(kernel, {
      markHidden: false,
      toScenePx: (p) => [p.x, p.y],
      scale: 1,
    });
  const mesh = cameraSpreadLift(kernel);
  // At zero depth all sheets are coplanar: use authored order, without the
  // inverse-height transform (which would put the BSP eye at infinity).
  const frame = cameraSpreadTransform(options);
  const mode = cameraSpreadVisibilityMode(options);
  const plan = cameraPaintPlans(mesh, kernel)[frame[8] < 0 ? 'back' : 'front'];
  const prepared = amount > 0 && mode !== 'layers' ? drawing(mesh, kernel, plan, mode) : null;
  const xs = mesh.xy.map((p) => p.x),
    ys = mesh.xy.map((p) => p.y);
  const [cx, cy] = prepared?.centre ?? [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
  // Inverse of the depth scaling maps the eye into the cached BSP's frame.
  const distance = projection === 'perspective' ? 2.5 : 1e8;
  const eye: Vec3 = [
    cx + distance * frame[6],
    cy + distance * frame[7],
    (distance * frame[8]) / (amount || 1),
  ];
  const project = ([x, y, height]: Vec3): ScenePoint => {
    const px = x - cx;
    const py = y - cy;
    const z = height * amount;
    const horizontal = frame[0] * px + frame[1] * py + frame[2] * z;
    const vertical = frame[3] * px + frame[4] * py + frame[5] * z;
    const depth = frame[6] * px + frame[7] * py + frame[8] * z;
    const factor = projection === 'perspective' ? distance / (distance - depth) : 1;
    return [
      mesh.origin.x + mesh.size * (cx + horizontal * factor),
      mesh.origin.y + mesh.size * (cy + vertical * factor),
    ];
  };
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
