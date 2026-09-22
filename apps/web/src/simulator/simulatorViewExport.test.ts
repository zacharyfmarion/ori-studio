import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileService } from '../platform/fileService';
import { saveSimulatorView } from './simulatorViewExport';

// The rasterizer needs a browser; here it just has to be seen with the size it
// was asked for.
const { svgToPng } = vi.hoisted(() => ({
  svgToPng: vi.fn(async (_svg: string, _width: number, _height: number) => new Uint8Array(3)),
}));
vi.mock('../lib/svgToPng', () => ({ svgToPng }));

/** A page the worker would hand back: painted in points. */
const page = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="480pt" height="360pt"></svg>',
  widthPt: 480,
  heightPt: 360,
};

function fileService() {
  const saveTextFile = vi.fn(async () => ({ name: 'view.svg', path: null }));
  const saveBinaryFile = vi.fn(async () => ({ name: 'view.png', path: null }));
  return {
    service: { saveTextFile, saveBinaryFile } as unknown as FileService,
    saveTextFile,
    saveBinaryFile,
  };
}

describe('saveSimulatorView', () => {
  beforeEach(() => {
    svgToPng.mockClear();
  });

  it('writes the SVG page as it came from the worker', async () => {
    const { service, saveTextFile } = fileService();
    await expect(
      saveSimulatorView({ page, format: 'svg', name: 'crane', fileService: service })
    ).resolves.toBe('view.svg');
    expect(saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ contents: page.svg, suggestedName: 'crane.svg' })
    );
    expect(svgToPng).not.toHaveBeenCalled();
  });

  // Re-pinned: the PNG used to be twice the CSS-pixel page; the page is in
  // points now, so the pixel size follows from the density alone.
  it('rasterizes the PNG at the density asked for, from the page in points', async () => {
    const { service, saveBinaryFile } = fileService();
    await expect(
      saveSimulatorView({ page, format: 'png', pngDpi: 300, name: 'crane', fileService: service })
    ).resolves.toBe('view.png');
    // 480 pt is 6⅔ in, 360 pt is 5 in.
    expect(svgToPng).toHaveBeenCalledWith(page.svg, 2000, 1500);
    expect(saveBinaryFile).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'crane.png', mimeType: 'image/png' })
    );
  });

  it('rasterizes at the painter’s default density when none is given', async () => {
    const { service } = fileService();
    await saveSimulatorView({ page, format: 'png', name: 'crane', fileService: service });
    // 192 dpi: twice the CSS page, which is 96 dpi.
    expect(svgToPng).toHaveBeenCalledWith(page.svg, 1280, 960);
  });

  it('answers null when the save dialog is dismissed', async () => {
    const { service, saveBinaryFile } = fileService();
    saveBinaryFile.mockResolvedValueOnce(null as never);
    await expect(
      saveSimulatorView({ page, format: 'png', name: 'crane', fileService: service })
    ).resolves.toBeNull();
  });
});
