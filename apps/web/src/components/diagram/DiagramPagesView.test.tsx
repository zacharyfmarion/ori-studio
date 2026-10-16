import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { act, useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { handleShortcutRuntimeKeyDown } from '../../keyboard/shortcutRuntime';
import { useDiagramShortcuts } from '../../diagram/useDiagramShortcuts';
import {
  createDiagram,
  createStep,
  createTurn,
  insertSteps,
  PAGE_SETTINGS,
  setTitleBlockContent,
  type DiagramDocument,
  type KnownDiagramAnnotation,
} from '../../diagram/document/diagramDocument';
import { cpStep, stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { DIAGRAM_FONT_FAMILY, type DiagramFontKey, type DiagramFontWeight } from '../../diagram/fonts/diagramFontFaces';
import type { DiagramFonts } from '../../diagram/fonts/diagramFonts';
import { readFontMetrics } from '../../diagram/fonts/fontMetrics';
import { createFontSubsetter, type FontSubsetter } from '../../diagram/fonts/fontSubset';
import { bandPath } from '../../diagram/pages/composeDiagramPage';
import { preparedPages, type PreparedDiagramPages } from '../../diagram/pages/diagramPages';
import { overflowingDiagram, pastItsBox } from '../../diagram/pages/pageOverflow.fixtures';
import { adoptPageArrangements } from '../../diagram/pages/pageArrangements';
import { usePageInView, type PagesInView } from '../../diagram/pages/pageInView';
import { partBox } from '../../diagram/pages/pagePlacement';
import { PAGES_PX_PER_MM as PX_PER_MM } from '../../diagram/pages/usePagesView';
import { clearPathColorPick, publishPathColorPick } from '../../diagram/pages/pathColorPick';
import { TooltipProvider } from '../ui/Tooltip';
import { focusLeavesEnterToSteps, focusOwnsArrowKeys } from '../../diagram/actions/diagramShortcuts';
import { isApplePlatform } from '../../lib/platform';
import { MAX_ZOOM_EXPONENT } from '../../lib/wheelGesture';
import { DiagramPagesView } from './DiagramPagesView';

// The view tests composition and interaction; bitmap lifecycle has its own browser-independent tests.
vi.mock('./DiagramPagePreview', () => ({
  DiagramPagePreview: ({ src, className }: { src: string; className?: string }) => <img src={src} className={className} alt="" />,
}));

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

/**
 * The diagram on a grid, whose cells cut an instruction too long for them —
 * a flow page's box holds its caption whole (`diagram-flow-packing.md`).
 */
function onGrid(document: DiagramDocument): DiagramDocument {
  return { ...document, page: { ...document.page, layout: 'grid' } };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
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

function render(
  pages: PreparedDiagramPages,
  handlers: Partial<Record<'onSelect' | 'onPageClick', () => void>> = {},
  pathColor = pages.layout.bandInk,
  document = diagram(),
  selectedStepId: string | null = 'step-a'
) {
  const props = { onSelect: vi.fn(), onPageClick: vi.fn(), ...handlers };
  act(() =>
    root.render(
      <TooltipProvider>
        <DiagramPagesView
          pages={pages}
          failed={false}
          steps={stepsIn(document)}
          selectedStepId={selectedStepId}
          pathColor={pathColor}
          fitKey="test"
          {...props}
        />
      </TooltipProvider>
    )
  );
  return props;
}

const cells = () => [...host.querySelectorAll<HTMLElement>('[role="option"][data-step-id]')];
/** The SVG an image shows, from its `data:` URL. */
const svgOf = (image: HTMLImageElement) => Buffer.from(image.src.split(',')[1]!, 'base64').toString('utf8');

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

  it('draws the flow band under the page’s image, which leaves it out, and a colour being picked repaints the band alone', () => {
    const pages = preparedPages(diagram(), FONTS, subsetter);
    const lane = pages.layout.pages[0]!.band!;
    // The file draws the band; the image on screen is the file without it.
    const file = pages.compose(0).svg;
    expect(file).toContain(`<path d="${bandPath(lane)}"`);
    const compose = vi.spyOn(pages, 'compose');
    render(pages, {}, '#ecece8');
    const page = host.querySelector<HTMLElement>('[data-page="0"]')!;
    const image = page.querySelector('img')!;
    const art = svgOf(image);
    expect(art).not.toContain(bandPath(lane));
    expect(art).toBe(pages.compose(0, { band: false }).svg);
    const band = page.querySelector('[data-page-band] path')!;
    expect(band.getAttribute('d')).toBe(bandPath(lane));
    expect(band.getAttribute('stroke')).toBe('#ecece8');
    // Under the image, as the file draws it first.
    expect(page.querySelector('[data-page-band]')!.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const composed = compose.mock.calls.length;
    const src = image.src;
    for (const color of ['#d0e0f0', '#c0d8f0', '#b0d0f0']) {
      act(() => publishPathColorPick(color));
      expect(band.getAttribute('stroke')).toBe(color);
    }
    expect(page.querySelector('img')!.src).toBe(src);
    expect(compose.mock.calls.length).toBe(composed);
    // Written and dropped: the diagram's colour, still no page composed.
    render(pages, {}, '#b0d0f0');
    act(() => clearPathColorPick());
    expect(band.getAttribute('stroke')).toBe('#b0d0f0');
    expect(page.querySelector('img')!.src).toBe(src);
    expect(compose.mock.calls.length).toBe(composed);
  });

  it('lays the steps over the page as one listbox, the selected one marked and the tab stop', () => {
    render(preparedPages(onGrid(diagram()), FONTS, subsetter));
    expect(host.querySelector('[role="listbox"]')?.hasAttribute('data-diagram-steps')).toBe(true);
    expect(
      cells().map((cell) => [cell.getAttribute('aria-label'), cell.getAttribute('aria-selected'), cell.tabIndex])
    ).toEqual([
      ['Step 1', 'true', 0],
      ['Step 2', 'false', -1],
      ['Step 3, text doesn’t fit', 'false', -1],
    ]);
  });

  it('lists a turn where it reads, named by what it is and where, its target the glyph’s own box (D22)', () => {
    const turned = insertSteps(
      insertSteps(diagram(), [createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-a')], 1),
      [createTurn({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } }, () => 'turn-z')],
      4
    );
    render(preparedPages(turned, FONTS, subsetter));
    // A flow page's box holds a long caption whole: nothing is cut. The rotation after the
    // last step has no step after it, so the page leaves it out (Zach, 12 Oct).
    expect(cells().map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'Step 1',
      'Turn over, side to side, between steps 1 and 2',
      'Step 2',
      'Step 3',
    ]);
    expect(host.querySelector('[data-step-id="turn-z"]')).toBeNull();
    const target = host.querySelector<HTMLElement>('[data-step-id="turn-a"]')!;
    // Wider than tall, as the side-to-side turn-over prints.
    expect(parseFloat(target.style.width)).toBeGreaterThan(parseFloat(target.style.height));
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
    const pages = preparedPages(onGrid(diagram()), FONTS, subsetter);
    render(pages);
    expect(host.textContent).toContain('No picture yet');
    expect(host.textContent).toContain('Text doesn’t fit');
    expect(pages.layout.pages[0]!.cells[2]!.textOverflow).toBe(true);
    const svg = pages.compose(0).svg;
    expect(svg).not.toContain('No picture yet');
    expect(svg).not.toContain('doesn’t fit');
    // On a flow page the empty step's box is marked the same, and the long caption, whole, is not cut.
    render(preparedPages(diagram(), FONTS, subsetter));
    expect(host.textContent).toContain('No picture yet');
    expect(host.textContent).not.toContain('Text doesn’t fit');
  });

  it('tags a step placed past the margin, or off the paper, “Outside margin”, and says nothing of a step placed over another', () => {
    const steps = ['s0', 's1', 's2', 's3'].map((id) => cpStep(id));
    // No title block, so the four share page 1.
    const grid = (document: DiagramDocument) => ({
      ...document,
      page: { ...document.page, layout: 'grid' as const, columns: 2, rows: 2, titleBlock: PAGE_SETTINGS.titleBlock.legacy },
    });
    const plain = preparedPages(grid(insertSteps(createDiagram({ title: 'Crane' }), steps, 0)), FONTS, subsetter).layout;
    const [first, second, , fourth] = plain.pages[0]!.cells;
    const { widthMm, marginMm } = plain.paper;
    const fourthFrame = partBox(fourth!, 'frame');
    const fourthRight = fourthFrame.x + fourthFrame.w;
    const placed = grid(
      insertSteps(
        createDiagram({ title: 'Crane' }),
        [
          // Off the paper, past its foot.
          { ...steps[0]!, place: { picture: [0, 400] as [number, number] } },
          // Laid over step 1: an overlap the page shows as it prints.
          { ...steps[1]!, place: { frame: [first!.cellMm.x - second!.cellMm.x, 0] as [number, number] } },
          steps[2]!,
          // Past the right margin, still on the paper.
          { ...steps[3]!, place: { frame: [widthMm - marginMm - fourthRight + 2, 0] as [number, number] } },
        ],
        0
      )
    );
    const pages = preparedPages(placed, FONTS, subsetter);
    render(pages, {}, pages.layout.bandInk, placed, null);
    const tags = [...host.querySelectorAll<HTMLElement>('[data-outside-margin]')];
    expect(tags.map((tag) => [tag.getAttribute('data-outside-margin'), tag.textContent])).toEqual([
      ['s0', 'Outside margin'],
      ['s3', 'Outside margin'],
    ]);
    expect(host.textContent).not.toMatch(/Overlaps|Off the paper|Path doubles back|No longer fits/);
    expect(pages.compose(0).svg).not.toContain('Outside margin');
  });

  it('marks nothing of a flow step past its place: the page shows it, drawn whole', () => {
    const { overflowing, pages } = overflowingDiagram(subsetter);
    render(pages, {}, pages.layout.bandInk, overflowing, null);
    expect(pastItsBox(pages.layout.pages[0]!.cells[2]!)).toBe('caption');
    expect(host.textContent).not.toContain('No longer fits');
    expect(host.querySelector('[data-step-overflow]')).toBeNull();
    expect(cells().map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'Step 1',
      'Step 2',
      'Step 3',
      'Step 4',
      'Step 5',
      'Step 6',
    ]);
  });

  it('puts a target over an enlarge arrow where the page prints it: a press selects the enlarged step, a double press stays on the page', () => {
    const area: KnownDiagramAnnotation = { id: 'area-1', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], radius: 0.2 };
    const document = insertSteps(
      createDiagram({ title: 'Crane' }),
      [
        { ...cpStep('step-area'), annotations: [area] },
        { ...cpStep('step-enlarged'), zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.5, 0.4], radius: 0.2 } } },
      ],
      0
    );
    const pages = preparedPages(document, FONTS, subsetter);
    const props = render(pages, {}, pages.layout.bandInk, document);
    // The arrow is no option of the listbox: the keyboard reaches its steps.
    expect(cells().map((cell) => cell.getAttribute('aria-label'))).toEqual(['Step 1', 'Step 2']);
    const target = host.querySelector<HTMLElement>('[data-zoom-arrow="step-enlarged"]')!;
    expect(target.getAttribute('aria-hidden')).toBe('true');
    const [arrow] = pages.zoomArrows(0);
    // Over the arrow where it prints, lifted to the area: its own box and the pad round it.
    const mm = 96 / 25.4;
    expect(parseFloat(target.style.top)).toBeCloseTo((arrow!.at.y - arrow!.box.h / 2 - 0.75) * mm, 3);
    expect(parseFloat(target.style.width)).toBeCloseTo((arrow!.box.w + 1.5) * mm, 3);
    act(() => target.click());
    expect(props.onSelect).toHaveBeenCalledWith('step-enlarged');
    act(() => {
      target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(useWorkspaceStore.getState().diagramDetail).toBeNull();
    expect(props.onPageClick).not.toHaveBeenCalled();
  });

  it('outlines the first page’s title block over the page, and marks where a part of it prints nothing, never in the page', () => {
    const withBlock = (document: DiagramDocument): DiagramDocument => ({
      ...document,
      page: { ...document.page, titleBlock: { enabled: true, heightShare: 0.27 } },
    });
    const missing = () =>
      [...host.querySelectorAll<HTMLElement>('[data-title-block-missing]')].map((box) => [box.dataset.titleBlockMissing, box.textContent]);
    // Every part shown: the outline alone, where the block is.
    const shown = preparedPages(withBlock(diagram()), FONTS, subsetter);
    render(shown, {}, shown.layout.bandInk, withBlock(diagram()));
    const outline = host.querySelector<HTMLElement>('[data-page="0"] [data-title-block]')!;
    const { block } = shown.layout.pages[0]!.titleBlock!.geometry;
    const { widthMm, heightMm } = shown.layout.paper;
    // Inset into the page as the margin guide is, its foot alone drawn: its top and sides are the margin's, and a line
    // there would run over the subtitle and its rule (Zach, 2026-10-15).
    expect([outline.style.left, outline.style.top, outline.style.right, outline.style.bottom]).toEqual(
      [block.x, block.y, widthMm - block.x - block.w, heightMm - block.y - block.h].map((mm) => `${mm * PX_PER_MM}px`)
    );
    expect(outline.dataset.edges).toBe('foot');
    expect(missing()).toEqual([]);
    // No linked step, no picture: each part of the art says why, in the room it would print in — the pattern and
    // the model, which would stand in the pattern's square, in one box there.
    const bare = withBlock(insertSteps(createDiagram({ title: '' }), [{ ...createStep(() => 'step-empty'), text: 'Nothing yet.' }], 0));
    const empty = preparedPages(bare, FONTS, subsetter);
    render(empty, {}, empty.layout.bandInk, bare);
    expect(missing()).toEqual([
      ['pattern', 'No step is linked to a crease pattern'],
      ['model', 'No step has a picture yet'],
    ]);
    const rooms = [...host.querySelectorAll<HTMLElement>('[data-title-block-room]')];
    expect(rooms.map((room) => [room.dataset.titleBlockRoom, [...room.querySelectorAll<HTMLElement>('[data-title-block-missing]')].map((part) => part.dataset.titleBlockMissing)])).toEqual([
      ['square', ['pattern', 'model']],
    ]);
    const { pattern } = empty.layout.pages[0]!.titleBlock!.geometry;
    expect([rooms[0]!.style.left, rooms[0]!.style.width]).toEqual([pattern.x, pattern.w].map((mm) => `${mm * PX_PER_MM}px`));
    const svg = empty.compose(0).svg;
    for (const [, words] of missing()) expect(svg).not.toContain(words);
    // No title: nothing in the band, on screen or in print — no box, no words; the page's image is the page as
    // filed, its flow band aside (Zach, 2026-10-15).
    expect(svgOf(host.querySelector<HTMLImageElement>('[data-page="0"] img')!)).toBe(empty.compose(0, { band: false }).svg);
    expect(svgOf(host.querySelector<HTMLImageElement>('[data-page="0"] img')!)).not.toContain('Add a title');
    // A step chosen for the model that has no picture is named by its number.
    const chosen = setTitleBlockContent(withBlock(diagram()), { model: { kind: 'step', stepId: 'step-empty' } });
    const chosenPages = preparedPages(chosen, FONTS, subsetter);
    render(chosenPages, {}, chosenPages.layout.bandInk, chosen);
    expect(missing()).toEqual([['model', 'Step 2 has no picture yet']]);
    // A press on the block is a press on the page: it asks about the page.
    const props = render(shown, {}, shown.layout.bandInk, withBlock(diagram()));
    act(() => host.querySelector<HTMLElement>('[data-title-block]')!.click());
    expect(props.onPageClick).toHaveBeenCalledOnce();
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
  });

  it('marks credits left out, never in the page, and no credit with an empty value, nor an empty note or one cut with “…” (Zach, 2026-10-15)', () => {
    const header = (credits: { label: string; value: string }[], note = '') => {
      const made = insertSteps(createDiagram({ title: 'Crane' }), [cpStep('step-1'), cpStep('step-2')], 0);
      const blocked = { ...made, page: { ...made.page, titleBlock: { enabled: true, heightShare: 0.23 } } };
      const noted = setTitleBlockContent(blocked, { subtitle: 'Origami diagram', note });
      return credits.reduce((done, credit) => setTitleBlockContent(done, { credits: { op: 'add', credit } }), noted);
    };
    const rooms = () =>
      [...host.querySelectorAll<HTMLElement>('[data-title-block-room]')].map((room) => [
        room.dataset.titleBlockRoom,
        [...room.querySelectorAll<HTMLElement>('[data-title-block-missing]')].map((part) => [part.dataset.titleBlockMissing, part.textContent]),
      ]);
    const document = header([
      { label: 'Author', value: '' },
      { label: 'Steps', value: '2' },
    ]);
    const pages = preparedPages(document, FONTS, subsetter);
    render(pages, {}, pages.layout.bandInk, document);
    // An empty credit is not drawn, nor marked: no placeholder over the page, nothing on it.
    expect(rooms()).toEqual([]);
    expect(host.querySelector('[data-page="0"]')!.textContent).not.toContain('AUTHOR');
    expect(pages.compose(0).svg).not.toContain('AUTHOR');
    expect(pages.compose(0).svg).toContain('STEPS');
    // A note longer than the block has room for, cut with "…": no tag (Zach, 2026-10-15: the block grows for it after
    // an edit of it, and past half the page the end is simply not printed).
    const long = header([{ label: 'Steps', value: '2' }], Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join('\n'));
    const longPages = preparedPages(long, FONTS, subsetter);
    render(longPages, {}, longPages.layout.bandInk, long);
    expect(longPages.layout.pages[0]!.titleBlock!.note!.cut).toBe(true);
    expect(rooms()).toEqual([]);
    // Credits left out for want of room, on a short block: marked by a tag under the block.
    const many = header(Array.from({ length: 12 }, (_, index) => ({ label: `Credit ${index + 1}`, value: 'Traditional design' })));
    const short = { ...many, page: { ...many.page, size: 'a5' as const, orientation: 'landscape' as const, titleBlock: { enabled: true, heightShare: 0.15 } } };
    const shortPages = preparedPages(short, FONTS, subsetter);
    render(shortPages, {}, shortPages.layout.bandInk, short);
    expect(rooms()).toEqual([['cut', [['credits', 'Some credits don’t fit']]]]);
    const cut = host.querySelector<HTMLElement>('[data-title-block-room="cut"]')!;
    expect(cut.getAttribute('data-kind')).toBe('cut');
    const { block: shortBlock } = shortPages.layout.pages[0]!.titleBlock!.geometry;
    expect(cut.style.top).toBe(`${(shortBlock.y + shortBlock.h) * PX_PER_MM}px`);
  });

  it('sets the words for a missing pattern over a portrait model standing at its own size in its place, not on it', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="300" height="400" fill="#c48"/></svg>';
    const photo = {
      ...createStep(() => 'step-photo'),
      source: { kind: 'upload' as const, assetId: 'asset-tall', rotationQuarterTurns: 0 as const, mirrored: false },
      picture: { kind: 'asset' as const, assetId: 'asset-tall', paperScale: 1, key: 'upload-asset-tall' },
    };
    const made = insertSteps(createDiagram({ title: 'Standing figure' }), [photo], 0);
    const document: DiagramDocument = {
      ...made,
      assets: { 'asset-tall': { id: 'asset-tall', kind: 'svg', svg, widthPx: 300, heightPx: 400, bytes: svg.length } },
      page: { ...made.page, titleBlock: { enabled: true, heightShare: 0.27 } },
    };
    const pages = preparedPages(document, FONTS, subsetter);
    render(pages, {}, pages.layout.bandInk, document);
    const { pattern, block, model: box } = pages.layout.pages[0]!.titleBlock!.geometry;
    // Three quarters as wide as tall, the model is its box's height, on the band's foot at its right.
    const model = pages.titleBlockModel()!;
    expect([model.h, model.y + model.h, model.x + model.w]).toEqual([box.h, block.y + block.h, block.x + block.w].map((mm) => expect.closeTo(mm, 6)));
    // The square's words in the strip the model leaves over itself.
    const room = host.querySelector<HTMLElement>('[data-title-block-room="square"]')!;
    expect(room.textContent).toBe('No step is linked to a crease pattern');
    expect([room.style.left, room.style.top, room.style.width, room.style.height]).toEqual(
      [pattern.x, pattern.y, pattern.w, model.y - pattern.y].map((mm) => `${mm * PX_PER_MM}px`)
    );
  });

  it('selects a step on a press, stays on the page on a double press, and elsewhere asks about the page and lets the selection go', () => {
    const props = render(preparedPages(diagram(), FONTS, subsetter));
    act(() => cells()[1]!.click());
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('step-empty');
    expect(props.onPageClick).not.toHaveBeenCalled();
    act(() => {
      cells()[2]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(useWorkspaceStore.getState().diagramDetail).toBeNull();
    act(() => host.querySelector<HTMLElement>('[data-page="0"]')!.click());
    expect(props.onPageClick).toHaveBeenCalledOnce();
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
    expect(props.onSelect).toHaveBeenCalledTimes(2);
    // The space round the pages lets it go too, and asks nothing about a page.
    act(() => host.querySelector<HTMLElement>('[role="listbox"]')!.click());
    expect(props.onSelect).toHaveBeenCalledTimes(3);
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
    expect(props.onPageClick).toHaveBeenCalledOnce();
  });

  it('makes the page last pressed the panes’ “this page”, while the selection is what the press left', () => {
    let seen: PagesInView | null = null;
    function Pane() {
      const view = usePageInView();
      useEffect(() => {
        seen = view;
      });
      return null;
    }
    const pane = createRoot(document.createElement('div'));
    act(() => pane.render(<Pane />));
    onTestFinished(() => act(() => pane.unmount()));
    const pages = preparedPages(diagram(), FONTS, subsetter);
    render(pages);
    expect(seen).toMatchObject({ middle: 0, first: 0, last: 0, pressed: null });
    // Its paper, which lets the selection go: it stands once nothing is selected.
    act(() => host.querySelector<HTMLElement>('[data-page="0"]')!.click());
    expect(seen).toMatchObject({ pressed: null });
    render(pages, {}, pages.layout.bandInk, diagram(), null);
    expect(seen).toMatchObject({ pressed: 0 });
    // A step on it: it stands once the step it selects is the selection.
    act(() => cells()[1]!.click());
    expect(seen).toMatchObject({ pressed: null });
    render(pages, {}, pages.layout.bandInk, diagram(), 'step-empty');
    expect(seen).toMatchObject({ pressed: 0 });
    // Another selection since, made elsewhere: the press no longer stands.
    render(pages, {}, pages.layout.bandInk, diagram(), 'step-long');
    expect(seen).toMatchObject({ pressed: null });
  });
});


