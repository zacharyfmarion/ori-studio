/**
 * Import CP of several files at once (`implementation-plans/fold-multi-file-import.md`):
 * the crease patterns of a drop or a pick, ordered by the numbers in their
 * names (`foldImportFileOrder`), imported one after another through the
 * one-request flow (`foldImportFlow`). Each becomes a step after the one
 * before, since a commit puts the cursor on its step.
 *
 * - **Each file as it would import alone.** One order commits at once; several
 *   ask, in the Layer order dialog or the canvas chooser, and the queue waits.
 *   The next file opens once the flow reports this one's step committed.
 * - **A refusal pauses it.** The flow says why, and its own fix (Search
 *   longer) carries on with this file; `skip` goes on with the next.
 * - **Anything else ends it**: a choice let go (Cancel), a reset, a request
 *   the queue did not open, a new batch, or the dialog closing (`dispose`).
 *   Steps already committed stay.
 * - **A file is read when its turn comes**, so a batch is never all in memory.
 * - **One undo step.** The files of a batch are opened in one batch number
 *   (`FoldImportOpenOptions.batch`), so their steps undo together.
 *
 * Pure: no React, no store, no wasm. The flow is handed in.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PickedFile } from '../../platform/fileService';
import { foldImportFileOrder, foldImportFileRequest } from './foldImportFiles';
import type { FoldImportFlow, FoldImportFlowState, FoldImportRequest } from './foldImportFlow';

/** How the files arrived: dropped, on the workspace or the dialog, or picked in the dialog. */
export type FoldImportVia = 'drop' | 'pick';

/** Where a batch is: file `index` of `total`, named `name`, with `imported` steps committed before it. */
interface FoldImportQueueAt {
  readonly index: number;
  readonly total: number;
  readonly name: string;
  readonly imported: number;
}

export type FoldImportQueueState =
  | { readonly status: 'idle' }
  /** The file is being read or imported, a choice of its layer order included. */
  | ({ readonly status: 'running' } & FoldImportQueueAt)
  /** The file was refused, or failed: `skip` goes on with the next. */
  | ({ readonly status: 'paused' } & FoldImportQueueAt)
  /** Every file was imported or skipped. */
  | { readonly status: 'finished'; readonly total: number; readonly imported: number };

/** How a batch of several files ended, as the analytics event counts it. */
export interface FoldImportBatchEnd {
  readonly files: number;
  readonly imported: number;
  /** `finished`: every file imported or skipped; `stopped`: ended before its last file landed. */
  readonly outcome: 'finished' | 'stopped';
  readonly via: FoldImportVia;
}

export interface FoldImportQueueOptions {
  flow: FoldImportFlow;
  /** A file as the flow imports it: `foldImportFileRequest` unless a test says otherwise. */
  read?: (file: PickedFile) => Promise<FoldImportRequest>;
  /** A batch of more than one file ended. Once per batch. */
  onBatchEnded?: (end: FoldImportBatchEnd) => void;
}

export interface FoldImportQueue {
  readonly store: StoreApi<FoldImportQueueState>;
  /**
   * Import the crease patterns among `files`, by the numbers in their names,
   * ending a batch under way. With none among them, the first file, which the
   * flow refuses for what it is not.
   */
  start(files: readonly PickedFile[], via: FoldImportVia): void;
  /** Paused on a refusal: leave this file out and go on with the next. */
  skip(): void;
  /** End the batch under way, if any, and stop listening: the dialog closed. */
  dispose(): void;
}

/** Numbered across queues, so two batches never share an undo step. */
let nextBatch = 1;

interface Run {
  readonly files: readonly PickedFile[];
  readonly via: FoldImportVia;
  readonly batch: number;
  index: number;
  imported: number;
  /** The request the queue opened for file `index`; null while that file is read. */
  request: FoldImportRequest | null;
}

const IDLE: FoldImportQueueState = { status: 'idle' };

export function createFoldImportQueue({
  flow,
  read = foldImportFileRequest,
  onBatchEnded,
}: FoldImportQueueOptions): FoldImportQueue {
  const store = createStore<FoldImportQueueState>(() => IDLE);
  let run: Run | null = null;
  let disposed = false;

  const at = (status: 'running' | 'paused', mine: Run): FoldImportQueueState => ({
    status,
    index: mine.index,
    total: mine.files.length,
    name: mine.files[mine.index]?.name ?? '',
    imported: mine.imported,
  });

  /** The batch ends, said once for a batch of several files. */
  const end = (mine: Run, outcome: 'finished' | 'stopped') => {
    if (run !== mine) return;
    run = null;
    const total = mine.files.length;
    store.setState(outcome === 'finished' ? { status: 'finished', total, imported: mine.imported } : IDLE, true);
    if (total > 1) onBatchEnded?.({ files: total, imported: mine.imported, outcome, via: mine.via });
  };

  /** Read file `index` and open it in the flow, after the step on screen. */
  const openAt = async (mine: Run) => {
    const file = mine.files[mine.index];
    if (!file) return;
    mine.request = null;
    store.setState(at('running', mine), true);
    const request = await read(file).catch(
      (): FoldImportRequest => ({ kind: 'file', name: file.name, source: null, unreadable: true })
    );
    if (run !== mine) return;
    mine.request = request;
    await flow.open(request, mine.files.length > 1 ? { batch: mine.batch } : undefined);
  };

  const advance = (mine: Run) => {
    if (mine.index + 1 >= mine.files.length) {
      end(mine, 'finished');
      return;
    }
    mine.index += 1;
    void openAt(mine);
  };

  const hear = (state: FoldImportFlowState) => {
    const mine = run;
    if (!mine) return;
    // Reset, a choice let go, or a request the queue did not open (a pattern card, a sample):
    // the batch ends where it is.
    if (state.phase === 'idle' || mine.request === null || state.request !== mine.request) {
      end(mine, 'stopped');
      return;
    }
    switch (state.phase) {
      case 'done':
        mine.imported += 1;
        advance(mine);
        return;
      case 'refused':
      case 'failed':
        store.setState(at('paused', mine), true);
        return;
      default:
        // Under way, or choosing its order: running again after a Search longer.
        if (store.getState().status !== 'running') store.setState(at('running', mine), true);
    }
  };
  const unsubscribe = flow.store.subscribe(hear);

  return {
    store,

    start(files, via) {
      if (disposed) return;
      if (run) end(run, 'stopped');
      const ordered = foldImportFileOrder(files);
      if (ordered.length === 0) return;
      const mine: Run = { files: ordered, via, batch: nextBatch++, index: 0, imported: 0, request: null };
      run = mine;
      void openAt(mine);
    },

    skip() {
      const mine = run;
      if (!mine || store.getState().status !== 'paused') return;
      advance(mine);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      if (run) end(run, 'stopped');
    },
  };
}
