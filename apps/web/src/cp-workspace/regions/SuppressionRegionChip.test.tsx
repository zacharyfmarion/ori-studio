import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { CP_VIEWPORT_CANVAS_CLASS } from '../cpViewportCanvas';
import type { Vec2 } from '../annotations/annotationTransform';
import {
  createCpSuppressionRegion,
  type CpCheckClass,
  type CpSuppressionRegion,
} from '../annotations/suppressionRegion';
import { SuppressionRegionChip } from './SuppressionRegionChip';

/**
 * The base chip: what it says, the controls it carries, and the three rules that
 * are not negotiable — it is always on screen, *all* of it is always on screen,
 * and it never offers Solve.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The bar measures its own height through one, and jsdom has none.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

let host: HTMLDivElement;
let container: HTMLDivElement;
let canvas: HTMLCanvasElement;
let root: Root;
let forwarded: WheelEvent[] = [];

const NOOP = () => {};

function region(patch: Partial<CpSuppressionRegion> = {}): CpSuppressionRegion {
  return {
    ...createCpSuppressionRegion({ center: { x: 0.5, y: 0.5 }, width: 1, height: 1 }),
    ...patch,
  };
}

function renderChip(props: {
  region?: CpSuppressionRegion;
  hiddenCount?: number;
  onSelect?: () => void;
  onToggleCheckClass?: (cpCheckClass: CpCheckClass) => void;
  onMove?: (center: Vec2) => void;
  onGestureStart?: () => void;
  onGestureCommit?: (label: string) => void;
  onDelete?: () => void;
}): void {
  act(() => {
    root.render(
      <TooltipProvider>
        <SuppressionRegionChip
          region={props.region ?? region()}
          container={container}
          hiddenCount={props.hiddenCount ?? 0}
          onSelect={props.onSelect ?? NOOP}
          onToggleCheckClass={props.onToggleCheckClass ?? NOOP}
          onMove={props.onMove ?? NOOP}
          onGestureStart={props.onGestureStart ?? NOOP}
          onGestureCommit={props.onGestureCommit ?? NOOP}
          onDelete={props.onDelete ?? NOOP}
        />
      </TooltipProvider>
    );
  });
}

function chip(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[role="toolbar"]');
  if (!element) throw new Error('the chip did not render');
  return element;
}

/** A pointer event jsdom will deliver — it has no `PointerEvent` of its own. */
function pointer(type: string, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
}

/** jsdom implements no pointer capture, and the bar takes one on every drag. */
function stubPointerCapture(element: Element): void {
  const target = element as unknown as Record<string, unknown>;
  target.setPointerCapture = () => {};
  target.hasPointerCapture = () => false;
  target.releasePointerCapture = () => {};
}

/**
 * Open the class menu from the keyboard.
 *
 * Radix opens a dropdown on `pointerdown`, which jsdom does not synthesize from
 * `click()`; Enter on the focused trigger is a real interaction path that it does
 * deliver, so the menu is driven the way a keyboard user drives it.
 */
function openChecksMenu(): void {
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Suppressed checks"]'
  );
  if (!trigger) throw new Error('the class menu trigger did not render');
  act(() => {
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });
}

beforeEach(() => {
  // Offset so the unit-square region sits well inside the pane below: the bar
  // hides for a region outside its boundary, and a box pinned to 0,0 would be
  // deciding that on a one-pixel overlap.
  cpOverlayViewStore.set({
    model: { origin: [100, 100], ex: [200, 0], ey: [0, 200] },
    user: { origin: [100, 100], ex: [200, 0], ey: [0, 200] },
  });
  container = document.createElement('div');
  // jsdom lays nothing out, so the pane the chip is confined to has to be stated.
  container.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  document.body.appendChild(container);
  canvas = document.createElement('canvas');
  canvas.className = CP_VIEWPORT_CANVAS_CLASS;
  document.body.appendChild(canvas);
  forwarded = [];
  canvas.addEventListener('wheel', (event) => forwarded.push(event as WheelEvent));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  container.remove();
  canvas.remove();
});

