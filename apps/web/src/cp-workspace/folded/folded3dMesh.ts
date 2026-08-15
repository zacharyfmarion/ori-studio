/**
 * The kernel's 3D render model, as a mesh the simulator's `MeshRenderer` draws.
 *
 * A folded figure has no solver. `MeshRenderer` reads every vertex from a
 * position *texture* the solver normally writes each step, so the whole of this
 * module is: pack the positions once, describe the triangles once, and hand both
 * over. After that a frame is a uniform change and a draw, which is the entire
 * reason a 3D figure can be a live viewport at all.
 *
 * # The crux: making a depth buffer draw a flat stack
 *
 * A folded model's layers are **exactly coplanar**. A depth buffer cannot order
 * them — same z, so they z-fight — which is why ORIPA keeps an overlap matrix
 * and why the CPU projector beside this file resolves order with a BSP. The
 * simulator escapes the problem only because it is mass-spring and its layers
 * are never exactly coincident.
 *
 * We have what ORIPA does not: **the kernel already computed the layer order**.
 * So each cell's ring is emitted once per face in its `cell_stack`, displaced
 * along the plane's `up` by that slot's index times {@link Folded3dMesh.eps}.
 * The z-buffer then reproduces an order we already know, and depth, lighting and
 * 60 fps come with it.
 *
 * # Cells, not faces — and why nothing is sorted
 *
 * The drawable unit is a **(cell, stack slot) pair**, never a face. A per-face
 * scalar height would be exactly a topological sort of the face partial order,
 * and that order is legitimately **cyclic** — the `pinwheel_cyclic` fixture
 * orders four arms `0 > 4 > 3 > 2 > 0`. Displacing per cell needs no global
 * order at all, so a cyclic model works by construction rather than by
 * exception, and it matches the payload's own statement that cells are the
 * drawable unit.
 *
 * # Creases belong to a layer, and are drawn from that layer's ring
 *
 * A crease is **not** one line at the fold. It is emitted once per `(cell,
 * slot)` whose paper ends there, from that slot's own copy of the cell ring, so
 * it carries the displacement of the layer it belongs to.
 *
 * It used to be one undisplaced line per model edge, and that is what made
 * buried flaps show through: a crease at the true fold line sits in the *middle*
 * of every stack it runs through, so it is behind the near half of its own —
 * including the layer you can see. The edge pass compensated with a constant
 * `−0.0008` of NDC z, which at `depthRange = 2r` is `1.6e-3 · r` of world depth
 * and therefore larger than {@link STACK_SPAN_LIMIT} could ever make a whole
 * stack. Every buried layer's creases rode that bias in front of every layer
 * above them. Measured on the reported `540-level-0`, 43% of the crease ink
 * landing on paper existed only because of it, and shrinking the constant was
 * not available: at zero, half the *visible* layer's creases go too.
 *
 * Drawing from the ring fixes it structurally and costs **no vertices** — a
 * slot already emits its own copy of the ring, so the crease is two indices into
 * vertices that are already there. The count goes *down* by `2 · edge_count`.
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
 * One layer gap, as a fraction of `modelRadius`.
 *
 * The tunable number. Two bounds have to hold at once and this sits between
 * them with room to spare.
 *
 * *Below*, the depth buffer has to resolve one gap. `cameraUniforms` sets
 * `depthRange = 2r` and the shader writes `ndcZ = −depth/depthRange`, so a model
 * spanning `±r` of view depth occupies NDC z `[−0.5, 0.5]` — **half** the depth
 * buffer, window z `[0.25, 0.75]`. A world gap of `d` is therefore `d/(4r)` of
 * the buffer: at `2e-4 · r` that is 839 units of a 24-bit buffer.
 *
 * *Above*, {@link STACK_SPAN_LIMIT}.
 *
 * At a 512 px frame `2e-4 · r` is 0.04 px on screen and a five-layer stack spans
 * 0.17 px. Seen edge-on the displacement is entirely lateral, which reads as a
 * ply stack rather than as a zero-thickness line.
 */
export const EPS_RELATIVE = 2e-4;

