/**
 * The app's own font files: Noto Sans from the bundle, and the CJK files and
 * their manifest from the app's origin (Decision 2: same origin, so nothing a
 * network in China blocks stands between a reader and their text).
 *
 * The desktop app ships the manifest and the common files, which hold the
 * characters almost every text uses, and fetches a full file — 5 MB, for a
 * rare character — from the site, as it does the CP detector's models. A dev
 * shell is served by the dev server, which has them all.
 */
import notoSansBoldUrl from './NotoSans-Bold.ttf?url';
import notoSansRegularUrl from './NotoSans-Regular.ttf?url';
import { getRuntimeSurface, type RuntimeSurface } from '../../platform/runtime';
import { SITE_ORIGIN } from '../../seo/siteMeta';
import type { DiagramFontSource } from './diagramFonts';

const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
const CJK_FONTS = `${base}fonts/diagram/`;

/** Where a CJK file is read from: the app's own origin, or for a full file on the desktop, the site. */
export function diagramFontUrl(
  name: string,
  surface: RuntimeSurface = getRuntimeSurface(),
  dev: boolean = Boolean(import.meta.env.DEV)
): string {
  const remote = surface === 'desktop' && !dev && name.includes('.full.');
  return `${remote ? `${SITE_ORIGIN}/fonts/diagram/` : CJK_FONTS}${encodeURIComponent(name)}`;
}

async function bytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  // The site answers a path it does not have with the app's page, status 200:
  // a font it no longer serves is a failed download, not a font.
  if (response.headers.get('content-type')?.includes('text/html')) throw new Error(`${url}: not a font`);
  return response.arrayBuffer();
}

export const browserFontSource: DiagramFontSource = {
  latin: (weight) => bytes(weight === 700 ? notoSansBoldUrl : notoSansRegularUrl),
  manifest: async () => {
    const response = await fetch(`${CJK_FONTS}manifest.json`);
    if (!response.ok) throw new Error(`manifest: ${response.status}`);
    return response.json() as Promise<unknown>;
  },
  file: (name) => bytes(diagramFontUrl(name)),
};
