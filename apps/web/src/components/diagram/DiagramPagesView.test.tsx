import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagram, createStep, insertSteps, type DiagramDocument } from '../../diagram/document/diagramDocument';
import { cpStep, stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { DIAGRAM_FONT_FAMILY, type DiagramFontKey, type DiagramFontWeight } from '../../diagram/fonts/diagramFontFaces';
import type { DiagramFonts } from '../../diagram/fonts/diagramFonts';
import { readFontMetrics } from '../../diagram/fonts/fontMetrics';
import { createFontSubsetter, type FontSubsetter } from '../../diagram/fonts/fontSubset';
import { preparedPages, type PreparedDiagramPages } from '../../diagram/pages/diagramPages';
import { TooltipProvider } from '../ui/Tooltip';
import { focusLeavesEnterToSteps, focusOwnsArrowKeys } from '../../diagram/actions/diagramShortcuts';
import { DiagramPagesView } from './DiagramPagesView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FONT_DIR = resolve(process.cwd(), 'src/diagram/fonts');
const FONTS: DiagramFonts = {
  font(key: DiagramFontKey, weight: DiagramFontWeight) {
    if (key !== 'latin') return null;
    const bytes = new Uint8Array(readFileSync(resolve(FONT_DIR, weight === 700 ? 'NotoSans-Bold.ttf' : 'NotoSans-Regular.ttf')));
    return { key, weight, family: DIAGRAM_FONT_FAMILY.latin, tier: 'bundled', bytes, metrics: readFontMetrics(bytes) };
  },
  unavailable: [],
};

let subsetter: FontSubsetter;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  subsetter = await createFontSubsetter(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));
});

const LONG = 'Fold the corner up and crease it firmly. '.repeat(12);

function diagram(): DiagramDocument {
  return insertSteps(
    createDiagram({ title: 'Crane' }),
    [cpStep('step-a'), { ...createStep(() => 'step-empty'), text: 'Nothing yet.' }, { ...cpStep('step-long'), text: LONG }],
    0
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(pages: PreparedDiagramPages, handlers: Partial<Record<'onSelect' | 'onOpen' | 'onPageClick', () => void>> = {}) {
  const document = diagram();
  const props = { onSelect: vi.fn(), onOpen: vi.fn(), onPageClick: vi.fn(), ...handlers };
  act(() =>
    root.render(
      <TooltipProvider>
        <DiagramPagesView
          pages={pages}
          failed={false}
          steps={stepsIn(document)}
          selectedStepId="step-a"
          fitKey="test"
          {...props}
        />
      </TooltipProvider>
    )
  );
  return props;
}

const cells = () => [...host.querySelectorAll<HTMLElement>('[role="option"][data-step-id]')];

describe('DiagramPagesView', () => {
  it('shows each page as its composed image, named and captioned, and says which page is in view', () => {
    render(preparedPages(diagram(), FONTS, subsetter));
    const page = host.querySelector<HTMLElement>('[role="group"][data-page="0"]')!;
    expect(page.getAttribute('aria-label')).toBe('Page 1');
    expect(page.querySelector('img')?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(host.textContent).toContain('Page 1 of 1');
    // The pager: one page, so neither way goes anywhere.
    const turn = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    expect(turn('Previous Page')?.disabled).toBe(true);
    expect(turn('Next Page')?.disabled).toBe(true);
  });

  it('lays the steps over the page as one listbox, the selected one marked and the tab stop', () => {
    render(preparedPages(diagram(), FONTS, subsetter));
    expect(host.querySelector('[role="listbox"]')?.hasAttribute('data-diagram-steps')).toBe(true);
    expect(
      cells().map((cell) => [cell.getAttribute('aria-label'), cell.getAttribute('aria-selected'), cell.tabIndex])
    ).toEqual([
      ['Step 1', 'true', 0],
      ['Step 2', 'false', -1],
      ['Step 3, text doesn’t fit', 'false', -1],
    ]);
  });

  it('leaves Enter and the arrows on a focused step to the Diagram’s keys, as a card does', () => {
    render(preparedPages(diagram(), FONTS, subsetter));
    const cell = cells()[1]!;
    expect(focusLeavesEnterToSteps(cell)).toBe(true);
    expect(focusOwnsArrowKeys(cell)).toBe(false);
  });

  it('names a page by its place when the pages print no numbers', () => {
    const document = diagram();
    const unnumbered = { ...document, page: { ...document.page, pageNumbers: { enabled: false, first: 12 } } };
    const pages = preparedPages(unnumbered, FONTS, subsetter);
    render(pages);
    expect(host.querySelector('[data-page="0"]')?.getAttribute('aria-label')).toBe('Page 1');
    // And by the number it prints when it prints one.
    const numbered = preparedPages({ ...unnumbered, page: { ...unnumbered.page, pageNumbers: { enabled: true, first: 12 } } }, FONTS, subsetter);
    render(numbered);
    expect(host.querySelector('[data-page="0"]')?.getAttribute('aria-label')).toBe('Page 12');
    expect(host.textContent).toContain('Page 1 of 1');
  });

  it('marks an empty step’s picture box and a cut instruction over the page, never in it', () => {
    const pages = preparedPages(diagram(), FONTS, subsetter);
    render(pages);
    expect(host.textContent).toContain('No picture yet');
    expect(host.textContent).toContain('Text doesn’t fit');
    expect(pages.layout.pages[0]!.cells[2]!.textOverflow).toBe(true);
    const svg = pages.compose(0).svg;
    expect(svg).not.toContain('No picture yet');
    expect(svg).not.toContain('doesn’t fit');
  });

  it('selects a step on a press, opens it on a double press, and asks about the page elsewhere', () => {
    const props = render(preparedPages(diagram(), FONTS, subsetter));
    act(() => cells()[1]!.click());
    expect(props.onSelect).toHaveBeenCalledWith('step-empty');
    expect(props.onPageClick).not.toHaveBeenCalled();
    act(() => {
      cells()[2]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(props.onOpen).toHaveBeenCalledWith('step-long');
    act(() => host.querySelector<HTMLElement>('[data-page="0"]')!.click());
    expect(props.onPageClick).toHaveBeenCalledOnce();
  });
});
