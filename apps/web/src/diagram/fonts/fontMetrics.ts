/**
 * A TrueType font's advances, read from its own tables: what the composer
 * measures text with (implementation-plans/diagram-workspace.md, Decision 2).
 *
 * The fonts the Diagram embeds carry no layout features, so no renderer kerns
 * or ligates them, and a line's width is exactly the sum of its glyphs'
 * advances — the same in Chromium, WebKit, a PDF writer and here. Browser
 * measuring APIs are up to 2 pt off in WebKit, so they are never asked.
 *
 * Reads `head` (units per em), `cmap` (formats 4 and 12, Unicode), `hhea` and
 * `hmtx`. Anything malformed is an error: a font that does not read is not
 * measured by a guess.
 *
 * Pure: no DOM.
 */

export interface FontMetrics {
  unitsPerEm: number;
  /** Whether the font has a glyph for the code point. */
  has: (codePoint: number) => boolean;
  /** The code point's advance, in font units; the missing glyph's for one the font lacks. */
  advance: (codePoint: number) => number;
  /** Every code point the font maps, for coverage. */
  codePoints: () => Iterable<number>;
}

export class FontReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontReadError';
  }
}

interface Table {
  offset: number;
  length: number;
}

/** Read a font's metrics. Throws {@link FontReadError} for a file that is not a TrueType font. */
export function readFontMetrics(bytes: ArrayBuffer | Uint8Array): FontMetrics {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (at: number) => {
    if (at + 2 > view.byteLength) throw new FontReadError('The font ends early');
    return view.getUint16(at);
  };
  const u32 = (at: number) => {
    if (at + 4 > view.byteLength) throw new FontReadError('The font ends early');
    return view.getUint32(at);
  };

  const version = u32(0);
  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new FontReadError('Not a TrueType font');
  }
  const tables = new Map<string, Table>();
  const count = u16(4);
  for (let i = 0; i < count; i += 1) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(data[record]!, data[record + 1]!, data[record + 2]!, data[record + 3]!);
    tables.set(tag, { offset: u32(record + 8), length: u32(record + 12) });
  }
  const table = (tag: string): Table => {
    const found = tables.get(tag);
    if (!found || found.offset + found.length > view.byteLength) throw new FontReadError(`No ${tag} table`);
    return found;
  };

  const unitsPerEm = u16(table('head').offset + 18);
  if (unitsPerEm < 16) throw new FontReadError('Units per em out of range');
  const numberOfHMetrics = u16(table('hhea').offset + 34);
  const hmtx = table('hmtx');
  if (numberOfHMetrics === 0 || numberOfHMetrics * 4 > hmtx.length) throw new FontReadError('Bad hmtx');
  const advanceOfGlyph = (glyph: number) =>
    u16(hmtx.offset + Math.min(glyph, numberOfHMetrics - 1) * 4);

  const glyphs = readCmap(view, table('cmap'), u16, u32);
  return {
    unitsPerEm,
    has: (codePoint) => glyphs.has(codePoint),
    advance: (codePoint) => advanceOfGlyph(glyphs.get(codePoint) ?? 0),
    codePoints: () => glyphs.keys(),
  };
}

/** The Unicode cmap's code point → glyph mapping: format 12 when present, else format 4. */
function readCmap(
  view: DataView,
  cmap: Table,
  u16: (at: number) => number,
  u32: (at: number) => number
): Map<number, number> {
  const subtables = u16(cmap.offset + 2);
  let format4: number | null = null;
  let format12: number | null = null;
  for (let i = 0; i < subtables; i += 1) {
    const record = cmap.offset + 4 + i * 8;
    const platform = u16(record);
    const encoding = u16(record + 2);
    const at = cmap.offset + u32(record + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = u16(at);
    if (format === 12) format12 = at;
    else if (format === 4 && format4 === null) format4 = at;
  }
  const glyphs = new Map<number, number>();
  if (format12 !== null) {
    const groups = u32(format12 + 12);
    for (let g = 0; g < groups; g += 1) {
      const at = format12 + 16 + g * 12;
      const start = u32(at);
      const end = u32(at + 4);
      const glyph = u32(at + 8);
      if (end < start || end - start > 0x10ffff) throw new FontReadError('Bad cmap group');
      for (let c = start; c <= end; c += 1) glyphs.set(c, glyph + (c - start));
    }
    return glyphs;
  }
  if (format4 === null) throw new FontReadError('No Unicode cmap');
  const segments = u16(format4 + 6) / 2;
  const ends = format4 + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const offsets = deltas + segments * 2;
  for (let s = 0; s < segments; s += 1) {
    const end = u16(ends + s * 2);
    const start = u16(starts + s * 2);
    const delta = view.getInt16(deltas + s * 2);
    const rangeOffset = u16(offsets + s * 2);
    if (start === 0xffff) continue;
    for (let c = start; c <= end; c += 1) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (c + delta) & 0xffff;
      } else {
        const at = offsets + s * 2 + rangeOffset + (c - start) * 2;
        const raw = u16(at);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) glyphs.set(c, glyph);
    }
  }
  return glyphs;
}
