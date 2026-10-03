/**
 * The fonts a diagram's text needs, loaded (Decision 2).
 *
 * Noto Sans is bundled, Regular and Bold. The CJK fonts are fetched only for a
 * text that has CJK in it, per face: the face's `common` file first, which
 * holds the characters almost every text uses, and its `full` file only when a
 * text has one the common file lacks. The common file is cut from the full
 * one, so a text measures the same in either. Every download is checked
 * against the manifest's sha256 before it is read.
 *
 * Loaded faces are kept for the session, as promises, so a page and the next
 * layout share one download; a failure is forgotten, so the next ask tries
 * again. A face that cannot be had is reported, and its characters are set in
 * whatever loaded font has them, or reported missing (`fontScripts.ts`).
 */
import { graphemesOf } from '../../lib/paper/textWrap';
import type { DiagramHanStyle } from '../document/diagramDocument';
import {
  CJK_FONT_KEYS,
  DIAGRAM_FONT_FAMILY,
  fontFaceId,
  type CjkFontKey,
  type DiagramFontFace,
  type DiagramFontKey,
  type DiagramFontWeight,
} from './diagramFontFaces';
import { readFontMetrics, type FontMetrics } from './fontMetrics';
import { hasCjk, textCjkKey } from './fontScripts';

/** Where font bytes come from: the app's bundle and origin, or a test's files. */
export interface DiagramFontSource {
  /** Noto Sans at a weight. */
  latin: (weight: DiagramFontWeight) => Promise<ArrayBuffer>;
  /** The CJK files' manifest (`scripts/diagram-fonts/build_fonts.py`). */
  manifest: () => Promise<unknown>;
  /** A CJK file, by its manifest name. */
  file: (name: string) => Promise<ArrayBuffer>;
}

export type DiagramFontTier = 'bundled' | 'common' | 'full';

export interface LoadedDiagramFont extends DiagramFontFace {
  family: string;
  tier: DiagramFontTier;
  bytes: Uint8Array;
  metrics: FontMetrics;
}

export interface DiagramFonts {
  font: (key: DiagramFontKey, weight: DiagramFontWeight) => LoadedDiagramFont | null;
  /** Faces a text needed that could not be had: offline, or a download that did not check out. */
  unavailable: DiagramFontFace[];
}

/** A text the fonts are loaded for, at the weight it is set in. */
export interface DiagramFontText {
  text: string;
  weight: DiagramFontWeight;
}

export class DiagramFontError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagramFontError';
  }
}

interface ManifestFile {
  file: string;
  script: CjkFontKey;
  weight: DiagramFontWeight;
  tier: 'common' | 'full';
  bytes: number;
  sha256: string;
}

/** The fonts `texts` need: Noto Sans at both weights, and each CJK face a text calls for. */
export async function loadDiagramFonts(
  texts: readonly DiagramFontText[],
  hanStyle: DiagramHanStyle,
  source: DiagramFontSource
): Promise<DiagramFonts> {
  const loader = loaderFor(source);
  const needs = new Map<string, { face: DiagramFontFace & { key: CjkFontKey }; codePoints: Set<number> }>();
  for (const { text, weight } of texts) {
    if (!hasCjk(text)) continue;
    const face = { key: textCjkKey(text, hanStyle), weight };
    const id = fontFaceId(face);
    const need = needs.get(id) ?? { face, codePoints: new Set<number>() };
    for (const grapheme of graphemesOf(text)) {
      for (const character of grapheme) need.codePoints.add(character.codePointAt(0)!);
    }
    needs.set(id, need);
  }

  const loaded = new Map<string, LoadedDiagramFont>();
  const unavailable: DiagramFontFace[] = [];
  const latin = await Promise.all(([400, 700] as const).map((weight) => loader.latin(weight)));
  for (const font of latin) loaded.set(fontFaceId(font), font);
  await Promise.all(
    [...needs.values()].map(async ({ face, codePoints }) => {
      try {
        const common = await loader.cjk(face.key, face.weight, 'common');
        const complete = [...codePoints].every(
          (codePoint) => common.metrics.has(codePoint) || !isCjkCodePoint(codePoint)
        );
        loaded.set(fontFaceId(face), complete ? common : await loader.cjk(face.key, face.weight, 'full'));
      } catch {
        unavailable.push(face);
      }
    })
  );
  return {
    font: (key, weight) => loaded.get(fontFaceId({ key, weight })) ?? null,
    unavailable,
  };
}

