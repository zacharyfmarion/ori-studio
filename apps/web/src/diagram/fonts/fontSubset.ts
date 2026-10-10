/**
 * Cut a font down to the characters a page uses, with every layout feature
 * dropped: what a page SVG embeds (implementation-plans/diagram-workspace.md,
 * Decision 2). HarfBuzz's subsetter (harfbuzzjs's `harfbuzz-subset.wasm`,
 * MIT), called through its C API.
 *
 * A font is copied into wasm memory once, under its id, and its face kept, as
 * the app keeps a loaded CJK font: cutting a page's subset is then a
 * millisecond or so in Chromium.
 *
 * The wasm is handed in, so the browser fetches it from the bundle and a test
 * reads it from disk.
 */

/** The wasm module's exports this uses. */
interface HbSubsetExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  malloc: (size: number) => number;
  free: (pointer: number) => void;
  hb_blob_create: (data: number, length: number, mode: number, user: number, destroy: number) => number;
  hb_blob_destroy: (blob: number) => void;
  hb_blob_get_data: (blob: number, length: number) => number;
  hb_blob_get_length: (blob: number) => number;
  hb_face_create: (blob: number, index: number) => number;
  hb_face_destroy: (face: number) => void;
  hb_face_reference_blob: (face: number) => number;
  hb_set_add: (set: number, codePoint: number) => void;
  hb_set_clear: (set: number) => void;
  hb_subset_input_create_or_fail: () => number;
  hb_subset_input_destroy: (input: number) => void;
  hb_subset_input_set: (input: number, kind: number) => number;
  hb_subset_input_set_flags: (input: number, flags: number) => void;
  hb_subset_input_unicode_set: (input: number) => number;
  hb_subset_or_fail: (face: number, input: number) => number;
}

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
/**
 * Keep the missing-glyph box's outline, which HarfBuzz otherwise empties. The
 * PDF writer refuses a page that would print one (`crates/oristudio-pdf`), but
 * a text drawn only in empty boxes has no outline at all, and usvg drops it
 * before anything can see it. About 40 bytes a subset; a browser never shows
 * the box, since it falls back for a character the font lacks.
 */
const HB_SUBSET_FLAGS_NOTDEF_OUTLINE = 0x40;

export class FontSubsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontSubsetError';
  }
}

export interface FontSubsetter {
  /**
   * The font held under `fontId` (loading `bytes` the first time), cut to the
   * code points of `text`, with no layout features.
   */
  subset: (fontId: string, bytes: Uint8Array, text: string) => Uint8Array;
}

/** A subsetter over the wasm's bytes. */
export async function createFontSubsetter(wasm: ArrayBuffer | Uint8Array): Promise<FontSubsetter> {
  const module = await WebAssembly.instantiate(wasm as BufferSource, {});
  const hb = module.instance.exports as unknown as HbSubsetExports;
  hb._initialize?.();
  const heap = () => new Uint8Array(hb.memory.buffer);
  const faces = new Map<string, number>();

  const faceOf = (fontId: string, bytes: Uint8Array) => {
    let face = faces.get(fontId);
    if (face === undefined) {
      const pointer = hb.malloc(bytes.length);
      if (!pointer) throw new FontSubsetError('Out of memory for a font');
      heap().set(bytes, pointer);
      // The blob is the face's to keep: the memory is never freed while the face lives.
      const blob = hb.hb_blob_create(pointer, bytes.length, HB_MEMORY_MODE_WRITABLE, 0, 0);
      face = hb.hb_face_create(blob, 0);
      hb.hb_blob_destroy(blob);
      faces.set(fontId, face);
    }
    return face;
  };

  return {
    subset(fontId, bytes, text) {
      const face = faceOf(fontId, bytes);
      const input = hb.hb_subset_input_create_or_fail();
      if (!input) throw new FontSubsetError('The subsetter could not start');
      try {
        // No layout features: no renderer may kern, ligate or substitute.
        hb.hb_set_clear(hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG));
        hb.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_NOTDEF_OUTLINE);
        const unicodes = hb.hb_subset_input_unicode_set(input);
        for (const character of text) hb.hb_set_add(unicodes, character.codePointAt(0)!);
        const subset = hb.hb_subset_or_fail(face, input);
        if (!subset) throw new FontSubsetError('The font could not be subset');
        const blob = hb.hb_face_reference_blob(subset);
        const at = hb.hb_blob_get_data(blob, 0);
        const length = hb.hb_blob_get_length(blob);
        const out = heap().slice(at, at + length);
        hb.hb_blob_destroy(blob);
        hb.hb_face_destroy(subset);
        if (length === 0) throw new FontSubsetError('The subset is empty');
        return out;
      } finally {
        hb.hb_subset_input_destroy(input);
      }
    },
  };
}
