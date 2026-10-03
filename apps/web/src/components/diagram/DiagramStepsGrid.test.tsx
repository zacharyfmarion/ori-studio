import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStep,
  DEFAULT_DIAGRAM_STYLE,
  type DiagramAsset,
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
    steps?: DiagramStep[];
    assets?: Record<string, DiagramAsset>;
    dropTarget?: string | null;
    onOpen?: (stepId: string) => void;
    onUpload?: (stepId: string) => void;
    links?: Partial<DiagramCardLinks>;
    patternOpen?: boolean;
    onLink?: (stepId: string) => void;
    textCut?: ReadonlySet<string>;
    onAppend?: () => void;
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
        steps={options.steps ?? steps}
        assets={options.assets ?? {}}
        style={DEFAULT_DIAGRAM_STYLE}
        selectedStepId={selectedStepId}
        dropTarget={options.dropTarget ?? null}
        readOnly={false}
        onSelect={onSelect}
        onOpen={options.onOpen ?? vi.fn()}
        onUpload={options.onUpload ?? vi.fn()}
        links={{
          statuses: new Map(),
          captures: {},
          stop: vi.fn(),
          refreshable: 0,
          awaitingReferences: null,
          askReferences: vi.fn(),
          cancelAwaiting: vi.fn(),
          ...options.links,
        }}
        textCut={options.textCut ?? new Set()}
        patternOpen={options.patternOpen ?? false}
        onLink={options.onLink ?? vi.fn()}
        onAppend={options.onAppend}
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
    expect(listbox().lastElementChild).toBe(tile);
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.tabIndex).toBe(-1);
    expect(options()).toHaveLength(steps.length);
    act(() => tile.click());
    expect(onAppend).toHaveBeenCalledOnce();
    // A press on the tile is not a press on empty space.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('has no Add step tile on a diagram that cannot change', () => {
    render(null);
    expect(host!.querySelector('[data-add-step-tile]')).toBeNull();
  });

  it('is one listbox of the steps, numbered in order', () => {
    render(null);
    expect(listbox().getAttribute('aria-label')).toBe('Steps');
    expect(options().map((option) => option.textContent)).toEqual([
      'Step 1EmptyNo picture yetUpload…No instruction',
      'Step 2EmptyNo picture yetUpload…Fold the corner\nto the centre.',
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

  it('offers an empty card a pattern to link only with one open', () => {
    const onLink = vi.fn();
    render(null, vi.fn(), { onLink });
    const linkButton = () =>
      [...options()[1]!.querySelectorAll('button')].find((button) => button.textContent === 'Link…');
    expect(linkButton()).toBeUndefined();
    render(null, vi.fn(), { onLink, patternOpen: true });
    act(() => linkButton()?.click());
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
    // The newer build's card offers nothing to change it.
    expect(options()[2].querySelector('button')).toBeNull();
  });

  it('shows where a dragged picture would land', () => {
    render(null, vi.fn(), { dropTarget: 'step-b' });
    expect(options().map((option) => option.hasAttribute('data-drop-target'))).toEqual([false, true, false]);
    expect(listbox().hasAttribute('data-drop-target')).toBe(false);
    render(null, vi.fn(), { dropTarget: 'grid' });
    expect(listbox().hasAttribute('data-drop-target')).toBe(true);
  });
});
