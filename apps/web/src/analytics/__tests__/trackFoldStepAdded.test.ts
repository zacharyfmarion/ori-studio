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
  // Whether its range ended before the step it was added after: an enum, never the steps.
  trackFoldStepAdded('repeat', { repeat: { mode: 'grouped', count: 2, side: 'same', rangeEnd: 'earlier' } });
  expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
    op_kind: 'repeat', repeat_mode: 'grouped', count_bucket: '<=5', side: 'same', range_end: 'earlier',
  });
});

it('says which end of a pleat moved, and nothing of the sort for another fold', () => {
  for (const pleatEnd of ['valley', 'mountain'] as const) {
    trackFoldStepAdded('pleat', { layerScope: 'top', via: 'crease', pleatEnd });
    expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
      op_kind: 'pleat', layer_scope: 'top', via: 'crease', pleat_end: pleatEnd,
    });
  }
  trackFoldStepAdded('crimp', { layerScope: 'all', via: 'free' });
  expect(runtime.track).toHaveBeenLastCalledWith('fold step added', { op_kind: 'crimp', layer_scope: 'all', via: 'free' });
});

it('counts tuck targets only in buckets, distinguishing a single target from multiple targets', () => {
  for (const [targetCount, bucket] of [[1, '<=1'], [2, '<=5'], [6, '<=10']] as const) {
    trackFoldStepAdded('tuck', { layerScope: 'depth', via: 'free', targetCount });
    expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
      op_kind: 'tuck', layer_scope: 'depth', via: 'free', target_count_bucket: bucket,
    });
  }
});

it('says what a fold tucked in place moved, an enum, beside its bucketed targets', () => {
  for (const inPlace of ['flap', 'fold'] as const) {
    trackFoldStepAdded('valley', { layerScope: 'flaps', via: 'free', targetCount: 1, inPlace });
    expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
      op_kind: 'valley', layer_scope: 'flaps', via: 'free', target_count_bucket: '<=1', in_place: inPlace,
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
    // Made with its other end: the crease the two share.
    trackFoldStepAdded('swivel', { vertex: { swivelForm: 'valley_mountain', swivelKind: 'open', swivelShared: 'behind' } });
    expect(runtime.track).toHaveBeenLastCalledWith('fold step added', {
      op_kind: 'swivel',
      swivel_form: 'valley_mountain',
      swivel_kind: 'open',
      swivel_shared: 'behind',
    });
  });
});
