/**
 * The 3D figure's scene, against the kernel payloads the window is tested on.
 *
 * Every fixture is the kernel's own `Folded3dRenderModel` (see
 * `foldedFigure3dProjection.test.ts` for how they are regenerated). The scene
 * is compared with the window rather than with the projector: the window and
 * the scene are built from *one* mesh, so what this pins is that the scene
 * producer's ordering reproduces the draw passes' picture — the invariant that
 * outlives the projector (§7 of `implementation-plans/unified-paper-style-and-export.md`).
 *
 * The comparison rasterises both without a canvas, as the parity harness does:
 * the window's draw passes with a depth buffer interpolated across the screen
 * as the GPU's is, the scene in painter's order with nothing else.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cameraUniforms,
  projectVertices,
  toViewSpace,
  viewRotationFor,
  type CameraUniforms,
  type PaperFaceItem,
  type PaperItem,
  type PaperLineItem,
  type PaperScene,
} from '@treemaker/origami-simulator';
import { folded3dDrawPasses } from '../../simulator/foldedMeshSource';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../lib/paper/paperStyle';
import { foldedFigureBox } from '../adapters/cpFoldedToScene';
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_FACE_ATTR_STRIDE,
  FOLDED_3D_PLANE_FRAME_STRIDE,
  IDENTITY_FOLDED_PLACEMENT,
  type OristudioCpFold3dTolerances,
  type OristudioCpFolded3dRenderModel,
  type OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import { FOLDED_3D_SILHOUETTE_FACTOR, folded3dFrameHalfSide } from './folded3dFrame';
import { folded3dMesh, type Folded3dMesh } from './folded3dMesh';
import { cellStack, planeFrame } from './folded3dModelReader';
import {
  folded3dFigureBoxCssPx,
  folded3dPaperScene,
  folded3dSceneCamera,
  type Folded3dPaperSceneOptions,
} from './folded3dScene';
import { FOLDED_3D_CREASE_DEPTH_BIAS, folded3dFrameFillZoom } from './folded3dWindow';
import {
  DEFAULT_FOLDED_3D_CAMERA,
  antipodalCamera,
  folded3dEyeDirection,
  folded3dFrameRadius,
  projectFolded3dModel,
  type FoldedFigureCamera,
} from './foldedFigure3dProjection';
import type { Folded3dPaperStyle } from './folded3dStyle';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const NAMES = [
  'hinge_90',
  'strip_coupled',
  'pinwheel',
  'pinwheel_cyclic',
  'box_90',
  'spikes_small',
] as const;

function fixture(name: string): OristudioCpFolded3dRenderModel {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.rendermodel.json`), 'utf8'));
}

function meshOf(model: OristudioCpFolded3dRenderModel): Folded3dMesh {
  const result = folded3dMesh(model);
  if (result.kind !== 'mesh') throw new Error(`expected a mesh, got ${result.kind}`);
  return result.mesh;
}

/** The kernel's shipped `Fold3dTolerances::DEFAULT`. */
const TOLERANCES: OristudioCpFold3dTolerances = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

/** The window's box in the tests, in CSS px. */
const BOX = 300;

const CAMERAS: ReadonlyArray<readonly [string, FoldedFigureCamera]> = [
  ['default', DEFAULT_FOLDED_3D_CAMERA],
  ['antipodal', antipodalCamera(DEFAULT_FOLDED_3D_CAMERA)],
  ['face-on', { yaw: 0, pitch: 0, zoom: 1 }],
  ['from-behind', { yaw: 0, pitch: Math.PI, zoom: 1 }],
  ['oblique', { yaw: 2.1, pitch: -1.9, zoom: 1 }],
];

function sceneOf(
  model: OristudioCpFolded3dRenderModel,
  mesh: Folded3dMesh,
  camera: FoldedFigureCamera,
  overrides: Partial<Folded3dPaperSceneOptions> = {},
  style: PaperStyle = DEFAULT_PAPER_STYLE
): PaperScene {
  return folded3dPaperScene(mesh, model, folded3dSceneCamera(camera, mesh, BOX), {
    style,
    markHidden: true,
    tolerances: TOLERANCES,
    ...overrides,
  });
}

const faces = (scene: PaperScene): PaperFaceItem[] =>
  scene.items.filter((item): item is PaperFaceItem => item.kind === 'face');
const lines = (scene: PaperScene): PaperLineItem[] =>
  scene.items.filter((item): item is PaperLineItem => item.kind === 'line');