/**
 * How much of `modelRadius` a whole stack may span.
 *
 * Two things used to be true of this number and only one still is.
 *
 * It was set to **half** the edge pass's then-constant `−0.0008` NDC crease
 * bias (`1.6e-3 · r` of world depth), because a crease drawn at the fold line
 * had to out-bias its own stack or the visible layer lost its linework. That
 * coupling is gone: creases now carry their layer's displacement, and the bias
 * is a fraction of one gap ({@link folded3dCreaseDepthBias}). Nothing forces
 * this cap to sit below anything the edge pass does any more, so it is now free
 * to be chosen on depth-buffer resolution and sub-pixel displacement alone —
 * see the plan's Phase 6. It is left where it was so this change is about
 * creases and nothing else.
 *
 * What still holds is the resolution argument. Deep stacks are the real
 * population, not an edge case: the committed fixtures reach 5, but the external
 * non-flat corpus reaches **14** (`plant_penguin.osf`), with four models at 10.
 * At 14 the cap gives `6.15e-5 · r`, which is still 258 units of a 24-bit depth
 * buffer — and only 1.01 of a 16-bit one. A 16-bit default framebuffer is legal
 * WebGL2, and `webglSolver.ts`'s headless `renderToImage` path already allocates
 * one explicitly, which is what `shallowDepthBuffer` reports so it fails loudly
 * rather than as unexplained shimmer.
 */
export const STACK_SPAN_LIMIT = 8e-4;

/**
 * How much of one layer gap the whole intra-plane draw-rank nudge may use.
 *
 * `draw_rank` is the kernel's order among the cells of one plane, sorted by
 * descending area so a contained cell ranks above its container. Cells of a
 * plane are normally area-disjoint and it decides nothing; where a decomposition
 * slips a containment through, the z-buffer would otherwise leave the outcome to
 * chance. Nudging by well under one gap cannot reorder any stack, because rank
 * is constant across a cell and so shifts its whole stack together.
 */
export const RANK_NUDGE_FRACTION = 0.05;

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
   */
  indexStart: Uint32Array;
  /**
   * The vertex half of the same record: slot `i` owns vertices
   * `[vertexStart[i], vertexStart[i + 1])` of {@link Folded3dMesh.positions},
   * one per point of its cell's ring, in ring order. Also `count + 1` long.
   *
   * A slot's vertices are its own copy of the ring — that is what displacing a
   * layer means — so this is the range to touch to highlight one layer, and the
   * range a test reads to see the displacement that was actually applied.
   */
  vertexStart: Uint32Array;
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
   * Centroid-relative because f32 at absolute paper coordinates has an ULP
   * around 3e-5, and keeping `eps` three orders above ULP must not depend on
   * where on the page the figure happens to sit.
   */
  positions: Float32Array;
  topology: MeshTopology;
  /** Always `[0, 0, 0]`: {@link positions} is already centroid-relative. */
  center: [number, number, number];
  /**
   * `modelRadius` of the *undisplaced* model — the same number
   * `folded3dFrameRadius` sizes the figure's frame from, so the mesh cannot
   * overflow the window it is drawn in. Displacement perturbs it by at most
   * `STACK_SPAN_LIMIT / 2` of itself.
   */
  radius: number;
  /** The layer gap actually used, in world units. */
  eps: number;
  /** Deepest `cell_stack` in this model, which is what capped {@link eps}. */
  maxStackDepth: number;
  slots: Folded3dMeshSlots;
  /**
   * The slot each crease belongs to, `-1` for one that belongs to no layer.
   * One entry per `topology.edgeAssignments`.
   *
   * A per-crease record rather than a per-slot range, because the creases are
   * not in slot order: the ones a layer buried inside its own stack owns are
   * held back to the end (see {@link interiorEdgeStart}).
   */
  creaseSlot: Int32Array;
  /**
   * Where the creases of **interior** layers begin — layers that are neither the
   * top nor the bottom of their cell's stack.
   *
   * They are never on show through opaque paper. A cell is by definition covered
   * by every face in its stack, so an interior layer is behind the top from one
   * side and behind the bottom from the other, from every camera. Drawing them
   * is what put a buried flap's outline on the outside of the paper covering it,
   * and the depth buffer cannot be asked to remove them: a crease lies on a
   * *cell boundary* by construction, which is exactly where the displacement of
   * the covering face is discontinuous — the same face sits at `((n − 1) / 2)·eps`
   * as the top of an n-deep cell and at `0` as the only layer of the cell next
   * door, so a buried crease at `0` is level with the neighbour's paper and the
   * bias tips it in front.
   *
   * They are emitted, at the end, rather than dropped, because a translucent
   * style shows the whole stack and wants them — the same rule the CPU projector
   * applies. `folded3dDrawPasses` decides.
   */
  interiorEdgeStart: number;
  /**
   * Where the undetermined cells' slots begin, in {@link slots}, in
   * `topology.faceIndices` and in `topology.edgeIndices` respectively — the
   * last counted in **edges**.
   *
   * Cells the solver could not order get **no displacement** — displacing them
   * by the kernel's fallback ranking would present an invented stacking as fact
   * — so their slots are exactly coincident and will z-fight. They are emitted
   * last so a caller can draw them separately (translucent, as the CPU projector
   * does today) without re-deriving which they are. Equal to `slots.count`,
   * `faceIndices.length` and `edgeAssignments.length` when every cell is
   * determined.
   */
  undeterminedSlotStart: number;
  undeterminedIndexStart: number;
  undeterminedEdgeStart: number;
  /**
   * Creases at the head of `topology.edgeIndices` that belong to no slot.
   *
   * The fallback for a model edge no `(cell, slot)` inks — see
   * `Folded3dInk.orphanEdges`. Each is drawn the old way, one undisplaced line
   * at its true endpoints, so a match that fails degrades to the picture before
   * creases carried a layer rather than to a missing crease. Expected zero, and
   * a figure that reports otherwise is worth looking at.
   *
   * At the head rather than the tail so the undetermined split stays a single
   * cut: they draw with the determined pass, which is the opaque one.
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

/**
 * The layer gap for a model of this radius and this deepest stack.
 *
 * Exported because it is the number the whole displacement scheme rests on and
 * a test asserting the depth budget has to be able to ask for it directly.
 */
