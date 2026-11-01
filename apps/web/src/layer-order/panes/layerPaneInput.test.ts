import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP_PX, isDoubleTap, paneInputOf, sameLayerPaneHit } from './layerPaneInput';

describe('a pane’s input', () => {
  it('names a finger’s press a tap, and anything else a pointer', () => {
    expect(paneInputOf('touch')).toBe('tap');
    expect(paneInputOf('mouse')).toBe('pointer');
    expect(paneInputOf('pen')).toBe('pointer');
  });

  it('tells a double tap: soon after, and near', () => {
    const first = { at: 1000, x: 50, y: 50 };
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: 1000 + DOUBLE_TAP_MS, x: 50, y: 50 })).toBe(true);
    expect(isDoubleTap(first, { at: 1000 + DOUBLE_TAP_MS + 1, x: 50, y: 50 })).toBe(false);
    expect(isDoubleTap(first, { at: 1100, x: 50 + DOUBLE_TAP_SLOP_PX, y: 50 })).toBe(true);
    expect(isDoubleTap(first, { at: 1100, x: 50 + DOUBLE_TAP_SLOP_PX + 1, y: 50 })).toBe(false);
    expect(isDoubleTap(first, { at: 900, x: 50, y: 50 })).toBe(false);
  });

  it('tells one hit from another by pane, face and spot', () => {
    const hit = { pane: 'folded', face: 3, spot: 1 } as const;
    expect(sameLayerPaneHit(hit, { ...hit })).toBe(true);
    expect(sameLayerPaneHit(hit, { ...hit, spot: 2 })).toBe(false);
    expect(sameLayerPaneHit(hit, { ...hit, pane: 'pattern', spot: null })).toBe(false);
  });
});
