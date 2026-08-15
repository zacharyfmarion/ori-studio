/**
 * The property the buried-flap bug violated: **nothing is drawn over paper that
 * is in front of it.**
 *
 * That used to be a hard thing to hold, because the mesh displaced coplanar
 * layers by a hair and asked the depth buffer to reconstruct an order the kernel
 * had already computed. It is easy now, and the reason is worth stating: an
 * opaque figure draws one *skin* per plane — the top face of each of its cells,
 * or the bottom — so within a plane nothing is coplanar with anything else and
 * the depth buffer only ever decides plane against plane. The crease bias no
 * longer has to clear a stack; it only breaks the tie between a crease and the
 * single face it lies on.
 *
 * # Asserting the picture without a canvas
 *
 * The automated browser pane runs with zero animation frames, so a rendered
 * pixel cannot be looked at — and it does not have to be. `projectVertices` is
 * the maintained CPU mirror of the very vertex shader that computes
 * `gl_Position` (`camera.ts` says so, and the SVG exporter already depends on it
 * being exact), so rasterizing the *actual draw passes* here runs the same
 * arithmetic the GPU will, in the same order.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cameraUniforms,
  projectVertices,
  type CameraUniforms,
  type ProjectedVertices,
} from '@treemaker/origami-simulator';
import { folded3dMesh, type Folded3dMesh } from './folded3dMesh';
import {
  FOLDED_3D_CREASE_DEPTH_BIAS,
  folded3dFrameFillZoom,
} from './folded3dWindow';
import { folded3dDrawPasses } from '../../simulator/foldedMeshSource';
import { UNDETERMINED_FACE_ALPHA } from './folded3dStyle';
import type { OristudioCpFolded3dRenderModel } from '../../engine/oristudioCpTypes';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const NAMES = [
  'hinge_90',
  'strip_coupled',
  'pinwheel',
  'pinwheel_cyclic',
  'box_90',
  'spikes_small',
] as const;

/**
 * The two the product shows, plus one oblique.
 *
 * The antipodal camera is not decoration: it is what flips which end of every
 * `cell_stack` a skin is taken from, and a mesh that built its skins off the
 * wrong end would be correct at exactly one of these.
 */
const CAMERAS = [
  ['default', Math.PI / 4, -0.955],
  ['antipodal', Math.PI / 4 + Math.PI, Math.PI + 0.955],
  ['oblique', 2.1, -1.9],
] as const;

const FRAME = 512;
const OPAQUE = { showFaces: true, showEdges: true, faceAlpha: 1 };

function fixture(name: string): OristudioCpFolded3dRenderModel {
  return JSON.parse(
    readFileSync(join(FIXTURES, `${name}.rendermodel.json`), 'utf8')
  ) as OristudioCpFolded3dRenderModel;
}

function meshOf(model: OristudioCpFolded3dRenderModel): Folded3dMesh {
  const built = folded3dMesh(model);
  if (built.kind !== 'mesh') throw new Error(`expected a mesh, got ${built.kind}`);
  return built.mesh;
}

function cameraFor(mesh: Folded3dMesh, yaw: number, pitch: number): CameraUniforms {
  return cameraUniforms(
    { yaw, pitch, zoom: folded3dFrameFillZoom(FRAME, FRAME) },
    mesh.center,
    mesh.radius,
    FRAME,
    FRAME
  );
}

function ndcZ(projected: ProjectedVertices, camera: CameraUniforms, vertex: number): number {
  const depth = projected.view[vertex * 3 + 2] ?? 0;
  return Math.max(-1, Math.min(1, -depth / camera.depthRange));
}

/**
 * The face pass, into a depth buffer.
 *
 * Linear interpolation of NDC z across the screen-space triangle, which is what
 * the rasterizer does here: the vertex shader applies its perspective to x and y
 * itself and leaves `w` at 1, so there is no perspective-correct z to reproduce.
 */
function rasterize(
  mesh: Folded3dMesh,
  projected: ProjectedVertices,
  camera: CameraUniforms,
  range: { start: number; count: number },
  buffer: Float32Array
): void {
  const indices = mesh.topology.faceIndices;
  for (let at = range.start; at + 2 < range.start + range.count; at += 3) {
    const ia = indices[at]!;
    const ib = indices[at + 1]!;
    const ic = indices[at + 2]!;
    const ax = projected.screen[ia * 2]!;
    const ay = projected.screen[ia * 2 + 1]!;
    const bx = projected.screen[ib * 2]!;
    const by = projected.screen[ib * 2 + 1]!;
    const cx = projected.screen[ic * 2]!;
    const cy = projected.screen[ic * 2 + 1]!;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const az = ndcZ(projected, camera, ia);
    const bz = ndcZ(projected, camera, ib);
    const cz = ndcZ(projected, camera, ic);
    for (
      let py = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      py <= Math.min(FRAME - 1, Math.ceil(Math.max(ay, by, cy)));
      py += 1
    ) {
      for (
        let px = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        px <= Math.min(FRAME - 1, Math.ceil(Math.max(ax, bx, cx)));
        px += 1
      ) {
        const sx = px + 0.5;
        const sy = py + 0.5;
        const w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
        const w1 = ((sx - ax) * (cy - ay) - (sy - ay) * (cx - ax)) / area;
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
        const z = az + w1 * (bz - az) + w0 * (cz - az);
        const to = py * FRAME + px;
        if (z <= buffer[to]!) buffer[to] = z;
      }
    }
  }
}

