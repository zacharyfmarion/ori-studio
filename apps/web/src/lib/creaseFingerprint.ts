import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';

const COORD_QUANTIZE = 1e6;

/**
 * A cheap content fingerprint of the crease geometry — the actual input to
 * segmentation, and to which creases each segmented region contains.
 *
 * Both obvious proxies for "the creases changed" are wrong here. The document
 * snapshot is a fresh object after every undo or redo of an edit, whatever the
 * edit touched (and, until selections stopped replacing it, after every
 * selection too); `foldArtifactRevision` advances with it. Keyed on either, the
 * cache missed on every selection and re-paid the ~1s segmentation.
 *
 * Hashing the endpoints, colours and fold magnitudes is O(creases) — well under a
 * millisecond for a 6k-crease pattern against a ~1s recompute — and changes
 * exactly when the exported fold would.
 */
/** A line as a crease fingerprint reads it: its ends, its kind (mountain, valley, edge, aux) and its fold magnitude. */
type CreaseLine = OristudioCpDocumentSnapshot['crease_pattern']['line_segments'][number];

/** Hash `lines` as {@link creaseFingerprint} does: what folding them depends on, nothing else. */
function hashCreaseLines(lines: Iterable<CreaseLine>): number {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  };
  for (const line of lines) {
    mix(Math.round(line.a.x * COORD_QUANTIZE));
    mix(Math.round(line.a.y * COORD_QUANTIZE));
    mix(Math.round(line.b.x * COORD_QUANTIZE));
    mix(Math.round(line.b.y * COORD_QUANTIZE));
    mix(line.color.charCodeAt(0) + line.color.length);
    // Magnitude is orthogonal to colour by construction (`lib/foldAngle.ts`), so
    // dialling a crease from 180 to 90 changes neither the endpoints nor the
    // colour above. Without this, the cached artifacts — and the `edges_foldAngle`
    // that reaches the export and share cards from them — keep the old angles.
    mix(line.fold_magnitude ?? -1);
  }
  return hash >>> 0;
}

function computeCreaseFingerprint(document: OristudioCpDocumentSnapshot): string {
  const lines = document.crease_pattern.line_segments;
  return `${lines.length}:${hashCreaseLines(lines)}`;
}

/**
 * The same identity for some of the lines only — those of `lineIds` (the
 * kernel's ids, from 1), in that order: what a fold of exactly those lines
 * depends on. Their geometry, kind and magnitude, never their ids, so the
 * same lines chosen again under other ids (a line added or removed elsewhere
 * renumbers them) fingerprint alike; and a custom colour or a selection
 * changes nothing. Null when an id names no line.
 */
export function creaseLinesFingerprint(
  document: OristudioCpDocumentSnapshot,
  lineIds: readonly number[]
): string | null {
  const lines = document.crease_pattern.line_segments;
  const chosen: CreaseLine[] = [];
  for (const id of lineIds) {
    const line = lines[id - 1];
    if (!line) return null;
    chosen.push(line);
  }
  return `${chosen.length}:${hashCreaseLines(chosen)}`;
}

/** Memoized per snapshot, so only a genuinely new snapshot pays the O(n) hash. */
const fingerprints = new WeakMap<OristudioCpDocumentSnapshot, string>();

/**
 * The identity of a crease geometry, for cache keying. Exported so what it does and
 * does not distinguish can be pinned directly, rather than only through a cache hit
 * that needs the kernel to observe.
 */
export function creaseFingerprint(document: OristudioCpDocumentSnapshot): string {
  const cachedFingerprint = fingerprints.get(document);
  if (cachedFingerprint !== undefined) return cachedFingerprint;
  const fingerprint = computeCreaseFingerprint(document);
  fingerprints.set(document, fingerprint);
  return fingerprint;
}

function computeLineContentFingerprint(document: OristudioCpDocumentSnapshot): string {
  const lines = document.crease_pattern.line_segments;
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  };
  const mixText = (text: string) => {
    mix(text.length);
    for (let i = 0; i < text.length; i += 1) mix(text.charCodeAt(i));
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    mix(Math.round(line.a.x * COORD_QUANTIZE));
    mix(Math.round(line.a.y * COORD_QUANTIZE));
    mix(Math.round(line.b.x * COORD_QUANTIZE));
    mix(Math.round(line.b.y * COORD_QUANTIZE));
    mixText(line.color);
    mixText(line.active);
    mix(line.customized);
    mix(line.customized_color.red);
    mix(line.customized_color.green);
    mix(line.customized_color.blue);
    mix(line.fold_magnitude ?? -1);
    mixText(line.fold_direction_hint ?? '');
  }
  return `${lines.length}:${hash >>> 0}`;
}

const lineContentFingerprints = new WeakMap<OristudioCpDocumentSnapshot, string>();

/**
 * Everything about the lines except which are selected: what a crease
 * fingerprint (`relativeCreaseFingerprint`, `cs1:`) reads, and so the key for
 * caching one. {@link creaseFingerprint} leaves out `active`, the custom colour
 * and the direction hint, which no geometry depends on but a fingerprint
 * does; the snapshot itself is replaced by every undo and redo of an edit, even
 * one these do not read. Memoized per snapshot.
 */
export function lineContentFingerprint(document: OristudioCpDocumentSnapshot): string {
  const cached = lineContentFingerprints.get(document);
  if (cached !== undefined) return cached;
  const fingerprint = computeLineContentFingerprint(document);
  lineContentFingerprints.set(document, fingerprint);
  return fingerprint;
}
