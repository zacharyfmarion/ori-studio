import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileService } from '../platform/fileService';
import { saveSimulatorView } from './simulatorViewExport';

// The rasterizer needs a browser; here it just has to be seen with the size it
// was asked for.
const { svgToPng } = vi.hoisted(() => ({
  svgToPng: vi.fn(async (_svg: string, _width: number, _height: number) => new Uint8Array(3)),
}));
vi.mock('../lib/creaseExport', () => ({ svgToPng }));

/** A page the worker would hand back: the frame in CSS pixels. */
const page = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"></svg>',
  width: 640,
  height: 480,
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

  it('rasterizes the PNG at twice the page, which is twice the CSS-pixel frame', async () => {
    // The page is the frame in CSS pixels on every display, so the PNG is the
    // same size from a Retina screen as from a standard one — 2x the page, not
    // 2x the drawing buffer, which on a Retina display would have made it 4x.
    const { service, saveBinaryFile } = fileService();
    await expect(
      saveSimulatorView({ page, format: 'png', name: 'crane', fileService: service })
    ).resolves.toBe('view.png');
    expect(svgToPng).toHaveBeenCalledWith(page.svg, 1280, 960);
    expect(saveBinaryFile).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'crane.png', mimeType: 'image/png' })
    );
  });

  it('answers null when the save dialog is dismissed', async () => {
    const { service, saveBinaryFile } = fileService();
    saveBinaryFile.mockResolvedValueOnce(null as never);
    await expect(
      saveSimulatorView({ page, format: 'png', name: 'crane', fileService: service })
    ).resolves.toBeNull();
  });
});
