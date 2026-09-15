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

function renderLayer(
  editing: boolean,
  box = createTextAnnotation({ center: { x: 0, y: 0 }, doc: textDocFromPlainText('hello') }),
  onSyncHeight: (id: string, height: number) => void = () => {}
): HTMLElement {
  act(() => {
    root?.render(
      <CpTextAnnotationLayer
        annotations={[box]}
        editingTextId={editing ? box.id : null}
        toolbarContainer={null}
        onChangeText={() => {}}
        onExitEdit={() => {}}
        onDelete={() => {}}
        onSyncHeight={onSyncHeight}
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

/**
 * Height sync from the model side.
 *
 * The observer only sees the DOM box change size. A handle drag that asks for
 * less height than the content needs changes the *model* height while the DOM
 * box, already at the content height, stays put — so that trigger is the
 * layer's own, and without it the selection frame is left shorter than the text.
 */
describe('CpTextAnnotationLayer height sync', () => {
  /** jsdom lays nothing out; pin the rendered box to one content height. */
  const CONTENT_HEIGHT_PX = 40;
  let offsetHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => CONTENT_HEIGHT_PX,
    });
  });

  afterEach(() => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  });

  it('re-syncs the model height when a drag takes it below the content', () => {
    const onSyncHeight = vi.fn();
    const box = createTextAnnotation({
      id: 'text-1',
      center: { x: 0, y: 0 },
      doc: textDocFromPlainText('hello'),
      // The identity view maps one model unit to one CSS pixel.
      height: CONTENT_HEIGHT_PX,
      minHeight: CONTENT_HEIGHT_PX,
    });
    renderLayer(false, box, onSyncHeight);
    // Model and DOM agree, so mounting asks for nothing — the guard against a
    // sync that would feed itself.
    expect(onSyncHeight).not.toHaveBeenCalled();

    // A bottom-handle drag past the content: the floor and the height both
    // drop, the DOM box does not.
    renderLayer(false, { ...box, height: 20, minHeight: 20 }, onSyncHeight);

    expect(onSyncHeight).toHaveBeenCalledTimes(1);
    expect(onSyncHeight).toHaveBeenCalledWith('text-1', CONTENT_HEIGHT_PX);
  });

  it('stays quiet when the dragged height is what the DOM box renders', () => {
    const onSyncHeight = vi.fn();
    const box = createTextAnnotation({
      id: 'text-1',
      center: { x: 0, y: 0 },
      doc: textDocFromPlainText('hello'),
      height: 60,
      minHeight: 60,
    });
    // Stub the DOM at the dragged size for this case: a floor above the content
    // is exactly what the box renders at.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 60,
    });
    renderLayer(false, box, onSyncHeight);
    renderLayer(false, { ...box, height: 60.2, minHeight: 60.2 }, onSyncHeight);

    // Sub-pixel drift is not a reason to write the model.
    expect(onSyncHeight).not.toHaveBeenCalled();
  });
});
