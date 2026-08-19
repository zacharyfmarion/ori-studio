import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OristudioBpCoverageRegion, OristudioBpSheet } from '../../engine/oristudioBpTypes';
import { bpPackingPaperRect } from '../../lib/bpPackingViewport';
import { BpPackingEmptySpaceLayer } from './BpPackingEmptySpaceLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sheet: OristudioBpSheet = {
  kind: 'rectangular',
  width: 16,
  height: 16,
  grid: { kind: 'rectangular', interval: 1, snap: true },
};

/** Two flaps whose regions overlap — the shape an invalid packing takes. */
const overlapping: OristudioBpCoverageRegion[] = [
  {
    id: 'f1:contour:0',
    outer: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ],
    holes: [],
  },
  {
    id: 'f2:contour:0',
    outer: [
      { x: 4, y: 4 },
      { x: 12, y: 4 },
      { x: 12, y: 12 },
      { x: 4, y: 12 },
    ],
    holes: [],
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(coverage: OristudioBpCoverageRegion[]): void {
  act(() => {
    root.render(
      <svg>
        <BpPackingEmptySpaceLayer
          coverage={coverage}
          sheet={sheet}
          paperRect={bpPackingPaperRect(sheet)}
        />
      </svg>,
    );
  });
}

describe('BpPackingEmptySpaceLayer', () => {
  it('masks the sheet with one even-odd region per flap or river', () => {
    render(overlapping);
    const paths = [...container.querySelectorAll('mask path')];

    // One path per region, never one merged path: overlapping regions would
    // cancel under a shared even-odd fill and paint the conflict as empty.
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.getAttribute('fill-rule') === 'evenodd')).toBe(true);
    expect(
      container
        .querySelector('.bp-packing-empty-space-fill')
        ?.closest('[mask]')
        ?.getAttribute('mask'),
    ).toBe(`url(#${container.querySelector('mask')?.id})`);
  });

  it('tints the empty paper and hatches it, without outlining it', () => {
    render(overlapping);
    const tint = container.querySelector('.bp-packing-empty-space-fill');
    const lines = container.querySelector('.bp-packing-empty-space-lines');
    const hatch = container.querySelector('pattern');

    // The tint takes its colour from the stylesheet; only the hatch names a fill.
    expect(tint?.getAttribute('fill')).toBeNull();
    expect(lines?.getAttribute('fill')).toBe(`url(#${hatch?.id})`);
    expect(hatch?.getAttribute('patternTransform')).toBe('rotate(45)');

    // Both are cut out by the one mask, so the tint and the hatch always mark
    // the same paper.
    const masked = container.querySelector(
      `g[mask="url(#${container.querySelector('mask')?.id})"]`,
    );
    expect(masked?.contains(tint as Node)).toBe(true);
    expect(masked?.contains(lines as Node)).toBe(true);

    // No outline: a box around each gap reads as a region of its own rather
    // than as paper going unused.
    expect(tint?.getAttribute('stroke')).toBeNull();
    expect(container.querySelector('.bp-packing-empty-space > path')).toBeNull();
  });

  it('shades nothing when no layout has been computed', () => {
    render([]);
    expect(container.querySelector('.bp-packing-empty-space-fill')).toBeNull();
  });
});
