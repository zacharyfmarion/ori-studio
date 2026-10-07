import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE, type DiagramPullAnchor } from '../../diagram/document/diagramDocument';
import type { BrowserCard } from '../../diagram/references/referencesBrowserPlans';
import { browserSelection } from '../../diagram/references/referencesBrowserSelection';
import type { ReferencesBrowser } from '../../diagram/references/useReferencesBrowser';
import type { DiagramReferencesBrowserState } from '../../store/workspaceStore/types';
import { DiagramReferencesBrowser } from './DiagramReferencesBrowser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hook = vi.hoisted(() => ({ browser: null as unknown as ReferencesBrowser }));
vi.mock('../../diagram/references/useReferencesBrowser', () => ({ useReferencesBrowser: () => hook.browser }));

const layout = vi.hoisted(() => ({ phone: false }));
vi.mock('../../platform/phoneLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/phoneLayout')>()),
  useIsPhoneLayout: () => layout.phone,
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
  const state: DiagramReferencesBrowserState = { anchor, opening: 1, mode: 'sequence', pattern: null, shown: null };
  return {
    state,
    patterns: { status: 'ready', patterns: [PATTERN!] },
    pattern: PATTERN,
    patternNamed: false,
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
    marks: { letters: true, highlights: true },
    toggleMark: vi.fn(),
    turnOverBefore: null,
    withTurnOver: true,
    setWithTurnOver: vi.fn(),
    anchorNumber: null,
    anchorTakesFirst: false,
    choosePattern: vi.fn(),
    setMode: vi.fn(),
    press: vi.fn(),
    move: vi.fn(() => 2),
    focusOn: vi.fn(),
    extend: vi.fn(() => 1),
    toggle: vi.fn(),
    selectAll: vi.fn(),
    clear: vi.fn(),
    add: vi.fn(),
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
  act(() => root?.render(<DiagramReferencesBrowser state={next.state} style={DEFAULT_DIAGRAM_STYLE} />));
}

