import { describe, expect, it } from 'vitest';
import {
  computeShareCardFrame,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_PADDING,
  SHARE_CARD_WIDTH,
  svgToPngCard,
} from './creaseExport';

const CARD_ASPECT = SHARE_CARD_WIDTH / SHARE_CARD_HEIGHT;

describe('computeShareCardFrame', () => {
  it('centres a square page and letterboxes it horizontally', () => {
    const frame = computeShareCardFrame(1024, 1024);
    // Height is the binding dimension for anything squarer than 1.91:1.
    expect(frame.height).toBeCloseTo(SHARE_CARD_HEIGHT - SHARE_CARD_PADDING * 2);
    expect(frame.width).toBeCloseTo(frame.height);
    expect(frame.x).toBeCloseTo((SHARE_CARD_WIDTH - frame.width) / 2);
    expect(frame.y).toBeCloseTo(SHARE_CARD_PADDING);
  });

  it('preserves aspect ratio for a tall page', () => {
    const frame = computeShareCardFrame(600, 1800);
    expect(frame.width / frame.height).toBeCloseTo(600 / 1800);
    expect(frame.height).toBeCloseTo(SHARE_CARD_HEIGHT - SHARE_CARD_PADDING * 2);
  });

  it('preserves aspect ratio for a wide page, where width binds', () => {
    const frame = computeShareCardFrame(4000, 500);
    expect(frame.width / frame.height).toBeCloseTo(4000 / 500);
    expect(frame.width).toBeCloseTo(SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2);
  });

  it('upscales a tiny page to fill the card', () => {
    // The regression openscad-studio shipped: rasterizing at intrinsic size produced a
    // 90x54 PNG, too small for any platform to lay out as a large card.
    const frame = computeShareCardFrame(90, 54);
    // 90x54 is aspect 1.67, squarer than the card's 1.905, so height binds and the
    // artwork fills the padded height with room to spare on the sides.
    expect(frame.height).toBeCloseTo(SHARE_CARD_HEIGHT - SHARE_CARD_PADDING * 2);
    expect(frame.width / frame.height).toBeCloseTo(90 / 54);
    expect(frame.width / 90).toBeGreaterThan(9);
  });

  it('never exceeds the padded box in either dimension', () => {
    for (const [w, h] of [
      [1, 1],
      [1024, 1024],
      [3, 5000],
      [5000, 3],
      [1200, 630],
    ]) {
      const frame = computeShareCardFrame(w, h);
      expect(frame.width).toBeLessThanOrEqual(SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2 + 1e-6);
      expect(frame.height).toBeLessThanOrEqual(SHARE_CARD_HEIGHT - SHARE_CARD_PADDING * 2 + 1e-6);
      expect(frame.x).toBeGreaterThanOrEqual(SHARE_CARD_PADDING - 1e-6);
      expect(frame.y).toBeGreaterThanOrEqual(SHARE_CARD_PADDING - 1e-6);
    }
  });

  it('matches the card aspect exactly when the source already does', () => {
    const frame = computeShareCardFrame(1910, 1000);
    expect(frame.width / frame.height).toBeCloseTo(1.91, 2);
    expect(CARD_ASPECT).toBeCloseTo(1.905, 2);
  });

  it('survives degenerate and hostile inputs rather than emitting NaN', () => {
    for (const [w, h] of [
      [0, 0],
      [-10, 20],
      [Number.NaN, 100],
      [Number.POSITIVE_INFINITY, 100],
    ]) {
      const frame = computeShareCardFrame(w, h);
      for (const value of [frame.x, frame.y, frame.width, frame.height]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);
    }
  });

  it('clamps padding that would leave no room for artwork', () => {
    const frame = computeShareCardFrame(1024, 1024, 1200, 630, 10_000);
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
    expect(Number.isFinite(frame.x)).toBe(true);
  });

  it('honours a custom card size', () => {
    const frame = computeShareCardFrame(1000, 1000, 600, 600, 0);
    expect(frame).toEqual({ x: 0, y: 0, width: 600, height: 600 });
  });
});

describe('svgToPngCard', () => {
  it('fails cleanly when no canvas is available', async () => {
    // jsdom has no 2D context, which is exactly the "rasterization unavailable" path the
    // share flow must survive: a failed card must never block getting a link.
    await expect(
      svgToPngCard('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', 10, 10, {
        background: '#ffffff',
      })
    ).rejects.toThrow();
  });
});
