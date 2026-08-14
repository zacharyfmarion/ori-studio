/**
 * The property the buried-flap bug violated: **a crease is never drawn more than
 * a fraction of a layer behind the paper covering it.**
 *
 * That is one sentence and it is the whole regression. Creases used to be
 * emitted at the fold line — the middle of every stack they run through — and
 * lifted to the front by a constant NDC bias that `STACK_SPAN_LIMIT` guaranteed
 * was at least twice the entire ply. So a flap lying flat against the inside of
 * a face had its outline traced on the outside of that face, and no test said
 * so, because every test asked about *geometry* and this is a fact about the
 * depth buffer.
 *
 * # Asserting it without a canvas
 *
 * The automated browser pane runs with zero animation frames, so a rendered
 * pixel cannot be looked at — and it does not have to be. `projectVertices` is
 * the maintained CPU mirror of the very vertex shader that computes `gl_Position`
 * (`camera.ts` says so, and the SVG exporter already depends on it being exact),
 * so rasterizing the face pass here into a depth buffer runs the same arithmetic
 * the GPU will. The edge pass is then the same comparison the GPU makes:
 * `ndcZ − bias <= buffered`, under `LEQUAL`.
 *
 * # Why the bound is in *layers* and not in units
 *
 * A depth in world units means nothing on its own — it is a different number for
 * every model. The quantity that matters is how many of `mesh.eps` it is,
 * because that is the distance between one sheet of paper and the next. Under
 * one layer, a crease can only be fighting the face it lies on; over one layer,
 * it is in front of paper the kernel put in front of it. The shipped
 * configuration is 0.25 and the configuration this replaces was 12.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CREASE_DEPTH_BIAS,
  cameraUniforms,
  projectVertices,
  type CameraUniforms,
  type ProjectedVertices,
} from '@treemaker/origami-simulator';
import { folded3dMesh, type Folded3dMesh } from './folded3dMesh';
import { folded3dCreaseDepthBias, folded3dFrameFillZoom } from './folded3dWindow';
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
 * The antipodal camera is not decoration: which end of `cell_stack` faces the
 * eye flips with it, and a mesh that displaced its layers off the wrong end
 * would be correct at exactly one of these.
 */
const CAMERAS = [
  ['default', Math.PI / 4, -0.955],
  ['antipodal', Math.PI / 4 + Math.PI, Math.PI + 0.955],
  ['oblique', 2.1, -1.9],
] as const;

const FRAME = 512;

/**
 * How far behind the covering paper a drawn crease may sit, in layer gaps.
 *
 * Below 1 by definition of the property; the shipped bias makes it 0.25, and the
 * headroom is deliberate rather than tight — a bound of exactly 1 would be
 * satisfied by a crease sitting on the next sheet down.
 */
const MAX_DEPTH_BEHIND_IN_LAYERS = 0.5;

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
function rasterizeFaces(
  mesh: Folded3dMesh,
  projected: ProjectedVertices,
  camera: CameraUniforms
): Float32Array {
  const buffer = new Float32Array(FRAME * FRAME).fill(Infinity);
  const indices = mesh.topology.faceIndices;
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    const ia = indices[triangle]!;
    const ib = indices[triangle + 1]!;
    const ic = indices[triangle + 2]!;
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
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(FRAME - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(FRAME - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const sx = px + 0.5;
        const sy = py + 0.5;
        const w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
        const w1 = ((sx - ax) * (cy - ay) - (sy - ay) * (cx - ax)) / area;
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
        const z = az + w1 * (bz - az) + w0 * (cz - az);
        const at = py * FRAME + px;
        if (z <= buffer[at]!) buffer[at] = z;
      }
    }
  }
  return buffer;
}

interface CreaseInk {
  /** Samples of a crease centreline that land on paper and pass the depth test. */
  drawn: number;
  /** The deepest any of them sits behind that paper, in layer gaps. */
  worstBehindInLayers: number;
}

/** The edge pass, against that buffer, at a given bias. */
function measureCreases(
  mesh: Folded3dMesh,
  projected: ProjectedVertices,
  camera: CameraUniforms,
  buffer: Float32Array,
  bias: number
): CreaseInk {
  const SAMPLES = 200;
  let drawn = 0;
  let worst = 0;
  for (let crease = 0; crease < mesh.topology.edgeAssignments.length; crease += 1) {
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
      if (z - bias > buffered) continue;
      drawn += 1;
      const behind = ((z - buffered) * camera.depthRange) / mesh.eps;
      if (behind > worst) worst = behind;
    }
  }
  return { drawn, worstBehindInLayers: worst };
}

describe('a crease is drawn at the depth of its own layer', () => {
  it.each(NAMES)('%s biases by well under one layer gap', (name) => {
    const mesh = meshOf(fixture(name));
    // The coupling that broke, stated directly and without a rasterizer. The two
    // numbers lived in different packages with nothing relating them, and the
    // bias ended up more than a dozen times the gap.
    const camera = cameraFor(mesh, CAMERAS[0][1], CAMERAS[0][2]);
    const inLayers = (folded3dCreaseDepthBias(mesh) * camera.depthRange) / mesh.eps;
    expect(inLayers).toBeLessThan(MAX_DEPTH_BEHIND_IN_LAYERS);
    expect(inLayers).toBeGreaterThan(0);
  });

  describe.each(NAMES)('%s', (name) => {
    it.each(CAMERAS)('is never behind its paper, from %s', (_label, yaw, pitch) => {
      const mesh = meshOf(fixture(name));
      const camera = cameraFor(mesh, yaw, pitch);
      const projected = projectVertices(mesh.positions, camera, { perspective: true });
      const buffer = rasterizeFaces(mesh, projected, camera);
      const ink = measureCreases(
        mesh,
        projected,
        camera,
        buffer,
        folded3dCreaseDepthBias(mesh)
      );

      // The property.
      expect(ink.worstBehindInLayers).toBeLessThan(MAX_DEPTH_BEHIND_IN_LAYERS);
      // And the figure still has linework — a mesh that drew no creases at all
      // would satisfy the bound above perfectly.
      expect(ink.drawn).toBeGreaterThan(0);
    });
  });

  it('would fail on the constant it replaced, which is what gives it teeth', () => {
    // `spikes_small`: 25 faces, three planes, stacks four deep. Under the old
    // constant a crease is drawn up to eight sheets of paper behind the surface
    // covering it, which is the bug — so a test that could not see the
    // difference between the two configurations would not be testing anything.
    const mesh = meshOf(fixture('spikes_small'));
    const camera = cameraFor(mesh, CAMERAS[0][1], CAMERAS[0][2]);
    const projected = projectVertices(mesh.positions, camera, { perspective: true });
    const buffer = rasterizeFaces(mesh, projected, camera);

    const shipped = measureCreases(
      mesh,
      projected,
      camera,
      buffer,
      folded3dCreaseDepthBias(mesh)
    );
    const old = measureCreases(mesh, projected, camera, buffer, DEFAULT_CREASE_DEPTH_BIAS);

    expect(shipped.worstBehindInLayers).toBeLessThan(MAX_DEPTH_BEHIND_IN_LAYERS);
    expect(old.worstBehindInLayers).toBeGreaterThan(4);
    // And it is ink, not a rounding difference: the old bias draws strictly more
    // of the model's creases than the geometry supports.
    expect(old.drawn).toBeGreaterThan(shipped.drawn);
  });
});
