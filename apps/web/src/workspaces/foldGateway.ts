import { lazyModule } from '../lib/lazyModule';
import type * as FoldEntry from './foldEntry';

/**
 * The one door into Fold's code.
 *
 * The workspace chunk every workspace downloads holds what Fold must have without being
 * opened: its sequences' data shape and edits (the store's Fold slice), the file reader and
 * writer that carry them through Open and Save, the capabilities, menus and keys. Everything
 * else — the panes, the canvas and its tools, the session that replays a sequence on the fold
 * engine, the pictures Diagram captures from it — loads through here the first time
 * something needs it: Fold opening, a Fold menu verb, the Diagram's From Fold… browser, or a
 * diagram with a step linked to Fold. As the workspace is (`routing/workspaceGateway.ts`), it
 * is one `import()` for all of it, so it is one chunk rather than a scatter of them.
 *
 * Code that runs before it has loaded reads `loadedFold()` and does without (an unheld
 * session replays nothing, so there is nothing to read from it yet), or awaits `loadFold()`.
 */

export type Fold = typeof FoldEntry;

const fold = lazyModule<Fold>(() => import('./foldEntry'));

/** Load Fold's code, once, whoever asks; a failed load is not remembered. */
export function loadFold(): Promise<Fold> {
  return fold.load();
}

/** Fold's code if it has loaded, without asking for it. */
export function loadedFold(): Fold | null {
  return fold.loaded();
}

/** Fold's code once it has loaded, for a render; never asks for it. */
export function useLoadedFold(): Fold | null {
  return fold.useLoaded();
}

/** Ask for Fold's code ahead of a use, with nothing to report if it fails: the use that follows does. */
export function prefetchFold(): void {
  void loadFold().catch(() => undefined);
}

export function resetFoldForTest(): void {
  fold.resetForTest();
}
