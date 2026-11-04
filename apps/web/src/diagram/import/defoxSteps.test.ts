import { describe, expect, it } from 'vitest';
import { drawDefoxSteps, type DefoxWorker } from './defoxSteps';

/**
 * Workers over a project of `count` steps, each opened from a file whose first
 * byte says which reading it is: a step in `slow` never finishes drawing, and
 * one in `dies` kills its worker.
 */
function workers(count: number, { slow = [], dies = [] }: { slow?: number[]; dies?: number[] } = {}) {
  const log: string[] = [];
  const start = (): DefoxWorker => {
    let fail: (error: Error) => void = () => undefined;
    const died = new Promise<never>((_, reject) => {
      fail = reject;
    });
    died.catch(() => undefined);
    let spent = 0;
    return {
      open: async (bytes, from) => {
        log.push(`open ${bytes[0]} from ${from}`);
        spent = from;
        return count;
      },
      draw: (index) => {
        log.push(`draw ${index}`);
        if (slow.includes(index)) return new Promise(() => undefined);
        if (dies.includes(index)) {
          fail(new Error('out of memory'));
          return new Promise(() => undefined);
        }
        spent += 10;
        return Promise.resolve({ entry: { ok: true as const, index, cp: '', svg: '', snapshot: '' }, spent });
      },
      died,
      terminate: () => log.push('end'),
    };
  };
  return { log, start };
}

const options = (start: () => DefoxWorker, signal = new AbortController().signal) => ({
  bytes: new Uint8Array([1]),
  reread: async () => new Uint8Array([2]),
  start,
  budgetMs: 20,
  signal,
  openTimeout: 'took too long to open',
});

describe('drawing a Defox project a step at a time', () => {
  it('draws every step in one worker', async () => {
    const { log, start } = workers(3);
    const steps = await drawDefoxSteps(options(start));
    expect(steps.map((step) => step.ok)).toEqual([true, true, true]);
    expect(log).toEqual(['open 1 from 0', 'draw 0', 'draw 1', 'draw 2', 'end']);
  });

  it('fails a step over its budget alone, and draws the rest in a new worker from the file read again', async () => {
    const { log, start } = workers(4, { slow: [1] });
    const steps = await drawDefoxSteps(options(start));
    expect(steps).toEqual([
      expect.objectContaining({ ok: true, index: 0 }),
      { ok: false, index: 1, overBudget: true },
      expect.objectContaining({ ok: true, index: 2 }),
      expect.objectContaining({ ok: true, index: 3 }),
    ]);
    // The new worker counts the output from where the stopped one left it.
    expect(log).toEqual(['open 1 from 0', 'draw 0', 'draw 1', 'end', 'open 2 from 10', 'draw 2', 'draw 3', 'end']);
  });

  it('fails a step its worker dies on, and goes on in a new worker', async () => {
    const { start } = workers(3, { dies: [1] });
    const steps = await drawDefoxSteps(options(start));
    expect(steps).toEqual([
      expect.objectContaining({ ok: true, index: 0 }),
      { ok: false, index: 1, error: 'out of memory' },
      expect.objectContaining({ ok: true, index: 2 }),
    ]);
  });

  it('fails the whole project when opening it takes longer than the budget', async () => {
    const ended: string[] = [];
    const start = (): DefoxWorker => ({
      open: () => new Promise(() => undefined),
      draw: () => new Promise(() => undefined),
      died: new Promise(() => undefined),
      terminate: () => ended.push('end'),
    });
    await expect(drawDefoxSteps(options(start))).rejects.toThrow('took too long to open');
    expect(ended).toEqual(['end']);
  });

  it('stops its worker when the import is cancelled', async () => {
    const { log, start } = workers(3, { slow: [1] });
    const cancel = new AbortController();
    const drawing = drawDefoxSteps({ ...options(start, cancel.signal), budgetMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    cancel.abort();
    await expect(drawing).rejects.toMatchObject({ name: 'AbortError' });
    expect(log).toEqual(['open 1 from 0', 'draw 0', 'draw 1', 'end']);
  });
});
