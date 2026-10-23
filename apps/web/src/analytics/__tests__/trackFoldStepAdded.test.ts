import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Fold vertex fold's step is counted by how it named what it takes, enums
 * only: a petal fold's hinge, a swivel's form — by its edge at a pivot, by its
 * edge on a folded edge, or by its rays — an edge form's target, and on a
 * folded edge its kind, open or inside.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackFoldStepAdded } = await import('../trackFold');

beforeEach(() => {
  runtime.track.mockClear();
});

it('counts Repeat mode and a bucketed range size without source content', () => {
  trackFoldStepAdded('repeat', { repeat: { mode: 'individual', count: 7 } });
  expect(runtime.track).toHaveBeenCalledWith('fold step added', {
    op_kind: 'repeat', repeat_mode: 'individual', count_bucket: '<=10',
  });
  // Where its axis came from and which side it repeated on: enums only, never the axis.
  trackFoldStepAdded('repeat', { repeat: { mode: 'grouped', count: 3, axisSource: 'drawn_cp', side: 'behind' } });
  expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
    op_kind: 'repeat', repeat_mode: 'grouped', count_bucket: '<=5', axis_source: 'drawn_cp', side: 'behind',
  });
});

it('counts tuck targets only in buckets, distinguishing a single target from multiple targets', () => {
  for (const [targetCount, bucket] of [[1, '<=1'], [2, '<=5'], [6, '<=10']] as const) {
    trackFoldStepAdded('tuck', { layerScope: 'depth', via: 'free', targetCount });
    expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
      op_kind: 'tuck', layer_scope: 'depth', via: 'free', target_count_bucket: bucket,
    });
  }
});

describe('trackFoldStepAdded for a swivel', () => {
  it('sends its form, an edge form’s target, and on a folded edge its kind', () => {
    trackFoldStepAdded('swivel', { vertex: { swivelForm: 'fold', target: 'crease', swivelKind: 'open' } });
    expect(runtime.track).toHaveBeenCalledWith('fold step added', {
      op_kind: 'swivel',
      swivel_form: 'fold',
      target: 'crease',
      swivel_kind: 'open',
    });
    trackFoldStepAdded('swivel', { vertex: { swivelForm: 'fold', target: 'free', swivelKind: 'inside' } });
    expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
      op_kind: 'swivel',
      swivel_form: 'fold',
      target: 'free',
      swivel_kind: 'inside',
    });
    trackFoldStepAdded('swivel', { vertex: { swivelForm: 'edge', target: 'free' } });
    expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
      op_kind: 'swivel',
      swivel_form: 'edge',
      target: 'free',
    });
    trackFoldStepAdded('swivel', { vertex: { swivelForm: 'rays' } });
    expect(runtime.track).toHaveBeenLastCalledWith('fold step added', { op_kind: 'swivel', swivel_form: 'rays' });
    // By its valley and mountain: no target, and its kind.
    trackFoldStepAdded('swivel', { vertex: { swivelForm: 'valley_mountain', swivelKind: 'inside' } });
    expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
      op_kind: 'swivel',
      swivel_form: 'valley_mountain',
      swivel_kind: 'inside',
    });
  });
});
