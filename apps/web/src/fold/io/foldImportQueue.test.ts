/**
 * Import CP of several files, over a flow the test drives: the crease
 * patterns of a drop open one after another by the numbers in their names,
 * each once the one before landed, in one batch; a refusal pauses the queue
 * and Skip goes on; anything the queue did not open ends it; a batch of
 * several files is counted once as it ends.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { PickedFile } from '../../platform/fileService';
import type { FoldImportFlow, FoldImportFlowState, FoldImportOpenOptions, FoldImportRequest } from './foldImportFlow';
import { createFoldImportQueue, type FoldImportQueue } from './foldImportQueue';

/** A dropped file holding its name as text. */
function file(name: string): PickedFile {
  return { name, type: '', size: name.length, read: async () => new TextEncoder().encode(name) };
}

/** A flow the test lands, refuses and re-opens by hand; every open is recorded. */
function fakeFlow() {
  const store = createStore<FoldImportFlowState>(() => ({ phase: 'idle' }));
  const opened: { request: FoldImportRequest; options?: FoldImportOpenOptions }[] = [];
  const flow: FoldImportFlow = {
    store,
    open: vi.fn(async (request: FoldImportRequest, options?: FoldImportOpenOptions) => {
      opened.push({ request, ...(options ? { options } : {}) });
      store.setState({ phase: 'working', request }, true);
    }),
    choose: vi.fn(),
    accept: vi.fn(async () => {}),
    region: vi.fn(),
    commit: vi.fn(async () => {}),
    searchLonger: vi.fn(async () => {}),
    reset: vi.fn(),
    dispose: vi.fn(),
  };
  const current = () => {
    const now = store.getState();
    if (now.phase === 'idle') throw new Error('nothing under way');
    return now.request;
  };
  return {
    flow,
    store,
    opened,
    names: () => opened.map((each) => (each.request.kind === 'file' ? each.request.name : each.request.kind)),
    batches: () => opened.map((each) => each.options?.batch),
    /** The step of the request under way is committed. */
    land: () => store.setState({ phase: 'done', request: current(), stepId: 'step', origin: 'cp' }, true),
    refuse: () =>
      store.setState(
        { phase: 'refused', request: current(), refusal: { kind: 'engine', refused: { refusal: { code: 'import_no_order' } } } },
        true
      ),
  };
}

