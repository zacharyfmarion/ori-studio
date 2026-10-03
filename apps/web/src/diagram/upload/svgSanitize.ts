/**
 * The uploaded-SVG sanitizer (D7 of `implementation-plans/diagram-workspace.md`,
 * with the revisions Phase 0's probe proposed and route C's policy).
 *
 * It **builds a fresh tree and never mutates the parsed one**: only elements and
 * attributes on an allowlist are re-created in a new document, so anything this
 * module does not name cannot reach the output. Its output is shown only through
 * `data:` URLs in `<img>`, where scripts never run anyway; the allowlist is the
 * second wall, for the copy the user exports and opens elsewhere.
 *
 * It is idempotent: sanitizing its own output returns the same bytes. Assets
 * are re-sanitized on every load, so a file edited by hand is held to the same
 * rules, and nothing the sanitizer wrote changes.
 *
 * Parsing and serialization are injected (`SanitizeEnv`) so the same code runs
 * in jsdom under vitest and in a real engine.
 */

import { graphemesOf } from '../../lib/paper/textWrap';
import { DIAGRAM_FONT_FAMILY, type CjkFontKey, type DiagramFontKey } from '../fonts/diagramFontFaces';
import { scriptFonts, textCjkKey } from '../fonts/fontScripts';
import { UPLOAD_HAN_KEY, uploadTextFamily } from './uploadText';

export const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * The most an upload may be before it is read at all. Illustrator's "Preserve
 * Editing" data is most of a large file and is thrown away here, so the cap on
 * what is *read* is far above the cap on what is *kept*.
 */
export const SVG_READ_MAX_BYTES = 16 * 1024 * 1024;
/** The most a sanitized SVG may be once inlined styles and re-encoded rasters are in. */
export const SVG_STORED_MAX_BYTES = 2 * 1024 * 1024;
/** A raster inside an upload is re-encoded to at most this many px a side. */
export const EMBEDDED_RASTER_MAX_SIDE = 2048;

/** Nodes `<use>` may instantiate before the file is refused. */
const MAX_USE_INSTANCES = 50_000;
/** Element nesting the copy will follow; deeper is refused rather than overflowing the stack. */
const MAX_DEPTH = 512;
/** A raster's header may claim at most this much before it is dropped unread. */
export const MAX_DECLARED_RASTER_SIDE = 16_384;
export const MAX_DECLARED_RASTER_PIXELS = 64_000_000;
/** DOCTYPE entities: how many, how long each, and how much they may expand to in all. */
const MAX_ENTITIES = 64;
const MAX_ENTITY_VALUE = 1024;
const MAX_ENTITY_EXPANSION = 1024 * 1024;
/** The internal subset's size: room for every entity at its longest, and no more. */
const MAX_INTERNAL_SUBSET = MAX_ENTITIES * (MAX_ENTITY_VALUE + 64);
/**
 * Stylesheet selectors, and rule-by-element checks while inlining them. Real
 * drawings use a few hundred classes, each matching a handful of elements; a
 * file that asks for more is built to make the copy quadratic.
 */
const MAX_STYLE_SELECTORS = 10_000;
const MAX_STYLE_MATCH_CHECKS = 2_000_000;
/** Nodes the marker context-paint copies may add, as `<use>` may instantiate. */
const MAX_BAKED_MARKER_NODES = MAX_USE_INSTANCES;

export type ReportKind = 'visual' | 'security' | 'metadata' | 'info';

/** One kind of thing the sanitizer changed, and how often. */
export interface ReportEntry {
  code: string;
  kind: ReportKind;
  count: number;
  /** A few short examples, for a developer; never shown to the user verbatim. */
  samples: string[];
}

export interface PendingRaster {
  /** Index into the output's `<image>` elements, in document order. */
  index: number;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  dataUrl: string;
}

export interface SanitizeSuccess {
  ok: true;
  svg: string;
  widthPx: number;
  heightPx: number;
  report: ReportEntry[];
  /**
   * Embedded rasters to re-encode before the result is final: every one at
   * import, none on load. {@link finishRasters} does it.
   */
  pendingRasters: PendingRaster[];
  /** The output root, before serialization, for {@link finishRasters}. */
  root: Element;
}

export interface SanitizeFailure {
  ok: false;
  /** Why, for a developer and the report; the user sees a fixed sentence. */
  error: string;
  report: ReportEntry[];
}

export type SanitizeResult = SanitizeSuccess | SanitizeFailure;

export interface SanitizeEnv {
  parse(text: string): Document;
  serialize(node: Node): string;
  createDocument(): Document;
}

export function browserSanitizeEnv(): SanitizeEnv {
  return {
    parse: (text) => new DOMParser().parseFromString(text, 'image/svg+xml'),
    serialize: (node) => new XMLSerializer().serializeToString(node),
    createDocument: () => document.implementation.createDocument(SVG_NS, 'svg', null),
  };
}

// ---------------------------------------------------------------------------
// Allowlists

/** Elements copied. Filter primitives and `mask` are added below: route C keeps them. */
const KEPT_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'defs',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'marker',
  'symbol',
  'use',
  'title',
  'desc',
  'image',
]);

/** Dropped without a report: `style` is harvested before the copy, `metadata` is the editor's. */
const DROPPED_SILENTLY = new Set(['metadata', 'style']);
const DROPPED_FOR_SAFETY = new Set([
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'handler',
  'cursor',
  'color-profile',
]);
const SMIL = new Set([
  'animate',
  'set',
  'animateMotion',
  'animateTransform',
  'animateColor',
  'mpath',
  'discard',
]);
/** Route C draws these. `feImage` is not among them: it can load an external picture. */
const FILTER_ELEMENTS = new Set([
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
]);

const COMMON_ATTRIBUTES = ['id', 'transform'];
const ELEMENT_ATTRIBUTES: Record<string, readonly string[]> = {
  svg: ['x', 'y', 'width', 'height', 'viewBox', 'preserveAspectRatio'],
  g: [],
  path: ['d', 'pathLength'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'pathLength'],
  circle: ['cx', 'cy', 'r', 'pathLength'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'pathLength'],
  line: ['x1', 'y1', 'x2', 'y2', 'pathLength'],
  polyline: ['points', 'pathLength'],
  polygon: ['points', 'pathLength'],
  text: ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'],
  tspan: ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'],
  textPath: ['startOffset', 'method', 'spacing', 'side', 'textLength', 'lengthAdjust'],
  defs: [],
  clipPath: ['clipPathUnits'],
  mask: ['x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits'],
  linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
  radialGradient: [
    'cx',
    'cy',
    'r',
    'fx',
    'fy',
    'fr',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
  ],
  stop: ['offset'],
  pattern: [
    'x',
    'y',
    'width',
    'height',
    'patternUnits',
    'patternContentUnits',
    'patternTransform',
    'viewBox',
    'preserveAspectRatio',
  ],
  marker: [
    'refX',
    'refY',
    'markerWidth',
    'markerHeight',
    'markerUnits',
    'orient',
    'viewBox',
    'preserveAspectRatio',
  ],
  symbol: ['viewBox', 'preserveAspectRatio', 'x', 'y', 'width', 'height', 'refX', 'refY'],
  use: ['x', 'y', 'width', 'height'],
  image: ['x', 'y', 'width', 'height', 'preserveAspectRatio'],
  title: [],
  desc: [],
};
const FILTER_ATTRIBUTES = [
  'x',
  'y',
  'width',
  'height',
  'filterUnits',
  'primitiveUnits',
  'in',
  'in2',
  'result',
  'stdDeviation',
  'dx',
  'dy',
  'values',
  'type',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'mode',
  'order',
  'kernelMatrix',
  'divisor',
  'bias',
  'targetX',
  'targetY',
  'edgeMode',
  'preserveAlpha',
  'radius',
  'scale',
  'xChannelSelector',
  'yChannelSelector',
  'baseFrequency',
  'numOctaves',
  'seed',
  'stitchTiles',
  'surfaceScale',
  'specularConstant',
  'specularExponent',
  'diffuseConstant',
  'kernelUnitLength',
  'azimuth',
  'elevation',
  'z',
  'pointsAtX',
  'pointsAtY',
  'pointsAtZ',
  'limitingConeAngle',
  'tableValues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'offset',
];
const TRANSFORM_ATTRIBUTES = new Set(['transform', 'gradientTransform', 'patternTransform']);
/** Elements whose `href` is a reference worth keeping, and what it may point at. */
const HREF_TARGETS: Record<string, readonly string[] | null> = {
  use: null, // any kept element
  linearGradient: ['linearGradient', 'radialGradient'],
  radialGradient: ['linearGradient', 'radialGradient'],
  pattern: ['pattern'],
  textPath: ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'],
};

