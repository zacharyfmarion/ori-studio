import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERENCES_PAPER_TOKENS } from '../references/usePaperStyleTokens';
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

/** A square sheet with one diagonal: four edge strokes and a mountain. */
const SQUARE: SheetStroke[] = [
  { x1: 0, y1: 0, x2: 100, y2: 0, role: 'edge' },
  { x1: 100, y1: 0, x2: 100, y2: 100, role: 'edge' },
  { x1: 100, y1: 100, x2: 0, y2: 100, role: 'edge' },
  { x1: 0, y1: 100, x2: 0, y2: 0, role: 'edge' },
  { x1: 0, y1: 0, x2: 100, y2: 100, role: 'mountain' },
];
/** An aux line across the middle, edge to edge. */
const AUX: SheetStroke = { x1: 0, y1: 50, x2: 100, y2: 50, role: 'aux' };

const SHEETS: SheetGridItem[] = [
  { id: 0, thumbnail: fitSheetThumbnail(SQUARE), size: '5 creases' },
  { id: 3, thumbnail: fitSheetThumbnail(SQUARE), size: '1 crease', refused: true },
];

function render(
  selected: number | null,
  onSelect: (id: number) => void,
  { sheets = SHEETS, showAux = true }: { sheets?: SheetGridItem[]; showAux?: boolean } = {}
) {
  act(() =>
    root?.render(
      <SheetGrid sheets={sheets} showAux={showAux} selected={selected} onSelect={onSelect} />
    )
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
    // Each card carries its thumbnail: four edge strokes and the diagonal,
    // classed by role so the stylesheet inks them as the canvas does.
    expect(first.querySelectorAll('.sheet-card__stroke')).toHaveLength(5);
    expect(first.querySelectorAll('.sheet-card__stroke--edge')).toHaveLength(4);
    expect(first.querySelectorAll('.sheet-card__stroke--mountain')).toHaveLength(1);
  });

  it('leaves every ink to the stylesheet: no paper, and no pen on a line', () => {
    render(null, () => {});
    const [first] = cards();
    const svg = first.querySelector('svg');
    // Lines only — nothing under them is filled as paper.
    expect([...(svg?.children ?? [])].every((child) => child.tagName === 'line')).toBe(true);
    for (const line of first.querySelectorAll('.sheet-card__stroke')) {
      for (const attribute of ['stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap']) {
        expect(line.hasAttribute(attribute), attribute).toBe(false);
      }
    }
  });

  it('draws the aux lines while the rail shows them, end to end', () => {
    const sheets: SheetGridItem[] = [
      { id: 0, thumbnail: fitSheetThumbnail([...SQUARE, AUX]), size: '6 creases' },
    ];
    const aux = () => cards()[0]?.querySelector('.sheet-card__stroke--aux') ?? null;
    render(null, () => {}, { sheets });
    // Not pulled back from the paper's edge: erode is the paper style's.
    expect([aux()?.getAttribute('x1'), aux()?.getAttribute('x2')]).toEqual(['0', '100']);
    render(null, () => {}, { sheets, showAux: false });
    expect(aux()).toBeNull();
    // The rest of the pattern is unchanged.
    expect(cards()[0]?.querySelectorAll('.sheet-card__stroke')).toHaveLength(5);
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

/**
 * The cards' inks, read from the stylesheet: jsdom resolves no `var()`, so
 * what a line is drawn in can only be pinned where it is written.
 */
describe('the cards’ stylesheet', () => {
  // Vitest's root is `apps/web`. Resolved from there rather than from
  // `import.meta.url`, which is not a file: URL once Vite has transformed this.
  const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//gu,
    ''
  );

  /** Every block whose selector list names `selector` itself, as declarations. */
  function rules(selector: string): Map<string, string>[] {
    const found: Map<string, string>[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const names = (match[1] ?? '').split(',').map((name) => name.trim());
      if (!names.includes(selector)) continue;
      const declarations = new Map<string, string>();
      for (const declaration of (match[2] ?? '').split(';')) {
        const colon = declaration.indexOf(':');
        if (colon < 0) continue;
        declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
      }
      found.push(declarations);
    }
    return found;
  }

  function rule(selector: string): Record<string, string> {
    const [only, ...rest] = rules(selector);
    expect(only, `no rule for ${selector}`).toBeDefined();
    expect(rest, `more than one rule for ${selector}`).toHaveLength(0);
    return Object.fromEntries(only ?? []);
  }

  it('draws every role solid and non-scaling, at main’s widths', () => {
    expect(rule('.sheet-card__stroke')).toEqual({
      fill: 'none',
      'stroke-width': '1.1',
      'vector-effect': 'non-scaling-stroke',
    });
    expect(rule('.sheet-card__stroke--edge')).toEqual({
      stroke: 'var(--sheet-thumb-border)',
      'stroke-width': '1.6',
    });
    expect(rule('.sheet-card__stroke--mountain')).toEqual({ stroke: 'var(--sheet-thumb-mountain)' });
    expect(rule('.sheet-card__stroke--valley')).toEqual({ stroke: 'var(--sheet-thumb-valley)' });
    // A crease with no direction and an aux line: the unassigned grey, as main drew both.
    expect(rule('.sheet-card__stroke--unassigned')).toEqual({
      stroke: 'var(--sheet-thumb-unassigned)',
    });
    expect(rule('.sheet-card__stroke--aux')).toEqual({ stroke: 'var(--sheet-thumb-unassigned)' });
  });

  it('reads the theme’s inks through aliases on :root, which the References workspace keeps', () => {
    const [rootTokens] = rules(':root');
    expect(rootTokens?.get('--sheet-thumb-border')).toBe('var(--text-tertiary)');
    expect(rootTokens?.get('--sheet-thumb-mountain')).toBe('var(--fold-mountain)');
    expect(rootTokens?.get('--sheet-thumb-valley')).toBe('var(--fold-valley)');
    expect(rootTokens?.get('--sheet-thumb-unassigned')).toBe('var(--fold-unassigned)');
    // The workspace re-sets the `--fold-*` names to the paper style's on its own
    // root, around the rail; an alias it re-set too would carry the style in.
    for (const token of REFERENCES_PAPER_TOKENS) {
      expect(token.startsWith('--sheet-thumb-'), token).toBe(false);
      expect(token, token).not.toBe('--text-tertiary');
    }
  });
});

describe('fitSheetThumbnail', () => {
  it('fits the strokes into the box, the paper’s edge last', () => {
    const thumbnail = fitSheetThumbnail([AUX, ...SQUARE], 100);
    expect(thumbnail?.viewBox).toBe('0 0 100 100');
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

  it('refuses nothing drawable rather than dividing by zero', () => {
    expect(fitSheetThumbnail([], 100)).toBeNull();
    expect(fitSheetThumbnail([{ x1: 5, y1: 5, x2: 5, y2: 5, role: 'edge' }])).toBeNull();
  });
});
