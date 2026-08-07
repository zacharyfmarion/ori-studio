import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM_EXPONENT,
  PINCH_ZOOM_SENSITIVITY,
  resolveWheelGesture,
  WHEEL_ZOOM_SENSITIVITY,
  type WheelGestureInput,
} from './wheelGesture';

function wheel(overrides: Partial<WheelGestureInput> = {}): WheelGestureInput {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('resolveWheelGesture', () => {
  describe('pan preference (the default)', () => {
    it('pans on an unmodified scroll', () => {
      expect(resolveWheelGesture(wheel({ deltaX: 4, deltaY: 20 }), 'pan')).toEqual({
        kind: 'pan',
        dx: 4,
        dy: 20,
      });
    });

    it('maps shift+scroll onto the horizontal axis', () => {
      expect(resolveWheelGesture(wheel({ deltaY: 20, shiftKey: true }), 'pan')).toEqual({
        kind: 'pan',
        dx: 20,
        dy: 0,
      });
    });

    it('leaves a platform-supplied deltaX alone when shift is held', () => {
      // Some platforms already fold Shift into deltaX; that value wins.
      expect(
        resolveWheelGesture(wheel({ deltaX: 15, deltaY: 3, shiftKey: true }), 'pan')
      ).toEqual({ kind: 'pan', dx: 15, dy: 3 });
    });

    it('zooms on the accel key, on either platform', () => {
      expect(resolveWheelGesture(wheel({ deltaY: -10, metaKey: true }), 'pan').kind).toBe('zoom');
      expect(resolveWheelGesture(wheel({ deltaY: -10, ctrlKey: true }), 'pan').kind).toBe('zoom');
    });

    it('zooms on a pinch', () => {
      expect(resolveWheelGesture(wheel({ deltaY: -3, ctrlKey: true }), 'pan').kind).toBe('zoom');
    });
  });

  describe('zoom preference (classic)', () => {
    it('zooms on an unmodified scroll', () => {
      expect(resolveWheelGesture(wheel({ deltaY: -10 }), 'zoom').kind).toBe('zoom');
    });

    it('reproduces the historical 1.0015^-deltaY curve for a wheel', () => {
      const { factor } = resolveWheelGesture(wheel({ deltaY: -40 }), 'zoom') as {
        factor: number;
      };
      expect(factor).toBeCloseTo(Math.pow(1.0015, 40), 12);
    });

    it('still zooms — never pans — whatever the modifiers', () => {
      for (const mods of [{}, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
        expect(resolveWheelGesture(wheel({ deltaY: -8, ...mods }), 'zoom').kind).toBe('zoom');
      }
    });
  });

  describe('zoom curve', () => {
    it('zooms in on a negative delta and out on a positive one', () => {
      const into = resolveWheelGesture(wheel({ deltaY: -10, metaKey: true }), 'pan') as {
        factor: number;
      };
      const outOf = resolveWheelGesture(wheel({ deltaY: 10, metaKey: true }), 'pan') as {
        factor: number;
      };
      expect(into.factor).toBeGreaterThan(1);
      expect(outOf.factor).toBeLessThan(1);
    });

    it('is a no-op for a zero delta', () => {
      expect(resolveWheelGesture(wheel({ metaKey: true }), 'pan')).toEqual({
        kind: 'zoom',
        factor: 1,
      });
    });

    it('grows monotonically with the delta, below the clamp', () => {
      // The pinch curve saturates at a deltaY of ~7, so stay under it: above
      // the clamp every event is worth the same, which is the point of it.
      const factors = [1, 2, 3, 4, 5, 6].map(
        (delta) =>
          (resolveWheelGesture(wheel({ deltaY: -delta, ctrlKey: true }), 'pan') as {
            factor: number;
          }).factor
      );
      for (let i = 1; i < factors.length; i += 1) {
        expect(factors[i]).toBeGreaterThan(factors[i - 1]);
      }
    });

    it('runs a pinch far faster than the same delta on the wheel curve', () => {
      const pinch = resolveWheelGesture(wheel({ deltaY: -3, ctrlKey: true }), 'pan') as {
        factor: number;
      };
      const mouse = resolveWheelGesture(wheel({ deltaY: -3, metaKey: true }), 'pan') as {
        factor: number;
      };
      expect(pinch.factor).toBeGreaterThan(mouse.factor);
      // The whole point of the change: a pinch step is worth roughly what
      // PINCH/WHEEL sensitivity says, not a rounding error.
      expect(Math.log(pinch.factor) / Math.log(mouse.factor)).toBeCloseTo(
        PINCH_ZOOM_SENSITIVITY / WHEEL_ZOOM_SENSITIVITY,
        6
      );
    });

    it('clamps one event to the per-notch step, so a coarse ctrl+wheel is not a leap', () => {
      // Windows cannot distinguish a synthesised pinch from a real Ctrl+wheel;
      // the clamp is what makes that collision harmless.
      const { factor } = resolveWheelGesture(wheel({ deltaY: -100, ctrlKey: true }), 'pan') as {
        factor: number;
      };
      expect(factor).toBeCloseTo(Math.exp(MAX_ZOOM_EXPONENT), 12);
      expect(factor).toBeCloseTo(1.16, 2);
    });

    it('leaves an ordinary mouse notch exactly at the clamp, unchanged from today', () => {
      const { factor } = resolveWheelGesture(wheel({ deltaY: -100 }), 'zoom') as {
        factor: number;
      };
      expect(factor).toBeCloseTo(Math.pow(1.0015, 100), 12);
    });
  });

  describe('deltaMode normalisation', () => {
    it('treats line deltas as 16px each (Firefox)', () => {
      expect(resolveWheelGesture(wheel({ deltaY: 3, deltaMode: 1 }), 'pan')).toEqual({
        kind: 'pan',
        dx: 0,
        dy: 48,
      });
    });

    it('treats page deltas as 800px each', () => {
      expect(resolveWheelGesture(wheel({ deltaY: 1, deltaMode: 2 }), 'pan')).toEqual({
        kind: 'pan',
        dx: 0,
        dy: 800,
      });
    });

    it('normalises before zooming too', () => {
      const lines = resolveWheelGesture(wheel({ deltaY: -1, deltaMode: 1, metaKey: true }), 'pan');
      const pixels = resolveWheelGesture(wheel({ deltaY: -16, metaKey: true }), 'pan');
      expect(lines).toEqual(pixels);
    });
  });
});