function cellAttr(model: OristudioCpFolded3dRenderModel, cell: number, field: number): number {
  return model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + field] ?? 0;
}

/**
 * A cell's faces far-to-near at this camera, stated from the payload and the
 * eye alone (the projector's tests say the same thing the same way): the last
 * entry is the layer an opaque render shows.
 */
function cellFarToNear(
  model: OristudioCpFolded3dRenderModel,
  cell: number,
  camera: FoldedFigureCamera
): number[] {
  const stack = cellStack(model, cell);
  const base = cellAttr(model, cell, 0) * FOLDED_3D_PLANE_FRAME_STRIDE;
  const eye = folded3dEyeDirection(camera);
  const towardEye =
    (model.plane_frames[base] ?? 0) * eye[0] +
      (model.plane_frames[base + 1] ?? 0) * eye[1] +
      (model.plane_frames[base + 2] ?? 0) * eye[2] >=
    0;
  return towardEye ? [...stack].reverse() : [...stack];
}

/** The faces some cell shows at this camera — the projector's choice per cell. */
function nearFaces(model: OristudioCpFolded3dRenderModel, camera: FoldedFigureCamera): Set<number> {
  const near = new Set<number>();
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const order = cellFarToNear(model, cell, camera);
    if (order.length > 0) near.add(order[order.length - 1]!);
  }
  return near;
}

/** The faces buried in every cell they belong to at this camera. */
function buriedEverywhere(
  model: OristudioCpFolded3dRenderModel,
  camera: FoldedFigureCamera
): Set<number> {
  const near = nearFaces(model, camera);
  const buried = new Set<number>();
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    for (const face of cellStack(model, cell)) if (!near.has(face)) buried.add(face);
  }
  return buried;
}

/* --------------------------------------------------------------------------
 * Two rasterisers: the window's draw passes, and the scene in painter's order
 * ----------------------------------------------------------------------- */

const BACKGROUND = -1;
const INK = 1_000_000;

interface Picture {
  /** The kernel face painted at each pixel, `INK + n` for a crease, `-1` for none. */
  id: Int32Array;
  side: Int8Array;
}

function blank(): Picture {
  return { id: new Int32Array(BOX * BOX).fill(BACKGROUND), side: new Int8Array(BOX * BOX) };
}

/** Even-odd scanline fill of a set of rings, in px; `depth` per ring vertex when depth-tested. */
function fillRings(
  pic: Picture,
  rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  id: number,
  side: number
): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const crossings: number[] = [];
  for (let row = Math.max(0, Math.ceil(minY - 0.5)); row <= Math.min(BOX - 1, Math.floor(maxY - 0.5)); row += 1) {
    const y = row + 0.5;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 1) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        if (y1 <= y === y2 <= y) continue;
        crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    crossings.sort((l, r) => l - r);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const first = Math.max(0, Math.ceil(crossings[i]! - 0.5));
      const last = Math.min(BOX - 1, Math.floor(crossings[i + 1]! - 0.5));
      for (let col = first; col <= last; col += 1) {
        pic.id[row * BOX + col] = id;
        pic.side[row * BOX + col] = side;
      }
    }
  }
}

/** A depth-tested triangle, depth interpolated across the screen as the GPU's is. */
function fillTriangle(
  pic: Picture,
  depth: Float32Array,
  p: ReadonlyArray<readonly [number, number, number]>,
  id: number,
  side: number
): void {
  const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = p as [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-12) return;
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(BOX - 1, Math.ceil(Math.max(ay, by, cy)));
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(BOX - 1, Math.ceil(Math.max(ax, bx, cx)));
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const sx = px + 0.5;
      const sy = py + 0.5;
      const w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
      const w1 = ((sx - ax) * (cy - ay) - (sy - ay) * (cx - ax)) / area;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      const at = py * BOX + px;
      const z = az + w1 * (bz - az) + w0 * (cz - az);
      if (z > depth[at]!) continue;
      depth[at] = z;
      pic.id[at] = id;
      pic.side[at] = side;
    }
  }
}

