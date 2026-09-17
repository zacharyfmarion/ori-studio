import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SheetGrid, type SheetGridItem } from './SheetGrid';
import { fitSheetThumbnail, type SheetStroke } from './sheetThumbnail';

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

/** A unit square with one diagonal: four border strokes and a mountain. */
const SQUARE: SheetStroke[] = [
  { x1: 0, y1: 0, x2: 100, y2: 0, kind: 'border' },
  { x1: 100, y1: 0, x2: 100, y2: 100, kind: 'border' },
  { x1: 100, y1: 100, x2: 0, y2: 100, kind: 'border' },
  { x1: 0, y1: 100, x2: 0, y2: 0, kind: 'border' },
  { x1: 0, y1: 0, x2: 100, y2: 100, kind: 'mountain' },
];

const SHEETS: SheetGridItem[] = [
  { id: 0, thumbnail: fitSheetThumbnail(SQUARE), size: '5 creases' },
  { id: 3, thumbnail: fitSheetThumbnail(SQUARE), size: '1 crease', refused: true },
];

function render(selected: number | null, onSelect: (id: number) => void) {
  act(() => root?.render(<SheetGrid sheets={SHEETS} selected={selected} onSelect={onSelect} />));
}

function cards(): HTMLButtonElement[] {
  return [...(container?.querySelectorAll<HTMLButtonElement>('.sheet-card') ?? [])];
}

describe('SheetGrid', () => {
  it('draws a card per sheet, the selected one marked and the refused one greyed', () => {
    render(3, () => {});
    const [first, second] = cards();
    expect(cards()).toHaveLength(2);
    expect(first.getAttribute('aria-selected')).toBe('false');
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(second.classList.contains('sheet-card--selected')).toBe(true);
    expect(second.classList.contains('sheet-card--refused')).toBe(true);
    expect(first.classList.contains('sheet-card--refused')).toBe(false);
    // Numbered by position in the list, with the rail's size under each.
    expect(first.querySelector('.sheet-card__index')?.textContent).toBe('1');
    expect(first.querySelector('.sheet-card__count')?.textContent).toBe('5 creases');
    expect(second.querySelector('.sheet-card__count')?.textContent).toBe('1 crease');
    expect(first.title).toBe('Pattern 1: 5 creases');
    // Each card carries its thumbnail: four border strokes and the diagonal,
    // classed by kind so the stylesheet colours them as the canvas does.
    expect(first.querySelectorAll('.sheet-card__stroke')).toHaveLength(5);
    expect(first.querySelectorAll('.sheet-card__stroke--border')).toHaveLength(4);
    expect(first.querySelectorAll('.sheet-card__stroke--mountain')).toHaveLength(1);
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

describe('fitSheetThumbnail', () => {
  it('fits the strokes into the box, the border last', () => {
    const thumbnail = fitSheetThumbnail(SQUARE, 100);
    expect(thumbnail?.viewBox).toBe('0 0 100 100');
    const kinds = thumbnail?.strokes.map((stroke) => stroke.kind) ?? [];
    expect(kinds.filter((kind) => kind === 'border')).toHaveLength(4);
    // The border draws last, over the creases that end on it.
    expect(kinds[kinds.length - 1]).toBe('border');
    expect(kinds[0]).toBe('mountain');
    for (const stroke of thumbnail?.strokes ?? []) {
      for (const value of [stroke.x1, stroke.y1, stroke.x2, stroke.y2]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('keeps the aspect ratio and centres the shorter side', () => {
    // A 200×50 strip: the long side fills the box, the short one sits in the
    // middle — a squashed thumbnail would be a different crease pattern.
    const strip: SheetStroke[] = [
      { x1: 0, y1: 0, x2: 200, y2: 0, kind: 'border' },
      { x1: 0, y1: 50, x2: 200, y2: 50, kind: 'border' },
    ];
    const thumbnail = fitSheetThumbnail(strip, 100);
    expect(thumbnail?.strokes.map((stroke) => [stroke.x1, stroke.y1, stroke.x2, stroke.y2])).toEqual(
      [
        [0, 37.5, 100, 37.5],
        [0, 62.5, 100, 62.5],
      ]
    );
  });

  it('refuses nothing drawable rather than dividing by zero', () => {
    expect(fitSheetThumbnail([], 100)).toBeNull();
    expect(fitSheetThumbnail([{ x1: 5, y1: 5, x2: 5, y2: 5, kind: 'border' }])).toBeNull();
  });
});
