import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStep,
  DEFAULT_DIAGRAM_STYLE,
  type DiagramAsset,
  type DiagramEntry,
  type DiagramStep,
} from '../../diagram/document/diagramDocument';
import { cpStep, fixedPicture, scenePicture } from '../../diagram/document/diagramSteps.fixtures';
import type { DiagramCardLinks } from '../../diagram/capture/useCardLinks';
import { DiagramStepsGrid } from './DiagramStepsGrid';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
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
    onLink?: (stepId: string) => void;
    textCut?: ReadonlySet<string>;
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
        textCut={options.textCut ?? new Set()}
        patternOpen={options.patternOpen ?? false}
        onLink={options.onLink ?? vi.fn()}
        onFromReferences={vi.fn()}
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
    const round: DiagramEntry = { id: 'turn-2', kind: 'rotate', rotate: { amount: 'quarter', direction: 'ccw' } };
    const onInsertBefore = vi.fn();
    const onSelect = render('turn-1', vi.fn(), { steps: [over, steps[0]!, steps[1]!, round], onAppend: vi.fn(), onInsertBefore });
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
    const onSelect = render(null, vi.fn(), { steps: [cpStep('step-p'), createStep(() => 'step-empty'), over], onDelete });
    const deletes = () => [...host!.querySelectorAll<HTMLButtonElement>('button[data-danger]')];
    expect(deletes().map((button) => [button.closest('[data-step-id]')?.getAttribute('data-step-id'), button.title])).toEqual([
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

  it('offers an empty card a turn instead of a picture (D24)', () => {
    const onMakeTurn = vi.fn();
    render(null, vi.fn(), { steps: [createStep(() => 'step-empty')], onMakeTurn });
    const button = (label: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>('[data-step-id="step-empty"] button')].find((candidate) => candidate.textContent === label)!;
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
      'Step 1EmptyNo picture yetUpload…Go to Editor a turnTurn overRotateNo instruction',
      'Step 2EmptyNo picture yetUpload…Go to Editor a turnTurn overRotateFold the corner\nto the centre.',
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
      'asset-r': { id: 'asset-r', kind: 'raster', src: 'data:image/png;base64,AAAA', widthPx: 4, heightPx: 4, bytes: 26 },
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
        cpStep('step-flat', { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 }, fixedPicture()),
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
    for (const card of cards) expect(card.querySelector('svg line')).not.toBeNull();
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
    const stopButton = [...cards[3]!.querySelectorAll('button')].find((button) => button.textContent === 'Stop');
    act(() => stopButton?.click());
    expect(stop).toHaveBeenCalledWith('step-d');
  });

  it('says a 3D step was lit by another style, and that the pages cut a step’s text', () => {
    const lit = cpStep('step-3d', { mode: 'folded-3d', side: 'front', camera: { yaw: 0, pitch: 0, zoom: 1 } } as never, {
      ...scenePicture(),
      styleKey: 'another light',
    });
    render(null, vi.fn(), {
      steps: [lit, { ...cpStep('step-cut'), text: 'A long one.' }],
      links: { statuses: new Map([['step-3d', 'current'], ['step-cut', 'current']]) },
      textCut: new Set(['step-cut']),
    });
    const chips = options().map((card) => card.querySelector('[data-tone]')?.textContent ?? null);
    expect(chips).toEqual(['Lighting changed', 'Text doesn’t fit']);
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

  it('offers an empty card’s Upload… for that step', () => {
    const onUpload = vi.fn();
    render(null, vi.fn(), { onUpload });
    expect(host?.querySelectorAll('[data-picture]')).toHaveLength(0);
    const upload = options()[1].querySelector('button');
    act(() => upload?.click());
    expect(onUpload).toHaveBeenCalledWith('step-b');
    // The newer build's card offers nothing to change it: only its Delete.
    expect([...options()[2].querySelectorAll('button')].map((button) => button.title)).toEqual(['Delete Step']);
  });

  it('shows where a dragged picture would land', () => {
    render(null, vi.fn(), { dropTarget: 'step-b' });
    expect(options().map((option) => option.hasAttribute('data-drop-target'))).toEqual([false, true, false]);
    expect(listbox().hasAttribute('data-drop-target')).toBe(false);
    render(null, vi.fn(), { dropTarget: 'grid' });
    expect(listbox().hasAttribute('data-drop-target')).toBe(true);
  });
});