/** A crease as a ribbon of half-width `half`, depth-tested with a bias when `depth` is given. */
function stampSegment(
  pic: Picture,
  a: readonly [number, number],
  b: readonly [number, number],
  id: number,
  half: number,
  depth: Float32Array | null,
  az = 0,
  bz = 0,
  bias = 0
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return;
  const steps = Math.max(1, Math.ceil(length * 2));
  for (let s = 0; s <= steps; s += 1) {
    const u = s / steps;
    const x = a[0] + dx * u;
    const y = a[1] + dy * u;
    const z = az + (bz - az) * u;
    for (let oy = -Math.ceil(half); oy <= Math.ceil(half); oy += 1) {
      for (let ox = -Math.ceil(half); ox <= Math.ceil(half); ox += 1) {
        if (ox * ox + oy * oy > half * half + 0.5) continue;
        const px = Math.floor(x + ox);
        const py = Math.floor(y + oy);
        if (px < 0 || py < 0 || px >= BOX || py >= BOX) continue;
        const at = py * BOX + px;
        // Creases test but do not write depth, exactly like the real pass.
        if (depth && z - bias > depth[at]!) continue;
        pic.id[at] = id;
      }
    }
  }
}

/**
 * The window's frame: `folded3dDrawPasses` at the scene's own camera, under
 * the mesh renderer's perspective, with a depth buffer. What the GPU would
 * show, decided in the same arithmetic several steps before a canvas.
 */
function windowPicture(mesh: Folded3dMesh, camera: CameraUniforms, half: number): Picture {
  const projected = projectVertices(mesh.positions, camera);
  const ndcZ = (v: number): number =>
    Math.max(-1, Math.min(1, -(projected.view[v * 3 + 2] ?? 0) / camera.depthRange));
  const screen = (v: number): [number, number] => [
    projected.screen[v * 2]!,
    projected.screen[v * 2 + 1]!,
  ];
  const faceOfTriangle = new Int32Array(mesh.topology.faceIndices.length / 3).fill(-1);
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    for (let i = mesh.slots.indexStart[slot]!; i < mesh.slots.indexStart[slot + 1]!; i += 3) {
      faceOfTriangle[i / 3] = mesh.slots.face[slot]!;
    }
  }
  // Skins repeat slot triangles at their own offsets; look a triangle's face
  // up by its first vertex, which every copy shares.
  const faceOfVertex = new Int32Array(Math.floor(mesh.positions.length / 3)).fill(-1);
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    for (let v = mesh.slots.vertexStart[slot]!; v < mesh.slots.vertexStart[slot + 1]!; v += 1) {
      faceOfVertex[v] = mesh.slots.face[slot]!;
    }
  }

  const pic = blank();
  const depth = new Float32Array(BOX * BOX).fill(Infinity);
  const passes = folded3dDrawPasses(
    { ...mesh, undeterminedFaceAlpha: 0.45 },
    { showFaces: true, showEdges: true, faceAlpha: 1 },
    camera
  );
  const idx = mesh.topology.faceIndices;
  for (const pass of passes) {
    if (pass.faceRange) {
      const end = pass.faceRange.start + pass.faceRange.count;
      for (let t = pass.faceRange.start; t + 2 < end; t += 3) {
        const [ia, ib, ic] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
        const [ax, ay] = screen(ia);
        const [bx, by] = screen(ib);
        const [cx, cy] = screen(ic);
        // `gl_FrontFacing` from the screen winding, negated for y-down.
        const winding = -((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
        fillTriangle(
          pic,
          depth,
          [
            [ax, ay, ndcZ(ia)],
            [bx, by, ndcZ(ib)],
            [cx, cy, ndcZ(ic)],
          ],
          faceOfVertex[ia]!,
          winding >= 0 ? 1 : -1
        );
      }
    }
    if (pass.edgeRange) {
      const end = pass.edgeRange.start + pass.edgeRange.count;
      for (let e = pass.edgeRange.start; e < end; e += 1) {
        const ia = mesh.topology.edgeIndices[e * 2]!;
        const ib = mesh.topology.edgeIndices[e * 2 + 1]!;
        stampSegment(pic, screen(ia), screen(ib), INK + e, half, depth, ndcZ(ia), ndcZ(ib), FOLDED_3D_CREASE_DEPTH_BIAS);
      }
    }
  }
  return pic;
}

/** The page: every item in order, hidden ones included — they change nothing if marked right. */
function scenePicture(scene: PaperScene, half: number): Picture {
  const pic = blank();
  scene.items.forEach((item, index) => {
    if (item.kind === 'face') fillRings(pic, item.rings, item.face, item.side === 'front' ? 1 : -1);
    else if (item.kind === 'line') stampSegment(pic, item.a, item.b, INK + index, half, null);
  });
  return pic;
}

/** Ink pixels of `pic`, dilated by `r`. */
function inkMask(pic: Picture, r: number): Uint8Array {
  const mask = new Uint8Array(BOX * BOX);
  for (let y = 0; y < BOX; y += 1) {
    for (let x = 0; x < BOX; x += 1) {
      if (pic.id[y * BOX + x]! < INK) continue;
      for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          const px = x + ox;
          const py = y + oy;
          if (px >= 0 && py >= 0 && px < BOX && py < BOX) mask[py * BOX + px] = 1;
        }
      }
    }
  }
  return mask;
}