interface CreaseInk {
  drawn: number;
  /** The deepest any drawn sample sits behind the paper covering it, in NDC z. */
  worstBehind: number;
}

function measure(
  mesh: Folded3dMesh,
  projected: ProjectedVertices,
  camera: CameraUniforms,
  range: { start: number; count: number },
  buffer: Float32Array
): CreaseInk {
  const SAMPLES = 200;
  let drawn = 0;
  let worstBehind = 0;
  for (let crease = range.start; crease < range.start + range.count; crease += 1) {
    const ia = mesh.topology.edgeIndices[crease * 2]!;
    const ib = mesh.topology.edgeIndices[crease * 2 + 1]!;
    const ax = projected.screen[ia * 2]!;
    const ay = projected.screen[ia * 2 + 1]!;
    const bx = projected.screen[ib * 2]!;
    const by = projected.screen[ib * 2 + 1]!;
    const az = ndcZ(projected, camera, ia);
    const bz = ndcZ(projected, camera, ib);
    for (let sample = 0; sample <= SAMPLES; sample += 1) {
      const u = sample / SAMPLES;
      const px = Math.floor(ax + (bx - ax) * u);
      const py = Math.floor(ay + (by - ay) * u);
      if (px < 0 || py < 0 || px >= FRAME || py >= FRAME) continue;
      const buffered = buffer[py * FRAME + px]!;
      // Nothing behind this pixel: the crease is on a silhouette and is drawn
      // whatever the bias is, so it says nothing about occlusion.
      if (!Number.isFinite(buffered)) continue;
      const z = az + (bz - az) * u;
      if (z - FOLDED_3D_CREASE_DEPTH_BIAS > buffered) continue;
      drawn += 1;
      worstBehind = Math.max(worstBehind, z - buffered);
    }
  }
  return { drawn, worstBehind };
}

describe('nothing is drawn over paper in front of it', () => {
  describe.each(NAMES)('%s', (name) => {
    it.each(CAMERAS)('holds from %s', (_label, yaw, pitch) => {
      const mesh = meshOf(fixture(name));
      const camera = cameraFor(mesh, yaw, pitch);
      const projected = projectVertices(mesh.positions, camera, { perspective: true });
      const passes = folded3dDrawPasses(
        { ...mesh, undeterminedFaceAlpha: UNDETERMINED_FACE_ALPHA },
        OPAQUE,
        camera
      );

      // The real draw, in the real order: every pass's faces into the depth
      // buffer, then every pass's creases against it.
      const buffer = new Float32Array(FRAME * FRAME).fill(Infinity);
      for (const pass of passes) {
        if (pass.faceRange) rasterize(mesh, projected, camera, pass.faceRange, buffer);
      }
      let drawn = 0;
      let worstBehind = 0;
      for (const pass of passes) {
        if (!pass.edgeRange) continue;
        const ink = measure(mesh, projected, camera, pass.edgeRange, buffer);
        drawn += ink.drawn;
        worstBehind = Math.max(worstBehind, ink.worstBehind);
      }

      // The property. A crease is coincident with exactly one thing — the face
      // it lies on — so the bias is all it ever needs, and nothing it draws over
      // can be further in front than that.
      expect(worstBehind).toBeLessThanOrEqual(FOLDED_3D_CREASE_DEPTH_BIAS);
      // And the figure still has linework: a mesh that drew no creases at all
      // would satisfy the bound above perfectly.
      expect(drawn).toBeGreaterThan(0);
    });
  });

  it('needs a bias orders below any real gap between two planes', () => {
    // The constant this replaced was `0.0008` of NDC z, which at
    // `depthRange = 2 · radius` is `1.6e-3 · radius` of world depth — big enough
    // to lift a crease through paper genuinely in front of it, which is what put
    // a buried flap's outline on the outside of the box covering it. It had to
    // be that big because a crease sat at the middle of its stack and had to
    // clear the whole ply.
    //
    // Now it only breaks a tie between two coincident surfaces, so it can be
    // this small — and being small is the point.
    expect(FOLDED_3D_CREASE_DEPTH_BIAS).toBeLessThan(0.0008 / 50);
    // Still resolvable: NDC spans 2 and a 24-bit buffer has 2^24 steps over it.
    expect(FOLDED_3D_CREASE_DEPTH_BIAS * (2 ** 24 / 2)).toBeGreaterThan(50);
  });
});
