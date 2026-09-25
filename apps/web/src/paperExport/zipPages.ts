/**
 * Several painted pages as one ZIP, for an export of every step at once.
 *
 * `fflate` is loaded on demand: nothing else in the app writes a ZIP, so it
 * costs nothing until someone exports all the steps. The import is guarded —
 * after a deploy an old tab's chunk is gone and a bare `await import()` becomes
 * an unhandled rejection with no stack (as `StartFigure` learned) — and a failed
 * load comes back as an ordinary error the dialog can put words to.
 */

export interface ZipEntry {
  /** The file's name inside the archive. */
  name: string;
  data: Uint8Array;
  /**
   * Deflate it. An SVG is text and shrinks several times over; a PNG is
   * compressed already, and deflating it again only costs time.
   */
  compress: boolean;
}

/** A load that failed, so the dialog can say the export could not start rather than show a raw module error. */
export class ZipUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The ZIP writer could not be loaded. Reload Ori Studio and try again.');
    this.name = 'ZipUnavailableError';
    this.cause = cause;
  }
}

type Fflate = typeof import('fflate');

/** `fflate`, or a {@link ZipUnavailableError} when its chunk cannot be fetched. */
export async function loadFflate(
  importer: () => Promise<Fflate> = () => import('fflate')
): Promise<Fflate> {
  try {
    return await importer();
  } catch (cause) {
    throw new ZipUnavailableError(cause);
  }
}

/** The entries as one archive, in the order given. */
export async function zipPages(
  entries: readonly ZipEntry[],
  load: () => Promise<Fflate> = loadFflate
): Promise<Uint8Array> {
  const { zipSync } = await load();
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const entry of entries) files[entry.name] = [entry.data, { level: entry.compress ? 6 : 0 }];
  return zipSync(files);
}
