/**
 * Reading the kernel's `Folded3dRenderModel` — the four strides, and nothing
 * else.
 *
 * The payload is struct-of-arrays (see {@link OristudioCpFolded3dRenderModel}),
 * so every consumer needs the same handful of index calculations. There are two
 * consumers now — the CPU projector, which is becoming the export path, and the
 * GPU mesh builder, which is becoming the live one — and the numbers they read
 * must be *the same numbers*, not the same formula written twice.
 *
 * {@link modelRadius} is the sharp case. It is what
 * `folded3dFrameRadius` sizes a figure's frame from and what the mesh scales its
 * layer displacement by, so a second copy that drifted by a hair would put the
 * model fractionally outside the window it is drawn in, at a size nobody could
 * explain from either file alone.
 *
 * Bodies here are lifted verbatim out of `foldedFigure3dProjection.ts`; the
 * projector's golden tests are the gate on that.
 */

import type { Vec3 } from '@treemaker/origami-simulator';
import {
  FOLDED_3D_CELL_ATTR_STRIDE,
  FOLDED_3D_EDGE_ATTR_STRIDE,
  FOLDED_3D_FACE_ATTR_STRIDE,
  FOLDED_3D_PLANE_FRAME_STRIDE,
  type OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';

/**
 * A plane's emitted frame.
 *
 * `u × v == up`, so counter-clockwise in `(u, v)` means the paper's front faces
 * `up` (`crates/oristudio-cp/src/folding3d/planes.rs`). **Emitted, never
 * recomputed** — a tangent re-derived from a local seed has a different
 * chirality, and every stack read off the projected winding then comes out
 * reversed.
 */
export interface PlaneFrame {
  up: Vec3;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

export function planeFrame(model: OristudioCpFolded3dRenderModel, plane: number): PlaneFrame {
  const base = plane * FOLDED_3D_PLANE_FRAME_STRIDE;
  const at = (offset: number): Vec3 => [
    model.plane_frames[base + offset] ?? 0,
    model.plane_frames[base + offset + 1] ?? 0,
    model.plane_frames[base + offset + 2] ?? 0,
  ];
  return { up: at(0), origin: at(3), u: at(6), v: at(9) };
}

export function cellRing(model: OristudioCpFolded3dRenderModel, cell: number): Vec3[] {
  const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
  const start = model.cell_attr[base + 1] ?? 0;
  const length = model.cell_attr[base + 2] ?? 0;
  const ring: Vec3[] = [];
  for (let i = 0; i < length; i += 1) {
    const at = (start + i) * 3;
    ring.push([
      model.cell_points[at] ?? 0,
      model.cell_points[at + 1] ?? 0,
      model.cell_points[at + 2] ?? 0,
    ]);
  }
  return ring;
}

/** Face ids of one cell, **top first** with respect to that cell's plane `up`. */
export function cellStack(model: OristudioCpFolded3dRenderModel, cell: number): number[] {
  const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
  const start = model.cell_attr[base + 3] ?? 0;
  const length = model.cell_attr[base + 4] ?? 0;
  return model.cell_stack.slice(start, start + length);
}

/** The side that face's paper front faces, in world coordinates. */
export function faceNormal(model: OristudioCpFolded3dRenderModel, face: number): Vec3 {
  const at = face * 3;
  return [
    model.face_normals[at] ?? 0,
    model.face_normals[at + 1] ?? 0,
    model.face_normals[at + 2] ?? 0,
  ];
}

export function edgeEnds(model: OristudioCpFolded3dRenderModel, edge: number): [Vec3, Vec3] {
  const at = edge * 6;
  return [
    [model.edge_points[at] ?? 0, model.edge_points[at + 1] ?? 0, model.edge_points[at + 2] ?? 0],
    [
      model.edge_points[at + 3] ?? 0,
      model.edge_points[at + 4] ?? 0,
      model.edge_points[at + 5] ?? 0,
    ],
  ];
}

/** Mean of every cell vertex — the point the projection is centred on. */
export function modelCentroid(model: OristudioCpFolded3dRenderModel): Vec3 {
  const count = Math.floor(model.cell_points.length / 3);
  if (count === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < count; i += 1) {
    x += model.cell_points[i * 3] ?? 0;
    y += model.cell_points[i * 3 + 1] ?? 0;
    z += model.cell_points[i * 3 + 2] ?? 0;
  }
  return [x / count, y / count, z / count];
}

/* --------------------------------------------------------------------------
 * Where a layer's paper ends
 * ----------------------------------------------------------------------- */

/**
 * How far a cell-ring endpoint may sit off a model edge and still count as
 * lying on it, as a fraction of `span`.
 *
 * A float-drift bar, not a geometric one. Overlap cells are arranged in a
 * plane's 2D `(u, v)` and then lifted back to world (`folding3d/model.rs`,
 * `render_model`), so their rings are a projection round trip away from the
 * `edge_points` they are matched against; a face that overlaps nothing becomes
 * its own cell straight from `placement.face_points` and matches exactly.
 *
 * The answer is not sensitive to the number, and that is why one is safe to
 * pick. Measured, the distance is sharply bimodal: a real match is at most
 * **7.6e-11** of span (worst over the committed fixtures plus the reported
 * `540-level-0`; the committed six are all under 5e-16), while the nearest
 * segment that is *not* on the face is **8.8e-3** — eight orders away. Anything
 * from 1e-10 to 1e-4 gives the same ink, and `inkIsNotSensitiveToTheTolerance`
 * in the tests holds that plateau open.
 *
 * Loose is the safe direction. A false positive needs a *second* edge of the
 * same face collinear with and containing this segment, which is a degenerate
 * face; a false negative silently drops a crease.
 */
export const FOLDED_3D_INK_TOLERANCE_RELATIVE = 1e-7;

/**
 * Which cell-ring segments each layer's paper actually ends at.
 *
 * The question both renderers have to answer to draw creases: given a cell, a
 * slot of its stack, and a segment of that cell's ring — is that segment an
 * *edge* of the paper at this layer, or does this layer continue across it?
 *
 * It exists because the arrangement is cut by **every** face in the plane. A
 * cell ring segment is a real crease for the face that ends there and an
 * invisible interior cut for the face that runs over it, and the two are the
 * same segment. Answering per `(cell, slot)` is what lets a crease be drawn at
 * the depth of the paper it belongs to instead of at the depth of the fold line,
 * which is what the whole occlusion fix rests on.
 *
 * Every segment fed to the arrangement in `folding3d/cells.rs` is a projected
 * **face ring edge** — there are no synthetic cuts — so every cell-ring segment
 * lies on some face's boundary and the only question is whose. That is what
 * makes the rule below total rather than a heuristic:
 *
 * > ink `(cell, slot holding face f, segment p→q)` iff some model edge incident
 * > to `f` contains both `p` and `q`.
 *
 * Built once per model, by both consumers, from the payload alone.
 */
/**
 * A crease segment where the paper **bends out of its own plane**, and where the
 * other side of that bend lives.
 *
 * A hinge is the one crease that belongs to two planes at once: the fold line is
 * the planes' line of intersection, so it is a ring segment of a cell in *each*
 * of them, at the same coordinates. Both cells ink it, and each knows only its
 * own stack — so a hinge buried under a higher layer of the **other** plane is
 * drawn anyway, by the plane that cannot see what buried it.
 *
 * Deciding it needs both planes' stacks, and it cannot be decided here, because
 * which layer of a plane is exposed depends on which side of that plane the eye
 * is on. So this says only what is camera-independent — *the partner face is
 * exposed on these sides of its plane* — and the renderer, which knows where the
 * eye is, does the rest.
 */
export interface Folded3dHinge {
  /** The plane on the far side of the bend. */
  partnerPlane: number;
  /** Whether the partner face is the outermost layer on `partnerPlane`'s `+1` side. */
  exposedOnPlus: boolean;
  /** …and on its `-1` side. Both true when the partner cell has a single layer. */
  exposedOnMinus: boolean;
}

export interface Folded3dInk {
  /**
   * The model edge drawn on `(cell, slot, segment)`, or `-1` for a segment this
   * layer runs across. `segment` `i` runs from ring vertex `i` to `i + 1`,
   * closing on the last.
   */
  edgeAt(cell: number, slot: number, segment: number): number;
  /**
   * Where the far side of this segment's bend sits, or `null` when the segment
   * is not a hinge — which includes a hinge whose partner could not be found,
   * so an unmatched one still draws exactly as it does today.
   */
  hingeAt(cell: number, slot: number, segment: number): Folded3dHinge | null;
  /**
   * Model edges no `(cell, slot)` inks.
   *
   * Expected empty, and **not** an assertion: a face whose area falls under
   * `min_accepted_area_relative`, or a cell whose ring came back under three
   * points, leaves its edges homeless. A caller draws these the old way — one
   * undisplaced line each — so a match that fails degrades to the picture before
   * this existed rather than to a missing crease.
   */
  orphanEdges: readonly number[];
}

export function buildFolded3dInk(model: OristudioCpFolded3dRenderModel): Folded3dInk {
  const tolerance = FOLDED_3D_INK_TOLERANCE_RELATIVE * model.span;

  // Face to the edges naming it. `edges()` in the kernel keys an edge on its
  // vertex pair, so a face's own boundary is exactly the edges that name it —
  // never a collinear edge of some other face lying over the same paper.
  const incident: number[][] = Array.from({ length: model.face_count }, () => []);
  for (let edge = 0; edge < model.edge_count; edge += 1) {
    const base = edge * FOLDED_3D_EDGE_ATTR_STRIDE;
    const faceA = model.edge_attr[base] ?? -1;
    const faceB = model.edge_attr[base + 1] ?? -1;
    if (faceA >= 0 && faceA < model.face_count) incident[faceA]!.push(edge);
    if (faceB >= 0 && faceB < model.face_count) incident[faceB]!.push(edge);
  }

  const blockStart = new Int32Array(model.cell_count + 1);
  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
    const ringLength = model.cell_attr[base + 2] ?? 0;
    const stackLength = model.cell_attr[base + 4] ?? 0;
    blockStart[cell + 1] = blockStart[cell]! + ringLength * stackLength;
  }

  const data = new Int32Array(blockStart[model.cell_count]!).fill(-1);
  const inked = new Uint8Array(model.edge_count);
  /** Every `(cell, slot, segment)` that inked each edge, for the hinge pass. */
  const inkedBy: Array<Array<{ cell: number; slot: number; segment: number; face: number }>> =
    Array.from({ length: model.edge_count }, () => []);
  const rings: Array<Vec3[] | null> = new Array<Vec3[] | null>(model.cell_count).fill(null);

  for (let cell = 0; cell < model.cell_count; cell += 1) {
    const base = cell * FOLDED_3D_CELL_ATTR_STRIDE;
    const ringLength = model.cell_attr[base + 2] ?? 0;
    if (ringLength < 3) continue;
    const ring = cellRing(model, cell);
    rings[cell] = ring;
    const stack = cellStack(model, cell);
    for (let slot = 0; slot < stack.length; slot += 1) {
      const face = stack[slot]!;
      const edges = incident[face];
      if (!edges || edges.length === 0) continue;
      for (let segment = 0; segment < ringLength; segment += 1) {
        const p = ring[segment]!;
        const q = ring[(segment + 1) % ringLength]!;
        for (const edge of edges) {
          const [a, b] = edgeEnds(model, edge);
          if (!onSegment(p, a, b, tolerance) || !onSegment(q, a, b, tolerance)) continue;
          data[blockStart[cell]! + slot * ringLength + segment] = edge;
          inked[edge] = 1;
          inkedBy[edge]!.push({ cell, slot, segment, face });
          break;
        }
      }
    }
  }

  // --- hinges: pair each bend with the layer on its far side ----------------
  //
  // Only edges whose two faces are in *different* planes; everything else is a
  // fold that lands back in the same plane, whose stack already orders it.
  const planeOfFace = (face: number): number =>
    model.face_attr[face * FOLDED_3D_FACE_ATTR_STRIDE] ?? -1;
  const hingePlane = new Int32Array(data.length).fill(-1);
  const hingeMask = new Uint8Array(data.length);

  for (let edge = 0; edge < model.edge_count; edge += 1) {
    const base = edge * FOLDED_3D_EDGE_ATTR_STRIDE;
    const faceA = model.edge_attr[base] ?? -1;
    const faceB = model.edge_attr[base + 1] ?? -1;
    if (faceA < 0 || faceB < 0) continue;
    const planeA = planeOfFace(faceA);
    const planeB = planeOfFace(faceB);
    if (planeA < 0 || planeB < 0 || planeA === planeB) continue;

    const entries = inkedBy[edge]!;
    for (const entry of entries) {
      const ring = rings[entry.cell];
      if (!ring) continue;
      const p = ring[entry.segment]!;
      const q = ring[(entry.segment + 1) % ring.length]!;
      const mid: Vec3 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      const ownPlane = planeOfFace(entry.face);

      // The partner is whichever entry from the other plane covers this
      // segment's midpoint — a midpoint rather than the endpoints, because the
      // two planes' arrangements are cut independently and one plane's hinge
      // segment can span several of the other's.
      let partner: (typeof entries)[number] | undefined;
      for (const other of entries) {
        if (planeOfFace(other.face) === ownPlane) continue;
        const otherRing = rings[other.cell];
        if (!otherRing) continue;
        const a = otherRing[other.segment]!;
        const b = otherRing[(other.segment + 1) % otherRing.length]!;
        if (!onSegment(mid, a, b, tolerance)) continue;
        partner = other;
        break;
      }
      if (!partner) continue;

      const partnerStack = model.cell_attr[partner.cell * FOLDED_3D_CELL_ATTR_STRIDE + 4] ?? 0;
      const at =
        blockStart[entry.cell]! +
        entry.slot * (model.cell_attr[entry.cell * FOLDED_3D_CELL_ATTR_STRIDE + 2] ?? 0) +
        entry.segment;
      hingePlane[at] = planeOfFace(partner.face);
      hingeMask[at] = (partner.slot === 0 ? 1 : 0) | (partner.slot === partnerStack - 1 ? 2 : 0);
    }
  }

  const orphanEdges: number[] = [];
  for (let edge = 0; edge < model.edge_count; edge += 1) {
    if (!inked[edge]) orphanEdges.push(edge);
  }

  /** The flat index of `(cell, slot, segment)`, or `-1` if any is out of range. */
  const indexOf = (cell: number, slot: number, segment: number): number => {
    if (cell < 0 || cell >= model.cell_count) return -1;
    const attr = cell * FOLDED_3D_CELL_ATTR_STRIDE;
    const ringLength = model.cell_attr[attr + 2] ?? 0;
    if (segment < 0 || segment >= ringLength) return -1;
    const stackLength = model.cell_attr[attr + 4] ?? 0;
    if (slot < 0 || slot >= stackLength) return -1;
    return blockStart[cell]! + slot * ringLength + segment;
  };

  return {
    edgeAt(cell, slot, segment) {
      const at = indexOf(cell, slot, segment);
      return at < 0 ? -1 : (data[at] ?? -1);
    },
    hingeAt(cell, slot, segment) {
      const at = indexOf(cell, slot, segment);
      if (at < 0) return null;
      const partnerPlane = hingePlane[at] ?? -1;
      if (partnerPlane < 0) return null;
      const mask = hingeMask[at] ?? 0;
      return {
        partnerPlane,
        exposedOnPlus: (mask & 1) !== 0,
        exposedOnMinus: (mask & 2) !== 0,
      };
    },
    orphanEdges,
  };
}

/** Whether `p` lies within `tolerance` of the segment `a`–`b`. */
function onSegment(p: Vec3, a: Vec3, b: Vec3, tolerance: number): boolean {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const apz = p[2] - a[2];
  const lengthSquared = abx * abx + aby * aby + abz * abz;
  // A zero-length edge degenerates to its own endpoint, which is the honest
  // answer rather than a division.
  let t = lengthSquared > 0 ? (apx * abx + apy * aby + apz * abz) / lengthSquared : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz <= tolerance * tolerance;
}

/** Max distance of any cell vertex from {@link modelCentroid}. */
export function modelRadius(model: OristudioCpFolded3dRenderModel): number {
  const centre = modelCentroid(model);
  let radius = 0;
  const count = Math.floor(model.cell_points.length / 3);
  for (let i = 0; i < count; i += 1) {
    radius = Math.max(
      radius,
      Math.hypot(
        (model.cell_points[i * 3] ?? 0) - centre[0],
        (model.cell_points[i * 3 + 1] ?? 0) - centre[1],
        (model.cell_points[i * 3 + 2] ?? 0) - centre[2],
      ),
    );
  }
  return radius;
}
