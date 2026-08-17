/**
 * Differential oracle: rasterize the 2D projector and the GPU mesh path at the
 * same camera and diff them. The projector is the reference — it is the picture
 * that is known to be right.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cameraUniforms, projectVertices } from '@treemaker/origami-simulator';
import { folded3dMesh, type Folded3dMesh } from './folded3dMesh';
import { folded3dFrameFillZoom, FOLDED_3D_CREASE_DEPTH_BIAS } from './folded3dWindow';
import { folded3dDrawPasses } from '../../simulator/foldedMeshSource';
import { projectFolded3dModel, type FoldedFigureCamera } from './foldedFigure3dProjection';
import type { Folded3dPaperStyle } from './folded3dStyle';
import type {
  OristudioCpFold3dTolerances,
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedRenderPrimitive,
} from '../../engine/oristudioCpTypes';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const N = 400;
const PAD = 20;
const BACKGROUND = -1;
const PAPER = -2;

const TOLERANCES: OristudioCpFold3dTolerances = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};
const STYLE: Folded3dPaperStyle = {
  front: [1, 1, 0.2],
  back: [1, 1, 1],
  line: [0, 0, 0],
  faceAlpha: 1,
  transparentAlpha: 16 / 255,
  lineWidth: 1.2,
  antiAlias: true,
  lighting: true,
  lightDir: [0, 0, 1],
};

interface Picture {
  id: Int32Array;
  /** Which skin's paper won each pixel, `-1` for none. */
  skinOf: Int32Array;
  /** Which skin each crease id belongs to, `-1` for none. */
  skinOfEdge: Map<number, number>;
  /** For crease ids, what produced them, for reporting. */
  label: Map<number, string>;
}

function blank(): Picture {
  return {
    id: new Int32Array(N * N).fill(BACKGROUND),
    skinOf: new Int32Array(N * N).fill(-1),
    skinOfEdge: new Map(),
    label: new Map(),
  };
}

function fitTransform(points: Array<[number, number]>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (N - 2 * PAD) / span;
  return (x: number, y: number): [number, number] => [
    PAD + (x - minX) * scale,
    PAD + (y - minY) * scale,
  ];
}

function fillTriangle(
  pic: Picture,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
  id: number,
  depth: Float32Array | null,
  az = 0, bz = 0, cz = 0,
  skinIndex = -1
) {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-12) return;
  for (let py = Math.max(0, Math.floor(Math.min(ay, by, cy))); py <= Math.min(N - 1, Math.ceil(Math.max(ay, by, cy))); py += 1) {
    for (let px = Math.max(0, Math.floor(Math.min(ax, bx, cx))); px <= Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx))); px += 1) {
      const sx = px + 0.5, sy = py + 0.5;
      const w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
      const w1 = ((sx - ax) * (cy - ay) - (sy - ay) * (cx - ax)) / area;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      const at = py * N + px;
      if (depth) {
        const z = az + w1 * (bz - az) + w0 * (cz - az);
        if (z > depth[at]!) continue;
        depth[at] = z;
      }
      pic.id[at] = id;
      pic.skinOf[at] = skinIndex;
    }
  }
}

/** Stamp a segment as a ribbon of the given half-width. */
function stampSegment(
  pic: Picture,
  ax: number, ay: number, bx: number, by: number,
  id: number,
  half: number,
  depth: Float32Array | null,
  az = 0, bz = 0, bias = 0
) {
  const dx = bx - ax, dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return;
  const steps = Math.max(1, Math.ceil(length * 2));
  for (let s = 0; s <= steps; s += 1) {
    const u = s / steps;
    const x = ax + dx * u, y = ay + dy * u;
    const z = az + (bz - az) * u;
    for (let oy = -Math.ceil(half); oy <= Math.ceil(half); oy += 1) {
      for (let ox = -Math.ceil(half); ox <= Math.ceil(half); ox += 1) {
        if (ox * ox + oy * oy > half * half + 0.5) continue;
        const px = Math.floor(x + ox), py = Math.floor(y + oy);
        if (px < 0 || py < 0 || px >= N || py >= N) continue;
        const at = py * N + px;
        if (depth) {
          // Creases test but do not write depth, exactly like the real pass.
          if (z - bias > depth[at]!) continue;
        }
        pic.id[at] = id;
      }
    }
  }
}

