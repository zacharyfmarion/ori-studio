/**
 * The kernel's 3D render model, as a mesh the simulator's `MeshRenderer` draws.
 *
 * A folded figure has no solver. `MeshRenderer` reads every vertex from a
 * position *texture* the solver normally writes each step, so the whole of this
 * module is: pack the positions once, describe the triangles once, and hand both
 * over. After that a frame is a uniform change and a draw, which is the entire
 * reason a 3D figure can be a live viewport at all.
 *
 * # The crux: never drawing two coplanar surfaces at once
 *
 * A folded model's layers are **exactly coplanar**. A depth buffer cannot order
 * them — same z, so they z-fight — which is why ORIPA keeps an overlap matrix
 * and why the CPU projector beside this file resolves order with a BSP.
 *
 * The obvious escape is to displace each layer by a hair and let the z-buffer
 * reproduce an order we already know. That was tried and it does not work, for a
 * reason worth writing down because it is not obvious: the displacement has to
 * be **per cell**, since a face is the top layer of one cell and buried in the
 * next, so one physical face ends up at two different depths on either side of a
 * cell boundary. And creases lie on cell boundaries *by construction*. Every
 * crease therefore sits exactly in a discontinuity of the very quantity meant to
 * hide it, and no epsilon fixes that — a bigger one punches through more, a
 * smaller one loses the visible layer's own linework. Near edge-on the whole
 * scheme collapses anyway, because the displacement projects to no depth
 * separation at all.
 *
 * So the order is used the way the projector uses it: to decide **what to
 * draw**, not to nudge where. A plane's visible surface is the top face of each
 * of its cells; the opposite side's is the bottom face of each. Those two
 * {@link Folded3dSkin}s are built once, and the eye picks one per plane. Inside
 * a skin there is one face per cell and cells are area-disjoint, so nothing
 * coplanar is ever drawn together and the depth buffer only ever decides plane
 * against plane — real geometry, genuinely separated.
 *
 * What that deletes: the layer epsilon, the ply budget it was capped by, the
 * per-cell draw-rank nudge, and a crease bias that had to be larger than a stack
 * and smaller than a layer at the same time. The crease bias that remains only
 * has to break the tie between a crease and the one face it lies on.
 *
 * # Cells, not faces — and why nothing is sorted
 *
 * The drawable unit is a **(cell, stack slot) pair**, never a face. A per-face
 * scalar height would be exactly a topological sort of the face partial order,
 * and that order is legitimately **cyclic** — the `pinwheel_cyclic` fixture
 * orders four arms `0 > 4 > 3 > 2 > 0`. A skin asks only for the first and last
 * entry of each `cell_stack`, which exist whether or not the order is acyclic,
 * so a cyclic model works by construction rather than by exception.
 *
 * # Creases belong to a layer, and are drawn from that layer's ring
 *
 * A crease is **not** one line at the fold. It is emitted once per `(cell,
 * slot)` whose paper ends there, from that slot's own copy of the cell ring, and
 * it rides in that slot's skin — so a crease is drawn exactly when the layer it
 * bounds is the one you can see.
 *
 * Which ring segments are a layer's paper edges, rather than arrangement cuts it
 * runs across, is `buildFolded3dInk` in `folded3dModelReader.ts` — shared with
 * the CPU projector, because the window and the export disagreeing about which
 * creases exist is the failure this whole change is repairing.
 *
 * # Winding, which is easy to invert and was not guessed
 *
 * `MeshRenderer`'s view transform has determinant **−1** (yaw about Y, then a
 * y/z swap — `camera.ts`'s `toViewSpace`), so `sign(screen winding) =
 * −sign(n · eyeDir)`: a triangle whose right-hand normal points *toward* the eye
 * is drawn with `u_backColor`. The CPU projector calls that same face
 * **front** (`viewNormal[2] >= 0 ? style.front : style.back`). So to make the
 * GPU agree with the flat/3D figure the user already has, every triangle is
 * wound CCW about **`−paperFrontNormal`**.
 *
 * Note this puts a 3D folded figure's two tones *opposite* an inline
 * simulation's on the same physical surface: the simulator lifts FOLD faces with
 * `[x, 0, y]`, another determinant −1 map, so its right-hand normals end up on
 * the paper's FOLD-front. Parity with the folded figure beside it is the
 * non-negotiable, so the folded figure's convention wins and the disagreement is
 * recorded here rather than discovered later.
 */