/** Let a file's read, and the open after it, run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let queues: FoldImportQueue[] = [];
afterEach(() => {
  for (const queue of queues) queue.dispose();
  queues = [];
});

function setup() {
  const fake = fakeFlow();
  const ended = vi.fn();
  const queue = createFoldImportQueue({ flow: fake.flow, onBatchEnded: ended });
  queues.push(queue);
  return { ...fake, queue, ended };
}

describe('Import CP of several files', () => {
  it('opens the crease patterns of a drop one after another, by the numbers in their names', async () => {
    const { queue, names, land, ended, batches } = setup();
    queue.start(['10.cp', 'notes.txt', '9.cp', '8.cp'].map(file), 'drop');
    await flush();
    expect(names()).toEqual(['8.cp']);
    expect(queue.store.getState()).toEqual({ status: 'running', index: 0, total: 3, name: '8.cp', imported: 0 });

    land();
    await flush();
    expect(names()).toEqual(['8.cp', '9.cp']);
    expect(queue.store.getState()).toEqual({ status: 'running', index: 1, total: 3, name: '9.cp', imported: 1 });

    land();
    await flush();
    land();
    expect(names()).toEqual(['8.cp', '9.cp', '10.cp']);
    expect(queue.store.getState()).toEqual({ status: 'finished', total: 3, imported: 3 });
    // One batch for all three, so their steps are one undo step.
    const [batch] = batches();
    expect(batch).toEqual(expect.any(Number));
    expect(batches()).toEqual([batch, batch, batch]);
    expect(ended).toHaveBeenCalledExactlyOnceWith({ files: 3, imported: 3, outcome: 'finished', via: 'drop' });
  });

  it('reads each file only when its turn comes', async () => {
    const { flow, land } = fakeFlow();
    const read = vi.fn(async (picked: PickedFile): Promise<FoldImportRequest> => ({
      kind: 'file',
      name: picked.name,
      source: { format: 'cp', bytes: new Uint8Array() },
    }));
    const queue = createFoldImportQueue({ flow, read });
    queues.push(queue);
    queue.start(['1.cp', '2.cp', '3.cp'].map(file), 'pick');
    await flush();
    expect(read.mock.calls.map(([picked]) => picked.name)).toEqual(['1.cp']);
    land();
    await flush();
    expect(read.mock.calls.map(([picked]) => picked.name)).toEqual(['1.cp', '2.cp']);
  });

  it('opens a single file on its own, in no batch, and counts nothing as it ends', async () => {
    const { queue, opened, land, ended } = setup();
    queue.start([file('crane.cp')], 'drop');
    await flush();
    expect(opened).toEqual([{ request: { kind: 'file', name: 'crane.cp', source: expect.objectContaining({ format: 'cp' }) } }]);
    land();
    expect(queue.store.getState()).toEqual({ status: 'finished', total: 1, imported: 1 });
    expect(ended).not.toHaveBeenCalled();
  });

  it('opens the first file of a drop with no crease pattern, for the flow to say what it is not', async () => {
    const { queue, opened } = setup();
    queue.start([file('notes.txt'), file('photo.png')], 'drop');
    await flush();
    expect(opened.map((each) => each.request)).toEqual([{ kind: 'file', name: 'notes.txt', source: null }]);
  });

  it('pauses on a refusal, and Skip goes on with the next file in the same batch', async () => {
    const { queue, names, land, refuse, ended, batches } = setup();
    queue.start(['1.cp', '2.cp', '3.cp'].map(file), 'drop');
    await flush();
    land();
    await flush();
    refuse();
    expect(queue.store.getState()).toEqual({ status: 'paused', index: 1, total: 3, name: '2.cp', imported: 1 });

    queue.skip();
    await flush();
    expect(names()).toEqual(['1.cp', '2.cp', '3.cp']);
    expect(queue.store.getState()).toMatchObject({ status: 'running', index: 2, imported: 1 });
    // Skip only acts on a pause.
    queue.skip();
    await flush();
    expect(names()).toHaveLength(3);

    land();
    expect(queue.store.getState()).toEqual({ status: 'finished', total: 3, imported: 2 });
    expect(new Set(batches()).size).toBe(1);
    expect(ended).toHaveBeenCalledExactlyOnceWith({ files: 3, imported: 2, outcome: 'finished', via: 'drop' });
  });

  it('carries on with the refused file when the flow’s own fix opens it again', async () => {
    const { queue, store, opened, names, land, refuse } = setup();
    queue.start(['1.cp', '2.cp'].map(file), 'drop');
    await flush();
    refuse();
    expect(queue.store.getState()).toMatchObject({ status: 'paused', index: 0 });
    // Search longer: the flow opens the same request again, larger budget.
    store.setState({ phase: 'working', request: opened[0]!.request }, true);
    expect(queue.store.getState()).toMatchObject({ status: 'running', index: 0 });
    land();
    await flush();
    expect(names()).toEqual(['1.cp', '2.cp']);
  });

  it('ends where it is when the flow imports something it did not open', async () => {
    const { queue, store, names, ended } = setup();
    queue.start(['1.cp', '2.cp', '3.cp'].map(file), 'drop');
    await flush();
    store.setState({ phase: 'working', request: { kind: 'sample', sample: 'waterbomb-base' } }, true);
    expect(queue.store.getState()).toEqual({ status: 'idle' });
    expect(ended).toHaveBeenCalledExactlyOnceWith({ files: 3, imported: 0, outcome: 'stopped', via: 'drop' });
    store.setState({ phase: 'done', request: { kind: 'sample', sample: 'waterbomb-base' }, stepId: 's', origin: 'sample' }, true);
    await flush();
    expect(names()).toEqual(['1.cp']);
  });

  it('ends when a choice of a file’s layer order is let go', async () => {
    const { queue, store, opened, land, ended } = setup();
    queue.start(['1.cp', '2.cp'].map(file), 'pick');
    await flush();
    land();
    await flush();
    store.setState({ phase: 'ordering', request: opened[1]!.request }, true);
    expect(queue.store.getState()).toMatchObject({ status: 'running', index: 1 });
    // Cancel in the Layer order dialog: the import goes back to idle.
    store.setState({ phase: 'idle' }, true);
    expect(queue.store.getState()).toEqual({ status: 'idle' });
    expect(ended).toHaveBeenCalledExactlyOnceWith({ files: 2, imported: 1, outcome: 'stopped', via: 'pick' });
  });

  it('ends a batch under way when another starts, in a batch of its own', async () => {
    const { queue, land, ended, batches, names } = setup();
    queue.start(['1.cp', '2.cp'].map(file), 'drop');
    await flush();
    land();
    queue.start(['a.cp', 'b.cp'].map(file), 'pick');
    await flush();
    expect(ended).toHaveBeenCalledExactlyOnceWith({ files: 2, imported: 1, outcome: 'stopped', via: 'drop' });
    expect(queue.store.getState()).toMatchObject({ status: 'running', index: 0, total: 2, name: 'a.cp' });
    // The first batch's second file, read meanwhile, never opened.
    expect(names()).toEqual(['1.cp', 'a.cp']);
    const [first, second] = batches();
    expect(second).not.toBe(first);
  });

  it('ends a batch under way when it is disposed, once', async () => {
    const { queue, store, ended } = setup();
    queue.start(['1.cp', '2.cp'].map(file), 'drop');
    await flush();
    queue.dispose();
    queue.dispose();
    expect(ended).toHaveBeenCalledExactlyOnceWith({ files: 2, imported: 0, outcome: 'stopped', via: 'drop' });
    // No longer listening, and no longer starting.
    store.setState({ phase: 'idle' }, true);
    queue.start([file('3.cp')], 'drop');
    await flush();
    expect(ended).toHaveBeenCalledOnce();
    expect(queue.store.getState()).toEqual({ status: 'idle' });
  });
});