function primitivePoints(primitive: OristudioCpFoldedRenderPrimitive): Array<[number, number]> {
  const g = primitive.geometry;
  if (g.kind === 'polygon') return g.points.map((p) => [p.x, p.y] as [number, number]);
  if (g.kind === 'segment') return [[g.from.x, g.from.y], [g.to.x, g.to.y]];
  if (g.kind === 'path') {
    const out: Array<[number, number]> = [];
    for (const c of g.commands) {
      if (c.command === 'move_to' || c.command === 'line_to') out.push([c.point.x, c.point.y]);
    }
    return out;
  }
  return [];
}

/** The reference picture: the projector's primitive stream, painted in order. */
function projectorPicture(
  model: OristudioCpFolded3dRenderModel,
  camera: FoldedFigureCamera,
  half: number
): Picture {
  const projection = projectFolded3dModel(model, {
    camera,
    displayStyle: 'Paper5',
    style: STYLE,
    tolerances: TOLERANCES,
  });
  const all: Array<[number, number]> = [];
  for (const primitive of projection.snapshot.primitives) all.push(...primitivePoints(primitive));
  const to = fitTransform(all);
  const pic = blank();
  projection.snapshot.primitives.forEach((primitive, index) => {
    const pts = primitivePoints(primitive).map(([x, y]) => to(x, y));
    if (pts.length === 0) return;
    if (primitive.kind.startsWith('fill')) {
      for (let i = 1; i + 1 < pts.length; i += 1) {
        fillTriangle(pic, pts[0]![0], pts[0]![1], pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], PAPER, null);
      }
      return;
    }
    for (let i = 0; i + 1 < pts.length; i += 1) {
      stampSegment(pic, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], index, half, null);
    }
    pic.label.set(
      index,
      `cell=${projection.cells[index]} face=${projection.faces[index]}`
    );
  });
  return pic;
}

