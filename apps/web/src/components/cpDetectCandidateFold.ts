import type { CpDetectBoxPleatGrid, CpDetectRecognizeResult } from '../engine/cpDetectTypes';

/** A vertex written into a candidate FOLD: its solve-input id and where it goes. */
export interface CpDetectPlacedVertex {
  vertex_id: number;
  after: { x: number; y: number };
}

/**
 * The candidate FOLD with a run's coordinates written into it.
 *
 * One construction for every caller, because they are the same situation:
 * geometry a real run produced that the dialog cannot get as a solved FOLD.
 *
 * - **A timeout** returns the coordinates it was *given* and reports the work it
 *   did in `attempted_moved_vertices` — a median of ~448 entries — so this is
 *   the only place that partial solution exists.
 * - **An ambiguous acceptance** is withheld by `runCpExactSolve` on purpose: its
 *   `fold` is the *exactly* solved document, and improved-but-not-foldable
 *   geometry returned through that field is how it gets applied as the answer.
 * - **A box-pleat grid snap** of the candidate, which recognition reports as
 *   moves rather than as a second FOLD.
 *
 * The mapping is exact rather than positional. `cp_detector.vertex_original_ids`
 * is written by the same exporter that renumbered the vertices
 * (`fold_export.rs`), and the ids in a movement report index
 * `ExactSolveInput.vertices` — the same space. Null when the export carries no
 * such list or the arrays disagree, so a shape change drops the offer instead of
 * scattering coordinates onto the wrong vertices.
 */
export function foldJsonWithMovedVertices(
  foldJson: string,
  moves: readonly CpDetectPlacedVertex[]
): string | null {
  if (moves.length === 0) return null;
  let fold: { vertices_coords?: unknown; cp_detector?: { vertex_original_ids?: unknown } } | null;
  try {
    fold = JSON.parse(foldJson) as typeof fold;
  } catch {
    return null;
  }
  const coords = fold?.vertices_coords;
  const originalIds = fold?.cp_detector?.vertex_original_ids;
  if (!Array.isArray(coords) || !Array.isArray(originalIds)) return null;
  if (coords.length !== originalIds.length) return null;

  const indexOfVertex = new Map<number, number>();
  originalIds.forEach((id, index) => {
    if (typeof id === 'number') indexOfVertex.set(id, index);
  });
  const moved = coords.map((point) => (Array.isArray(point) ? [...point] : point));
  let applied = 0;
  for (const vertex of moves) {
    const index = indexOfVertex.get(vertex.vertex_id);
    if (index === undefined) continue;
    moved[index] = [vertex.after.x, vertex.after.y];
    applied += 1;
  }
  if (applied === 0) return null;
  return JSON.stringify({ ...fold, vertices_coords: moved });
}

/**
 * The grid a box-pleated detection would be snapped to, or null when it is
 * not box-pleated or the user turned the snap off.
 */
export function activeBoxPleatGrid(
  recognition: Pick<CpDetectRecognizeResult, 'boxPleatGrid'> | null,
  snapToGrid: boolean
): CpDetectBoxPleatGrid | null {
  return snapToGrid ? (recognition?.boxPleatGrid ?? null) : null;
}

/**
 * The candidate the dialog shows and adds: snapped to `grid` when there is
 * one, as recognized otherwise. A snap that moved nothing, or that cannot be
 * written into this FOLD, leaves the candidate as recognized.
 */
export function candidateFoldJson(
  recognition: Pick<CpDetectRecognizeResult, 'foldJson'>,
  grid: CpDetectBoxPleatGrid | null
): string {
  if (!grid) return recognition.foldJson;
  return foldJsonWithMovedVertices(recognition.foldJson, grid.snappedVertices) ?? recognition.foldJson;
}
