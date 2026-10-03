import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SVG_NS,
  finishRasters,
  rasterHeaderSize,
  sanitizeNotices,
  sanitizeSvg,
  screenDoctype,
  type SanitizeResult,
  type SanitizeSuccess,
} from './svgSanitize';

/**
 * The sanitizer against the Phase 0 corpus: 24 hostile files, synthetic
 * imitations of Illustrator, Affinity and Figma output, and the app's own
 * folded-figure exports (the `fixed` pictures D2 stores).
 */
const here = dirname(new URL(import.meta.url).pathname);
const corpus = (dir: string) =>
  readdirSync(join(here, 'fixtures', dir))
    .filter((file) => file.endsWith('.svg'))
    .map((file) => ({ file, text: readFileSync(join(here, 'fixtures', dir, file), 'utf8') }));

const load = (text: string, idPrefix = 'a1') => sanitizeSvg(text, { idPrefix, mode: 'load' });

function ok(result: SanitizeResult): SanitizeSuccess {
  if (!result.ok) throw new Error(`refused: ${result.error}`);
  return result;
}

const ALLOWED = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'textPath', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'pattern',
  'marker', 'symbol', 'use', 'title', 'desc', 'image', 'filter', 'feBlend', 'feColorMatrix',
  'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
  'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG',
  'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
  'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
]);

/**
 * What every output must be, checked on its structure rather than its text:
 * escaped markup inside a `<text>` is harmless characters, and a regex over
 * the serialization cannot tell it from an element.
 */
