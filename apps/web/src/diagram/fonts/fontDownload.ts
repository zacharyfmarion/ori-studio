/**
 * A file of the Diagram's fonts — a font, the CJK manifest, the subsetter's
 * wasm — downloaded from the app's origin or the site (ORI-STUDIO-16).
 *
 * A download the network refuses — offline, a connection that drops, a
 * laptop that has just woken — is tried again twice, a moment apart, and
 * then thrown as a {@link DiagramFontDownloadError}, which the Pages view and
 * the export say plainly, with a way to try again, and never report. A
 * response that is not the file (`refuse`: an error status, a page in its
 * place) is not the network's doing: it stays an error, and is not retried.
 */
import { DiagramFontDownloadError } from './diagramFonts';

/** The waits before the second try and the third, ms. */
export const FONT_DOWNLOAD_RETRY_MS: readonly number[] = [500, 1500];

export interface FontDownloadOptions {
  /** Throws for a response that is not the file. */
  refuse?: (response: Response) => void;
  retryMs?: readonly number[];
  fetcher?: (url: string) => Promise<Response>;
  wait?: (ms: number) => Promise<void>;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The bytes at `url`, once the network gives them. */
export async function downloadFontAsset(url: string, options: FontDownloadOptions = {}): Promise<ArrayBuffer> {
  const { refuse, retryMs = FONT_DOWNLOAD_RETRY_MS, fetcher = (at: string) => fetch(at), wait = pause } = options;
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url);
    } catch (cause) {
      await retryOrThrow(url, attempt, retryMs, wait, cause);
      continue;
    }
    refuse?.(response);
    try {
      return await response.arrayBuffer();
    } catch (cause) {
      // The connection dropped while the body came.
      await retryOrThrow(url, attempt, retryMs, wait, cause);
    }
  }
}

async function retryOrThrow(
  url: string,
  attempt: number,
  retryMs: readonly number[],
  wait: (ms: number) => Promise<void>,
  cause: unknown
): Promise<void> {
  const delay = retryMs[attempt];
  if (delay === undefined) throw new DiagramFontDownloadError(`${url} could not be downloaded`, { cause });
  await wait(delay);
}
