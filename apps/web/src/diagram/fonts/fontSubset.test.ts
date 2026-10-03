import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFontMetrics } from './fontMetrics';
import { createFontSubsetter } from './fontSubset';

const require = createRequire(import.meta.url);
const wasm = () => readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'));
const font = (name: string) => new Uint8Array(readFileSync(resolve(process.cwd(), 'src/diagram/fonts', name)));

describe('createFontSubsetter', () => {
  it('cuts a font to a page’s characters, keeping their advances', async () => {
    const subsetter = await createFontSubsetter(wasm());
    const regular = font('NotoSans-Regular.ttf');
    const cut = subsetter.subset('latin-400', regular, 'Fold P onto Q.');
    expect(cut.length).toBeLessThan(regular.length / 4);
    const before = readFontMetrics(regular);
    const after = readFontMetrics(cut);
    for (const character of 'Fold P onto Q.') {
      expect(after.has(character.codePointAt(0)!)).toBe(true);
      expect(after.advance(character.codePointAt(0)!)).toBe(before.advance(character.codePointAt(0)!));
    }
    expect(after.has('Z'.codePointAt(0)!)).toBe(false);
  });

  it('keeps one face per font, and cuts again from it', async () => {
    const subsetter = await createFontSubsetter(wasm());
    const regular = font('NotoSans-Regular.ttf');
    const a = subsetter.subset('latin-400', regular, 'ab');
    const b = subsetter.subset('latin-400', regular, 'abc');
    expect(b.length).toBeGreaterThan(a.length);
  });
});