function Keys() {
  useDiagramShortcuts({ openStepMenu: () => false });
  return null;
}

it('focuses the step a press lands on, so the arrows nudge its frame and Enter opens it, the nudge kept', () => {
  const doc = diagram();
  useWorkspaceStore.getState().installDiagram({ document: doc, readOnly: false, raw: {} });
  useWorkspaceStore.getState().setDiagramView('pages');
  const keys = createRoot(document.createElement('div'));
  act(() => keys.render(<Keys />));
  const capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
  HTMLElement.prototype.setPointerCapture = vi.fn();
  // Focus where a click on the Pages tab leaves it.
  const tab = document.createElement('button');
  tab.setAttribute('role', 'tab');
  document.body.append(tab);
  onTestFinished(() => {
    act(() => keys.unmount());
    tab.remove();
    if (capture) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', capture);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  });
  render(preparedPages(doc, FONTS, subsetter), {}, undefined, doc);
  act(() => tab.focus());
  const cell = cells()[0]!;
  const pointer = (type: string) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' });
  const down = pointer('pointerdown');
  act(() => {
    cell.dispatchEvent(down);
    cell.dispatchEvent(pointer('pointerup'));
    cell.click();
  });
  // The press stays the browser's (it is no drag), and focus is on the step.
  expect(down.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(cell);
  expect(useWorkspaceStore.getState()).toMatchObject({ diagramSelectedStepId: 'step-a', diagramPagesPart: 'frame' });
  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: document.activeElement });
    let claimed = false;
    act(() => {
      claimed = handleShortcutRuntimeKeyDown(event, { context: { activeEditingContext: 'diagram' }, menu: () => undefined });
    });
    return claimed;
  };
  // Decision 7: an arrow nudges the selected frame, on the Pages view still.
  expect(press('ArrowRight')).toBe(true);
  expect(useWorkspaceStore.getState().diagramView).toBe('pages');
  // The readout says it in words, its numbers and unit as the language writes them.
  expect(host.textContent).toContain('Frame · 0.5, 0.0 mm');
  expect(useWorkspaceStore.getState().diagram?.steps[0]).not.toHaveProperty('place');
  // Enter opens the step, after the nudge it showed has gone into the diagram.
  expect(press('Enter')).toBe(true);
  expect(useWorkspaceStore.getState()).toMatchObject({ diagramDetail: 'pose', diagramSelectedStepId: 'step-a' });
  expect(useWorkspaceStore.getState().diagram?.steps[0]).toMatchObject({ place: { frame: [0.5, 0] } });
});