const text = () => host?.textContent ?? '';
const button = (label: string) =>
  [...(host?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === label);
const options = () => [...(host?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
const pulled = (count: number, kind: 'fold' | 'turn-over' = 'fold') =>
  Array.from({ length: count }, () => ({ card: { kind } }) as ReferencesBrowser['pullable'][number]);

const surface = () => host!.querySelector<HTMLElement>('[role="document"]')!;
const key = (target: Element, init: KeyboardEventInit) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));

beforeEach(() => {
  layout.phone = false;
});

describe('the References browser', () => {
  // 17d (RM4): which marks a pull brings, in the bar beside Sequence | Find; a switch per mark, the menu open for the next.
  it('shows the marks a pull brings in its Show menu, and changes one at a time', () => {
    render(browser());
    expect(button('Show')).toBeTruthy();
    // A mark hidden, by a choice remembered from another day perhaps: the trigger says so (17d review).
    const toggleMark = vi.fn();
    render(browser({ marks: { letters: true, highlights: false }, toggleMark }));
    expect(button('Show')).toBeUndefined();
    const show = button('Show · 1 hidden');
    expect(show).toBeTruthy();
    act(() => {
      show!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      show!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const rows = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitemcheckbox"]')];
    expect(rows.map((row) => [row.textContent, row.getAttribute('aria-checked')])).toEqual([
      ['LettersThe names of the points a step refers to. Its instruction may still name them.', 'true'],
      ['Reference linesThe lines a step lines up against.', 'false'],
    ]);
    act(() => rows[1]!.click());
    expect(toggleMark).toHaveBeenCalledWith('highlights');
    // A switch, not a verb: the menu stays open.
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    act(() => document.querySelector<HTMLElement>('[role="menu"] [role="menuitemcheckbox"]')!.click());
    expect(toggleMark).toHaveBeenLastCalledWith('letters');
  });

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
    render(browser({ pullable: pulled(1), anchorNumber: 4, anchorTakesFirst: true }, { kind: 'replace', stepId: 's' }));
    expect(text()).toContain('Replace step 4’s card');
    expect(button('Replace step 4’s card')).toBeTruthy();
    // A step that can no longer take a card (it got a picture another way): the cards go after it.
    render(browser({ pullable: pulled(1), anchorNumber: 2, anchorTakesFirst: false }, { kind: 'fill', stepId: 's' }));
    expect(button('Add step after step 2')).toBeTruthy();
  });

  it('chooses with a press, a range with Shift, adds from the footer, and holds while a pull runs', () => {
    const current = browser({ pullable: pulled(1) });
    render(current);
    act(() => options()[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(current.press).toHaveBeenLastCalledWith(1, { range: false });
    act(() => options()[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    expect(current.press).toHaveBeenLastCalledWith(2, { range: true });
    // Pressed twice to take a card away again: a double-click adds nothing.
    act(() => options()[2]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(current.add).not.toHaveBeenCalled();
    act(() => button('Add step')!.click());
    expect(current.add).toHaveBeenCalledOnce();
    render(browser({ pullable: pulled(1), pulling: true }));
    expect(button('Adding…')?.disabled).toBe(true);
  });

  it('says why a card cannot be chosen: the ending of a plan that stopped before its end', () => {
    const stopped = browser();
    stopped.cards = { status: 'ready', cards: [card(0), card(1, 'done')], finished: false, settings: null };
    render(stopped);
    expect(options().map((option) => option.getAttribute('aria-disabled'))).toEqual([null, 'true']);
    expect(options()[1]!.title).toContain('stopped before its end');
    const finished = browser();
    finished.cards = { status: 'ready', cards: [card(0), card(1, 'done')], finished: true, settings: null };
    render(finished);
    expect(options()[1]!.getAttribute('aria-disabled')).toBeNull();
  });

  it('offers the turn-over before the selection, and can leave it out', () => {
    const current = browser({ turnOverBefore: 0, pullable: pulled(2) });
    render(current);
    expect(options()[0]!.dataset.offered).toBe('true');
    const box = host!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => box.click());
    expect(current.setWithTurnOver).toHaveBeenCalledWith(false);
  });

  it('walks its cards with its own keys, the card landed on taking focus; Space chooses, Enter adds', () => {
    const current = browser();
    render(current);
    // One Tab stop: the first card, with nothing pressed yet; a card that takes focus is where the keyboard is.
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1, -1]);
    act(() => options()[0]!.focus());
    expect(current.focusOn).toHaveBeenLastCalledWith(0);
    // From the dialog itself, where focus rests before a card has it.
    key(surface(), { key: 'ArrowRight' });
    expect(current.move).toHaveBeenCalledWith('next');
    expect(document.activeElement).toBe(options()[2]);
    // Shift with a move extends to the card it lands on, which takes focus.
    key(options()[2]!, { key: 'ArrowLeft', shiftKey: true });
    expect(current.extend).toHaveBeenCalledWith('previous');
    expect(document.activeElement).toBe(options()[1]);
    key(options()[1]!, { key: 'Home' });
    expect(current.move).toHaveBeenLastCalledWith('first');
    key(options()[1]!, { key: ' ' });
    expect(current.toggle).toHaveBeenCalledOnce();
    key(options()[1]!, { key: 'a', metaKey: true });
    expect(current.selectAll).toHaveBeenCalledOnce();
    key(options()[1]!, { key: 'Enter' });
    expect(current.add).toHaveBeenCalledOnce();
    // Enter on a button is the button's.
    key(button('Select all')!, { key: 'Enter' });
    expect(current.add).toHaveBeenCalledOnce();
  });

  it('is a modal that holds the keys, and closes from its button, Cancel, Escape and the backdrop', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const current = browser();
    render(current);
    const dialog = host!.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.hasAttribute('data-shortcut-barrier')).toBe(true);
    expect(dialog.getAttribute('aria-label')).toBe('Add from References');
    expect(surface().contains(document.activeElement)).toBe(true);
    act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Close Add from References"]')!.click());
    act(() => button('Cancel')!.click());
    key(document.body, { key: 'Escape' });
    act(() => void dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(current.close).toHaveBeenCalledTimes(4);
    // A press inside it is not a press on the backdrop.
    act(() => void surface().dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(current.close).toHaveBeenCalledTimes(4);
    // Closed, focus goes back where it was.
    act(() => root?.unmount());
    root = null;
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('gives focus back to the step it was opened for, from a menu with nothing to go back to', () => {
    const card = document.createElement('div');
    card.setAttribute('role', 'option');
    card.dataset.stepId = 'step-7';
    card.tabIndex = -1;
    document.body.append(card);
    render(browser({}, { kind: 'fill', stepId: 'step-7' }));
    act(() => root?.unmount());
    root = null;
    expect(document.activeElement).toBe(card);
    card.remove();
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

});

describe('the References browser on a phone', () => {
  const second = { id: 'plan-b', number: 2, component: {}, listing: {} } as unknown as NonNullable<ReferencesBrowser['pattern']>;
  const screen = () => surface().dataset.screen;
  const closeButton = () => host!.querySelector('button[aria-label^="Close"]');

  const patternButton = (name: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>('nav button')].find((b) => b.textContent?.includes(name))!;

  it('lists the patterns first, then a pattern’s cards with Back to the list', () => {
    layout.phone = true;
    const current = browser({ patterns: { status: 'ready', patterns: [PATTERN!, second] } });
    render(current);
    expect(screen()).toBe('list');
    expect(closeButton()).toBeTruthy();
    act(() => patternButton('Pattern 2').click());
    expect(current.choosePattern).toHaveBeenCalledWith('plan-b');
    expect(screen()).toBe('detail');
    act(() => button('Patterns')!.click());
    expect(screen()).toBe('list');
  });

  it('puts focus where a press went: the browser on the cards, the pattern just left on the list', () => {
    layout.phone = true;
    const both: ReferencesBrowser['patterns'] = { status: 'ready', patterns: [PATTERN!, second] };
    render(browser({ patterns: both }));
    const pressed = patternButton('Pattern 2');
    pressed.focus();
    act(() => pressed.click());
    // The pattern's button is off screen now; the dialog has focus, its next Tab ← Patterns.
    expect(document.activeElement).toBe(surface());
    render(browser({ patterns: both, pattern: second, patternNamed: true }));
    act(() => button('Patterns')!.click());
    expect(document.activeElement).toBe(patternButton('Pattern 2'));
  });

  it('leaves the cards alone on the list, where they are off screen', () => {
    layout.phone = true;
    const current = browser({ patterns: { status: 'ready', patterns: [PATTERN!, second] } });
    render(current);
    expect(screen()).toBe('list');
    key(surface(), { key: 'ArrowDown' });
    key(surface(), { key: ' ' });
    key(surface(), { key: 'Enter' });
    expect(current.move).not.toHaveBeenCalled();
    expect(current.toggle).not.toHaveBeenCalled();
    expect(current.add).not.toHaveBeenCalled();
    act(() => patternButton('Pattern 2').click());
    key(surface(), { key: 'ArrowDown' });
    expect(current.move).toHaveBeenCalledWith('next');
  });

  it('opens straight on the cards of a single pattern, and in Find', () => {
    layout.phone = true;
    render(browser());
    expect(screen()).toBe('detail');
    expect(button('Patterns')).toBeUndefined();
    expect(closeButton()).toBeTruthy();
    // Find shows one answer, whatever References has planned.
    const find = browser({ patterns: { status: 'ready', patterns: [PATTERN!, second] } });
    find.state.mode = 'find';
    render(find);
    expect(screen()).toBe('detail');
    expect(button('Patterns')).toBeUndefined();
  });

  it('opens Replace on the cards of its own pattern, found by its plan or its sheet', () => {
    layout.phone = true;
    const replace = { kind: 'replace', stepId: 's' } as const;
    // Its plan listed, or planned again and found by its sheet: the browser names it either way.
    const current = browser(
      { patterns: { status: 'ready', patterns: [PATTERN!, second] }, pattern: second, patternNamed: true },
      replace
    );
    render(current);
    expect(screen()).toBe('detail');
    expect(button('Patterns')).toBeTruthy();
  });

  it('opens Replace on the list when its own pattern is not among them', () => {
    layout.phone = true;
    render(browser({ patterns: { status: 'ready', patterns: [PATTERN!, second] } }, { kind: 'replace', stepId: 's' }));
    expect(screen()).toBe('list');
  });

  it('shows both side by side on any other layout', () => {
    render(browser({ patterns: { status: 'ready', patterns: [PATTERN!, second] } }));
    expect(screen()).toBeUndefined();
  });
});
