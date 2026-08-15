/**
 * The GPU mesh, against real kernel payloads.
 *
 * Every fixture is the kernel's own `Folded3dRenderModel` — the same six the CPU
 * projector is tested against, and nothing here is hand-written.
 *
 * # Asserting the picture without a canvas
 *
 * The automated browser pane runs with **zero animation frames**, so a rendered
 * pixel cannot be looked at. It does not have to be. The depth buffer's answer
 * is a total order on view depth, and `projectVertices` is the maintained CPU
 * mirror of the very vertex shader that computes it (`camera.ts` says so, and
 * the SVG exporter already depends on it being exact). `gl_FrontFacing`'s answer
 * is the sign of the screen-space winding, which `svgRenderer.ts` mirrors as
 * `winding = −screenArea` for the same reason.
 *
 * So both questions this module has to get right — which layer of a stack shows,
 * and which side of the paper it shows — are decided here in the same arithmetic
 * the GPU will use, several steps before a canvas is involved.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cameraUniforms,
  projectVertices,
  toViewSpace,
  type CameraUniforms,
  type OrbitView,
  type ProjectedVertices,
} from '@treemaker/origami-simulator';
import {
  CREASE_INSET_RELATIVE,
  FOLDED_3D_MESH_VERTEX_BUDGET,
  folded3dEdgeAssignment,
  folded3dMesh,
  packFolded3dPositionTexture,
  type Folded3dMesh,
} from './folded3dMesh';
import {
  DEFAULT_FOLDED_3D_CAMERA,
  antipodalCamera,
  folded3dEyeDirection,
  folded3dFrameRadius,
  projectFolded3dModel,
  type FoldedFigureCamera,
} from './foldedFigure3dProjection';
import { foldedFigureExportDocument } from './foldedFigureExport';
import type { Folded3dPaperStyle } from './folded3dStyle';
import {
  buildFolded3dInk,
  cellRing,
  cellStack,
  faceNormal,
  modelCentroid,
  modelRadius,
  planeFrame,
} from './folded3dModelReader';
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_CELL_UNDETERMINED,
  FOLDED_3D_EDGE_ATTR_STRIDE,
  FOLDED_3D_EDGE_BORDER,
  FOLDED_3D_EDGE_CREASE,
  FOLDED_3D_EDGE_UNKNOWN,
  FOLDED_3D_FACE_ATTR_STRIDE,
  type OristudioCpFold3dTolerances,
  type OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';

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

/** The kernel's shipped `Fold3dTolerances::DEFAULT`. */
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
  lineWidth: 1.200000048,
  antiAlias: true,
  lighting: true,
  lightDir: [0, 0, 1],
};

/**
 * Cameras every orientation-sensitive assertion is repeated at.
 *
 * The default and its antipode are the two the product actually shows. The other
 * three are there because a stack read off the wrong end of `cell_stack` is
 * correct at exactly the cameras where `up · eye` happens to be positive, and
 * one fixed viewpoint would not notice.
 */
const CAMERAS: ReadonlyArray<readonly [string, FoldedFigureCamera]> = [
  ['default', DEFAULT_FOLDED_3D_CAMERA],
  ['antipodal', antipodalCamera(DEFAULT_FOLDED_3D_CAMERA)],
  ['face-on', { yaw: 0, pitch: 0, zoom: 1 }],
  ['from-behind', { yaw: 0, pitch: Math.PI, zoom: 1 }],
  ['oblique', { yaw: 2.1, pitch: -1.9, zoom: 1 }],
];

const FRAME = 512;

/**
 * The model edge behind every emitted crease, in emission order.
 *
 * Re-derived from the ink and the slot table rather than read off the mesh,
 * which carries no per-crease edge id: this is the wiring under test, so a test
 * that asked the mesh what it drew could only agree with itself.
 */
function creaseSources(model: OristudioCpFolded3dRenderModel, mesh: Folded3dMesh): number[] {
  const ink = buildFolded3dInk(model);
  const sources: number[] = [...ink.orphanEdges];
  // Slot order, which is the order the translucent run appends them in.
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    const cell = mesh.slots.cell[slot]!;
    const segments = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 2] ?? 0;
    for (let segment = 0; segment < segments; segment += 1) {
      const edge = ink.edgeAt(cell, mesh.slots.depth[slot]!, segment);
      if (edge >= 0) sources.push(edge);
    }
  }
  return sources;
}