// What only a CJK file can have: a code point in a CJK font's own blocks.
// ASCII and the like, which also run in a CJK text, never ask for the full file.
const CJK_CODE_POINT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u3000-\u303f\uff00-\uffef]/u;
function isCjkCodePoint(codePoint: number): boolean {
  return CJK_CODE_POINT.test(String.fromCodePoint(codePoint));
}

/** Per source, so a test's fake files are never served to the app. */
const loaders = new WeakMap<DiagramFontSource, ReturnType<typeof createLoader>>();

function loaderFor(source: DiagramFontSource) {
  let loader = loaders.get(source);
  if (!loader) {
    loader = createLoader(source);
    loaders.set(source, loader);
  }
  return loader;
}

function createLoader(source: DiagramFontSource) {
  const faces = new Map<string, Promise<LoadedDiagramFont>>();
  let manifest: Promise<ManifestFile[]> | null = null;

  /** Kept while it lives; dropped when it fails, so the next ask tries again. */
  const once = (id: string, load: () => Promise<LoadedDiagramFont>) => {
    let pending = faces.get(id);
    if (!pending) {
      pending = load();
      faces.set(id, pending);
      pending.catch(() => {
        if (faces.get(id) === pending) faces.delete(id);
      });
    }
    return pending;
  };

  const files = () => {
    if (!manifest) {
      const pending = source.manifest().then(readManifest);
      manifest = pending;
      pending.catch(() => {
        if (manifest === pending) manifest = null;
      });
    }
    return manifest;
  };

  return {
    latin: (weight: DiagramFontWeight) =>
      once(`latin-${weight}-bundled`, async () => {
        const bytes = new Uint8Array(await source.latin(weight));
        return { key: 'latin', weight, family: DIAGRAM_FONT_FAMILY.latin, tier: 'bundled', bytes, metrics: readFontMetrics(bytes) };
      }),
    cjk: (key: CjkFontKey, weight: DiagramFontWeight, tier: 'common' | 'full') =>
      once(`${key}-${weight}-${tier}`, async () => {
        const entry = (await files()).find((file) => file.script === key && file.weight === weight && file.tier === tier);
        if (!entry) throw new DiagramFontError(`No ${tier} ${key} font at ${weight} in the manifest`);
        const bytes = new Uint8Array(await source.file(entry.file));
        if (bytes.length !== entry.bytes || (await sha256Hex(bytes)) !== entry.sha256) {
          throw new DiagramFontError(`${entry.file} is not the file the manifest names`);
        }
        return { key, weight, family: DIAGRAM_FONT_FAMILY[key], tier, bytes, metrics: readFontMetrics(bytes) };
      }),
  };
}

const MANIFEST_FILE = /^NotoSans(SC|TC|JP|KR)-(Regular|Bold)\.(common|full)\.ttf$/;

/** The manifest's CJK files; a manifest that does not read is an error, not an empty list. */
export function readManifest(value: unknown): ManifestFile[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.files)) {
    throw new DiagramFontError('The font manifest does not read');
  }
  return value.files.map((entry): ManifestFile => {
    if (
      !isRecord(entry) ||
      typeof entry.file !== 'string' ||
      !MANIFEST_FILE.test(entry.file) ||
      !CJK_FONT_KEYS.includes(entry.script as CjkFontKey) ||
      (entry.weight !== 400 && entry.weight !== 700) ||
      (entry.tier !== 'common' && entry.tier !== 'full') ||
      typeof entry.bytes !== 'number' ||
      typeof entry.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      throw new DiagramFontError('A font manifest entry does not read');
    }
    return {
      file: entry.file,
      script: entry.script as CjkFontKey,
      weight: entry.weight,
      tier: entry.tier,
      bytes: entry.bytes,
      sha256: entry.sha256,
    };
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
