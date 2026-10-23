import { beforeEach, expect, it, vi } from 'vitest';

/** A Fold engine crash is counted by enums and a bucket: why, what came of it, how many in a row. */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackFoldEngineCrashed } = await import('../trackFoldEngine');

beforeEach(() => {
  runtime.track.mockClear();
});

it('sends the reason, the outcome and the crash count, bucketed', () => {
  trackFoldEngineCrashed({ cause: 'wasm_trap', attempt: 1, outcome: 'recovered' });
  trackFoldEngineCrashed({ cause: 'worker_error', attempt: 3, outcome: 'gave_up' });
  trackFoldEngineCrashed({ cause: 'engine_poisoned', attempt: 4, outcome: 'gave_up' });
  expect(runtime.track.mock.calls).toEqual([
    ['fold engine crashed', { reason: 'wasm_trap', outcome: 'recovered', restart_count_bucket: '<=1' }],
    ['fold engine crashed', { reason: 'worker_error', outcome: 'gave_up', restart_count_bucket: '<=3' }],
    ['fold engine crashed', { reason: 'engine_poisoned', outcome: 'gave_up', restart_count_bucket: '>3' }],
  ]);
});