export function folded3dLayerEpsilon(radius: number, maxStackDepth: number): number {
  const perLayerCap = STACK_SPAN_LIMIT / Math.max(1, maxStackDepth - 1);
  return Math.min(EPS_RELATIVE, perLayerCap) * radius;
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
 * `vertexCount` is an **upper bound** and `slotVertexCount` is exact. Creases
 * cost no vertices now that they are drawn from their slot's ring, except in the
 * fallback where a model edge is inked nowhere
 * ({@link Folded3dMesh.fallbackEdgeCount}) — so the slack is `2 · edge_count`
 * less what was inked, and asking would mean building the ink. Bounding is the
 * safe direction for a budget check: it can refuse a figure it did not have to,
 * never admit one that then blows the limit.
 */
export function folded3dMeshExtent(model: OristudioCpFolded3dRenderModel): {
  vertexCount: number;
  slotVertexCount: number;
  maxStackDepth: number;
  maxDrawRank: number;
} {
  let maxStackDepth = 0;
  let maxDrawRank = 0;
  let slotVertexCount = 0;
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
    const ringLength = model.cell_attr[base + 2] ?? 0;
    const stackLength = model.cell_attr[base + 4] ?? 0;
    maxStackDepth = Math.max(maxStackDepth, stackLength);
    maxDrawRank = Math.max(maxDrawRank, model.cell_attr[base + 6] ?? 0);
    if (ringLength >= 3) slotVertexCount += ringLength * stackLength;
  }
  return {
    vertexCount: slotVertexCount + model.edge_count * 2,
    slotVertexCount,
    maxStackDepth,
    maxDrawRank,
  };
}

