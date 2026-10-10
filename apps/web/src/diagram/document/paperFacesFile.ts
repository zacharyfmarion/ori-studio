/**
 * A flat capture's faces on the paper as the project file holds them
 * (Revision 2, `DiagramScenePicture.paperFaces`): their reader and writer.
 *
 * Apart from the rest of the file's reader (`diagramFile.ts`) because the
 * frames' pure modules read them, and the document's own picture edits reach
 * those — an enlarged step's frame follows its picture through
 * `withCarriedAnnotations` — so nothing here may import the document's values:
 * the file's reader builds tables from them as it loads.
 *
 * React-free, store-free and DOM-free.
 */
import type { DiagramPaperFaces } from './diagramDocument';

/** The most a stored scene may be, as JSON: D2's per-step budget, with room. A capture's faces are held to it too. */
export const SCENE_JSON_MAX_BYTES = 4 * 1024 * 1024;

/** Faces written by a newer build: a field this build has no name for. Their step is locked, and kept verbatim. */
export const NEWER_PAPER_FACES: unique symbol = Symbol('newer paper faces');

/** The fields a stored `paperFaces` is written with; any other makes its step a newer build's. */
const PAPER_FACES_KEYS: ReadonlySet<string> = new Set(['points', 'rings', 'levels']);

/**
 * A flat capture's `paperFaces` (Revision 2): a string of JSON holding each
 * point's place on the paper and on the unspread picture, and each face's
 * ring of points and level. A field this build has no name for is a newer
 * build's. Damage — a string that is not that, counts that disagree, an index
 * past the points, a ring of one or two — drops it, and the step anchors
 * nothing until it is refreshed. Kept as this build writes it: compact, its
 * three fields in order.
 */
export function readPaperFaces(
  value: unknown
): { json: string; faces: DiagramPaperFaces } | typeof NEWER_PAPER_FACES | null {
  if (typeof value !== 'string' || value.length > SCENE_JSON_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (Object.keys(parsed).some((key) => !PAPER_FACES_KEYS.has(key))) return NEWER_PAPER_FACES;
  const { points, rings, levels } = parsed;
  if (!Array.isArray(points) || !Array.isArray(rings) || !Array.isArray(levels)) return null;
  if (rings.length !== levels.length) return null;
  const isPoint = (point: unknown) =>
    Array.isArray(point) && point.length === 4 && point.every((value) => typeof value === 'number' && Number.isFinite(value));
  if (!points.every(isPoint)) return null;
  const isRing = (ring: unknown) =>
    Array.isArray(ring) &&
    (ring.length === 0 || ring.length >= 3) &&
    ring.every((index) => Number.isInteger(index) && index >= 0 && index < points.length);
  if (!rings.every(isRing) || !levels.every((level) => Number.isInteger(level) && level >= 0)) return null;
  const faces = { points, rings, levels } as DiagramPaperFaces;
  return { json: JSON.stringify(faces), faces };
}

/**
 * A flat capture's faces as a step stores them: through the file's own
 * reader, so what a capture writes is byte for byte what a load reads back.
 * Null for faces the reader refuses, or that would be past what it reads.
 */
export function storedPaperFaces(faces: DiagramPaperFaces): string | null {
  const read = readPaperFaces(JSON.stringify(faces));
  return read && read !== NEWER_PAPER_FACES ? read.json : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
