import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A spread verb's event says how the layers are spread in enums and buckets
 * only (Phase 13, 13g): never an amount, skew or axis as the user set it.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackDiagramPicturePosed } = await import('../trackDiagram');

beforeEach(() => {
  runtime.track.mockClear();
});

describe('trackDiagramPicturePosed', () => {
  it('sends a pose with no spread as its action and kind alone', () => {
    trackDiagramPicturePosed('turn_over', 'flat');
    expect(runtime.track).toHaveBeenCalledWith('diagram picture posed', { action: 'turn_over', kind: 'flat' });
  });

  it('sends the side a turn-over leaves the paper showing, as a word', () => {
    trackDiagramPicturePosed('turn_over', 'flat', { side: 'back' });
    expect(runtime.track).toHaveBeenCalledWith('diagram picture posed', { action: 'turn_over', kind: 'flat', side: 'back' });
  });

  it('sends a crease pattern’s paper side, chosen in the Step pane, as a word', () => {
    // Front | Back under Show as: the paper's colour, not a turn-over.
    trackDiagramPicturePosed('paper_side', 'crease_pattern', { side: 'back' });
    expect(runtime.track).toHaveBeenCalledWith('diagram picture posed', {
      action: 'paper_side',
      kind: 'crease_pattern',
      side: 'back',
    });
  });

  it('sends a depth spread as its kind, direction and bucketed amount', () => {
    trackDiagramPicturePosed('spread_on', 'flat', { spread: { kind: 'depth', direction: 'down', amount: 0.025 } });
    expect(runtime.track).toHaveBeenCalledWith('diagram picture posed', {
      action: 'spread_on',
      kind: 'flat',
      spread_kind: 'depth',
      spread_amount_bucket: '<=2.5',
      spread_direction: 'down',
    });
  });

  it('sends an affine spread as its kind, the layer held still, and its amount, skew and axis bucketed', () => {
    trackDiagramPicturePosed('spread_axis', 'flat', {
      spread: { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 },
    });
    const [, properties] = runtime.track.mock.calls[0]!;
    expect(properties).toEqual({
      action: 'spread_axis',
      kind: 'flat',
      spread_kind: 'affine',
      spread_amount_bucket: '<=7.5',
      spread_keep: 'top',
      spread_skew_bucket: '>99',
      spread_axis_bucket: '<=90',
    });
    trackDiagramPicturePosed('spread_skew', 'flat', {
      spread: { kind: 'affine', amount: 0.2, keep: 'bottom', skew: 0, axisDeg: 170 },
    });
    expect(runtime.track.mock.calls[1]![1]).toMatchObject({
      spread_amount_bucket: '>12.5',
      spread_skew_bucket: '<=0',
      spread_axis_bucket: '>135',
    });
    // Never a value as it was set.
    for (const [, sent] of runtime.track.mock.calls) {
      expect(Object.values(sent as Record<string, unknown>).every((value) => typeof value === 'string')).toBe(true);
    }
  });
});
