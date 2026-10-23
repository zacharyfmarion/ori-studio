import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFitLevel } from './useFitLevel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * jsdom lays nothing out, so the widths are the test's: a part is as wide as
 * its `data-w`, the row as its `data-cw`, and a resize is delivered by hand.
 */
const width = (element: HTMLElement, key: 'w' | 'cw') => Number(element.dataset[key] ?? 0);
const observed: (() => void)[] = [];

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return width(this, 'w');
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return width(this, 'w');
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return width(this, 'cw');
  });
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(() => document.body);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        observed.push(this.callback);
      }
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
    run();
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  observed.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A row whose one part needs `needs[level]` px, in a row `available` px wide. */
function Row({ levels, needs, available }: { levels: number; needs: number[]; available: number }) {
  const { level, rowRef } = useFitLevel(levels);
  return (
    <div ref={rowRef} data-cw={available} data-level={level}>
      <span data-w={needs[level]} />
    </div>
  );
}

function render(props: { levels: number; needs: number[]; available: number }): HTMLElement {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root?.render(<Row {...props} />));
  return host.firstElementChild as HTMLElement;
}

const level = (row: HTMLElement) => Number(row.dataset.level);
const resize = (row: HTMLElement, available: number) =>
  act(() => {
    row.dataset.cw = String(available);
    for (const notify of observed) notify();
  });

describe('useFitLevel', () => {
  it('stays inline while everything fits', () => {
    expect(level(render({ levels: 3, needs: [300, 200, 100], available: 400 }))).toBe(0);
  });

  it('collapses as far as it must, and no further', () => {
    expect(level(render({ levels: 3, needs: [600, 450, 300], available: 500 }))).toBe(1);
  });

  it('stops at the last level even when that does not fit', () => {
    expect(level(render({ levels: 3, needs: [600, 450, 300], available: 200 }))).toBe(2);
  });

  it('comes back up only once the row has what the level above needed', () => {
    const row = render({ levels: 3, needs: [600, 450, 300], available: 400 });
    // 400 is short of 450, so the measure at level 1 went on to 2.
    expect(level(row)).toBe(2);
    resize(row, 449);
    expect(level(row)).toBe(2);
    resize(row, 450);
    expect(level(row)).toBe(1);
    resize(row, 700);
    expect(level(row)).toBe(0);
    resize(row, 500);
    expect(level(row)).toBe(1);
  });

  it('measures nothing with one level, and starts over when the levels change', () => {
    expect(level(render({ levels: 1, needs: [600], available: 100 }))).toBe(0);
    expect(level(render({ levels: 2, needs: [600, 50], available: 100 }))).toBe(1);
    expect(level(render({ levels: 3, needs: [90, 50, 10], available: 100 }))).toBe(0);
  });
});
