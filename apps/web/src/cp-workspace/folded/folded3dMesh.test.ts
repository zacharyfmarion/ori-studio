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
  EPS_RELATIVE,
  FOLDED_3D_MESH_VERTEX_BUDGET,
  STACK_SPAN_LIMIT,
  folded3dEdgeAssignment,
  folded3dLayerEpsilon,
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
  FOLDED_3D_CELL_DETERMINED,
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
function creaseSources(
  model: OristudioCpFolded3dRenderModel,
  mesh: Folded3dMesh
): number[] {
  const ink = buildFolded3dInk(model);
  // Each slot's inked segments, in ring order — the order the builder emits them.
  const perSlot = new Map<number, number[]>();
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    const cell = mesh.slots.cell[slot]!;
    const segments = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 2] ?? 0;
    const inked: number[] = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const edge = ink.edgeAt(cell, mesh.slots.depth[slot]!, segment);
      if (edge >= 0) inked.push(edge);
    }
    perSlot.set(slot, inked);
  }
  const cursor = new Map<number, number>();
  const sources: number[] = [];
  for (let crease = 0; crease < mesh.creaseSlot.length; crease += 1) {
    const slot = mesh.creaseSlot[crease]!;
    if (slot < 0) {
      sources.push(ink.orphanEdges[crease]!);
      continue;
    }
    const at = cursor.get(slot) ?? 0;
    cursor.set(slot, at + 1);
    sources.push(perSlot.get(slot)![at]!);
  }
  return sources;
}

/** Whether a slot is buried between the top and bottom of its own stack. */
function isInterior(mesh: Folded3dMesh, slot: number): boolean {
  const cell = mesh.slots.cell[slot]!;
  let last = slot;
  while (last + 1 < mesh.slots.count && mesh.slots.cell[last + 1] === cell) last += 1;
  const depth = mesh.slots.depth[slot]!;
  return depth > 0 && depth < mesh.slots.depth[last]!;
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
 * Mean view depth per slot — the quantity the depth test compares, and larger is
 * nearer the eye (the shader writes `z = −depth/depthRange` under `LEQUAL`).
 *
 * The mean over a slot's *indices* rather than its distinct vertices, which is
 * exact for this comparison: slots of one cell share one triangulation, so they
 * share the index pattern too, and the difference between two slots' means is
 * exactly their displacement projected onto the eye direction.
 */
function slotDepths(mesh: Folded3dMesh, projected: ProjectedVertices): number[] {
  const out: number[] = [];
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    const start = mesh.slots.indexStart[slot]!;
    const end = mesh.slots.indexStart[slot + 1]!;
    let total = 0;
    for (let i = start; i < end; i += 1) {
      total += projected.view[mesh.topology.faceIndices[i]! * 3 + 2]!;
    }
    out.push(end > start ? total / (end - start) : Number.NaN);
  }
  return out;
}