it('lets a press on the paper go of a resized picture, so the next drag on its step moves the whole frame', () => {
  const doc = diagram();
  useWorkspaceStore.getState().installDiagram({ document: doc, readOnly: false, raw: {} });
  useWorkspaceStore.getState().setDiagramView('pages');
  useWorkspaceStore.getState().selectDiagramStep('step-a');
  useWorkspaceStore.getState().selectDiagramPagesPart('picture');
  const capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
  HTMLElement.prototype.setPointerCapture = vi.fn();
  onTestFinished(() => {
    if (capture) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', capture);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  });
  /** The view bound to the store, its pages laid out again as each edit lands. */
  function Bound() {
    const document = useWorkspaceStore((state) => state.diagram!);
    const selected = useWorkspaceStore((state) => state.diagramSelectedStepId);
    const pages = useMemo(() => preparedPages(document, FONTS, subsetter), [document]);
    return (
      <DiagramPagesView
        pages={pages}
        failed={false}
        steps={stepsIn(document)}
        selectedStepId={selected}
        pathColor={pages.layout.bandInk}
        fitKey="test"
        onSelect={useWorkspaceStore.getState().selectDiagramStep}
        onPageClick={() => {}}
      />
    );
  }
  act(() =>
    root.render(
      <TooltipProvider>
        <Bound />
      </TooltipProvider>
    )
  );
  const page = host.querySelector<HTMLElement>('[data-page="0"]')!;
  // A pixel a millimetre: the page as wide on screen as its paper.
  const paper = preparedPages(doc, FONTS, subsetter).layout.paper;
  page.getBoundingClientRect = () => ({ left: 0, top: 0, width: paper.widthMm, height: paper.heightMm }) as DOMRect;
  const pointer = (element: Element, type: string, x: number, y: number) =>
    act(() => {
      element.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, altKey: true })
      );
    });
  const drag = (element: Element, x: number, y: number, dx: number) => {
    pointer(element, 'pointerdown', x, y);
    pointer(element, 'pointermove', x + dx, y);
    pointer(element, 'pointerup', x + dx, y);
  };
  const place = () => useWorkspaceStore.getState().diagram!.steps[0]!;
  // The picture resized through its grip.
  const grip = host.querySelector<HTMLElement>('[data-place-scale="right"]')!;
  drag(grip, parseFloat(grip.style.left) / PX_PER_MM, parseFloat(grip.style.top) / PX_PER_MM, 10);
  expect(place()).toMatchObject({ place: { scale: expect.anything() } });
  expect(useWorkspaceStore.getState()).toMatchObject({ diagramSelectedStepId: 'step-a', diagramPagesPart: 'picture' });
  // The paper round it: nothing selected, so no part lies over the step.
  act(() => page.click());
  expect(useWorkspaceStore.getState()).toMatchObject({ diagramSelectedStepId: null, diagramPagesPart: null });
  expect(host.querySelector('[data-place-part]')).toBeNull();
  // A drag from the middle of its picture, on what lies there: the whole frame moves.
  const picture = host.querySelector<HTMLElement>('[data-place-part="picture"]') ?? cells()[0]!;
  const { pictureMm } = preparedPages(useWorkspaceStore.getState().diagram!, FONTS, subsetter).layout.pages[0]!.cells[0]!;
  drag(picture, pictureMm.x + pictureMm.size / 2, pictureMm.y + pictureMm.size / 2, 8);
  expect(useWorkspaceStore.getState()).toMatchObject({ diagramSelectedStepId: 'step-a', diagramPagesPart: 'frame' });
  expect(place()).toMatchObject({ place: { frame: expect.anything(), scale: expect.anything() } });
  expect(place()).not.toMatchObject({ place: { picture: expect.anything() } });
});

