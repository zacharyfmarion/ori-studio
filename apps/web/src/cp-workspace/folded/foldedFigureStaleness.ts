import {
  isFoldedFromCurrentCpSourceKind,
  type FoldedSourceBounds,
  type OristudioCpDocumentSnapshot,
  type OristudioCpFoldedFigureEntry,
  type OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { isOrieditaFoldableLineColor } from '../../lib/creasePatternClipboard';

/**
 * Whether a folded figure still matches the creases it was folded from — a port
 * of Oriedita's refold check.
 *
 * ## Upstream
 *
 * Oriedita has no per-figure "stale" flag. It makes the decision at Fold time,
 * in `FoldingServiceImpl.fold`'s `FOR_EXISTING_FOLDED_FIGURE_3` branch
 * (`third_party/oriedita/.../service/impl/FoldingServiceImpl.java`):
 *
 * 1. A figure's provenance is its **bounding box**, set in
 *    `FoldedFigure_Drawer.folding_estimated` as
 *    `GetBoundingBox.getBoundingBox(lineSegmentSet)` — the axis-aligned rect of
 *    the very line set that was folded, in flat CP coordinates. That box, not a
 *    list of line ids, is the whole record of "which creases made this figure".
 * 2. To refold, it re-derives the set: `foldLineSet.select(boundingBox)` picks
 *    the creases overlapping that rect, and `getForSelectFolding()` keeps the
 *    selected *folding* lines (`getSaveForSelectFolding`).
 * 3. It compares that set to the previous one with
 *    `LineSegmentSet.contentEquals`: equal counts, and every segment of one
 *    present in a hash set of the other.
 * 4. Equal → refold in place, keeping constraints and starting face. Different
 *    → discard the figure and fold a fresh one.
 *
 * ## Deviations, and why
 *
 * - **Per figure, not per service.** Upstream keeps one `lastFold` field on the
 *   folding service, so with several figures open the baseline belongs to
 *   whichever was folded last and "unchanged" can be wrong for any other; it is
 *   also never assigned when folding from an explicit selection. We store the
 *   baseline on the entry. Same test, correct in more cases.
 * - **Changed creases refold in place; they do not destroy the figure.** A
 *   folded figure here is a placed, scaled, styled canvas object, not the
 *   transient view it is upstream, so discarding it on any edit would be
 *   hostile. The fold itself, the selection rule and the equality test are
 *   unchanged.
 * - **`selected` is excluded from the fingerprint.** `LineSegment.equals`
 *   compares it, but upstream only ever compares sets that came from
 *   `getSaveForSelectFolding`, where it is uniformly `2` and so never varies.
 *   Ours does vary, and including it would make every figure look stale the
 *   moment the user clicks a crease.
 */

export type { FoldedSourceBounds };

/**
 * Bounding box of the creases a figure was folded from.
 * Port of `GetBoundingBox.getBoundingBox`. Null for an empty set.
 */
export function foldedSourceBounds(
  lines: readonly OristudioCpLineSegment[],
): FoldedSourceBounds | null {
  if (lines.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    minX = Math.min(minX, line.a.x, line.b.x);
    minY = Math.min(minY, line.a.y, line.b.y);
    maxX = Math.max(maxX, line.a.x, line.b.x);
    maxY = Math.max(maxY, line.a.y, line.b.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Whether any part of the segment lies in the closed rect.
 *
 * Port of `Polygon.totu_boundary_inside(LineSegment)`, which returns true when
 * the segment meets **any** boundary edge or its midpoint is inside — i.e. when
 * the segment overlaps the closed polygon at all, not when it is contained by
 * it. For an axis-aligned rect that is the standard segment/AABB overlap test,
 * implemented here by Liang–Barsky clipping.
 *
 * Consequence worth keeping in mind: a crease that merely crosses the figure's
 * region counts as one of its source creases, exactly as upstream.
 */
export function segmentOverlapsBounds(
  line: OristudioCpLineSegment,
  bounds: FoldedSourceBounds,
): boolean {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;

  // Degenerate segment (a point): inside iff the point is in the rect.
  if (dx === 0 && dy === 0) {
    return (
      line.a.x >= bounds.minX &&
      line.a.x <= bounds.maxX &&
      line.a.y >= bounds.minY &&
      line.a.y <= bounds.maxY
    );
  }

  let tMin = 0;
  let tMax = 1;
  const edges: Array<[number, number]> = [
    [-dx, line.a.x - bounds.minX],
    [dx, bounds.maxX - line.a.x],
    [-dy, line.a.y - bounds.minY],
    [dy, bounds.maxY - line.a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this edge: outside its slab means no overlap at all.
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > tMax) return false;
      if (r > tMin) tMin = r;
    } else {
      if (r < tMin) return false;
      if (r < tMax) tMax = r;
    }
  }
  return tMin <= tMax;
}

/**
 * The creases a figure would be folded from today: foldable-coloured lines
 * overlapping its recorded region. Port of `FoldLineSet.select(Polygon)`
 * composed with `getSaveForSelectFolding`'s folding-line filter.
 *
 * Returns 1-based line ids, matching the rest of the CP selection model.
 */
export function reselectFoldableLineIds(
  document: OristudioCpDocumentSnapshot | null | undefined,
  bounds: FoldedSourceBounds | null,
): number[] {
  if (!document || !bounds) return [];
  const ids: number[] = [];
  const lines = document.crease_pattern.line_segments;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !isOrieditaFoldableLineColor(line.color)) continue;
    if (segmentOverlapsBounds(line, bounds)) ids.push(index + 1);
  }
  return ids;
}

/**
 * The same reselect **without** the folding-line filter: every crease overlapping
 * the recorded region, whatever its colour.
 *
 * Not a variant of {@link reselectFoldableLineIds} for the sake of it — the two
 * feed different machines. The kernel is handed folding lines only, so that is
 * what provenance and staleness compare. A *region* is matched by every crease
 * inside it, auxiliary construction lines included, so "simulate this instead"
 * has to ask the unfiltered question or `resolveInlineSimulationRegion` refuses
 * a region that has one Cyan3 line in it.
 *
 * This is the refold-time stand-in for the scoped selection a fresh fold records
 * verbatim (`sourceScopedLineIds`): a refold has no selection to record, only a
 * box.
 */
export function reselectSourceLineIds(
  document: OristudioCpDocumentSnapshot | null | undefined,
  bounds: FoldedSourceBounds | null,
): number[] {
  if (!document || !bounds) return [];
  const ids: number[] = [];
  const lines = document.crease_pattern.line_segments;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && segmentOverlapsBounds(line, bounds)) ids.push(index + 1);
  }
  return ids;
}

