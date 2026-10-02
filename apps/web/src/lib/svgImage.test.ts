import { describe, expect, it } from 'vitest';
import {
  decodeSvgText,
  parseSvgLength,
  parseSvgViewBox,
  prepareSvgForRaster,
  svgIntrinsicSize,
  svgRasterSize,
  svgTextEncoding,
} from './svgImage';

// jsdom cannot rasterise, so what is tested here is everything before the
// `<img>`: reading the size, and the markup the image is loaded from.

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

describe('svgTextEncoding', () => {
  it('follows a byte-order mark first', () => {
    expect(svgTextEncoding(Uint8Array.of(0xff, 0xfe, 0x3c, 0x00))).toBe('utf-16le');
    expect(svgTextEncoding(Uint8Array.of(0xfe, 0xff, 0x00, 0x3c))).toBe('utf-16be');
    expect(
      svgTextEncoding(Uint8Array.of(0xef, 0xbb, 0xbf, ...ascii('<?xml version="1.0" encoding="ISO-8859-1"?>')))
    ).toBe('utf-8');
  });

  it('then the XML declaration', () => {
    expect(svgTextEncoding(ascii('<?xml version="1.0" encoding="ISO-8859-1"?><svg/>'))).toBe(
      'windows-1252'
    );
    expect(svgTextEncoding(ascii("<?xml version='1.0' encoding='UTF-8' standalone='no'?>"))).toBe(
      'utf-8'
    );
  });

  it('falls back to UTF-8 for no declaration, an unknown label, or a UTF-16 claim without a BOM', () => {
    expect(svgTextEncoding(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('utf-8');
    expect(svgTextEncoding(ascii('<?xml version="1.0" encoding="x-not-real"?>'))).toBe('utf-8');
    expect(svgTextEncoding(ascii('<?xml version="1.0" encoding="UTF-16"?>'))).toBe('utf-8');
    // Not a declaration unless it opens the file.
    expect(svgTextEncoding(ascii(' <?xml version="1.0" encoding="ISO-8859-1"?>'))).toBe('utf-8');
  });
});

describe('decodeSvgText', () => {
  it('reads a Latin-1 file as Latin-1', () => {
    const bytes = Uint8Array.of(...ascii('<?xml version="1.0" encoding="ISO-8859-1"?><text>Caf'), 0xe9);
    expect(decodeSvgText(bytes).endsWith('Café')).toBe(true);
  });

  it('reads UTF-16 by its BOM, dropping the mark', () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg"><text>折り紙</text></svg>';
    const utf16le = new Uint8Array(2 + text.length * 2);
    utf16le.set([0xff, 0xfe]);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      utf16le[2 + index * 2] = code & 0xff;
      utf16le[3 + index * 2] = code >> 8;
    }
    expect(decodeSvgText(utf16le)).toBe(text);
  });

  it('reads UTF-8 by default', () => {
    expect(decodeSvgText(new TextEncoder().encode('<text>折り紙</text>'))).toBe('<text>折り紙</text>');
  });
});

describe('parseSvgLength', () => {
  it('reads unitless and pixel lengths as CSS pixels', () => {
    expect(parseSvgLength('120')).toBe(120);
    expect(parseSvgLength('120px')).toBe(120);
    expect(parseSvgLength(' 12.5 ')).toBe(12.5);
    expect(parseSvgLength('1e2')).toBe(100);
  });

  it('converts the absolute units Inkscape and print tools write', () => {
    expect(parseSvgLength('210mm')).toBeCloseTo((210 * 96) / 25.4, 9);
    expect(parseSvgLength('1in')).toBe(96);
    expect(parseSvgLength('2.54cm')).toBeCloseTo(96, 9);
    expect(parseSvgLength('72pt')).toBeCloseTo(96, 9);
    expect(parseSvgLength('6pc')).toBe(96);
    expect(parseSvgLength('101.6Q')).toBeCloseTo(96, 9);
    expect(parseSvgLength('10MM')).toBeCloseTo((10 * 96) / 25.4, 9);
  });

  it('treats sizes an image cannot resolve as absent', () => {
    expect(parseSvgLength(null)).toBeNull();
    expect(parseSvgLength('')).toBeNull();
    expect(parseSvgLength('100%')).toBeNull();
    expect(parseSvgLength('2em')).toBeNull();
    expect(parseSvgLength('auto')).toBeNull();
    expect(parseSvgLength('0')).toBeNull();
    expect(parseSvgLength('-5')).toBeNull();
    expect(parseSvgLength('10 mm')).toBeNull();
  });
});

