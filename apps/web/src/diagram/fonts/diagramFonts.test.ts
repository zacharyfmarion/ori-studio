// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadDiagramFonts, readManifest, type DiagramFontSource } from './diagramFonts';
import { readFontMetrics } from './fontMetrics';

const readFontMetricsOf = (bytes: Uint8Array) => readFontMetrics(bytes);

/** Code points as build_fonts.py writes a script's coverage: `gap.length` runs in base 36. */
function encodeCoverage(codePoints: number[]): string {
  const runs: [number, number][] = [];
  for (const codePoint of [...codePoints].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && last[1] === codePoint - 1) last[1] = codePoint;
    else runs.push([codePoint, codePoint]);
  }
  let previous = -1;
  return runs
    .map(([first, last]) => {
      const part = `${(first - previous - 1).toString(36)}.${(last - first).toString(36)}`;
      previous = last;
      return part;
    })
    .join(',');
}

const FONT_DIR = resolve(process.cwd(), 'src/diagram/fonts');
const bytesOf = (path: string) => new Uint8Array(readFileSync(resolve(FONT_DIR, path)));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Files standing in for the served ones. The Japanese fixture plays Chinese's
 * common file: it has 鶴 and none of 纸 or 鹤, so a text with those has to
 * reach the full file, played by the Chinese fixture.
 */
const FILES: Record<string, Uint8Array> = {
  'NotoSansSC-Regular.common.0123456789ab.ttf': bytesOf('fixtures/NotoSansJP-Regular.fixture.ttf'),
  'NotoSansSC-Regular.full.0123456789ab.ttf': bytesOf('fixtures/NotoSansSC-Regular.fixture.ttf'),
  'NotoSansSC-Bold.common.0123456789ab.ttf': bytesOf('fixtures/NotoSansSC-Bold.fixture.ttf'),
  'NotoSansKR-Regular.common.0123456789ab.ttf': bytesOf('fixtures/NotoSansKR-Regular.fixture.ttf'),
};

function manifest(patch: (files: Record<string, unknown>[]) => void = () => {}) {
  const files = Object.entries(FILES).map(([file, bytes]) => {
    const [, script, style, tier] = /^NotoSans(\w\w)-(\w+)\.(\w+)\.\w+\.ttf$/.exec(file)!;
    return { file, script: script!.toLowerCase(), weight: style === 'Bold' ? 700 : 400, tier, bytes: bytes.length, sha256: sha(bytes) };
  });
  patch(files);
  return { version: 1, source: {}, files };
}

function source(overrides: Partial<DiagramFontSource> = {}): DiagramFontSource & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    latin: async (weight) => bytesOf(weight === 700 ? 'NotoSans-Bold.ttf' : 'NotoSans-Regular.ttf').slice().buffer,
    manifest: async () => manifest(),
    file: async (name) => {
      fetched.push(name);
      const bytes = FILES[name];
      if (!bytes) throw new Error(`404 ${name}`);
      return bytes.slice().buffer;
    },
    ...overrides,
  };
}

