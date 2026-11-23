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
 * and why the vector path beside this file (`folded3dScene.ts`, through the
 * simulator's BSP) resolves order with a tree instead.
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
 * So the order is used to decide **what to draw**, not to nudge where. A plane's visible surface is the top face of each
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
 * runs across, is `buildFolded3dInk` in `folded3dModelReader.ts` — the one
 * reader, because the window and the export disagreeing about which creases
 * exist is the failure this whole change is repairing.
 *
 * # The document's aux lines ride the same layers
 *
 * An aux line of the crease pattern is on the paper and folded by nothing, so
 * it is not in the render model: the kernel carries the document's current
 * ones onto the faces separately (`folded_figure_3d_aux_lines`), and they are
 * cut to the `(cell, slot)`s that show their face (`folded3dAuxPieces.ts`).
 * Each cut is a crease of that slot, coded {@link EDGE_CODE.aux} like a
 * zero-degree crease, on two vertices of the slot's own after its ring — so
 * the edge pass draws it in the aux pen, hides it with the style's aux switch,
 * a skin shows it exactly when its layer is the one you can see, and the
 * vector scene, which finds a crease's layer by its vertices, finds this one's.
 * Vertices of its own share nothing with the ring, though, so the erode rule
 * cannot see where a cut meets its layer's outline: the mesh states it
 * (`topology.auxEnds`) — an end on a ring segment this layer inks as paper
 * edge or fold is on the outline, as a crease's end is where such an edge
 * meets it. Nor do they share a triangle, which the scene's line order reads
 * a crease's own paper from: `folded3dScene` records one (`edgeTriangles`).
 *
 * # Winding, which is easy to invert and was not guessed
 *
 * `MeshRenderer`'s view transform has determinant **−1** (yaw about Y, then a
 * y/z swap — `camera.ts`'s `toViewSpace`), so `sign(screen winding) =
 * −sign(n · eyeDir)`: a triangle whose right-hand normal points *toward* the eye
 * is drawn with `u_backColor`. The paper's own front normal calls that same face
 * **front** (`viewNormal[2] >= 0`). So to make the GPU agree with the flat/3D
 * figure the user already has, every triangle is wound CCW about
 * **`−paperFrontNormal`**.
 *
 * An inline simulation of the same FOLD agrees: it cancels the same reflection
 * with its 2D lift `[x, y] → [x, 0, −y]` (`normalizePoint` in
 * `packages/origami-simulator/src/geometry.ts`; PR #325 negated the y), so the
 * two surfaces paint one physical side one colour. Change either cancellation
 * and check the other — they are only correct together.
 */

import earcut from 'earcut';
import {
  EDGE_BOUNDARY_A,
  EDGE_BOUNDARY_B,
  EDGE_CODE,
  textureSizeFor,
  type MeshTopology,
  type Vec3,
  type VirtualVertices,
} from '@treemaker/origami-simulator';
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_CELL_UNDETERMINED,
  FOLDED_3D_EDGE_ATTR_STRIDE,
  FOLDED_3D_EDGE_CREASE,
  FOLDED_3D_FACE_ATTR_STRIDE,
  type OristudioCpFolded3dAuxLines,
  type OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import { folded3dAuxSlots } from './folded3dAuxPieces';
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
 * this is expected never to fire: it degrades a model nobody can draw into a
 * refusal rather than a hung tab.
 */
export const FOLDED_3D_MESH_VERTEX_BUDGET = 1_048_576;

/** Triangles smaller than this fraction of `radius²` are dropped. */
const MIN_TRIANGLE_AREA_RELATIVE = 1e-12;

/**
 * The doubled-area floor a triangle of a model of this `radius` must clear, in
 * the units {@link signedArea2} reports: a plane's own `(u, v)`, which is
 * orthonormal, so model length². The mesh is the only builder now, so this is
 * the one floor the exported drawing and the window both drop dust at.
 */
export function folded3dMinTriangleArea2(radius: number): number {
  return MIN_TRIANGLE_AREA_RELATIVE * Math.max(radius * radius, Number.MIN_VALUE);
}

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
   * one per point of its cell's ring, in ring order, then two per aux cut the
   * slot shows. Also `count + 1` long.
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
 * That selection is exact under an orthographic projection, where every ray
 * shares one direction and `up · eye` has one sign across the whole plane. The
 * window draws with the mesh renderer's perspective since D7 (eye at
 * `3.2 · radius`, `foldedMeshSource.ts`), under which a plane seen nearly
 * edge-on can show both sides at once; the bit is then the side the plane's
 * centre shows, the same approximation as the planes' far-to-near draw order.
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
  /**
   * Mean of this skin's vertices, in the mesh's basis.
   *
   * What orders the draws: `centroid · viewAxis` is how far the skin is from the
   * eye, and the passes run far-to-near so that a nearer plane's paper is drawn
   * *after* a farther plane's creases and covers them. That is what settles the
   * tie along a fold line, where two planes are at exactly the same depth by
   * construction and no epsilon can separate them at every camera.
   */
  centroid: [number, number, number];
  faceIndexStart: number;
  faceIndexCount: number;
  /**
   * The creases this skin draws unconditionally. In **edges**, not indices.
   *
   * Hinges are not in here — see {@link hingeGroups}.
   */
  edgeStart: number;
  edgeCount: number;
  /**
   * Hinge creases, grouped by what has to be showing elsewhere for them to be
   * drawn.
   *
   * A hinge is the fold line between two planes, and it is a ring segment of a
   * cell in **both** of them at identical coordinates. It is only visible when
   * neither plane has buried it — so this skin drawing its own side is not
   * enough, the partner plane has to be showing the layer on the far side of the
   * bend too. Which layer that is depends on which side of the partner plane the
   * eye is on, so it cannot be baked in here; the groups are laid out as
   * contiguous runs and `folded3dDrawPasses` includes or drops each per frame.
   */
  hingeGroups: readonly Folded3dHingeGroup[];
}

/** One run of hinge creases and the condition that admits it. */
export interface Folded3dHingeGroup {
  /** The plane on the far side of the bend. */
  partnerPlane: number;
  /** The side of `partnerPlane` that must be facing the eye. */
  requiredSide: 1 | -1;
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
  spatial?: import('./folded3dMaterial').SpatialMeshOrder;
  displacement?: Float32Array;
  /**
   * Tight `x, y, z` per vertex, in the **renderer's** basis and relative to the
   * model centroid.
   *
   * Tight rather than the texture's RGBA layout because this exact array is what
   * `projectVertices` takes (the shader's maintained CPU mirror, and so what the
   * tests below check against) and what `meshToPaperScene` takes (the vector
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
  /**
   * The unfolded sheet's extent in the mesh's units — the kernel's `span`, the
   * longer side of the unfolded bounding box. What the style's erode is a
   * fraction of, for the window's edge pass and the vector scene alike.
   */
  sheet: number;
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
  /**
   * Per crease of `topology.edgeIndices`, the condition a hinge is drawn
   * under: `partnerPlane` is the plane on the far side of the bend, or `-1`
   * for a crease drawn whenever its layer is, and `requiredSide` the side of
   * that plane that must be facing the eye — `0` for a hinge buried on both
   * of its partner's sides, which no camera admits.
   *
   * What `folded3dDrawPasses` decides per skin from {@link Folded3dSkin.hingeGroups},
   * stated per crease: the translucent run carries every layer's creases
   * unconditioned, and a consumer drawing a buried layer from it (the vector
   * export, which keeps buried paper) has to apply the same rule to that
   * layer's hinges or draw a bend the window hides.
   *
   * `bend` is 1 for every crease that is a bend between two planes, admitted
   * on a condition or not — what the window lays on its own plane
   * (`folded3dHingeEnds`).
   */
  hinges: { partnerPlane: Int32Array; requiredSide: Int8Array; bend: Uint8Array };
}

/**
 * A model too large to mesh keeps whatever it is drawing now.
 *
 * A result rather than a throw, for the same reason a 3D fold refusal is: a
 * figure that cannot be meshed must still draw, and the caller already has the
 * path for that — the stored `PaperScene`, which is what a figure that has not
 * been rehydrated shows anyway.
 */
export type Folded3dMeshResult =
  | { kind: 'mesh'; mesh: Folded3dMesh }
  | { kind: 'too-large'; vertexCount: number; limit: number };

/**
 * Kernel world axes to the renderer's, so the mesh shader's hard-coded
 * yaw-about-Y means what a {@link FoldedFigureCamera}'s `yaw` means: the
 * paper's normal becomes the renderer's vertical.
 *
 * `(x, z, −y)` and not `(x, z, y)` — the second is a *reflection*, which draws a
 * mirrored figure with front and back swapped and looks entirely plausible. This
 * one is a proper rotation, so it leaves every winding alone. `folded3dCamera`'s
 * `folded3dEyeDirection` carries an eye back through the same map, which is what
 * keeps "which side of this plane is the viewer on" one answer.
 */
export function toSimBasis(p: Vec3): Vec3 {
  return [p[0], p[2], -p[1]];
}

/**
 * Fold assignment code per edge, as `MeshTopology.edgeAssignments` carries it.
 *
 * The sign convention is the kernel's own, not one invented here: its FOLD
 * exporter reads a negative fold angle as Mountain, matching the FOLD spec.
 *
 * A zero-degree crease is the exporter's Flat — an auxiliary crease lying in
 * its face, {@link EDGE_CODE.aux} — which the edge pass draws in the aux pen
 * when the style shows aux creases and leaves out otherwise, as the simulator
 * treats a source `F` edge. It used to map to 0 (border) while the edge pass
 * skipped code 3, which drew every aux crease as a paper edge.
 */
export function folded3dEdgeAssignment(kind: number, foldDegrees: number): number {
  if (kind !== FOLDED_3D_EDGE_CREASE) return EDGE_CODE.border;
  if (foldDegrees < 0) return EDGE_CODE.mountain;
  if (foldDegrees > 0) return EDGE_CODE.valley;
  return EDGE_CODE.aux;
}

/** Signed area of a triangle in a plane's `(u, v)`, doubled. */
export function signedArea2(
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
    if (ringLength >= 3) slotVertexCount += ringLength * stackLength;
  }
  return {
    vertexCount: slotVertexCount + model.edge_count * 2,
    slotVertexCount,
    maxStackDepth,
  };
}

/** One crease of one slot, before it is sorted into a skin's runs. */
interface SlotCrease {
  a: number;
  b: number;
  assignment: number;
  /** The plane on the far side of a hinge, or `-1` when the crease is unconditional. */
  partnerPlane: number;
  /** The side of `partnerPlane` that must be showing; `0` when unconditional. */
  requiredSide: 1 | -1 | 0;
  /**
   * A hinge whose far side is buried on **both** of its partner's sides, so no
   * camera can expose it. Kept for the translucent path, which shows the whole
   * stack, and skipped by every skin.
   */
  buried: boolean;
  /**
   * The plane on the far side of the bend for any hinge, buried or not, or
   * `-1` for a crease that is not one — what {@link Folded3dMesh.hinges}
   * reports. `partnerPlane` above is `-1` for a hinge exposed on both sides,
   * which the skins draw unconditionally.
   */
  hingePlane: number;
  /** Whether the crease is a bend between two planes at all, as {@link Folded3dMesh.hinges} reports it. */
  bend: boolean;
  /**
   * {@link EDGE_BOUNDARY_A} / {@link EDGE_BOUNDARY_B} for the ends of an aux
   * cut that lie on its layer's outline; `0` for a ring crease, whose ends
   * the erode rule reads off the vertices it shares.
   */
  auxEnds: number;
}

export function folded3dMesh(
  model: OristudioCpFolded3dRenderModel,
  /** The document's aux lines on this figure, as the kernel carried them; none when absent. */
  aux?: OristudioCpFolded3dAuxLines | null
): Folded3dMeshResult {
  const centre = toSimBasis(modelCentroid(model));
  const radius = modelRadius(model);

  const extent = folded3dMeshExtent(model);
  const { slotVertexCount, maxStackDepth } = extent;
  const auxSlots = folded3dAuxSlots(model, aux);
  const vertexCount = extent.vertexCount + auxSlots.count * 2;
  if (vertexCount > FOLDED_3D_MESH_VERTEX_BUDGET) {
    return { kind: 'too-large', vertexCount, limit: FOLDED_3D_MESH_VERTEX_BUDGET };
  }

  const minArea2 = folded3dMinTriangleArea2(radius);
  const ink = buildFolded3dInk(model);
  const assignmentOf = new Uint8Array(model.edge_count);
  for (let edge = 0; edge < model.edge_count; edge += 1) {
    assignmentOf[edge] = folded3dEdgeAssignment(
      model.edge_attr[edge * FOLDED_3D_EDGE_ATTR_STRIDE + 3] ?? 0,
      model.edge_fold_degrees[edge] ?? 0
    );
  }

  const positions = new Float32Array(
    (slotVertexCount + ink.orphanEdges.length * 2 + auxSlots.count * 2) * 3
  );
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
  /** Every crease of each slot, with what has to be showing for it to be drawn. */
  const slotCreases: SlotCrease[][] = [];
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
      const creases: SlotCrease[] = [];
      for (let segment = 0; segment < ring.length; segment += 1) {
        const edge = ink.edgeAt(cell, slot, segment);
        if (edge < 0) continue;
        const hinge = ink.hingeAt(cell, slot, segment);
        // A hinge exposed on both of its partner's sides is unconditional — the
        // partner cell has one layer, so nothing over there can bury the bend.
        const conditional = hinge != null && hinge.exposedOnPlus !== hinge.exposedOnMinus;
        const buried = hinge != null && !hinge.exposedOnPlus && !hinge.exposedOnMinus;
        creases.push({
          a: first + segment,
          b: first + ((segment + 1) % ring.length),
          assignment: assignmentOf[edge] ?? 0,
          partnerPlane: conditional ? hinge.partnerPlane : -1,
          requiredSide: conditional ? (hinge.exposedOnPlus ? 1 : -1) : 0,
          buried,
          hingePlane: conditional || buried ? hinge.partnerPlane : -1,
          bend: hinge != null,
          auxEnds: 0,
        });
      }

      // An aux cut's end is on this layer's outline where it lies on a ring
      // segment the layer inks as a paper edge or a fold — not an arrangement
      // cut it runs on across, nor a zero-degree crease inside the layer.
      const onOutline = (segments: readonly number[]): boolean =>
        segments.some((segment) => {
          const edge = ink.edgeAt(cell, slot, segment);
          return edge >= 0 && (assignmentOf[edge] ?? EDGE_CODE.aux) <= EDGE_CODE.valley;
        });

      // The document's aux lines this layer shows, each on two vertices of
      // the slot's own past its ring: unconditional, never a hinge.
      for (const cut of auxSlots.bySlot.get(cell)?.get(slot) ?? []) {
        const start = vertex;
        for (const point of cut.ends) {
          const sim = toSimBasis(point);
          positions[vertex * 3] = sim[0] - centre[0];
          positions[vertex * 3 + 1] = sim[1] - centre[1];
          positions[vertex * 3 + 2] = sim[2] - centre[2];
          vertex += 1;
        }
        creases.push({
          a: start,
          b: start + 1,
          assignment: EDGE_CODE.aux,
          partnerPlane: -1,
          requiredSide: 0,
          buried: false,
          hingePlane: -1,
          bend: false,
          auxEnds:
            (onOutline(cut.onRing[0]) ? EDGE_BOUNDARY_A : 0) |
            (onOutline(cut.onRing[1]) ? EDGE_BOUNDARY_B : 0),
        });
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
  const auxEnds: number[] = [];
  const hingePartner: number[] = [];
  const hingeSide: number[] = [];
  const hingeBend: number[] = [];
  const slotIndexStart: number[] = new Array<number>(slotCell.length).fill(0);

  const appendCrease = (crease: SlotCrease): void => {
    edgeIndices.push(crease.a, crease.b);
    edgeAssignments.push(crease.assignment);
    auxEnds.push(crease.auxEnds);
    hingePartner.push(crease.hingePlane);
    hingeSide.push(crease.buried ? 0 : crease.requiredSide);
    hingeBend.push(crease.bend ? 1 : 0);
  };

  /**
   * Everything of a slot, in one run — the translucent and undetermined paths,
   * which draw every layer and want every crease including the buried hinges.
   */
  const appendSlot = (slot: number, record = false): void => {
    if (record) slotIndexStart[slot] = faceIndices.length;
    for (const index of slotTriangles[slot]!) faceIndices.push(index);
    for (const crease of slotCreases[slot]!) appendCrease(crease);
  };

  const appendSlotFaces = (slot: number): void => {
    for (const index of slotTriangles[slot]!) faceIndices.push(index);
  };

  const appendSlotCreases = (
    slot: number,
    accept: (crease: SlotCrease) => boolean
  ): void => {
    for (const crease of slotCreases[slot]!) {
      if (accept(crease)) appendCrease(crease);
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
    auxEnds.push(0);
    hingePartner.push(-1);
    hingeSide.push(0);
    hingeBend.push(0);
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
      const members: number[] = [];
      for (let cell = 0; cell < model.cell_count; cell += 1) {
        if ((model.cell_attr[cell * FOLDED_3D_CELL_ATTR_STRIDE] ?? 0) !== plane) continue;
        if (!determined(cell)) continue;
        const slots = slotsOfCell[cell]!;
        if (slots.length === 0) continue;
        members.push(side === 1 ? slots[0]! : slots[slots.length - 1]!);
      }

      const faceIndexStart = faceIndices.length;
      for (const slot of members) appendSlotFaces(slot);

      const edgeStart = edgeAssignments.length;
      for (const slot of members) {
        appendSlotCreases(slot, (crease) => !crease.buried && crease.partnerPlane < 0);
      }
      const edgeCount = edgeAssignments.length - edgeStart;

      // One run per distinct condition. There are at most two per partner plane
      // and a hinge has exactly one partner, so this stays a handful of runs
      // even on a figure with many planes.
      const conditions = new Map<string, { partnerPlane: number; requiredSide: 1 | -1 }>();
      for (const slot of members) {
        for (const crease of slotCreases[slot]!) {
          if (crease.buried || crease.partnerPlane < 0) continue;
          const requiredSide = crease.requiredSide === 1 ? 1 : -1;
          conditions.set(`${crease.partnerPlane}:${requiredSide}`, {
            partnerPlane: crease.partnerPlane,
            requiredSide,
          });
        }
      }
      const hingeGroups: Folded3dHingeGroup[] = [];
      for (const condition of conditions.values()) {
        const groupStart = edgeAssignments.length;
        for (const slot of members) {
          appendSlotCreases(
            slot,
            (crease) =>
              !crease.buried &&
              crease.partnerPlane === condition.partnerPlane &&
              crease.requiredSide === condition.requiredSide
          );
        }
        const groupCount = edgeAssignments.length - groupStart;
        if (groupCount > 0) {
          hingeGroups.push({ ...condition, edgeStart: groupStart, edgeCount: groupCount });
        }
      }

      if (faceIndices.length === faceIndexStart && edgeCount === 0 && hingeGroups.length === 0) {
        continue;
      }
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = faceIndexStart; i < faceIndices.length; i += 1) {
        const at = faceIndices[i]! * 3;
        cx += positions[at]!;
        cy += positions[at + 1]!;
        cz += positions[at + 2]!;
      }
      const count = Math.max(1, faceIndices.length - faceIndexStart);
      skins.push({
        plane,
        up: [up[0], up[1], up[2]],
        centroid: [cx / count, cy / count, cz / count],
        side,
        faceIndexStart,
        faceIndexCount: faceIndices.length - faceIndexStart,
        edgeStart,
        edgeCount,
        hingeGroups,
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
        auxEnds: Uint8Array.from(auxEnds),
        textureDim: textureSizeFor(Math.floor(positions.length / 3)),
      },
      center: [0, 0, 0],
      radius,
      sheet: model.span,
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
      hinges: {
        partnerPlane: Int32Array.from(hingePartner),
        requiredSide: Int8Array.from(hingeSide),
        bend: Uint8Array.from(hingeBend),
      },
    },
  };
}

/**
 * How near a bend's line, as a share of the sheet, a crease's ends lie for it
 * to lie along the bend: past the float rounding of the mesh's positions.
 */
const ON_BEND_RELATIVE = 1e-6;

/**
 * The crease buffer as the window's edge pass draws it, with every crease along
 * a bend on two ends of its own: its two vertices, each named over a triangle
 * of its own layer's plane — the two and the vertex of its slot farthest from
 * their line. The edge shader reads that plane from the end (`faceSlope`) and
 * lays the crease's ribbon on it across its width; null when there is nothing
 * to name.
 *
 * A ribbon at one depth sinks into its paper on the side that rises toward
 * the eye. Across a concave bend both planes rise from the fold, so the crease
 * there drew nowhere, where the picture draws it over both faces. Each plane's
 * copy of a hinge now lies on its own plane: it shows over its own paper and
 * goes under the other plane's, whose copy shows there, and the two make the
 * whole line. A crease that only lies along a bend — a layer's raw edge, or a
 * flat crease, on the fold line, where the layer it covers ends exactly there —
 * has no copy across the fold and shows over its own paper alone.
 *
 * For the window alone. The vector scene finds a crease's layer by the ring
 * vertices it shares, which these ends do not.
 */
export function folded3dHingeEnds(
  mesh: Pick<Folded3dMesh, 'positions' | 'topology' | 'slots' | 'hinges' | 'sheet'>
): { edgeIndices: Uint32Array; virtual: VirtualVertices } | null {
  const { positions, topology, slots, hinges } = mesh;
  const start = Math.floor(positions.length / 3);
  const edgeIndices = topology.edgeIndices.slice();
  const nodes: number[] = [];
  const weights: number[] = [];
  const along = creasesAlongBends(positions, topology.edgeIndices, hinges.bend, ON_BEND_RELATIVE * mesh.sheet);
  for (let edge = 0; edge < hinges.bend.length; edge += 1) {
    const a = topology.edgeIndices[edge * 2]!;
    const b = topology.edgeIndices[edge * 2 + 1]!;
    if (!hinges.bend[edge] && !along[edge]) continue;
    const slot = slotOfVertex(slots.vertexStart, a);
    if (slot < 0) continue;
    const apex = farthestFromLine(positions, a, b, slots.vertexStart[slot]!, slots.vertexStart[slot + 1]!);
    if (apex < 0) continue;
    edgeIndices[edge * 2] = start + nodes.length / 3;
    nodes.push(a, b, apex);
    weights.push(1, 0, 0);
    edgeIndices[edge * 2 + 1] = start + nodes.length / 3;
    nodes.push(a, b, apex);
    weights.push(0, 1, 0);
  }
  if (nodes.length === 0) return null;
  return {
    edgeIndices,
    virtual: { start, nodes: Uint32Array.from(nodes), weights: Float32Array.from(weights) },
  };
}

/** A bend's segment, as a crease is measured against it. */
interface BendLine {
  origin: Vec3;
  end: Vec3;
  direction: Vec3;
  length: number;
}

/** Most cells along an axis of the bend grid, so a sliver of a bend cannot ask for a grid the size of memory. */
const BEND_GRID_MAX_CELLS = 1024;

/**
 * Per crease of `edgeIndices`, 1 where it lies along a bend: both ends within
 * `tolerance` of a bend's line, and the two spans overlapping by more than
 * that.
 *
 * Measuring every crease against every bend cost their product, and a large
 * figure has thousands of each. A crease that passes either has an end beside
 * the bend, within twice the tolerance of its segment, or reaches past both of
 * the bend's ends, which then lie beside the crease. So a grid files each bend
 * under the cells its segment passes near and under its two ends' cells
 * (`bendGrid`), and a crease is measured only against the bends filed near its
 * own ends and those with an end along it: the same test, on every bend that
 * could pass it.
 */
export function creasesAlongBends(
  positions: Float32Array,
  edgeIndices: ArrayLike<number>,
  bend: ArrayLike<number>,
  tolerance: number
): Uint8Array {
  const count = bend.length;
  const out = new Uint8Array(count);
  const lines = bendLinesOf(positions, edgeIndices, bend, tolerance);
  if (lines.length === 0) return out;
  const grid = bendGrid(lines, tolerance);
  // Each bend is measured once per crease, however many cells hold it.
  const tried = new Int32Array(lines.length).fill(-1);
  let crease = -1;
  let pa: Vec3 = [0, 0, 0];
  let pb: Vec3 = [0, 0, 0];
  const passes = (line: number): boolean => {
    if (tried[line] === crease) return false;
    tried[line] = crease;
    return liesAlong(lines[line]!, pa, pb, tolerance);
  };
  for (crease = 0; crease < count; crease += 1) {
    pa = vertexAt(positions, edgeIndices[crease * 2]!);
    pb = vertexAt(positions, edgeIndices[crease * 2 + 1]!);
    if (grid.some(pa, pb, passes)) out[crease] = 1;
  }
  return out;
}

/** Each bend's segment once, longer than `tolerance`. */
function bendLinesOf(
  positions: Float32Array,
  edgeIndices: ArrayLike<number>,
  bend: ArrayLike<number>,
  tolerance: number
): BendLine[] {
  const lines: BendLine[] = [];
  const seen = new Set<string>();
  for (let edge = 0; edge < bend.length; edge += 1) {
    if (!bend[edge]) continue;
    const a = edgeIndices[edge * 2]!;
    const b = edgeIndices[edge * 2 + 1]!;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const origin = vertexAt(positions, a);
    const end = vertexAt(positions, b);
    const d: Vec3 = [end[0] - origin[0], end[1] - origin[1], end[2] - origin[2]];
    const length = Math.hypot(d[0], d[1], d[2]);
    if (length > tolerance) lines.push({ origin, end, direction: [d[0] / length, d[1] / length, d[2] / length], length });
  }
  return lines;
}

/** Whether the segment `pa`–`pb` lies along `line`: see {@link creasesAlongBends}. */
function liesAlong({ origin, direction, length }: BendLine, pa: Vec3, pb: Vec3, tolerance: number): boolean {
  const place = (p: Vec3) => {
    const v: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    const along = v[0] * direction[0] + v[1] * direction[1] + v[2] * direction[2];
    const off = Math.hypot(v[0] - along * direction[0], v[1] - along * direction[1], v[2] - along * direction[2]);
    return { along, off };
  };
  const ea = place(pa);
  const eb = place(pb);
  if (ea.off > tolerance || eb.off > tolerance) return false;
  return Math.max(ea.along, eb.along) > tolerance && Math.min(ea.along, eb.along) < length - tolerance;
}

function vertexAt(positions: Float32Array, vertex: number): Vec3 {
  return [positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!];
}

function isFiniteVec3(p: Vec3): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
}

/**
 * The bends in a uniform grid of cells about as long as a bend: each under the
 * cells that pieces of its segment no longer than a cell, grown by twice the
 * tolerance, overlap (`near`), and under its two ends' cells (`ends`).
 *
 * `some(pa, pb, test)` asks `test` of the bends `near` the crease's two ends
 * and of those with an end in a cell along the crease, grown the same way, and
 * says whether one passed. What the grid cannot place is measured against
 * everything instead: a bend that is not finite against every crease, and a
 * crease that is not finite, or reaches so far past the bends that a walk
 * along it would round by more than the pad, against every bend. The test's
 * arithmetic on infinities is not the geometry's, so neither is skipped.
 */
function bendGrid(
  lines: readonly BendLine[],
  tolerance: number
): { some: (pa: Vec3, pb: Vec3, test: (line: number) => boolean) => boolean } {
  const everywhere: number[] = [];
  const filed: number[] = [];
  let scale = 0;
  let total = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!isFiniteVec3(line.origin) || !isFiniteVec3(line.end) || !Number.isFinite(line.length)) {
      everywhere.push(index);
      continue;
    }
    filed.push(index);
    total += line.length;
    for (let axis = 0; axis < 3; axis += 1) {
      scale = Math.max(scale, Math.abs(line.origin[axis]!), Math.abs(line.end[axis]!));
    }
  }
  // Twice the tolerance, past the rounding of the test's own arithmetic. None
  // only for a negative tolerance with every bend a point at the origin, and a
  // bend of no length passes nothing: its direction is not a number.
  const pad = 2 * Math.max(0, tolerance) + 1e-9 * scale;
  if (filed.length === 0 || !(pad > 0)) return { some: (_pa, _pb, test) => everywhere.some(test) };
  // A walk along a crease rounds by about 1e-15 of its coordinates, which the
  // pad's 1e-9 of the bends' covers while those are within this.
  const reach = 1e4 * scale;
  const placed = (p: Vec3): boolean => Math.abs(p[0]) <= reach && Math.abs(p[1]) <= reach && Math.abs(p[2]) <= reach;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const index of filed) {
    const { origin, end } = lines[index]!;
    for (let axis = 0; axis < 3; axis += 1) {
      lo[axis] = Math.min(lo[axis]!, origin[axis]! - pad, end[axis]! - pad);
      hi[axis] = Math.max(hi[axis]!, origin[axis]! + pad, end[axis]! + pad);
    }
  }
  // About a bend long, finer where many long bends share little room, and never
  // so fine that the grid outgrows its cap or a cell is narrower than the pad.
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const size = Math.max(
    Math.min(total / filed.length, extent / Math.cbrt(filed.length)),
    extent / BEND_GRID_MAX_CELLS,
    2 * pad
  );
  const dims = [0, 1, 2].map((axis) => Math.floor((hi[axis]! - lo[axis]!) / size) + 1) as [number, number, number];
  // Clamped, not cut: an index past the grid maps onto its edge cell on both
  // sides of a lookup, so a point just outside still finds what was filed there.
  const cellOf = (value: number, axis: number): number =>
    Math.min(dims[axis]! - 1, Math.max(0, Math.floor((value - lo[axis]!) / size)));
  const keyOf = (x: number, y: number, z: number): number => (x * dims[1] + y) * dims[2] + z;
  const pointKey = (p: Vec3): number => keyOf(cellOf(p[0], 0), cellOf(p[1], 1), cellOf(p[2], 2));
  /** Each cell of the box `min`–`max` grown by `pad`, until `visit` says stop. */
  const eachCell = (min: Vec3, max: Vec3, visit: (key: number) => boolean): boolean => {
    const x1 = cellOf(max[0] + pad, 0);
    const y1 = cellOf(max[1] + pad, 1);
    const z1 = cellOf(max[2] + pad, 2);
    for (let x = cellOf(min[0] - pad, 0); x <= x1; x += 1) {
      for (let y = cellOf(min[1] - pad, 1); y <= y1; y += 1) {
        for (let z = cellOf(min[2] - pad, 2); z <= z1; z += 1) {
          if (visit(keyOf(x, y, z))) return true;
        }
      }
    }
    return false;
  };
  /** `a`–`b` from `t0` to `t1` in pieces no longer than a cell, each piece's box to `visit`, until it says stop. */
  const eachPiece = (a: Vec3, b: Vec3, t0: number, t1: number, visit: (min: Vec3, max: Vec3) => boolean): boolean => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * (t1 - t0);
    const pieces = Math.max(1, Math.ceil(length / size));
    const at = (t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    let from = at(t0);
    for (let piece = 1; piece <= pieces; piece += 1) {
      const to = at(t0 + ((t1 - t0) * piece) / pieces);
      const min: Vec3 = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])];
      const max: Vec3 = [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])];
      if (visit(min, max)) return true;
      from = to;
    }
    return false;
  };

  const near = new Map<number, number[]>();
  const ends = new Map<number, number[]>();
  const file = (cells: Map<number, number[]>, key: number, line: number): void => {
    const list = cells.get(key);
    if (!list) cells.set(key, [line]);
    else if (list[list.length - 1] !== line) list.push(line);
  };
  for (const index of filed) {
    const { origin, end } = lines[index]!;
    eachPiece(origin, end, 0, 1, (min, max) =>
      eachCell(min, max, (key) => {
        file(near, key, index);
        return false;
      })
    );
    file(ends, pointKey(origin), index);
    file(ends, pointKey(end), index);
  }

  const inGrid: [Vec3, Vec3] = [
    [lo[0] - pad, lo[1] - pad, lo[2] - pad],
    [hi[0] + pad, hi[1] + pad, hi[2] + pad],
  ];
  return {
    some(pa, pb, test) {
      if (everywhere.some(test)) return true;
      // Not finite, or too far out to walk: every bend.
      if (!placed(pa) || !placed(pb)) return filed.some(test);
      // An end beside a bend.
      for (const point of [pa, pb]) {
        if (near.get(pointKey(point))?.some(test)) return true;
      }
      // A bend's end beside the crease: walked only where the grid is.
      const span = clipToBox(pa, pb, inGrid[0], inGrid[1]);
      if (!span) return false;
      return eachPiece(pa, pb, span[0], span[1], (min, max) =>
        eachCell(min, max, (key) => ends.get(key)?.some(test) ?? false)
      );
    },
  };
}

/** The stretch `[t0, t1]` of `a + t·(b − a)`, `t ∈ [0, 1]`, inside the box `min`–`max`; null when none is. */
function clipToBox(a: Vec3, b: Vec3, min: Vec3, max: Vec3): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const from = a[axis]!;
    const d = b[axis]! - from;
    if (d === 0) {
      if (from < min[axis]! || from > max[axis]!) return null;
      continue;
    }
    const u = (min[axis]! - from) / d;
    const v = (max[axis]! - from) / d;
    t0 = Math.max(t0, Math.min(u, v));
    t1 = Math.min(t1, Math.max(u, v));
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/** The slot whose vertices hold `vertex`, by `vertexStart`; -1 for one past them all. */
function slotOfVertex(vertexStart: Uint32Array, vertex: number): number {
  let lo = 0;
  let hi = vertexStart.length - 2;
  if (hi < 0 || vertex < vertexStart[0]! || vertex >= vertexStart[hi + 1]!) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (vertexStart[mid]! <= vertex) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Of vertices `[from, to)`, the one farthest from the line through `a` and `b`;
 * -1 when every one lies on it, to a millionth of the segment's length.
 */
function farthestFromLine(positions: Float32Array, a: number, b: number, from: number, to: number): number {
  const ax = positions[a * 3]!;
  const ay = positions[a * 3 + 1]!;
  const az = positions[a * 3 + 2]!;
  const ux = positions[b * 3]! - ax;
  const uy = positions[b * 3 + 1]! - ay;
  const uz = positions[b * 3 + 2]! - az;
  const length = Math.hypot(ux, uy, uz);
  if (!(length > 0)) return -1;
  let best = -1;
  let bestDistance = 1e-6 * length;
  for (let vertex = from; vertex < to; vertex += 1) {
    const dx = positions[vertex * 3]! - ax;
    const dy = positions[vertex * 3 + 1]! - ay;
    const dz = positions[vertex * 3 + 2]! - az;
    const distance = Math.hypot(dy * uz - dz * uy, dz * ux - dx * uz, dx * uy - dy * ux) / length;
    if (distance > bestDistance) {
      best = vertex;
      bestDistance = distance;
    }
  }
  return best;
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
