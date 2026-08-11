import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CpTextAnnotationLayer } from './CpTextAnnotationLayer';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { createTextAnnotation, textDocFromPlainText } from './annotations/textAnnotation';
import { CP_VIEWPORT_CANVAS_CLASS } from './cpViewportCanvas';

/**
 * Wheel handling for a text box under edit.
 *
 * The box takes pointer events so the editor can be typed into, which also makes
 * it swallow the wheel — and a trackpad pinch arrives as ctrl+wheel, so anything
 * unclaimed here becomes browser page zoom. A box that is *not* being edited is
 * `pointer-events: none` and never sees a wheel at all; the selection overlay
 * handles that case.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The box's auto-height effect observes itself; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

/** An identity-ish camera, which is all the layer needs to place a box. */
const VIEW = { origin: [0, 0] as const, ex: [1, 0] as const, ey: [0, 1] as const };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let forwarded: WheelEvent[] = [];

function renderLayer(editing: boolean): HTMLElement {
  const box = createTextAnnotation({
    center: { x: 0, y: 0 },
    doc: textDocFromPlainText('hello'),
  });
  act(() => {
    root?.render(
      <CpTextAnnotationLayer
        annotations={[box]}
        editingTextId={editing ? box.id : null}
        toolbarContainer={null}
        onChangeText={() => {}}
        onExitEdit={() => {}}
        onDelete={() => {}}
        onSyncHeight={() => {}}
      />
    );
  });
  const element = container?.querySelector<HTMLElement>('.cp-text-box');
  if (!element) throw new Error('text box did not render');
  return element;
}

/** Dispatch a trackpad pinch at the box; the browser reports one as ctrl+wheel. */
function pinch(target: HTMLElement): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaY: -80,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  canvas = document.createElement('canvas');
  canvas.className = CP_VIEWPORT_CANVAS_CLASS;
  document.body.appendChild(canvas);
  forwarded = [];
  canvas.addEventListener('wheel', (event) => forwarded.push(event as WheelEvent));
  cpOverlayViewStore.set({ model: VIEW, user: VIEW });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  canvas?.remove();
  root = null;
  container = null;
  canvas = null;
});

describe('CpTextAnnotationLayer wheel handling', () => {
  it('hands a pinch over a box under edit to the canvas instead of the page', () => {
    const box = renderLayer(true);

    const original = pinch(box);

    expect(original.defaultPrevented).toBe(true);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].ctrlKey).toBe(true);
    expect(forwarded[0].deltaY).toBe(-80);
  });

  it('claims a pinch that starts inside the editor itself', () => {
    renderLayer(true);
    const content = container?.querySelector<HTMLElement>('.cp-text-editor__content');
    expect(content).not.toBeNull();

    // The editable fills the box, so in practice the pinch lands on it rather
    // than on the box element; it has to bubble to the box's listener.
    const original = pinch(content as HTMLElement);

    expect(original.defaultPrevented).toBe(true);
    expect(forwarded).toHaveLength(1);
  });
});