import earcut from 'earcut';
import { textureSizeFor, type MeshTopology, type Vec3 } from '@treemaker/origami-simulator';
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_CELL_UNDETERMINED,
  FOLDED_3D_EDGE_ATTR_STRIDE,
  FOLDED_3D_EDGE_CREASE,
  FOLDED_3D_FACE_ATTR_STRIDE,
  type OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import {
  buildFolded3dInk,
  cellRing,
  cellStack,
  edgeEnds,
  modelCentroid,
  modelRadius,
  planeFrame,
} from './folded3dModelReader';

/**
 * Vertices one mesh may hold.
 *
 * A memory bound, not a texture one: `textureSizeFor(1_048_576)` is 1024, well
 * inside any `MAX_TEXTURE_SIZE`, while dim 4096 would make the position array
 * alone 268 MB. 1M vertices is roughly 50× the largest admitted corpus model, so
 * this is expected never to fire — the same shape of guard, and the same
 * justification, as the projector's `BSP_ITEM_BUDGET`.
 */
export const FOLDED_3D_MESH_VERTEX_BUDGET = 1_048_576;

/**
 * How far inside its own face a crease is drawn, as a fraction of `modelRadius`.
 *
 * A crease at a fold that is not flat lies in **both** planes it joins — that is
 * what a fold line is — so it is exactly coplanar with whatever the *other*
 * plane has along it, and that may be paper in front of the layer the crease
 * belongs to. On the reported case a 90° fold between a flap and a wall put the
 * flap's crease exactly on the wall's surface, and the crease bias, however
 * small, tipped it in front: the fold showed through the wall from the side the
 * flap is hidden on.
 *
 * Drawing it a hair inside its own cell settles it, and settles it in the right
 * direction rather than by luck: the crease then has the depth of the paper it
 * bounds, so the ordinary plane-against-plane depth test answers correctly, from
 * every camera and in any draw order.
 *
 * At `1e-3` of radius this is about a quarter of a device pixel on a 512-frame
 * window — invisible as an inset — while giving 50 times the crease bias in
 * depth separation when the occluding plane is face-on. It shrinks with the
 * angle between the two planes, and vanishes when the occluder is edge-on, which
 * is exactly when the occluder covers no pixels to hide anything behind.
 */
export const CREASE_INSET_RELATIVE = 1e-3;

/** Triangles smaller than this fraction of `radius²` are dropped. */
const MIN_TRIANGLE_AREA_RELATIVE = 1e-12;

/**
 * One emitted (cell, stack slot) pair.
 *
 * Carried rather than recoverable. A cell's ring is emitted once per slot, so
 * nothing downstream could tell from the index buffer which layer of which piece
 * of paper a triangle draws — and that is precisely what a test asserting "the
 * z-buffer's winner is the kernel's near layer" has to say, and what a hit test
 * on a 3D figure will need.
 *
 * Struct-of-arrays, like the payload itself: a deep corpus model emits thousands
 * of slots and per-slot objects would be pure allocation.
 */