/** CSS properties, as declarations or presentation attributes. `url()` only on {@link REFERENCE_PROPERTIES}. */
const PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'color',
  'display',
  'visibility',
  'overflow',
  'clip-path',
  'clip-rule',
  'mask',
  'mask-type',
  'filter',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'color-interpolation-filters',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
  'stop-color',
  'stop-opacity',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'font-size-adjust',
  'font-kerning',
  'font-feature-settings',
  'font-variant-ligatures',
  'font-variant-caps',
  'font-variant-numeric',
  'font-variant-east-asian',
  'text-anchor',
  'text-align',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'text-transform',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'letter-spacing',
  'word-spacing',
  'writing-mode',
  'text-orientation',
  'glyph-orientation-vertical',
  'direction',
  'unicode-bidi',
  'white-space',
  'line-height',
  'vector-effect',
  'paint-order',
  'shape-rendering',
  'text-rendering',
  'image-rendering',
  'color-rendering',
  'color-interpolation',
  'isolation',
  'mix-blend-mode',
  'solid-color',
  'solid-opacity',
]);
/** Editor bookkeeping that does not change the look, dropped without a visual report. */
const INERT_PROPERTIES = new Set([
  '-inkscape-font-specification',
  'enable-background',
  'shape-inside',
  'inline-size',
  'shape-padding',
  'font-variation-settings',
]);
/** What a `url(#id)` on each property must point at. */
const REFERENCE_PROPERTIES: Record<string, readonly string[]> = {
  fill: ['linearGradient', 'radialGradient', 'pattern'],
  stroke: ['linearGradient', 'radialGradient', 'pattern'],
  'clip-path': ['clipPath'],
  mask: ['mask'],
  filter: ['filter'],
  marker: ['marker'],
  'marker-start': ['marker'],
  'marker-mid': ['marker'],
  'marker-end': ['marker'],
};

const SAFE_OUTPUT_ID = /^[A-Za-z_][\w.-]*$/;
const SAFE_PREFIX = /^[A-Za-z][\w-]*$/;
const ALLOWED_FUNCTIONS = new Set(['url', 'rgb', 'rgba', 'hsl', 'hsla']);
const TRANSFORM_VALUE =
  /^\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*[-+\d.eE,\s]*\)\s*,?\s*)*$/;
