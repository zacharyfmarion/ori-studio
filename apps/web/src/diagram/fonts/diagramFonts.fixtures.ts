/**
 * The diagram's fonts for tests, read from the repository: Noto Sans as the
 * app bundles it, and the cut-down Noto Sans SC fixtures beside it. Node only.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DIAGRAM_FONT_FAMILY, type DiagramFontKey, type DiagramFontWeight } from './diagramFontFaces';
import type { DiagramFonts, LoadedDiagramFont } from './diagramFonts';
import { readFontMetrics } from './fontMetrics';
import { createFontSubsetter, type FontSubsetter } from './fontSubset';

const FONT_DIR = resolve(process.cwd(), 'src/diagram/fonts');
const FILES: Partial<Record<string, string>> = {
  'latin-400': 'NotoSans-Regular.ttf',
  'latin-700': 'NotoSans-Bold.ttf',
  'sc-400': 'fixtures/NotoSansSC-Regular.fixture.ttf',
  'sc-700': 'fixtures/NotoSansSC-Bold.fixture.ttf',
};

const loaded = new Map<string, LoadedDiagramFont>();

/** Noto Sans and the Chinese fixture face, at both weights. */
export const FIXTURE_FONTS: DiagramFonts = {
  font(key: DiagramFontKey, weight: DiagramFontWeight): LoadedDiagramFont | null {
    const id = `${key}-${weight}`;
    const file = FILES[id];
    if (!file) return null;
    let font = loaded.get(id);
    if (!font) {
      const bytes = new Uint8Array(readFileSync(resolve(FONT_DIR, file)));
      font = { key, weight, family: DIAGRAM_FONT_FAMILY[key], tier: 'common', bytes, metrics: readFontMetrics(bytes) };
      loaded.set(id, font);
    }
    return font;
  },
  unavailable: [],
};

/** hb-subset, from the package the app loads it from. */
export function fixtureSubsetter(): Promise<FontSubsetter> {
  const require = createRequire(import.meta.url);
  return createFontSubsetter(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));
}
