import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSvgImage } from '../../lib/svgImage';
import { importImageFile } from './cpImageImport';

// jsdom neither decodes nor draws, so both decoders and the canvas are stubbed.
// What is under test is the routing: which decoder a file reaches, what size
// and encoding come out, and that the bitmap is released.
vi.mock('../../lib/svgImage', () => ({ loadSvgImage: vi.fn() }));

const drawImage = vi.fn();
const close = vi.fn();
const createImageBitmap = vi.fn();

beforeEach(() => {
  drawImage.mockReset();
  close.mockReset();
  createImageBitmap.mockReset();
  vi.mocked(loadSvgImage).mockReset();
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ width, height }),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
    (type?: string) => `data:${type ?? 'image/png'};base64,`
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bitmap(width: number, height: number) {
  return { width, height, close };
}

describe('importImageFile', () => {
  it('draws an SVG through the SVG loader and keeps it as PNG', async () => {
    const image = new Image();
    vi.mocked(loadSvgImage).mockResolvedValue({ image, width: 2048, height: 1536 });
    const file = new File(['<svg/>'], 'pattern.svg', { type: 'image/svg+xml' });

    const source = await importImageFile(file);

    expect(loadSvgImage).toHaveBeenCalledWith(file, 2048);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 2048, 1536);
    expect(source).toMatchObject({ naturalWidth: 2048, naturalHeight: 1536 });
    expect(source.src.startsWith('data:image/png')).toBe(true);
    expect(source.preview).toMatchObject({ width: 512, height: 384 });
  });

  it('takes an untyped .svg down the same path', async () => {
    vi.mocked(loadSvgImage).mockResolvedValue({ image: new Image(), width: 2048, height: 2048 });
    await importImageFile(new File(['<svg/>'], 'pattern.svg'));
    expect(loadSvgImage).toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('decodes a raster named .svg as the raster its type says it is', async () => {
    createImageBitmap.mockResolvedValue(bitmap(40, 30));
    const source = await importImageFile(new File(['png'], 'diagram.svg', { type: 'image/png' }));
    expect(loadSvgImage).not.toHaveBeenCalled();
    expect(source).toMatchObject({ naturalWidth: 40, naturalHeight: 30 });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('caps a large bitmap and re-encodes an opaque one as JPEG', async () => {
    createImageBitmap.mockResolvedValue(bitmap(4096, 1024));
    const source = await importImageFile(new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' }));
    expect(source).toMatchObject({ naturalWidth: 2048, naturalHeight: 512 });
    expect(source.src.startsWith('data:image/jpeg')).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('passes on a failure to render an SVG', async () => {
    vi.mocked(loadSvgImage).mockRejectedValue(new Error('The SVG could not be rendered'));
    await expect(
      importImageFile(new File(['<svg/>'], 'broken.svg', { type: 'image/svg+xml' }))
    ).rejects.toThrow('The SVG could not be rendered');
  });
});
