import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { SheetGrid, type SheetGridItem } from './SheetGrid';
import { fitSheetThumbnail, type SheetRing, type SheetStroke } from './sheetThumbnail';
import { sheetThumbnailInk, type SheetThumbnailInk } from './sheetThumbnailInk';

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

/** A square sheet with one diagonal: four edge strokes and a mountain. */
const SQUARE: SheetStroke[] = [
  { x1: 0, y1: 0, x2: 100, y2: 0, role: 'edge' },
  { x1: 100, y1: 0, x2: 100, y2: 100, role: 'edge' },
  { x1: 100, y1: 100, x2: 0, y2: 100, role: 'edge' },
  { x1: 0, y1: 100, x2: 0, y2: 0, role: 'edge' },
  { x1: 0, y1: 0, x2: 100, y2: 100, role: 'mountain' },
];
const OUTLINE: SheetRing = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];
/** An aux line across the middle, edge to edge. */
const AUX: SheetStroke = { x1: 0, y1: 50, x2: 100, y2: 50, role: 'aux' };

const SHEETS: SheetGridItem[] = [
  { id: 0, thumbnail: fitSheetThumbnail(SQUARE, 100, [OUTLINE]), size: '5 creases' },
  { id: 3, thumbnail: fitSheetThumbnail(SQUARE), size: '1 crease', refused: true },
];

/** A style whose pens are told apart by colour. */
const STYLE: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  paper: { front: '#fefefe', back: '#dddddd' },
  edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#010101', width: 1.5 },
  mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, color: '#ff0000', dash: [8, 2, 1, 2] },
  valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, color: '#0000ff' },
  auxCreases: { visible: true, pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, color: '#00ff00' } },
};

function render(
  selected: number | null,
  onSelect: (id: number) => void,
  { sheets = SHEETS, ink = sheetThumbnailInk(STYLE) }: { sheets?: SheetGridItem[]; ink?: SheetThumbnailInk } = {}
) {
  act(() =>
    root?.render(<SheetGrid sheets={sheets} ink={ink} selected={selected} onSelect={onSelect} />)
  );
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
    // Each card carries its thumbnail: four edge strokes and the diagonal.
    expect(first.querySelectorAll('.sheet-card__stroke')).toHaveLength(5);
    expect(first.querySelectorAll('.sheet-card__stroke--edge')).toHaveLength(4);
    expect(first.querySelectorAll('.sheet-card__stroke--mountain')).toHaveLength(1);
  });

  it('draws the pattern in the paper style: its paper, and each line in its pen', () => {
    render(null, () => {});
    const [first, second] = cards();
    const paper = first.querySelector('.sheet-card__paper');
    expect(paper?.getAttribute('fill')).toBe('#fefefe');
    expect(paper?.getAttribute('d')).toBe('M0 0L100 0L100 100L0 100Z');
    // A rail that knows no outline draws no paper.
    expect(second.querySelector('.sheet-card__paper')).toBeNull();
    const edge = first.querySelector('.sheet-card__stroke--edge');
    expect(edge?.getAttribute('stroke')).toBe('#010101');
    expect(Number(edge?.getAttribute('stroke-width'))).toBeCloseTo(1.5 * PT_TO_CSS_PX, 9);
    const mountain = first.querySelector('.sheet-card__stroke--mountain');
    expect(mountain?.getAttribute('stroke')).toBe('#ff0000');
    // The dash is the pen's, in multiples of its on-screen width.
    const width = STYLE.mountainFolds.width * PT_TO_CSS_PX;
    expect(mountain?.getAttribute('stroke-dasharray')).toBe(
      [8, 2, 1, 2].map((run) => Math.round(run * width * 1000) / 1000).join(' ')
    );
  });

  it('draws the aux lines only while the style shows them, pulled back by erode', () => {
    const sheets: SheetGridItem[] = [
      { id: 0, thumbnail: fitSheetThumbnail([...SQUARE, AUX], 100, [OUTLINE]), size: '6 creases' },
    ];
    const aux = () => cards()[0]?.querySelector('.sheet-card__stroke--aux') ?? null;
    render(null, () => {}, { sheets });
    expect(aux()?.getAttribute('stroke')).toBe('#00ff00');
    expect([aux()?.getAttribute('x1'), aux()?.getAttribute('x2')]).toEqual(['0', '100']);
    render(null, () => {}, { sheets, ink: sheetThumbnailInk({ ...STYLE, erode: 0.02 }) });
    // Two hundredths of the sheet off each end that meets the paper's edge.
    expect([aux()?.getAttribute('x1'), aux()?.getAttribute('x2')]).toEqual(['2', '98']);
    render(null, () => {}, { sheets, ink: sheetThumbnailInk(STYLE, false) });
    expect(aux()).toBeNull();
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
  it('fits the strokes into the box, the paper’s edge last', () => {
    const thumbnail = fitSheetThumbnail([AUX, ...SQUARE], 100);
    expect(thumbnail?.viewBox).toBe('0 0 100 100');
    expect(thumbnail?.size).toBe(100);
    const roles = thumbnail?.strokes.map((stroke) => stroke.role) ?? [];
    expect(roles.filter((role) => role === 'edge')).toHaveLength(4);
    // The aux line under the fold, the edge over the creases that end on it.
    expect(roles).toEqual(['aux', 'mountain', 'edge', 'edge', 'edge', 'edge']);
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
      { x1: 0, y1: 0, x2: 200, y2: 0, role: 'edge' },
      { x1: 0, y1: 50, x2: 200, y2: 50, role: 'edge' },
    ];
    const thumbnail = fitSheetThumbnail(strip, 100);
    expect(thumbnail?.strokes.map((stroke) => [stroke.x1, stroke.y1, stroke.x2, stroke.y2])).toEqual(
      [
        [0, 37.5, 100, 37.5],
        [0, 62.5, 100, 62.5],
      ]
    );
  });

  it('fits the paper with the lines, and marks the aux ends that meet it', () => {
    // A paper twice the pattern's size: the fit is the paper's, so the lines
    // sit in its middle.
    const thumbnail = fitSheetThumbnail(
      [{ x1: 50, y1: 100, x2: 150, y2: 100, role: 'aux' }, { ...AUX, x1: 0, x2: 150, y1: 50, y2: 50, role: 'mountain' }],
      100,
      [
        [
          [0, 0],
          [200, 0],
          [200, 200],
          [0, 200],
        ],
      ]
    );
    expect(thumbnail?.paper).toBe('M0 0L100 0L100 100L0 100Z');
    const [aux] = thumbnail?.strokes ?? [];
    expect([aux?.x1, aux?.x2]).toEqual([25, 75]);
    // Neither end of this aux line reaches the paper's edge; a fold is never marked.
    expect(aux?.onBoundary).toEqual([false, false]);
    expect(thumbnail?.strokes[1]?.onBoundary).toEqual([false, false]);
    const edgeToEdge = fitSheetThumbnail([AUX], 100, [OUTLINE]);
    expect(edgeToEdge?.strokes[0]?.onBoundary).toEqual([true, true]);
  });

  it('refuses nothing drawable rather than dividing by zero', () => {
    expect(fitSheetThumbnail([], 100)).toBeNull();
    expect(fitSheetThumbnail([{ x1: 5, y1: 5, x2: 5, y2: 5, role: 'edge' }])).toBeNull();
  });
});
