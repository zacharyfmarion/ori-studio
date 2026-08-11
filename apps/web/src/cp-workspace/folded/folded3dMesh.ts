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
 * The edge pass biases creases toward the viewer by a fixed `−0.0008` of NDC z
 * (`meshRenderer.ts`), which at `depthRange = 2r` is `1.6e-3 · r` of world
 * depth. A stack spanning more than that swallows its own top layer's creases,
 * so the span is capped at half the bias for margin and {@link EPS_RELATIVE}
 * shrinks to fit once a stack is deeper than 5.
 *
 * Deep stacks are the real population, not an edge case: the committed fixtures
 * reach 5, but the external non-flat corpus reaches **14** (`plant_penguin.osf`),
 * with four models at 10. At 14 the cap gives `6.15e-5 · r`, which is still 258
 * units of a 24-bit depth buffer — and only 1.01 of a 16-bit one. A 16-bit
 * default framebuffer is legal WebGL2, and `webglSolver.ts`'s headless
 * `renderToImage` path already allocates one explicitly. **Phase 3 must read
 * `gl.getParameter(gl.DEPTH_BITS)` with the default framebuffer bound** (it
 * reports the *bound* one, and 0 for a depthless FBO) and fail loudly rather
 * than as unexplained shimmer.
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
   * Where the undetermined cells' slots begin, in {@link slots} and in
   * `topology.faceIndices` respectively.
   *
   * Cells the solver could not order get **no displacement** — displacing them
   * by the kernel's fallback ranking would present an invented stacking as fact
   * — so their slots are exactly coincident and will z-fight. They are emitted
   * last so a caller can draw them separately (translucent, as the CPU projector
   * does today) without re-deriving which they are. Equal to `slots.count` and
   * `faceIndices.length` when every cell is determined.
   */
  undeterminedSlotStart: number;
  undeterminedIndexStart: number;
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
 * One integer pass over `cell_attr` — no triangulation, no allocation — so a
 * caller deciding *whether* a figure can be meshed does not have to mesh it to
 * find out. {@link folded3dMesh} runs the same pass, because all three numbers
 * are needed before a single vertex can be placed: `eps` depends on the deepest
 * stack anywhere in the model.
 */
export function folded3dMeshExtent(model: OristudioCpFolded3dRenderModel): {
  vertexCount: number;
  maxStackDepth: number;
  maxDrawRank: number;
} {
  let maxStackDepth = 0;
  let maxDrawRank = 0;
  let vertexCount = model.edge_count * 2;
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
    const ringLength = model.cell_attr[base + 2] ?? 0;
    const stackLength = model.cell_attr[base + 4] ?? 0;
    maxStackDepth = Math.max(maxStackDepth, stackLength);
    maxDrawRank = Math.max(maxDrawRank, model.cell_attr[base + 6] ?? 0);
    if (ringLength >= 3) vertexCount += ringLength * stackLength;
  }
  return { vertexCount, maxStackDepth, maxDrawRank };
}

export function folded3dMesh(model: OristudioCpFolded3dRenderModel): Folded3dMeshResult {
  const centre = toSimBasis(modelCentroid(model));
  const radius = modelRadius(model);

  const { vertexCount, maxStackDepth, maxDrawRank } = folded3dMeshExtent(model);
  if (vertexCount > FOLDED_3D_MESH_VERTEX_BUDGET) {
    return { kind: 'too-large', vertexCount, limit: FOLDED_3D_MESH_VERTEX_BUDGET };
  }

  const eps = folded3dLayerEpsilon(radius, maxStackDepth);
  const rankNudge = (eps * RANK_NUDGE_FRACTION) / Math.max(1, maxDrawRank);
  const minArea2 = MIN_TRIANGLE_AREA_RELATIVE * Math.max(radius * radius, Number.MIN_VALUE);

  const positions = new Float32Array(vertexCount * 3);
  const faceIndices: number[] = [];
  const slotCell: number[] = [];
  const slotFace: number[] = [];
  const slotDepth: number[] = [];
  const slotIndexStart: number[] = [];
  const slotVertexStart: number[] = [];
  let vertex = 0;

  let undeterminedSlotStart = 0;
  let undeterminedIndexStart = 0;

  // Determined cells first, undetermined last, so a caller can draw the two
  // groups with different settings without re-deriving which is which.
  for (const wantUndetermined of [false, true]) {
    if (wantUndetermined) {
      undeterminedSlotStart = slotCell.length;
      undeterminedIndexStart = faceIndices.length;
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
        slotCell.push(cell);
        slotFace.push(face);
        slotDepth.push(slot);
      }
    }
  }
  // Close both runs, so slot `i` owns `[start[i], start[i + 1])` in each. The
  // vertex sentinel is taken before the creases are appended, which is exactly
  // where the last slot's ring ends.
  slotIndexStart.push(faceIndices.length);
  slotVertexStart.push(vertex);

  // Creases sit at their true endpoints and are **not** displaced: a crease lies
  // on the intersection of two planes, so pushing it along either normal detaches
  // it from the fold, visibly -- and a face appears at several cell heights, so
  // there is no camera-independent height to pick. The edge shader's own
  // `−0.0008` NDC bias is what keeps them over their paper, and it is the budget
  // `STACK_SPAN_LIMIT` is measured against.
  const edgeIndices = new Uint32Array(model.edge_count * 2);
  const edgeAssignments = new Uint8Array(model.edge_count);
  for (let edge = 0; edge < model.edge_count; edge += 1) {
    const [a, b] = edgeEnds(model, edge);
    for (const point of [a, b]) {
      const sim = toSimBasis(point);
      positions[vertex * 3] = sim[0] - centre[0];
      positions[vertex * 3 + 1] = sim[1] - centre[1];
      positions[vertex * 3 + 2] = sim[2] - centre[2];
      vertex += 1;
    }
    edgeIndices[edge * 2] = vertex - 2;
    edgeIndices[edge * 2 + 1] = vertex - 1;
    edgeAssignments[edge] = folded3dEdgeAssignment(
      model.edge_attr[edge * FOLDED_3D_EDGE_ATTR_STRIDE + 3] ?? 0,
      model.edge_fold_degrees[edge] ?? 0
    );
  }

  return {
    kind: 'mesh',
    mesh: {
      positions,
      topology: {
        faceIndices: Uint32Array.from(faceIndices),
        edgeIndices,
        edgeAssignments,
        textureDim: textureSizeFor(vertexCount),
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
      undeterminedSlotStart,
      undeterminedIndexStart,
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