describe('loadDiagramFonts', () => {
  it('loads Noto Sans at both weights, and nothing else for a Latin diagram', async () => {
    const files = source();
    const fonts = await loadDiagramFonts([{ text: 'Crane', weight: 700 }, { text: 'Fold.', weight: 400 }], 'sc', files);
    expect(fonts.font('latin', 400)?.tier).toBe('bundled');
    expect(fonts.font('latin', 700)?.metrics.has('C'.codePointAt(0)!)).toBe(true);
    expect(fonts.font('sc', 400)).toBeNull();
    expect(files.fetched).toEqual([]);
  });

  it('fetches nothing for a tab or a line break, which draw as a space or nothing', async () => {
    const files = source();
    await loadDiagramFonts([{ text: '\n\tFold\r\n', weight: 400 }], 'sc', files);
    expect(files.fetched).toEqual([]);
  });

  it('takes a face’s common file when it has every character, the full file when it does not', async () => {
    const files = source();
    const common = await loadDiagramFonts([{ text: '鶴', weight: 400 }], 'sc', files);
    expect(common.font('sc', 400)?.tier).toBe('common');
    const full = await loadDiagramFonts([{ text: 'Crane 千纸鹤', weight: 400 }], 'sc', files);
    expect(full.font('sc', 400)?.tier).toBe('full');
    expect(files.fetched).toEqual(['NotoSansSC-Regular.common.0123456789ab.ttf', 'NotoSansSC-Regular.full.0123456789ab.ttf']);
  });

  it('fetches the full file only for a character it has, as the manifest says', async () => {
    // The Chinese fixture (playing the full file) covers 纸 and 鹤 but not 𠀀.
    const full = FILES['NotoSansSC-Regular.full.0123456789ab.ttf']!;
    const coverage = { sc: encodeCoverage([...readFontMetricsOf(full).codePoints()]) };
    const files = source({ manifest: async () => ({ ...manifest(), coverage }) });
    const none = await loadDiagramFonts([{ text: '鶴𠀀', weight: 400 }], 'sc', files);
    expect(none.font('sc', 400)?.tier).toBe('common');
    expect(files.fetched).toEqual(['NotoSansSC-Regular.common.0123456789ab.ttf']);
    const some = await loadDiagramFonts([{ text: '鶴纸', weight: 400 }], 'sc', files);
    expect(some.font('sc', 400)?.tier).toBe('full');
  });

  it('loads a CJK face for a Latin text with a symbol Noto Sans lacks', async () => {
    const files = source();
    const fonts = await loadDiagramFonts([{ text: 'Fold along ① and turn over', weight: 400 }], 'sc', files);
    expect(fonts.font('sc', 400)).not.toBeNull();
    // And none for one it has, joiners included.
    const plain = source();
    await loadDiagramFonts([{ text: 'Fold café\u200d in half', weight: 400 }], 'sc', plain);
    expect(plain.fetched).toEqual([]);
  });

  it('keeps the common file when the full one cannot be had, and says the face is not whole', async () => {
    const files = source({
      file: async (name) => {
        if (name.includes('.full.')) throw new Error('offline');
        return FILES[name]!.slice().buffer;
      },
    });
    const fonts = await loadDiagramFonts([{ text: '千纸鹤', weight: 400 }], 'sc', files);
    expect(fonts.font('sc', 400)?.tier).toBe('common');
    expect(fonts.unavailable).toEqual([{ key: 'sc', weight: 400 }]);
  });

  it('loads a face per weight and script the text needs', async () => {
    const fonts = await loadDiagramFonts(
      [
        { text: 'Crane · 千纸鹤', weight: 700 },
        { text: '아래 모서리를', weight: 400 },
      ],
      'sc',
      source()
    );
    expect(fonts.font('sc', 700)?.tier).toBe('common');
    expect(fonts.font('kr', 400)?.family).toBe('Noto Sans KR');
    expect(fonts.unavailable).toEqual([]);
  });

  it('refuses a download that is not the file the manifest names, and says which face it lacks', async () => {
    const files = source({
      manifest: async () =>
        manifest((entries) => {
          entries[2]!.sha256 = '0'.repeat(64);
        }),
    });
    const fonts = await loadDiagramFonts([{ text: '千纸鹤', weight: 700 }], 'sc', files);
    expect(fonts.font('sc', 700)).toBeNull();
    expect(fonts.unavailable).toEqual([{ key: 'sc', weight: 700 }]);
  });

  it('tries again after a failure, and keeps what loaded', async () => {
    let fail = true;
    const file = vi.fn(async (name: string) => {
      if (fail) throw new Error('offline');
      return FILES[name]!.slice().buffer;
    });
    const files = source({ file });
    expect((await loadDiagramFonts([{ text: '아래', weight: 400 }], 'sc', files)).unavailable).toHaveLength(1);
    fail = false;
    const fonts = await loadDiagramFonts([{ text: '아래', weight: 400 }], 'sc', files);
    expect(fonts.font('kr', 400)?.tier).toBe('common');
    await loadDiagramFonts([{ text: '아래', weight: 400 }], 'sc', files);
    expect(file).toHaveBeenCalledTimes(2);
  });
});

describe('readManifest', () => {
  it('reads the files, and refuses a manifest or an entry that does not read', () => {
    expect(readManifest(manifest()).files).toHaveLength(4);
    expect(() => readManifest({ version: 2, files: [] })).toThrow();
    expect(() => readManifest(manifest((files) => (files[0]!.file = '../secret.ttf')))).toThrow();
    expect(() => readManifest(manifest((files) => (files[0]!.sha256 = 'nope')))).toThrow();
    // Coverage: runs read back as written; anything else refuses the manifest.
    expect(readManifest({ ...manifest(), coverage: { sc: encodeCoverage([3, 4, 5, 9, 0x4e00]) } }).coverage).toEqual({
      sc: [
        [3, 5],
        [9, 9],
        [0x4e00, 0x4e00],
      ],
    });
    expect(() => readManifest({ ...manifest(), coverage: { sc: '3-4' } })).toThrow();
    expect(() => readManifest({ ...manifest(), coverage: { xx: '0.0' } })).toThrow();
  });
});
