/**
 * The Diagram's text fonts (implementation-plans/diagram-workspace.md,
 * Decision 2): Noto Sans for Latin, Cyrillic and Greek, bundled with the app,
 * and Noto Sans SC, TC, JP and KR, fetched per script. Each is a static
 * Regular and Bold with no layout features, so a line is exactly as wide as
 * its advances say in every renderer.
 *
 * What a page names and embeds: the family a key is set in, by the name its
 * `@font-face` declares.
 *
 * Pure.
 */
import type { DiagramHanStyle } from '../document/diagramDocument';

export type CjkFontKey = DiagramHanStyle;
export type DiagramFontKey = 'latin' | CjkFontKey;
export type DiagramFontWeight = 400 | 700;

export const CJK_FONT_KEYS: readonly CjkFontKey[] = ['sc', 'tc', 'jp', 'kr'];

export const DIAGRAM_FONT_FAMILY: Readonly<Record<DiagramFontKey, string>> = {
  latin: 'Noto Sans',
  sc: 'Noto Sans SC',
  tc: 'Noto Sans TC',
  jp: 'Noto Sans JP',
  kr: 'Noto Sans KR',
};

/** One font: a key at a weight. */
export interface DiagramFontFace {
  key: DiagramFontKey;
  weight: DiagramFontWeight;
}

/** A face as a map key: `sc-700`. */
export function fontFaceId({ key, weight }: DiagramFontFace): string {
  return `${key}-${weight}`;
}

const FONT_KEYS: readonly DiagramFontKey[] = ['latin', ...CJK_FONT_KEYS];

/** A face back from its id; null for one that is not a face's. */
export function parseFontFaceId(id: string): DiagramFontFace | null {
  const at = id.lastIndexOf('-');
  const key = id.slice(0, at) as DiagramFontKey;
  const weight = Number(id.slice(at + 1));
  if (!FONT_KEYS.includes(key) || (weight !== 400 && weight !== 700)) return null;
  return { key, weight };
}
