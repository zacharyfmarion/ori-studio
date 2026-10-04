import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE } from '../../diagram/document/diagramDocument';
import type { BrowserCard, BrowserPattern } from '../../diagram/references/referencesBrowserPlans';
import type { DiagramReferencesBrowserState } from '../../store/workspaceStore/types';
import { DiagramReferencesBrowser } from './DiagramReferencesBrowser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The browser's keys through its real hook (`useReferencesBrowser`), with only
 * where its cards come from stood in: the selection's updates, which a card's
 * own focus event joins in the same key press, are what is under test.
 */
const PATTERN = { id: 'plan-a', number: 1, component: { outline: [[0, 0], [1, 0], [1, 1]] }, listing: {} } as unknown as BrowserPattern;
vi.mock('../../diagram/references/useReferencesSheets', () => ({
  useReferencesSheets: () => ({
    geometry: {},
    revision: 'rev-1',
    analysis: {},
    patterns: { status: 'ready', patterns: [PATTERN] },
  }),
  useDecodedPlan: () => ({ id: 'plan-a', plan: {} }),
}));
vi.mock('../../diagram/references/referencesBrowserPlans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../diagram/references/referencesBrowserPlans')>()),
  browserPlanCards: () => ({ cards: [0, 1, 2, 3].map(card), finished: true, settings: null }),
}));
vi.mock('../../platform/phoneLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/phoneLayout')>()),
  useIsPhoneLayout: () => false,
}));

function card(index: number): BrowserCard {
  return {
    index,
    kind: 'fold',
    number: index + 1,
    badge: '',
    sentence: `Fold ${index}.`,
    ways: null,
    step: { card: { card: index + 1, line: null }, picture: null, way: null } as unknown as BrowserCard['step'],
  };
}

const STATE: DiagramReferencesBrowserState = { anchor: { kind: 'end' }, opening: 1, mode: 'sequence', pattern: null, shown: null };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<DiagramReferencesBrowser state={STATE} style={DEFAULT_DIAGRAM_STYLE} />));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const options = () => [...host!.querySelectorAll<HTMLElement>('[role="option"]')];
const chosen = () => options().map((option) => option.getAttribute('aria-selected') === 'true');
const key = (init: KeyboardEventInit) =>
  act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));

describe('the References browser’s keys, through its own selection', () => {
  it('extends the selection with Shift and an arrow, Home or End, from the card last pressed', () => {
    act(() => options()[1]!.focus());
    key({ key: ' ' });
    expect(chosen()).toEqual([false, true, false, false]);
    key({ key: 'ArrowRight', shiftKey: true });
    expect(document.activeElement).toBe(options()[2]);
    expect(chosen()).toEqual([false, true, true, false]);
    key({ key: 'End', shiftKey: true });
    expect(document.activeElement).toBe(options()[3]);
    expect(chosen()).toEqual([false, true, true, true]);
  });

  it('moves without choosing when Shift is not held', () => {
    act(() => options()[0]!.focus());
    key({ key: 'ArrowRight' });
    expect(document.activeElement).toBe(options()[1]);
    expect(chosen()).toEqual([false, false, false, false]);
  });
});
