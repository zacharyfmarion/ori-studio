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
    'h21-css-fanout.svg': /match too many elements/,
    'h22-marker-fanout.svg': /marker copies past/,
    'h23-entity-nonascii.svg': /doctype/,
    'h24-doctype-in-comment.svg': /doctype/,
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

/**
 * Work bounded by the file, not by its square. Each of these was quadratic, or
 * worse, before the Phase 2 review; the bounds are generous (a loaded CI
 * machine) and still far below what the old code took at these sizes.
 */
describe('bounded work', () => {
  const timed = <T>(run: () => T): { result: T; ms: number } => {
    const start = performance.now();
    const result = run();
    return { result, ms: performance.now() - start };
  };

  it('refuses a stylesheet whose rules all match every element, quickly', () => {
    const svg = `<svg xmlns="${SVG_NS}" width="10" height="10"><style>${'*{fill:red}'.repeat(6000)}</style>${'<g/>'.repeat(6000)}</svg>`;
    const { result, ms } = timed(() => load(svg));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/match too many elements/);
    expect(ms).toBeLessThan(3000);
  });

  it('keeps one declaration per property per element, however many rules say it', () => {
    const svg = `<svg xmlns="${SVG_NS}" width="10" height="10"><style>${'.a{fill:red}'.repeat(500)}.a{fill:blue}</style>${'<rect class="a" width="1" height="1"/>'.repeat(500)}</svg>`;
    const out = ok(load(svg)).svg;
    expect(out.match(/fill:/g)).toHaveLength(500);
    expect(out).not.toContain('red');
  });

  it('refuses context-paint markers that would copy past the node budget, before copying', () => {
    const marker = `<marker id="m">${'<path d="M0 0L1 1" style="fill:context-stroke"/>'.repeat(800)}</marker>`;
    const paths = Array.from({ length: 800 }, (_, i) =>
      `<path d="M0 0L5 5" style="stroke:#${i.toString(16).padStart(6, '0')};marker-end:url(#m)"/>`
    ).join('');
    const { result, ms } = timed(() => load(`<svg xmlns="${SVG_NS}" width="10" height="10"><defs>${marker}</defs>${paths}</svg>`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/marker copies past/);
    expect(ms).toBeLessThan(3000);
  });

  it('strips a flood of unclosed CSS comments in one pass', () => {
    const svg = `<svg xmlns="${SVG_NS}" width="10" height="10"><style>${'/* '.repeat(160_000)}</style><rect width="5" height="5"/></svg>`;
    const { result, ms } = timed(() => load(svg));
    expect(result.ok).toBe(true);
    expect(ms).toBeLessThan(2000);
  });

  it('walks a long gradient chain once', () => {
    const grads = Array.from({ length: 8000 }, (_, i) => `<linearGradient id="g${i}" href="#g${i + 1}"/>`).join('');
    const svg = `<svg xmlns="${SVG_NS}" width="10" height="10"><defs>${grads}<linearGradient id="g8000"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="5" height="5" fill="url(#g0)"/></svg>`;
    const { result, ms } = timed(() => load(svg));
    expect(result.ok).toBe(true);
    expect(ms).toBeLessThan(3000);
  });

  it('refuses an oversized internal subset before scanning it', () => {
    const { result, ms } = timed(() => screenDoctype(`<!DOCTYPE svg [${'<!ENTITY '.repeat(40_000)}]><svg/>`));
    expect(result).toMatch(/too large/);
    expect(ms).toBeLessThan(500);
  });
});

describe('the DOCTYPE screen, against names and hiding places', () => {
  it('counts references to an entity of any name', () => {
    for (const name of ['é', 'a:b', 'aé']) {
      const text = `<!DOCTYPE svg [<!ENTITY ${name} "${'x'.repeat(1000)}">]><svg>${`&${name};`.repeat(1100)}</svg>`;
      expect(screenDoctype(text), name).toMatch(/expand too far/);
    }
  });

  it('refuses a second DOCTYPE, as one hidden in a comment would be', () => {
    expect(
      screenDoctype('<!-- <!DOCTYPE x> --><!DOCTYPE svg [<!ATTLIST svg onload CDATA "x">]><svg/>')
    ).toMatch(/more than one DOCTYPE/);
  });

  it('refuses an internal subset with a declaration that never closes', () => {
    expect(screenDoctype('<!DOCTYPE svg [<!ENTITY a "x" ]><svg/>')).not.toBeNull();
  });
});

describe('rasterHeaderSize, against fill bytes', () => {
  it('skips 0xFF fill bytes before a marker, as decoders do', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x59, 0xd8, 0x59, 0xd8, 0x03, ...new Array(24).fill(0)]);
    expect(rasterHeaderSize(bytes, 'image/jpeg')).toEqual({ width: 23000, height: 23000 });
  });

  it('gives no size when the scan starts before any frame', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, ...new Array(24).fill(0)]);
    expect(rasterHeaderSize(bytes, 'image/jpeg')).toBeNull();
  });
});


