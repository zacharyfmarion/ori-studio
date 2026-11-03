import { spatialVisibility, type Point3 } from '@oristudio/layer-spread';
import type {
  MeshRenderer,
  CameraUniforms,
  RenderSettings,
} from '@treemaker/origami-simulator';
import type { SpatialMeshOrder } from '../cp-workspace/folded/folded3dMaterial';

/** Two coverage bits, reused per plane. Survivor coverage is written even on
 * depth failure: another plane must never resurrect a locally buried layer.
 * All planes share the actual geometric depth buffer. */
export function renderSpatialMesh(
  gl: WebGL2RenderingContext,
  mesh: MeshRenderer,
  order: SpatialMeshOrder,
  camera: CameraUniforms,
  settings: RenderSettings,
  target: WebGLFramebuffer | null
): void {
  const eye = camera.center.map(
    (v, i) => v + camera.camDist * camera.rotation[6 + i]!
  ) as Point3;
  const visibility = spatialVisibility(order.ranges.length, order.planes, eye);
  if (visibility.above.reduce((n, fs) => n + fs.length, 0) > 250_000)
    throw new Error('Spatial visibility exceeds mask budget');
  mesh.render(
    camera,
    { ...settings, showFaces: false, showEdges: false },
    target
  );
  const clear = (bits: number) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, camera.width, camera.height);
    gl.stencilMask(bits);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  };
  const draw = (
    face: number,
    ink: boolean,
    configureDrawState: (gl: WebGL2RenderingContext) => void
  ) => {
    const range = order.ranges[face]!;
    mesh.render(
      camera,
      {
        ...settings,
        faceAlpha: 1,
        showFaces: !ink,
        showEdges: ink && settings.showEdges,
      },
      target,
      {
        clear: false,
        faceRange: { start: range.faceIndexStart, count: range.faceIndexCount },
        edgeRange: { start: range.edgeStart, count: range.edgeCount },
        configureDrawState,
      }
    );
  };
  const mark = (g: WebGL2RenderingContext) => {
    g.colorMask(false, false, false, false);
    g.depthMask(false);
    g.disable(g.DEPTH_TEST);
    g.enable(g.STENCIL_TEST);
    g.stencilMask(1);
    g.stencilFunc(g.ALWAYS, 1, 1);
    g.stencilOp(g.KEEP, g.KEEP, g.REPLACE);
  };
  const survivor =
    (paint: boolean, ink: boolean) => (g: WebGL2RenderingContext) => {
      g.colorMask(paint, paint, paint, paint);
      g.depthMask(paint && !ink);
      g.enable(g.DEPTH_TEST);
      g.enable(g.STENCIL_TEST);
      g.stencilMask(ink ? 0 : 2);
      g.stencilFunc(g.EQUAL, 2, 1);
      g.stencilOp(g.KEEP, g.REPLACE, g.REPLACE);
    };
  const fallback = (g: WebGL2RenderingContext) => {
    g.enable(g.STENCIL_TEST);
    g.stencilMask(0);
    g.stencilFunc(g.EQUAL, 0, 2);
    g.stencilOp(g.KEEP, g.KEEP, g.KEEP);
  };
  try {
    for (const ink of [false, true]) {
      if (ink && !settings.showEdges) continue;
      for (const plane of order.planes) {
        clear(3);
        for (const face of plane.faces) {
          clear(1);
          for (const blocker of visibility.above[face]!)
            draw(blocker, false, mark);
          // On the ink pass this only rebuilds the plane's survivor union.
          draw(face, false, survivor(!ink && settings.showFaces, false));
          if (ink) draw(face, true, survivor(true, true));
        }
        // Only all-masked pixels have bit 2 clear. For DAGs this draws nothing.
        for (const face of plane.faces) draw(face, ink, fallback);
      }
    }
  } finally {
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
  }
}
