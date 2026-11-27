import { beforeEach, expect, it, vi } from 'vitest';

/**
 * Import CP of several files is counted once as its batch ends, as `fold cp
 * batch ended`: how many files and how many steps, bucketed, how it ended and
 * how the files came — never a file's name or an exact count.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackFoldCpBatchEnded } = await import('../trackFoldIo');

beforeEach(() => {
  runtime.track.mockClear();
});

it('buckets the batch’s files and the steps it added, with how it ended and how they came', () => {
  trackFoldCpBatchEnded({ files: 19, imported: 19, outcome: 'finished', via: 'drop' });
  expect(runtime.track).toHaveBeenCalledExactlyOnceWith('fold cp batch ended', {
    files: '<=20',
    imported: '<=20',
    outcome: 'finished',
    via: 'drop',
  });
});

it('counts a batch that stopped part way', () => {
  trackFoldCpBatchEnded({ files: 3, imported: 0, outcome: 'stopped', via: 'pick' });
  expect(runtime.track).toHaveBeenCalledExactlyOnceWith('fold cp batch ended', {
    files: '<=5',
    imported: '<=1',
    outcome: 'stopped',
    via: 'pick',
  });
});