export interface Folded3dMeshSlots {
  count: number;
  /** Arrangement cell per slot. */
  cell: Int32Array;
  /** Face id per slot — the kernel's `cell_stack` entry. */
  face: Int32Array;
  /** Index into `cell_stack` within that cell; 0 is top-of-plane. */
  depth: Int32Array;
  /**
   * First index in `topology.faceIndices` belonging to each slot, plus a final
   * end sentinel — so slot `i` owns `[start[i], start[i + 1])`.
   *
   * Read against the **translucent and undetermined runs**, where every slot
   * appears exactly once and in slot order. A skin repeats some of those
   * triangles at its own offset, which is why this is one range and not a list:
   * a slot's geometry has one canonical home and any number of draws over it.
   */
  indexStart: Uint32Array;
  /**
   * The vertex half of the same record: slot `i` owns vertices
   * `[vertexStart[i], vertexStart[i + 1])` of {@link Folded3dMesh.positions},
   * one per point of its cell's ring, in ring order. Also `count + 1` long.
   *
   * A slot keeps its own copy of the ring even though every slot of a cell now
   * sits at the same place: it is what lets one layer be addressed on its own,
   * and the cost is vertices rather than the far more expensive alternative of
   * indices that alias.
   */
  vertexStart: Uint32Array;
}

/**
 * One drawable surface of one plane: what the eye sees of it from a given side.
 *
 * A plane's visible surface is exactly **the top face of every one of its
 * cells** — cells partition the plane's paper and each one's `cell_stack` names
 * its top. So there are two of these per plane, and they are facts about the
 * model rather than about the camera: built once, selected at draw time by a
 * single bit, `up · eye`.
 *
 * That selection is *exact* rather than approximate because a folded figure is
 * drawn orthographically (`withoutPerspective`, `foldedMeshSource.ts`). Every
 * ray shares one direction, so `up · eye` has one sign across the whole plane;
 * under perspective a near eye could see both sides of one sheet and the bit
 * would have to be per pixel.
 *
 * Within a skin there is one face per cell and cells are area-disjoint, so
 * **nothing here is coplanar with anything else here**. That is the property the
 * whole scheme rests on: the depth buffer is left deciding plane against plane,
 * where the geometry is genuinely separated, and is never asked to order two
 * surfaces that occupy the same space.
 */
export interface Folded3dSkin {
  plane: number;
  /**
   * The plane's `up`, in the **mesh's** basis, so a caller can take
   * `up · eye` without re-deriving the axis swap. Unit length.
   */
  up: [number, number, number];
  /**
   * `1` when this skin is what the `+up` side sees, `-1` for the other.
   *
   * A one-face cell is the top *and* the bottom of its stack, so it appears in
   * both skins. They are separate index runs over the same vertices.
   */
  side: 1 | -1;
  faceIndexStart: number;
  faceIndexCount: number;
  /** In **edges**, not indices. */
  edgeStart: number;
  edgeCount: number;
}

/** A contiguous run of both index buffers. */
export interface Folded3dRange {
  faceIndexStart: number;
  faceIndexCount: number;
  edgeStart: number;
  edgeCount: number;
}

