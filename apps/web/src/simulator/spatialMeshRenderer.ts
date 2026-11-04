import { spatialPlaneSide, type Point3 } from '@oristudio/layer-spread';
import type {
  MeshRenderer,
  CameraUniforms,
  RenderSettings,
} from '@treemaker/origami-simulator';
import type { SpatialMeshOrder } from '../cp-workspace/folded/folded3dMaterial';
import type { SpatialDrawPlane } from './spatialDrawPlan';

/** Two coverage bits, reused per plane. Survivor coverage is written even on
 * depth failure: another plane must never resurrect a locally buried layer.
 * All planes share the actual geometric depth buffer. */
export function renderSpatialMesh(
  gl: WebGL2RenderingContext,
  mesh: MeshRenderer,
  order: SpatialMeshOrder,
  plan: readonly SpatialDrawPlane[],
  camera: CameraUniforms,
  settings: RenderSettings,
  target: WebGLFramebuffer | null
): void {
  const eye = camera.center.map(
    (v, i) => v + camera.camDist * camera.rotation[6 + i]!
  ) as Point3;
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
  const fillSettings = {
    ...settings,
    faceAlpha: 1,
    showFaces: true,
    showEdges: false,
  };
  const inkSettings = {
    ...settings,
    faceAlpha: 1,
    showFaces: false,
    showEdges: settings.showEdges,
  };
  const draw = (
    face: number,
    ink: boolean,
    configureDrawState: (gl: WebGL2RenderingContext) => void
  ) => {
    const range = order.ranges[face]!;
    mesh.render(camera, ink ? inkSettings : fillSettings, target, {
      clear: false,
      faceRange: { start: range.faceIndexStart, count: range.faceIndexCount },
      edgeRange: { start: range.edgeStart, count: range.edgeCount },
      configureDrawState,
    });
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
    (paint: boolean, ink: boolean, masked = true) =>
    (g: WebGL2RenderingContext) => {
      g.colorMask(paint, paint, paint, paint);
      g.depthMask(paint && !ink);
      g.enable(g.DEPTH_TEST);
      if (!masked) {
        g.disable(g.STENCIL_TEST);
        return;
      }
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
    mesh.withDrawBatch(() => {
      for (const ink of [false, true]) {
        if (ink && !settings.showEdges) continue;
        for (const { plane, cyclic, front, back } of plan) {
          const groups =
            spatialPlaneSide(plane, eye) === 'front' ? front : back;
          // Acyclic paper needs no fallback. Ink still does: crease ribbons
          // extend beyond triangle coverage, where the original fallback also
          // contributes (including faded strokes). Keep that coverage exactly.
          const needsCoverage = cyclic || ink;
          if (needsCoverage) clear(3);
          for (const { faces, blockers, maskRanges } of groups) {
            if (needsCoverage || blockers.length) clear(1);
            for (const faceRange of maskRanges)
              mesh.render(camera, fillSettings, target, {
                clear: false,
                faceRange,
                configureDrawState: mark,
              });
            for (const face of faces) {
              draw(
                face,
                false,
                survivor(
                  !ink && settings.showFaces,
                  false,
                  needsCoverage || blockers.length > 0
                )
              );
              if (ink) draw(face, true, survivor(true, true));
            }
          }
          // Only all-masked pixels have bit 2 clear.
          if (needsCoverage)
            for (const face of plane.faces) draw(face, ink, fallback);
        }
      }
    });
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