describe('parseSvgViewBox', () => {
  it('accepts space- and comma-separated boxes', () => {
    expect(parseSvgViewBox('0 0 210 297')).toEqual({ x: 0, y: 0, width: 210, height: 297 });
    expect(parseSvgViewBox('-10,-5, 20 ,10')).toEqual({ x: -10, y: -5, width: 20, height: 10 });
  });

  it('rejects boxes an engine would ignore', () => {
    expect(parseSvgViewBox(null)).toBeNull();
    expect(parseSvgViewBox('0 0 100')).toBeNull();
    expect(parseSvgViewBox('0 0 100 0')).toBeNull();
    expect(parseSvgViewBox('0 0 -1 10')).toBeNull();
    expect(parseSvgViewBox('0 0 a 10')).toBeNull();
  });
});

describe('svgIntrinsicSize', () => {
  const box = { x: 0, y: 0, width: 200, height: 100 };

  it('takes explicit width and height over the viewBox', () => {
    expect(svgIntrinsicSize(30, 40, box)).toEqual({ width: 30, height: 40 });
  });

  it('completes one explicit side from the viewBox aspect', () => {
    expect(svgIntrinsicSize(50, null, box)).toEqual({ width: 50, height: 25 });
    expect(svgIntrinsicSize(null, 50, box)).toEqual({ width: 100, height: 50 });
  });

  // The case `<img>` gets wrong: no width/height, so it reports 300×150 for a
  // square drawing.
  it('takes the viewBox extent when no side is given', () => {
    expect(svgIntrinsicSize(null, null, { x: 0, y: 0, width: 400, height: 400 })).toEqual({
      width: 400,
      height: 400,
    });
  });

  it('falls back to the default object size with nothing to go on', () => {
    expect(svgIntrinsicSize(null, null, null)).toEqual({ width: 300, height: 150 });
    expect(svgIntrinsicSize(80, null, null)).toEqual({ width: 80, height: 150 });
  });
});

