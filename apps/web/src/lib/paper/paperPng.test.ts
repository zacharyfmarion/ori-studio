import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_PNG_DPI, paperPngSize, paperSvgToPng } from './paperPng';

const { svgToPng } = vi.hoisted(() => ({
  svgToPng: vi.fn(async (_svg: string, _width: number, _height: number) => new Uint8Array(3)),
}));
vi.mock('../svgToPng', () => ({ svgToPng }));

const PAGE = { svg: '<svg/>', widthPt: 72, heightPt: 144 };

describe('paperSvgToPng', () => {
  beforeEach(() => {
    svgToPng.mockClear();
  });

  it('rasterises at pt / 72 × dpi, 192 dpi by default so the PNG is twice the CSS page', () => {
    expect(DEFAULT_PAPER_PNG_DPI).toBe(192);
    expect(paperPngSize(PAGE, DEFAULT_PAPER_PNG_DPI)).toEqual({ width: 192, height: 384 });
    // 72 pt is 96 CSS px; twice that is 192.
    expect(paperPngSize(PAGE, 96)).toEqual({ width: 96, height: 192 });
  });

  it('rounds to whole pixels and never below one', () => {
    expect(paperPngSize({ widthPt: 10, heightPt: 0.1 }, 300)).toEqual({ width: 42, height: 1 });
  });

  it('hands the page and its pixel size to the rasteriser', async () => {
    const bytes = await paperSvgToPng(PAGE, 300);
    expect(bytes).toHaveLength(3);
    expect(svgToPng).toHaveBeenCalledWith(PAGE.svg, 300, 600);
    await paperSvgToPng(PAGE);
    expect(svgToPng).toHaveBeenLastCalledWith(PAGE.svg, 192, 384);
  });
});