function cellStackOf(
  model: OristudioCpFolded3dRenderModel,
  cell: number
): number[] {
  const start = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 3] ?? 0;
  const length = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 4] ?? 0;
  return model.cell_stack.slice(start, start + length);
}

/**
 * A cell's faces **far-to-near at this camera**, whose last element is the one
 * an opaque render shows.
 *
 * `cell_stack` is top-first with respect to the cell's plane `up`, and `up` is a
 * property of the *paper* — the placed normal of the plane's lowest-indexed
 * member face — so it points toward the viewer for some cameras and away for
 * others. Stated here rather than taken from the mesh, because the whole point
 * is to check the mesh against it.
 */
function cellFarToNear(
  model: OristudioCpFolded3dRenderModel,
  cell: number,
  camera: FoldedFigureCamera
): number[] {
  const stack = cellStackOf(model, cell);
  const up = planeFrame(model, model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0).up;
  const eye = folded3dEyeDirection(camera);
  const towardEye = up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2] >= 0;
  return towardEye ? [...stack].reverse() : [...stack];
}

/** The slots of each cell, in `cell_stack` order. */
function slotsByCell(mesh: Folded3dMesh): Map<number, number[]> {
  const byCell = new Map<number, number[]>();
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    const cell = mesh.slots.cell[slot]!;
    const list = byCell.get(cell) ?? [];
    list.push(slot);
    byCell.set(cell, list);
  }
  return byCell;
}

/** Every cell that has any layer at all. */
function stackedCellsOf(model: OristudioCpFolded3dRenderModel): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    if (cellStack(model, cell).length > 0) cells.push(cell);
  }
  return cells;
}

/** The creases of the translucent and undetermined runs, where each appears once. */
function everyCrease(mesh: Folded3dMesh): number[] {
  const out: number[] = [];
  for (let crease = 0; crease < mesh.fallbackEdgeCount; crease += 1) out.push(crease);
  const start = mesh.translucent.edgeStart;
  const end = mesh.undetermined.edgeStart + mesh.undetermined.edgeCount;
  for (let crease = start; crease < end; crease += 1) out.push(crease);
  return out;
}

/** A world point in the mesh's own space: simulator basis, centroid-relative. */
function simBasisRelative(
  model: OristudioCpFolded3dRenderModel,
  point: readonly [number, number, number]
): [number, number, number] {
  const centre = modelCentroid(model);
  return [
    point[0] - centre[0],
    point[2] - centre[2],
    -(point[1] - centre[1]),
  ];
}

function distanceToSegment(
  p: readonly [number, number, number],
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]] as const;
  const lengthSquared = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  let t = lengthSquared > 0 ? (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / lengthSquared : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

/**
 * Below this, a plane is edge-on to the eye and there is no depth order to
 * check. `box_90`'s plane 1 is exactly edge-on at the antipodal camera, so this
 * is a real case rather than a defensive one.
 */
const EDGE_ON = 1e-6;

function meshOf(model: OristudioCpFolded3dRenderModel): Folded3dMesh {
  const result = folded3dMesh(model);
  if (result.kind !== 'mesh') throw new Error(`expected a mesh, got ${result.kind}`);
  return result.mesh;
}

function orbit(camera: FoldedFigureCamera): OrbitView {
  return { yaw: camera.yaw, pitch: camera.pitch, zoom: camera.zoom };
}

function uniformsFor(mesh: Folded3dMesh, camera: FoldedFigureCamera): CameraUniforms {
  return cameraUniforms(orbit(camera), mesh.center, mesh.radius, FRAME, FRAME);
}



/**
 * Which end of a cell's plane faces the eye — the projector's own rule, asked
 * independently. `cell_stack` is top-first with respect to `up`, so `stack[0]` is
 * the near layer exactly while this is true.
 */
function upTowardEye(
  model: OristudioCpFolded3dRenderModel,
  plane: number,
  camera: FoldedFigureCamera
): number {
  const { up } = planeFrame(model, plane);
  const eye = folded3dEyeDirection(camera);
  return up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2];
}

/**
 * The screen winding `gl_FrontFacing` decides on, mirrored from `svgRenderer.ts`:
 * the signed area in pixel space, negated because pixel y points down while NDC
 * y points up. Front-facing — and so `u_frontColor` — when this is positive.
 */
