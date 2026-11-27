import { strFromU8, strToU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipPages } from './zipPages';

afterEach(() => {
  vi.doUnmock('fflate');
});

describe('zipPages', () => {
  it('writes every page under its name, in order, and reads back byte for byte', () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const archive = zipPages([
      { name: 'Crane-step-01.svg', data: strToU8('<svg>one</svg>'), compress: true },
      { name: 'Crane-step-02.png', data: png, compress: false },
    ]);
    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(['Crane-step-01.svg', 'Crane-step-02.png']);
    expect(strFromU8(files['Crane-step-01.svg']!)).toBe('<svg>one</svg>');
    expect([...files['Crane-step-02.png']!]).toEqual([...png]);
  });

  it('writes the archive with nothing left to fetch (ORI-STUDIO-X)', async () => {
    // The connection dropping after the workspace arrived: every module asked for from here on fails, as
    // the ZIP writer's own chunk did, press after press, for a reader whose project was open.
    vi.doMock('fflate', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const archive = await zipPages([{ name: 'a.svg', data: strToU8('<svg/>'), compress: true }]);
    expect(Object.keys(unzipSync(archive))).toEqual(['a.svg']);
  });
});
