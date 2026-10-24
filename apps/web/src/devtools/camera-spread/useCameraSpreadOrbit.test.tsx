import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraSpreadOptions } from '../../cp-workspace/folded/cameraSpreadScene';
import { useCameraSpreadOrbit } from './useCameraSpreadOrbit';

let root: Root;
let host: HTMLDivElement;
let canvas: HTMLCanvasElement;
const captures = new Set<number>();
const onOrbit = vi.fn();
const initial: CameraSpreadOptions = {
  amount: 0.06,
  directionDeg: 247,
  inclinationDeg: 45,
  projection: 'perspective',
};
function Harness({ projection }: { projection: CameraSpreadOptions['projection'] }) {
  const [pose, setPose] = useState(initial);
  const events = useCameraSpreadOrbit({ ...pose, projection }, (next) => {
    onOrbit(next);
    setPose((current) => ({ ...current, ...next }));
  });
  return <canvas {...events} />;
}
function render(projection: CameraSpreadOptions['projection'] = 'perspective') {
  act(() => root.render(<Harness projection={projection} />));
  canvas = host.querySelector('canvas')!;
  canvas.setPointerCapture = (id) => {
    captures.add(id);
  };
  canvas.releasePointerCapture = (id) => {
    captures.delete(id);
  };
  canvas.hasPointerCapture = (id) => captures.has(id);
}
function pointer(type: string, values: PointerEventInit = {}) {
  act(() =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        isPrimary: true,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 100,
        ...values,
      })
    )
  );
}
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  captures.clear();
  onOrbit.mockClear();
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('camera preview pointer orbit', () => {
  it('captures a primary drag and preserves the anchor through React updates', () => {
    pointer('pointerdown');
    pointer('pointermove', { clientX: 140 });
    const first = onOrbit.mock.lastCall![0];
    pointer('pointermove', { clientX: 140 });
    expect(onOrbit.mock.lastCall![0]).toEqual(first);
    expect(captures.has(1)).toBe(true);
    expect(canvas.dataset.dragging).toBe('true');
    pointer('pointerup');
    expect(captures.size).toBe(0);
    expect(canvas.dataset.dragging).toBe('false');
    pointer('pointermove', { clientX: 200 });
    expect(onOrbit).toHaveBeenCalledTimes(2);
  });
  it('ignores other buttons and pointers, including additional touches', () => {
    pointer('pointerdown', { button: 2 });
    pointer('pointermove');
    expect(onOrbit).not.toHaveBeenCalled();
    pointer('pointerdown', { pointerType: 'touch' });
    pointer('pointerdown', { pointerId: 2, isPrimary: false, pointerType: 'touch' });
    pointer('pointermove', { pointerId: 2, clientX: 200 });
    expect(onOrbit).not.toHaveBeenCalled();
    pointer('pointermove', { pointerType: 'touch', buttons: 0, clientY: 140 });
    expect(onOrbit).toHaveBeenCalledOnce();
  });
  it.each(['pointercancel', 'lostpointercapture', 'missed mouse-up'])('ends the gesture on %s', (reason) => {
    pointer('pointerdown');
    if (reason === 'missed mouse-up') pointer('pointermove', { buttons: 0 });
    else pointer(reason);
    pointer('pointermove', { clientX: 200 });
    expect(onOrbit).not.toHaveBeenCalled();
    expect(captures.size).toBe(0);
    expect(canvas.dataset.dragging).toBe('false');
  });
  it('releases capture on mode changes and leaves diagram gestures alone', () => {
    pointer('pointerdown');
    render('diagram');
    expect(captures.size).toBe(0);
    expect(canvas.dataset.orbitable).toBe('false');
    pointer('pointermove', { clientX: 200 });
    pointer('pointerdown');
    expect(onOrbit).not.toHaveBeenCalled();
    expect(captures.size).toBe(0);
    render('orthographic');
    pointer('pointerdown');
    pointer('pointermove', { clientY: 140 });
    expect(onOrbit).toHaveBeenCalledOnce();
    act(() => root.render(null));
    expect(captures.size).toBe(0);
  });
});
