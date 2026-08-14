import { act, useEffect, type PointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpFlap, OristudioBpSheet } from '../../engine/oristudioBpTypes';
import { bpPackingPaperRect } from '../../lib/bpPackingViewport';
import { useBpFlapResize, type BpFlapResize } from '../../hooks/useBpFlapResize';
import type { BpPackingDragRequests } from '../../hooks/useBpPackingDragRequests';
import type { Point } from '../../lib/geometry';
import { BpFlapResizeHandles } from './BpFlapResizeHandles';

/**
 * The handles and the gesture behind them, driven through the real hook.
 *
 * Testing the two together rather than the layer alone, because the parts worth
 * asserting are joint: a drag has to reach the engine as a *footprint*, Escape
 * has to put the flap back, and neither is visible from the markup.
 *
 * jsdom has no pointer capture, so the handle elements are given no-op
 * implementations. Nothing here depends on capture semantics — the events are
 * dispatched at the handle either way.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../analytics', () => ({ track: vi.fn() }));

const SHEET: OristudioBpSheet = {
  kind: 'rectangular',
  width: 40,
  height: 40,
  grid: { kind: 'rectangular', interval: 1, snap: true },
};

function flap(overrides: Partial<OristudioBpFlap> = {}): OristudioBpFlap {
  return {
    id: 1,
    vertexId: 1,
    name: 'A',
    anchor: { x: 20, y: 20 },
    width: 4,
    height: 4,
    radius: 4,
    constrained: true,
    ...overrides,
  };
}

const dragRequests = {
  beginFlapDrag: vi.fn(),
  queueFlapDrag: vi.fn(),
  flushFlapDrag: vi.fn(),
  beginDeviceDrag: vi.fn(),
  queueDeviceDrag: vi.fn(),
  flushDeviceDrag: vi.fn(),
  beginFlapReshape: vi.fn(),
  queueFlapReshape: vi.fn(),
  flushFlapReshape: vi.fn(),
} satisfies BpPackingDragRequests;

let container: HTMLDivElement;
let root: Root;
/** The grid point the next pointer event reports, standing in for the camera. */
let pointer: Point = { x: 0, y: 0 };
const held: { resize: BpFlapResize | null } = { resize: null };

function Harness({ source, selfMirrored }: { source: OristudioBpFlap | null; selfMirrored: boolean }) {
  const resize = useBpFlapResize({
    flap: selfMirrored ? null : source,
    sheet: SHEET,
    radiusRange: { min: 1, max: 100 },
    unit: 30,
    disabled: false,
    eventToPackingPoint: () => pointer,
    dragRequests,
  });
  useEffect(() => {
    held.resize = resize;
  }, [resize]);
  if (!resize.flap) return null;
  return (
    <svg>
      <BpFlapResizeHandles
        flap={resize.flap}
        sheet={SHEET}
        paperRect={bpPackingPaperRect(SHEET)}
        resize={resize}
      />
    </svg>
  );
}

function render(options: { source?: OristudioBpFlap | null; selfMirrored?: boolean } = {}) {
  act(() => {
    root.render(
      <Harness
        source={options.source === undefined ? flap() : options.source}
        selfMirrored={options.selfMirrored ?? false}
      />
    );
  });
}

function handles(): HTMLElement[] {
  return [...container.querySelectorAll('[data-bp-flap-handle]')] as HTMLElement[];
}

function handle(name: string): HTMLElement {
  const found = container.querySelector(`[data-bp-flap-handle="${name}"]`);
  if (!found) throw new Error(`no ${name} handle`);
  return found as HTMLElement;
}

/** One whole gesture: grab the handle, move to `to`, release. */
function dragTo(name: string, to: Point, options: { release?: boolean } = {}) {
  const target = handle(name);
  act(() => {
    pointer = handleGridPoint(name);
    held.resize?.onHandlePointerDown(fakeEvent(target), nameAsHandle(name));
    pointer = to;
    held.resize?.onHandlePointerMove(fakeEvent(target));
    if (options.release !== false) held.resize?.onHandlePointerUp(fakeEvent(target));
  });
}