it('resizes a selected caption by its grips, its lines rewrapping as the grip moves, and commits once on release', () => {
  const doc = diagram();
  useWorkspaceStore.getState().installDiagram({ document: doc, readOnly: false, raw: {} });
  useWorkspaceStore.getState().setDiagramView('pages');
  useWorkspaceStore.getState().selectDiagramStep('step-long');
  useWorkspaceStore.getState().selectDiagramPagesPart('text');
  const capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
  HTMLElement.prototype.setPointerCapture = vi.fn();
  onTestFinished(() => {
    if (capture) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', capture);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  });
  function Bound() {
    const document = useWorkspaceStore((state) => state.diagram!);
    const selected = useWorkspaceStore((state) => state.diagramSelectedStepId);
    const pages = useMemo(() => preparedPages(document, FONTS, subsetter), [document]);
    return (
      <DiagramPagesView
        pages={pages}
        failed={false}
        steps={stepsIn(document)}
        selectedStepId={selected}
        pathColor={pages.layout.bandInk}
        fitKey="test"
        onSelect={useWorkspaceStore.getState().selectDiagramStep}
        onPageClick={() => {}}
      />
    );
  }
  act(() =>
    root.render(
      <TooltipProvider>
        <Bound />
      </TooltipProvider>
    )
  );
  const page = host.querySelector<HTMLElement>('[data-page="0"]')!;
  const paper = preparedPages(doc, FONTS, subsetter).layout.paper;
  page.getBoundingClientRect = () => ({ left: 0, top: 0, width: paper.widthMm, height: paper.heightMm }) as DOMRect;
  const pointer = (element: Element, type: string, x: number, y: number) =>
    act(() => {
      element.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, altKey: true })
      );
    });
  // Its sides set its width, its foot its lines; the picture's size grips are not there.
  expect([...host.querySelectorAll<HTMLElement>('[data-place-caption]')].map((grip) => grip.dataset.placeCaption)).toEqual(['left', 'right', 'bottom']);
  expect(host.querySelector('[data-place-scale]')).toBeNull();
  const right = host.querySelector<HTMLElement>('[data-place-caption="right"]')!;
  const [x, y] = [parseFloat(right.style.left) / PX_PER_MM, parseFloat(right.style.top) / PX_PER_MM];
  const before = useWorkspaceStore.getState().diagram;
  pointer(right, 'pointerdown', x, y);
  pointer(right, 'pointermove', x + 40, y);
  // Live: the caption lifted, set at the wider measure, the width and Auto said; nothing committed.
  expect(useWorkspaceStore.getState().diagram).toBe(before);
  expect(host.textContent).toMatch(/\d+\.\d mm · auto \d+\.\d mm/);
  const lifted = [...host.querySelectorAll<HTMLImageElement>('img')].map(svgOf).filter((svg) => svg.includes('Fold the corner'));
  expect(lifted.length).toBeGreaterThan(0);
  pointer(right, 'pointerup', x + 40, y);
  const step = useWorkspaceStore.getState().diagram!.steps[2]!;
  expect(step).toMatchObject({ place: { textWidth: expect.any(Number) } });
  expect(useWorkspaceStore.getState().diagramHistory.past).toHaveLength(1);
  expect(useWorkspaceStore.getState()).toMatchObject({ diagramSelectedStepId: 'step-long', diagramPagesPart: 'text' });
});

