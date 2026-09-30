import { readNumber, storageKey, STORAGE_KEYS, writeNumber } from './storage';

/** Long enough to cover the reload itself, short enough not to refuse a later deploy's. */
const RELOAD_WINDOW_MS = 60_000;

/**
 * The ways engines word "that chunk is not there". Pages answers a deleted chunk with
 * `index.html` at 200, so WebKit fails it on MIME type rather than on status.
 */
const CHUNK_LOAD_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|is not a valid JavaScript MIME type|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_FAILURE.test(error.message);
}

interface ReloadHost {
  location: { reload(): void };
}

/**
 * `import()` a lazy chunk, reloading the page once if the chunk is gone.
 *
 * A deploy deletes the previous build's content-hashed chunks, so a tab opened before it
 * asks for files that no longer exist. A reload fetches the new shell, which names the new
 * chunks. Anything that is not a missing chunk rethrows, and so does a second miss inside
 * the window: a chunk still missing after a reload is not a stale tab, and reloading again
 * would loop.
 */
export async function importOrReload<T>(
  load: () => Promise<T>,
  host: ReloadHost = window
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;
    const key = storageKey(STORAGE_KEYS.chunkReload);
    if (Date.now() - readNumber(key, 0) < RELOAD_WINDOW_MS) throw error;
    writeNumber(key, Date.now());
    host.location.reload();
    // The page is going away; nothing should act on a result.
    return new Promise<T>(() => undefined);
  }
}
