/** Connected lift → camera drawing with local layer protection and geometric depth. */
import { type Vec3, type Mat3 } from '@treemaker/origami-simulator';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PaperItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { foldedFlatPaperScene } from './foldedFlatScene';
import { cameraSpreadLift } from './cameraSpreadLift';
import { cameraPaintPlans, cameraPaintGroupsForView, type CameraPaintPiece } from './cameraSpreadVisibility';
import { maskCameraDepth, maskCameraPaintGroup } from './cameraSpreadMask';
import { cameraLayerRelations } from './cameraSpreadRelations';
import { cameraSpreadTransform, type CameraSpreadPose } from './cameraSpreadCamera';

import { cameraSpreadProjection } from './cameraSpreadProjection';

/** Presentation control range; not a physical paper-strain guarantee. */
export const CAMERA_SPREAD_MAX_AMOUNT = 0.5;

export interface CameraSpreadOptions extends CameraSpreadPose {
  /** Production views use the shared camera's full basis. */
  frame?: Mat3;
  /** Total depth bound as a fraction of original folded extent. */
  amount: number;
  projection: 'diagram' | 'orthographic' | 'perspective';
  /** Strict layers with local facing reversal, or diagnostic geometric depth. */
  visibility?: 'layers' | 'depth';
}

/** Protect buried layers in every camera mode unless raw depth is requested. */
export function cameraSpreadVisibilityMode(
  options: Pick<CameraSpreadOptions, 'projection' | 'visibility'>
): 'layers' | 'depth' {
  return options.visibility ?? 'layers';
}
/** Cached unit-height geometry survives positive depth scales and camera changes. */
export function cameraSpreadScene(kernel: OristudioCpFoldedPaperScene, options: CameraSpreadOptions): PaperScene {
  const { amount, directionDeg, inclinationDeg, projection } = options;
  if (
    ![amount, directionDeg, inclinationDeg, options.rollDeg ?? 0].every(Number.isFinite) ||
    amount < 0 ||
    amount > CAMERA_SPREAD_MAX_AMOUNT
  ) {
    throw new Error(`Camera spread needs finite controls and amount in [0, ${CAMERA_SPREAD_MAX_AMOUNT}]`);
  }
  // At zero there is no separation to reveal buried faces. Use the normal flat
  // capture policy; keeping hidden faces paintable leaks unconstrained buried ink.
  if (amount === 0 && projection === 'diagram')
    return foldedFlatPaperScene(kernel, {
      markHidden: true,
      toScenePx: (p) => [p.x, p.y],
      scale: 1,
    });
  const mesh = cameraSpreadLift(kernel);
  // At zero depth all sheets are coplanar: use authored order, without the
  // inverse-height transform (which would put the BSP eye at infinity).
  const { frame, homogeneous, clipDepth, project, centre } = cameraSpreadProjection(mesh, options);
  const mode = cameraSpreadVisibilityMode(options);
  const plans = cameraPaintPlans(mesh, kernel);
  const groups = cameraPaintGroupsForView(plans, options, frame, centre);
  const clippingFrame = options.frame ?? cameraSpreadTransform({ ...options, rollDeg: 0 });
  const clipProjection = (p: Vec3) => homogeneous(p, clippingFrame);
  const protectedPieces =
    mode === 'layers'
      ? groups.flatMap((group, side) =>
          maskCameraPaintGroup(group, clipProjection, cameraLayerRelations(kernel), !!side)
        )
      : groups.flat();
  const ordered: CameraPaintPiece[] =
    amount > 0 ? maskCameraDepth(protectedPieces, clipProjection, clipDepth) : protectedPieces;
  const items: PaperItem[] = [];
  for (const piece of ordered) {
    const points = piece.points.map(project);
    if (piece.kind === 'face') {
      const style = {
        face: piece.face,
        front: kernel.faces[piece.face]!.front_up,
        orientation: Math.sign(polygonArea(piece.points.map((p) => [p[0], p[1]]))),
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
        role: piece.role!,
        a: points[0]!,
        b: points[1]!,
        onBoundary: [false, false],
        face: piece.face,
        ...(piece.whole
          ? {
              whole: {
                a: project(piece.whole.points[0]),
                b: project(piece.whole.points[1]),
                onBoundary: piece.whole.onBoundary,
              },
            }
          : {}),
        hidden: false,
      });
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items)
    for (const [x, y] of item.kind === 'face' ? item.rings.flat() : item.kind === 'line' ? [item.a, item.b] : []) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return { items, sheet: kernel.sheet, bounds: { minX, minY, maxX, maxY } };
}

function polygonArea(points: ScenePoint[]): number {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
}
