import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The pairing verbs' event carries enums and one bucket, and nothing about
 * which vertices were paired — ids and positions are the user's design.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackSymmetryPairChanged } = await import('../trackSymmetryPairChanged');

beforeEach(() => {
  runtime.track.mockClear();
});

describe('trackSymmetryPairChanged', () => {
  it('reports the verb, the design kind and a bucketed count', () => {
    trackSymmetryPairChanged({ designKind: 'box-pleat', action: 'pair', pairCount: 1 });
    expect(runtime.track).toHaveBeenCalledWith('symmetry pair changed', {
      design_kind: 'box-pleat',
      action: 'pair',
      pair_count_bucket: '<=1',
    });
  });

  it('buckets a Pair all count rather than sending it raw', () => {
    trackSymmetryPairChanged({ designKind: 'explori', action: 'pair_all', pairCount: 7 });
    const [, properties] = runtime.track.mock.calls[0];
    expect(properties).toMatchObject({ design_kind: 'explori', action: 'pair_all' });
    expect(properties?.pair_count_bucket).toBe('<=10');
    expect(Object.values(properties ?? {})).not.toContain(7);
  });
});