/** Slot indices belonging to each cell, in emission order. */
function slotsByCell(mesh: Folded3dMesh): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    const cell = mesh.slots.cell[slot]!;
    const list = out.get(cell);
    if (list) list.push(slot);
    else out.set(cell, [slot]);
  }
  return out;
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
        expectedVertices += ring * stack;
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
      // Every crease names the layer it belongs to, and the fallback block at
      // the head names none.
      expect(mesh.topology.edgeIndices.length).toBe(
        mesh.topology.edgeAssignments.length * 2
      );
      expect(mesh.creaseSlot.length).toBe(mesh.topology.edgeAssignments.length);
      for (let crease = 0; crease < mesh.fallbackEdgeCount; crease += 1) {
        expect(mesh.creaseSlot[crease]).toBe(-1);
      }
      for (const slot of mesh.creaseSlot.subarray(mesh.fallbackEdgeCount)) {
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(mesh.slots.count);
      }
      expect(mesh.interiorEdgeStart).toBeLessThanOrEqual(
        mesh.topology.edgeAssignments.length
      );
    });

    it.each(NAMES)('%s keeps a buried layer’s creases out of the opaque draw', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      // The property the reported minimal case turned on. A cell is covered by
      // every face in its stack, so a layer that is neither top nor bottom is
      // behind the top from one side and behind the bottom from the other, at
      // *every* camera — it can never be on show through opaque paper.
      //
      // It cannot be left to the depth buffer either: a crease lies on a cell
      // boundary by construction, which is exactly where the covering face's
      // displacement steps, because `((n − 1) / 2 − slot) · eps` reads the
      // *cell's* stack depth. The same face is a full layer nearer as the top of
      // a deep cell than as the only layer of the cell next door, and a buried
      // crease sits in that step.
      for (let crease = 0; crease < mesh.interiorEdgeStart; crease += 1) {
        const slot = mesh.creaseSlot[crease]!;
        if (slot < 0) continue;
        expect(isInterior(mesh, slot)).toBe(false);
      }
      // And they are held back rather than dropped: a translucent style shows
      // the whole stack and draws them, exactly as the CPU projector does.
      const buried = [...mesh.creaseSlot.subarray(mesh.interiorEdgeStart)];
      for (const slot of buried) expect(isInterior(mesh, slot)).toBe(true);
      const anyDeepStack = [...mesh.slots.depth].some((depth) => depth > 1);
      if (anyDeepStack) expect(buried.length).toBeGreaterThan(0);
    });

    it.each(NAMES)('%s draws a crease from the ring of the layer it bounds', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      // Both ends of an emitted crease are ring vertices of the slot that owns
      // it — that is the whole mechanism, and it is what gives the crease the
      // depth of its own paper instead of the depth of the fold line.
      for (let crease = 0; crease < mesh.creaseSlot.length; crease += 1) {
        const slot = mesh.creaseSlot[crease]!;
        if (slot < 0) continue;
        const first = mesh.slots.vertexStart[slot]!;
        const past = mesh.slots.vertexStart[slot + 1]!;
        for (const index of [
          mesh.topology.edgeIndices[crease * 2]!,
          mesh.topology.edgeIndices[crease * 2 + 1]!,
        ]) {
          expect(index).toBeGreaterThanOrEqual(first);
          expect(index).toBeLessThan(past);
        }
      }
    });

    it.each(NAMES)('%s draws no crease at a layer whose paper runs across it', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      // A layer can only end at segments of its own cell's ring, so its crease
      // count is bounded by the ring — and is strictly under it wherever the
      // arrangement was cut by some *other* face lying over this one.
      const perSlot = new Int32Array(mesh.slots.count);
      for (const slot of mesh.creaseSlot) if (slot >= 0) perSlot[slot]! += 1;
      let slotsWithFewerCreasesThanSegments = 0;
      for (let slot = 0; slot < mesh.slots.count; slot += 1) {
        const cell = mesh.slots.cell[slot]!;
        const segments = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 2] ?? 0;
        expect(perSlot[slot]!).toBeLessThanOrEqual(segments);
        if (perSlot[slot]! < segments) slotsWithFewerCreasesThanSegments += 1;
      }
      // `hinge_90` overlaps nothing and `strip_coupled`'s panels coincide
      // *exactly*, so in both every layer really does end at every segment of
      // its ring and inking all of them is the right answer. The other four have
      // partial overlap, which is the case the old mesh got wrong: without this
      // the ink could be "always yes" and every bound above would still hold.
      const partiallyOverlapping = name !== 'hinge_90' && name !== 'strip_coupled';
      if (partiallyOverlapping) expect(slotsWithFewerCreasesThanSegments).toBeGreaterThan(0);
      else expect(slotsWithFewerCreasesThanSegments).toBe(0);
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

  describe('layer order on screen', () => {
    /**
     * The headline. For every cell of every fixture, at five cameras, the order
     * the depth buffer will resolve its slots into is the kernel's `cell_stack`,
     * read from whichever end the eye is on.
     */
    it.each(NAMES)('%s resolves every stack the way the kernel ordered it', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      let checked = 0;
      let edgeOn = 0;
      let opportunities = 0;

      for (const [label, camera] of CAMERAS) {
        const uniforms = uniformsFor(mesh, camera);
        const projected = projectVertices(mesh.positions, uniforms);
        const depths = slotDepths(mesh, projected);

        for (const [cell, slots] of slotsByCell(mesh)) {
          if (slots.length < 2) continue;
          opportunities += 1;
          const plane = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0;
          const alignment = upTowardEye(model, plane, camera);
          // A plane seen exactly edge-on projects to a line: its layers are at
          // the same depth and there is no order to resolve. Real, not rare —
          // `box_90`'s plane 1 is exactly edge-on at the antipodal camera — and
          // skipped rather than fudged. The accounting below is what stops the
          // skip from quietly emptying the test.
          if (Math.abs(alignment) < EDGE_ON) {
            edgeOn += 1;
            continue;
          }

          const nearToFar = [...slots].sort((l, r) => depths[r]! - depths[l]!);
          const expected = alignment > 0 ? slots : [...slots].reverse();
          expect(
            nearToFar.map((slot) => mesh.slots.face[slot]),
            `${name} @ ${label}, cell ${cell}`
          ).toEqual(expected.map((slot) => mesh.slots.face[slot]));
          checked += 1;
        }
      }

      expect(checked + edgeOn).toBe(opportunities);
      // The two-face hinge has no stack at all, and is in the fixture set for
      // other reasons; everything else must actually have been checked.
      if (name === 'hinge_90') expect(opportunities).toBe(0);
      else expect(checked).toBeGreaterThan(0);
    });

    /**
     * The same statement against the path that already ships. The CPU projector
     * picks one layer per cell with an explicit `upTowardEye` test and a BSP; the
     * mesh picks one with a depth buffer. R6 is that these two drift, and this is
     * the assertion that they cannot.
     */
    it.each(NAMES)('%s shows the same layer the CPU projector draws', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      let compared = 0;

      for (const [label, camera] of CAMERAS) {
        const projection = projectFolded3dModel(model, {
          camera,
          displayStyle: 'Paper5',
          style: STYLE,
          tolerances: TOLERANCES,
          cullHidden: false,
          mergeCoplanar: false,
        });
        const drawnByCell = new Map<number, Set<number>>();
        projection.faces.forEach((face, index) => {
          const cell = projection.cells[index]!;
          if (cell < 0 || face < 0) return;
          const set = drawnByCell.get(cell) ?? new Set<number>();
          set.add(face);
          drawnByCell.set(cell, set);
        });

        const uniforms = uniformsFor(mesh, camera);
        const depths = slotDepths(mesh, projectVertices(mesh.positions, uniforms));
        for (const [cell, slots] of slotsByCell(mesh)) {
          const drawn = drawnByCell.get(cell);
          if (!drawn || drawn.size !== 1) continue;
          const plane = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0;
          if (Math.abs(upTowardEye(model, plane, camera)) < EDGE_ON) continue;
          const nearest = slots.reduce((best, slot) =>
            depths[slot]! > depths[best]! ? slot : best
          );
          expect([...drawn], `${name} @ ${label}, cell ${cell}`).toEqual([
            mesh.slots.face[nearest],
          ]);
          compared += 1;
        }
      }
      expect(compared).toBeGreaterThan(0);
    });

    /**
     * The gap between adjacent layers is exactly one epsilon, projected onto the
     * eye — which is what makes {@link folded3dLayerEpsilon}'s depth-budget
     * arithmetic a statement about this mesh rather than about a formula.
     */
    it.each(NAMES)('%s separates adjacent layers by exactly one epsilon', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      let checked = 0;

      for (const [label, camera] of CAMERAS) {
        const uniforms = uniformsFor(mesh, camera);
        const depths = slotDepths(mesh, projectVertices(mesh.positions, uniforms));
        for (const [cell, slots] of slotsByCell(mesh)) {
          if (slots.length < 2) continue;
          const plane = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0;
          const alignment = upTowardEye(model, plane, camera);
          if (Math.abs(alignment) < EDGE_ON) continue;
          const wanted = mesh.eps * alignment;
          for (let i = 1; i < slots.length; i += 1) {
            const gap = depths[slots[i - 1]!]! - depths[slots[i]!]!;
            // Ratio rather than absolute: positions are f32, so a gap four
            // orders below the coordinates it is measured from carries a few
            // parts in a thousand of rounding.
            expect(gap / wanted, `${name} @ ${label}, cell ${cell}, gap ${i}`).toBeCloseTo(
              1,
              2
            );
            checked += 1;
          }
        }
      }
      if (name === 'hinge_90') expect(checked).toBe(0);
      else expect(checked).toBeGreaterThan(0);
    });

    /**
     * `pinwheel_cyclic` is the fixture no per-face height can express: its layer
     * relations close a loop, `0 > 4 > 3 > 2 > 0`. Per-cell displacement needs no
     * global order, so it holds every one of those relations at once — which a
     * renderer that topologically sorted could not.
     */
    it('reproduces a cyclic layer order without sorting it', () => {
      const cyclic = fixture('pinwheel_cyclic');
      const acyclic = fixture('pinwheel');
      // First, that the fixtures are what they claim: the pair is only meaningful
      // if one has a cycle and the other does not.
      expect(hasCycle(relations(cyclic))).toBe(true);
      expect(hasCycle(relations(acyclic))).toBe(false);

      const mesh = meshOf(cyclic);
      let checked = 0;
      for (const [label, camera] of CAMERAS) {
        const uniforms = uniformsFor(mesh, camera);
        const depths = slotDepths(mesh, projectVertices(mesh.positions, uniforms));
        for (const [cell, slots] of slotsByCell(mesh)) {
          const plane = cyclic.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0;
          const alignment = upTowardEye(cyclic, plane, camera);
          if (Math.abs(alignment) < 1e-6) continue;
          // Every "above" relation this cell states, held on screen: `above` is
          // nearer the eye exactly when the eye is on the `+up` side.
          for (let i = 0; i < slots.length; i += 1) {
            for (let j = i + 1; j < slots.length; j += 1) {
              const upper = depths[slots[i]!]!;
              const lower = depths[slots[j]!]!;
              expect(
                alignment > 0 ? upper > lower : upper < lower,
                `${label}, cell ${cell}, slots ${i} over ${j}`
              ).toBe(true);
              checked += 1;
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(50);
    });

    /**
     * `strip_coupled` puts one coupled ordering component across **two** planes,
     * whose `up` vectors differ. Each cell is displaced along its own plane's
     * normal, so a camera that sees one plane from the `+up` side and the other
     * from `−up` still resolves both — the case a single global "up" would get
     * right half the time.
     */
    it('displaces coupled planes along their own normals', () => {
      const model = fixture('strip_coupled');
      const mesh = meshOf(model);
      const disagreeing = CAMERAS.filter(([, camera]) => {
        const signs = new Set<boolean>();
        for (let plane = 0; plane < model.plane_count; plane += 1) {
          signs.add(upTowardEye(model, plane, camera) > 0);
        }
        return signs.size > 1;
      });
      expect(disagreeing.length).toBeGreaterThan(0);

      for (const [label, camera] of disagreeing) {
        const uniforms = uniformsFor(mesh, camera);
        const depths = slotDepths(mesh, projectVertices(mesh.positions, uniforms));
        for (const [cell, slots] of slotsByCell(mesh)) {
          if (slots.length < 2) continue;
          const plane = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0;
          const alignment = upTowardEye(model, plane, camera);
          const nearToFar = [...slots].sort((l, r) => depths[r]! - depths[l]!);
          const expected = alignment > 0 ? slots : [...slots].reverse();
          expect(nearToFar, `${label}, cell ${cell}`).toEqual(expected);
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

  describe('displacement', () => {
    /**
     * What actually landed in the vertices, read back rather than assumed: each
     * slot's ring against the payload's, which gives the displacement applied to
     * it as a vector.
     *
     * Stated as properties rather than by re-running the formula — the formula
     * would agree with itself by construction.
     */
    it.each(NAMES)('%s displaces every slot along its own plane normal', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      const offsets = slotOffsets(model, mesh);
      let stacked = 0;

      for (const [cell, slots] of slotsByCell(mesh)) {
        const { up } = planeFrame(model, model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0);
        const rank = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 6] ?? 0;

        for (const slot of slots) {
          const shift = offsets[slot]!;
          // Along `up` and nothing else: the component perpendicular to it must
          // vanish, or the layer has slid across its own plane.
          const along = shift[0] * up[0] + shift[1] * up[1] + shift[2] * up[2];
          const perpendicular = Math.hypot(
            shift[0] - along * up[0],
            shift[1] - along * up[1],
            shift[2] - along * up[2]
          );
          expect(perpendicular).toBeLessThan(recoveryTolerance(mesh));
        }

        const along = slots.map((slot) => {
          const shift = offsets[slot]!;
          return shift[0] * up[0] + shift[1] * up[1] + shift[2] * up[2];
        });

        // Centred on the plane: the mean displacement is the intra-plane rank
        // nudge and nothing more, so the stack keeps the centroid and radius the
        // figure's frame was sized from. An uncentred stack would slide a deep
        // plane bodily to one side.
        const mean = along.reduce((total, value) => total + value, 0) / along.length;
        expect(Math.abs(mean - rank * rankNudgeOf(mesh, model))).toBeLessThan(
          recoveryTolerance(mesh)
        );

        if (slots.length < 2) continue;
        stacked += 1;
        // Top-of-plane first, one epsilon apart, monotonically.
        for (let i = 1; i < along.length; i += 1) {
          expect(Math.abs(along[i - 1]! - along[i]! - mesh.eps)).toBeLessThan(
            recoveryTolerance(mesh)
          );
        }
      }
      if (name === 'hinge_90') expect(stacked).toBe(0);
      else expect(stacked).toBeGreaterThan(0);
    });

    /**
     * `draw_rank` is the kernel's order among the cells of one plane, and where a
     * decomposition slips a containment through it is the only thing that puts
     * the contained cell on top. It must be present, and it must be far too small
     * to reorder any stack.
     */
    it('nudges cells of one plane by their draw rank, well inside one layer gap', () => {
      const model = fixture('pinwheel');
      const mesh = meshOf(model);
      const offsets = slotOffsets(model, mesh);
      const byRank = new Map<number, number>();
      let maxRank = 0;

      for (const [cell, slots] of slotsByCell(mesh)) {
        const { up } = planeFrame(model, model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0);
        const rank = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 6] ?? 0;
        maxRank = Math.max(maxRank, rank);
        const mean =
          slots.reduce((total, slot) => {
            const shift = offsets[slot]!;
            return total + shift[0] * up[0] + shift[1] * up[1] + shift[2] * up[2];
          }, 0) / slots.length;
        byRank.set(rank, mean);
      }

      expect(maxRank).toBeGreaterThan(0);
      // Present: a higher-ranked cell sits further along `+up`.
      for (let rank = 1; rank <= maxRank; rank += 1) {
        expect(byRank.get(rank)!).toBeGreaterThan(byRank.get(rank - 1)!);
      }
      // And bounded: every rank offset together is a small fraction of one layer
      // gap, so it can never reorder a stack.
      expect(byRank.get(maxRank)! - byRank.get(0)!).toBeLessThan(mesh.eps * 0.06);
    });

    it('caps a deep stack inside the crease pass depth bias', () => {
      // A stack spanning more than the edge shader's fixed -0.0008 NDC bias
      // swallows its own top layer's creases. The cap only bites past 5 layers,
      // which is why no committed fixture exercises it and the corpus maximum —
      // 14, on plant_penguin.osf — is stated here instead.
      const radius = 100;
      expect(folded3dLayerEpsilon(radius, 1)).toBe(EPS_RELATIVE * radius);
      expect(folded3dLayerEpsilon(radius, 5)).toBe(EPS_RELATIVE * radius);
      expect(folded3dLayerEpsilon(radius, 6)).toBeLessThan(EPS_RELATIVE * radius);

      for (const depth of [1, 2, 5, 6, 10, 14, 60]) {
        const eps = folded3dLayerEpsilon(radius, depth);
        const span = eps * Math.max(0, depth - 1);
        expect(span).toBeLessThanOrEqual(STACK_SPAN_LIMIT * radius + 1e-12);
      }
      // The corpus's deepest model still resolves comfortably at 24 bits.
      const deepest = folded3dLayerEpsilon(radius, 14);
      expect((deepest / (4 * radius)) * 2 ** 24).toBeGreaterThan(200);
    });

    it.each(NAMES)('%s uses the epsilon its own deepest stack asks for', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      let deepest = 0;
      for (let cell = 0; cell < model.cell_count; cell += 1) {
        deepest = Math.max(deepest, model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 4] ?? 0);
      }
      expect(mesh.maxStackDepth).toBe(deepest);
      expect(mesh.eps).toBe(folded3dLayerEpsilon(mesh.radius, deepest));
    });

    /**
     * No fixture has an undetermined cell — the kernel ordered all six — so this
     * flips the determinacy flag on a real payload rather than inventing
     * geometry. The flag is the only input the rule reads.
     */
    it('leaves an undetermined cell undisplaced, and emits it last', () => {
      const model = fixture('box_90');
      const deep = deepestCell(model);
      const marked: OristudioCpFolded3dRenderModel = {
        ...model,
        cell_attr: [...model.cell_attr],
        undetermined_cells: 1,
      };
      marked.cell_attr[deep * FOLDED_3D_CELL_ATTR_STRIDE + 5] = FOLDED_3D_CELL_UNDETERMINED;

      const before = meshOf(model);
      const after = meshOf(marked);
      expect(after.slots.count).toBe(before.slots.count);

      // Last, and reported.
      const stackLength = cellStack(model, deep).length;
      expect(after.undeterminedSlotStart).toBe(after.slots.count - stackLength);
      for (let slot = after.undeterminedSlotStart; slot < after.slots.count; slot += 1) {
        expect(after.slots.cell[slot]).toBe(deep);
      }
      expect(after.undeterminedIndexStart).toBe(
        after.slots.indexStart[after.undeterminedSlotStart]
      );

      // Undisplaced: every slot of that cell sits exactly on the payload's ring.
      // Asserted on the emitted geometry, not through a camera — the marked cell
      // is on a plane that happens to be edge-on to the face-on view, where every
      // displacement projects to zero and the assertion would hold either way.
      const offsets = slotOffsets(marked, after);
      const slots = slotsByCell(after).get(deep)!;
      expect(slots.length).toBe(stackLength);
      expect(stackLength).toBeGreaterThan(1);
      for (const slot of slots) {
        expect(Math.hypot(...offsets[slot]!)).toBeLessThan(recoveryTolerance(after));
      }

      // And every *other* cell is displaced exactly as it was.
      const beforeOffsets = slotOffsets(model, before);
      for (const [cell, otherSlots] of slotsByCell(before)) {
        if (cell === deep) continue;
        const nowSlots = slotsByCell(after).get(cell)!;
        expect(nowSlots.length).toBe(otherSlots.length);
        for (let i = 0; i < otherSlots.length; i += 1) {
          const now = offsets[nowSlots[i]!]!;
          const then = beforeOffsets[otherSlots[i]!]!;
          expect(Math.hypot(now[0] - then[0], now[1] - then[1], now[2] - then[2])).toBeLessThan(
            recoveryTolerance(after)
          );
        }
      }
    });

    it('reports every cell as determined when the payload does', () => {
      for (const name of NAMES) {
        const model = fixture(name);
        for (let cell = 0; cell < model.cell_count; cell += 1) {
          expect(model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 5]).toBe(
            FOLDED_3D_CELL_DETERMINED
          );
        }
        const mesh = meshOf(model);
        expect(mesh.undeterminedSlotStart).toBe(mesh.slots.count);
        expect(mesh.undeterminedIndexStart).toBe(mesh.topology.faceIndices.length);
      }
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
      expect(sources).toHaveLength(mesh.topology.edgeAssignments.length);

      let mountains = 0;
      let valleys = 0;
      for (let crease = 0; crease < sources.length; crease += 1) {
        const edge = sources[crease]!;
        const code = mesh.topology.edgeAssignments[crease]!;
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

    it.each(NAMES)('%s places a crease on its fold line, at its layer', (name) => {
      const model = fixture(name);
      const mesh = meshOf(model);
      const sources = creaseSources(model, mesh);
      // A crease is a *segment* of the model edge it bounds, lifted onto its own
      // layer. So it lies within the ply of the fold line — never beyond it, and
      // never longer than the edge it came from.
      //
      // The whole ply plus the draw-rank nudge (`RANK_NUDGE_FRACTION`, 5% of a
      // gap) is the ceiling; a crease further out than that is attached to the
      // wrong edge, which is the failure this replaces "endpoints are exact"
      // with.
      const ceiling = mesh.eps * mesh.maxStackDepth + 1e-6 * model.span;
      let displaced = 0;
      for (let crease = 0; crease < sources.length; crease += 1) {
        const edge = sources[crease]!;
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
          const off = distanceToSegment(point, ends[0], ends[1]);
          expect(off).toBeLessThanOrEqual(ceiling);
          if (off > 1e-9 * model.span) displaced += 1;
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
      }
      // And the displacement is really applied — a mesh that still drew creases
      // at the fold line would satisfy every bound above.
      if ([...mesh.slots.depth].some((depth) => depth > 0)) {
        expect(displaced).toBeGreaterThan(0);
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
    const mesh = meshOf(model);
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

      const depths = slotDepths(mesh, projectVertices(mesh.positions, uniformsFor(mesh, camera)));
      const slotsOf = slotsByCell(mesh);
      for (const [cell, faces] of filledByCell) {
        // A cell the tree cut into pieces at two depths has no single answer to
        // compare against; the raw-projection test above covers those.
        if (faces.size !== 1) continue;
        const plane = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0;
        if (Math.abs(upTowardEye(model, plane, camera)) < EDGE_ON) continue;
        const cellSlots = slotsOf.get(cell);
        if (!cellSlots) throw new Error(`${name}: cell ${cell} is exported but has no slot`);
        const nearest = cellSlots.reduce((best, slot) =>
          depths[slot]! > depths[best]! ? slot : best
        );
        expect([...faces], `${name} @ ${label}, cell ${cell}`).toEqual([
          mesh.slots.face[nearest],
        ]);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});

/**
 * The displacement applied to each slot, in kernel world coordinates.
 *
 * Read back from the emitted vertices rather than recomputed: a slot's ring is
 * the payload's ring plus a constant shift, so differencing the two recovers the
 * shift the builder actually applied. `toSimBasis` is a proper rotation, so
 * undoing it is exact.
 */
function slotOffsets(
  model: OristudioCpFolded3dRenderModel,
  mesh: Folded3dMesh
): Array<[number, number, number]> {
  const centre = modelCentroidWorld(model);
  const out: Array<[number, number, number]> = [];
  for (let slot = 0; slot < mesh.slots.count; slot += 1) {
    const ring = cellRing(model, mesh.slots.cell[slot]!);
    const start = mesh.slots.vertexStart[slot]!;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < ring.length; i += 1) {
      // Positions are `toSimBasis(world − centroid)` = `(x, z, −y)`, so the
      // inverse is `(sx, −sz, sy)`.
      const sx = mesh.positions[(start + i) * 3]!;
      const sy = mesh.positions[(start + i) * 3 + 1]!;
      const sz = mesh.positions[(start + i) * 3 + 2]!;
      x += sx - (ring[i]![0] - centre[0]);
      y += -sz - (ring[i]![1] - centre[1]);
      z += sy - (ring[i]![2] - centre[2]);
    }
    out.push([x / ring.length, y / ring.length, z / ring.length]);
  }
  return out;
}

/**
 * The noise floor of {@link slotOffsets}, in world units.
 *
 * `positions` is f32, and an offset is recovered by differencing it against the
 * payload's f64 ring, so the error is a few ULP at the model's own scale. Two
 * orders below `eps` even on the corpus's deepest stack, so it discriminates:
 * anything this test is looking for — a missing displacement, an inverted sign,
 * a slide across the plane — is hundreds of times larger.
 */
function recoveryTolerance(mesh: Folded3dMesh): number {
  return mesh.radius * 2 ** -22;
}

function modelCentroidWorld(model: OristudioCpFolded3dRenderModel): [number, number, number] {
  const count = Math.floor(model.cell_points.length / 3);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < count; i += 1) {
    x += model.cell_points[i * 3] ?? 0;
    y += model.cell_points[i * 3 + 1] ?? 0;
    z += model.cell_points[i * 3 + 2] ?? 0;
  }
  return count === 0 ? [0, 0, 0] : [x / count, y / count, z / count];
}

function rankNudgeOf(mesh: Folded3dMesh, model: OristudioCpFolded3dRenderModel): number {
  let maxRank = 0;
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    maxRank = Math.max(maxRank, model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 6] ?? 0);
  }
  return (mesh.eps * 0.05) / Math.max(1, maxRank);
}

/** The deepest-stacked cell, which is the most informative one to mark. */
function deepestCell(model: OristudioCpFolded3dRenderModel): number {
  let best = 0;
  let depth = -1;
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const length = model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 4] ?? 0;
    if (length > depth) {
      depth = length;
      best = cell;
    }
  }
  return best;
}

/** Every "face a is above face b" the payload's cell stacks state. */
function relations(model: OristudioCpFolded3dRenderModel): Map<number, Set<number>> {
  const above = new Map<number, Set<number>>();
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const stack = cellStack(model, cell);
    for (let i = 0; i < stack.length; i += 1) {
      for (let j = i + 1; j < stack.length; j += 1) {
        const set = above.get(stack[i]!) ?? new Set<number>();
        set.add(stack[j]!);
        above.set(stack[i]!, set);
      }
    }
  }
  return above;
}

function hasCycle(above: Map<number, Set<number>>): boolean {
  const state = new Map<number, number>();
  const visit = (node: number): boolean => {
    const mark = state.get(node) ?? 0;
    if (mark === 1) return true;
    if (mark === 2) return false;
    state.set(node, 1);
    for (const next of above.get(node) ?? []) {
      if (visit(next)) return true;
    }
    state.set(node, 2);
    return false;
  };
  for (const node of above.keys()) {
    if (visit(node)) return true;
  }
  return false;
}