/** Where a handle sits in grid space, so the grab offset comes out zero. */
function handleGridPoint(name: string): Point {
  const source = flap();
  const box = {
    x: source.anchor.x - source.radius,
    y: source.anchor.y - source.radius,
    width: source.width + source.radius * 2,
    height: source.height + source.radius * 2,
  };
  const along = (sign: number, low: number, span: number) =>
    sign === -1 ? low : sign === 1 ? low + span : low + span / 2;
  const signs: Record<string, { sx: number; sy: number }> = {
    e: { sx: 1, sy: 0 },
    n: { sx: 0, sy: 1 },
    ne: { sx: 1, sy: 1 },
  };
  return {
    x: along(signs[name].sx, box.x, box.width),
    y: along(signs[name].sy, box.y, box.height),
  };
}

function nameAsHandle(name: string) {
  return name as Parameters<BpFlapResize['onHandlePointerDown']>[1];
}

function fakeEvent(target: HTMLElement): PointerEvent<SVGElement> {
  return {
    pointerId: 1,
    currentTarget: target,
    stopPropagation: () => undefined,
  } as unknown as PointerEvent<SVGElement>;
}

beforeEach(() => {
  container = window.document.createElement('div');
  window.document.body.append(container);
  root = createRoot(container);
  for (const fn of Object.values(dragRequests)) fn.mockClear();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  held.resize = null;
});

describe('BpFlapResizeHandles', () => {
  it('draws all eight handles for a selected flap', () => {
    render();
    expect(handles().map((element) => element.dataset.bpFlapHandle).sort()).toEqual([
      'e',
      'n',
      'ne',
      'nw',
      's',
      'se',
      'sw',
      'w',
    ]);
  });

  it('draws none when nothing is selected', () => {
    render({ source: null });
    expect(handles()).toHaveLength(0);
  });

  it('draws none for a flap too small to hold them apart', () => {
    // The eight handles would cover each other and the flap, and a click meant
    // to move it would resize it instead.
    render({ source: flap({ width: 0, height: 0, radius: 0.1 }) });
    expect(handles()).toHaveLength(0);
  });

  it('draws none for a flap that is its own mirror', () => {
    render({ selfMirrored: true });
    expect(handles()).toHaveLength(0);
  });

  it('sends a footprint, not a position, and settles on release', () => {
    render();
    // Outer box is 12 x 12 at (16,16); dragging the east edge two cells out
    // makes it 14 x 12, and the radius fills that as far as the short side
    // allows (6), leaving the two extra cells as width.
    dragTo('e', { x: 30, y: 20 });
    expect(dragRequests.beginFlapReshape).toHaveBeenCalled();
    expect(dragRequests.queueFlapReshape).toHaveBeenCalledWith({
      id: 1,
      footprint: { anchor: { x: 22, y: 22 }, width: 2, height: 0, radius: 6 },
    });
    expect(dragRequests.flushFlapReshape).toHaveBeenCalledTimes(1);
  });

  it('does not settle a grab that never moved', () => {
    render();
    const target = handle('e');
    act(() => {
      pointer = handleGridPoint('e');
      held.resize?.onHandlePointerDown(fakeEvent(target), nameAsHandle('e'));
      held.resize?.onHandlePointerUp(fakeEvent(target));
    });
    expect(dragRequests.flushFlapReshape).not.toHaveBeenCalled();
  });

  it('puts the flap back on Escape', () => {
    render();
    dragTo('e', { x: 30, y: 20 }, { release: false });
    dragRequests.flushFlapReshape.mockClear();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(dragRequests.flushFlapReshape).toHaveBeenCalledWith({
      id: 1,
      footprint: { anchor: { x: 20, y: 20 }, width: 4, height: 4, radius: 4 },
    });
  });

  it('stops listening for Escape once the gesture ends', () => {
    render();
    dragTo('e', { x: 30, y: 20 });
    dragRequests.flushFlapReshape.mockClear();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(dragRequests.flushFlapReshape).not.toHaveBeenCalled();
  });
});
