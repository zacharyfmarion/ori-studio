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
import { EDGE_CODE, textureSizeFor, type MeshTopology, type Vec3 } from '@treemaker/origami-simulator';
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
   */
  hinges: { partnerPlane: Int32Array; requiredSide: Int8Array };
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
        });
      }

      // The document's aux lines this layer shows, each on two vertices of
      // the slot's own past its ring: unconditional, never a hinge.
      for (const cut of auxSlots.bySlot.get(cell)?.get(slot) ?? []) {
        const start = vertex;
        for (const point of cut) {
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
  const hingePartner: number[] = [];
  const hingeSide: number[] = [];
  const slotIndexStart: number[] = new Array<number>(slotCell.length).fill(0);

  const appendCrease = (crease: SlotCrease): void => {
    edgeIndices.push(crease.a, crease.b);
    edgeAssignments.push(crease.assignment);
    hingePartner.push(crease.hingePlane);
    hingeSide.push(crease.buried ? 0 : crease.requiredSide);
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
    hingePartner.push(-1);
    hingeSide.push(0);
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
      },
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
