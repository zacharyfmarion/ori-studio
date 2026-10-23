import { describe, expect, it } from 'vitest';
import { bindCpSurfaceInput, isClick } from './cpSurfaceInput';

describe('isClick', () => {
  it('counts movement under the threshold as a click', () => {
    expect(isClick({ x: 10, y: 10 }, { x: 12, y: 13 })).toBe(true);
    expect(isClick({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(false);
  });
});

describe('a tap on the surface', () => {
  /** A canvas with the input bound, whose every press would take hit 7. */
  function bound() {
    const canvas = document.createElement('canvas');
    // jsdom implements neither; the input only needs them not to throw.
    canvas.setPointerCapture = () => undefined;
    canvas.releasePointerCapture = () => undefined;
    const picks: (number | null)[] = [];
    const unbind = bindCpSurfaceInput<number>(canvas, {
      camera: () => null,
      render: () => undefined,
      wheelGesture: () => 'zoom',
      hitAt: () => 7,
      hover: () => undefined,
      setDragging: () => undefined,
      pick: (hit) => picks.push(hit),
    });
    return { canvas, picks, unbind };
  }

  /** A finger down and up at one point: the pointer events, then the touch's end, as a browser sends them. */
  function tap(canvas: HTMLCanvasElement): Event {
    const at = { pointerId: 3, pointerType: 'touch', button: 0, clientX: 20, clientY: 20, bubbles: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', at));
    canvas.dispatchEvent(new PointerEvent('pointerup', at));
    const end = new Event('touchend', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(end);
    return end;
  }

  it('picks, and cancels the touch it ends with: no click follows to what the pick put under the finger', () => {
    const { canvas, picks } = bound();
    const end = tap(canvas);
    expect(picks).toEqual([7]);
    // A cancelled touchend is what stops the browser's compatibility click,
    // which it aims at whatever is under the finger by then: a tool window
    // the pick opened there, say.
    expect(end.defaultPrevented).toBe(true);
  });

  it('leaves touches alone once unbound', () => {
    const { canvas, unbind } = bound();
    unbind();
    expect(tap(canvas).defaultPrevented).toBe(false);
  });
});