export interface Folded3dMesh {
  /**
   * Tight `x, y, z` per vertex, in the **renderer's** basis and relative to the
   * model centroid.
   *
   * Tight rather than the texture's RGBA layout because this exact array is what
   * `projectVertices` takes (the shader's maintained CPU mirror, and so what the
   * tests below check against) and what `renderMeshToSvg` takes (the vector
   * export path). {@link packFolded3dPositionTexture} produces the texture form
   * from it.
   *
   * At the paper's **true** positions. Layers used to be displaced along their
   * plane's `up` by a hair, so that a depth buffer could reproduce an order the
   * kernel had already computed; that is gone, and with it the epsilon, the ply
   * budget and the crease bias that had to be tuned against them. Nothing is
   * displaced because nothing coplanar is ever drawn together.
   */
  positions: Float32Array;
  topology: MeshTopology;
  /** Always `[0, 0, 0]`: {@link positions} is already centroid-relative. */
  center: [number, number, number];
  /**
   * `modelRadius` — the same number `folded3dFrameRadius` sizes the figure's
   * frame from, so the mesh cannot overflow the window it is drawn in. Exactly,
   * now that nothing perturbs the geometry.
   */
  radius: number;
  /** Deepest `cell_stack` in this model. Reported, not used for placement. */
  maxStackDepth: number;
  slots: Folded3dMeshSlots;
  /**
   * Two per plane that has any determined cell — see {@link Folded3dSkin}.
   * This is what an opaque figure draws.
   */
  skins: Folded3dSkin[];
  /**
   * Every layer of every determined cell, once each.
   *
   * What a **translucent** style draws, where the whole stack is meant to show
   * and the skins would hide most of it. Coplanar by construction, which is
   * harmless there: translucent faces do not write depth, so they blend in draw
   * order rather than competing for it.
   */
  translucent: Folded3dRange;
  /**
   * Cells the solver could not order.
   *
   * They have no top and no bottom, so no skin can contain them; they are drawn
   * translucent over the resolved figure instead, which is the honest way to say
   * "these layers could be either way round".
   */
  undetermined: Folded3dRange;
  /**
   * Creases at the head of `topology.edgeIndices` that belong to no layer.
   *
   * The fallback for a model edge no `(cell, slot)` inks — see
   * `Folded3dInk.orphanEdges`. Each is drawn plainly, at its true endpoints, so
   * a match that fails degrades to a slightly cluttered picture rather than a
   * missing crease. Expected zero, and a figure that reports otherwise is worth
   * looking at.
   */
  fallbackEdgeCount: number;
}

/**
 * A model too large to mesh keeps whatever it is drawing now.
 *
 * A result rather than a throw, for the same reason a 3D fold refusal is: a
 * figure that cannot be meshed must still draw, and the caller already has the
 * path for that — the stored `renderSnapshot`, which is what a figure that has
 * not been rehydrated shows anyway.
 */
export type Folded3dMeshResult =
  | { kind: 'mesh'; mesh: Folded3dMesh }
  | { kind: 'too-large'; vertexCount: number; limit: number };

/**
 * Kernel world axes to the renderer's, so the mesh shader's hard-coded
 * yaw-about-Y means what the projector's `yaw` means: the paper's normal becomes
 * the renderer's vertical.
 *
 * `(x, z, −y)` and not `(x, z, y)` — the second is a *reflection*, which draws a
 * mirrored figure with front and back swapped and looks entirely plausible. This
 * one is a proper rotation, so it leaves every winding alone. Identical to the
 * projector's `toSimBasis`, deliberately: the two paths must place the same
 * model at the same camera in the same place.
 */
function toSimBasis(p: Vec3): Vec3 {
  return [p[0], p[2], -p[1]];
}

/**
 * Fold assignment code per edge, as `MeshTopology.edgeAssignments` carries it.
 *
 * The sign convention is the kernel's own, not one invented here: its FOLD
 * exporter reads a negative fold angle as Mountain, matching the FOLD spec.
 *
 * A zero-degree crease maps to 0 (border) rather than to the exporter's Flat,
 * because code 3 is *skipped* by `buildEdgeQuads` while the CPU projector draws
 * those edges today — mapping them to F would silently delete linework. Nothing
 * here ever emits 3.
 */
export function folded3dEdgeAssignment(kind: number, foldDegrees: number): number {
  if (kind !== FOLDED_3D_EDGE_CREASE) return 0;
  if (foldDegrees < 0) return 1;
  if (foldDegrees > 0) return 2;
  return 0;
}