describe('an enlarged step’s grip on a held flow page (Zach, 2026-10-12)', () => {
  const AREA: KnownDiagramAnnotation = { id: 'area-1', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], radius: 0.2 };
  const enlarged = (scale?: number) => ({
    ...cpStep('step-enlarged'),
    zoom: { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.4] as [number, number], radius: 0.2 }, ...(scale ? { scale } : {}) },
  });

  /**
   * `fresh` packed and held as the Pages view adopts it, step-enlarged's
   * picture selected and its right grip dragged `dx` mm: its picture's box on
   * screen before, during and after, its page's cells before and after, and
   * the store once the drop has landed.
   */
  function dragGrip(fresh: DiagramDocument, dx: number) {
    const doc = adoptPageArrangements(fresh, preparedPages(fresh, FONTS, subsetter).layout.packed ?? {});
    expect(doc.page.layout).toBe('flow');
    useWorkspaceStore.getState().installDiagram({ document: doc, readOnly: false, raw: {} });
    useWorkspaceStore.getState().setDiagramView('pages');
    useWorkspaceStore.getState().selectDiagramStep('step-enlarged');
    useWorkspaceStore.getState().selectDiagramPagesPart('picture');
    const capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
    HTMLElement.prototype.setPointerCapture = vi.fn();
    onTestFinished(() => {
      if (capture) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', capture);
      else delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
    });
    function Bound() {
      const document = useWorkspaceStore((state) => state.diagram!);
      const selected = useWorkspaceStore((state) => state.diagramSelectedStepId);
      const pages = useMemo(() => preparedPages(document, FONTS, subsetter), [document]);
      return (
        <DiagramPagesView
          pages={pages}
          failed={false}
          steps={stepsIn(document)}
          selectedStepId={selected}
          pathColor={pages.layout.bandInk}
          fitKey="test"
          onSelect={useWorkspaceStore.getState().selectDiagramStep}
          onPageClick={() => {}}
        />
      );
    }
    act(() =>
      root.render(
        <TooltipProvider>
          <Bound />
        </TooltipProvider>
      )
    );
    const layout = preparedPages(doc, FONTS, subsetter).layout;
    const index = layout.pages.findIndex((each) => each.cells.some((cell) => cell.stepId === 'step-enlarged'));
    const page = host.querySelector<HTMLElement>(`[data-page="${index}"]`)!;
    page.getBoundingClientRect = () => ({ left: 0, top: 0, width: layout.paper.widthMm, height: layout.paper.heightMm }) as DOMRect;
    const pointer = (element: Element, type: string, x: number, y: number) =>
      act(() => {
        element.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, altKey: true })
        );
      });
    /** The selected picture's box on screen, px. */
    const shown = () => {
      const { style } = page.querySelector<HTMLElement>('[data-place-selection="picture"]')!;
      return { w: parseFloat(style.width), h: parseFloat(style.height) };
    };
    const cellsOf = (document: DiagramDocument) => preparedPages(document, FONTS, subsetter).layout.pages[index]!.cells;
    const before = cellsOf(doc);
    const was = shown();
    const grip = page.querySelector<HTMLElement>('[data-place-scale="right"]')!;
    const [x, y] = [parseFloat(grip.style.left) / PX_PER_MM, parseFloat(grip.style.top) / PX_PER_MM];
    pointer(grip, 'pointerdown', x, y);
    pointer(grip, 'pointermove', x + dx, y);
    const during = shown();
    pointer(grip, 'pointerup', x + dx, y);
    const state = useWorkspaceStore.getState();
    return { doc, before, was, during, after: shown(), cells: cellsOf(state.diagram!), state };
  }

  it('grows it past its box, the drop drawing what the drag showed, every other step as it was', () => {
    const fresh = insertSteps(
      createDiagram({ title: 'Crane' }),
      [{ ...cpStep('step-area'), annotations: [AREA] }, enlarged(), cpStep('step-after')],
      0
    );
    const { doc, before, was, during, after, cells, state } = dragGrip(fresh, 30);
    expect(during.w).toBeGreaterThan(was.w * 1.3);
    expect(state.diagramHistory.past.map((entry) => entry.label)).toEqual(['Set enlarged size']);
    // Held, not packed again: the step is drawn at its new Size past its box, as the drag showed it.
    expect(state.diagram!.pageArrangements).toBe(doc.pageArrangements);
    expect(after.w / during.w).toBeCloseTo(1, 2);
    expect(after.h / during.h).toBeCloseTo(1, 2);
    expect(pastItsBox(cells.find((cell) => cell.stepId === 'step-enlarged')!)).toBe('picture');
    for (const cell of cells) if (cell.stepId !== 'step-enlarged') expect(cell, cell.stepId).toEqual(before.find((each) => each.stepId === cell.stepId));
  });

  it('draws what the drag showed where it prints at another multiple of its area than its Size: its area on the page before', () => {
    // The area ends page 1 and the step, at ×6, starts page 2, which packs at a smaller scale to hold it: so
    // the step prints at less than six times its area as page 1 prints it. The grip scales its Size, as the
    // page resizes it from the Size it was packed at.
    const fresh = insertSteps(
      createDiagram({ title: 'Crane' }),
      [cpStep('step-a'), { ...cpStep('step-area'), annotations: [AREA] }, enlarged(6), cpStep('step-after')],
      0
    );
    // No title block, so page 1 holds two and ends with the area.
    const twoAPage = { ...fresh, page: { ...fresh.page, stepsPerPage: 2, titleBlock: PAGE_SETTINGS.titleBlock.legacy } };
    const { before, was, during, after, state } = dragGrip(twoAPage, -15);
    expect(before.find((cell) => cell.stepId === 'step-enlarged')!.zoom!.printed).toBeLessThan(5.9);
    expect(during.w).toBeLessThan(was.w * 0.9);
    expect(state.diagram!.steps.find((entry) => entry.id === 'step-enlarged')).toMatchObject({ zoom: { scale: expect.closeTo((6 * during.w) / was.w, 2) } });
    expect(after.w / during.w).toBeCloseTo(1, 2);
    expect(after.h / during.h).toBeCloseTo(1, 2);
  });
});