describe('text, set in the diagram’s fonts', () => {
  const svgOf = (body: string) => `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">${body}</svg>`;
  const NOTO = `font-family="'Noto Sans', sans-serif"`;
  const family = (name: string) => `font-family="'Noto Sans ${name}', sans-serif"`;

  it('sets each script’s run in its font, Regular or Bold, and says it changed the font', () => {
    const result = ok(
      load(svgOf(`<text x="1" y="2" font-family="Helvetica" font-weight="600" style="font-style:italic">Fold 折る</text>`))
    );
    expect(result.svg).toContain(
      `<text x="1" y="2" ${NOTO} font-weight="700">` +
        `<tspan ${NOTO} font-weight="700">Fold </tspan><tspan ${family('JP')} font-weight="700">折る</tspan></text>`
    );
    expect(result.report.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['font-mapped:family', 'font-mapped:weight', 'font-mapped:italic'])
    );
    expect(sanitizeNotices(result.report)).toEqual(['text-font']);
  });

  it('keeps one run on its own element, its Han standing for the diagram’s style', () => {
    expect(ok(load(svgOf('<text>折</text>'))).svg).toContain(`<text ${family('SC')} font-weight="400">折</text>`);
  });

  it('sets Han in Japanese or Korean when the text says that is its language', () => {
    expect(ok(load(svgOf('<text xml:lang="ja">折</text>'))).svg).toContain(family('JP'));
    expect(ok(load(svgOf('<g lang="ko-KR"><text>折</text></g>'))).svg).toContain(family('KR'));
    expect(ok(load(svgOf('<text xml:lang="zh-TW">折</text>'))).svg).toContain(family('SC'));
  });

  it('gives each run the weight it inherits, and leaves the spaces between them to the text', () => {
    const svg = ok(
      load(svgOf('<g font-weight="bold"><text><tspan>A</tspan> <tspan style="font-weight:normal">B</tspan></text></g>'))
    ).svg;
    expect(svg).toContain(
      `<g><text ${NOTO} font-weight="700"><tspan ${NOTO} font-weight="700">A</tspan> ` +
        `<tspan ${NOTO} font-weight="400">B</tspan></text></g>`
    );
  });

  it('reads the font shorthand, keeping its size', () => {
    const svg = ok(load(svgOf(`<text style="fill:red;font: italic bold 12px/1.5 'Times New Roman', serif">A</text>`))).svg;
    expect(svg).toContain(`<text style="fill:red;font-size:12px" ${NOTO} font-weight="700">A</text>`);
  });

  it('says nothing for text already in the diagram’s font', () => {
    const result = ok(load(svgOf(`<text font-family="Noto Sans" font-weight="bold" font-size="4">Fold</text>`)));
    expect(sanitizeNotices(result.report)).toEqual([]);
    expect(result.svg).toContain(`<text font-size="4" ${NOTO} font-weight="700">Fold</text>`);
  });

  it('leaves the font properties of a drawing with no text alone', () => {
    expect(ok(load(svgOf('<g font-family="Helvetica"><path d="M0 0H1"/></g>'))).svg).toContain(
      '<g font-family="Helvetica">'
    );
  });

  it('sets a weight over 500 in Bold and one up to 500 in Regular, as a browser picks between the two', () => {
    expect(ok(load(svgOf('<text font-weight="550">A</text>'))).svg).toContain(`${NOTO} font-weight="700"`);
    expect(ok(load(svgOf('<text font-weight="500">A</text>'))).svg).toContain(`${NOTO} font-weight="400"`);
  });

  it('ignores a font attribute, as renderers do, and drops it', () => {
    const once = ok(load(svgOf('<text id="t" font="bold 40px serif">A</text>'))).svg;
    expect(once).toContain(`<text id="a1-t" ${NOTO} font-weight="400">A</text>`);
    expect(ok(load(once)).svg).toBe(once);
  });

  it('says the look changed when small caps, features, size adjustment or a width are dropped', () => {
    const notices = (body: string) => sanitizeNotices(ok(load(svgOf(body))).report);
    expect(notices('<g font-variant="small-caps"><text font-family="Noto Sans">Fold</text></g>')).toEqual(['text-font']);
    expect(notices(`<text style="font: small-caps 12px 'Noto Sans'">Fold</text>`)).toEqual(['text-font']);
    expect(notices(`<text font-family="Noto Sans" style="font-feature-settings:'smcp'">Fold</text>`)).toEqual([
      'text-font',
    ]);
    expect(notices('<text font-family="Noto Sans" font-stretch="condensed">Fold</text>')).toEqual(['text-font']);
    // Their defaults change nothing; neither does a variant set back to normal under one.
    expect(notices('<text font-family="Noto Sans" font-variant="normal" font-size-adjust="none">Fold</text>')).toEqual([]);
    expect(
      notices('<g font-variant="small-caps"><text font-family="Noto Sans" font-variant="normal">Fold</text></g>')
    ).toEqual([]);
  });

  it('refuses text split into more runs than a stored picture could hold, before building them', () => {
    const result = load(svgOf(`<text>${'a中'.repeat(16_000)}</text>`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/runs/);
  });

  it('leaves a run of only spaces to the text, so a second pass finds the same tree', () => {
    for (const body of [
      '<text x="10" y="20"><tspan>折る</tspan> fold</text>',
      '<text><tspan>Valley fold</tspan><tspan font-weight="bold"> 谷折り</tspan></text>',
    ]) {
      const once = ok(load(svgOf(body))).svg;
      expect(once, body).not.toMatch(/<tspan[^>]*> <\/tspan>/);
      expect(ok(load(once)).svg, body).toBe(once);
    }
  });

  it('writes the same bytes a second time', () => {
    const once = ok(
      load(
        svgOf(
          `<g style="font:bold 9px Arial"><text x="1 2 3" y="4">Fold <tspan font-weight="300">折る</tspan>` +
            `<tspan> </tspan>&amp; 접기</text><text xml:space="preserve">  </text></g>`
        )
      )
    ).svg;
    expect(ok(load(once)).svg).toBe(once);
  });
});