interface Disagreement {
  /** Pixels either picture paints. */
  painted: number;
  /** Pixels where the two show a different face or side, over paper in both. */
  paper: number;
  /** Scene ink over paper the window draws no ink near. */
  spuriousInk: number;
  /** Window ink over paper the scene draws no ink near. */
  missingInk: number;
}

function compare(mesh: Folded3dMesh, scene: PaperScene, camera: CameraUniforms): Disagreement {
  const half = 1.5;
  const window = windowPicture(mesh, camera, half);
  const page = scenePicture(scene, half);
  const windowInk = inkMask(window, 3);
  const pageInk = inkMask(page, 3);
  let painted = 0;
  let paper = 0;
  let spuriousInk = 0;
  let missingInk = 0;
  for (let i = 0; i < BOX * BOX; i += 1) {
    const w = window.id[i]!;
    const p = page.id[i]!;
    if (w === BACKGROUND && p === BACKGROUND) continue;
    painted += 1;
    const wPaper = w >= 0 && w < INK;
    const pPaper = p >= 0 && p < INK;
    if (wPaper && pPaper && (w !== p || window.side[i] !== page.side[i])) paper += 1;
    if (p >= INK && !windowInk[i] && (wPaper || w === BACKGROUND)) spuriousInk += 1;
    if (w >= INK && !pageInk[i]) missingInk += 1;
  }
  return { painted, paper, spuriousInk, missingInk };
}

/* --------------------------------------------------------------------------
 * The contract
 * ----------------------------------------------------------------------- */

