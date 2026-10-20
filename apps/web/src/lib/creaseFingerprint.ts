import {
  activeStateName,
  cpDocumentTransport,
  lineColorName,
  SEG_ATTR_STRIDE,
  type CpGeometryTransport,
} from '../engine/oristudioCpGeometry';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';
import { FOLD_MAGNITUDE_CLASSIC, foldDirectionHintFromCode } from './foldAngle';

const COORD_QUANTIZE = 1e6;

/**
 * Each fingerprint is computed one of two ways, which agree to the bit
 * (`creaseFingerprint.test.ts`): from the compact transport behind a lazy
 * snapshot (`lazyCpDocumentSnapshot`), which is every snapshot the kernel hands
 * the store, or from the line objects of any other. Reading the transport is
 * what keeps a fingerprint from decoding half a million lines to hash them —
 * the selection toolbar asks for one on every render.
 */
interface Hasher {
  mix(value: number): void;
  mixText(text: string): void;
  readonly hash: number;
}

function fnv(): Hasher {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  };
  return {
    mix,
    mixText(text: string) {
      mix(text.length);
      for (let i = 0; i < text.length; i += 1) mix(text.charCodeAt(i));
    },
    get hash() {
      return hash;
    },
  };
}

/** What a decode gives `fold_magnitude ?? -1` for a raw transport value. */
function foldMagnitudeOrNone(raw: number | undefined): number {
  return raw === undefined || raw === FOLD_MAGNITUDE_CLASSIC ? -1 : raw;
}

function mixEndpoints(h: Hasher, endpoints: Float64Array, i: number): void {
  h.mix(Math.round(endpoints[i * 4]! * COORD_QUANTIZE));
  h.mix(Math.round(endpoints[i * 4 + 1]! * COORD_QUANTIZE));
  h.mix(Math.round(endpoints[i * 4 + 2]! * COORD_QUANTIZE));
  h.mix(Math.round(endpoints[i * 4 + 3]! * COORD_QUANTIZE));
}

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
function computeCreaseFingerprint(document: OristudioCpDocumentSnapshot): string {
  const transport = cpDocumentTransport(document);
  if (transport) return creaseFingerprintOfTransport(transport);
  const lines = document.crease_pattern.line_segments;
  const h = fnv();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    h.mix(Math.round(line.a.x * COORD_QUANTIZE));
    h.mix(Math.round(line.a.y * COORD_QUANTIZE));
    h.mix(Math.round(line.b.x * COORD_QUANTIZE));
    h.mix(Math.round(line.b.y * COORD_QUANTIZE));
    h.mix(line.color.charCodeAt(0) + line.color.length);
    // Magnitude is orthogonal to colour by construction (`lib/foldAngle.ts`), so
    // dialling a crease from 180 to 90 changes neither the endpoints nor the
    // colour above. Without this, the cached artifacts — and the `edges_foldAngle`
    // that reaches the export and share cards from them — keep the old angles.
    h.mix(line.fold_magnitude ?? -1);
  }
  return `${lines.length}:${h.hash >>> 0}`;
}

/** What `color.charCodeAt(0) + color.length` is for each colour number. */
const colorMixByCode = new Map<number, number>();

function colorMix(code: number): number {
  let value = colorMixByCode.get(code);
  if (value === undefined) {
    const name = lineColorName(code);
    value = name.charCodeAt(0) + name.length;
    colorMixByCode.set(code, value);
  }
  return value;
}

function creaseFingerprintOfTransport(transport: CpGeometryTransport): string {
  const { segEndpoints, segAttr, segFoldMagnitude } = transport;
  const count = segEndpoints.length / 4;
  const h = fnv();
  for (let i = 0; i < count; i += 1) {
    mixEndpoints(h, segEndpoints, i);
    h.mix(colorMix(segAttr[i * SEG_ATTR_STRIDE]!));
    h.mix(foldMagnitudeOrNone(segFoldMagnitude?.[i]));
  }
  return `${count}:${h.hash >>> 0}`;
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
  const transport = cpDocumentTransport(document);
  if (transport) return lineContentFingerprintOfTransport(transport);
  const lines = document.crease_pattern.line_segments;
  const h = fnv();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    h.mix(Math.round(line.a.x * COORD_QUANTIZE));
    h.mix(Math.round(line.a.y * COORD_QUANTIZE));
    h.mix(Math.round(line.b.x * COORD_QUANTIZE));
    h.mix(Math.round(line.b.y * COORD_QUANTIZE));
    h.mixText(line.color);
    h.mixText(line.active);
    h.mix(line.customized);
    h.mix(line.customized_color.red);
    h.mix(line.customized_color.green);
    h.mix(line.customized_color.blue);
    h.mix(line.fold_magnitude ?? -1);
    h.mixText(line.fold_direction_hint ?? '');
  }
  return `${lines.length}:${h.hash >>> 0}`;
}

function lineContentFingerprintOfTransport(transport: CpGeometryTransport): string {
  const { segEndpoints, segAttr, segCustomColor, segFoldMagnitude } = transport;
  const count = segEndpoints.length / 4;
  const h = fnv();
  for (let i = 0; i < count; i += 1) {
    const attr = i * SEG_ATTR_STRIDE;
    mixEndpoints(h, segEndpoints, i);
    h.mixText(lineColorName(segAttr[attr]!));
    h.mixText(activeStateName(segAttr[attr + 1]!));
    h.mix(segAttr[attr + 3]!);
    h.mix(segCustomColor[i * 3]!);
    h.mix(segCustomColor[i * 3 + 1]!);
    h.mix(segCustomColor[i * 3 + 2]!);
    h.mix(foldMagnitudeOrNone(segFoldMagnitude?.[i]));
    h.mixText(foldDirectionHintFromCode(segAttr[attr + 4]) ?? '');
  }
  return `${count}:${h.hash >>> 0}`;
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