/** Signed area of a triangle in a plane's `(u, v)`, doubled. */
function signedArea2(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * What a model's stacking costs, without building anything.
 *
 * One integer pass over `cell_attr` — no triangulation, no allocation, and no
 * ink — so a caller deciding *whether* a figure can be meshed does not have to
 * mesh it to find out. {@link folded3dMesh} runs the same pass, because all of
 * these are needed before a single vertex can be placed: `eps` depends on the
 * deepest stack anywhere in the model.
 *
 * `vertexCount` is an **upper bound** and `slotVertexCount` is exact. The slack
 * is the fallback, where a model edge inked nowhere gets a line of its own
 * ({@link Folded3dMesh.fallbackEdgeCount}) — so it is `2 · edge_count` less what
 * was inked, and asking exactly would mean building the ink. Bounding is the
 * safe direction for a budget check: it can refuse a figure it did not have to,
 * never admit one that then blows the limit.
 */
export function folded3dMeshExtent(model: OristudioCpFolded3dRenderModel): {
  vertexCount: number;
  slotVertexCount: number;
  maxStackDepth: number;
} {
  let maxStackDepth = 0;
  let slotVertexCount = 0;
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
    const ringLength = model.cell_attr[base + 2] ?? 0;
    const stackLength = model.cell_attr[base + 4] ?? 0;
    maxStackDepth = Math.max(maxStackDepth, stackLength);
    // Two copies of the ring per slot: the paper, and the ring inset by
    // `CREASE_INSET_RELATIVE` that the creases are drawn from.
    if (ringLength >= 3) slotVertexCount += ringLength * stackLength * 2;
  }
  return {
    vertexCount: slotVertexCount + model.edge_count * 2,
    slotVertexCount,
    maxStackDepth,
  };
}

