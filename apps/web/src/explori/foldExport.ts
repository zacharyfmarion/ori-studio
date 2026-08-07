import type { ExploriCp, ExploriLineType, ExploriResult } from './types';
import { exploriTilingLabel } from './types';

/**
 * ExplOri crease patterns, as FOLD for the Edit canvas.
 *
 * The assignment table is upstream's own (`interface/static/js/utils.js`
 * `getFoldType`), and it needs no translation on our side because the CP kernel
 * already lands `F` on the auxiliary colour: `Assignment::Flat → LineColor::Cyan3`
 * in `crates/oristudio-cp/src/model/mod.rs`, which is the same colour
 * `LineType::Aux` maps to.
 *
 * | ExplOri | FOLD | Edit canvas |
 * | --- | --- | --- |
 * | `b`  | `B` | border |
 * | `m`  | `M` | mountain |
 * | `v`  | `V` | valley |
 * | `h`, `aux` | `F` | auxiliary |
 *
 * So roughly a quarter of a sent pattern arrives as construction lines rather
 * than creases — `h` was 12 of 49 edges in a representative result. That is
 * correct: the tiling genuinely does not determine those assignments. It also
 * means a sent CP is not expected to fold flat as-is.
 */

const SQRT2_2 = Math.SQRT1_2;

export type FoldAssignment = 'B' | 'M' | 'V' | 'F';

export function foldAssignmentFor(lineType: ExploriLineType | string): FoldAssignment {
  const type = String(lineType ?? '').trim().toLowerCase();
  if (type === 'b') return 'B';
  if (type === 'm' || type === 'rm' || type === 'hm') return 'M';
  if (type === 'v' || type === 'rv' || type === 'av' || type === 'hv') return 'V';
  if (type === 'h' || type === 'aux' || type === 'ax') return 'F';
  if (type.includes('m')) return 'M';
  if (type.includes('v')) return 'V';
  return 'F';
}

/**
 * A vertex's exact ℚ(√2) components, in the plane.
 *
 * Each component is computed once from its own rational tuple, so two vertices
 * with the same tuple produce **bit-identical** doubles. Coincidence is exact by
 * construction rather than by tolerance — which matters here, because a crease
 * pattern whose "same" points differ in the last bits is one the planarizer
 * splits into slivers.
 */
export function exploriVertexToPlane(vertex: readonly number[]): [number, number] {
  const x = vertex[0] / vertex[1];
  const y = vertex[2] / vertex[3];
  const z = vertex[4] / vertex[5];
  const w = vertex[6] / vertex[7];
  return [x + SQRT2_2 * (y - w), z + SQRT2_2 * (y + w)];
}

/** Every CP vertex in the plane, in index order. */
export function exploriCpVertices(cp: ExploriCp): [number, number][] {
  return cp.vertices.map(exploriVertexToPlane);
}

export interface ExploriFoldOptions {
  /**
   * Edge length of the square the pattern is scaled onto.
   *
   * ExplOri crease patterns arrive in the unit square, so this is the only
   * transform between their space and the Edit canvas's.
   */
  paperSize?: number;
  title?: string;
}

/**
 * The Edit canvas's paper, in its own units.
 *
 * Centred on the origin, not cornered at it: an empty Edit crease pattern's
 * border runs from (-200, 200) to (200, 200). A pattern exported into [0, 400]²
 * lands beside the paper rather than on it.
 */
export const EDIT_PAPER_SIZE = 400;

export function exploriCpToFoldObject(
  cp: ExploriCp,
  options: ExploriFoldOptions = {}
): Record<string, unknown> {
  const scale = options.paperSize ?? EDIT_PAPER_SIZE;
  // ExplOri patterns arrive in the unit square; the Edit paper is a square of
  // `scale` centred on the origin. Half a paper is the whole transform.
  const half = scale / 2;
  const vertices = exploriCpVertices(cp).map(([x, y]) => [x * scale - half, y * scale - half]);
  const edgesVertices: [number, number][] = [];
  const edgesAssignment: FoldAssignment[] = [];
  for (const [from, to, lineType] of cp.edges) {
    if (!vertices[from] || !vertices[to]) continue;
    edgesVertices.push([from, to]);
    edgesAssignment.push(foldAssignmentFor(lineType));
  }
  return {
    file_spec: 1.1,
    file_creator: 'Ori Studio (ExplOri)',
    ...(options.title ? { frame_title: options.title } : {}),
    vertices_coords: vertices,
    edges_vertices: edgesVertices,
    edges_assignment: edgesAssignment,
  };
}

export function exploriResultToFold(result: ExploriResult, title?: string): string {
  return JSON.stringify(
    exploriCpToFoldObject(result.cp, { title: title || exploriTilingLabel(result) })
  );
}

/**
 * Whether every distinct vertex index maps to a distinct point.
 *
 * The claim the exact-rational representation is supposed to buy us. A duplicate
 * means two indices name the same place, which the planarizer would have to weld
 * — so this is worth asserting over real data rather than assuming.
 */
export function exploriCpHasDistinctVertices(cp: ExploriCp): boolean {
  const seen = new Set<string>();
  for (const [x, y] of exploriCpVertices(cp)) seen.add(`${x},${y}`);
  return seen.size === cp.vertices.length;
}
