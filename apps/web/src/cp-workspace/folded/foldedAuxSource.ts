/**
 * Which aux lines a crease pattern holds, as one key.
 *
 * A folded figure draws the document's auxiliary (`Cyan3`) lines as they stand
 * now, not as they stood at the fold: nothing folds an aux line, so the kernel
 * carries the document's current ones onto a figure's faces on every ask
 * (`folded_figure_paper_scene`, `folded_figure_3d_aux_lines`). A figure asks
 * again when this key changes — an aux line drawn, moved, recoloured or erased
 * — and not for any other edit, which leaves its aux lines where they were.
 *
 * A hash of every aux segment's endpoints in order, so two documents with the
 * same aux lines share a key and a figure fetched under one is current under
 * the other. Cached per transport, which the store replaces on every edit.
 */
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import { reportError } from '../../monitoring';

/** Oriedita's `Cyan3`, the auxiliary line colour in `segAttr`'s first slot. */
const CYAN3 = 3;

/** The key of a document with no aux lines, and of no document. */
export const NO_AUX_LINES_KEY = 'none';

/**
 * Where a canvas's folded figures take their aux lines from: the editable
 * document they were folded from, and which aux lines it holds now. `null`
 * for the handle asks for the lines captured at each figure's fold.
 */
export interface FoldedAuxSource {
  documentHandle: number | null;
  auxKey: string;
}

/** No document: every figure draws the aux lines it was folded with. */
export const NO_FOLDED_AUX_SOURCE: FoldedAuxSource = {
  documentHandle: null,
  auxKey: NO_AUX_LINES_KEY,
};

const keys = new WeakMap<CpGeometryTransport, string>();
const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);

export function cpAuxLinesKey(geometry: CpGeometryTransport | null | undefined): string {
  if (!geometry) return NO_AUX_LINES_KEY;
  const cached = keys.get(geometry);
  if (cached !== undefined) return cached;
  const { segEndpoints, segAttr } = geometry;
  const count = segEndpoints.length / 4;
  // FNV-1a over the endpoints' bit patterns, two words per coordinate.
  let hash = 0x811c9dc5;
  let lines = 0;
  for (let i = 0; i < count; i += 1) {
    if (segAttr[i * SEG_ATTR_STRIDE] !== CYAN3) continue;
    lines += 1;
    for (let k = 0; k < 4; k += 1) {
      bits[0] = segEndpoints[i * 4 + k]!;
      for (const word of words) {
        hash ^= word;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
  }
  const key = lines === 0 ? NO_AUX_LINES_KEY : `${lines}:${hash.toString(16)}`;
  keys.set(geometry, key);
  return key;
}

/** How long to wait before asking again after a failed ask, per retry. */
const RETRY_DELAYS_MS = [500, 2000] as const;

/**
 * Ask the kernel for a figure's aux lines, twice more — a little later each
 * time — if the ask fails, and report the failure when it still does. The
 * figure draws either way; it is the aux lines that would otherwise go
 * missing without a word. `wanted` says whether an answer is still wanted: a
 * handle freed or a newer ask ends the tries, and nothing is reported for an
 * answer nobody is waiting for. Resolves `undefined` when there is no answer.
 */
export async function askForAuxLines<T>(
  ask: () => Promise<T>,
  wanted: () => boolean,
  surface: string
): Promise<T | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ask();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !wanted()) {
        if (wanted()) reportError(error, { surface });
        return undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!wanted()) return undefined;
    }
  }
}
