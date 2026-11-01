import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStep,
  DEFAULT_DIAGRAM_STYLE,
  type DiagramAsset,
  type DiagramCpSource,
  type DiagramEntry,
  type DiagramStep,
} from '../../diagram/document/diagramDocument';
import { cpStep, fixedPicture, scenePicture } from '../../diagram/document/diagramSteps.fixtures';
import type { DiagramImportWayId } from '../../diagram/actions/diagramImportWays';
import type { DiagramCardLinks } from '../../diagram/capture/useCardLinks';
import type { StepPageFit } from '../../diagram/pages/pageOverflow';
import { DiagramStepsGrid } from './DiagramStepsGrid';

// The grid chooses the source; bitmap loading and invalidation have their own component tests.
vi.mock('./DiagramPicturePreview', () => ({
  DiagramPicturePreview: ({ src }: { src: string }) => <img src={src} alt="" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

// Give the real virtualizer a viewport; jsdom otherwise measures every box as zero.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? 100 : 1000;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const steps: DiagramStep[] = [
  createStep(() => 'step-a'),
  { ...createStep(() => 'step-b'), text: 'Fold the corner\nto the centre.' },
  { ...createStep(() => 'step-c'), unknown: { id: 'step-c' } },
];

function render(
  selectedStepId: string | null,
  onSelect = vi.fn(),
  options: {
    steps?: DiagramEntry[];
    assets?: Record<string, DiagramAsset>;
    dropTarget?: string | null;
    onOpen?: (stepId: string) => void;
    onUpload?: (stepId: string) => void;
    links?: Partial<DiagramCardLinks>;
    patternOpen?: boolean;
    foldSteps?: boolean;
    onLink?: (stepId: string) => void;
    onImport?: (stepId: string, way: DiagramImportWayId) => void;
    pageFits?: ReadonlyMap<string, StepPageFit>;
    onAppend?: () => void;
    onInsertBefore?: (stepId: string) => void;
    onOpenIn?: (stepId: string, mode: 'pose' | 'annotate') => void;
    onGoToEdit?: () => void;
    onMakeTurn?: (stepId: string, kind: 'turn-over' | 'rotate') => void;
    onDelete?: (id: string) => void;
    readOnly?: boolean;
  } = {}
) {
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root?.render(
      <DiagramStepsGrid
        entries={options.steps ?? steps}
        assets={options.assets ?? {}}
        style={DEFAULT_DIAGRAM_STYLE}
        selectedStepId={selectedStepId}
        dropTarget={options.dropTarget ?? null}
        readOnly={options.readOnly ?? false}
        onSelect={onSelect}
        onOpen={options.onOpen ?? vi.fn()}
        onUpload={options.onUpload ?? vi.fn()}
        links={{
          statuses: new Map(),
          captures: {},
          stop: vi.fn(),
          refreshable: 0,
          poseAgain: 0,
          ...options.links,
        }}
        pageFits={options.pageFits ?? new Map()}
        patternOpen={options.patternOpen ?? false}
        foldSteps={options.foldSteps ?? false}
        onLink={options.onLink ?? vi.fn()}
        onImport={options.onImport ?? vi.fn()}
        onAppend={options.onAppend}
        onInsertBefore={options.onInsertBefore}
        onOpenIn={options.onOpenIn ?? vi.fn()}
        onGoToEdit={options.onGoToEdit ?? vi.fn()}
        onMakeTurn={options.onMakeTurn ?? vi.fn()}
        onDelete={options.onDelete ?? vi.fn()}
      />
    )
  );
  return onSelect;
}

const listbox = () => host?.querySelector('[role="listbox"]') as HTMLElement;
const options = () => [...(host?.querySelectorAll('[role="option"]') ?? [])] as HTMLElement[];

describe('DiagramStepsGrid', () => {
  it('mounts only the visible rows plus overscan, with positions in the complete list', () => {
    const many = Array.from({ length: 250 }, (_, index) => createStep(() => `step-${index}`));
    render(many[0]!.id, vi.fn(), { steps: many });
    expect(options().length).toBeGreaterThan(0);
    expect(options().length).toBeLessThan(30);
    expect(options()[0]!.getAttribute('aria-posinset')).toBe('1');
    expect(options()[0]!.getAttribute('aria-setsize')).toBe('250');
    expect(host!.querySelector('[data-step-id="step-249"]')).toBeNull();
  });

  it('keeps the selected card mounted wherever the grid is scrolled', async () => {
    const many = Array.from({ length: 250 }, (_, index) => createStep(() => `step-${index}`));
    render('step-200', vi.fn(), { steps: many });
    const scroller = listbox().parentElement!;
    act(() => {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll'));
    });
    expect(host!.querySelector('[data-step-id="step-0"]')).not.toBeNull();
    // Focus, the keyboard context menu and the tab stop find its card.
    expect(host!.querySelector('[data-step-id="step-200"]')).not.toBeNull();
    expect(host!.querySelector('[data-step-id="step-120"]')).toBeNull();
    // A scroll leaves the virtualizer a 150 ms "scrolling ended" timer that
    // unmounting does not cancel. Let it fire here: run after this file's DOM
    // is gone, it throws "window is not defined" into whichever file runs next.
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  });

  it('reveals a new selection, and stays put when another step is deleted', () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, configurable: true, writable: true });
    try {
      const many = Array.from({ length: 250 }, (_, index) => createStep(() => `step-${index}`));
      render('step-200', vi.fn(), { steps: many });
      expect(scrollTo).toHaveBeenCalled();
      scrollTo.mockClear();
      // The selection's index moves from 200 to 199; the selection does not change.
      render('step-200', vi.fn(), { steps: many.filter((step) => step.id !== 'step-1') });
      expect(scrollTo).not.toHaveBeenCalled();
      render('step-5', vi.fn(), { steps: many });
      expect(scrollTo).toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    }
  });

  it('mounts onto a selection past the first row in its measured columns: scrolled to its row, its card focused', async () => {
    // Three columns, as a wide pane lays them out (jsdom has no grid layout).
    const computed = getComputedStyle;
    vi.stubGlobal('getComputedStyle', (element: Element, pseudo?: string | null) =>
      element.getAttribute('role') === 'listbox'
        ? ({ gridTemplateColumns: '200px 200px 200px', paddingTop: '0px' } as CSSStyleDeclaration)
        : computed.call(window, element, pseudo)
    );
    // A 1000px viewport over the virtualizer's total height, so a scroll is not clamped to 0.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this === host ? 1000 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this === host ? Number.parseFloat((listbox().firstElementChild as HTMLElement).style.height) : 0;
    });
    const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
      this.dispatchEvent(new Event('scroll'));
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, configurable: true, writable: true });
    try {
      // Back from step detail, or Pages → Steps: the grid mounts with step 31 selected.
      const many = Array.from({ length: 60 }, (_, index) => createStep(() => `step-${index}`));
      render('step-30', vi.fn(), { steps: many });
      // Let the virtualizer settle its scroll, and its "scrolling ended" timer fire.
      await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
      expect(scrollTo).toHaveBeenCalled();
      const card = host!.querySelector<HTMLElement>('[data-step-id="step-30"]')!;
      const row = card.closest<HTMLElement>('[data-index]')!;
      // Step 31 is in row 11 of 20, not row 31 of 60.
      expect(row.dataset.index).toBe('10');
      const start = Number(/translateY\((-?[\d.]+)px\)/.exec(row.style.transform)![1]);
      const viewport = listbox().parentElement!;
      expect(start).toBeGreaterThanOrEqual(viewport.scrollTop);
      expect(start + row.offsetHeight).toBeLessThanOrEqual(viewport.scrollTop + viewport.offsetHeight);
      expect(document.activeElement).toBe(card);
    } finally {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    }
  });

  it('ends with an Add step tile for a pointer, kept out of the listbox’s options and the tab order', () => {
    const onAppend = vi.fn();
    const onSelect = render('step-a', vi.fn(), { onAppend });
    const tile = host!.querySelector('[data-add-step-tile]') as HTMLElement;
    expect(tile.textContent).toBe('Add step');
    // Last, in the place after the last card: where the turns after it would stand too.
    expect(listbox().lastElementChild?.contains(tile)).toBe(true);
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.tabIndex).toBe(-1);
    expect(options()).toHaveLength(steps.length);
    act(() => tile.click());
    expect(onAppend).toHaveBeenCalledOnce();
    // A press on the tile is not a press on empty space.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('adds a step in the gap before each card, the first one’s too, for a pointer; the tile adds one after the last', () => {
    const onInsertBefore = vi.fn();
    const onSelect = render('step-a', vi.fn(), { onInsertBefore });
    const gaps = [...host!.querySelectorAll<HTMLElement>('[data-insert-before]')];
    // Before a, b and c: the Add step tile is the place after c.
    expect(gaps.map((gap) => gap.dataset.insertBefore)).toEqual(['step-a', 'step-b', 'step-c']);
    for (const gap of gaps) {
      expect(gap.getAttribute('aria-hidden')).toBe('true');
      expect(gap.tabIndex).toBe(-1);
      expect(gap.title).toBe('Add a step here');
    }
    expect(options()).toHaveLength(steps.length);
    act(() => gaps[0]!.click());
    expect(onInsertBefore).toHaveBeenCalledWith('step-a');
    // A press on a gap is not a press on empty space.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a turn as a card of its own in its place, unnumbered, the cards around it numbered on (D24)', () => {
    const over: DiagramEntry = { id: 'turn-1', kind: 'turn-over', axis: 'vertical' };
    const round: DiagramEntry = {
      id: 'turn-2',
      kind: 'rotate',
      rotate: { amount: 'quarter', direction: 'ccw' },
    };
    const onInsertBefore = vi.fn();
    const onSelect = render('turn-1', vi.fn(), {
      steps: [over, steps[0]!, steps[1]!, round],
      onAppend: vi.fn(),
      onInsertBefore,
    });
    // In order, in one listbox: a turn's card is an option as a step's is, named by what it is and where.
    expect(options().map((option) => option.getAttribute('aria-label') ?? option.dataset.stepId)).toEqual([
      'Turn over, side to side, before step 1',
      'step-a',
      'step-b',
      'Rotate 1/4 turn counterclockwise, after step 2',
    ]);
    // The step cards read 1 and 2: a turn is no step.
    expect(host!.textContent).toContain('Step 1');
    expect(host!.textContent).toContain('Step 2');
    expect(host!.textContent).not.toContain('Step 3');
    // A turn's card: its name for a number, no number, its glyph, how it turns and where it prints.
    const [first, , , last] = options();
    expect(first!.textContent).toContain('Turn over');
    expect(first!.textContent).toContain('No number');
    expect(first!.textContent).toContain('Side to side');
    expect(first!.textContent).toContain('Before step 1');
    expect(first!.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(last!.textContent).toContain('1/4 turn counterclockwise');
    expect(last!.textContent).toContain('After step 2');
    // Selected, it is the tab stop, as a card would be; a press selects one.
    expect(first!.getAttribute('aria-selected')).toBe('true');
    expect(first!.tabIndex).toBe(0);
    act(() => last!.click());
    expect(onSelect).toHaveBeenCalledWith('turn-2');
    // Every card has the gap before it, a turn's too.
    act(() => host!.querySelector<HTMLElement>('[data-insert-before="turn-2"]')!.click());
    expect(onInsertBefore).toHaveBeenCalledWith('turn-2');
  });

  it('puts Delete over every card’s corner for a pointer, a step’s or a turn’s, and none on a diagram that cannot change', () => {
    const onDelete = vi.fn();
    const over: DiagramEntry = { id: 'turn-1', kind: 'turn-over', axis: 'vertical' };
    const onSelect = render(null, vi.fn(), {
      steps: [cpStep('step-p'), createStep(() => 'step-empty'), over],
      onDelete,
    });
    const deletes = () => [...host!.querySelectorAll<HTMLButtonElement>('button[data-danger]')];
    expect(
      deletes().map((button) => [
        button.closest('[data-step-id]')?.getAttribute('data-step-id'),
        button.title,
      ])
    ).toEqual([
      ['step-p', 'Delete Step'],
      ['step-empty', 'Delete Step'],
      ['turn-1', 'Delete Turn'],
    ]);
    // A pointer's shortcut: the menu, the Step pane and the Delete key are the keyboard's.
    expect(deletes()[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(deletes()[0]!.tabIndex).toBe(-1);
    act(() => deletes()[2]!.click());
    expect(onDelete).toHaveBeenCalledWith('turn-1');
    // It does not select the card it takes away.
    expect(onSelect).not.toHaveBeenCalled();
    render(null, vi.fn(), { steps: [cpStep('step-p'), over], readOnly: true });
    expect(deletes()).toHaveLength(0);
  });

  it('deletes one card for a double-click on its Delete, not the card that takes its place too', () => {
    const onDelete = vi.fn();
    const onAppend = vi.fn();
    const over: DiagramEntry = { id: 'turn-1', kind: 'turn-over', axis: 'vertical' };
    render(null, vi.fn(), { steps: [over, createStep(() => 'step-empty')], onDelete, onAppend });
    const click = (target: Element, detail: number) =>
      act(
        () => void target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }))
      );
    click(host!.querySelector('[data-step-id="turn-1"] button[data-danger]')!, 1);
    // The second click of the double-click, wherever it lands.
    click(host!.querySelector('[data-step-id="step-empty"] button[data-danger]')!, 2);
    click(host!.querySelector('[data-add-step-tile]')!, 2);
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('turn-1');
    expect(onAppend).not.toHaveBeenCalled();
  });

  it('marks a turn card where a dragged picture would land: a new step after it', () => {
    const over: DiagramEntry = { id: 'turn-1', kind: 'turn-over', axis: 'vertical' };
    render(null, vi.fn(), { steps: [steps[0]!, over], dropTarget: 'turn-1' });
    expect(options().map((option) => option.hasAttribute('data-drop-target'))).toEqual([false, true]);
  });

  it('offers an empty card a turn instead of a picture (D24)', () => {
    const onMakeTurn = vi.fn();
    render(null, vi.fn(), { steps: [createStep(() => 'step-empty')], onMakeTurn });
    const button = (label: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>('[data-step-id="step-empty"] button')].find(
        (candidate) => candidate.textContent === label
      )!;
    act(() => button('Turn over').click());
    act(() => button('Rotate').click());
    expect(onMakeTurn.mock.calls).toEqual([
      ['step-empty', 'turn-over'],
      ['step-empty', 'rotate'],
    ]);
  });

  it('offers no gap on a diagram that cannot change', () => {
    render('step-a');
    expect(host!.querySelector('[data-insert-before]')).toBeNull();
  });

  it('puts Adjust pose and Annotate over a picture, for a pointer, and opens the step in each', () => {
    const onOpenIn = vi.fn();
    const onSelect = render(null, vi.fn(), {
      steps: [cpStep('step-p'), cpStep('step-unposed', undefined, null), createStep(() => 'step-empty')],
      onOpenIn,
    });
    const verbs = (stepId: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>(`[data-step-id="${stepId}"] button[title]`)].filter(
        (button) => button.title === 'Adjust Pose' || button.title === 'Annotate'
      );
    const [pose, annotate] = verbs('step-p');
    expect([pose?.title, annotate?.title]).toEqual(['Adjust Pose', 'Annotate']);
    // Out of the listbox's way: the same verbs are in the card's menu and the Step pane.
    expect(pose!.getAttribute('aria-hidden')).toBe('true');
    expect(pose!.tabIndex).toBe(-1);
    act(() => pose!.click());
    act(() => annotate!.click());
    expect(onOpenIn.mock.calls).toEqual([
      ['step-p', 'pose'],
      ['step-p', 'annotate'],
    ]);
    // The open selects the step itself; the card's own press would only repeat it.
    expect(onSelect).not.toHaveBeenCalled();
    // A link not captured yet is posed to choose how it shows; there is nothing to annotate.
    expect(verbs('step-unposed').map((button) => button.title)).toEqual(['Adjust Pose']);
    expect(verbs('step-empty')).toEqual([]);
  });

  it('has no Add step tile on a diagram that cannot change', () => {
    render(null);
    expect(host!.querySelector('[data-add-step-tile]')).toBeNull();
  });

  it('is one listbox of the steps, numbered in order', () => {
    render(null);
    expect(listbox().getAttribute('aria-label')).toBe('Steps');
    expect(options().map((option) => option.textContent)).toEqual([
      'Step 1EmptyNo picture yetUpload…Go to EditImportor a turnTurn overRotateNo instruction',
      'Step 2EmptyNo picture yetUpload…Go to EditImportor a turnTurn overRotateFold the corner\nto the centre.',
      'Step 3NewerMade with a newer Ori StudioNo instruction',
    ]);
  });

  it('marks the selected card and makes it the tab stop, and no card a button', () => {
    render('step-b');
    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(options().map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
    // The cards are the grid's one tab stop: an empty card's Upload… is a
    // pointer's shortcut, out of the tab order.
    for (const button of host?.querySelectorAll('button') ?? []) expect(button.tabIndex).toBe(-1);
    render(null);
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1, -1]);
  });

  it('reports a click on a card as a selection, and one between cards as none', () => {
    const onSelect = render(null);
    act(() => options()[2].click());
    expect(onSelect).toHaveBeenLastCalledWith('step-c');
    act(() => listbox().click());
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('moves focus with the selection while focus is in the grid or nowhere, and never takes it from a control', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      render('step-a');
      act(() => outside.focus());
      render('step-b');
      expect(document.activeElement).toBe(outside);

      act(() => options()[1].focus());
      render('step-c');
      expect(document.activeElement).toBe(options()[2]);

      // Focus dropped on the page — the focused card was deleted — is picked up.
      act(() => options()[2].blur());
      expect(document.activeElement).toBe(document.body);
      render('step-a');
      expect(document.activeElement).toBe(options()[0]);
    } finally {
      outside.remove();
    }
  });

  it('shows each step’s picture, and says what kind it is', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"/>';
    const assets: Record<string, DiagramAsset> = {
      'asset-s': { id: 'asset-s', kind: 'svg', svg, widthPx: 4, heightPx: 4, bytes: svg.length },
      'asset-r': {
        id: 'asset-r',
        kind: 'raster',
        src: 'data:image/png;base64,AAAA',
        widthPx: 4,
        heightPx: 4,
        bytes: 26,
      },
    };
    const upload = (id: string, assetId: string): DiagramStep => ({
      ...createStep(() => id),
      source: { kind: 'upload', assetId, rotationQuarterTurns: 0, mirrored: false },
      picture: { kind: 'asset', assetId, paperScale: null, key: `asset:${assetId}` },
    });
    render(null, vi.fn(), { steps: [upload('step-s', 'asset-s'), upload('step-r', 'asset-r')], assets });
    const pictures = [...(host?.querySelectorAll('img') ?? [])];
    expect(pictures).toHaveLength(2);
    expect(pictures[0].getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
    // An upright bitmap is shown from its own data, not wrapped and encoded again.
    expect(pictures[1].getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(options().map((option) => option.textContent?.slice(0, 9))).toEqual(['Step 1SVG', 'Step 2Ima']);
    // Each on the paper it prints on, not the theme's well.
    expect(host?.querySelectorAll('[data-picture]')).toHaveLength(2);
  });

  it('shows a linked step’s picture, and names how it is shown', () => {
    render(null, vi.fn(), {
      steps: [
        cpStep('step-cp'),
        cpStep(
          'step-flat',
          { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 },
          fixedPicture()
        ),
        cpStep('step-3d', { mode: 'folded-3d', camera: { yaw: 0, pitch: 0, zoom: 1 }, side: 'front' }, null),
      ],
    });
    const badges = options().map((option) => option.querySelector('[id$="-kind"]')?.textContent);
    expect(badges).toEqual(['Crease pattern', 'Folded', 'Folded · 3D']);
    // The two with pictures show them; the one not yet posed has none to show.
    expect(host?.querySelectorAll('img')).toHaveLength(2);
    expect(host?.querySelectorAll('[data-picture]')).toHaveLength(2);
  });

  it('marks a linked step with its pattern, and says when the pattern changed or went', () => {
    const stop = vi.fn();
    render(null, vi.fn(), {
      steps: [cpStep('step-a'), cpStep('step-b'), cpStep('step-c'), cpStep('step-d')],
      links: {
        statuses: new Map([
          ['step-a', 'current'],
          ['step-b', 'stale'],
          ['step-c', 'missing'],
          ['step-d', 'stale'],
        ]),
        captures: { 'step-d': { stoppable: true } },
        stop,
      },
    });
    const cards = options();
    // Every linked card shows its pattern in the corner.
    for (const card of cards) expect(card.querySelector('canvas[data-sheet-thumbnail]')).not.toBeNull();
    const name = (card: HTMLElement) =>
      card
        .getAttribute('aria-labelledby')!
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent)
        .join(' ');
    expect(cards.map(name)).toEqual([
      'Step 1 Crease pattern No instruction',
      'Step 2 Crease pattern Out of date No instruction',
      'Step 3 Crease pattern Pattern missing No instruction',
      // Capturing says so rather than how it stood.
      'Step 4 Crease pattern Capturing… No instruction',
    ]);
    const stopButton = [...cards[3]!.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stop'
    );
    act(() => stopButton?.click());
    expect(stop).toHaveBeenCalledWith('step-d');
  });

  it('says a step whose layer constraints need a look needs attention, not that it is out of date (layer order D10)', () => {
    const withRecord = (id: string, attention?: { reason: 'conflict' | 'route-3d'; count: number }): DiagramStep => {
      const step = cpStep(id);
      const record = { v: 1, faces: [{ at: [0, 0], area: 1 }], constraints: [], order: [], ...(attention ? { attention } : {}) };
      return { ...step, source: { ...(step.source as DiagramCpSource), layerOrder: JSON.stringify(record) } };
    };
    const chip = (card: HTMLElement) => card.querySelector('[data-tone]')?.textContent ?? null;
    render(null, vi.fn(), {
      steps: [
        withRecord('step-kept', { reason: 'conflict', count: 0 }),
        withRecord('step-drawn', { reason: 'conflict', count: 0 }),
        withRecord('step-waiting', { reason: 'route-3d', count: 0 }),
        withRecord('step-fine'),
      ],
      links: {
        statuses: new Map([
          ['step-kept', 'stale'],
          ['step-drawn', 'current'],
          ['step-waiting', 'stale'],
          ['step-fine', 'stale'],
        ]),
      },
    });
    expect(options().map(chip)).toEqual(['Needs attention', 'Needs attention', 'Out of date', 'Out of date']);
  });

  it('says a 3D step was lit by another style and that the pages cut a step’s text, and nothing of a flow step past its place', () => {
    const lit = cpStep(
      'step-3d',
      { mode: 'folded-3d', side: 'front', camera: { yaw: 0, pitch: 0, zoom: 1 } } as never,
      {
        ...scenePicture(),
        styleKey: 'another light',
      }
    );
    render(null, vi.fn(), {
      steps: [
        lit,
        { ...cpStep('step-cut'), text: 'A long one.' },
        { ...cpStep('step-grown'), text: 'A longer one, held.' },
      ],
      links: {
        statuses: new Map([
          ['step-3d', 'current'],
          ['step-cut', 'current'],
          ['step-grown', 'current'],
        ]),
      },
      // The pages report only a cut instruction (`stepPageFits`): a flow step past its place shows on the page.
      pageFits: new Map([['step-cut', 'text-cut']]),
    });
    const chips = options().map((card) => card.querySelector('[data-tone]')?.textContent ?? null);
    expect(chips).toEqual(['Lighting changed', 'Text doesn’t fit', null]);
  });

  it('offers an empty card a pattern to link only with one open, and Go to Edit without one', () => {
    const onLink = vi.fn();
    const onGoToEdit = vi.fn();
    render(null, vi.fn(), { onLink, onGoToEdit });
    const button = (name: string) =>
      [...options()[1]!.querySelectorAll('button')].find((candidate) => candidate.textContent === name);
    expect(button('Link…')).toBeUndefined();
    act(() => button('Go to Edit')?.click());
    expect(onGoToEdit).toHaveBeenCalledOnce();
    render(null, vi.fn(), { onLink, onGoToEdit, patternOpen: true });
    expect(button('Go to Edit')).toBeUndefined();
    act(() => button('Link…')?.click());
    expect(onLink).toHaveBeenCalledWith('step-b');
  });

  it('names each card from its number, kind and instruction, not from its pointer shortcut', () => {
    render(null);
    const name = (option: HTMLElement) =>
      option
        .getAttribute('aria-labelledby')!
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent)
        .join(' ');
    expect(options().map(name)).toEqual([
      'Step 1 Empty No instruction',
      'Step 2 Empty Fold the corner\nto the centre.',
      'Step 3 Newer No instruction',
    ]);
    // The shortcut is the pointer's: the menu and the Step pane carry the verb.
    for (const button of host?.querySelectorAll('button') ?? []) {
      expect(button.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('offers an empty card’s Import menu, whose every way fills that step, References with a pattern open and Fold with a step to take', () => {
    const onImport = vi.fn();
    render(null, vi.fn(), { onImport, patternOpen: true, foldSteps: true });
    const trigger = [...options()[1]!.querySelectorAll('button')].find((button) => button.textContent === 'Import')!;
    const choose = (name: string) => {
      act(() => trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
      const row = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === name
      );
      act(() => row?.click());
    };
    choose('From File (CP, Defox)…');
    choose('From References…');
    choose('From Fold…');
    expect(onImport.mock.calls).toEqual([
      ['step-b', 'import-steps'],
      ['step-b', 'from-references'],
      ['step-b', 'from-fold'],
    ]);
  });

  it('offers an empty card’s Upload… for that step', () => {
    const onUpload = vi.fn();
    render(null, vi.fn(), { onUpload });
    expect(host?.querySelectorAll('[data-picture]')).toHaveLength(0);
    const upload = options()[1].querySelector('button');
    act(() => upload?.click());
    expect(onUpload).toHaveBeenCalledWith('step-b');
    // The newer build's card offers nothing to change it: only its Delete.
    expect([...options()[2].querySelectorAll('button')].map((button) => button.title)).toEqual([
      'Delete Step',
    ]);
  });

  it('chips an enlarged step with the step its area is on, named in the card’s own name, and alone once the area is gone (Revision 2)', () => {
    const areaStep: DiagramStep = {
      ...createStep(() => 'step-area'),
      annotations: [{ id: 'area', kind: 'zoom', from: [0.5, 0.5], to: [0.5, 0.5], radius: 0.1 }],
    };
    const enlarged: DiagramStep = {
      ...createStep(() => 'step-big'),
      zoom: { from: 'area', shape: 'circle' },
    };
    render(null, vi.fn(), { steps: [areaStep, enlarged] });
    const chip = () => options()[1]!.querySelector('[data-enlarged-chip]');
    expect(chip()?.textContent).toBe('Enlarged · 1');
    expect(options()[0]!.querySelector('[data-enlarged-chip]')).toBeNull();
    // In the header beside the step's number and kind, where it covers none of the picture.
    const header = options()[1]!.querySelector('[id$="-number"]')!.parentElement!;
    expect(header.contains(chip())).toBe(true);
    // Named with it: a screen reader hears it as part of the card.
    const labelled = options()[1]!.getAttribute('aria-labelledby')!.split(' ');
    expect(labelled.some((id) => host!.querySelector(`[id="${id}"]`)?.textContent === 'Enlarged · 1')).toBe(
      true
    );
    render(null, vi.fn(), { steps: [{ ...areaStep, annotations: [] }, enlarged] });
    expect(chip()?.textContent).toBe('Enlarged');
  });

  it('says an enlarged step’s area changed, after its picture’s own out of date, and not for one with no record (review fix 4)', () => {
    const area = {
      id: 'area',
      kind: 'zoom' as const,
      from: [0.5, 0.5] as [number, number],
      to: [0.5, 0.5] as [number, number],
      radius: 0.1,
    };
    const areaStep: DiagramStep = { ...cpStep('step-area'), annotations: [area] };
    const areaWas = { stepId: 'step-area', outline: { centre: [0.5, 0.5] as [number, number], radius: 0.1 } };
    const enlarged = (id: string, record = true): DiagramStep => ({
      ...cpStep(id),
      zoom: { from: 'area', shape: 'circle', ...(record ? { areaWas } : {}) },
    });
    const moved: DiagramStep = { ...areaStep, annotations: [{ ...area, from: [0.6, 0.5], to: [0.6, 0.5] }] };
    const chip = (card: HTMLElement) => card.querySelector('[data-tone]')?.textContent ?? null;
    render(null, vi.fn(), {
      steps: [areaStep, enlarged('step-big')],
      links: { statuses: new Map([['step-big', 'current']]) },
    });
    expect(chip(options()[1]!)).toBeNull();
    render(null, vi.fn(), {
      steps: [moved, enlarged('step-big'), enlarged('step-stale'), enlarged('step-old', false)],
      links: {
        statuses: new Map([
          ['step-big', 'current'],
          ['step-stale', 'stale'],
          ['step-old', 'current'],
        ]),
      },
    });
    expect(options().map(chip)).toEqual([null, 'Area changed', 'Out of date', null]);
    // Named with it, as its picture's chip is.
    const labelled = options()[1]!.getAttribute('aria-labelledby')!.split(' ');
    expect(labelled.some((id) => host!.querySelector(`[id="${id}"]`)?.textContent === 'Area changed')).toBe(
      true
    );
  });

  it('shows where a dragged picture would land', () => {
    render(null, vi.fn(), { dropTarget: 'step-b' });
    expect(options().map((option) => option.hasAttribute('data-drop-target'))).toEqual([false, true, false]);
    expect(listbox().hasAttribute('data-drop-target')).toBe(false);
    render(null, vi.fn(), { dropTarget: 'grid' });
    expect(listbox().hasAttribute('data-drop-target')).toBe(true);
  });
});
