/**
 * Reading the crease pattern the server inlined into the page.
 *
 * `functions/s/[[shareId]].ts` already reads the record to write the OpenGraph tags, so
 * it writes the payload into the HTML too. That one decision removes the second KV read
 * per click *and* the loading state: the pattern is present at first paint, so there is
 * no fetch to wait on and no blank-canvas flash to paper over.
 *
 * Read once at module scope and cached. The script element is inert data — leaving it in
 * the DOM would let a later reader see a payload that no longer reflects what the user
 * has since edited.
 */

export const SHARED_CP_SCRIPT_ID = 'shared-cp';

export interface InlinedSharedCp {
  id: string;
  payload: string;
  title: string;
  author: string | null;
  creaseCount: number;
}

function isInlinedSharedCp(value: unknown): value is InlinedSharedCp {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string' && typeof candidate.payload === 'string';
}

function read(): InlinedSharedCp | null {
  if (typeof document === 'undefined') return null;
  const element = document.getElementById(SHARED_CP_SCRIPT_ID);
  if (!element) return null;
  // Consume it: the payload describes the document as shared, not as it stands after any
  // edit, so nothing should be able to read it a second time.
  element.remove();
  try {
    const parsed: unknown = JSON.parse(element.textContent ?? '');
    return isInlinedSharedCp(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let cached: InlinedSharedCp | null | undefined;

/** The inlined crease pattern for this page load, or null if this is not a share link. */
export function inlinedSharedCp(): InlinedSharedCp | null {
  if (cached === undefined) cached = read();
  return cached;
}

/** Test seam: forget what was read so a fresh document can be parsed. */
export function resetInlinedSharedCp(): void {
  cached = undefined;
}