export function folded3dMesh(model: OristudioCpFolded3dRenderModel): Folded3dMeshResult {
  const centre = toSimBasis(modelCentroid(model));
  const radius = modelRadius(model);

  const { vertexCount, slotVertexCount, maxStackDepth } = folded3dMeshExtent(model);
  if (vertexCount > FOLDED_3D_MESH_VERTEX_BUDGET) {
    return { kind: 'too-large', vertexCount, limit: FOLDED_3D_MESH_VERTEX_BUDGET };
  }

  const minArea2 = MIN_TRIANGLE_AREA_RELATIVE * Math.max(radius * radius, Number.MIN_VALUE);
  const inset = CREASE_INSET_RELATIVE * radius;
  const ink = buildFolded3dInk(model);
  const assignmentOf = new Uint8Array(model.edge_count);
  for (let edge = 0; edge < model.edge_count; edge += 1) {
    assignmentOf[edge] = folded3dEdgeAssignment(
      model.edge_attr[edge * FOLDED_3D_EDGE_ATTR_STRIDE + 3] ?? 0,
      model.edge_fold_degrees[edge] ?? 0
    );
  }

  const positions = new Float32Array((slotVertexCount + ink.orphanEdges.length * 2) * 3);
  let vertex = 0;

  // --- every layer, once, as geometry -------------------------------------
  //
  // No displacement: the paper sits where the kernel put it. Two layers of one
  // cell are exactly coincident, and that is fine because they are never drawn
  // together — the skins below pick one, and a translucent style that draws both
  // blends them without writing depth.
  const slotCell: number[] = [];
  const slotFace: number[] = [];
  const slotDepth: number[] = [];
  const slotVertexStart: number[] = [];
  /** Triangle indices per slot. */
  const slotTriangles: number[][] = [];
  /** `[a, b, assignment]` per crease of each slot. */
  const slotCreases: number[][] = [];
  /** Slots of each cell, in `cell_stack` order. */
  const slotsOfCell: number[][] = [];

  for (let cell = 0; cell < model.cell_count; cell += 1) slotsOfCell.push([]);
  let undeterminedSlotStart = 0;
  // Determined cells first, so the two blocks below are each contiguous in slot
  // order and `slots.indexStart` stays a range rather than a scatter.
  for (const wantUndetermined of [false, true]) {
    if (wantUndetermined) undeterminedSlotStart = slotCell.length;
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
    if (
      ((model.cell_attr[base + 5] ?? 0) === FOLDED_3D_CELL_UNDETERMINED) !== wantUndetermined
    ) {
      continue;
    }
    const ring = cellRing(model, cell);
    if (ring.length < 3) continue;
    const stack = cellStack(model, cell);
    if (stack.length === 0) continue;
    const frame = planeFrame(model, model.cell_attr[base] ?? 0);

    // The ring, triangulated once, in the plane's **own** `(u, v)`. Never a
    // locally re-derived tangent: a different chirality reverses every stack
    // read off the projected winding, and the payload says so in as many words.
    const flat: number[] = [];
    for (const point of ring) {
      const dx = point[0] - frame.origin[0];
      const dy = point[1] - frame.origin[1];
      const dz = point[2] - frame.origin[2];
      flat.push(
        dx * frame.u[0] + dy * frame.u[1] + dz * frame.u[2],
        dx * frame.v[0] + dy * frame.v[1] + dz * frame.v[2]
      );
    }
    const triangles = earcut(flat);

    // The same ring, pulled `inset` toward its own interior. A crease is drawn
    // from *this* copy, so it carries the depth of the paper it bounds rather
    // than of the fold line — see `CREASE_INSET_RELATIVE`.
    //
    // Per vertex rather than per segment, from the mean of the two adjacent
    // inward normals, so the inset ring closes at its corners instead of leaving
    // a gap at each one. Which side is inward is read off the ring's own signed
    // area, because the kernel promises no winding.
    let area2 = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const j = (i + 1) % ring.length;
      area2 += flat[i * 2]! * flat[j * 2 + 1]! - flat[j * 2]! * flat[i * 2 + 1]!;
    }
    const handedness = area2 >= 0 ? 1 : -1;
    const insetFlat: number[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      const previous = (i + ring.length - 1) % ring.length;
      const next = (i + 1) % ring.length;
      let nx = 0;
      let ny = 0;
      for (const [from, to] of [
        [previous, i],
        [i, next],
      ] as const) {
        const dx = flat[to * 2]! - flat[from * 2]!;
        const dy = flat[to * 2 + 1]! - flat[from * 2 + 1]!;
        const length = Math.hypot(dx, dy);
        if (length < Number.MIN_VALUE) continue;
        // Interior is to the left of a counter-clockwise edge.
        nx += (-dy / length) * handedness;
        ny += (dx / length) * handedness;
      }
      const length = Math.hypot(nx, ny);
      const scale = length > 1e-9 ? inset / length : 0;
      insetFlat.push(flat[i * 2]! + nx * scale, flat[i * 2 + 1]! + ny * scale);
    }

    for (let slot = 0; slot < stack.length; slot += 1) {
      const face = stack[slot]!;
      const first = vertex;
      slotVertexStart.push(first);
      for (const point of ring) {
        const sim = toSimBasis(point);
        positions[vertex * 3] = sim[0] - centre[0];
        positions[vertex * 3 + 1] = sim[1] - centre[1];
        positions[vertex * 3 + 2] = sim[2] - centre[2];
        vertex += 1;
      }
      // The inset ring, lifted back out of the plane's `(u, v)`.
      const insetFirst = vertex;
      for (let i = 0; i < ring.length; i += 1) {
        const u = insetFlat[i * 2]!;
        const v = insetFlat[i * 2 + 1]!;
        const sim = toSimBasis([
          frame.origin[0] + frame.u[0] * u + frame.v[0] * v,
          frame.origin[1] + frame.u[1] * u + frame.v[1] * v,
          frame.origin[2] + frame.u[2] * u + frame.v[2] * v,
        ]);
        positions[vertex * 3] = sim[0] - centre[0];
        positions[vertex * 3 + 1] = sim[1] - centre[1];
        positions[vertex * 3 + 2] = sim[2] - centre[2];
        vertex += 1;
      }

      // Which way this slot's triangles wind is a **per-face** question, not a
      // per-cell one: `facing` flips between faces of one plane, so slots of one
      // cell can want opposite orientations. Sharing one index order across a
      // stack would paint the whole cell one colour and lose the two-tone
      // layering the flat path shows.
      //
      // A triangle CCW in `(u, v)` has right-hand normal `+up`, and the paper
      // front is `facing * up`; the renderer colours a triangle **front** when
      // its right-hand normal points *away* from the eye, so the wanted normal
      // is `−facing * up` and the wanted `(u, v)` winding sign is `−facing`.
      // Decided per triangle from the emitted geometry rather than trusted from
      // the ring or from earcut, neither of which promises an orientation.
      const facing = model.face_attr[face * FOLDED_3D_FACE_ATTR_STRIDE + 3] ?? 1;
      const wantPositive = facing < 0;
      const indices: number[] = [];
      for (let i = 0; i + 2 < triangles.length; i += 3) {
        const a = triangles[i]!;
        const b = triangles[i + 1]!;
        const c = triangles[i + 2]!;
        const area2 = signedArea2(
          flat[a * 2]!,
          flat[a * 2 + 1]!,
          flat[b * 2]!,
          flat[b * 2 + 1]!,
          flat[c * 2]!,
          flat[c * 2 + 1]!
        );
        if (Math.abs(area2) < minArea2) continue;
        if (area2 > 0 === wantPositive) indices.push(first + a, first + b, first + c);
        else indices.push(first + a, first + c, first + b);
      }

      // The creases, from this slot's own ring vertices: two indices each, no
      // geometry of their own. A segment is inked where *this layer's* paper
      // ends and skipped where the layer runs across an arrangement cut some
      // other face made.
      const creases: number[] = [];
      for (let segment = 0; segment < ring.length; segment += 1) {
        const edge = ink.edgeAt(cell, slot, segment);
        if (edge < 0) continue;
        creases.push(
          insetFirst + segment,
          insetFirst + ((segment + 1) % ring.length),
          assignmentOf[edge] ?? 0
        );
      }

      slotsOfCell[cell]!.push(slotCell.length);
      slotCell.push(cell);
      slotFace.push(face);
      slotDepth.push(slot);
      slotTriangles.push(indices);
      slotCreases.push(creases);
    }
  }
  }
  slotVertexStart.push(vertex);

  // --- assemble the index buffers -----------------------------------------
  const faceIndices: number[] = [];
  const edgeIndices: number[] = [];
  const edgeAssignments: number[] = [];
  const slotIndexStart: number[] = new Array<number>(slotCell.length).fill(0);

  const appendSlot = (slot: number, record = false): void => {
    if (record) slotIndexStart[slot] = faceIndices.length;
    for (const index of slotTriangles[slot]!) faceIndices.push(index);
    const creases = slotCreases[slot]!;
    for (let i = 0; i < creases.length; i += 3) {
      edgeIndices.push(creases[i]!, creases[i + 1]!);
      edgeAssignments.push(creases[i + 2]!);
    }
  };

  // The fallback, at the head of the crease buffer and the tail of the vertex
  // array: a model edge no layer inked, drawn plainly at its true endpoints.
  // Expected empty.
  for (const edge of ink.orphanEdges) {
    const [a, b] = edgeEnds(model, edge);
    for (const point of [a, b]) {
      const sim = toSimBasis(point);
      positions[vertex * 3] = sim[0] - centre[0];
      positions[vertex * 3 + 1] = sim[1] - centre[1];
      positions[vertex * 3 + 2] = sim[2] - centre[2];
      vertex += 1;
    }
    edgeIndices.push(vertex - 2, vertex - 1);
    edgeAssignments.push(assignmentOf[edge] ?? 0);
  }
  const fallbackEdgeCount = edgeAssignments.length;

  const determined = (cell: number): boolean =>
    (model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE + 5] ?? 0) !== FOLDED_3D_CELL_UNDETERMINED;

  // Two skins per plane: the top layer of every cell, and the bottom layer of
  // every cell. `cell_stack` is top-first with respect to the plane's `up`, so
  // the `+1` side takes `stack[0]` and the `-1` side takes the last entry.
  const skins: Folded3dSkin[] = [];
  for (let plane = 0; plane < model.plane_count; plane += 1) {
    const up = toSimBasis(planeFrame(model, plane).up);
    for (const side of [1, -1] as const) {
      const faceIndexStart = faceIndices.length;
      const edgeStart = edgeAssignments.length;
      for (let cell = 0; cell < model.cell_count; cell += 1) {
        if ((model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0) !== plane) continue;
        if (!determined(cell)) continue;
        const slots = slotsOfCell[cell]!;
        if (slots.length === 0) continue;
        appendSlot(side === 1 ? slots[0]! : slots[slots.length - 1]!);
      }
      if (faceIndices.length === faceIndexStart && edgeAssignments.length === edgeStart) {
        continue;
      }
      skins.push({
        plane,
        up: [up[0], up[1], up[2]],
        side,
        faceIndexStart,
        faceIndexCount: faceIndices.length - faceIndexStart,
        edgeStart,
        edgeCount: edgeAssignments.length - edgeStart,
      });
    }
  }

  // Every determined layer once, for a translucent style, then the cells the
  // solver could not order — which have no top and no bottom to make a skin of.
  const translucentFaceStart = faceIndices.length;
  const translucentEdgeStart = edgeAssignments.length;
  for (let slot = 0; slot < undeterminedSlotStart; slot += 1) appendSlot(slot, true);
  const undeterminedFaceStart = faceIndices.length;
  const undeterminedEdgeStart = edgeAssignments.length;
  for (let slot = undeterminedSlotStart; slot < slotCell.length; slot += 1) {
    appendSlot(slot, true);
  }
  slotIndexStart.push(faceIndices.length);

  return {
    kind: 'mesh',
    mesh: {
      positions,
      topology: {
        faceIndices: Uint32Array.from(faceIndices),
        edgeIndices: Uint32Array.from(edgeIndices),
        edgeAssignments: Uint8Array.from(edgeAssignments),
        textureDim: textureSizeFor(Math.floor(positions.length / 3)),
      },
      center: [0, 0, 0],
      radius,
      maxStackDepth,
      slots: {
        count: slotCell.length,
        cell: Int32Array.from(slotCell),
        face: Int32Array.from(slotFace),
        depth: Int32Array.from(slotDepth),
        indexStart: Uint32Array.from(slotIndexStart),
        vertexStart: Uint32Array.from(slotVertexStart),
      },
      skins,
      translucent: {
        faceIndexStart: translucentFaceStart,
        faceIndexCount: faceIndices.length - translucentFaceStart,
        edgeStart: translucentEdgeStart,
        edgeCount: edgeAssignments.length - translucentEdgeStart,
      },
      undetermined: {
        faceIndexStart: undeterminedFaceStart,
        faceIndexCount: faceIndices.length - undeterminedFaceStart,
        edgeStart: undeterminedEdgeStart,
        edgeCount: edgeAssignments.length - undeterminedEdgeStart,
      },
      fallbackEdgeCount,
    },
  };
}

/**
 * Positions in the RGBA layout `u_originalPosition` is sampled from.
 *
 * `[x, y, z, 0]` per texel, which is exactly what the solver's own packing
 * writes. The companion `u_lastPosition` and `u_lastVelocity` must exist at the
 * **same** `textureDim` — `fetchPosition` is their sum and `bindCommon` binds all
 * three unconditionally — but they are zero, and `createTexture` with no data is
 * zero-initialised by the WebGL spec, so they cost no allocation here.
 */
export function packFolded3dPositionTexture(
  positions: Float32Array,
  textureDim: number
): Float32Array {
  const out = new Float32Array(textureDim * textureDim * 4);
  const count = Math.min(Math.floor(positions.length / 3), textureDim * textureDim);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = positions[i * 3] ?? 0;
    out[i * 4 + 1] = positions[i * 3 + 1] ?? 0;
    out[i * 4 + 2] = positions[i * 3 + 2] ?? 0;
  }
  return out;
}
