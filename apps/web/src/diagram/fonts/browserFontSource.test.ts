import { describe, expect, it } from 'vitest';
import { diagramFontUrl } from './browserFontSource';

const FULL = 'NotoSansJP-Bold.full.0a1b2c3d4e5f.ttf';
const COMMON = 'NotoSansJP-Bold.common.0a1b2c3d4e5f.ttf';

describe('diagramFontUrl', () => {
  it('reads every file from the app’s own origin on the web', () => {
    expect(diagramFontUrl(FULL, 'web', false)).toBe(`/fonts/diagram/${FULL}`);
    expect(diagramFontUrl(COMMON, 'web', false)).toBe(`/fonts/diagram/${COMMON}`);
  });

  it('reads a full file from the site on the desktop, which ships only the common ones', () => {
    expect(diagramFontUrl(FULL, 'desktop', false)).toBe(`https://oristudio.dev/fonts/diagram/${FULL}`);
    expect(diagramFontUrl(COMMON, 'desktop', false)).toBe(`/fonts/diagram/${COMMON}`);
    // A dev shell is served by the dev server, which has them all.
    expect(diagramFontUrl(FULL, 'desktop', true)).toBe(`/fonts/diagram/${FULL}`);
  });
});
