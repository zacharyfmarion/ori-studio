/**
 * Pinned vertices: the positions a solve and a transform must leave alone.
 *
 * The solver has several valid answers for most detected patterns and does not
 * always converge on the one the user wants. A pin is how they say which: nail
 * down the junctions whose position is already known, and let everything else
 * re-equilibrate around them. `crates/oristudio-cp-compiler/src/exact_solve.rs`
 * is the other half — a pinned vertex is parameterized `Fixed` there, with no
 * degrees of freedom at all.
 *
 * # Why a pin is a *position*
 *
 * A crease-pattern vertex is not an object. It is a coincidence of crease
 * endpoints, and kernel line ids are plain indices that an undo reshuffles — so
 * there is no id to hold on to. A pin is therefore a model-space point, and
 * "which vertex is pinned" is answered by matching against the current vertices
 * at read time, through {@link VERTEX_COINCIDENCE} — the same epsilon the kernel
 * uses to decide which endpoints sit on one junction.
 *
 * That makes orphaning a non-event rather than a bug: a pin whose vertex no
 * longer exists renders nothing, blocks nothing and is sent to no solve, and an
 * undo that brings the vertex back makes its pin live again. Nothing here has to
 * be told that the document changed.
 *
 * # Why they are not document state
 *
 * A pin changes nothing about the pattern — it is a statement about what the
 * user wants *done* to it next. So it is session state (see
 * `CP_DOCUMENT_SCOPED_KEYS`), it is not written to `.osf` or a share link, and
 * it is not part of a history entry: an undo after a pin should walk back the
 * last crease edit, not the marker.
 */
import { VERTEX_COINCIDENCE, endpointKey, type VertexEndpointSegment } from '../tools/vertexEndpoints';
import type { ModelPoint } from '../renderer/types';

/** A pinned vertex, in document model space. */
export type CpVertexPin = ModelPoint;

export const NO_CP_VERTEX_PINS: readonly CpVertexPin[] = [];

function coincident(pin: CpVertexPin, point: ModelPoint): boolean {
  return Math.hypot(pin.x - point.x, pin.y - point.y) <= VERTEX_COINCIDENCE;
}

/** Whether any pin sits on `point`. */
export function isCpVertexPinned(
  pins: readonly CpVertexPin[],
  point: ModelPoint
): boolean {
  return pins.some((pin) => coincident(pin, point));
}

/**
 * Add a pin at `point`, or remove the one already there.
 *
 * Returns the same array when nothing changed, so a caller can compare by
 * identity — there is no "toggle" that leaves the set alone, but the callers of
 * {@link removeCpVertexPinsInBox} rely on the convention and it costs nothing to
 * keep it here too.
 */
export function toggleCpVertexPin(
  pins: readonly CpVertexPin[],
  point: ModelPoint
): readonly CpVertexPin[] {
  const remaining = pins.filter((pin) => !coincident(pin, point));
  if (remaining.length !== pins.length) return remaining;
  return [...pins, { x: point.x, y: point.y }];
}

/** An axis-aligned model-space box. Matches the region box's own reading. */
export interface CpPinBox {
  contains: (point: ModelPoint) => boolean;
}

/**
 * Drop every pin inside `box` — what accepting or deleting a solve region does.
 *
 * Scoped to the box rather than clearing everything, so a second region's pins
 * and any pin placed from the rail outside it survive. Returns the same array
 * when nothing was inside, so the caller can skip a store write.
 */
export function removeCpVertexPinsInBox(
  pins: readonly CpVertexPin[],
  box: CpPinBox
): readonly CpVertexPin[] {
  const remaining = pins.filter((pin) => !box.contains(pin));
  return remaining.length === pins.length ? pins : remaining;
}

/**
 * Which of `vertices` are pinned, as indices — what the point buffer colours.
 *
 * Linear in `vertices * pins`. Pins are a handful by construction (they are
 * placed one click at a time), and this is memoised on the vertex list, so the
 * cost lands once per document revision rather than per frame.
 */
export function pinnedVertexIndices(
  vertices: readonly ModelPoint[],
  pins: readonly CpVertexPin[]
): ReadonlySet<number> {
  const found = new Set<number>();
  if (pins.length === 0) return found;
  for (let index = 0; index < vertices.length; index++) {
    if (isCpVertexPinned(pins, vertices[index])) found.add(index);
  }
  return found;
}

/**
 * The crease endpoints a transform preview must **not** move, keyed the way
 * {@link import('../adapters/cpSnapshotToScene').CpTransformPreview} keys them.
 *
 * The commit's own answer to this comes from the kernel (`PinnedPoints` in
 * `operations/transform.rs`), which applies the same coincidence rule to the
 * same points — so the preview stretches a crease exactly where the commit will.
 * Computing it here rather than asking the kernel keeps it at pointer rate,
 * which is the same argument the moved-endpoint set next door already makes.
 */
export function heldEndpointKeys(
  segments: readonly VertexEndpointSegment[],
  pins: readonly CpVertexPin[]
): ReadonlySet<number> {
  const keys = new Set<number>();
  if (pins.length === 0) return keys;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (isCpVertexPinned(pins, segment.a)) keys.add(endpointKey(index, 'a'));
    if (isCpVertexPinned(pins, segment.b)) keys.add(endpointKey(index, 'b'));
  }
  return keys;
}