// eslint-disable-next-line no-control-regex -- a control character is what it refuses
const PLAIN_VALUE = /^[^()\\<>{}@;:"'`\u0000-\u001f\u007f]*$/;
const LANGUAGE_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;
const RASTER_HREF = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/;

// ---------------------------------------------------------------------------
// The report

class Report {
  private readonly entries = new Map<string, ReportEntry>();

  add(code: string, kind: ReportKind, sample = ''): void {
    let entry = this.entries.get(code);
    if (!entry) {
      entry = { code, kind, count: 0, samples: [] };
      this.entries.set(code, entry);
    }
    entry.count += 1;
    if (sample && entry.samples.length < 3 && !entry.samples.includes(sample)) {
      entry.samples.push(sample.slice(0, 120));
    }
  }

  list(): ReportEntry[] {
    return [...this.entries.values()];
  }
}

// ---------------------------------------------------------------------------
// CSS: declarations and simple stylesheets

interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

/** Split a declaration block on top-level semicolons, respecting quotes and parentheses. */
function splitDeclarations(text: string): Declaration[] {
  const declarations: Declaration[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (chunk: string) => {
    const colon = chunk.indexOf(':');
    if (colon < 0) return;
    const property = chunk.slice(0, colon).trim().toLowerCase();
    let value = chunk.slice(colon + 1).trim();
    let important = false;
    const marker = value.match(/!\s*important\s*$/i);
    if (marker) {
      important = true;
      value = value.slice(0, marker.index).trim();
    }
    if (property) declarations.push({ property, value, important });
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      push(text.slice(start, index));
      start = index + 1;
    }
  }
  push(text.slice(start));
  return declarations;
}

interface SimpleSelector {
  type: string | null;
  id: string | null;
  classes: string[];
  specificity: number;
}

interface StyleRule {
  selectors: SimpleSelector[];
  declarations: Declaration[];
  order: number;
}

const SIMPLE_SELECTOR = /^(\*|[A-Za-z][\w-]*)?((?:[#.][A-Za-z_][\w-]*)*)$/;

/** Type, `.class`, `#id` and compounds of them. Anything else is not inlined. */
function parseSimpleSelector(text: string): SimpleSelector | null {
  const match = text.trim().match(SIMPLE_SELECTOR);
  if (!match || (!match[1] && !match[2])) return null;
  const type = match[1] && match[1] !== '*' ? match[1] : null;
  let id: string | null = null;
  const classes: string[] = [];
  for (const part of match[2].match(/[#.][A-Za-z_][\w-]*/g) ?? []) {
    if (part[0] === '#') {
      if (id) return null;
      id = part.slice(1);
    } else {
      classes.push(part.slice(1));
    }
  }
  return {
    type,
    id,
    classes,
    specificity: (id ? 10_000 : 0) + classes.length * 100 + (type ? 1 : 0),
  };
}

/**
 * Remove `/* … *\/` comments in one pass. A lazy regex rescans to the end for
 * every unclosed `/*`, which a hostile sheet makes quadratic; an unclosed one
 * here runs to the end, as it does in CSS.
 */
function stripCssComments(css: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = css.indexOf('/*', at);
    if (open < 0) return out + css.slice(at);
    out += css.slice(at, open) + ' ';
    const close = css.indexOf('*/', open + 2);
    if (close < 0) return out;
    at = close + 2;
  }
}

function parseStylesheet(css: string, report: Report, firstOrder: number): StyleRule[] {
  const rules: StyleRule[] = [];
  const text = stripCssComments(css);
  let index = 0;
  let order = firstOrder;
  const skipBlock = (from: number): number => {
    let depth = 0;
    for (let at = from; at < text.length; at++) {
      if (text[at] === '{') depth += 1;
      else if (text[at] === '}') {
        depth -= 1;
        if (depth === 0) return at + 1;
      }
    }
    return text.length;
  };
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index >= text.length) break;
    if (text.startsWith('<!--', index)) {
      index += 4;
      continue;
    }
    if (text.startsWith('-->', index)) {
      index += 3;
      continue;
    }
    if (text[index] === '@') {
      const name = (text.slice(index).match(/^@[\w\\-]+/) ?? ['@'])[0].toLowerCase();
      const semicolon = text.indexOf(';', index);
      const brace = text.indexOf('{', index);
      const unsafe = name.includes('import') || name.includes('\\');
      report.add(`css-at-rule:${name}`, unsafe ? 'security' : 'visual', text.slice(index, index + 80));
      if (brace >= 0 && (semicolon < 0 || brace < semicolon)) index = skipBlock(brace);
      else index = semicolon < 0 ? text.length : semicolon + 1;
      continue;
    }
    const brace = text.indexOf('{', index);
    if (brace < 0) break;
    const selectorText = text.slice(index, brace);
    const end = skipBlock(brace);
    const body = text.slice(brace + 1, end - 1);
    index = end;
    if (/[\\{]/.test(body) || selectorText.includes('\\')) {
      report.add('css-rule-dropped:escape-or-nesting', 'security', selectorText.trim());
      continue;
    }
    const selectors: SimpleSelector[] = [];
    for (const part of selectorText.split(',')) {
      const selector = parseSimpleSelector(part);
      if (selector) selectors.push(selector);
      else report.add('css-rule-dropped:complex-selector', 'visual', part.trim());
    }
    if (selectors.length > 0) {
      rules.push({ selectors, declarations: splitDeclarations(body), order: order++ });
    }
  }
  return rules;
}

function selectorMatches(selector: SimpleSelector, element: Element): boolean {
  if (selector.type && element.localName !== selector.type) return false;
  if (selector.id && element.getAttribute('id') !== selector.id) return false;
  if (selector.classes.length > 0) {
    const classes = (element.getAttribute('class') ?? '').split(/\s+/);
    for (const name of selector.classes) if (!classes.includes(name)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Values

interface CleanValue {
  value: string;
  /** The `#id`s its `url()`s name, as written. */
  references: string[];
}

function cleanCssValue(
  property: string,
  raw: string,
  report: Report,
  where: string
): CleanValue | null {
  const value = raw.trim();
  if (!value) return null;
  // eslint-disable-next-line no-control-regex -- a control character is what it refuses
  if (/[\\<>{}@;`\u0000-\u001f\u007f]/.test(value)) {
    report.add('declaration-dropped:unsafe-characters', 'security', `${property}:${value}`);
    return null;
  }
  for (const call of value.matchAll(/([A-Za-z-]*)\s*\(/g)) {
    const name = call[1].toLowerCase();
    if (!ALLOWED_FUNCTIONS.has(name)) {
      report.add(`declaration-dropped:function:${name || '()'}`, 'security', `${property}:${value}`);
      return null;
    }
  }
  const references: string[] = [];
  for (const url of value.matchAll(/url\(\s*(['"]?)#([^'")]+)\1\s*\)/gi)) references.push(url[2]);
  const urlCount = (value.match(/url\s*\(/gi) ?? []).length;
  if (urlCount !== references.length) {
    report.add('declaration-dropped:external-url', 'security', `${where} ${property}:${value}`);
    return null;
  }
  if (references.length > 0 && !(property in REFERENCE_PROPERTIES)) {
    report.add('declaration-dropped:url-on-non-reference-property', 'visual', `${property}:${value}`);
    return null;
  }
  return { value, references };
}

function cleanPlainAttribute(name: string, raw: string): string | null {
  if (TRANSFORM_ATTRIBUTES.has(name)) return TRANSFORM_VALUE.test(raw) ? raw : null;
  return PLAIN_VALUE.test(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Rasters

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * A raster's size from its header, without decoding it: PNG's IHDR, a JPEG's
 * SOF, WebP's VP8/VP8L/VP8X. `null` when the bytes are not that format.
 */
export function rasterHeaderSize(
  bytes: Uint8Array,
  mime: string
): { width: number; height: number } | null {
  const be32 = (at: number) =>
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  const be16 = (at: number) => (bytes[at] << 8) | bytes[at + 1];
  const le16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const le24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (mime === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || signature.some((byte, at) => bytes[at] !== byte)) return null;
    if (ascii(12, 16) !== 'IHDR') return null;
    return { width: be32(16), height: be32(20) };
  }
  if (mime === 'image/jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      // Fill bytes: any run of 0xFF before a marker's code, which decoders skip.
      while (at + 1 < bytes.length && bytes[at + 1] === 0xff) at += 1;
      if (at + 9 >= bytes.length) return null;
      const marker = bytes[at + 1];
      // Start of scan, or end of image, before any frame: no size to read.
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        at += 2;
        continue;
      }
      // Start-of-frame markers carry the size; DHT, JPG and DAC share the range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: be16(at + 5), width: be16(at + 7) };
      }
      at += 2 + be16(at + 2);
    }
    return null;
  }
  if (mime === 'image/webp') {
    if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') return null;
    const chunk = ascii(12, 16);
    if (chunk === 'VP8X') return { width: le24(24) + 1, height: le24(27) + 1 };
    if (chunk === 'VP8 ') return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = bytes.slice(21, 25);
      return {
        width: 1 + (((b[1] & 0x3f) << 8) | b[0]),
        height: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)),
      };
    }
    return null;
  }
  if (mime === 'image/gif') {
    if (bytes.length < 10 || !/^GIF8[79]a$/.test(ascii(0, 6))) return null;
    return { width: le16(6), height: le16(8) };
  }
  if (mime === 'image/bmp') {
    if (bytes.length < 26 || ascii(0, 2) !== 'BM') return null;
    const le32 = (at: number) =>
      (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
    const height = le32(22);
    // A negative height is a top-down bitmap.
    return { width: le32(18), height: height > 0x7fffffff ? 0x100000000 - height : height };
  }
  return null;
}

/** The bitmap formats whose size {@link rasterHeaderSize} can read. */
export type SniffedRasterMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/bmp';

/**
 * What a bitmap is, from its first bytes rather than its name or reported
 * type: the format the header check and the decoder will actually meet.
 * `null` for anything else.
 */
export function sniffRasterMime(bytes: Uint8Array): SniffedRasterMime | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  return null;
}

// ---------------------------------------------------------------------------
// Sizes

const UNIT_PX: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  em: 16,
  ex: 8,
};

function lengthPx(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw
    .trim()
    .match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex|%)?$/);
  if (!match || match[2] === '%') return null;
  const px = parseFloat(match[1]) * UNIT_PX[match[2] ?? ''];
  return px > 0 && Number.isFinite(px) ? px : null;
}

function parseViewBox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  if (parts[2] <= 0 || parts[3] <= 0) return null;
  return parts as [number, number, number, number];
}

const formatNumber = (value: number) => String(Math.round(value * 1000) / 1000);

// ---------------------------------------------------------------------------
// DOCTYPE screen

/**
 * Refuse a DOCTYPE before any parser sees it, or `null` when it may be parsed.
 *
 * An internal subset may hold only literal `<!ENTITY name "value">`
 * declarations: no parameter or external entities, no entity built from
 * another, and nothing else — Blink and WebKit apply `<!ATTLIST>` defaults,
 * `onload` included, which jsdom does not. The entities' total expansion over
 * the document is capped as well as each one's length, since a literal entity
 * referenced a million times is a blow-up of its own.
 */
export function screenDoctype(text: string): string | null {
  const start = text.indexOf('<!DOCTYPE');
  const entityCount = (text.match(/<!ENTITY/g) ?? []).length;
  if (start < 0) return entityCount > 0 ? 'ENTITY outside a DOCTYPE' : null;
  // One DOCTYPE, the real one: a second — or the first hidden in a comment —
  // would leave the subset the parser applies unscreened.
  if (text.indexOf('<!DOCTYPE', start + 1) >= 0) return 'more than one DOCTYPE';
  const close = text.indexOf('>', start);
  const open = text.indexOf('[', start);
  let subset = '';
  let subsetEnd = close;
  if (open >= 0 && (close < 0 || open < close)) {
    const end = text.indexOf(']', open);
    if (end < 0) return 'unterminated internal subset';
    subset = text.slice(open + 1, end);
    subsetEnd = end;
  }
  if (subset.length > MAX_INTERNAL_SUBSET) return 'an internal subset too large to be literal entities';
  const pieces = splitSubset(subset);
  if (!pieces) return 'an unterminated declaration in the internal subset';
  const { declarations, rest } = pieces;
  if (/<!|%/.test(rest)) return 'the internal subset may hold only ENTITY declarations';
  if (entityCount !== declarations.length) return 'ENTITY declarations outside the internal subset';
  if (declarations.length > MAX_ENTITIES) return `more than ${MAX_ENTITIES} entities`;
  const lengths = new Map<string, number>();
  for (const declaration of declarations) {
    const match = declaration.match(/^<!ENTITY\s+(%\s+)?([^\s]+)\s+(?:"([^"]*)"|'([^']*)')\s*>$/);
    if (!match) return 'an external or malformed entity';
    if (match[1]) return 'a parameter entity';
    const value = match[3] ?? match[4] ?? '';
    if (/[&%<]/.test(value)) return 'an entity that refers to another entity or holds markup';
    if (value.length > MAX_ENTITY_VALUE) return `an entity longer than ${MAX_ENTITY_VALUE} characters`;
    lengths.set(match[2], value.length);
  }
  if (lengths.size > 0) {
    let expansion = 0;
    // Any name a declaration could have had: counting only ASCII names let
    // `&é;` or `&a:b;` expand uncounted.
    for (const reference of text.slice(subsetEnd).matchAll(/&([^\s&;<>]+);/g)) {
      expansion += lengths.get(reference[1]) ?? 0;
      if (expansion > MAX_ENTITY_EXPANSION) return 'entities that expand too far';
    }
  }
  return null;
}

/**
 * The internal subset's `<!ENTITY …>` declarations, and what is left once they
 * and its comments are taken out, in one pass — or null when one of them never
 * closes. (A lazy regex per kind rescanned to the end for each unclosed one.)
 */
function splitSubset(subset: string): { declarations: string[]; rest: string } | null {
  const declarations: string[] = [];
  let rest = '';
  let at = 0;
  for (;;) {
    const entity = subset.indexOf('<!ENTITY', at);
    const comment = subset.indexOf('<!--', at);
    if (entity < 0 && comment < 0) return { declarations, rest: rest + subset.slice(at) };
    const isComment = comment >= 0 && (entity < 0 || comment < entity);
    const begin = isComment ? comment : entity;
    rest += subset.slice(at, begin);
    const end = isComment ? subset.indexOf('-->', begin + 4) : subset.indexOf('>', begin);
    if (end < 0) return null;
    const after = isComment ? end + 3 : end + 1;
    if (!isComment) declarations.push(subset.slice(begin, after));
    at = after;
  }
}

// ---------------------------------------------------------------------------
// The sanitizer

export interface SanitizeOptions {
  /** Prefix for every id, unique per asset, so pictures on one page never share a `#clip1`. */
  idPrefix: string;
  /**
   * `import`: a new upload; every embedded raster is listed for re-encoding,
   * which also strips its EXIF. `load`: an asset read back from a file; rasters
   * are header-checked only, never re-encoded, so a load changes no bytes.
   */
  mode: 'import' | 'load';
  env?: SanitizeEnv;
}

export function sanitizeSvg(text: string, options: SanitizeOptions): SanitizeResult {
  const report = new Report();
  try {
    return sanitize(text, options, report);
  } catch (error) {
    // A parser or engine limit reached on hostile input is a refusal, not a crash.
    return {
      ok: false,
      error: `sanitizer failed: ${error instanceof Error ? error.message : String(error)}`,
      report: report.list(),
    };
  }
}

function sanitize(text: string, options: SanitizeOptions, report: Report): SanitizeResult {
  const env = options.env ?? browserSanitizeEnv();
  const prefix = options.idPrefix;
  const fail = (error: string): SanitizeFailure => ({ ok: false, error, report: report.list() });
  if (!SAFE_PREFIX.test(prefix)) return fail('bad id prefix');
  if (text.length > SVG_READ_MAX_BYTES) return fail('file too large');

  // 0. The DOCTYPE, before any parser.
  const doctype = screenDoctype(text);
  if (doctype) return fail(`doctype refused: ${doctype}`);

  // 1. Parse.
  const source = env.parse(text);
  const parserError =
    source.getElementsByTagName('parsererror')[0] ??
    source.getElementsByTagNameNS('*', 'parsererror')[0];
  if (parserError) return fail(`parse error: ${(parserError.textContent ?? '').trim().slice(0, 160)}`);
  const sourceRoot = source.documentElement;
  if (!sourceRoot || sourceRoot.namespaceURI !== SVG_NS || sourceRoot.localName !== 'svg') {
    return fail('the root is not an SVG <svg>');
  }

  // `<style>` rules, inlined below when their selectors are simple.
  const rules: StyleRule[] = [];
  const styleElements = source.getElementsByTagNameNS(SVG_NS, 'style');
  for (let index = 0; index < styleElements.length; index++) {
    const type = styleElements[index].getAttribute('type');
    if (type && type.trim().toLowerCase() !== 'text/css') {
      report.add('style-element-dropped:type', 'visual', type);
      continue;
    }
    rules.push(...parseStylesheet(styleElements[index].textContent ?? '', report, rules.length));
    report.add('style-element-inlined', 'info');
  }
  const selectorCount = rules.reduce((count, rule) => count + rule.selectors.length, 0);
  if (selectorCount > MAX_STYLE_SELECTORS) return fail(`more than ${MAX_STYLE_SELECTORS} style selectors`);
  // Indexed by each selector's most specific key, so matching is a lookup, not a scan.
  const ruleIndex = new Map<string, { rule: StyleRule; selector: SimpleSelector }[]>();
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      const key = selector.id
        ? `#${selector.id}`
        : selector.classes.length > 0
          ? `.${selector.classes[0]}`
          : selector.type
            ? `t:${selector.type}`
            : '*';
      const list = ruleIndex.get(key) ?? [];
      list.push({ rule, selector });
      ruleIndex.set(key, list);
    }
  }
  /** A declaration's value made safe, or null — reported once, whatever it styles. */
  const vetDeclaration = (declaration: Declaration, where: string): CleanValue | null => {
    if (declaration.property.startsWith('--')) {
      report.add('declaration-dropped:custom-property', 'info', declaration.property);
      return null;
    }
    if (!PROPERTIES.has(declaration.property)) {
      const inert = INERT_PROPERTIES.has(declaration.property) || declaration.property.startsWith('-');
      report.add(`declaration-dropped:${declaration.property}`, inert ? 'info' : 'visual', declaration.value);
      return null;
    }
    return cleanCssValue(declaration.property, declaration.value, report, where);
  };
  // A rule's declarations are vetted once, not once for every element they
  // style: the fan-out of a few thousand rules over a few thousand elements is
  // what made the copy quadratic.
  const vettedRuleDeclarations = new Map<Declaration, CleanValue | null>();
  const vetRuleDeclaration = (declaration: Declaration): CleanValue | null => {
    if (!vettedRuleDeclarations.has(declaration)) {
      vettedRuleDeclarations.set(declaration, vetDeclaration(declaration, 'style rule'));
    }
    return vettedRuleDeclarations.get(declaration) ?? null;
  };
  let matchChecks = 0;
  /**
   * One element's declarations, the cascade resolved: rules by specificity and
   * order, then the inline style, then `!important` rules, and for each
   * property the last one that is valid wins — so an element yields at most
   * one declaration per property, however many rules match it.
   */
  const declarationsFor = (element: Element, where: string): Map<string, CleanValue> => {
    const matched: { rule: StyleRule; specificity: number }[] = [];
    if (rules.length > 0) {
      const keys = ['*', `t:${element.localName}`];
      const id = element.getAttribute('id');
      if (id) keys.push(`#${id}`);
      for (const name of (element.getAttribute('class') ?? '').split(/\s+/)) {
        if (name) keys.push(`.${name}`);
      }
      const best = new Map<StyleRule, number>();
      for (const key of keys) {
        for (const { rule, selector } of ruleIndex.get(key) ?? []) {
          matchChecks += 1;
          if (matchChecks > MAX_STYLE_MATCH_CHECKS) {
            throw new Error('styles that match too many elements');
          }
          if (selectorMatches(selector, element)) {
            best.set(rule, Math.max(best.get(rule) ?? -1, selector.specificity));
          }
        }
      }
      for (const [rule, specificity] of best) matched.push({ rule, specificity });
    }
    matched.sort((a, b) => a.specificity - b.specificity || a.rule.order - b.rule.order);
    const winners = new Map<string, CleanValue>();
    const apply = (property: string, clean: CleanValue | null) => {
      if (!clean) return;
      // Re-inserted, so the style lists properties in the cascade's order.
      winners.delete(property);
      winners.set(property, clean);
    };
    for (const { rule } of matched) {
      for (const declaration of rule.declarations) {
        if (!declaration.important) apply(declaration.property, vetRuleDeclaration(declaration));
      }
    }
    for (const declaration of splitDeclarations(element.getAttribute('style') ?? '')) {
      apply(declaration.property, vetDeclaration(declaration, where));
    }
    for (const { rule } of matched) {
      for (const declaration of rule.declarations) {
        if (declaration.important) apply(declaration.property, vetRuleDeclaration(declaration));
      }
    }
    return winners;
  };

  // 2–4. Copy into a fresh document.
  const output = env.createDocument();
  const outputRoot = output.documentElement;
  while (outputRoot.firstChild) outputRoot.removeChild(outputRoot.firstChild);

  interface PendingDeclaration {
    element: Element;
    asAttribute: boolean;
    property: string;
    value: string;
    references: string[];
  }
  const pendingDeclarations: PendingDeclaration[] = [];
  const pendingHrefs: { element: Element; id: string }[] = [];
  const sourceIdOf = new Map<Element, string>();
  const images: { element: Element; href: string }[] = [];
  let elementsOut = 0;

  const handleHref = (outElement: Element, name: string, raw: string) => {
    const value = raw.trim();
    if (name === 'image') {
      if (RASTER_HREF.test(value)) {
        images.push({ element: outElement, href: value });
      } else if (/^data:image\/svg\+xml/i.test(value)) {
        report.add('image-dropped:embedded-svg', 'visual', value.slice(0, 40));
      } else if (/^data:/i.test(value)) {
        report.add('image-dropped:data-type', 'security', value.slice(0, 40));
      } else {
        report.add('image-dropped:linked', 'visual', value.slice(0, 80));
      }
      return;
    }
    if (!(name in HREF_TARGETS)) {
      report.add(`href-dropped:on-${name}`, /^\s*[a-z]+:/i.test(value) ? 'security' : 'info', value.slice(0, 80));
      return;
    }
    if (!value.startsWith('#')) {
      report.add('href-dropped:external', 'security', `${name} ${value.slice(0, 80)}`);
      return;
    }
    pendingHrefs.push({ element: outElement, id: value.slice(1) });
  };

  const copyAttributes = (sourceElement: Element, outElement: Element, name: string) => {
    const allowed = new Set([
      ...COMMON_ATTRIBUTES,
      ...(ELEMENT_ATTRIBUTES[name] ?? (FILTER_ELEMENTS.has(name) ? FILTER_ATTRIBUTES : [])),
    ]);
    for (let index = 0; index < sourceElement.attributes.length; index++) {
      const attribute = sourceElement.attributes[index];
      const namespace = attribute.namespaceURI;
      const local = attribute.localName;
      if (namespace === null && /^on/i.test(local)) {
        report.add('event-handler', 'security', `${name} ${local}`);
        continue;
      }
      if ((namespace === null || namespace === XLINK_NS) && local === 'href') {
        handleHref(outElement, name, attribute.value);
        continue;
      }
      if (namespace === XML_NS) {
        if (local === 'space' && (attribute.value === 'preserve' || attribute.value === 'default')) {
          outElement.setAttributeNS(XML_NS, 'xml:space', attribute.value);
        } else if (local === 'lang' && LANGUAGE_TAG.test(attribute.value)) {
          // The language picks CJK glyph forms.
          outElement.setAttributeNS(XML_NS, 'xml:lang', attribute.value);
        } else if (local === 'base') {
          report.add('xml-base', 'security', attribute.value);
        }
        continue;
      }
      if (namespace === XMLNS_NS) continue;
      if (namespace !== null) {
        report.add('foreign-attribute', 'metadata', attribute.name);
        continue;
      }
      if (local === 'style' || local === 'class') continue; // through declarationsFor
      if (local === 'id') {
        if (!sourceIdOf.has(outElement)) sourceIdOf.set(outElement, attribute.value);
        continue;
      }
      if (local === 'lang') {
        if (LANGUAGE_TAG.test(attribute.value)) outElement.setAttribute('lang', attribute.value);
        continue;
      }
      if (PROPERTIES.has(local)) {
        const clean = cleanCssValue(local, attribute.value, report, `${name}@${local}`);
        if (clean) {
          pendingDeclarations.push({
            element: outElement,
            asAttribute: true,
            property: local,
            value: clean.value,
            references: clean.references,
          });
        }
        continue;
      }
      if (allowed.has(local)) {
        const value = cleanPlainAttribute(local, attribute.value);
        if (value !== null) outElement.setAttribute(local, value);
        else report.add(`attribute-dropped:bad-value:${local}`, 'visual', attribute.value);
        continue;
      }
      const meta = local.startsWith('aria') || local === 'role' || local === 'version' || local.startsWith('data-');
      report.add(`attribute-dropped:${local}`, meta ? 'metadata' : 'info', local);
    }
    for (const [property, clean] of declarationsFor(sourceElement, `${name} style`)) {
      pendingDeclarations.push({
        element: outElement,
        asAttribute: false,
        property,
        value: clean.value,
        references: clean.references,
      });
    }
  };

  const copy = (sourceNode: Node, outParent: Element, depth: number) => {
    if (depth > MAX_DEPTH) throw new Error(`nesting deeper than ${MAX_DEPTH}`);
    if (sourceNode.nodeType === Node.TEXT_NODE || sourceNode.nodeType === Node.CDATA_SECTION_NODE) {
      outParent.appendChild(output.createTextNode(sourceNode.nodeValue ?? ''));
      return;
    }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE) {
      if (sourceNode.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
        report.add('processing-instruction', 'security', (sourceNode as ProcessingInstruction).target);
      }
      return;
    }
    const element = sourceNode as Element;
    const name = element.localName;
    if (element.namespaceURI !== SVG_NS) {
      const html = element.namespaceURI === XHTML_NS;
      report.add(
        html ? `foreign-element:html:${name}` : `foreign-element:${element.prefix ?? element.namespaceURI}`,
        html ? 'security' : 'metadata',
        element.nodeName
      );
      return;
    }
    const intoGroup = (from: Element): Element => {
      const group = output.createElementNS(SVG_NS, 'g');
      copyAttributes(from, group, 'g');
      outParent.appendChild(group);
      elementsOut += 1;
      return group;
    };
    if (name === 'switch') {
      // Illustrator's "Preserve Editing": the first child a renderer would draw.
      const pick = Array.from(element.children).find(
        (child) =>
          !(child.namespaceURI === SVG_NS && child.localName === 'foreignObject') &&
          !child.hasAttribute('requiredExtensions') &&
          !child.hasAttribute('systemLanguage')
      );
      report.add('switch-resolved', 'info', pick ? pick.localName : 'none');
      if (pick) copy(pick, intoGroup(element), depth + 1);
      return;
    }
    if (name === 'a') {
      // A link becomes a group: Inkscape writes `transform` on links.
      const group = intoGroup(element);
      element.childNodes.forEach((child) => copy(child, group, depth + 1));
      return;
    }
    if (DROPPED_SILENTLY.has(name)) return;
    if (DROPPED_FOR_SAFETY.has(name)) {
      report.add(`element-dropped:${name}`, 'security', name);
      return;
    }
    if (SMIL.has(name)) {
      report.add('element-dropped:animation', 'security', `${name} ${element.getAttribute('attributeName') ?? ''}`);
      return;
    }
    if (name === 'feImage') {
      report.add('element-dropped:feImage', 'security');
      return;
    }
    if (name === 'flowRoot') {
      report.add('element-dropped:flowRoot', 'visual');
      return;
    }
    if (!KEPT_ELEMENTS.has(name) && !FILTER_ELEMENTS.has(name)) {
      const inert = name === 'sodipodi' || name === 'view';
      report.add(`element-dropped:${name}`, inert ? 'info' : 'visual', name);
      return;
    }
    const out = output.createElementNS(SVG_NS, name);
    elementsOut += 1;
    outParent.appendChild(out);
    copyAttributes(element, out, name);
    element.childNodes.forEach((child) => copy(child, out, depth + 1));
  };

  copyAttributes(sourceRoot, outputRoot, 'svg');
  elementsOut += 1;
  sourceRoot.childNodes.forEach((child) => copy(child, outputRoot, 1));

  // 7. Ids: the first element to claim a source id keeps it, renamed under the
  // prefix. An id that already carries the prefix stays as it is, which is what
  // makes sanitizing this module's own output return the same bytes.
  const byId = new Map<string, Element>();
  for (const [element, id] of sourceIdOf) if (!byId.has(id)) byId.set(id, element);
  let counter = 0;
  const newIds = new Map<Element, string>();
  const used = new Set<string>();
  for (const element of byId.values()) {
    const sourceId = sourceIdOf.get(element) ?? '';
    let id: string;
    if (sourceId.startsWith(`${prefix}-`) && SAFE_OUTPUT_ID.test(sourceId)) id = sourceId;
    else if (SAFE_OUTPUT_ID.test(sourceId)) id = `${prefix}-${sourceId}`;
    else id = `${prefix}-n${++counter}`;
    while (used.has(id)) id = `${prefix}-n${++counter}`;
    used.add(id);
    newIds.set(element, id);
  }
  for (const [element, id] of sourceIdOf) {
    if (byId.get(id) !== element) report.add('duplicate-id', 'info', id);
  }

  /** A reference resolves by lookup, not by pattern: Inkscape's own pattern ids hold spaces. */
  const resolve = (id: string, expect: readonly string[] | null): Element | null => {
    const element = byId.get(id) ?? byId.get(decodeUriComponentSafe(id));
    if (!element) return null;
    if (expect && !expect.includes(element.localName)) return null;
    return element;
  };

  const styleOf = new Map<Element, Map<string, string>>();
  for (const pending of pendingDeclarations) {
    let value = pending.value;
    let dangling = false;
    for (const reference of pending.references) {
      const target = resolve(reference, REFERENCE_PROPERTIES[pending.property] ?? null);
      if (!target) {
        dangling = true;
        break;
      }
      value = value.replace(
        new RegExp(`url\\(\\s*(['"]?)#${escapeRegExp(reference)}\\1\\s*\\)`, 'g'),
        `url(#${newIds.get(target)})`
      );
    }
    if (dangling) {
      report.add(`dangling-reference-removed:${pending.property}`, 'visual');
      continue;
    }
    if (pending.asAttribute) {
      pending.element.setAttribute(pending.property, value);
    } else {
      // Later declarations of a property win, and keep the cascade's order.
      const style = styleOf.get(pending.element) ?? new Map<string, string>();
      style.delete(pending.property);
      style.set(pending.property, value);
      styleOf.set(pending.element, style);
    }
  }
  for (const [element, style] of styleOf) setStyle(element, style);

  for (const pending of pendingHrefs) {
    const name = pending.element.localName;
    const target = resolve(pending.id, HREF_TARGETS[name] ?? null);
    if (target) pending.element.setAttribute('href', `#${newIds.get(target)}`);
    else report.add(`dangling-href-removed:${name}`, 'visual');
  }
  for (const [element, id] of newIds) element.setAttribute('id', id);

  // Text in the diagram's fonts, which are all a page embeds (`uploadText.ts`).
  elementsOut += setTextFonts(outputRoot, report);

  // Inkscape 1.2+ arrowheads paint with `context-stroke`, which WebKit draws missing.
  bakeContextPaint(outputRoot, report);

  // 6. `<use>` expansion and reference cycles.
  const elementById = new Map<string, Element>();
  for (const element of outputRoot.querySelectorAll('[id]')) {
    elementById.set(element.getAttribute('id') ?? '', element);
  }
  const hrefTarget = (element: Element): Element | null => {
    const href = element.getAttribute('href');
    return href && href.startsWith('#') ? (elementById.get(href.slice(1)) ?? null) : null;
  };
  const failure = checkReferences(outputRoot, hrefTarget, elementsOut);
  if (failure) return fail(failure);

  // 5. Embedded rasters: the header now; a re-encode at import is the caller's async step.
  const pendingRasters: PendingRaster[] = [];
  const pendingElements: Element[] = [];
  for (const { element, href } of images) {
    const match = href.match(RASTER_HREF);
    if (!match) continue;
    const mime = `image/${match[1]}` as PendingRaster['mime'];
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(match[2]);
    } catch {
      report.add('image-dropped:bad-base64', 'visual');
      element.remove();
      continue;
    }
    const size = rasterHeaderSize(bytes, mime);
    if (!size || size.width <= 0 || size.height <= 0) {
      report.add('image-dropped:header-mismatch', 'security', mime);
      element.remove();
      continue;
    }
    const declaredTooLarge =
      size.width > MAX_DECLARED_RASTER_SIDE ||
      size.height > MAX_DECLARED_RASTER_SIDE ||
      size.width * size.height > MAX_DECLARED_RASTER_PIXELS;
    // On load a raster was re-encoded at import, so one past the import cap was
    // put there by hand.
    const loadedTooLarge =
      options.mode === 'load' && Math.max(size.width, size.height) > EMBEDDED_RASTER_MAX_SIDE;
    if (declaredTooLarge || loadedTooLarge) {
      report.add('image-dropped:too-large', 'visual', `${mime} ${size.width}x${size.height}`);
      element.remove();
      continue;
    }
    const clean = `data:${mime};base64,${match[2].replace(/\s+/g, '')}`;
    element.setAttribute('href', clean);
    if (options.mode === 'import') {
      pendingRasters.push({ index: -1, mime, width: size.width, height: size.height, dataUrl: clean });
      pendingElements.push(element);
    }
  }
  const keptImages: Element[] = Array.from(outputRoot.getElementsByTagNameNS(SVG_NS, 'image'));
  pendingRasters.forEach((raster, index) => {
    raster.index = keptImages.indexOf(pendingElements[index]);
  });

  // 8. A viewBox and an explicit size, written last and in one order, so a
  // second pass writes the same attributes.
  for (const name of ['viewBox', 'width', 'height', 'x', 'y']) outputRoot.removeAttribute(name);
  const viewBox = parseViewBox(sourceRoot.getAttribute('viewBox'));
  let width = lengthPx(sourceRoot.getAttribute('width'));
  let height = lengthPx(sourceRoot.getAttribute('height'));
  if (viewBox) {
    if (width === null && height === null) {
      width = viewBox[2];
      height = viewBox[3];
    } else if (width === null) {
      width = ((height ?? 0) * viewBox[2]) / viewBox[3];
    } else if (height === null) {
      height = (width * viewBox[3]) / viewBox[2];
    }
    outputRoot.setAttribute('viewBox', viewBox.map(formatNumber).join(' '));
  } else {
    if (width === null || height === null) report.add('size-defaulted', 'visual');
    width = width ?? 300;
    height = height ?? 150;
    outputRoot.setAttribute('viewBox', `0 0 ${formatNumber(width)} ${formatNumber(height)}`);
  }
  const widthPx = width ?? 300;
  const heightPx = height ?? 150;
  outputRoot.setAttribute('width', formatNumber(widthPx));
  outputRoot.setAttribute('height', formatNumber(heightPx));

  // 9. Only the document element.
  return {
    ok: true,
    svg: env.serialize(outputRoot),
    widthPx,
    heightPx,
    report: report.list(),
    pendingRasters,
    root: outputRoot,
  };
}

/**
 * Refuse a `<use>` graph that instantiates too much, or any reference cycle
 * over `use` and gradient / pattern `href` chains. Iterative, so a deep tree
 * cannot overflow the stack. `null` when the graph is acceptable.
 */
function checkReferences(
  root: Element,
  hrefTarget: (element: Element) => Element | null,
  elementCount: number
): string | null {
  const cap = MAX_USE_INSTANCES + elementCount;
  // Gradient and pattern chains: a cycle there is refused outright. Each
  // element is walked once: a chain that reaches one already proven to end
  // stops there, so a long chain costs its length, not its length squared.
  const ends = new Set<Element>();
  for (const element of root.querySelectorAll('linearGradient, radialGradient, pattern, textPath')) {
    const seen = new Set<Element>([element]);
    let next = hrefTarget(element);
    while (next && (next.localName.endsWith('Gradient') || next.localName === 'pattern')) {
      if (ends.has(next)) break;
      if (seen.has(next)) return `reference cycle at #${next.getAttribute('id') ?? next.localName}`;
      seen.add(next);
      next = hrefTarget(next);
    }
    for (const walked of seen) ends.add(walked);
  }
  // Instantiated nodes: each element counts itself and its children, and a
  // `use` adds what its target instantiates. Post-order without recursion.
  const total = new Map<Element, number>();
  const onStack = new Set<Element>();
  const stack: { element: Element; expanded: boolean }[] = [{ element: root, expanded: false }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const { element } = frame;
    if (!frame.expanded) {
      if (total.has(element)) {
        stack.pop();
        continue;
      }
      if (onStack.has(element)) return `reference cycle at #${element.getAttribute('id') ?? element.localName}`;
      onStack.add(element);
      frame.expanded = true;
      const target = element.localName === 'use' ? hrefTarget(element) : null;
      if (target) {
        if (onStack.has(target)) return `reference cycle at #${target.getAttribute('id') ?? target.localName}`;
        if (!total.has(target)) stack.push({ element: target, expanded: false });
      }
      for (let child = element.lastElementChild; child; child = child.previousElementSibling) {
        if (!total.has(child)) stack.push({ element: child, expanded: false });
      }
      continue;
    }
    stack.pop();
    onStack.delete(element);
    let count = 1;
    for (let child = element.firstElementChild; child; child = child.nextElementSibling) {
      count += total.get(child) ?? 0;
    }
    if (element.localName === 'use') {
      const target = hrefTarget(element);
      if (target) count += total.get(target) ?? 0;
    }
    if (count > cap) return `<use> instantiates more than ${MAX_USE_INSTANCES} nodes`;
    total.set(element, count);
  }
  return null;
}

/**
 * Finish an import: re-encode each pending raster (which also strips EXIF and
 * GPS data), or drop it when that fails. `reencode` returns a PNG or JPEG data
 * URL at most {@link EMBEDDED_RASTER_MAX_SIDE} a side, or `null`.
 */
export async function finishRasters(
  result: SanitizeSuccess,
  env: SanitizeEnv,
  reencode: (raster: PendingRaster) => Promise<string | null>
): Promise<SanitizeSuccess> {
  if (result.pendingRasters.length === 0) return result;
  const images = Array.from(result.root.getElementsByTagNameNS(SVG_NS, 'image'));
  const report = [...result.report];
  let dropped = 0;
  for (const raster of result.pendingRasters) {
    const element = images[raster.index];
    if (!element) continue;
    const url = await reencode(raster);
    if (url) {
      element.setAttribute('href', url);
    } else {
      element.remove();
      dropped += 1;
    }
  }
  if (dropped > 0) {
    report.push({ code: 'image-dropped:reencode-failed', kind: 'visual', count: dropped, samples: [] });
  }
  return { ...result, svg: env.serialize(result.root), report, pendingRasters: [] };
}

// ---------------------------------------------------------------------------
// Text fonts (`uploadText.ts`)

/** Font properties taken off every element: the runs carry the diagram's. The size stays. */
const FONT_PROPERTIES = [
  'font',
  'font-family',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'font-size-adjust',
  'font-kerning',
  'font-feature-settings',
  'font-variant-ligatures',
  'font-variant-caps',
  'font-variant-numeric',
  'font-variant-east-asian',
];
/** What decides a text's font, in cascade order: the shorthand, then the longhands. */
const FONT_DECLARATIONS = ['font', 'font-family', 'font-weight', 'font-style', 'font-size'];
const TEXT_CONTENT = new Set(['text', 'tspan', 'textPath']);

/** The font a text asked for. */
interface AskedFont {
  /** Its first family, unquoted and lowercased; '' for none. */
  family: string;
  weight: number;
  italic: boolean;
}

const NO_FONT: AskedFont = { family: '', weight: 400, italic: false };

/**
 * Every text in the diagram's fonts: each text node's characters split into
 * runs by script (`fontScripts.ts`, a text's Han in {@link UPLOAD_HAN_KEY}),
 * and each run's element given the family and the weight, Regular below 600
 * and Bold from it, as a browser picks between the two. A text node that is
 * its element's only child and one run is the run; otherwise each run is a
 * new `<tspan>`. Spaces between runs are left to the `<text>`, which is set
 * in Noto Sans when it is not itself a run.
 *
 * Idempotent: on its own output every run is already its element's only
 * child, in the font it asks for. Returns the `<tspan>`s it added.
 */
function setTextFonts(root: Element, report: Report): number {
  const texts = Array.from(root.getElementsByTagNameNS(SVG_NS, 'text'));
  // A font property on a drawing with no text sets nothing.
  if (texts.length === 0) return 0;
  const asked = new Map<Element, AskedFont>();
  const walk = (element: Element, inherited: AskedFont) => {
    const font = clearFont(element, inherited);
    if (TEXT_CONTENT.has(element.localName)) asked.set(element, font);
    for (const child of Array.from(element.children)) walk(child, font);
  };
  walk(root, NO_FONT);

  let added = 0;
  for (const text of texts) {
    const nodes = textNodesOf(text);
    const graphemes = nodes.map((node) => graphemesOf(node.data));
    const all = graphemes.flat();
    const keys = scriptFonts(all, textCjkKey(all.join(''), languageKey(text) ?? UPLOAD_HAN_KEY));
    let at = 0;
    nodes.forEach((node, index) => {
      const own = keys.slice(at, at + graphemes[index].length);
      at += graphemes[index].length;
      if (/^[ \t\r\n]*$/.test(node.data)) return;
      const parent = node.parentNode as Element;
      const font = asked.get(parent) ?? NO_FONT;
      const runs = runsOf(graphemes[index], own);
      noteMappedFont(font, runs, report);
      const weight = font.weight >= 600 ? 700 : 400;
      if (runs.length === 1 && parent.childNodes.length === 1) {
        setRunFont(parent, runs[0].key, weight);
        return;
      }
      const document = parent.ownerDocument;
      for (const run of runs) {
        const span = document.createElementNS(SVG_NS, 'tspan');
        setRunFont(span, run.key, weight);
        span.appendChild(document.createTextNode(run.text));
        parent.insertBefore(span, node);
        added += 1;
      }
      parent.removeChild(node);
    });
    if (!text.hasAttribute('font-family')) {
      setRunFont(text, 'latin', (asked.get(text) ?? NO_FONT).weight >= 600 ? 700 : 400);
    }
  }
  return added;
}

/**
 * The CJK font a text's language asks for, as kana and Hangul do: Japanese or
 * Korean. Chinese, or no language, leaves its Han to the diagram's style.
 */
function languageKey(element: Element): CjkFontKey | null {
  for (let at: Element | null = element; at; at = at.parentElement) {
    const language = at.getAttributeNS(XML_NS, 'lang') ?? at.getAttribute('lang');
    if (language === null) continue;
    const primary = language.split('-')[0].toLowerCase();
    return primary === 'ja' ? 'jp' : primary === 'ko' ? 'kr' : null;
  }
  return null;
}

/** The text nodes a `<text>` draws, in order: none inside its `<title>` or `<desc>`. */
function textNodesOf(text: Element): Text[] {
  const nodes: Text[] = [];
  const visit = (element: Element) => {
    element.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) nodes.push(child as Text);
      else if (child.nodeType === Node.ELEMENT_NODE && TEXT_CONTENT.has((child as Element).localName)) {
        visit(child as Element);
      }
    });
  };
  visit(text);
  return nodes;
}

function runsOf(graphemes: readonly string[], keys: readonly DiagramFontKey[]) {
  const runs: { key: DiagramFontKey; text: string }[] = [];
  graphemes.forEach((grapheme, index) => {
    const last = runs[runs.length - 1];
    if (last && last.key === keys[index]) last.text += grapheme;
    else runs.push({ key: keys[index], text: grapheme });
  });
  return runs;
}

function setRunFont(element: Element, key: DiagramFontKey, weight: 400 | 700): void {
  element.setAttribute('font-family', uploadTextFamily(key));
  element.setAttribute('font-weight', String(weight));
}

function noteMappedFont(font: AskedFont, runs: readonly { key: DiagramFontKey }[], report: Report): void {
  for (const run of runs) {
    if (font.family !== DIAGRAM_FONT_FAMILY[run.key].toLowerCase()) {
      report.add('font-mapped:family', 'visual', font.family || '(none)');
    }
  }
  if (font.weight !== 400 && font.weight !== 700) report.add('font-mapped:weight', 'visual', String(font.weight));
  if (font.italic) report.add('font-mapped:italic', 'visual');
}

/**
 * The font an element asks for, its own declarations over what it inherits,
 * and every font property but the size taken off it. A size the `font`
 * shorthand set is kept as `font-size`.
 */
function clearFont(element: Element, inherited: AskedFont): AskedFont {
  const asks = Array.from(element.attributes).some(
    ({ name, value }) => name.startsWith('font') || (name === 'style' && value.includes('font'))
  );
  if (!asks) return inherited;
  const declared = new Map<string, { value: string; shorthand: boolean }>();
  const declare = (property: string, value: string) => {
    if (property !== 'font') {
      declared.set(property, { value, shorthand: false });
      return;
    }
    const parts = parseFontShorthand(value);
    if (parts) for (const [name, part] of Object.entries(parts)) declared.set(name, { value: part, shorthand: true });
  };
  // The attributes, then the style, which overrides them.
  for (const property of FONT_DECLARATIONS) {
    const value = element.getAttribute(property);
    if (value !== null) declare(property, value);
  }
  const style = styleMap(element);
  for (const [property, value] of style) if (FONT_DECLARATIONS.includes(property)) declare(property, value);

  let restyled = false;
  for (const property of FONT_PROPERTIES) {
    element.removeAttribute(property);
    if (style.delete(property)) restyled = true;
  }
  const size = declared.get('font-size');
  if (size?.shorthand) {
    style.delete('font-size');
    style.set('font-size', size.value);
    restyled = true;
  }
  if (restyled) setStyle(element, style);

  const family = declared.get('font-family')?.value.trim();
  const weight = declared.get('font-weight')?.value.trim().toLowerCase();
  const fontStyle = declared.get('font-style')?.value.trim().toLowerCase();
  return {
    family: family === undefined || INHERITED.test(family) ? inherited.family : firstFamily(family),
    weight: weight === undefined ? inherited.weight : weightValue(weight, inherited.weight),
    italic:
      fontStyle === undefined || INHERITED.test(fontStyle)
        ? inherited.italic
        : fontStyle === 'italic' || fontStyle.startsWith('oblique'),
  };
}

const INHERITED = /^(inherit|unset)$/i;

function firstFamily(value: string): string {
  if (/^initial$/i.test(value)) return '';
  const first = value.match(/^\s*(?:"([^"]*)"|'([^']*)'|([^,]*))/);
  return (first?.[1] ?? first?.[2] ?? first?.[3] ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** A `font-weight` as a number, a relative one from the inherited weight (CSS Fonts 4, §2.2). */
function weightValue(value: string, inherited: number): number {
  if (value === 'inherit' || value === 'unset') return inherited;
  if (value === 'normal' || value === 'initial') return 400;
  if (value === 'bold') return 700;
  if (value === 'bolder') return inherited < 350 ? 400 : inherited < 550 ? 700 : 900;
  if (value === 'lighter') return inherited < 100 ? inherited : inherited < 550 ? 100 : inherited < 750 ? 400 : 700;
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 1000 ? number : inherited;
}

const FONT_SIZE =
  /^(?:\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px|pt|pc|mm|cm|in|q|em|ex|rem|ch|vw|vh|vmin|vmax|%)|0|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)$/i;

type FontLonghands = Record<'font-style' | 'font-weight' | 'font-size' | 'font-family', string>;

/**
 * The `font` shorthand as the longhands it sets, the style and weight reset
 * to `normal` when it leaves them out; null for one that does not read (a
 * system font, or no size or family).
 */
function parseFontShorthand(value: string): FontLonghands | null {
  const tokens = value.trim().split(/\s+/);
  let fontStyle = 'normal';
  let weight = 'normal';
  for (let index = 0; index < tokens.length; index++) {
    const [size, lineHeight] = tokens[index].split('/');
    if (FONT_SIZE.test(size)) {
      let rest = index + 1;
      // "12px/1.2", "12px/ 1.2", "12px / 1.2" and "12px /1.2".
      if (lineHeight === '') rest += 1;
      else if (lineHeight === undefined && tokens[rest]?.startsWith('/')) rest += tokens[rest] === '/' ? 2 : 1;
      const family = tokens.slice(rest).join(' ');
      return family === ''
        ? null
        : { 'font-style': fontStyle, 'font-weight': weight, 'font-size': size, 'font-family': family };
    }
    const token = tokens[index].toLowerCase();
    if (token === 'italic' || token === 'oblique') fontStyle = token;
    else if (token === 'bold' || token === 'bolder' || token === 'lighter' || /^\d+(\.\d+)?$/.test(token)) {
      weight = token;
    }
    // `normal`, `small-caps`, the widths and an oblique's angle set nothing kept here.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Context paint

function styleMap(element: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (const declaration of splitDeclarations(element.getAttribute('style') ?? '')) {
    map.set(declaration.property, declaration.value);
  }
  return map;
}

function setStyle(element: Element, style: Map<string, string>): void {
  if (style.size > 0) {
    element.setAttribute('style', [...style].map(([property, value]) => `${property}:${value}`).join(';'));
  } else {
    element.removeAttribute('style');
  }
}

function effectiveProperty(element: Element | null, property: string, fallback: string): string {
  for (let at = element; at && at.nodeType === Node.ELEMENT_NODE; at = at.parentElement) {
    const value = styleMap(at).get(property) ?? at.getAttribute(property);
    if (value && value !== 'inherit') return value;
  }
  return fallback;
}

const MARKER_PROPERTIES = ['marker-start', 'marker-mid', 'marker-end', 'marker'];
const CONTEXT_PAINT = /context-(stroke|fill)/;

/**
 * Bake `context-stroke` / `context-fill` in markers into one copy of the marker
 * per (stroke, fill) that uses it. Idempotent: a second pass finds no context
 * paint left.
 */
function bakeContextPaint(root: Element, report: Report): void {
  const markers = new Map<string, Element>();
  for (const marker of Array.from(root.getElementsByTagNameNS(SVG_NS, 'marker'))) {
    const id = marker.getAttribute('id');
    const uses = [marker, ...Array.from(marker.getElementsByTagName('*'))].some((element) =>
      ['style', 'fill', 'stroke'].some((name) => CONTEXT_PAINT.test(element.getAttribute(name) ?? ''))
    );
    if (id && uses) markers.set(id, marker);
  }
  if (markers.size === 0) return;
  // First every use and the copy it needs, so the copies are budgeted before
  // any is made: a marker of a few hundred nodes in a few hundred colours is a
  // small file and a huge tree.
  interface MarkerUse {
    element: Element;
    property: string;
    where: 'style' | 'attribute';
    markerId: string;
    stroke: string;
    fill: string;
    key: string;
  }
  const uses: MarkerUse[] = [];
  const nodesPerCopy = new Map<string, number>();
  for (const element of Array.from(root.getElementsByTagName('*'))) {
    const style = styleMap(element);
    for (const property of MARKER_PROPERTIES) {
      for (const where of ['style', 'attribute'] as const) {
        const value = where === 'style' ? style.get(property) : element.getAttribute(property);
        const match = value?.match(/^url\(#([^)]+)\)$/);
        const marker = match ? markers.get(match[1]) : undefined;
        if (!match || !marker) continue;
        const stroke = effectiveProperty(element, 'stroke', 'none');
        const fill = effectiveProperty(element, 'fill', 'black');
        const key = `${match[1]}|${stroke}|${fill}`;
        uses.push({ element, property, where, markerId: match[1], stroke, fill, key });
        if (!nodesPerCopy.has(key)) nodesPerCopy.set(key, 1 + marker.getElementsByTagName('*').length);
      }
    }
  }
  let bakedNodes = 0;
  for (const nodes of nodesPerCopy.values()) bakedNodes += nodes;
  if (bakedNodes > MAX_BAKED_MARKER_NODES) {
    throw new Error(`marker copies past ${MAX_BAKED_MARKER_NODES} nodes`);
  }

  const copies = new Map<string, string>();
  let count = 0;
  const changedStyles = new Map<Element, Map<string, string>>();
  for (const use of uses) {
    let copyId = copies.get(use.key);
    if (!copyId) {
      const source = markers.get(use.markerId);
      if (!source) continue;
      const copy = source.cloneNode(true) as Element;
      count += 1;
      copyId = `${use.markerId}-k${count}`;
      copy.setAttribute('id', copyId);
      for (const node of [copy, ...Array.from(copy.getElementsByTagName('*'))]) {
        if (node !== copy && node.hasAttribute('id')) {
          node.setAttribute('id', `${node.getAttribute('id')}-k${count}`);
        }
        const nodeStyle = styleMap(node);
        let changed = false;
        for (const [name, raw] of nodeStyle) {
          const baked = raw.replace(/context-stroke/g, use.stroke).replace(/context-fill/g, use.fill);
          if (baked !== raw) {
            nodeStyle.set(name, baked);
            changed = true;
          }
        }
        if (changed) setStyle(node, nodeStyle);
        for (const name of ['fill', 'stroke']) {
          const raw = node.getAttribute(name);
          if (raw && CONTEXT_PAINT.test(raw)) {
            node.setAttribute(name, raw.replace(/context-stroke/g, use.stroke).replace(/context-fill/g, use.fill));
          }
        }
      }
      source.parentNode?.insertBefore(copy, source.nextSibling);
      copies.set(use.key, copyId);
      report.add('marker-context-paint-baked', 'info', use.key);
    }
    if (use.where === 'style') {
      const style = changedStyles.get(use.element) ?? styleMap(use.element);
      style.set(use.property, `url(#${copyId})`);
      changedStyles.set(use.element, style);
    } else {
      use.element.setAttribute(use.property, `url(#${copyId})`);
    }
  }
  for (const [element, style] of changedStyles) setStyle(element, style);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeUriComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// What the user is told

/** The changes worth a sentence to the person who uploaded the file. */
export type SanitizeNotice = 'flowed-text' | 'linked-image' | 'css-dropped' | 'text-font' | 'unsupported';

/**
 * From the report to the notices an upload shows. Only what changes the look:
 * a dropped script is not news to anyone whose picture still looks the same.
 */
export function sanitizeNotices(report: readonly ReportEntry[]): SanitizeNotice[] {
  const notices = new Set<SanitizeNotice>();
  for (const entry of report) {
    if (entry.kind !== 'visual') continue;
    if (entry.code === 'element-dropped:flowRoot') notices.add('flowed-text');
    else if (entry.code === 'image-dropped:linked' || entry.code === 'image-dropped:embedded-svg') {
      notices.add('linked-image');
    } else if (entry.code.startsWith('css-')) notices.add('css-dropped');
    else if (entry.code.startsWith('font-mapped:')) notices.add('text-font');
    else notices.add('unsupported');
  }
  return [...notices];
}
