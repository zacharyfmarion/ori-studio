/**
 * The fonts a diagram's text needs, loaded (Decision 2).
 *
 * Noto Sans is bundled, Regular and Bold. A CJK face is fetched only for a
 * text with a character Noto Sans lacks: the face's `common` file first, which
 * holds the characters almost every text uses, and its `full` file only when a
 * text has one the common file lacks and the full one has. The common file is
 * cut from the full one, so a text measures the same in either. Every download
 * is checked against the manifest's size and sha256 before it is read.
 *
 * Loaded faces are kept for the session, as promises, so a page and the next
 * layout share one download; a failure is forgotten, so the next ask tries
 * again. A face that cannot be had is reported, and its characters are set in
 * whatever loaded font has them, or reported missing (`fontScripts.ts`).
 */
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
import { textCjkKey } from './fontScripts';

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
  /** The CJK face it is set in, when it says (an upload's run); otherwise its script's (`textCjkKey`). */
  cjk?: CjkFontKey;
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

/** The manifest: its files, and each script's full coverage as sorted `[first, last]` runs. */
interface Manifest {
  files: ManifestFile[];
  coverage: Partial<Record<CjkFontKey, readonly (readonly [number, number])[]>>;
}

/**
 * The fonts `texts` need: Noto Sans at both weights, and the CJK face of each
 * text with a character Noto Sans lacks — kana and Han, and also the arrows,
 * circled numbers and unit squares only the CJK files carry.
 *
 * A face is its common file unless the text has a character the common file
 * lacks and the full file has (the manifest says which it has, so a character
 * no file has never costs a download). A full file that cannot be had leaves
 * the common one in place, and the face is reported as unavailable in full.
 */
export async function loadDiagramFonts(
  texts: readonly DiagramFontText[],
  hanStyle: DiagramHanStyle,
  source: DiagramFontSource
): Promise<DiagramFonts> {
  const loader = loaderFor(source);
  const loaded = new Map<string, LoadedDiagramFont>();
  const latin = await Promise.all(([400, 700] as const).map((weight) => loader.latin(weight)));
  for (const font of latin) loaded.set(fontFaceId(font), font);
  const latinAt = (weight: DiagramFontWeight) => latin.find((font) => font.weight === weight)!.metrics;

  const needs = new Map<string, { face: DiagramFontFace & { key: CjkFontKey }; codePoints: Set<number> }>();
  for (const { text, weight, cjk } of texts) {
    const lacking = codePointsLacking(text, latinAt(weight));
    if (lacking.length === 0) continue;
    const face = { key: cjk ?? textCjkKey(text, hanStyle), weight };
    const id = fontFaceId(face);
    const need = needs.get(id) ?? { face, codePoints: new Set<number>() };
    for (const codePoint of lacking) need.codePoints.add(codePoint);
    needs.set(id, need);
  }

  const unavailable: DiagramFontFace[] = [];
  await Promise.all(
    [...needs.values()].map(async ({ face, codePoints }) => {
      let common: LoadedDiagramFont;
      try {
        common = await loader.cjk(face.key, face.weight, 'common');
      } catch {
        unavailable.push(face);
        return;
      }
      loaded.set(fontFaceId(face), common);
      const wanted = [...codePoints].filter((codePoint) => !common.metrics.has(codePoint));
      if (wanted.length === 0) return;
      try {
        if (!(await loader.fullCovers(face.key, face.weight, wanted))) return;
        loaded.set(fontFaceId(face), await loader.cjk(face.key, face.weight, 'full'));
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

// Joiners and variation selectors: drawn as nothing, needing no glyph.
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;

/** The code points of `text` that Noto Sans lacks, joiners aside. */
function codePointsLacking(text: string, latin: FontMetrics): number[] {
  const lacking: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (!latin.has(codePoint) && !IGNORABLE.test(character) && character !== '\n' && character !== '\r') {
      lacking.push(codePoint);
    }
  }
  return lacking;
}

/** Whether sorted `[first, last]` runs cover a code point. */
function rangesCover(ranges: readonly (readonly [number, number])[], codePoint: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [first, last] = ranges[middle]!;
    if (codePoint < first) high = middle - 1;
    else if (codePoint > last) low = middle + 1;
    else return true;
  }
  return false;
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
  let manifest: Promise<Manifest> | null = null;

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

  const read = () => {
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
    /** Whether the full file has any of `codePoints`; a manifest that does not say is taken to. */
    fullCovers: async (key: CjkFontKey, weight: DiagramFontWeight, codePoints: readonly number[]) => {
      const manifest = await read();
      if (!manifest.files.some((file) => file.script === key && file.weight === weight && file.tier === 'full')) {
        return false;
      }
      const ranges = manifest.coverage[key];
      return ranges === undefined || codePoints.some((codePoint) => rangesCover(ranges, codePoint));
    },
    latin: (weight: DiagramFontWeight) =>
      once(`latin-${weight}-bundled`, async () => {
        const bytes = new Uint8Array(await source.latin(weight));
        return { key: 'latin', weight, family: DIAGRAM_FONT_FAMILY.latin, tier: 'bundled', bytes, metrics: readFontMetrics(bytes) };
      }),
    cjk: (key: CjkFontKey, weight: DiagramFontWeight, tier: 'common' | 'full') =>
      once(`${key}-${weight}-${tier}`, async () => {
        const entry = (await read()).files.find(
          (file) => file.script === key && file.weight === weight && file.tier === tier
        );
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

/** The manifest; one that does not read is an error, not an empty list. */
export function readManifest(value: unknown): Manifest {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.files)) {
    throw new DiagramFontError('The font manifest does not read');
  }
  const coverage: Manifest['coverage'] = {};
  if (value.coverage !== undefined) {
    if (!isRecord(value.coverage)) throw new DiagramFontError('The font manifest does not read');
    for (const [script, runs] of Object.entries(value.coverage)) {
      if (!CJK_FONT_KEYS.includes(script as CjkFontKey) || typeof runs !== 'string') {
        throw new DiagramFontError('The font manifest does not read');
      }
      coverage[script as CjkFontKey] = readCoverage(runs);
    }
  }
  return { files: value.files.map(readManifestFile), coverage };
}

function readManifestFile(entry: unknown): ManifestFile {
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
}

/**
 * A script's coverage, as `build_fonts.py` writes it: each run `gap.length` in
 * base 36, where `gap` is how far it starts past the last run's end (from -1).
 */
function readCoverage(text: string): [number, number][] {
  const runs: [number, number][] = [];
  let previous = -1;
  for (const part of text === '' ? [] : text.split(',')) {
    const match = /^([0-9a-z]+)\.([0-9a-z]+)$/.exec(part);
    if (!match) throw new DiagramFontError('The font manifest does not read');
    const first = previous + 1 + Number.parseInt(match[1]!, 36);
    const last = first + Number.parseInt(match[2]!, 36);
    if (last > 0x10ffff) throw new DiagramFontError('The font manifest does not read');
    runs.push([first, last]);
    previous = last;
  }
  return runs;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