it('lets the selected frame own its picture hit area until a part is chosen', () => {
  const doc = diagram();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useWorkspaceStore.getState().installDiagram({document: doc, readOnly: false, raw: {}});
  useWorkspaceStore.getState().setDiagramView('pages');
  useWorkspaceStore.getState().selectDiagramStep('step-a');
  useWorkspaceStore.getState().selectDiagramPagesPart('frame');
  render(preparedPages(doc, FONTS, subsetter), {}, undefined, doc);
  expect(host.querySelector('[data-place-selection="frame"]')).not.toBeNull();
  expect(host.querySelector('[data-place-part]')).toBeNull();
  act(() => useWorkspaceStore.getState().selectDiagramPagesPart('picture'));
  expect(host.querySelector('[data-place-part="picture"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-place-scale]')).toHaveLength(3);
});

/**
 * A view with a size, and its animation frames run when the test says — as a
 * browser runs them, after the commit that asked, and never once cancelled.
 * Returns what runs the frames due.
 */
function framesByHand(): () => void {
  const sizes = { clientWidth: 900, clientHeight: 700 } as const;
  const saved = Object.keys(sizes).map((key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const);
  for (const [key, value] of Object.entries(sizes)) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  let frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (frames.set((next += 1), callback), next));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  onTestFinished(() => {
    for (const [key, descriptor] of saved)
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  });
  return () =>
    act(() => {
      const due = frames;
      frames = new Map();
      for (const callback of due.values()) callback(0);
    });
}

