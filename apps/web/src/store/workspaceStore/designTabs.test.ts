import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DESIGN_TITLE,
  clearActiveDesignContent,
  markActiveTabBoxPleat,
  activeDesignTab,
  createDesignTab,
  designMethodOf,
  initialDesignTabs,
  nextDesignTabId,
  resetDesignTabIds,
  selectDesignMethod,
  singleDesignTab,
  type DesignTab,
  uniqueDesignTitle,
  withActiveTab,
} from './designTabs';

beforeEach(() => {
  resetDesignTabIds();
});

const tab = (id: string, kind: DesignTab['kind'] = null, title = id): DesignTab =>
  // Built through the real constructor so the test cannot fabricate a tab shape
  // the union forbids — e.g. a kind with no content.
  ({ ...createDesignTab([], { kind, title }), id });

describe('ids', () => {
  it('are unique and readable', () => {
    expect(nextDesignTabId()).toBe('design-1');
    expect(nextDesignTabId()).toBe('design-2');
  });

  it('skip ids already taken by tabs that came from a file', () => {
    // A loaded `.osf` supplies its own document ids; a new tab must not collide
    // with one just because the session counter happens to be low.
    const existing = [tab('design-1'), tab('design-2')];
    expect(nextDesignTabId(existing)).toBe('design-3');
  });
});

describe('titles', () => {
  it('leave a lone tab without a pointless suffix', () => {
    expect(uniqueDesignTitle([])).toBe(DEFAULT_DESIGN_TITLE);
  });

  it('suffix only on collision, starting at 2', () => {
    const one = [tab('a', null, DEFAULT_DESIGN_TITLE)];
    expect(uniqueDesignTitle(one)).toBe(`${DEFAULT_DESIGN_TITLE} 2`);

    const two = [...one, tab('b', null, `${DEFAULT_DESIGN_TITLE} 2`)];
    expect(uniqueDesignTitle(two)).toBe(`${DEFAULT_DESIGN_TITLE} 3`);
  });

  it('respects an explicit base name', () => {
    expect(uniqueDesignTitle([tab('a', null, 'Crane')], 'Crane')).toBe('Crane 2');
  });
});

describe('createDesignTab', () => {
  it('defaults to the chooser state with a default title', () => {
    const created = createDesignTab();
    expect(created).toEqual({
      id: 'design-1',
      kind: null,
      title: DEFAULT_DESIGN_TITLE,
      paneLayout: null,
      pendingHydration: false,
    });
  });

  it('takes a kind and title when supplied', () => {
    const created = createDesignTab([], { kind: 'box-pleat', title: 'Beetle' });
    expect(created).toMatchObject({ kind: 'box-pleat', title: 'Beetle' });
  });
});

describe('the at-least-one-tab invariant', () => {
  it('starts with exactly one chooser tab', () => {
    const state = initialDesignTabs();
    expect(state.designTabs).toHaveLength(1);
    expect(state.designTabs[0].kind).toBeNull();
    // The whole point: the active id always names a real tab, so consumers never
    // handle "no design open".
    expect(activeDesignTab(state).id).toBe(state.activeDesignId);
  });
});

describe('activeDesignTab', () => {
  it('finds the active tab among several', () => {
    const state = {
      designTabs: [tab('a'), tab('b', 'treemaker'), tab('c')],
      activeDesignId: 'b',
    };
    expect(activeDesignTab(state).id).toBe('b');
  });

  it('falls back to the first tab and complains when the id matches none', () => {
    // Should be unreachable. Degrading to a working workspace beats crashing the
    // shell, but it is a bug worth shouting about in development.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = { designTabs: [tab('a'), tab('b')], activeDesignId: 'gone' };

    expect(activeDesignTab(state).id).toBe('a');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('design method', () => {
  it('maps a tab with no kind to the chooser', () => {
    expect(designMethodOf(tab('a', null))).toBe('none');
  });

  it.each(['treemaker', 'box-pleat'] as const)('passes %s through', (kind) => {
    expect(designMethodOf(tab('a', kind))).toBe(kind);
  });

  it('reads the active tab, not the first', () => {
    const state = {
      designTabs: [tab('a', 'treemaker'), tab('b', 'box-pleat')],
      activeDesignId: 'b',
    };
    expect(selectDesignMethod(state)).toBe('box-pleat');
  });
});

describe('active-tab writes', () => {
  it('patches only the active tab', () => {
    const state = {
      designTabs: [tab('a', 'treemaker'), tab('b', null)],
      activeDesignId: 'b',
    };
    const next = markActiveTabBoxPleat(state);

    expect(next.designTabs.map((t) => t.kind)).toEqual(['treemaker', 'box-pleat']);
  });

  it('preserves tab order and identity', () => {
    const state = {
      designTabs: [tab('a'), tab('b'), tab('c')],
      activeDesignId: 'b',
    };
    const next = withActiveTab(state, { title: 'Renamed' });

    expect(next.designTabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(next.designTabs[1].title).toBe('Renamed');
    // Untouched tabs keep their object identity, so a selector watching one tab
    // does not re-render when a sibling changes.
    expect(next.designTabs[0]).toBe(state.designTabs[0]);
  });

  it('does not mutate the input', () => {
    const state = { designTabs: [tab('a', 'treemaker')], activeDesignId: 'a' };
    clearActiveDesignContent(state);
    expect(state.designTabs[0].kind).toBe('treemaker');
  });
});

describe('singleDesignTab', () => {
  it('seeds one tab of the requested kind', () => {
    const state = singleDesignTab('treemaker', 'Crane');
    expect(state.designTabs).toHaveLength(1);
    expect(selectDesignMethod(state)).toBe('treemaker');
    expect(state.designTabs[0].title).toBe('Crane');
  });
});
