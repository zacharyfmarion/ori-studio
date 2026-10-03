import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStep,
  type DiagramAsset,
  type DiagramStep,
} from '../../diagram/document/diagramDocument';
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
    onUpload?: (stepId: string) => void;
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
        selectedStepId={selectedStepId}
        dropTarget={options.dropTarget ?? null}
        readOnly={false}
        onSelect={onSelect}
        onUpload={options.onUpload ?? vi.fn()}
      />
    )
  );
  return onSelect;
}

const listbox = () => host?.querySelector('[role="listbox"]') as HTMLElement;
const options = () => [...(host?.querySelectorAll('[role="option"]') ?? [])] as HTMLElement[];

describe('DiagramStepsGrid', () => {
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
  });

  it('offers an empty card’s Upload… for that step', () => {
    const onUpload = vi.fn();
    render(null, vi.fn(), { onUpload });
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