describe('the scene the 3D figure exports', () => {
  it.each(NAMES)('%s carries every kernel face, every layer present', (name) => {
    const model = fixture(name);
    const mesh = meshOf(model);
    for (const [label, camera] of CAMERAS) {
      const scene = sceneOf(model, mesh, camera);
      const drawn = new Set(faces(scene).map((face) => face.face));
      // A face seen exactly edge-on projects to nothing and is dropped, as
      // the GPU rasterises nothing for it; every other face is here, buried
      // or not.
      const uniforms = folded3dSceneCamera(camera, mesh, BOX);
      for (let face = 0; face < model.face_count; face += 1) {
        if (edgeOn(model, face, uniforms)) continue;
        expect(drawn.has(face), `${name} @ ${label}, face ${face}`).toBe(true);
      }
    }
  });

  it.each(NAMES)('%s shows only the layer the kernel put nearest the eye', (name) => {
    const model = fixture(name);
    const mesh = meshOf(model);
    for (const [label, camera] of CAMERAS) {
      const scene = sceneOf(model, mesh, camera);
      const near = nearFaces(model, camera);
      const uniforms = folded3dSceneCamera(camera, mesh, BOX);
      for (const face of faces(scene)) {
        // A plane seen edge-on has no near end: the perspective shows a sliver
        // of it from one side, and which side is a tie the window and the
        // scene break the same way (`folded3dDrawPasses`), not the payload.
        if (face.hidden || edgeOn(model, face.face, uniforms)) continue;
        expect(near.has(face.face), `${name} @ ${label}, face ${face.face} shows`).toBe(true);
      }
    }
  });

  it.each(NAMES)('%s marks a layer buried everywhere hidden, faces and creases alike', (name) => {
    const model = fixture(name);
    const mesh = meshOf(model);
    let checked = 0;
    for (const [label, camera] of CAMERAS) {
      const scene = sceneOf(model, mesh, camera);
      const uniforms = folded3dSceneCamera(camera, mesh, BOX);
      const buried = new Set(
        [...buriedEverywhere(model, camera)].filter((face) => !edgeOn(model, face, uniforms))
      );
      for (const item of scene.items) {
        if (item.kind === 'markup') continue;
        const face = item.face ?? -1;
        if (!buried.has(face)) continue;
        expect(item.hidden, `${name} @ ${label}, ${item.kind} of buried face ${face}`).toBe(true);
        checked += 1;
      }
      // Present, not dropped: the buried layer is what a painter that keeps
      // hidden faces uncovers.
      for (const face of buried) {
        expect(
          faces(scene).some((item) => item.face === face),
          `${name} @ ${label}, buried face ${face} present`
        ).toBe(true);
      }
    }
    if (name !== 'hinge_90') expect(checked).toBeGreaterThan(0);
  });

  /**
   * The gate that replaces the projector-vs-window comparison: one mesh, two
   * orderings, one picture. Paper agrees exactly. Ink: the scene never lacks
   * a line the window draws, and the lines it draws that the window does not
   * are the window's known loss — a concave crease seen obliquely from inside
   * a fold (the far corner of `box_90`, a spike's base in `spikes_small`),
   * where the paper beside the line is nearer than the line and the GPU's
   * 1e-5 NDC bias cannot carry the ribbon over it; the painter's order keeps
   * the line at its full width. Bounded per fixture so a regression of either
   * kind has a number to move.
   */
  it.each([
    ['hinge_90', 0],
    ['strip_coupled', 0],
    ['pinwheel', 0],
    ['pinwheel_cyclic', 0],
    ['box_90', 200],
    ['spikes_small', 600],
  ] as const)('%s draws the picture the window draws, at every camera', (name, concaveInk) => {
    const model = fixture(name);
    const mesh = meshOf(model);
    let cameras = 0;
    for (let yawStep = 0; yawStep < 4; yawStep += 1) {
      for (const tiltDeg of [0, 30, 60, 100, 140, 200, 250, 300]) {
        const camera: FoldedFigureCamera = {
          yaw: (yawStep / 4) * Math.PI * 2 + 0.2,
          pitch: -Math.PI / 2 + (tiltDeg / 180) * Math.PI,
          zoom: 1,
        };
        const uniforms = folded3dSceneCamera(camera, mesh, BOX);
        const result = compare(mesh, sceneOf(model, mesh, camera), uniforms);
        const label = `${name} yaw ${yawStep} tilt ${tiltDeg}`;
        expect(result.painted, label).toBeGreaterThan(0);
        // Two rasterisers of the same polygons: exact, save for a pixel whose
        // centre sits on a shared edge.
        expect(result.paper / result.painted, `${label}: paper`).toBeLessThan(1e-3);
        expect(result.missingInk, `${label}: ink the window draws`).toBe(0);
        expect(result.spuriousInk, `${label}: ink the window loses`).toBeLessThanOrEqual(concaveInk);
        cameras += 1;
      }
    }
    expect(cameras).toBe(32);
  });

  it.each(NAMES)('%s keeps every crease of a buried layer under the layer that covers it', (name) => {
    // The layered order at work: every crease is drawn after the faces of its
    // own layer and before the next layer's, so a buried layer's creases
    // come out hidden rather than over paper the window shows — which the
    // picture comparison above sees as spurious ink, and the count here as
    // a crease whose face is buried everywhere and yet shows.
    const model = fixture(name);
    const mesh = meshOf(model);
    for (const [label, camera] of CAMERAS) {
      const scene = sceneOf(model, mesh, camera);
      const uniforms = folded3dSceneCamera(camera, mesh, BOX);
      const near = nearFaces(model, camera);
      for (const line of lines(scene)) {
        if (line.hidden || line.face === undefined || edgeOn(model, line.face, uniforms)) continue;
        expect(near.has(line.face), `${name} @ ${label}, a crease of face ${line.face} shows`).toBe(true);
      }
    }
  });
});