function expectInert(svg: string): void {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
  const root = document.documentElement;
  expect(root.namespaceURI).toBe(SVG_NS);
  for (const element of [root, ...Array.from(root.getElementsByTagName('*'))]) {
    expect(element.namespaceURI, element.nodeName).toBe(SVG_NS);
    expect(ALLOWED.has(element.localName), element.localName).toBe(true);
    for (const attribute of Array.from(element.attributes)) {
      const where = `${element.localName}@${attribute.name}`;
      expect(attribute.name.toLowerCase().startsWith('on'), where).toBe(false);
      expect(attribute.namespaceURI === null || attribute.name.startsWith('xml'), where).toBe(true);
      if (attribute.localName === 'href') {
        expect(attribute.value, where).toMatch(/^#|^data:image\/(png|jpeg|webp);base64,/);
      }
      for (const url of attribute.value.matchAll(/url\(([^)]*)\)/gi)) {
        expect(url[1], where).toMatch(/^#/);
      }
      expect(attribute.value, where).not.toMatch(/javascript:|expression\(|@import/i);
    }
  }
}

describe('the hostile corpus', () => {
  const refused: Record<string, RegExp> = {
    'h05b-nul-ref.svg': /parse error/,
    'h11-billion-laughs.svg': /doctype/,
    'h11b-external-entity.svg': /doctype/,
    'h11c-quadratic-blowup.svg': /doctype/,
    'h11d-attlist-defaults.svg': /doctype/,
    'h14-use-fanout.svg': /instantiates more than/,
    'h15-use-cycle.svg': /reference cycle/,
    'h19b-html-root.svg': /not an SVG/,
  };

  it.each(corpus('hostile'))('$file is refused or comes out inert', ({ file, text }) => {
    const result = load(text);
    if (file in refused) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(refused[file]);
      return;
    }
    expectInert(ok(result).svg);
  });
});

describe('real and imitated exports', () => {
  const files = [...corpus('synthetic'), ...corpus('own-output')];

  it.each(files)('$file is kept, and inert', ({ text }) => {
    expectInert(ok(load(text)).svg);
  });

  it.each(files)('$file sanitizes to the same bytes a second time', ({ text }) => {
    const once = ok(load(text)).svg;
    expect(ok(load(once)).svg).toBe(once);
  });

  it('keeps the drawing of the app’s own exports', () => {
    const { text } = files.find((entry) => entry.file === 'crane-fixed-11.svg')!;
    const kept = ok(load(text)).svg;
    const count = (svg: string, tag: string) => (svg.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;
    for (const tag of ['path', 'polygon', 'line', 'g']) expect(count(kept, tag), tag).toBe(count(text, tag));
  });
});

describe('ids', () => {
  it('prefixes every id per asset, so two uploads never share one', () => {
    const [a, b] = ['idcollide-a.svg', 'idcollide-b.svg'].map(
      (name) => corpus('synthetic').find((entry) => entry.file === name)!.text
    );
    const first = ok(load(a, 'asset1')).svg;
    const second = ok(load(b, 'asset2')).svg;
    const ids = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids(first).length).toBeGreaterThan(0);
    expect(ids(first).every((id) => id.startsWith('asset1-'))).toBe(true);
    expect(ids(second).every((id) => id.startsWith('asset2-'))).toBe(true);
    // References follow their ids.
    expect(first).toMatch(/url\(#asset1-/);
  });

  it('resolves a reference to an id with spaces, as Inkscape writes its stock patterns', () => {
    const svg = ok(
      load(
        `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><defs><pattern id="Alternating Chevron" width="2" height="2"><rect width="1" height="1"/></pattern></defs><rect width="10" height="10" fill="url(#Alternating%20Chevron)"/></svg>`
      )
    ).svg;
    // Not a safe name to keep, so it is numbered, and the reference follows.
    expect(svg).toMatch(/<pattern [^>]*id="a1-n1"/);
    expect(svg).toMatch(/fill="url\(#a1-n1\)"/);
  });

  it('drops a reference to something that was not kept, or is the wrong kind', () => {
    const result = ok(
      load(
        `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><rect fill="url(#c)" stroke="url(#gone)" clip-path="url(#c)" width="1" height="1"/></svg>`
      )
    );
    expect(result.svg).not.toMatch(/fill="url/);
    expect(result.svg).not.toMatch(/stroke="url/);
    expect(result.svg).toMatch(/clip-path="url\(#a1-c\)"/);
  });
});

describe('structure', () => {
  it('turns a link and an Illustrator switch into groups that keep their transforms', () => {
    const svg = ok(
      load(
        `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><a xlink:href="https://example.com" transform="translate(1 2)"><rect width="1" height="1"/></a><switch transform="scale(2)"><foreignObject requiredExtensions="x"><p>no</p></foreignObject><g><circle r="1"/></g></switch></svg>`
      )
    ).svg;
    expect(svg).toMatch(/<g transform="translate\(1 2\)"><rect/);
    expect(svg).toMatch(/<g transform="scale\(2\)"><g><circle/);
    expect(svg).not.toMatch(/example\.com|foreignObject/);
  });

  it('inlines simple style rules by specificity, and drops the rest with a report', () => {
    const result = ok(
      load(
        `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><style>.st0{fill:#f00}#x{fill:#0f0}rect.st0{stroke:#00f} g > rect{fill:#000}</style><rect class="st0" width="1" height="1"/><rect id="x" class="st0" width="1" height="1"/></svg>`
      )
    );
    expect(result.svg).toMatch(/<rect width="1" height="1" style="fill:#f00;stroke:#00f"\/>/);
    // The id rule outranks the class rule's fill; the compound class rule still strokes it.
    expect(result.svg).toMatch(/style="stroke:#00f;fill:#0f0" id="a1-x"/);
    expect(sanitizeNotices(result.report)).toContain('css-dropped');
  });

  it('bakes context-stroke markers into a copy per colour', () => {
    const svg = ok(
      load(
        `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><defs><marker id="arrow"><path d="M0 0L1 1" style="fill:context-stroke"/></marker></defs><path d="M0 0L5 5" style="stroke:#c00;marker-end:url(#arrow)"/></svg>`
      )
    ).svg;
    expect(svg).toMatch(/<marker id="a1-arrow-k1"><path d="M0 0L1 1" style="fill:#c00"/);
    expect(svg).toMatch(/marker-end:url\(#a1-arrow-k1\)/);
  });

  it('keeps masks and filters, as route C draws them, but never feImage', () => {
    const result = ok(
      load(
        `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><mask id="m"><rect width="5" height="5" fill="#fff"/></mask><filter id="f"><feGaussianBlur stdDeviation="1"/><feImage xlink:href="https://example.com/x.png"/></filter></defs><rect width="10" height="10" mask="url(#m)" filter="url(#f)"/></svg>`
      )
    );
    expect(result.svg).toMatch(/<mask id="a1-m"/);
    expect(result.svg).toMatch(/<feGaussianBlur stdDeviation="1"\/>/);
    expect(result.svg).not.toMatch(/feImage|example\.com/);
    expect(result.svg).toMatch(/mask="url\(#a1-m\)" filter="url\(#a1-f\)"/);
  });

  it('keeps the language a text is set in, which picks its CJK glyphs', () => {
    const svg = ok(
      load(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><text xml:lang="zh-CN" lang="ja">折</text></svg>`)
    ).svg;
    expect(svg).toMatch(/xml:lang="zh-CN"/);
    expect(svg).toMatch(/lang="ja"/);
  });

  it('says when old Inkscape flowed text was dropped', () => {
    const result = ok(
      load(`<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><flowRoot><flowPara>Hi</flowPara></flowRoot></svg>`)
    );
    expect(sanitizeNotices(result.report)).toEqual(['flowed-text']);
  });

  it('writes a viewBox and a size in one order, from whatever the file gave', () => {
    expect(ok(load(`<svg xmlns="${SVG_NS}" width="20mm" height="10mm"/>`)).svg).toMatch(
      /viewBox="0 0 75.591 37.795" width="75.591" height="37.795"/
    );
    const result = ok(load(`<svg xmlns="${SVG_NS}" viewBox="0 0 40 20" width="80"/>`));
    expect([result.widthPx, result.heightPx]).toEqual([80, 40]);
  });

  it('refuses nesting too deep to follow, rather than overflowing the stack', () => {
    // Twice the cap (512). Deeper only slows the test: jsdom's parser is
    // quadratic in depth (2.6 s at 5000), and the sanitizer stops at the cap.
    const deep = `<svg xmlns="${SVG_NS}">${'<g>'.repeat(1024)}${'</g>'.repeat(1024)}</svg>`;
    const result = load(deep);
    expect(result.ok).toBe(false);
  });
});

describe('the DOCTYPE screen', () => {
  it('lets Illustrator’s literal entity header through', () => {
    expect(
      screenDoctype(
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x" [<!ENTITY ns_svg "http://www.w3.org/2000/svg">]><svg/>'
      )
    ).toBeNull();
  });

  it('refuses a literal entity referenced often enough to blow up', () => {
    const value = 'x'.repeat(1000);
    const text = `<!DOCTYPE svg [<!ENTITY e "${value}">]><svg>${'&e;'.repeat(2000)}</svg>`;
    expect(screenDoctype(text)).toMatch(/expand/);
  });
});

describe('embedded rasters', () => {
  // A 1×1 PNG.
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const withImage = (href: string) =>
    `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10"><image width="1" height="1" href="${href}"/></svg>`;

  it('reads a PNG’s size from its header', () => {
    const bytes = Uint8Array.from(atob(PNG), (char) => char.charCodeAt(0));
    expect(rasterHeaderSize(bytes, 'image/png')).toEqual({ width: 1, height: 1 });
    expect(rasterHeaderSize(bytes, 'image/jpeg')).toBeNull();
  });

  it('lists every raster for re-encoding at import, and none on load', async () => {
    const text = withImage(`data:image/png;base64,${PNG}`);
    const imported = ok(sanitizeSvg(text, { idPrefix: 'a1', mode: 'import' }));
    expect(imported.pendingRasters).toHaveLength(1);
    const finished = await finishRasters(
      imported,
      {
        parse: (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml'),
        serialize: (node) => new XMLSerializer().serializeToString(node),
        createDocument: () => document.implementation.createDocument(SVG_NS, 'svg', null),
      },
      async () => 'data:image/png;base64,AAAA'
    );
    expect(finished.svg).toMatch(/href="data:image\/png;base64,AAAA"/);
    expect(ok(load(text)).pendingRasters).toHaveLength(0);
  });

  it('drops a raster whose bytes are not what its type says', () => {
    const result = ok(load(withImage(`data:image/jpeg;base64,${PNG}`)));
    expect(result.svg).not.toMatch(/<image/);
  });

  it('drops a linked picture, and says so', () => {
    const result = ok(load(withImage('https://example.com/a.png')));
    expect(result.svg).not.toMatch(/example\.com/);
    expect(sanitizeNotices(result.report)).toEqual(['linked-image']);
  });
});
