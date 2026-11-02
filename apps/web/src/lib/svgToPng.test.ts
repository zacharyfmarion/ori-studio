import { describe, expect, it } from 'vitest';
import { svgPageOversample } from './svgToPng';

const VECTORS = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>';
const BITMAP = '<svg xmlns="http://www.w3.org/2000/svg"><image x="0" y="0" width="1" height="1" href="data:image/png;base64,"/></svg>';
const PAGE = { width: 1814, height: 1024 };

describe('svgPageOversample', () => {
  it('draws a page of vectors alone at its size, as it always was', () => {
    expect(svgPageOversample(VECTORS, PAGE, PAGE)).toBe(1);
  });

  it('draws a page that embeds a bitmap at twice its size, so the bitmap lands near 1:1', () => {
    expect(svgPageOversample(BITMAP, PAGE, PAGE)).toBe(2);
  });

  it('draws a page shrunk onto a card at twice its own size, not twice the card’s', () => {
    expect(svgPageOversample(BITMAP, { width: 907, height: 512 }, PAGE)).toBe(4);
  });

  it('settles for less past an iPhone’s canvas, down to the page’s own size', () => {
    // Twice the card's page is past 4096² px; twice the card is not.
    expect(svgPageOversample(BITMAP, { width: 1000, height: 1000 }, { width: 2100, height: 2100 })).toBe(2);
    expect(svgPageOversample(BITMAP, { width: 3000, height: 2000 }, { width: 3000, height: 2000 })).toBe(1);
    // A dense export: at 600 dpi the bitmap is enlarged, not shrunk, so nothing is lost.
    expect(svgPageOversample(BITMAP, { width: 5000, height: 5000 }, { width: 5000, height: 5000 })).toBe(1);
  });
});
