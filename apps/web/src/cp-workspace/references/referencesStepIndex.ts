/**
 * Which step of the sequence makes a crease, or completes a vertex.
 *
 * In the Folding sequence mode a tap on the sheet is navigation: the reader
 * points at a crease — one already made, or one still to come, drawn as a
 * ghost — and the strip jumps to the card that makes it. "Which step makes
 * this?" is the question the sequence answers about a crease, where Find
 * answers "how do I get this from a blank sheet?" about a target.
 *
 * Pure: the plan's variants and the view's steps in, an index into the view's
 * steps out, so the mapping is tested without a canvas.
 */
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { cpVertexId } from '../../lib/creasePatternViewport';
import type { Point } from '../../lib/geometry';
import type { PrecreaseStep } from './precreaseSequence';
import type { ReferencesPlanVariant } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';

/** The 1-based crease ids a planner step puts on the paper. */
function creasesOf(step: PrecreaseStep): readonly number[] {
  if (step.grid) return step.grid.lines.flatMap((line) => line.cp_line_ids);
  return step.cp_line_ids;
}

/**
 * The index into `viewSteps` of the fold that makes crease `lineId` (1-based),
 * its twin included, or null when no step of the plan makes it — a crease of
 * another sheet, or one the plan left unreached.
 */
export function stepIndexOfLine(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  lineId: number
): number | null {
  for (let index = 0; index < viewSteps.length; index += 1) {
    const view = viewSteps[index];
    if (view.kind !== 'fold') continue;
    const steps = variants[view.component]?.sequence.steps;
    if (!steps) continue;
    for (const at of [view.step, view.twin]) {
      if (at === undefined) continue;
      const step = steps[at];
      if (step && creasesOf(step).includes(lineId)) return index;
    }
  }
  return null;
}

/**
 * The 1-based ids of the creases that end at each vertex, keyed by
 * `cpVertexId`. Every crease is split at every crossing, so a vertex is an
 * endpoint of each crease through it and endpoints are all there is to read.
 */
export function creasesAtVertices(geometry: CpGeometryTransport): ReadonlyMap<string, number[]> {
  const out = new Map<string, number[]>();
  const ends = geometry.segEndpoints;
  for (let i = 0; i + 3 < ends.length; i += 4) {
    const id = (i >> 2) + 1;
    for (const point of [
      { x: ends[i], y: ends[i + 1] },
      { x: ends[i + 2], y: ends[i + 3] },
    ]) {
      const key = cpVertexId(point);
      const list = out.get(key);
      if (list) list.push(id);
      else out.set(key, [id]);
    }
  }
  return out;
}

/**
 * The index into `viewSteps` of the fold that *completes* the vertex at
 * `point`: the last of the steps making the creases that meet there. A vertex
 * is where creases cross, so it is on the paper only once all of them are;
 * a tap on one asks for the moment it appears. Null when no step makes any
 * crease through it.
 */
export function stepIndexOfVertex(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  creasesAt: ReadonlyMap<string, number[]>,
  point: Point
): number | null {
  const ids = creasesAt.get(cpVertexId(point));
  if (!ids) return null;
  let latest: number | null = null;
  for (const id of ids) {
    const index = stepIndexOfLine(variants, viewSteps, id);
    if (index !== null && (latest === null || index > latest)) latest = index;
  }
  return latest;
}