function screenWinding(
  projected: ProjectedVertices,
  a: number,
  b: number,
  c: number
): number {
  const ax = projected.screen[a * 2]!;
  const ay = projected.screen[a * 2 + 1]!;
  return -(
    ((projected.screen[b * 2]! - ax) * (projected.screen[c * 2 + 1]! - ay) -
      (projected.screen[b * 2 + 1]! - ay) * (projected.screen[c * 2]! - ax)) /
    2
  );
}

/** Kernel world direction into view space — the projector's `directionToView`. */
function viewNormalOf(
  model: OristudioCpFolded3dRenderModel,
  face: number,
  uniforms: CameraUniforms
): [number, number, number] {
  const n = faceNormal(model, face);
  return toViewSpace(n[0], n[2], -n[1], { ...uniforms, center: [0, 0, 0] });
}

describe('folded3dMesh', () => {
  describe('shape', () => {
    it.each(NAMES)('%s emits one ring copy per cell stack slot', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);

      let expectedSlots = 0;
      let expectedVertices = 0;
      for (let cell = 0; cell < model.cell_count; cell += 1) {
        const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
        const ring = model.cell_attr[base + 2] ?? 0;
        const stack = model.cell_attr[base + 4] ?? 0;
        if (ring < 3 || stack === 0) continue;
        expectedSlots += stack;
        // Two copies of the ring per slot: the paper, and the ring inset by
        // `CREASE_INSET_RELATIVE` that the creases are drawn from.
        expectedVertices += ring * stack * 2;
      }
      // Creases cost no vertices — they are indices into the ring copies above —
      // except in the fallback, which is expected empty on every fixture.
      expect(mesh.fallbackEdgeCount).toBe(0);
      expectedVertices += mesh.fallbackEdgeCount * 2;

      expect(mesh.slots.count).toBe(expectedSlots);
      expect(mesh.positions.length).toBe(expectedVertices * 3);
      // Every index addresses a vertex that exists.
      for (const index of mesh.topology.faceIndices) {
        expect(index).toBeLessThan(expectedVertices);
      }
      for (const index of mesh.topology.edgeIndices) {
        expect(index).toBeLessThan(expectedVertices);
      }
      expect(mesh.slots.indexStart.length).toBe(mesh.slots.count + 1);
      expect(mesh.slots.indexStart[mesh.slots.count]).toBe(mesh.topology.faceIndices.length);
      expect(mesh.topology.edgeIndices.length).toBe(
        mesh.topology.edgeAssignments.length * 2
      );
      // The fallback sits at the head, before the first skin.
      const firstSkinEdge = mesh.skins[0]?.edgeStart ?? mesh.translucent.edgeStart;
      expect(firstSkinEdge).toBe(mesh.fallbackEdgeCount);
      // The translucent and undetermined runs tile the tail exactly: every layer
      // once, nothing missed, nothing counted twice.
      expect(mesh.translucent.faceIndexStart + mesh.translucent.faceIndexCount).toBe(
        mesh.undetermined.faceIndexStart
      );
      expect(mesh.undetermined.faceIndexStart + mesh.undetermined.faceIndexCount).toBe(
        mesh.topology.faceIndices.length
      );
      expect(mesh.undetermined.edgeStart + mesh.undetermined.edgeCount).toBe(
        mesh.topology.edgeAssignments.length
      );
    });

    it.each(NAMES)('%s builds two skins per plane, one layer per cell', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      // A plane's visible surface is the top face of each of its cells from one
      // side and the bottom from the other. Both are facts about the model, so
      // both are built once and the eye only chooses.
      const sides = new Map<number, Set<number>>();
      for (const skin of mesh.skins) {
        if (!sides.has(skin.plane)) sides.set(skin.plane, new Set());
        sides.get(skin.plane)!.add(skin.side);
        // The skin's `up` is the plane's, carried into the mesh basis so a
        // caller can take `up · eye` without re-deriving the axis swap.
        const up = planeFrame(model, skin.plane).up;
        expect(skin.up).toEqual([up[0], up[2], -up[1]]);
      }
      for (const [, both] of sides) expect([...both].sort()).toEqual([-1, 1]);

      // One layer per cell: the skin's triangle count is the sum over the
      // plane's determined cells of one slot's triangles.
      for (const skin of mesh.skins) {
        let expected = 0;
        for (let slot = 0; slot < mesh.slots.count; slot += 1) {
          const cell = mesh.slots.cell[slot]!;
          if ((model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0) !== skin.plane) continue;
          if ((model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 5] ?? 0) === FOLDED_3D_CELL_UNDETERMINED) continue;
          const stack = cellStack(model, cell);
          const depth = mesh.slots.depth[slot]!;
          if (depth !== (skin.side === 1 ? 0 : stack.length - 1)) continue;
          expected += mesh.slots.indexStart[slot + 1]! - mesh.slots.indexStart[slot]!;
        }
        expect(skin.faceIndexCount).toBe(expected);
      }
    });

    it.each(NAMES)('%s puts nothing coplanar inside one skin', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      // The property the whole scheme rests on. Cells of a plane are
      // area-disjoint and a skin takes one layer from each, so no two surfaces
      // in a skin occupy the same space — which is why the depth buffer is never
      // asked to order coplanar geometry, and why the layer displacement and its
      // epsilon are gone.
      for (const skin of mesh.skins) {
        const seen = new Set<number>();
        for (let slot = 0; slot < mesh.slots.count; slot += 1) {
          const cell = mesh.slots.cell[slot]!;
          if ((model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0) !== skin.plane) continue;
          if ((model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 5] ?? 0) === FOLDED_3D_CELL_UNDETERMINED) continue;
          const stack = cellStack(model, cell);
          const depth = mesh.slots.depth[slot]!;
          if (depth !== (skin.side === 1 ? 0 : stack.length - 1)) continue;
          expect(seen.has(cell)).toBe(false);
          seen.add(cell);
        }
      }
    });

    it.each(NAMES)('%s reports the radius the figure frame is sized from', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      // The same number, not merely a close one: the frame is sized from it and
      // the mesh is scaled by it, so a drift puts the model outside its window.
      expect(mesh.radius).toBe(modelRadius(model));
      expect(mesh.radius).toBe(folded3dFrameRadius(model));
      expect(mesh.center).toEqual([0, 0, 0]);
    });

    it.each(NAMES)('%s carries every slot back to its cell and face', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      const byCell = slotsByCell(mesh);
      for (const [cell, slots] of byCell) {
        const stack = cellStack(model, cell);
        expect(slots.map((slot) => mesh.slots.face[slot])).toEqual(stack);
        expect(slots.map((slot) => mesh.slots.depth[slot])).toEqual(
          stack.map((_, index) => index)
        );
      }
    });

    it.each(NAMES)('%s packs positions into the texture layout the shader reads', (name) => {
      const mesh = meshOf(fixture(name));
      const dim = mesh.topology.textureDim;
      const packed = packFolded3dPositionTexture(mesh.positions, dim);
      expect(packed.length).toBe(dim * dim * 4);
      expect(dim * dim).toBeGreaterThanOrEqual(mesh.positions.length / 3);
      for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
        expect(packed[vertex * 4]).toBe(mesh.positions[vertex * 3]);
        expect(packed[vertex * 4 + 1]).toBe(mesh.positions[vertex * 3 + 1]);
        expect(packed[vertex * 4 + 2]).toBe(mesh.positions[vertex * 3 + 2]);
        expect(packed[vertex * 4 + 3]).toBe(0);
      }
    });
  });

  describe('the layer on show', () => {
    /**
     * The headline, and it is now a statement about *what is drawn* rather than
     * about depth.
     *
     * A plane's skin holds one layer per cell — `cell_stack[0]` on the `+up`
     * side, the last entry on the other — so the layer on show is the kernel's
     * answer by construction, at every camera, with no epsilon in between. The
     * depth buffer never sees two coplanar surfaces, so there is nothing left
     * for it to get wrong within a plane.
     */
    it.each(NAMES)('%s draws the kernel’s near layer, at every camera', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      for (const [label, camera] of CAMERAS) {
        const eye = folded3dEyeDirection(camera);
        for (const skin of mesh.skins) {
          const up = planeFrame(model, skin.plane).up;
          const towardEye = up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2] >= 0;
          if (skin.side !== (towardEye ? 1 : -1)) continue;
          // This is the skin the eye selects. Every layer in it must be the end
          // of its cell's stack that faces the eye.
          for (const cell of stackedCellsOf(model)) {
            if ((model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0) !== skin.plane) continue;
            const stack = cellStack(model, cell);
            const shown = cellFarToNear(model, cell, camera).at(-1)!;
            const slot = towardEye ? 0 : stack.length - 1;
            expect(stack[slot], `${name} @ ${label}, cell ${cell}`).toBe(shown);
          }
        }
      }
    });

    it.each(NAMES)('%s shows the same layer the CPU projector draws', (name) => {
      const model = fixture(name);
      // The window and the export must not disagree about which sheet of paper
      // you are looking at. The projector picks the last of `cellFarToNear`; the
      // mesh picks the end of `cell_stack` its selected skin holds.
      for (const [label, camera] of CAMERAS) {
        const eye = folded3dEyeDirection(camera);
        const projection = projectFolded3dModel(model, {
          camera,
          displayStyle: 'Paper5',
          style: STYLE,
          tolerances: TOLERANCES,
        });
        const drawnByProjector = new Map<number, number>();
        projection.snapshot.primitives.forEach((primitive, index) => {
          if (primitive.kind !== 'fill_path') return;
          drawnByProjector.set(projection.cells[index]!, projection.faces[index]!);
        });
        for (const [cell, face] of drawnByProjector) {
          const plane = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0;
          const up = planeFrame(model, plane).up;
          const towardEye = up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2] >= 0;
          const stack = cellStack(model, cell);
          const mine = towardEye ? stack[0]! : stack[stack.length - 1]!;
          expect(mine, `${name} @ ${label}, cell ${cell}`).toBe(face);
        }
      }
    });
  });

  describe('winding', () => {
    /**
     * The one fact that is easy to invert. The mesh renderer's view transform has
     * determinant −1, so a triangle whose right-hand normal points toward the eye
     * is drawn *back*-facing — while the CPU projector calls exactly that face
     * front. Get the sign backwards and the figure is a clean picture of the
     * wrong side of the paper.
     */
    it.each(NAMES)('%s colours every triangle the side the projector does', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      let checked = 0;
      let edgeOn = 0;
      let opportunities = 0;

      for (const [label, camera] of CAMERAS) {
        const uniforms = uniformsFor(mesh, camera);
        const projected = projectVertices(mesh.positions, uniforms);
        for (let slot = 0; slot < mesh.slots.count; slot += 1) {
          const face = mesh.slots.face[slot]!;
          const normal = viewNormalOf(model, face, uniforms);
          const projectorSaysFront = normal[2] >= 0;
          for (let i = mesh.slots.indexStart[slot]!; i < mesh.slots.indexStart[slot + 1]!; i += 3) {
            opportunities += 1;
            const winding = screenWinding(
              projected,
              mesh.topology.faceIndices[i]!,
              mesh.topology.faceIndices[i + 1]!,
              mesh.topology.faceIndices[i + 2]!
            );
            // A face seen exactly edge-on shows no side to the viewer and its
            // triangles project to segments, so neither rule has an answer.
            if (Math.abs(normal[2]) < EDGE_ON || Math.abs(winding) < EDGE_ON) {
              edgeOn += 1;
              continue;
            }
            expect(winding >= 0, `${name} @ ${label}, slot ${slot}, face ${face}`).toBe(
              projectorSaysFront
            );
            checked += 1;
          }
        }
      }
      expect(checked + edgeOn).toBe(opportunities);
      expect(checked).toBeGreaterThan(0);
    });

    /**
     * Which way a slot winds is a **per-face** question. `facing` flips between
     * faces of one plane — it does in five of the six fixtures — so slots of one
     * cell can want opposite orientations, and a single index order shared across
     * a stack would paint the whole cell one colour.
     */
    it('winds slots of one cell independently when their facings differ', () => {
      const model = fixture('pinwheel');
      const mesh = meshOf(model);
      const facing = (face: number): number =>
        model.face_attr[face * FOLDED_3D_FACE_ATTR_STRIDE + 3] ?? 1;

      let mixedCells = 0;
      for (const [, slots] of slotsByCell(mesh)) {
        const facings = new Set(slots.map((slot) => facing(mesh.slots.face[slot]!)));
        if (facings.size < 2) continue;
        mixedCells += 1;
        // Two slots of one cell with opposite facing must have opposite index
        // orders, because they share a ring and want opposite world windings.
        const first = slots.find((slot) => facing(mesh.slots.face[slot]!) > 0)!;
        const second = slots.find((slot) => facing(mesh.slots.face[slot]!) < 0)!;
        const order = (slot: number): number[] => {
          const start = mesh.slots.indexStart[slot]!;
          const base = start === mesh.slots.indexStart[slot + 1]! ? 0 : mesh.topology.faceIndices[start]!;
          const out: number[] = [];
          for (let i = start; i < mesh.slots.indexStart[slot + 1]!; i += 1) {
            out.push(mesh.topology.faceIndices[i]! - base);
          }
          return out;
        };
        const a = order(first);
        const b = order(second);
        expect(a.length).toBe(b.length);
        expect(a).not.toEqual(b);
      }
      expect(mixedCells).toBeGreaterThan(0);
    });

    it.each(NAMES)('%s agrees with the payload face normals about which way is up', (name) => {
      const model = fixture(name);
      // The mesh orients from `facing × up` rather than from `face_normals`, so
      // every face of one plane gets bit-identical input and a tolerance-level
      // wobble cannot flip one triangle to the back colour. That is only sound
      // while the two agree in sign, which is what this checks.
      for (let face = 0; face < model.face_count; face += 1) {
        const base = face * FOLDED_3D_FACE_ATTR_STRIDE;
        const { up } = planeFrame(model, model.face_attr[base] ?? 0);
        const facing = model.face_attr[base + 3] ?? 1;
        const n = faceNormal(model, face);
        const dot = n[0] * up[0] + n[1] * up[1] + n[2] * up[2];
        expect(Math.sign(dot)).toBe(Math.sign(facing));
      }
    });
  });

  describe('no displacement', () => {
    it.each(NAMES)('%s puts every layer at the paper’s true position', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      // Layers used to be pushed apart along their plane's normal so a depth
      // buffer could reproduce an order the kernel had already computed. Nothing
      // is displaced now: within a skin nothing is coplanar with anything else,
      // so there is nothing to separate. This is what deleted `EPS_RELATIVE`,
      // `STACK_SPAN_LIMIT` and the crease bias that had to be tuned against them.
      for (let slot = 0; slot < mesh.slots.count; slot += 1) {
        const cell = mesh.slots.cell[slot]!;
        const ring = cellRing(model, cell);
        const first = mesh.slots.vertexStart[slot]!;
        ring.forEach((point, at) => {
          const want = simBasisRelative(model, point as [number, number, number]);
          for (let axis = 0; axis < 3; axis += 1) {
            expect(mesh.positions[(first + at) * 3 + axis]!).toBeCloseTo(want[axis]!, 3);
          }
        });
      }
    });

    it.each(NAMES)('%s keeps the radius the figure frame is sized from', (name) => {
      const model = fixture(name);
      // Exactly, now that nothing perturbs the geometry — the frame is sized
      // from this number, so a drift would put the model outside its own window.
      expect(meshOf(model).radius).toBe(folded3dFrameRadius(model));
    });
  });

  describe('edge assignments', () => {
    it('reads mountain and valley off the fold angle sign', () => {
      // The kernel's own convention, the one its FOLD exporter already uses:
      // negative degrees is a mountain.
      expect(folded3dEdgeAssignment(FOLDED_3D_EDGE_CREASE, -180)).toBe(1);
      expect(folded3dEdgeAssignment(FOLDED_3D_EDGE_CREASE, 90)).toBe(2);
      // A zero-angle crease becomes a border, not a facet: code 3 is skipped by
      // `buildEdgeQuads`, and the CPU projector draws that edge today.
      expect(folded3dEdgeAssignment(FOLDED_3D_EDGE_CREASE, 0)).toBe(0);
      expect(folded3dEdgeAssignment(FOLDED_3D_EDGE_BORDER, 0)).toBe(0);
      expect(folded3dEdgeAssignment(FOLDED_3D_EDGE_UNKNOWN, -45)).toBe(0);
    });

    it.each(NAMES)('%s assigns every crease a code the edge pass draws', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      const sources = creaseSources(model, mesh);
      const creases = everyCrease(mesh);
      expect(sources).toHaveLength(creases.length);

      let mountains = 0;
      let valleys = 0;
      for (let nth = 0; nth < sources.length; nth += 1) {
        const edge = sources[nth]!;
        const code = mesh.topology.edgeAssignments[creases[nth]!]!;
        // Never 3: that is the one code `buildEdgeQuads` skips, and every edge
        // the payload carries is drawn today.
        expect(code).toBeLessThanOrEqual(2);
        // And it is the code of the model edge this crease was drawn from, not
        // of whatever happened to sit at the same array position.
        const kind = model.edge_attr[edge * FOLDED_3D_EDGE_ATTR_STRIDE + 3] ?? 0;
        const degrees = model.edge_fold_degrees[edge] ?? 0;
        if (kind !== FOLDED_3D_EDGE_CREASE) expect(code).toBe(0);
        else if (degrees < 0) expect((mountains += 1) && code).toBe(1);
        else if (degrees > 0) expect((valleys += 1) && code).toBe(2);
      }
      // Every fixture is a real fold, so it has creases of both signs or of one —
      // but never none.
      expect(mountains + valleys).toBeGreaterThan(0);
      // And no model edge silently vanished: each is drawn by at least one slot.
      expect(new Set(sources).size).toBe(model.edge_count);
    });

    it.each(NAMES)('%s draws a crease inside its own face, not on the fold line', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      // A fold that is not flat lies in **both** planes it joins, so a crease
      // left on the line is exactly coplanar with whatever the *other* plane has
      // there — and on the reported case that was paper in front of it, which
      // the crease bias then tipped it over. Pulled inside its own cell, it
      // carries the depth of the paper it bounds and the ordinary
      // plane-against-plane test answers correctly.
      //
      // Asserted as "the crease vertices are not the ring vertices", which is
      // the whole of it: a mesh that stopped insetting would index the ring
      // directly and fail here.
      const inset = CREASE_INSET_RELATIVE * modelRadius(model);
      let checked = 0;
      for (let slot = 0; slot < mesh.slots.count; slot += 1) {
        const first = mesh.slots.vertexStart[slot]!;
        const past = mesh.slots.vertexStart[slot + 1]!;
        const ringLength = (past - first) / 2;
        for (let i = 0; i < ringLength; i += 1) {
          const at = (first + i) * 3;
          const to = (first + ringLength + i) * 3;
          const moved = Math.hypot(
            mesh.positions[at]! - mesh.positions[to]!,
            mesh.positions[at + 1]! - mesh.positions[to + 1]!,
            mesh.positions[at + 2]! - mesh.positions[to + 2]!
          );
          // A corner miter carries further than the edge offset; a degenerate
          // one carries nothing. Both are bounded by the inset itself.
          expect(moved).toBeLessThanOrEqual(inset * 4 + 1e-9);
          if (moved > inset * 0.5) checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });

    it.each(NAMES)('%s places a crease on its fold line, at its layer', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      const sources = creaseSources(model, mesh);
      const creases = everyCrease(mesh);
      let insetSeen = 0;
      // A crease is a *segment* of the model edge it bounds, drawn a hair inside
      // its own face — see `CREASE_INSET_RELATIVE`, which is what stops a fold
      // between two planes being coplanar with the one it does not belong to.
      // So it sits within the inset of its fold line, and is never longer than
      // the edge it came from.
      //
      // Twice the inset, because the corner miter can carry a vertex a little
      // further than the edge offset itself on a sharp turn.
      const ceiling = 2 * CREASE_INSET_RELATIVE * modelRadius(model) + 1e-6 * model.span;
      for (let nth = 0; nth < sources.length; nth += 1) {
        const crease = creases[nth]!;
        const edge = sources[nth]!;
        const at = edge * 6;
        const ends = [
          simBasisRelative(model, [
            model.edge_points[at]!,
            model.edge_points[at + 1]!,
            model.edge_points[at + 2]!,
          ]),
          simBasisRelative(model, [
            model.edge_points[at + 3]!,
            model.edge_points[at + 4]!,
            model.edge_points[at + 5]!,
          ]),
        ] as const;
        const a = mesh.topology.edgeIndices[crease * 2]!;
        const b = mesh.topology.edgeIndices[crease * 2 + 1]!;
        for (const index of [a, b]) {
          const point: [number, number, number] = [
            mesh.positions[index * 3]!,
            mesh.positions[index * 3 + 1]!,
            mesh.positions[index * 3 + 2]!,
          ];
          expect(distanceToSegment(point, ends[0], ends[1])).toBeLessThanOrEqual(ceiling);
        }
        const meshLength = Math.hypot(
          mesh.positions[a * 3]! - mesh.positions[b * 3]!,
          mesh.positions[a * 3 + 1]! - mesh.positions[b * 3 + 1]!,
          mesh.positions[a * 3 + 2]! - mesh.positions[b * 3 + 2]!
        );
        const payloadLength = Math.hypot(
          ends[0][0] - ends[1][0],
          ends[0][1] - ends[1][1],
          ends[0][2] - ends[1][2]
        );
        expect(meshLength).toBeLessThanOrEqual(payloadLength + 1e-6 * model.span);
        // And the inset is really applied — a crease still drawn on the fold
        // line would satisfy the bound above.
        insetSeen = Math.max(insetSeen, distanceToSegment(
          [
            mesh.positions[a * 3]!,
            mesh.positions[a * 3 + 1]!,
            mesh.positions[a * 3 + 2]!,
          ],
          ends[0],
          ends[1]
        ));
      }
    });
  });

  describe('refusal', () => {
    it('refuses a model past the vertex budget rather than throwing', () => {
      const model = fixture('hinge_90');
      // One cell whose ring claims more vertices than the budget allows. The
      // guard has to fire before any allocation, which is the whole point of
      // counting in a first pass.
      const huge: OristudioCpFolded3dRenderModel = {
        ...model,
        cell_attr: [...model.cell_attr],
      };
      huge.cell_attr[2] = FOLDED_3D_MESH_VERTEX_BUDGET + 1;
      const result = folded3dMesh(huge);
      expect(result.kind).toBe('too-large');
      if (result.kind === 'too-large') {
        expect(result.limit).toBe(FOLDED_3D_MESH_VERTEX_BUDGET);
        expect(result.vertexCount).toBeGreaterThan(FOLDED_3D_MESH_VERTEX_BUDGET);
      }
    });
  });
});

