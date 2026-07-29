import { ensureExtension } from './fileService';

/**
 * A document title as a safe suggested filename.
 *
 * One rule for every exporter: two of them producing differently-mangled names
 * from the same title is the kind of inconsistency nobody reports but everybody
 * notices.
 */
export function exportFilename(title: string, extension: string): string {
  const base = title.trim() || 'Untitled';
  const safe = base.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'Untitled';
  return ensureExtension(safe, extension);
}
