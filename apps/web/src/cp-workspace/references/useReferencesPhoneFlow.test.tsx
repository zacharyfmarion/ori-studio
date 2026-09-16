import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';
import {
  referencesPhoneHasList,
  referencesPhoneScreen,
  useReferencesPhoneFlow,
  type ReferencesPhoneFlow,
  type ReferencesPhoneFlowActions,
  type ReferencesPhoneFlowView,
} from './useReferencesPhoneFlow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties: Record<string, unknown> }[] = [];
vi.mock('../../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties: Record<string, unknown>) => {
    tracked.push({ event, properties });
  },
}));

/**
 * The layout is a media query, which jsdom cannot answer. Stubbed rather than
 * mocked away so the off-phone case runs through the same predicate the
 * desktop does.
 */
function stubLayout(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY ? phone : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: ReferencesPhoneFlow | null = null;

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
  latest = null;
  tracked.length = 0;
  vi.unstubAllGlobals();
});

/**
 * Declared once: a component type declared per render would remount and lose
 * the state. Captured in an effect, not during render: `act` flushes effects
 * before it returns, so `latest` is current by the time a test reads it.
 */
function Probe({
  view,
  actions,
}: {
  view: ReferencesPhoneFlowView;
  actions: ReferencesPhoneFlowActions;
}) {
  const flow = useReferencesPhoneFlow(view, actions);
  useEffect(() => {
    latest = flow;
  });
  return null;
}

const NOOP: ReferencesPhoneFlowActions = { selectSheet: () => {}, selectFinding: () => {} };

function render(view: ReferencesPhoneFlowView, actions: Partial<ReferencesPhoneFlowActions> = {}) {
  act(() => root?.render(<Probe view={view} actions={{ ...NOOP, ...actions }} />));
}

const DOC: ReferencesPhoneFlowView = {
  hasDocument: true,
  revision: '1:abc',
  sheets: 2,
  failed: false,
};
const NONE: ReferencesPhoneFlowView = {
  hasDocument: false,
  revision: 'none',
  sheets: 0,
  failed: false,
};

describe('referencesPhoneScreen', () => {
  it('shows the detail without a document, whose overlay says what to do', () => {
    expect(referencesPhoneHasList(NONE)).toBe(false);
    expect(referencesPhoneScreen({ screen: 'list', revision: 'none' }, NONE)).toBe('detail');
  });

  // A run that fails before it finds a pattern — the worker died, say — leaves
  // the list empty and the error on the detail's overlay, beside Recompute.
  it('shows the detail when the run failed and there is nothing to list', () => {
    const failed = { ...DOC, sheets: 0, failed: true };
    expect(referencesPhoneHasList(failed)).toBe(false);
    expect(referencesPhoneScreen({ screen: 'list', revision: '1:abc' }, failed)).toBe('detail');
    // With patterns to list, a failure is read from a pattern's own detail.
    expect(referencesPhoneHasList({ ...DOC, failed: true })).toBe(true);
    expect(referencesPhoneScreen({ screen: 'list', revision: '1:abc' }, { ...DOC, failed: true })).toBe(
      'list'
    );
    // And an empty list that has not failed is still the list: it says so.
    expect(referencesPhoneHasList({ ...DOC, sheets: 0 })).toBe(true);
  });

  it('returns to the list when the document the choice was made for is gone', () => {
    const next = { ...DOC, revision: '2:def' };
    expect(referencesPhoneScreen({ screen: 'detail', revision: '1:abc' }, next)).toBe('list');
  });

  it('keeps the choice for the document it was made for', () => {
    expect(referencesPhoneScreen({ screen: 'detail', revision: '1:abc' }, DOC)).toBe('detail');
    expect(referencesPhoneScreen({ screen: 'list', revision: '1:abc' }, DOC)).toBe('list');
  });
});

describe('useReferencesPhoneFlow', () => {
  it('starts on the list, with nowhere to go back to', () => {
    stubLayout(true);
    render(DOC);
    expect(latest?.screen).toBe('list');
    expect(latest?.back).toBeNull();
  });

  it('opens a sheet by selecting it and showing the detail', () => {
    stubLayout(true);
    const selectSheet = vi.fn();
    render(DOC, { selectSheet });
    act(() => latest?.openSheet(7));
    expect(selectSheet).toHaveBeenCalledWith(7);
    expect(latest?.screen).toBe('detail');
    expect(latest?.back).not.toBeNull();
    expect(tracked).toEqual([
      { event: 'referencesPatternOpened', properties: { source: 'card' } },
    ]);
  });

  // The finding frames itself on the canvas, and the canvas is on the detail.
  it('opens the detail for a finding pressed on the list', () => {
    stubLayout(true);
    const selectFinding = vi.fn();
    render(DOC, { selectFinding });
    act(() => latest?.openFinding(2));
    expect(selectFinding).toHaveBeenCalledWith(2);
    expect(latest?.screen).toBe('detail');
    expect(tracked).toEqual([
      { event: 'referencesPatternOpened', properties: { source: 'finding' } },
    ]);
    // Clearing the finding is not a press on one: it goes nowhere.
    act(() => latest?.back?.());
    act(() => latest?.openFinding(null));
    expect(selectFinding).toHaveBeenLastCalledWith(null);
    expect(latest?.screen).toBe('list');
    expect(tracked).toHaveLength(1);
  });

  it('goes back to the list', () => {
    stubLayout(true);
    render(DOC);
    act(() => latest?.openSheet(0));
    act(() => latest?.back?.());
    expect(latest?.screen).toBe('list');
    expect(latest?.back).toBeNull();
  });

  it('shows the error on the detail when the run failed with nothing to list', () => {
    stubLayout(true);
    render({ ...DOC, sheets: 0, failed: true });
    expect(latest?.screen).toBe('detail');
    // An empty list is nowhere to go back to.
    expect(latest?.back).toBeNull();
  });

  // A new file, an edit that reshapes the sheets, or the document closing: the
  // sheet the detail was opened for may no longer exist, so the list is the
  // only honest screen — and it is the list on the same render, with no frame
  // of the stale detail.
  it('returns to the list when the document changes under the detail', () => {
    stubLayout(true);
    render(DOC);
    act(() => latest?.openSheet(0));
    expect(latest?.screen).toBe('detail');
    render({ ...DOC, revision: '2:def' });
    expect(latest?.screen).toBe('list');
    // And can be opened again for the new document.
    act(() => latest?.openSheet(0));
    expect(latest?.screen).toBe('detail');
  });

  it('shows the empty detail without a document, and the list once one arrives', () => {
    stubLayout(true);
    render(NONE);
    expect(latest?.screen).toBe('detail');
    // No list to go back to, so no Back button.
    expect(latest?.back).toBeNull();
    render(DOC);
    expect(latest?.screen).toBe('list');
  });

  it('answers null off the phone, where a press is the selection alone', () => {
    stubLayout(false);
    const selectSheet = vi.fn();
    const selectFinding = vi.fn();
    render(DOC, { selectSheet, selectFinding });
    expect(latest?.screen).toBeNull();
    expect(latest?.back).toBeNull();
    act(() => latest?.openSheet(3));
    expect(selectSheet).toHaveBeenCalledWith(3);
    act(() => latest?.openFinding(1));
    expect(selectFinding).toHaveBeenCalledWith(1);
    expect(latest?.screen).toBeNull();
    // Nothing was opened, so nothing is counted as opened.
    expect(tracked).toEqual([]);
  });
});