/** The picture the window draws: the mesh path, with a depth buffer. */
function meshPicture(mesh: Folded3dMesh, camera: FoldedFigureCamera, half: number): Picture {
  const uniforms = cameraUniforms(
    { yaw: camera.yaw, pitch: camera.pitch, zoom: folded3dFrameFillZoom(N, N) },
    mesh.center,
    mesh.radius,
    N,
    N
  );
  const ortho = { ...uniforms, camDist: uniforms.depthRange * 5000 };
  const p = projectVertices(mesh.positions, ortho, { perspective: false });
  const ndcZ = (v: number) =>
    Math.max(-1, Math.min(1, -(p.view[v * 3 + 2] ?? 0) / ortho.depthRange));
  const all: Array<[number, number]> = [];
  for (let v = 0; v * 2 + 1 < p.screen.length; v += 1) all.push([p.screen[v * 2]!, p.screen[v * 2 + 1]!]);
  const to = fitTransform(all);

  const passes = folded3dDrawPasses(
    { ...mesh, undeterminedFaceAlpha: 0.45 },
    { showFaces: true, showEdges: true, faceAlpha: 1 },
    ortho
  );
  const pic = blank();
  const depth = new Float32Array(N * N).fill(Infinity);
  // Which skin owns each face triangle and each edge, for the report.
  const owner = new Map<number, number>();
  const faceOwner = new Map<number, number>();
  mesh.skins.forEach((skin, skinIndex) => {
    for (let e = skin.edgeStart; e < skin.edgeStart + skin.edgeCount; e += 1) {
      owner.set(e, skinIndex);
    }
    for (let t = skin.faceIndexStart; t < skin.faceIndexStart + skin.faceIndexCount; t += 1) {
      faceOwner.set(t, skinIndex);
    }
  });
  for (const pass of passes) {
    if (pass.faceRange) {
      const idx = mesh.topology.faceIndices;
      const end = pass.faceRange.start + pass.faceRange.count;
      for (let t = pass.faceRange.start; t + 2 < end; t += 3) {
        const ia = idx[t]!, ib = idx[t + 1]!, ic = idx[t + 2]!;
        const [ax, ay] = to(p.screen[ia * 2]!, p.screen[ia * 2 + 1]!);
        const [bx, by] = to(p.screen[ib * 2]!, p.screen[ib * 2 + 1]!);
        const [cx, cy] = to(p.screen[ic * 2]!, p.screen[ic * 2 + 1]!);
        fillTriangle(pic, ax, ay, bx, by, cx, cy, PAPER, depth, ndcZ(ia), ndcZ(ib), ndcZ(ic), faceOwner.get(t) ?? -1);
      }
    }
    if (pass.edgeRange) {
      const end = pass.edgeRange.start + pass.edgeRange.count;
      for (let e = pass.edgeRange.start; e < end; e += 1) {
        const ia = mesh.topology.edgeIndices[e * 2]!;
        const ib = mesh.topology.edgeIndices[e * 2 + 1]!;
        const [ax, ay] = to(p.screen[ia * 2]!, p.screen[ia * 2 + 1]!);
        const [bx, by] = to(p.screen[ib * 2]!, p.screen[ib * 2 + 1]!);
        stampSegment(pic, ax, ay, bx, by, e, half, depth, ndcZ(ia), ndcZ(ib), FOLDED_3D_CREASE_DEPTH_BIAS);
        const skinIndex = owner.get(e) ?? -1;
        pic.skinOfEdge.set(e, skinIndex);
        const skin = mesh.skins[skinIndex];
        pic.label.set(e, skin ? `plane=${skin.plane} side=${skin.side}` : 'plane=? side=?');
      }
    }
  }
  return pic;
}

/** Ink pixels in `pic`, dilated by `r`, as a mask. */
function inkMask(pic: Picture, r: number): Uint8Array {
  const mask = new Uint8Array(N * N);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      if (pic.id[y * N + x]! < 0) continue;
      for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          const px = x + ox, py = y + oy;
          if (px >= 0 && py >= 0 && px < N && py < N) mask[py * N + px] = 1;
        }
      }
    }
  }
  return mask;
}

/** One camera's disagreement, attributed to the skin that drew it. */
interface Disagreement {
  yawStep: number;
  tiltDeg: number;
  /** Ink the mesh draws over paper that the projector does not draw ink on. */
  spurious: number;
  /** Spurious ink within 2px of its own skin's visible paper — ribbon spill. */
  spill: number;
  /** Spurious ink more than 8px from its own skin's visible paper. */
  detached: number;
  /** Silhouette disagreement, if the two paths did not even draw the same shape. */
  misalignedIou: number | null;
  bySkin: string;
}

