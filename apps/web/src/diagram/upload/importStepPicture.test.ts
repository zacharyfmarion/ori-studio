import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileTooLargeError, pickedFileFromFile } from '../../platform/fileService';
import {
  importStepPicture,
  isStepPictureFile,
  naturalFileOrder,
  pictureFormat,
  type ImportDependencies,
  type PictureFile,
} from './importStepPicture';
import { SVG_NS, browserSanitizeEnv } from './svgSanitize';

const here = dirname(new URL(import.meta.url).pathname);
const fixture = (path: string) => readFileSync(join(here, 'fixtures', path), 'utf8');

function file(name: string, text: string, type = ''): PictureFile {
  const bytes = new TextEncoder().encode(text);
  return { name, type, size: bytes.length, read: async () => bytes };
}

function dependencies(encode?: ImportDependencies['encodeRaster']): ImportDependencies {
  return {
    encodeRaster: encode ?? vi.fn(async () => ({ src: 'data:image/png;base64,AAAA', width: 4, height: 2 })),
    env: browserSanitizeEnv(),
  };
}

describe('pictureFormat', () => {
  it('knows a file by its type, then by its name', () => {
    expect(pictureFormat({ name: 'a.bin', type: 'image/svg+xml' })).toBe('svg');
    expect(pictureFormat({ name: 'step-1.SVG', type: '' })).toBe('svg');
    expect(pictureFormat({ name: 'photo.jpg', type: '' })).toBe('jpeg');
    expect(pictureFormat({ name: 'x', type: 'image/webp' })).toBe('webp');
    expect(pictureFormat({ name: 'notes.txt', type: 'text/plain' })).toBe('other');
    expect(isStepPictureFile({ name: 'scan.tiff', type: 'image/tiff' })).toBe(true);
    expect(isStepPictureFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });
});

describe('importStepPicture', () => {
  it('sanitizes an SVG under the asset’s id prefix', async () => {
    const result = await importStepPicture(
      file('crane.svg', fixture('synthetic/idcollide-a.svg')),
      'asset-1',
      dependencies()
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.content.kind).toBe('svg');
    if (result.content.kind !== 'svg') return;
    expect(result.content.svg).toMatch(/id="asset-1-/);
    expect(result.bytes).toBe(result.content.svg.length);
    expect(result.notices).toEqual([]);
  });

  it('re-encodes a raster inside an SVG, and drops one that will not', async () => {
    const svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><image width="1" height="1" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="/></svg>`;
    const kept = await importStepPicture(file('a.svg', svg), 'asset-1', dependencies());
    expect(kept.ok && kept.content.kind === 'svg' && kept.content.svg).toMatch(/href="data:image\/png;base64,AAAA"/);
    const failing = dependencies(async () => {
      throw new Error('no decoder');
    });
    const dropped = await importStepPicture(file('a.svg', svg), 'asset-1', failing);
    expect(dropped.ok && dropped.content.kind === 'svg' && dropped.content.svg).not.toMatch(/<image/);
  });

  it('refuses a hostile or broken SVG', async () => {
    const result = await importStepPicture(
      file('bomb.svg', fixture('hostile/h11-billion-laughs.svg')),
      'asset-1',
      dependencies()
    );
    expect(result).toMatchObject({ ok: false, format: 'svg', reason: 'rejected' });
    // The size it was read at, for analytics.
    expect(result.fileBytes).toBe(new TextEncoder().encode(fixture('hostile/h11-billion-laughs.svg')).length);
    expect(await importStepPicture(file('x.svg', '<html/>'), 'asset-1', dependencies())).toMatchObject({
      reason: 'rejected',
    });
  });

  it('refuses a bitmap the canvas could not encode, rather than storing what a load would drop', async () => {
    const result = await importStepPicture(
      file('photo.png', 'not really png', 'image/png'),
      'asset-1',
      dependencies(vi.fn(async () => ({ src: 'data:,', width: 0, height: 0 })))
    );
    expect(result).toMatchObject({ ok: false, format: 'png', reason: 'unreadable' });
  });

  it('refuses past the read caps without reading, and past the stored cap after sanitizing', async () => {
    const read = vi.fn();
    const huge: PictureFile = { name: 'big.svg', type: '', size: 17 * 1024 * 1024, read };
    expect(await importStepPicture(huge, 'asset-1', dependencies())).toMatchObject({ reason: 'too_large' });
    expect(read).not.toHaveBeenCalled();
    const tooMuchKept = `<svg xmlns="${SVG_NS}" viewBox="0 0 1 1"><path d="${'M0 0L1 1'.repeat(300_000)}"/></svg>`;
    expect(await importStepPicture(file('dense.svg', tooMuchKept), 'asset-1', dependencies())).toMatchObject({
      reason: 'too_large',
    });
    const desktop: PictureFile = {
      name: 'big.png',
      type: '',
      size: 0,
      read: async () => {
        throw new FileTooLargeError();
      },
    };
    expect(await importStepPicture(desktop, 'asset-1', dependencies())).toMatchObject({ reason: 'too_large' });
  });

  it('re-encodes a raster, typed from its name when the platform gave no type', async () => {
    const encode = vi.fn(async (input: File) => ({ src: `data:image/jpeg;base64,${input.type}`, width: 2048, height: 1024 }));
    const result = await importStepPicture(file('photo.jpg', 'xx'), 'asset-1', dependencies(encode));
    expect(encode.mock.calls[0][0].type).toBe('image/jpeg');
    expect(result).toMatchObject({
      ok: true,
      format: 'jpeg',
      content: { kind: 'raster', widthPx: 2048, heightPx: 1024 },
    });
  });

  it('says a raster that will not decode is unreadable, and a text file unsupported', async () => {
    const failing = dependencies(async () => {
      throw new Error('decode failed');
    });
    expect(await importStepPicture(file('a.png', 'nope'), 'asset-1', failing)).toMatchObject({
      reason: 'unreadable',
    });
    expect(await importStepPicture(file('a.txt', 'hi', 'text/plain'), 'asset-1', failing)).toMatchObject({
      reason: 'unsupported',
    });
  });
});

describe('pickedFileFromFile', () => {
  it('refuses to read a file past the cap', async () => {
    const picture = pickedFileFromFile(new File(['abcd'], 'a.png', { type: 'image/png' }));
    await expect(picture.read(2)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(await picture.read(10)).toHaveLength(4);
  });
});

describe('naturalFileOrder', () => {
  it('puts step-2 before step-10', () => {
    const names = ['step-10.svg', 'step-2.svg', 'Step-1.svg'].map((name) => ({ name }));
    expect(naturalFileOrder(names).map((entry) => entry.name)).toEqual([
      'Step-1.svg',
      'step-2.svg',
      'step-10.svg',
    ]);
  });
});
