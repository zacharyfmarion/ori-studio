import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ZipUnavailableError, loadFflate, zipPages } from './zipPages';

describe('zipPages', () => {
  it('writes every page under its name, in order, and reads back byte for byte', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const archive = await zipPages([
      { name: 'Crane-step-01.svg', data: strToU8('<svg>one</svg>'), compress: true },
      { name: 'Crane-step-02.png', data: png, compress: false },
    ]);
    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(['Crane-step-01.svg', 'Crane-step-02.png']);
    expect(strFromU8(files['Crane-step-01.svg']!)).toBe('<svg>one</svg>');
    expect([...files['Crane-step-02.png']!]).toEqual([...png]);
  });

  it('turns a writer that cannot be loaded into an error the dialog can word', async () => {
    const gone = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
    await expect(loadFflate(gone)).rejects.toBeInstanceOf(ZipUnavailableError);
    await expect(
      zipPages([{ name: 'a.svg', data: strToU8('<svg/>'), compress: true }], () => loadFflate(gone))
    ).rejects.toThrow('The ZIP writer could not be loaded');
  });
});
