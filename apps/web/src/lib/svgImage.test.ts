import { describe, expect, it } from 'vitest';
import {
  parseSvgLength,
  parseSvgViewBox,
  prepareSvgForRaster,
  svgIntrinsicSize,
  svgRasterSize,
} from './svgImage';

// jsdom cannot rasterise, so what is tested here is everything before the
// `<img>`: reading the size, and the markup the image is loaded from.

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
