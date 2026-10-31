import { cameraUniforms, projectVertices, viewDepthAxis, viewRotationFor } from '@treemaker/origami-simulator';
import { orderSide, visibility, type Point3 } from '@oristudio/layer-spread';
import type { ConnectedDrawing, PreparedConnectedSpread } from './connectedScene';
import type { SpreadPresentation } from './presentation';

/** The simulator camera, applied to the unsheared solved paper. Reciprocal
 * eye distance is affine in screen space, so GPU and vector depth agree. */
export function perspectiveDrawing(
  drawing: ConnectedDrawing,
  prepared: PreparedConnectedSpread,
  presentation: SpreadPresentation,
): ConnectedDrawing {
  const points = drawing.mesh.positions;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const center: [number, number, number] = [(minX + maxX) / 2, 0, -(minY + maxY) / 2];
  // XY and a fixed depth allowance define the frame, never the current amount.
  const radius = Math.max(1e-6, Math.hypot(maxX - minX, maxY - minY) * 0.6);
  const camera = cameraUniforms(presentation.camera, center, radius, 2 * radius, 2 * radius);
  const project = (positions: Point3[]): Point3[] => {
    const packed = Float32Array.from(positions.flatMap(([x, y, z]) => [x, z, -y]));
    const result = projectVertices(packed, camera);
    return positions.map((_, v) => [
      result.screen[2 * v]! - radius,
      result.screen[2 * v + 1]! - radius,
      1 / (camera.camDist - result.view[3 * v + 2]!),
    ]);
  };
  const positions = project(points);
  const side = orderSide(viewDepthAxis(viewRotationFor(presentation.camera))[1], presentation.orderSide);
  const back = (side === 'back') !== prepared.source.back;
  const front = drawing.front.map((up, face) => {
    const t = drawing.mesh.triangleFaces.indexOf(face);
    if (t < 0) return up;
    const ids = drawing.mesh.triangles[t]!;
    const signed = (p: Point3[]) => {
      const [a, b, c] = ids.map((v) => p[v]!);
      return (b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0]);
    };
    return signed(points) * signed(positions) >= 0 ? up : !up;
  });
  const ink = drawing.ink.map((edge) => {
    const [a, b] = project([edge.a, edge.b]);
    // Original crease segments are straight under perspective too.
    return {
      ...edge,
      a: a!,
      b: b!,
      line: {
        ...edge.line,
        a: [a![0], a![1]] as [number, number],
        b: [b![0], b![1]] as [number, number],
        whole: undefined,
      },
    };
  });
  return {
    ...drawing,
    front,
    ink,
    mesh: { ...drawing.mesh, positions, visibility: visibility(front.length, prepared.source.input.orders, back) },
  };
}
