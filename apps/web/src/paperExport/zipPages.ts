/**
 * Several painted pages as one ZIP, for an export of every step at once.
 *
 * `fflate` is imported with this module rather than on demand. Fetched the
 * first time someone exported every step, it saved about 4 KB (brotli) until
 * then, and cost an export that could not work: a fetch in the middle of a
 * session can fail with the project open, on a connection that drops or in a
 * tab older than the deploys that carry its build forward
 * (`scripts/carry-forward-assets.mjs`), and a browser keeps a module that
 * failed to load as failed for the page's life. Every later press of Export
 * failed the same way, and the only remedy was a reload, which on the web
 * closes the project being exported (ORI-STUDIO-X). Imported here, the writer
 * arrives with the code that calls it.
 */
import { zipSync } from 'fflate';

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

/** The entries as one archive, in the order given. */
export function zipPages(entries: readonly ZipEntry[]): Uint8Array {
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const entry of entries) files[entry.name] = [entry.data, { level: entry.compress ? 6 : 0 }];
  return zipSync(files);
}
