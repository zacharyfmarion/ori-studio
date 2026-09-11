import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { ReferencesSheetGrid } from './ReferencesSheetGrid';
import type { ReferencesSheet } from './referencesSheets';
import type { PrecreaseComponent } from './sheetFrames';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** A unit square with one diagonal: border 0-3, crease 4. */
const GEOMETRY = {
  segEndpoints: Float64Array.from([
    0, 0, 100, 0, 100, 0, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0, 0, 0, 100, 100,
  ]),
  segAttr: new Int32Array(25),
} as unknown as CpGeometryTransport;

function component(id: number): PrecreaseComponent {
  return {
    id,
    border_segment_indices: [0, 1, 2, 3],
    segment_indices: [4],
  } as unknown as PrecreaseComponent;
}

const SHEETS: ReferencesSheet[] = [
  { id: 0, plannable: true, creaseCount: 5 },
  { id: 3, plannable: false, creaseCount: 1 },
];

function render(selected: number | null, onSelect: (component: number) => void) {
  act(() =>
    root?.render(
      <ReferencesSheetGrid
        sheets={SHEETS}
        components={[component(0), component(3)]}
        geometry={GEOMETRY}
        selected={selected}
        onSelect={onSelect}
      />
    )
  );
}

function cards(): HTMLButtonElement[] {
  return [...(container?.querySelectorAll<HTMLButtonElement>('.references-sheet') ?? [])];
}

describe('ReferencesSheetGrid', () => {
  it('draws a card per sheet, the selected one marked and the refused one greyed', () => {
    render(3, () => {});
    const [first, second] = cards();
    expect(cards()).toHaveLength(2);
    expect(first.getAttribute('aria-selected')).toBe('false');
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(second.classList.contains('references-sheet--selected')).toBe(true);
    expect(second.classList.contains('references-sheet--refused')).toBe(true);
    // Numbered by position in the list, with the crease count under each.
    expect(first.querySelector('.references-sheet__index')?.textContent).toBe('1');
    expect(first.querySelector('.references-sheet__count')?.textContent).toBe('5 creases');
    expect(second.querySelector('.references-sheet__count')?.textContent).toBe('1 crease');
    // Each card carries its thumbnail: four border strokes and the diagonal.
    expect(first.querySelectorAll('.references-sheet__stroke')).toHaveLength(5);
  });

  it('reports a press by the sheet id, not its position', () => {
    const onSelect = vi.fn();
    render(0, onSelect);
    act(() => cards()[1]?.click());
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('reports a press on the selected card too, so a phone can open it', () => {
    const onSelect = vi.fn();
    render(0, onSelect);
    act(() => cards()[0]?.click());
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});
