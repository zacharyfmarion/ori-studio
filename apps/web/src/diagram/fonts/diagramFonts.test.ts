// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadDiagramFonts, readManifest, type DiagramFontSource } from './diagramFonts';

const FONT_DIR = resolve(process.cwd(), 'src/diagram/fonts');
const bytesOf = (path: string) => new Uint8Array(readFileSync(resolve(FONT_DIR, path)));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Files standing in for the served ones. The Japanese fixture plays Chinese's
 * common file: it has 鶴 and none of 纸 or 鹤, so a text with those has to
 * reach the full file, played by the Chinese fixture.
 */
const FILES: Record<string, Uint8Array> = {
  'NotoSansSC-Regular.common.ttf': bytesOf('fixtures/NotoSansJP-Regular.fixture.ttf'),
  'NotoSansSC-Regular.full.ttf': bytesOf('fixtures/NotoSansSC-Regular.fixture.ttf'),
  'NotoSansSC-Bold.common.ttf': bytesOf('fixtures/NotoSansSC-Bold.fixture.ttf'),
  'NotoSansKR-Regular.common.ttf': bytesOf('fixtures/NotoSansKR-Regular.fixture.ttf'),
};

function manifest(patch: (files: Record<string, unknown>[]) => void = () => {}) {
  const files = Object.entries(FILES).map(([file, bytes]) => {
    const [, script, style, tier] = /^NotoSans(\w\w)-(\w+)\.(\w+)\.ttf$/.exec(file)!;
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

  it('takes a face’s common file when it has every character, the full file when it does not', async () => {
    const files = source();
    const common = await loadDiagramFonts([{ text: '鶴', weight: 400 }], 'sc', files);
    expect(common.font('sc', 400)?.tier).toBe('common');
    const full = await loadDiagramFonts([{ text: 'Crane 千纸鹤', weight: 400 }], 'sc', files);
    expect(full.font('sc', 400)?.tier).toBe('full');
    expect(files.fetched).toEqual(['NotoSansSC-Regular.common.ttf', 'NotoSansSC-Regular.full.ttf']);
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
    expect(readManifest(manifest())).toHaveLength(4);
    expect(() => readManifest({ version: 2, files: [] })).toThrow();
    expect(() => readManifest(manifest((files) => (files[0]!.file = '../secret.ttf')))).toThrow();
    expect(() => readManifest(manifest((files) => (files[0]!.sha256 = 'nope')))).toThrow();
  });
});