describe('svgRasterSize', () => {
  it('scales the longer side to the cap, up or down', () => {
    expect(svgRasterSize({ width: 24, height: 12 }, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(svgRasterSize({ width: 5000, height: 10000 }, 2048)).toEqual({
      width: 1024,
      height: 2048,
    });
  });

  it('never rounds a side to zero', () => {
    expect(svgRasterSize({ width: 10000, height: 1 }, 2048)).toEqual({ width: 2048, height: 1 });
  });
});

function rootOf(markup: string): Element {
  return new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
}

describe('prepareSvgForRaster', () => {
  // The header Inkscape 1.x writes for a new A4 document.
  const inkscape = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg
   width="210mm"
   height="297mm"
   viewBox="0 0 210 297"
   version="1.1"
   id="svg1"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:svg="http://www.w3.org/2000/svg">
  <sodipodi:namedview id="namedview1" inkscape:document-units="mm" />
  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1">
    <path d="M 0,0 210,297" style="stroke:#000000;stroke-width:0.5" id="path1" />
  </g>
</svg>`;

  it('sizes an Inkscape page to the cap in pixels, keeping its viewBox', () => {
    const prepared = prepareSvgForRaster(inkscape, 2048);
    expect(prepared).toMatchObject({ width: 1448, height: 2048 });
    const root = rootOf(prepared.markup);
    expect(root.getAttribute('width')).toBe('1448');
    expect(root.getAttribute('height')).toBe('2048');
    expect(root.getAttribute('viewBox')).toBe('0 0 210 297');
    // The drawing itself is carried through untouched.
    expect(root.querySelector('path')?.getAttribute('d')).toBe('M 0,0 210,297');
  });

  it('gives a viewBox-only file a real size', () => {
    const prepared = prepareSvgForRaster(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2"><circle r="1"/></svg>',
      2048
    );
    expect(prepared).toMatchObject({ width: 2048, height: 2048 });
    const root = rootOf(prepared.markup);
    expect(root.getAttribute('width')).toBe('2048');
    expect(root.getAttribute('viewBox')).toBe('-1 -1 2 2');
  });

  // Without a viewBox, a larger width/height only widens the canvas around a
  // drawing that stays the same size; the synthesized box makes it scale.
  it('adds the viewBox a file without one implies, in its own user units', () => {
    const prepared = prepareSvgForRaster(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="0.5in"><rect width="96" height="48"/></svg>',
      2048
    );
    expect(prepared).toMatchObject({ width: 2048, height: 1024 });
    expect(rootOf(prepared.markup).getAttribute('viewBox')).toBe('0 0 96 48');
  });

  // WebKit lets the root's CSS override its width/height attributes, so the
  // size must also win the cascade; Mermaid writes `max-width` on the root.
  it('pins the size against CSS on the root', () => {
    const prepared = prepareSvgForRaster(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 400 300" style="max-width: 400px;"><style>svg { width: 10px }</style></svg>',
      2048
    );
    const style = rootOf(prepared.markup).getAttribute('style') ?? '';
    // The file's own declarations are kept, and come first so they lose.
    expect(style.startsWith('max-width: 400px;')).toBe(true);
    for (const declaration of [
      'width:2048px !important',
      'height:1536px !important',
      'max-width:none !important',
      'max-height:none !important',
      'min-width:0 !important',
      'min-height:0 !important',
    ]) {
      expect(style).toContain(declaration);
    }
  });

  it('adds the sizing style to a root that has none', () => {
    const prepared = prepareSvgForRaster(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
      2048
    );
    expect(rootOf(prepared.markup).getAttribute('style')).toMatch(/^width:2048px !important;/);
  });

  // The declaration would name the file's encoding, and the markup is now UTF-8.
  it('serializes the root alone, without the XML declaration', () => {
    const prepared = prepareSvgForRaster(
      '<?xml version="1.0" encoding="ISO-8859-1"?>\n<!-- comment -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>Café</text></svg>',
      2048
    );
    expect(prepared.markup.startsWith('<svg')).toBe(true);
    expect(prepared.markup).toContain('Café');
  });

  // Illustrator declares its namespaces through internal entities; the parse
  // expands them, so dropping the doctype loses nothing.
  it('keeps what internal entities expanded to', () => {
    const prepared = prepareSvgForRaster(
      `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
  <!ENTITY ns_svg "http://www.w3.org/2000/svg">
  <!ENTITY st0 "fill:#2a6;">
]>
<svg xmlns="&ns_svg;" width="400px" height="300px" viewBox="0 0 400 300"><rect style="&st0;" width="400" height="300"/></svg>`,
      2048
    );
    const root = rootOf(prepared.markup);
    expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(root.querySelector('rect')?.getAttribute('style')).toBe('fill:#2a6;');
  });

  it('rejects text that is not an SVG document', () => {
    expect(() => prepareSvgForRaster('not xml at all', 2048)).toThrow();
    expect(() => prepareSvgForRaster('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', 2048)).toThrow();
    // Well-formed XML, but not SVG: an HTML page saved with the wrong extension.
    expect(() =>
      prepareSvgForRaster('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>', 2048)
    ).toThrow();
    // An `svg` root outside the SVG namespace is not one an engine would draw.
    expect(() => prepareSvgForRaster('<svg viewBox="0 0 1 1"/>', 2048)).toThrow();
  });
});
