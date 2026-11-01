import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { endOpenCanvasSessions } from '../../cp-workspace/canvasObjects/canvasSessions';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { queueStepPoseEdit } from './stepPoseQueue';

const set = useWorkspaceStore.setState;
const get = useWorkspaceStore.getState;
let id: string;
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
beforeEach(() => {
  set(useWorkspaceStore.getInitialState(), true);
  id = get().addDiagramStep()!;
});
afterEach(() => endOpenCanvasSessions('document-replaced'));

it('waits for a capture and coalesces pending changes to the same field', async () => {
  set({ diagramCaptures: { [id]: { runId: null } } });
  const write = vi.fn(async (_mode: string) => {});
  const first = queueStepPoseEdit(id, 'presentation', () => write('diagram'));
  const last = queueStepPoseEdit(id, 'presentation', () => write('perspective'));
  await first;
  expect(write).not.toHaveBeenCalled();
  set({ diagramCaptures: {} });
  await last;
  expect(write.mock.calls).toEqual([['perspective']]);
});

it('invalidates an in-flight mode without dropping a different queued field', async () => {
  const held = gate();
  const started = gate();
  const committed: string[] = [];
  const first = queueStepPoseEdit(id, 'presentation', async (current) => {
    started.release();
    await held.promise;
    if (current()) committed.push('old mode');
  });
  await started.promise;
  const reveal = queueStepPoseEdit(id, 'reveal', async () => { committed.push('reveal'); });
  const last = queueStepPoseEdit(id, 'presentation', async () => { committed.push('new mode'); });
  held.release();
  await Promise.all([first, reveal, last]);
  expect(committed).toEqual(['reveal', 'new mode']);
});

it.each(['history', 'document-replaced'] as const)('cancels idle waits immediately on %s', async (reason) => {
  set({ diagramCaptures: { [id]: { runId: null } } });
  const write = vi.fn(async () => {});
  const pending = queueStepPoseEdit(id, 'presentation', write);
  await Promise.resolve();
  endOpenCanvasSessions(reason);
  await pending;
  set({ diagramCaptures: {} });
  await Promise.resolve();
  expect(write).not.toHaveBeenCalled();
  await queueStepPoseEdit(id, 'presentation', write);
  expect(write).toHaveBeenCalledOnce();
});

it.each(['read-only', 'replaced', 'removed'])('drops work when the document becomes %s while waiting', async (change) => {
  set({ diagramCaptures: { [id]: { runId: null } } });
  const write = vi.fn(async () => {});
  const pending = queueStepPoseEdit(id, 'presentation', write);
  await Promise.resolve();
  if (change === 'read-only') set({ diagramReadOnly: true });
  else if (change === 'replaced') set({ diagramLoadId: get().diagramLoadId + 1 });
  else set({ diagram: null });
  await pending;
  expect(write).not.toHaveBeenCalled();
});

it('cancels a running capture on Undo and allows a new queue afterwards', async () => {
  const held = gate();
  const started = gate();
  const committed: string[] = [];
  const old = queueStepPoseEdit(id, 'presentation', async (current) => {
    started.release();
    await held.promise;
    if (current()) committed.push('old');
  });
  await started.promise;
  endOpenCanvasSessions('history');
  await old;
  await queueStepPoseEdit(id, 'presentation', async () => { committed.push('new'); });
  held.release();
  await Promise.resolve();
  expect(committed).toEqual(['new']);
});

it('recovers from a rejected edit and processes the next request', async () => {
  const first = queueStepPoseEdit(id, 'presentation', async () => { throw new Error('test capture failed'); });
  const write = vi.fn(async () => {});
  const second = queueStepPoseEdit(id, 'reveal', write);
  await Promise.all([first, second]);
  expect(write).toHaveBeenCalledOnce();
});


it('preserves distinct non-idempotent edits such as two toggles', async () => {
  const toggle = vi.fn(async () => {});
  await Promise.all([queueStepPoseEdit(id, null, toggle), queueStepPoseEdit(id, null, toggle)]);
  expect(toggle).toHaveBeenCalledTimes(2);
});