it('still brings the selected step into view when new pages land before its frame runs, as they do coming back from Pose', () => {
  const runFrames = framesByHand();
  const doc = insertSteps(createDiagram({ title: 'Crane' }), Array.from({ length: 20 }, (_, index) => cpStep(`s${index}`)), 0);
  useWorkspaceStore.getState().installDiagram({ document: doc, readOnly: false, raw: {} });
  render(preparedPages(doc, FONTS, subsetter), {}, undefined, doc, 's15');
  // A relayout lands — new pages, the same diagram — before the frame that shows the step runs.
  render(preparedPages(doc, FONTS, subsetter), {}, undefined, doc, 's15');
  runFrames();
  expect(document.activeElement?.getAttribute('data-step-id')).toBe('s15');
});

it('comes back where the reader left it — from Pose or Annotate, which unmount it — not framed on page 1 (Zach, 2026-10-12)', () => {
  const runFrames = framesByHand();
  const show = (pages: PreparedDiagramPages, doc: DiagramDocument, selected: string | null = null) => {
    render(pages, {}, pages.layout.bandInk, doc, selected);
    runFrames();
  };
  const doc = insertSteps(createDiagram({ title: 'Crane' }), Array.from({ length: 20 }, (_, index) => cpStep(`s${index}`)), 0);
  useWorkspaceStore.getState().installDiagram({ document: doc, readOnly: false, raw: {} });
  const pages = preparedPages(doc, FONTS, subsetter);
  expect(pages.layout.pages.length).toBeGreaterThan(2);
  const transform = () => host.querySelector<HTMLElement>('.react-transform-component')!.style.transform;
  const kept = () => useWorkspaceStore.getState().diagramPagesCamera;

  // Nothing kept: framed on page 1, and that is what leaving keeps.
  show(pages, doc);
  const framed = transform();
  expect(framed).not.toBe('translate(0px, 0px) scale(1)');
  act(() => root.unmount());
  expect(kept()).toMatchObject({ key: 'test:laid-out', shownStepId: null });
  const fit = kept()!;

  // Where the reader had turned to — page 3, nearer — is where it stands again as it comes back.
  const onPage3 = {
    key: 'test:laid-out',
    positionX: fit.positionX - 40,
    positionY: fit.positionY - 2 * 1100,
    scale: fit.scale * 1.5,
    onScreen: { middle: 2, first: 2, last: 2 },
    shownStepId: 's19',
  };
  act(() => useWorkspaceStore.getState().keepDiagramPagesCamera(onPage3));
  root = createRoot(host);
  render(pages, {}, pages.layout.bandInk, doc, 's19');
  // Page 3's from the first frame, before the camera is put back: the pager, and the panes' "this page".
  expect(host.textContent).toContain('Page 3 of');
  runFrames();
  expect(transform()).not.toBe(framed);
  expect(transform()).toBe(`translate(${onPage3.positionX}px, ${onPage3.positionY}px) scale(${onPage3.scale})`);
  expect(host.textContent).toContain('Page 3 of');
  // The step it showed, still selected, is given the focus back, so Enter opens it again.
  expect(document.activeElement?.getAttribute('data-step-id')).toBe('s19');
  act(() => root.unmount());
  expect(kept()).toMatchObject({ ...onPage3, onScreen: { middle: 2 } });

  // Kept for other pages — another diagram, or other paper — it frames page 1 as ever.
  act(() => useWorkspaceStore.getState().keepDiagramPagesCamera({ ...onPage3, key: 'other:laid-out' }));
  root = createRoot(host);
  show(pages, doc);
  expect(transform()).toBe(framed);
});

/** Twenty steps over several pages, framed as the view opens: what the frames left to run would run. */
function manyPages() {
  const runFrames = framesByHand();
  const doc = insertSteps(createDiagram({ title: 'Crane' }), Array.from({ length: 20 }, (_, index) => cpStep(`s${index}`)), 0);
  useWorkspaceStore.getState().installDiagram({ document: doc, readOnly: false, raw: {} });
  const pages = preparedPages(doc, FONTS, subsetter);
  expect(pages.layout.pages.length).toBeGreaterThan(2);
  render(pages, {}, pages.layout.bandInk, doc, null);
  runFrames();
  return runFrames;
}

/** The camera as the library stands it: the view's position, in px, and its scale. */
function camera() {
  const style = host.querySelector<HTMLElement>('.react-transform-component')!.style.transform;
  const [, x, y, scale] = /translate\((.+)px, (.+)px\) scale\((.+)\)/.exec(style)!;
  return { x: Number(x), y: Number(y), scale: Number(scale) };
}

/** A wheel over page 1, at (300, 200) in the view. */
function wheelOverPage(init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { clientX: 300, clientY: 200, bubbles: true, cancelable: true, ...init });
  act(() => {
    host.querySelector('[role="group"][data-page="0"]')!.dispatchEvent(event);
  });
  return event;
}