describe('SuppressionRegionChip', () => {
  it('shows itself without being selected, naming what it silences', () => {
    renderChip({});

    // The whole point of the kind: an unselected suppressor is still visible.
    expect(chip().textContent).toContain('Suppression region');
    expect(chip().textContent).toContain('Kawasaki (angles)');
    expect(chip().textContent).toContain('Big-little-big');
  });

  it('carries the hidden count, and says nothing when there is none', () => {
    renderChip({ hiddenCount: 12 });
    expect(chip().textContent).toContain('12 findings hidden');

    renderChip({ hiddenCount: 1 });
    expect(chip().textContent).toContain('1 finding hidden');

    renderChip({ hiddenCount: 0 });
    expect(chip().textContent).not.toContain('hidden');
  });

  it('says so when a region has been emptied rather than looking like it suppresses nothing named', () => {
    renderChip({ region: region({ suppress: [] }) });
    expect(chip().textContent).toContain('All checks on');
  });

  it('prefers the region label over the default', () => {
    renderChip({ region: region({ label: 'Detected candidate' }) });
    expect(chip().textContent).toContain('Detected candidate');
    expect(chip().textContent).not.toContain('Suppression region');
  });

  it('spans the region rather than sizing to its own content', () => {
    // The region is the unit square under this file's camera: model 0→1 maps to
    // CSS 100→300, so its box is 200 px wide at viewport x=100.
    renderChip({});
    expect(chip().style.width).toBe('200px');
    expect(chip().style.left).toBe('100px');
  });

  it('carries every control without waiting for a selection', () => {
    renderChip({});

    // There is no collapsed state left. Splitting the controls out cost a click
    // to reach anything and made the visible half of a suppressor smaller than
    // the thing it was suppressing.
    expect(document.querySelector('button[aria-label="Suppressed checks"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Delete region"]')).not.toBeNull();
  });

  it('offers no opacity or stacking controls at all', () => {
    renderChip({});

    // Those belong to reference images. Neither says anything about what a
    // filter does, and both crowded out the controls that do.
    expect(chip().querySelector('input[type="range"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Bring to front"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Send to back"]')).toBeNull();
  });

  it('draws the class menu pressed only while something is suppressed', () => {
    renderChip({});
    expect(
      document.querySelector('button[aria-label="Suppressed checks"]')?.getAttribute('data-active')
    ).toBe('true');

    renderChip({ region: region({ suppress: [] }) });
    expect(
      document.querySelector('button[aria-label="Suppressed checks"]')?.getAttribute('data-active')
    ).toBeNull();
  });

  it('lists the four theorems, ticking the ones the region silences', () => {
    renderChip({});

    openChecksMenu();
    const items = [...document.querySelectorAll('[role="menuitemcheckbox"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      'Kawasaki (angles)',
      'Big-little-big',
      'Maekawa (parity)',
      'Vertex closure',
    ]);
    // A tick means *suppressed*, matching the menu's own title — the opposite
    // polarity to the View panel's "show" rows, and right here for that reason.
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'false',
      'false',
    ]);
  });

  it('reports the class the user picked, and stays open for the next one', () => {
    const onToggleCheckClass = vi.fn();
    renderChip({ onToggleCheckClass });

    openChecksMenu();
    const maekawa = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === 'Maekawa (parity)'
    );
    act(() => maekawa?.click());

    expect(onToggleCheckClass).toHaveBeenCalledWith('maekawa');
    // These arrive in runs — the detection preset is two of the four — so closing
    // after each select would cost a reopening per class.
    expect(document.querySelectorAll('[role="menuitemcheckbox"]').length).toBe(4);
  });

  it('selects the region on a press, since the bar is the only handle it has', () => {
    const onSelect = vi.fn();
    renderChip({ onSelect });

    const bar = chip();
    stubPointerCapture(bar);
    act(() => bar.dispatchEvent(pointer('pointerdown', 150, 90)));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('moves the region on a drag, as one gesture', () => {
    const onMove = vi.fn();
    const onGestureStart = vi.fn();
    const onGestureCommit = vi.fn();
    renderChip({ onMove, onGestureStart, onGestureCommit });

    const bar = chip();
    stubPointerCapture(bar);
    act(() => {
      bar.dispatchEvent(pointer('pointerdown', 150, 90));
      bar.dispatchEvent(pointer('pointermove', 190, 90));
      bar.dispatchEvent(pointer('pointermove', 250, 110));
      bar.dispatchEvent(pointer('pointerup', 250, 110));
    });

    // 150 CSS px along x and 20 down, through a camera of 200 px per model unit.
    expect(onMove).toHaveBeenLastCalledWith({ x: 0.5 + 0.5, y: 0.5 + 0.1 });
    // One snapshot and one commit for the whole drag, not one per sample.
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureCommit).toHaveBeenCalledTimes(1);
    expect(onGestureCommit).toHaveBeenCalledWith('Move region');
  });

  it('does not turn a click into a move', () => {
    const onMove = vi.fn();
    const onGestureStart = vi.fn();
    renderChip({ onMove, onGestureStart });

    const bar = chip();
    stubPointerCapture(bar);
    act(() => {
      bar.dispatchEvent(pointer('pointerdown', 150, 90));
      // A pixel of hand tremor. Below the threshold, so no centre is written and
      // no snapshot is opened for a later commit to close with a wrong baseline.
      bar.dispatchEvent(pointer('pointermove', 151, 90));
      bar.dispatchEvent(pointer('pointerup', 151, 90));
    });

    expect(onMove).not.toHaveBeenCalled();
    expect(onGestureStart).not.toHaveBeenCalled();
  });

  it('never drags from a control — a press on delete is a delete', () => {
    const onMove = vi.fn();
    const onDelete = vi.fn();
    renderChip({ onMove, onDelete });

    const bar = chip();
    stubPointerCapture(bar);
    const remove = document.querySelector<HTMLButtonElement>('button[aria-label="Delete region"]');
    if (!remove) throw new Error('the delete button did not render');

    act(() => {
      // Pressed on the button and moved a long way: Radix and every other
      // control here open on `pointerdown`, so a bar that captured the pointer
      // would take the press away from what it was aimed at.
      remove.dispatchEvent(pointer('pointerdown', 260, 90));
      bar.dispatchEvent(pointer('pointermove', 400, 200));
      bar.dispatchEvent(pointer('pointerup', 400, 200));
      remove.click();
    });

    expect(onMove).not.toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('never offers Solve — that is the other component', () => {
    renderChip({});
    expect(chip().textContent).not.toContain('Solve');
    expect(chip().textContent).not.toContain('Accept');
    expect(chip().textContent).not.toContain('Try again');
  });

  it('hands a pinch over the chip to the canvas instead of the page', () => {
    renderChip({});

    // The chip takes pointer events, which also makes it swallow the wheel — and
    // a trackpad pinch arrives as ctrl+wheel, so anything unclaimed here becomes
    // browser page zoom over a canvas the user meant to zoom.
    const event = new WheelEvent('wheel', {
      deltaY: -80,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      chip().dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].deltaY).toBe(-80);
  });

  it('goes away with a region that has left the pane, rather than floating free', () => {
    // Far off to the right of the 1000x600 pane. A bar that slid along the pane
    // edge to stay visible would be attached to nothing on screen.
    renderChip({ region: region({ center: { x: 40, y: 40 } }) });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });
});