function compare(
  model: OristudioCpFolded3dRenderModel,
  mesh: Folded3dMesh,
  camera: FoldedFigureCamera
): Disagreement | null {
  const reference = projectorPicture(model, camera, 1.5);
  const actual = meshPicture(mesh, camera, 1.5);

  let both = 0;
  let either = 0;
  for (let i = 0; i < N * N; i += 1) {
    const a = reference.id[i]! !== BACKGROUND;
    const b = actual.id[i]! !== BACKGROUND;
    if (a && b) both += 1;
    if (a || b) either += 1;
  }
  const iou = either ? both / either : 1;
  const base = { yawStep: 0, tiltDeg: 0, spurious: 0, spill: 0, detached: 0 };
  if (iou < 0.9) return { ...base, misalignedIou: iou, bySkin: '' };

  const referenceInk = inkMask(reference, 3);
  const tally = new Map<string, number>();
  const bad: number[] = [];
  for (let i = 0; i < N * N; i += 1) {
    const id = actual.id[i]!;
    if (id < 0) continue;
    if (referenceInk[i]) continue;
    // Only ink drawn *over paper*. Ink over background is a different fault.
    if (reference.id[i]! !== PAPER) continue;
    bad.push(i);
    tally.set(actual.label.get(id) ?? '?', (tally.get(actual.label.get(id) ?? '?') ?? 0) + 1);
  }
  if (bad.length === 0) return null;

  // The discriminator between the two faults. A crease ribbon spilling off
  // paper too foreshortened to hold it lands a pixel or two outside its own
  // skin. A crease drawn where its own paper is *hidden* lands anywhere.
  let spill = 0;
  let detached = 0;
  for (const i of bad) {
    const skinIndex = actual.skinOfEdge.get(actual.id[i]!) ?? -1;
    const x0 = i % N;
    const y0 = Math.floor(i / N);
    let nearest = Infinity;
    for (let r = 0; r <= 8 && nearest === Infinity; r += 1) {
      for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const px = x0 + ox;
          const py = y0 + oy;
          if (px < 0 || py < 0 || px >= N || py >= N) continue;
          if (actual.skinOf[py * N + px]! === skinIndex) nearest = r;
        }
      }
    }
    if (nearest <= 2) spill += 1;
    else if (nearest > 8) detached += 1;
  }
  return {
    ...base,
    spurious: bad.length,
    spill,
    detached,
    misalignedIou: null,
    bySkin: [...tally.entries()]
      .sort((l, r) => r[1] - l[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}:${v}`)
      .join(' | '),
  };
}

function sweep(name: string): Disagreement[] {
  const model: OristudioCpFolded3dRenderModel = JSON.parse(
    readFileSync(join(FIXTURES, `${name}.rendermodel.json`), 'utf8')
  );
  const built = folded3dMesh(model);
  if (built.kind !== 'mesh') throw new Error(`${name} did not mesh`);
  const found: Disagreement[] = [];
  for (let yawStep = 0; yawStep < 8; yawStep += 1) {
    for (const tiltDeg of [0, 10, 20, 30, 40, 50, 60, 70, 80]) {
      const result = compare(model, built.mesh, {
        yaw: (yawStep / 8) * Math.PI * 2,
        pitch: -Math.PI / 2 + (tiltDeg / 180) * Math.PI,
        zoom: 1,
      });
      // 20px absorbs the pixel-level disagreement of two different
      // rasterizers drawing the same 1.5px ribbon; it is far below the
      // hundreds of pixels a real fault produces.
      if (result && (result.spurious > 20 || result.misalignedIou != null)) {
        found.push({ ...result, yawStep, tiltDeg });
      }
    }
  }
  return found;
}

/**
 * The window's picture against the projector's, over a camera sweep.
 *
 * The projector is the reference on purpose: it resolves depth with a BSP tree
 * and a painter's algorithm, which has no epsilon and no z-buffer precision, so
 * where the two disagree it is the window that is wrong. Every disagreement is
 * attributed to the skin whose crease drew it, which is what turns "a line shows
 * through sometimes" into a plane, a side, and a camera.
 */
describe('folded 3D window vs projector', () => {
  it.each(['hinge_90', 'spikes_small', 'pinwheel'])(
    '%s draws the same picture as the projector at every camera',
    (name) => {
      expect(sweep(name)).toEqual([]);
    }
  );

  it('box_90 has creases the projector hides — two distinct faults', () => {
    const found = sweep('box_90');
    // Not yet fixed. Pinned so the shape of the fault is visible and so a fix
    // has something to move: both counts should go to zero.
    const spill = found.reduce((sum, entry) => sum + entry.spill, 0);
    const detached = found.reduce((sum, entry) => sum + entry.detached, 0);
    expect({ cameras: found.length, spill: spill > 0, detached: detached > 0 }).toEqual({
      cameras: 19,
      spill: true,
      detached: true,
    });
  });
});