describe('the wheel over the pages, as the Edit canvas reads it (Zach, 2026-10-14)', () => {
  it('zooms a Ctrl+wheel notch ×1.16 at most, as the Edit canvas steps, and a pinch’s small steps as it always has', () => {
    manyPages();
    const zoomBy = (init: WheelEventInit) => {
      const before = camera().scale;
      wheelOverPage(init);
      return camera().scale / before;
    };
    // A Windows mouse notch is 100 px: one step, not a leap of ×3.
    expect(zoomBy({ deltaY: -100, ctrlKey: true })).toBeCloseTo(Math.exp(MAX_ZOOM_EXPONENT), 9);
    expect(zoomBy({ deltaY: 100, ctrlKey: true })).toBeCloseTo(Math.exp(-MAX_ZOOM_EXPONENT), 9);
    // A trackpad pinch, a few px an event, on the pinch curve the pages have always had.
    expect(zoomBy({ deltaY: -4, ctrlKey: true })).toBeCloseTo(Math.exp(4 * 0.011), 9);
    expect(zoomBy({ deltaY: 6, ctrlKey: true })).toBeCloseTo(Math.exp(-6 * 0.011), 9);
  });

  it('zooms on Cmd+wheel as on Ctrl+wheel, about the pointer, where it panned', () => {
    manyPages();
    // The world point under the pointer, which a zoom keeps there.
    const underPointer = () => {
      const { x, y, scale } = camera();
      return { x: (300 - x) / scale, y: (200 - y) / scale };
    };
    for (const modifier of ['metaKey', 'ctrlKey'] as const) {
      const before = { ...camera(), under: underPointer() };
      const event = wheelOverPage({ deltaY: -100, [modifier]: true });
      expect(event.defaultPrevented).toBe(true);
      // A mouse notch, Cmd or Ctrl: the canvas' one step.
      expect(camera().scale / before.scale).toBeCloseTo(Math.exp(MAX_ZOOM_EXPONENT), 9);
      expect(underPointer().x).toBeCloseTo(before.under.x, 6);
      expect(underPointer().y).toBeCloseTo(before.under.y, 6);
    }
    // A plain wheel still pans, at the scale it was (the library rounds where it pans to).
    const before = camera();
    wheelOverPage({ deltaY: 40 });
    expect(camera()).toEqual({
      x: expect.closeTo(before.x, 2),
      y: expect.closeTo(before.y - 40, 2),
      scale: before.scale,
    });
  });
});

it('fits the page the pager is on, by the bar’s Fit and by Mod+0, where the view first framed page 1 (Zach, 2026-10-14)', () => {
  // The library animates on the clock: past an animation's end, its next frame lands it.
  vi.useFakeTimers({ toFake: ['Date'] });
  onTestFinished(() => void vi.useRealTimers());
  const runFrames = manyPages();
  const settle = () => {
    vi.setSystemTime(Date.now() + 1000);
    runFrames();
  };
  const keys = createRoot(document.createElement('div'));
  act(() => keys.render(<Keys />));
  onTestFinished(() => act(() => keys.unmount()));
  const at = (expected: ReturnType<typeof camera>) => ({
    x: expect.closeTo(expected.x, 6),
    y: expect.closeTo(expected.y, 6),
    scale: expect.closeTo(expected.scale, 9),
  });
  const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  const wander = () => {
    wheelOverPage({ deltaY: -100, ctrlKey: true });
    wheelOverPage({ deltaX: 20, deltaY: 30 });
  };

  // Opened on page 1.
  expect(host.textContent).toContain('Page 1 of');
  const pageOne = camera();
  act(() => button('Next Page').click());
  settle();
  expect(host.textContent).toContain('Page 2 of');
  const pageTwo = camera();
  expect(pageTwo.y).not.toBeCloseTo(pageOne.y, 0);

  // Wandered off page 2's frame, the pager on page 2 still: Fit frames page 2, not page 1.
  wander();
  expect(host.textContent).toContain('Page 2 of');
  expect(camera()).not.toEqual(at(pageTwo));
  act(() => button('Fit').click());
  settle();
  expect(camera()).toEqual(at(pageTwo));

  // And the keys' Fit.
  wander();
  const event = new KeyboardEvent('keydown', {
    key: '0',
    ctrlKey: !isApplePlatform(),
    metaKey: isApplePlatform(),
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'target', { value: document.body });
  let claimed = false;
  act(() => {
    claimed = handleShortcutRuntimeKeyDown(event, { context: { activeEditingContext: 'diagram' }, menu: () => undefined });
  });
  expect(claimed).toBe(true);
  settle();
  expect(camera()).toEqual(at(pageTwo));
});

it('mounts nearby page targets, retaining an offscreen selection for keyboard reveal', () => {
  let notify: IntersectionObserverCallback;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe() {}
    disconnect() {}
  });
  const doc = onGrid(insertSteps(createDiagram(), Array.from({ length: 40 }, (_, i) => cpStep(`virtual-${i}`)), 0));
  const pages = preparedPages(doc, FONTS, subsetter);
  const compose = vi.spyOn(pages, 'compose');
  render(pages, {}, pages.layout.bandInk, doc, null);
  const page = (index: number) => host.querySelector<HTMLElement>(`[data-page="${index}"]`)!;
  expect(page(0).querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
  expect(page(2).querySelectorAll('[role="option"]')).toHaveLength(0);
  const entry = (index: number, isIntersecting: boolean): IntersectionObserverEntry => ({
    target: page(index), isIntersecting, time: 0, rootBounds: null,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: page(index).getBoundingClientRect(),
    intersectionRect: page(index).getBoundingClientRect(),
  });
  act(() => notify!([entry(0, false), entry(2, true)], {} as IntersectionObserver));
  expect(page(0).querySelectorAll('[role="option"]')).toHaveLength(0);
  expect(page(2).querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
  const last = pages.layout.pages.length - 1;
  const selected = pages.layout.pages[last]!.cells[0]!.stepId;
  render(pages, {}, pages.layout.bandInk, doc, selected);
  expect(page(last).querySelector('[aria-selected="true"]')?.getAttribute('data-step-id')).toBe(selected);
  expect(page(last).querySelector('img')).toBeNull();
  expect(compose.mock.calls.every(([index]) => index === 0 || index === 2)).toBe(true);
});