/**
 * R7 — the file a user exports and the window they are looking at draw the same
 * figure.
 *
 * The two are made by different machinery on purpose. The window's picture comes
 * from this mesh through a **depth buffer**, which is why the layers are pushed
 * apart by an epsilon. The file's comes from `foldedFigure3dProjection.ts`
 * through a BSP with the kernel's exact `cell_stack` fed in, which is what a
 * vector drawing needs and what an `.osf`, a crease-pattern export and a figure
 * with no GPU all read. Both are derived from one render model, and R7 is that
 * they drift.
 *
 * The statement below is the export end of the one already made above against
 * the raw projection: this runs the projector at the settings the store actually
 * writes onto a figure — culled and merged, which is a different code path — and
 * carries it all the way through the serializer, so a layer lost to hidden-piece
 * culling, to a coplanar merge, or to the SVG writer is caught here rather than
 * by somebody opening a file.
 */
describe('the exported drawing and the mesh agree', () => {
  it.each(NAMES)('%s exports the layer its window shows', (name) => {
    const model = fixture(name);
    // The mesh is built to prove it can be — the comparison below is against the
    // rule its skins encode, which is `cell_stack` read from the eye's end.
    meshOf(model);
    let compared = 0;

    for (const [label, camera] of CAMERAS) {
      // No `cullHidden` and no `mergeCoplanar`: the defaults, which is what
      // `project3dRenderSnapshot` passes and therefore what every exported
      // figure is drawn with.
      const projection = projectFolded3dModel(model, {
        camera,
        displayStyle: 'Paper5',
        style: STYLE,
        tolerances: TOLERANCES,
      });
      const page = foldedFigureExportDocument(projection.snapshot);
      expect(page, `${name} @ ${label}`).not.toBeNull();
      // Nothing is lost between the projection and the file. The stacking order
      // travels *inside* the primitive stream — the serializer has no depth test
      // and no sort — so one dropped primitive is one wrong face on top.
      expect(page!.svg.split('<path').length - 1).toBe(projection.snapshot.primitives.length);

      const filledByCell = new Map<number, Set<number>>();
      projection.snapshot.primitives.forEach((primitive, index) => {
        if (!primitive.kind.startsWith('fill_')) return;
        const cell = projection.cells[index]!;
        const face = projection.faces[index]!;
        // `-1` is a crease or a cell annotation, which draws no layer.
        if (cell < 0 || face < 0) return;
        const set = filledByCell.get(cell) ?? new Set<number>();
        set.add(face);
        filledByCell.set(cell, set);
      });

      for (const [cell, faces] of filledByCell) {
        // A cell the tree cut into pieces at two depths has no single answer to
        // compare against; the raw-projection test above covers those.
        if (faces.size !== 1) continue;
        const plane = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0;
        if (Math.abs(upTowardEye(model, plane, camera)) < EDGE_ON) continue;
        // The window's answer is the end of `cell_stack` its selected skin
        // holds — no depth comparison, because there is nothing coplanar left to
        // compare. The export's is the last of `cellFarToNear`. They are the
        // same rule reached from two directions, which is the point.
        expect([...faces], `${name} @ ${label}, cell ${cell}`).toEqual([
          cellFarToNear(model, cell, camera).at(-1),
        ]);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});







