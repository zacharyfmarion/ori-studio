import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Fold step's spread change is counted as the Diagram counts a spread:
 * enums and buckets only, never an amount, skew or axis as it was set.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackFoldSpreadChanged, trackFoldOrderResolved, trackFoldFreeLineSnapChanged, trackFoldCpSideChanged } = await import('../trackFold');
const { spreadTracking } = await import('../trackDiagram');

beforeEach(() => {
  runtime.track.mockClear();
});

it('reports free-line snapping changes as on/off only', () => {
  trackFoldFreeLineSnapChanged(false);
  expect(runtime.track).toHaveBeenCalledWith('fold free line snapping changed', { state: 'off' });
});

it('reports a CP turnover only as the side now shown', () => {
  trackFoldCpSideChanged('back');
  expect(runtime.track).toHaveBeenCalledExactlyOnceWith('fold cp side changed', { side: 'back' });
});

describe('trackFoldSpreadChanged', () => {
  it('sends a spread turned off as its action and surface alone', () => {
    trackFoldSpreadChanged('spread_off', 'canvas_bar', null);
    expect(runtime.track).toHaveBeenCalledWith('fold spread changed', { action: 'spread_off', via: 'canvas_bar' });
  });

  it('sends a depth spread as its kind, direction and bucketed amount', () => {
    trackFoldSpreadChanged('spread_direction', 'step_pane', { kind: 'depth', amount: 0.06, toward: 'down-right' });
    expect(runtime.track).toHaveBeenCalledWith('fold spread changed', {
      action: 'spread_direction',
      via: 'step_pane',
      spread_kind: 'depth',
      spread_amount_bucket: '<=7.5',
      spread_direction: 'down_right',
    });
  });

  it('sends an affine spread with its layer held still, and its skew and axis bucketed', () => {
    trackFoldSpreadChanged('spread_on', 'step_pane', { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 });
    const [, properties] = runtime.track.mock.calls[0]!;
    expect(properties).toEqual({
      action: 'spread_on',
      via: 'step_pane',
      spread_kind: 'affine',
      spread_amount_bucket: '<=7.5',
      spread_keep: 'top',
      spread_skew_bucket: '>99',
      spread_axis_bucket: '<=90',
    });
    expect(Object.values(properties as Record<string, unknown>).every((value) => typeof value === 'string')).toBe(true);
  });

  it('names a spread’s direction as the events spell one', () => {
    expect(spreadTracking({ kind: 'depth', amount: 0.025, toward: 'up-left' })).toEqual({
      kind: 'depth',
      direction: 'up_left',
      amount: 0.025,
    });
  });
});

it('reports explicit order review using enums and a bucket, without model content', () => {
  trackFoldOrderResolved('accepted', 'cp', 123);
  const [event, properties] = runtime.track.mock.calls[0]!;
  expect(event).toBe('fold order resolved');
  expect(Object.keys(properties).sort()).toEqual(['count_bucket', 'result', 'source']);
  expect(properties.result).toBe('accepted');
  expect(properties.source).toBe('cp');
  expect(typeof properties.count_bucket).toBe('string');
});
