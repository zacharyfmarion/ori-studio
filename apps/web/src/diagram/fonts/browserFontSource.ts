/**
 * The app's own font files: Noto Sans from the bundle, and the CJK files and
 * their manifest from the app's origin (Decision 2: same origin, so nothing a
 * network in China blocks stands between a reader and their text).
 */
import notoSansBoldUrl from './NotoSans-Bold.ttf?url';
import notoSansRegularUrl from './NotoSans-Regular.ttf?url';
import type { DiagramFontSource } from './diagramFonts';

const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
const CJK_FONTS = `${base}fonts/diagram/`;

async function bytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}

export const browserFontSource: DiagramFontSource = {
  latin: (weight) => bytes(weight === 700 ? notoSansBoldUrl : notoSansRegularUrl),
  manifest: async () => {
    const response = await fetch(`${CJK_FONTS}manifest.json`);
    if (!response.ok) throw new Error(`manifest: ${response.status}`);
    return response.json() as Promise<unknown>;
  },
  file: (name) => bytes(`${CJK_FONTS}${encodeURIComponent(name)}`),
};