/** The lines behind 1-based ids, skipping any that no longer resolve. */
export function cpLinesByIds(
  document: OristudioCpDocumentSnapshot | null | undefined,
  ids: readonly number[],
): OristudioCpLineSegment[] {
  if (!document) return [];
  const lines: OristudioCpLineSegment[] = [];
  for (const id of ids) {
    const line = document.crease_pattern.line_segments[id - 1];
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * One segment's identity, positionally in `a`/`b` as `LineSegment.equals` is.
 *
 * **`fold_magnitude` is ours, not upstream's.** `LineSegment.equals` has no such
 * field because Oriedita has no such concept, and while colour *was* a crease's
 * whole fold identity that was the same thing. It is now half of it: two creases
 * can agree on every field here and fold to different angles. Leaving it out made
 * changing an angle invisible to the staleness check, so a folded figure and an
 * inline simulation both went on claiming to match creases they no longer did.
 *
 * An absent magnitude serialises as empty rather than as a stand-in value like
 * `180`, which is what keeps a **classic crease's key byte-identical to the one
 * this produced before the field existed**. Every fingerprint already written to
 * a `.osf` therefore still matches, so no file opens with its figures wrongly
 * marked stale and {@link FINGERPRINT_PREFIX} stays at `cs1:` — the prefix is
 * there to mark a change that *invalidates* stored values, and this one
 * deliberately does not.
 *
 * That mirrors the kernel, where `fold_magnitude` is
 * `#[serde(skip_serializing_if = "Option::is_none")]` for the same reason: a
 * classic crease leaks no key into the snapshot either.
 */
function segmentKey(line: OristudioCpLineSegment): string {
  const { customized_color: cc } = line;
  const classic = [
    line.a.x,
    line.a.y,
    line.b.x,
    line.b.y,
    line.active,
    line.color,
    line.customized,
    cc.red,
    cc.green,
    cc.blue,
  ].join(',');
  // Appended rather than joined in as an empty field: joining would leave a
  // trailing separator on every classic crease, which is a different string from
  // the one this used to produce and would strand every persisted fingerprint.
  return line.fold_magnitude === undefined ? classic : `${classic},${line.fold_magnitude}`;
}

/**
 * Names the algorithm in the value itself. Nothing reads it today — the previous
 * form is deliberately not supported, see {@link foldedSourceFingerprint} — but
 * it costs four bytes and makes the *next* change to this hash cheap, since a
 * stored value can then be told apart from one this build would produce.
 */
const FINGERPRINT_PREFIX = 'cs1:';

/**
 * 64 bits over the sorted keys, as two FNV-1a streams with different bases and
 * primes.
 *
 * Two streams rather than one because a single 32-bit word leaves a 2^-32 chance
 * that an edit reads as "unchanged", and the cost of that is a stale model that
 * never says so — a wrong answer with nothing on screen to question. Consumed
 * incrementally rather than over a joined string, so this never materialises the
 * megabyte-scale text the old form did.
 */
function creaseSetDigest(sortedKeys: readonly string[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9dc5811c;
  const mix = (code: number) => {
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  };
  for (const key of sortedKeys) {
    for (let i = 0; i < key.length; i += 1) mix(key.charCodeAt(i));
    // A separator per key, or `["ab", "c"]` and `["a", "bc"]` would be the same
    // byte stream — different crease sets sharing a fingerprint for free.
    mix(0x3b);
  }
  const hex = (h: number) => (h >>> 0).toString(16).padStart(8, '0');
  return `${FINGERPRINT_PREFIX}${hex(h1)}${hex(h2)}`;
}

/**
 * An order-independent fingerprint of a crease set, standing in for
 * `LineSegmentSet.contentEquals`: two sets share a fingerprint when they have
 * the same segments with the same multiplicities.
 *
 * This used to be the sorted keys themselves, joined — exact, with no collisions
 * to reason about. That is the better property, and it was the right call while
 * the value only ever lived in memory. It stopped being right when the value
 * started being written to `.osf`: a key runs ~60 bytes, so a figure over a
 * dense region carried tens of kilobytes and twenty of them megabytes, for a
 * string nothing ever reads. Hashing trades an exactness nobody could observe
 * for a bound on file size.
 *
 * The sort still does the real work — it is what makes re-selecting the same
 * creases in a different order produce the same answer.
 *
 * Values written by the previous form are **not** recognised, on purpose. They
 * existed for two days (fingerprints began being persisted 2026-07-26), and a
 * file holding one shows its folded figures as `Stale` rather than `Case N` and
 * offers a Refold — which is opt-in, refolds in place keeping placement and
 * style, and rewrites the fingerprint. Self-correcting on the next save. Keeping
 * a second algorithm alive permanently to avoid one wrong label in a two-day
 * window of files is the worse trade.
 */
export function foldedSourceFingerprint(lines: readonly OristudioCpLineSegment[]): string {
  return creaseSetDigest(lines.map(segmentKey).sort());
}

/**
 * `document` + region -> the fingerprint that region's creases hash to *today*.
 *
 * The answer depends on nothing but those two, and computing it is the whole
 * cost of {@link isFoldedFigureStale}: a walk over every line segment in the
 * document, then a sort and a digest over the ones that overlap.
 *
 * # Why this cache exists
 *
 * Callers ask per *figure*, and the natural place to memoise — a `useMemo` over
 * the figure list — is invalidated by the figure list's identity. Reopening a
 * file with inline 3D figures adopts them one at a time, and every adoption
 * rewrites that array, so the memo recomputed for **every** figure on **every**
 * adoption while none of the inputs this function reads had changed.
 *
 * Measured on a 64-figure, 15,950-segment document: 67 ms per recompute, 64
 * times. A trace of that load spent 71% of main-thread busy time in here and
 * dropped 43% of frames, all of it inside those blocks.
 *
 * # Why keying on document identity is safe
 *
 * It is the *same* key the `useMemo` already used, so this is no weaker: a
 * snapshot is decoded fresh per edit and never mutated in place, and were that
 * untrue the memo would already have been serving stale answers. A `WeakMap`
 * means a superseded document's entry goes when the document does, and the
 * inner map is bounded by the number of distinct regions asked about.
 */
const CURRENT_FINGERPRINTS = new WeakMap<OristudioCpDocumentSnapshot, Map<string, string>>();

function currentSourceFingerprint(
  document: OristudioCpDocumentSnapshot,
  bounds: FoldedSourceBounds,
): string {
  let byRegion = CURRENT_FINGERPRINTS.get(document);
  if (byRegion === undefined) {
    byRegion = new Map();
    CURRENT_FINGERPRINTS.set(document, byRegion);
  }
  const key = `${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}`;
  const cached = byRegion.get(key);
  if (cached !== undefined) return cached;
  const fingerprint = foldedSourceFingerprint(
    cpLinesByIds(document, reselectFoldableLineIds(document, bounds)),
  );
  byRegion.set(key, fingerprint);
  return fingerprint;
}

/**
 * Whether `figure`'s source creases have changed since it was folded.
 *
 * A figure with no recorded provenance — folded before this was tracked, or
 * loaded from an older `.osf` — reports **not** stale: we cannot tell, and
 * offering a refold we cannot perform is worse than staying quiet.
 */
export function isFoldedFigureStale(
  document: OristudioCpDocumentSnapshot | null | undefined,
  figure: OristudioCpFoldedFigureEntry,
): boolean {
  if (!document) return false;
  if (figure.sourceBounds == null || figure.sourceFingerprint == null) return false;
  // Only figures folded from this document's creases have creases to drift —
  // both kinds of them. This predicate fails *open*: exclude a kind here and
  // nothing errors, its figures simply report fresh forever and the Refold verb
  // is dropped from the menu rather than shown disabled.
  if (!isFoldedFromCurrentCpSourceKind(figure.sourceKind)) return false;
  return currentSourceFingerprint(document, figure.sourceBounds) !== figure.sourceFingerprint;
}
