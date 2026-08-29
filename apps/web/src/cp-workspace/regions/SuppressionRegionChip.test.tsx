import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { CP_VIEWPORT_CANVAS_CLASS } from '../cpViewportCanvas';
import {
  createCpSuppressionRegion,
  type CpCheckClass,
  type CpSuppressionRegion,
} from '../annotations/suppressionRegion';
import { SuppressionRegionChip } from './SuppressionRegionChip';

/**
 * The base chip: what it says while nothing is selected, what it grows when the
 * region is, and the two rules that are not negotiable — it is always on screen,
 * and it never offers Solve.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// FloatingToolbar's autoUpdate attaches a ResizeObserver, absent in jsdom.
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
  expanded?: boolean;
  hiddenCount?: number;
  onSelect?: () => void;
  onToggleCheckClass?: (cpCheckClass: CpCheckClass) => void;
  onDelete?: () => void;
}): void {
  act(() => {
    root.render(
      <TooltipProvider>
        <SuppressionRegionChip
          region={props.region ?? region()}
          container={container}
          expanded={props.expanded ?? false}
          hiddenCount={props.hiddenCount ?? 0}
          onSelect={props.onSelect ?? NOOP}
          onToggleCheckClass={props.onToggleCheckClass ?? NOOP}
          onOpacity={NOOP}
          onGestureStart={NOOP}
          onGestureCommit={NOOP}
          onBringToFront={NOOP}
          onSendToBack={NOOP}
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
  // Offset so the unit-square region sits well inside the pane below: the pill
  // hides for an anchor outside its boundary, and a box pinned to 0,0 would be
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

  it('is its own way in: collapsed, the summary selects the region', () => {
    const onSelect = vi.fn();
    renderChip({ onSelect });

    const summary = chip().querySelector<HTMLButtonElement>('button.cp-region-chip__summary');
    expect(summary).not.toBeNull();
    act(() => summary?.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the controls off the collapsed chip', () => {
    renderChip({ expanded: false });

    expect(chip().querySelector('input[type="range"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Suppressed checks"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Delete"]')).toBeNull();
  });

  it('grows the class menu and the shared annotation actions on selection', () => {
    renderChip({ expanded: true });

    // The summary stops being a button: with the controls on screen there is no
    // selecting left to offer, and a disabled one would read as an action that is
    // temporarily unavailable.
    expect(chip().querySelector('button.cp-region-chip__summary')).toBeNull();
    expect(chip().querySelector('span.cp-region-chip__summary')).not.toBeNull();

    expect(document.querySelector('button[aria-label="Suppressed checks"]')).not.toBeNull();
    expect(chip().querySelector('input[type="range"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Bring to front"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Send to back"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Delete"]')).not.toBeNull();
  });

  it('draws the class menu pressed only while something is suppressed', () => {
    renderChip({ expanded: true });
    expect(
      document.querySelector('button[aria-label="Suppressed checks"]')?.getAttribute('data-active')
    ).toBe('true');

    renderChip({ expanded: true, region: region({ suppress: [] }) });
    expect(
      document.querySelector('button[aria-label="Suppressed checks"]')?.getAttribute('data-active')
    ).toBeNull();
  });

  it('lists the four theorems, ticking the ones the region silences', () => {
    const onToggleCheckClass = vi.fn();
    renderChip({ expanded: true, onToggleCheckClass });

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
    renderChip({ expanded: true, onToggleCheckClass });

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

  it('never offers Solve, selected or not — that is the other component', () => {
    for (const expanded of [false, true]) {
      renderChip({ expanded });
      expect(chip().textContent).not.toContain('Solve');
      expect(chip().textContent).not.toContain('Accept');
      expect(chip().textContent).not.toContain('Try again');
    }
  });

  it('hands a pinch over the chip to the canvas instead of the page', () => {
    renderChip({ expanded: true });

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
    // Far off to the right of the 1000x600 pane. `limitShift` lets the pill follow
    // an anchor out of bounds, so without the intersection test what is left is a
    // pill hovering over a neighbouring pane attached to nothing on screen.
    renderChip({ region: region({ center: { x: 40, y: 40 } }) });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });
});
