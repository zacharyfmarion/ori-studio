// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { DiagramFontDownloadError } from './diagramFonts';
import { downloadFontAsset, FONT_DOWNLOAD_RETRY_MS } from './fontDownload';

const FONT = new Uint8Array([0, 1, 0, 0]);
const refused = () => Promise.reject(new TypeError('Failed to fetch'));
const served = () => Promise.resolve(new Response(FONT, { headers: { 'content-type': 'font/ttf' } }));

describe('downloadFontAsset (ORI-STUDIO-16)', () => {
  it('tries a download the network refused again, a moment later, and has the file', async () => {
    const fetcher = vi.fn().mockImplementationOnce(refused).mockImplementationOnce(refused).mockImplementation(served);
    const wait = vi.fn(async (_ms: number) => {});
    const bytes = await downloadFontAsset('/assets/NotoSans-Regular.ttf', { fetcher, wait });
    expect(new Uint8Array(bytes)).toEqual(FONT);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([...FONT_DOWNLOAD_RETRY_MS]);
  });

  it('says a download the network kept refusing is one, so it is not reported as a defect', async () => {
    const fetcher = vi.fn(refused);
    const failure = downloadFontAsset('/assets/NotoSans-Regular.ttf', { fetcher, wait: async () => {} });
    await expect(failure).rejects.toBeInstanceOf(DiagramFontDownloadError);
    await expect(failure).rejects.toMatchObject({ cause: expect.any(TypeError) });
    expect(fetcher).toHaveBeenCalledTimes(FONT_DOWNLOAD_RETRY_MS.length + 1);
  });

  it('tries again when the connection drops while the file comes', async () => {
    const dropped = new Response(FONT);
    vi.spyOn(dropped, 'arrayBuffer').mockRejectedValue(new TypeError('network error'));
    const fetcher = vi.fn().mockResolvedValueOnce(dropped).mockImplementation(served);
    const bytes = await downloadFontAsset('/fonts/diagram/manifest.json', { fetcher, wait: async () => {} });
    expect(new Uint8Array(bytes)).toEqual(FONT);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('leaves a response that is not the file an error of its own, tried once', async () => {
    const fetcher = vi.fn(async () => new Response('missing', { status: 404 }));
    const refuse = (response: Response) => {
      if (!response.ok) throw new Error(`font: ${response.status}`);
    };
    const failure = downloadFontAsset('/fonts/diagram/NotoSansJP-Regular.full.0123456789ab.ttf', { fetcher, refuse, wait: async () => {} });
    await expect(failure).rejects.toThrow('font: 404');
    await expect(failure).rejects.not.toBeInstanceOf(DiagramFontDownloadError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
