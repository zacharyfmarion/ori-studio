import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Point } from '../../lib/geometry';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { ToolOptionLayer } from './ToolOptionLayer';
import { FRAME_PADDING_CSS } from './toolOptionPlacement';
import { boundsOfPoints, type CpToolOptionWindow } from './toolOptionWindow';

/** Same stub as `CpToolOptionLayer.test.tsx`, and local for the same reason. */
class StubResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 1000, height: 800 } } as ResizeObserverEntry],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}

/**
 * A pane's camera that is nothing like Edit's: doubled, and offset, so a frame
 * placed through any other camera lands somewhere visibly different.
 */
const PANE_VIEW: CpOverlayView = { origin: [100, 50], ex: [2, 0], ey: [0, 2] };

/**
 * The second tool, sketched: a choice between the ways a flap can open.
 *
 * Deliberately unlike either of Edit's tools. Each answer is a *different
 * region*, so the frame has to move as you step, where the angle solve frames
 * the same three creases throughout; the stepper wraps; and the tool owns all of
 * it — which answer is showing, whether the question is still open, what
 * applying commits. If adopting the window took anything beyond writing this
 * descriptor, the abstraction was not one.
 */
interface Opening {
  note: string;
  points: Point[];
}

const OPENINGS: readonly Opening[] = [
  {
    note: 'Opens toward the edge',
    points: [
      { x: 10, y: 10 },
      { x: 40, y: 30 },
    ],
  },
  {
    note: 'Opens toward the centre',
    points: [
      { x: 60, y: 10 },
      { x: 90, y: 50 },
    ],
  },
  {
    note: 'Opens both ways',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
    ],
  },
];

function OpeningChooser({
  view,
  onCommit,
}: {
  view: CpOverlayView | null;
  onCommit: (opening: Opening) => void;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const opening = OPENINGS[index];
  const bounds = boundsOfPoints(opening.points);
  const option: CpToolOptionWindow | null =
    open && bounds
      ? {
          bounds,
          index,
          count: OPENINGS.length,
          note: opening.note,
          onStep: (delta) =>
            setIndex((current) => (current + delta + OPENINGS.length) % OPENINGS.length),
          onApply: () => {
            onCommit(opening);
            setOpen(false);
          },
          onCancel: () => setOpen(false),
        }
      : null;
  return <ToolOptionLayer option={option} view={view} />;
}

describe('ToolOptionLayer, from a second tool', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const render = (view: CpOverlayView | null, onCommit: (opening: Opening) => void = vi.fn()) => {
    act(() => root.render(<OpeningChooser view={view} onCommit={onCommit} />));
  };

  // Found by role and name, not by the window's classes.
  const header = () => host.querySelector<HTMLElement>('[role="group"]');
  /** The framed box: the header is attached to it, so it is the header's parent. */
  const frame = () => header()?.parentElement ?? null;
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find(
      (candidate) =>
        candidate.getAttribute('aria-label') === name || candidate.textContent?.trim() === name
    )!;

  /** The frame around `points` under {@link PANE_VIEW}, in CSS px. */
  const expectFramed = (points: readonly Point[]) => {
    const box = boundsOfPoints(points)!;
    const left = PANE_VIEW.origin[0] + box.minX * 2 - FRAME_PADDING_CSS;
    const top = PANE_VIEW.origin[1] + box.minY * 2 - FRAME_PADDING_CSS;
    expect(frame()!.style.transform).toBe(`translate(${left}px, ${top}px)`);
    expect(frame()!.style.width).toBe(`${(box.maxX - box.minX) * 2 + FRAME_PADDING_CSS * 2}px`);
    expect(frame()!.style.height).toBe(`${(box.maxY - box.minY) * 2 + FRAME_PADDING_CSS * 2}px`);
  };

  it('frames the answer through the camera it is given', () => {
    render(PANE_VIEW);
    expectFramed(OPENINGS[0].points);
    expect(host.textContent).toContain('1 of 3');
    expect(host.textContent).toContain('Opens toward the edge');
  });

  it("never reads Edit's camera", () => {
    // The bug this generalisation exists to rule out: two cameras share one
    // type, so a layer that read the singleton would type-check and still draw
    // over the wrong canvas.
    cpOverlayViewStore.set({
      model: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
      user: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
    });
    render(PANE_VIEW);
    expectFramed(OPENINGS[0].points);
    act(() => {
      cpOverlayViewStore.set({
        model: { origin: [300, 300], ex: [5, 0], ey: [0, 5] },
        user: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
      });
    });
    expectFramed(OPENINGS[0].points);
  });

  it('follows its own camera when the pane pans', () => {
    render(PANE_VIEW);
    const before = frame()!.style.transform;
    render({ ...PANE_VIEW, origin: [140, 50] });
    expect(frame()!.style.transform).not.toBe(before);
    expect(frame()!.style.width).toBe(`${30 * 2 + FRAME_PADDING_CSS * 2}px`);
  });

  it('renders nothing until its surface has a camera', () => {
    render(null);
    expect(header()).toBeNull();
    expect(host.childElementCount).toBe(0);
  });

  it('moves the frame to each answer as the tool steps, wrapping at the ends', () => {
    render(PANE_VIEW);
    act(() => button('Next option').click());
    expect(host.textContent).toContain('2 of 3');
    expect(host.textContent).toContain('Opens toward the centre');
    expectFramed(OPENINGS[1].points);

    act(() => button('Previous option').click());
    act(() => button('Previous option').click());
    expect(host.textContent).toContain('3 of 3');
    expectFramed(OPENINGS[2].points);
  });

  it('applies the answer the tool is showing, and closes', () => {
    const onCommit = vi.fn();
    render(PANE_VIEW, onCommit);
    act(() => button('Next option').click());
    act(() => button('Apply').click());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(OPENINGS[1]);
    expect(header()).toBeNull();
  });

  it('keeps its header and note in view only for a surface that asks, pinned to the frame otherwise', () => {
    // A header and a note wider than the frame, which sits near the layer's left edge.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 40,
      width: 300,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect);
    const note = () => [...host.querySelectorAll('p')].find((element) => element.textContent === OPENINGS[0].note)!;
    try {
      render(PANE_VIEW);
      // Pinned to the frame's right edge, as on Edit's canvas: the stylesheet places both.
      expect(header()!.style.right).toBe('');
      expect(note().style.right).toBe('');

      const option: CpToolOptionWindow = {
        bounds: boundsOfPoints(OPENINGS[0].points)!,
        index: 0,
        count: OPENINGS.length,
        note: OPENINGS[0].note,
        onStep: vi.fn(),
        onApply: vi.fn(),
        onCancel: vi.fn(),
      };
      act(() => root.render(<ToolOptionLayer option={option} view={PANE_VIEW} keepInView={{ coveredBottom: 300 }} />));
      // The frame's right edge is at 196 px: 300 px wide, both would start at -104; kept in view, at 8.
      expect(header()!.style.right).toBe('-112px');
      expect(note().style.right).toBe('-112px');
      expect(note().style.visibility).toBe('');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('cancels without committing anything', () => {
    const onCommit = vi.fn();
    render(PANE_VIEW, onCommit);
    act(() => button('Cancel').click());
    expect(onCommit).not.toHaveBeenCalled();
    expect(header()).toBeNull();
  });
});