export function folded3dMesh(model: OristudioCpFolded3dRenderModel): Folded3dMeshResult {
  const centre = toSimBasis(modelCentroid(model));
  const radius = modelRadius(model);

  const { vertexCount, slotVertexCount, maxStackDepth, maxDrawRank } =
    folded3dMeshExtent(model);
  if (vertexCount > FOLDED_3D_MESH_VERTEX_BUDGET) {
    return { kind: 'too-large', vertexCount, limit: FOLDED_3D_MESH_VERTEX_BUDGET };
  }

  const eps = folded3dLayerEpsilon(radius, maxStackDepth);
  const rankNudge = (eps * RANK_NUDGE_FRACTION) / Math.max(1, maxDrawRank);
  const minArea2 = MIN_TRIANGLE_AREA_RELATIVE * Math.max(radius * radius, Number.MIN_VALUE);

  // Where each layer's paper ends, which is what the crease pass draws. Built
  // before anything is placed, because the fallback it reports is what sizes the
  // vertex array.
  const ink = buildFolded3dInk(model);
  const assignmentOf = new Uint8Array(model.edge_count);
  for (let edge = 0; edge < model.edge_count; edge += 1) {
    assignmentOf[edge] = folded3dEdgeAssignment(
      model.edge_attr[edge * FOLDED_3D_EDGE_ATTR_STRIDE + 3] ?? 0,
      model.edge_fold_degrees[edge] ?? 0
    );
  }

  const positions = new Float32Array((slotVertexCount + ink.orphanEdges.length * 2) * 3);
  const faceIndices: number[] = [];
  const edgeIndices: number[] = [];
  const edgeAssignments: number[] = [];
  const slotCell: number[] = [];
  const slotFace: number[] = [];
  const slotDepth: number[] = [];
  const slotIndexStart: number[] = [];
  const slotVertexStart: number[] = [];
  const creaseSlot: number[] = [];
  // Creases of layers buried inside their own stack. Held back so the opaque
  // draw can stop before them -- see `Folded3dMesh.interiorEdgeStart`.
  const interiorIndices: number[] = [];
  const interiorAssignments: number[] = [];
  const interiorSlot: number[] = [];
  let vertex = 0;

  let undeterminedSlotStart = 0;
  let undeterminedIndexStart = 0;
  let undeterminedEdgeStart = 0;

  // The fallback, at the head of the crease arrays and the tail of the vertex
  // array: a model edge no slot inked, drawn the old way at its true endpoints.
  // Expected empty. It is emitted first so the undetermined split below stays a
  // single cut through the crease arrays — these belong to the opaque pass, and
  // to no slot.
  let fallbackVertex = slotVertexCount;
  for (const edge of ink.orphanEdges) {
    const [a, b] = edgeEnds(model, edge);
    for (const point of [a, b]) {
      const sim = toSimBasis(point);
      positions[fallbackVertex * 3] = sim[0] - centre[0];
      positions[fallbackVertex * 3 + 1] = sim[1] - centre[1];
      positions[fallbackVertex * 3 + 2] = sim[2] - centre[2];
      fallbackVertex += 1;
    }
    edgeIndices.push(fallbackVertex - 2, fallbackVertex - 1);
    edgeAssignments.push(assignmentOf[edge] ?? 0);
    creaseSlot.push(-1);
  }
  const fallbackEdgeCount = edgeAssignments.length;

  // Determined cells first, undetermined last, so a caller can draw the two
  // groups with different settings without re-deriving which is which.
  for (const wantUndetermined of [false, true]) {
    if (wantUndetermined) {
      undeterminedSlotStart = slotCell.length;
      undeterminedIndexStart = faceIndices.length;
      undeterminedEdgeStart = edgeAssignments.length;
    }
    for (let cell = 0; cell < model.cell_count; cell += 1) {
      const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
      const undetermined =
        (model.cell_attr[base + 5] ?? 0) === FOLDED_3D_CELL_UNDETERMINED;
      if (undetermined !== wantUndetermined) continue;

      const ring = cellRing(model, cell);
      if (ring.length < 3) continue;
      const stack = cellStack(model, cell);
      if (stack.length === 0) continue;

      const frame = planeFrame(model, model.cell_attr[base] ?? 0);
      const drawRank = model.cell_attr[base + 6] ?? 0;

      // The ring, triangulated once, in the plane's **own** `(u, v)`. Never a
      // locally re-derived tangent: a different chirality reverses every stack
      // read off the projected winding, and the payload says so in as many
      // words.
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
        // Centred on the plane rather than stacked upward from it, so the
        // displaced mesh keeps the undisplaced centroid and radius -- the
        // numbers the camera fit and the figure's frame already read. An
        // uncentred stack would slide a deep plane bodily to one side.
        //
        // `cell_stack` is top-first with respect to `up`, so slot 0 takes the
        // largest `+up` offset. An undetermined cell takes none at all: there is
        // no order to express, and displacing by the kernel's fallback ranking
        // would present an invented stacking as fact.
        const offset = undetermined
          ? 0
          : ((stack.length - 1) / 2 - slot) * eps + drawRank * rankNudge;

        const first = vertex;
        slotVertexStart.push(first);
        for (const point of ring) {
          const world: Vec3 = [
            point[0] + frame.up[0] * offset,
            point[1] + frame.up[1] * offset,
            point[2] + frame.up[2] * offset,
          ];
          const sim = toSimBasis(world);
          positions[vertex * 3] = sim[0] - centre[0];
          positions[vertex * 3 + 1] = sim[1] - centre[1];
          positions[vertex * 3 + 2] = sim[2] - centre[2];
          vertex += 1;
        }

        // Which way this slot's triangles wind is a **per-face** question, not a
        // per-cell one: `facing` flips between faces of one plane, so slots of
        // one cell can want opposite orientations. Sharing one index order
        // across a stack would paint the whole cell one colour and lose the
        // two-tone layering the flat path shows today.
        //
        // A triangle CCW in `(u, v)` has right-hand normal `+up`, and the paper
        // front is `facing * up`; the renderer colours a triangle **front** when
        // its right-hand normal points *away* from the eye, so the wanted normal
        // is `−facing * up` and the wanted `(u, v)` winding sign is `−facing`.
        // Decided per triangle from the emitted geometry rather than trusted
        // from the ring or from earcut, neither of which promises an
        // orientation.
        const facing = model.face_attr[face * FOLDED_3D_FACE_ATTR_STRIDE + 3] ?? 1;
        const wantPositive = facing < 0;
        slotIndexStart.push(faceIndices.length);
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
          if (area2 > 0 === wantPositive) {
            faceIndices.push(first + a, first + b, first + c);
          } else {
            faceIndices.push(first + a, first + c, first + b);
          }
        }
        // The creases, from this slot's own ring vertices: two indices each,
        // no geometry. A segment is inked where *this layer's* paper ends and
        // skipped where the layer runs across an arrangement cut some other
        // face made — which is the whole of the occlusion fix, because the
        // alternative is one line at the fold that belongs to no layer.
        //
        // Routinely empty: a layer buried under a wider face ends nowhere
        // inside it.
        //
        // A layer that is neither the top nor the bottom of its stack is never
        // on show through opaque paper, and its creases go to the back of the
        // buffer rather than into the draw. An undetermined cell has no order to
        // be inside of — its slots are deliberately left coincident — so every
        // one of them counts as outer.
        const outer = undetermined || slot === 0 || slot === stack.length - 1;
        const intoIndices = outer ? edgeIndices : interiorIndices;
        const intoAssignments = outer ? edgeAssignments : interiorAssignments;
        const intoSlot = outer ? creaseSlot : interiorSlot;
        for (let segment = 0; segment < ring.length; segment += 1) {
          const edge = ink.edgeAt(cell, slot, segment);
          if (edge < 0) continue;
          intoIndices.push(first + segment, first + ((segment + 1) % ring.length));
          intoAssignments.push(assignmentOf[edge] ?? 0);
          intoSlot.push(slotCell.length);
        }

        slotCell.push(cell);
        slotFace.push(face);
        slotDepth.push(slot);
      }
    }
  }
  // Close both runs, so slot `i` owns `[start[i], start[i + 1])` in each.
  slotIndexStart.push(faceIndices.length);
  slotVertexStart.push(vertex);

  // The interior layers' creases, after everything the opaque draw wants.
  const interiorEdgeStart = edgeAssignments.length;
  for (let i = 0; i < interiorAssignments.length; i += 1) {
    edgeIndices.push(interiorIndices[i * 2]!, interiorIndices[i * 2 + 1]!);
    edgeAssignments.push(interiorAssignments[i]!);
    creaseSlot.push(interiorSlot[i]!);
  }

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
      eps,
      maxStackDepth,
      slots: {
        count: slotCell.length,
        cell: Int32Array.from(slotCell),
        face: Int32Array.from(slotFace),
        depth: Int32Array.from(slotDepth),
        indexStart: Uint32Array.from(slotIndexStart),
        vertexStart: Uint32Array.from(slotVertexStart),
      },
      creaseSlot: Int32Array.from(creaseSlot),
      interiorEdgeStart,
      undeterminedSlotStart,
      undeterminedIndexStart,
      undeterminedEdgeStart,
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
