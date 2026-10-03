import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE, type DiagramPullAnchor } from '../../diagram/document/diagramDocument';
import type { BrowserCard } from '../../diagram/references/referencesBrowserPlans';
import { browserSelection } from '../../diagram/references/referencesBrowserSelection';
import type { ReferencesBrowser } from '../../diagram/references/useReferencesBrowser';
import { runDiagramShortcut, type DiagramBrowserKeys } from '../../diagram/actions/diagramShortcuts';
import type { DiagramReferencesBrowserState } from '../../store/workspaceStore/types';
import { DiagramReferencesBrowser } from './DiagramReferencesBrowser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hook = vi.hoisted(() => ({ browser: null as unknown as ReferencesBrowser }));
vi.mock('../../diagram/references/useReferencesBrowser', () => ({ useReferencesBrowser: () => hook.browser }));
// The step keys reach the browser through the Diagram's registration: run
// them against it as the shortcut runtime would.
const keys = vi.hoisted(() => ({ current: null as DiagramBrowserKeys | null }));
vi.mock('../../diagram/useDiagramShortcuts', () => ({
  registerDiagramBrowserKeys: (registered: typeof keys.current) => {
    keys.current = registered;
    return () => {
      if (keys.current === registered) keys.current = null;
    };
  },
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function card(index: number, kind: BrowserCard['kind'] = 'fold'): BrowserCard {
  return {
    index,
    kind,
    number: kind === 'fold' ? index : null,
    badge: '',
    sentence: `Fold ${index}.`,
    ways: index === 1 ? 2 : null,
    step: { card: { card: index, line: null }, picture: null, way: null } as unknown as BrowserCard['step'],
  };
}

const PATTERN = { id: 'plan-a', number: 1, component: {}, listing: {} } as unknown as ReferencesBrowser['pattern'];

function browser(patch: Partial<ReferencesBrowser> = {}, anchor: DiagramPullAnchor = { kind: 'end' }): ReferencesBrowser {
  const state: DiagramReferencesBrowserState = { anchor, mode: 'sequence', pattern: null, shown: null };
  return {
    state,
    patterns: { status: 'ready', patterns: [PATTERN!] },
    pattern: PATTERN,
    cards: {
      status: 'ready',
      cards: [card(0, 'turn-over'), card(1), card(2)],
      finished: true,
      settings: { precreaseGrid: true, gridWhereNeeded: true, allowDanglingFolds: false, mergeSymmetricSteps: true },
    },
    inDiagram: new Map([[2, 5]]),
    patternUse: new Map([['plan-a', 1]]),
    shownCard: null,
    selection: browserSelection.empty(),
    pullable: [],
    pulling: false,
    turnOverBefore: null,
    withTurnOver: true,
    setWithTurnOver: vi.fn(),
    anchorNumber: null,
    anchorTakesFirst: false,
    choosePattern: vi.fn(),
    setMode: vi.fn(),
    press: vi.fn(),
    move: vi.fn(() => 2),
    selectAll: vi.fn(),
    clear: vi.fn(),
    add: vi.fn(),
    addOne: vi.fn(),
    close: vi.fn(),
    openReferences: vi.fn(),
    ...patch,
  };
}

function render(next: ReferencesBrowser) {
  hook.browser = next;
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root?.render(<DiagramReferencesBrowser state={next.state} style={DEFAULT_DIAGRAM_STYLE} drawerSlot={() => {}} />)
  );
}

const text = () => host?.textContent ?? '';
const button = (label: string) =>
  [...(host?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === label);
const options = () => [...(host?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
const pulled = (count: number) => Array.from({ length: count }, () => ({}) as ReferencesBrowser['pullable'][number]);

beforeEach(() => {
  keys.current = null;
});

describe('the References browser', () => {
  it('lists the planned patterns, the plan’s settings, and its cards with what the diagram already uses', () => {
    render(browser());
    expect(text()).toContain('Pattern 1');
    expect(text()).toContain('1 in diagram');
    expect(text()).toContain('Planned with');
    expect(text()).toContain('Only where needed');
    expect(text()).not.toContain('Allow dangling folds');
    expect(options().map((option) => option.querySelector('span:nth-child(2)')?.textContent)).toEqual([
      'Turn over',
      'Card 1',
      'Card 2',
    ]);
    expect(text()).toContain('In diagram · step 5');
    expect(text()).toContain('2 ways');
  });

  it('says what it adds, and where, by how it was opened', () => {
    render(browser({ pullable: pulled(1) }));
    expect(text()).toContain('Add from References');
    expect(button('Add step')).toBeTruthy();
    render(browser({ pullable: pulled(3), anchorNumber: 2 }, { kind: 'after', stepId: 's' }));
    expect(text()).toContain('Add after step 2');
    expect(button('Add 3 steps after step 2')).toBeTruthy();
    render(browser({ pullable: pulled(3), anchorNumber: 2, anchorTakesFirst: true }, { kind: 'fill', stepId: 's' }));
    expect(button('Fill step 2 and add 2 after it')).toBeTruthy();
    render(browser({ pullable: pulled(1), anchorNumber: 4, anchorTakesFirst: true }, { kind: 'replace', stepId: 's', sentence: null }));
    expect(text()).toContain('Replace step 4’s card');
    expect(button('Replace step 4’s card')).toBeTruthy();
    // A step that can no longer take a card (it got a picture another way): the cards go after it.
    render(browser({ pullable: pulled(1), anchorNumber: 2, anchorTakesFirst: false }, { kind: 'fill', stepId: 's' }));
    expect(button('Add step after step 2')).toBeTruthy();
  });

  it('selects with a press, adds with a double-click or the footer, and holds while a pull runs', () => {
    const current = browser({ pullable: pulled(1) });
    render(current);
    act(() => options()[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    expect(current.press).toHaveBeenCalledWith(1, { range: true, toggle: false });
    act(() => options()[2]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(current.addOne).toHaveBeenCalledWith(2);
    act(() => button('Add step')!.click());
    expect(current.add).toHaveBeenCalledOnce();
    render(browser({ pullable: pulled(1), pulling: true }));
    expect(button('Adding…')?.disabled).toBe(true);
  });

  it('offers the turn-over before the selection, and can leave it out', () => {
    const current = browser({ turnOverBefore: 0, pullable: pulled(2) });
    render(current);
    expect(options()[0]!.dataset.offered).toBe('true');
    const box = host!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => box.click());
    expect(current.setWithTurnOver).toHaveBeenCalledWith(false);
  });

  it('walks its cards with the step keys, the card landed on taking focus, and adds with Enter', () => {
    const current = browser();
    render(current);
    const run = (id: Parameters<typeof runDiagramShortcut>[0]) =>
      runDiagramShortcut(
        id,
        { stepIds: [], selectedStepId: null, readOnly: false, browserOpen: true },
        { select: vi.fn(), move: vi.fn(), open: vi.fn(), close: vi.fn(), browser: keys.current }
      );
    act(() => void run('diagram.nextStep'));
    expect(current.move).toHaveBeenCalledWith('next');
    expect(document.activeElement).toBe(options()[2]);
    act(() => void run('diagram.openStep'));
    expect(current.add).toHaveBeenCalledOnce();
    // One Tab stop: the first card, with nothing pressed yet.
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1, -1]);
  });

  it('says why there is nothing to pull, and where to go', () => {
    const current = browser({ patterns: { status: 'ready', patterns: [] }, pattern: null, cards: { status: 'none' } });
    render(current);
    expect(text()).toContain('No pattern has a plan yet.');
    expect(host!.querySelector('nav')).toBeNull();
    act(() => button('Open References')!.click());
    expect(current.openReferences).toHaveBeenCalled();
    render(browser({ patterns: { status: 'finding' }, pattern: null, cards: { status: 'none' } }));
    expect(text()).toContain('Finding the patterns…');
    render(browser({ patterns: { status: 'no-pattern' }, pattern: null, cards: { status: 'none' } }));
    expect(text()).toContain('Open a crease pattern in Edit');
  });

  it('goes back to the steps', () => {
    const current = browser();
    render(current);
    act(() => button('Steps')!.click());
    expect(current.close).toHaveBeenCalled();
  });
});