describe('what the scene says about each item', () => {
  it.each(NAMES)('%s shows the paper side the projector does — the GPU’s winding', (name) => {
    // The mesh is wound so the GPU paints the kernel's front where the kernel
    // says front (`folded3dMesh.ts`, and its test against the projector); the
    // scene reads the same winding. Pinned against the payload's own facts —
    // `facing × up` against the eye — rather than against the winding, so a
    // second statement of the side could not agree by construction.
    const model = fixture(name);
    const mesh = meshOf(model);
    let checked = 0;
    for (const [label, camera] of CAMERAS) {
      const uniforms = folded3dSceneCamera(camera, mesh, BOX);
      for (const face of faces(sceneOf(model, mesh, camera))) {
        if (face.hidden || edgeOn(model, face.face, uniforms)) continue;
        expect(face.side, `${name} @ ${label}, face ${face.face}`).toBe(
          frontTowardEye(model, face.face, uniforms) ? 'front' : 'back'
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('measures the sheet as the unfolded span at the camera', () => {
    const model = fixture('box_90');
    const mesh = meshOf(model);
    const uniforms = folded3dSceneCamera(DEFAULT_FOLDED_3D_CAMERA, mesh, BOX);
    expect(sceneOf(model, mesh, DEFAULT_FOLDED_3D_CAMERA).sheet).toBeCloseTo(
      model.span * uniforms.scale,
      9
    );
  });

  it('names each crease by its fold: mountain, valley, and edge for a border', () => {
    const model = fixture('box_90');
    const roles = new Set(lines(sceneOf(model, meshOf(model), DEFAULT_FOLDED_3D_CAMERA)).map((line) => line.role));
    expect(roles).toEqual(new Set(['edge', 'mountain', 'valley']));
  });

  it('names a 0° fold aux, which the painter inks in the aux pen or leaves out', () => {
    // Re-pinned: a 0° crease was 'edge' until Phase 5 gave the mesh the aux
    // code. No fixture carries one, so the hinge's single fold is relabelled:
    // the label is all `folded3dEdgeAssignment` reads, the geometry stays.
    const model = fixture('hinge_90');
    const flat: OristudioCpFolded3dRenderModel = {
      ...model,
      edge_fold_degrees: model.edge_fold_degrees.map(() => 0),
    };
    const mesh = meshOf(flat);
    const roles = lines(sceneOf(flat, mesh, DEFAULT_FOLDED_3D_CAMERA)).map((line) => line.role);
    expect(roles).toContain('aux');
    expect(roles).not.toContain('mountain');
    expect(roles).not.toContain('valley');
    // And the aux line is the fold, still marked on the boundary at both
    // corners, so erode retreats it as it would the fold.
    for (const line of lines(sceneOf(flat, mesh, DEFAULT_FOLDED_3D_CAMERA))) {
      if (line.role === 'aux') expect(line.onBoundary).toEqual([true, true]);
    }
  });

  it('shades faces by the figure’s light through the folded-3d policy, and not when the light is off', () => {
    const model = fixture('box_90');
    const mesh = meshOf(model);
    const lit = faces(sceneOf(model, mesh, DEFAULT_FOLDED_3D_CAMERA)).map((face) => face.shade);
    expect(new Set(lit).size).toBeGreaterThan(1);
    const dark: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      light: { ...DEFAULT_PAPER_STYLE.light, enabled: false },
    };
    const unlit = faces(sceneOf(model, mesh, DEFAULT_FOLDED_3D_CAMERA, {}, dark));
    expect(unlit.every((face) => face.shade === 1)).toBe(true);
  });

  it('draws creases alone for a wireframe, only the layers the window shows, and nothing for None0', () => {
    const model = fixture('spikes_small');
    const mesh = meshOf(model);
    const wire = sceneOf(model, mesh, DEFAULT_FOLDED_3D_CAMERA, { displayStyle: 'Wire2' });
    expect(faces(wire)).toHaveLength(0);
    // No paper can bury a crease, so the buried layers' creases stay out, as
    // the window's skins leave them out. What a wireframe can still hide is a
    // fold drawn once from each of its two planes, where the second copy
    // covers the first exactly.
    const near = nearFaces(model, DEFAULT_FOLDED_3D_CAMERA);
    const drawn = lines(wire);
    expect(drawn.length).toBeGreaterThan(0);
    drawn.forEach((line, index) => {
      if (line.face !== undefined) expect(near.has(line.face)).toBe(true);
      if (!line.hidden) return;
      const same = (p: readonly number[], q: readonly number[]) =>
        Math.abs(p[0]! - q[0]!) < 1e-6 && Math.abs(p[1]! - q[1]!) < 1e-6;
      expect(
        drawn.slice(index + 1).some(
          (later) =>
            (same(later.a, line.a) && same(later.b, line.b)) ||
            (same(later.a, line.b) && same(later.b, line.a))
        )
      ).toBe(true);
    });
    expect(sceneOf(model, mesh, DEFAULT_FOLDED_3D_CAMERA, { displayStyle: 'None0' }).items).toEqual([]);
  });

  it('leaves the hidden test out when the page keeps every face', () => {
    const model = fixture('pinwheel');
    const mesh = meshOf(model);
    const kept = sceneOf(model, mesh, DEFAULT_FOLDED_3D_CAMERA, { markHidden: false });
    expect(kept.items.every((item) => !item.hidden)).toBe(true);
    expect(kept.items.length).toBeGreaterThan(0);
  });

  it('marks a fold’s ends on the boundary where it meets a face corner', () => {
    // The hinge: one fold between two faces, each end at a corner where the
    // paper's border meets it, so both ends retreat under erode. Under
    // `layers` the tree cuts in view space, and ownership of an end is
    // decided there; a page comparison reported every end false at any real
    // orbit, since a vertex's page position and the projected vertex differ
    // by float32 rounding.
    const model = fixture('hinge_90');
    const mesh = meshOf(model);
    for (const [label, camera] of CAMERAS) {
      const folds = lines(sceneOf(model, mesh, camera)).filter((line) => line.role !== 'edge');
      expect(folds.length, label).toBeGreaterThan(0);
      for (const fold of folds) expect(fold.onBoundary, label).toEqual([true, true]);
    }
  });

  it.each(NAMES)('%s never marks a fold’s end that the tree cut mid-crease', (name) => {
    // An end that retreats is always a vertex of the mesh — never a point an
    // arrangement cut left in the middle of a crease, which erode would open
    // a gap at. At 1e-3 px: the page position is the float32 view position
    // projected, and the projected vertex is the float64 projection rounded.
    const model = fixture(name);
    const mesh = meshOf(model);
    let marked = 0;
    for (const [label, camera] of CAMERAS) {
      const uniforms = folded3dSceneCamera(camera, mesh, BOX);
      const projected = projectVertices(mesh.positions, uniforms);
      const isVertex = (p: readonly number[]): boolean => {
        for (let v = 0; v < projected.count; v += 1) {
          if (
            Math.abs(projected.screen[v * 2]! - p[0]!) < 1e-3 &&
            Math.abs(projected.screen[v * 2 + 1]! - p[1]!) < 1e-3
          ) {
            return true;
          }
        }
        return false;
      };
      for (const line of lines(sceneOf(model, mesh, camera))) {
        for (const [end, point] of [[0, line.a], [1, line.b]] as const) {
          if (!line.onBoundary[end]) continue;
          marked += 1;
          expect(isVertex(point), `${name} @ ${label}`).toBe(true);
        }
      }
    }
    expect(marked, name).toBeGreaterThan(0);
  });
});

describe('the export camera', () => {
  it('is the window’s camera, in CSS px', () => {
    // What `Folded3dWindowLayer` hands `setCamera`: the stored orbit through
    // `folded3dWindowView`, its zoom times the fill zoom for the box, the
    // mesh's centre and radius, and the box for the frame.
    const mesh = meshOf(fixture('box_90'));
    const camera: FoldedFigureCamera = { yaw: 0.4, pitch: -0.9, zoom: 1.5 };
    const uniforms = folded3dSceneCamera(camera, mesh, 256);
    expect(uniforms).toEqual(
      cameraUniforms(
        { yaw: 0.4, pitch: -0.9, zoom: 1.5 * folded3dFrameFillZoom(256, 256) },
        mesh.center,
        mesh.radius,
        256,
        256
      )
    );
    expect(uniforms.rotation).toEqual(viewRotationFor({ yaw: 0.4, pitch: -0.9, zoom: 1.5 }));
    // At zoom 1 the model's perspective silhouette exactly fills the box.
    const fitted = folded3dSceneCamera({ yaw: 0, pitch: 0, zoom: 1 }, mesh, 256);
    expect(fitted.scale * 2 * mesh.radius * FOLDED_3D_SILHOUETTE_FACTOR).toBeCloseTo(256, 6);
  });

  it('honours the figure’s zoom and orientation, and clamps a zoom off a file', () => {
    const mesh = meshOf(fixture('box_90'));
    const orient = viewRotationFor({ yaw: 0.3, pitch: 0.2, zoom: 1 });
    const turned = folded3dSceneCamera({ yaw: 1, pitch: -0.5, zoom: 2, orient }, mesh, 200);
    expect(turned.rotation).toEqual(viewRotationFor({ yaw: 1, pitch: -0.5, zoom: 2, orient }));
    const plain = folded3dSceneCamera({ yaw: 1, pitch: -0.5, zoom: 1, orient }, mesh, 200);
    expect(turned.scale / plain.scale).toBeCloseTo(2, 9);
    expect(folded3dSceneCamera({ yaw: 0, pitch: 0, zoom: 99 }, mesh, 200).scale).toBe(
      folded3dSceneCamera({ yaw: 0, pitch: 0, zoom: 8 }, mesh, 200).scale
    );
    // The fold camera for a figure that carries none.
    expect(folded3dSceneCamera(null, mesh, 200).rotation).toEqual(
      viewRotationFor(DEFAULT_FOLDED_3D_CAMERA)
    );
  });

  it('is zoom-independent in orientation: the picture is the crop of the artwork', () => {
    // Scene px scale with the zoom (the window crops what leaves the box; the
    // page crops to the artwork), the orientation and the layer order do not.
    // The hidden marks are left out of the comparison: the test samples the
    // page at its own resolution, and a sliver can hold a sample at one zoom
    // and none at the other.
    const model = fixture('box_90');
    const mesh = meshOf(model);
    const one = sceneOf(model, mesh, { ...DEFAULT_FOLDED_3D_CAMERA, zoom: 1 });
    const two = sceneOf(model, mesh, { ...DEFAULT_FOLDED_3D_CAMERA, zoom: 2 });
    const faceOf = (item: PaperItem) => (item.kind === 'markup' ? undefined : item.face);
    expect(two.items.map((item) => [item.kind, faceOf(item)])).toEqual(
      one.items.map((item) => [item.kind, faceOf(item)])
    );
    expect(two.sheet / one.sheet).toBeCloseTo(2, 6);
    const extent = (scene: PaperScene) => scene.bounds.maxX - scene.bounds.minX;
    expect(extent(two) / extent(one)).toBeCloseTo(2, 6);
  });

  it('sizes the box from the frame the window is sized from', () => {
    const model = fixture('spikes_small');
    const entry = framedEntry(model);
    const box = foldedFigureBox(entry)!;
    expect(box.width).toBe(box.height);
    expect(folded3dFigureBoxCssPx(entry)).toBeCloseTo(box.width, 9);
    // Scaled by the canvas: 100% is a CSS px per user unit.
    expect(folded3dFigureBoxCssPx(entry, 0.5)).toBeCloseTo(box.width / 2, 9);
    expect(folded3dFigureBoxCssPx({ ...entry, placement: { ...entry.placement, scale: 2 } })).toBeCloseTo(
      box.width * 2,
      9
    );
    // The frame is the model's silhouette, in the units the figure's
    // primitives are in — so the export at zoom 1 is the figure's on-screen size.
    expect(box.width).toBeGreaterThan(2 * folded3dFrameHalfSide(folded3dFrameRadius(model)) * 0.99);
    expect(folded3dFigureBoxCssPx({ ...entry, frameRadius: null, renderSnapshot: null })).toBeNull();
  });
});

/** A 3D figure entry with the frame the window draws inside — what the export reads. */
function framedEntry(model: OristudioCpFolded3dRenderModel): OristudioCpFoldedFigureEntry {
  const snapshot = projectFolded3dModel(model, {
    camera: DEFAULT_FOLDED_3D_CAMERA,
    displayStyle: 'Paper5',
    style: PROJECTOR_STYLE,
    tolerances: TOLERANCES,
  }).snapshot;
  return {
    id: 'f',
    title: 'f',
    handle: 1,
    sourceKind: 'generated-3d',
    sourceCpRevision: null,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d: {},
    renderSnapshot: snapshot,
    placement: IDENTITY_FOLDED_PLACEMENT,
    error: null,
    frameRadius: folded3dFrameRadius(model),
  } as unknown as OristudioCpFoldedFigureEntry;
}

const PROJECTOR_STYLE: Folded3dPaperStyle = {
  front: [1, 1, 0.2],
  back: [1, 1, 1],
  line: [0, 0, 0],
  faceAlpha: 1,
  transparentAlpha: 16 / 255,
  lineWidth: 1.200000048,
  antiAlias: true,
  lighting: true,
  lightDir: [0, 0, 1],
};

/** The paper's front normal of a face, in view space: `facing × up`, through the mesh basis. */
function frontTowardEye(
  model: OristudioCpFolded3dRenderModel,
  face: number,
  camera: CameraUniforms
): boolean {
  const base = face * FOLDED_3D_FACE_ATTR_STRIDE;
  const { up } = planeFrame(model, model.face_attr[base] ?? 0);
  const facing = model.face_attr[base + 3] ?? 1;
  const view = toViewSpace(up[0], up[2], -up[1], { ...camera, center: [0, 0, 0] });
  return view[2] * facing >= 0;
}

/** Whether a face's plane is seen edge-on at this camera: its normal has no depth component. */
function edgeOn(
  model: OristudioCpFolded3dRenderModel,
  face: number,
  camera: CameraUniforms
): boolean {
  const { up } = planeFrame(model, model.face_attr[face * FOLDED_3D_FACE_ATTR_STRIDE] ?? 0);
  const view = toViewSpace(up[0], up[2], -up[1], { ...camera, center: [0, 0, 0] });
  return Math.abs(view[2]) < 1e-6;
}
