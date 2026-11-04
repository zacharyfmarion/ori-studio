import { spatialPlaneSide, type Point3 } from '@oristudio/layer-spread';
import type {
  MeshRenderer,
  CameraUniforms,
  RenderSettings,
} from '@treemaker/origami-simulator';
import type { SpatialMeshOrder } from '../cp-workspace/folded/folded3dMaterial';
import type { SpatialDrawPlane } from './spatialDrawPlan';
import type { SpatialInkGroup } from './spatialInkPlan';

/** Two coverage bits reused per plane, plus one shared-crease blocker bit.
 * Survivor coverage is written even on
 * depth failure: another plane must never resurrect a locally buried layer.
 * All planes share the actual geometric depth buffer. */
export function renderSpatialMesh(
  gl: WebGL2RenderingContext,
  mesh: MeshRenderer,
  order: SpatialMeshOrder,
  plan: readonly SpatialDrawPlane[],
  inkPlan: readonly SpatialInkGroup[],
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
    configureDrawState: (gl: WebGL2RenderingContext) => void
  ) => {
    const range = order.ranges[face]!;
    mesh.render(camera, fillSettings, target, {
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
    (paint: boolean, masked = true) =>
    (g: WebGL2RenderingContext) => {
      g.colorMask(paint, paint, paint, paint);
      g.depthMask(paint);
      g.enable(g.DEPTH_TEST);
      if (!masked) {
        g.disable(g.STENCIL_TEST);
        return;
      }
      g.enable(g.STENCIL_TEST);
      g.stencilMask(2);
      g.stencilFunc(g.EQUAL, 2, 1);
      g.stencilOp(g.KEEP, g.REPLACE, g.REPLACE);
    };
  const fallback = (g: WebGL2RenderingContext) => {
    g.enable(g.STENCIL_TEST);
    g.stencilMask(0);
    g.stencilFunc(g.EQUAL, 0, 2);
    g.stencilOp(g.KEEP, g.KEEP, g.KEEP);
  };
  const sides = new Map(plan.map((p) => [p, spatialPlaneSide(p.plane, eye)]));
  let coveragePlane: SpatialDrawPlane | null = null;
  const coverage = (plane: SpatialDrawPlane) => {
    if (coveragePlane === plane) return;
    clear(3);
    for (const { faces, maskRanges } of plane[sides.get(plane)!]) {
      clear(1);
      for (const faceRange of maskRanges)
        mesh.render(camera, fillSettings, target, {
          clear: false,
          faceRange,
          configureDrawState: mark,
        });
      for (const face of faces) draw(face, survivor(false));
    }
    coveragePlane = plane;
  };
  try {
    mesh.withDrawBatch(() => {
      for (const entry of plan) {
        const { plane, cyclic } = entry;
        const groups = entry[sides.get(entry)!];
        if (cyclic) clear(3);
        for (const { faces, blockers, maskRanges } of groups) {
          if (cyclic || blockers.length) clear(1);
          for (const faceRange of maskRanges)
            mesh.render(camera, fillSettings, target, {
              clear: false,
              faceRange,
              configureDrawState: mark,
            });
          for (const face of faces) {
            draw(
              face,
              survivor(settings.showFaces, cyclic || blockers.length > 0)
            );
          }
        }
        // Only all-masked pixels have bit 2 clear.
        if (cyclic) for (const face of plane.faces) draw(face, fallback);
      }
      if (!settings.showEdges) return;
      for (const group of inkPlan) {
        clear(4);
        for (const owner of group.owners) {
          const ranges = owner[sides.get(owner.plane)!];
          if (!ranges.length) continue;
          if (owner.plane.cyclic) coverage(owner.plane);
          for (const faceRange of ranges)
            mesh.render(camera, fillSettings, target, {
              clear: false,
              faceRange,
              configureDrawState: (g) => {
                g.colorMask(false, false, false, false);
                g.depthMask(false);
                g.disable(g.DEPTH_TEST);
                g.enable(g.STENCIL_TEST);
                g.stencilMask(4);
                // A cycle masks ink only where this plane has a survivor.
                // Empty survivor coverage retains its physical fallback.
                g.stencilFunc(owner.plane.cyclic ? g.EQUAL : g.ALWAYS, 6, 2);
                g.stencilOp(g.KEEP, g.KEEP, g.REPLACE);
              },
            });
        }
        mesh.render(camera, inkSettings, target, {
          clear: false,
          edgeRange: group.edges,
          configureDrawState: (g) => {
            g.colorMask(true, true, true, true);
            g.depthMask(false);
            g.enable(g.DEPTH_TEST);
            g.enable(g.STENCIL_TEST);
            g.stencilMask(0);
            g.stencilFunc(g.EQUAL, 0, 4);
            g.stencilOp(g.KEEP, g.KEEP, g.KEEP);
          },
        });
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
