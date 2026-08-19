import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the design-tab events may and may not carry.
 *
 * The privacy contract (`docs/analytics.md`) puts user-authored text — text-tool
 * content, filenames, paths — off limits. A tab's **title is exactly that**: the
 * user types it, and people name designs after clients, commissions, and
 * children. So the events report how *many* designs are open, bucketed, and the
 * kind, and nothing else.
 */

const analytics = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../analytics')>();
  return { ...actual, track: analytics.track };
});

vi.mock('../../engines/designHandles', () => ({
  acquireDesignHandle: vi.fn(async () => 1),
  adoptDesignHandle: vi.fn(async () => true),
  withDesignHandle: vi.fn(),
  serializeDesign: vi.fn(async () => 'serialized'),
  parkDesign: vi.fn(async () => undefined),
  forgetDesign: vi.fn(async () => undefined),
  adoptDesign: vi.fn(),
  isDesignHot: vi.fn(() => false),
  hotDesignIds: vi.fn(() => []),
  subscribeToDesignHandles: vi.fn(() => () => undefined),
}));

const { useWorkspaceStore } = await import('./store');
const { resetDesignTabIds } = await import('./designTabs');

const store = () => useWorkspaceStore.getState();

/** Every property value any design-tab event sent, flattened. */
function tabEventValues() {
  return analytics.track.mock.calls
    .filter(([name]) => String(name).startsWith('design tab'))
    .flatMap(([, properties]) => Object.values(properties ?? {}))
    .map(String);
}

const eventsNamed = (name: string) =>
  analytics.track.mock.calls
    .filter(([called]) => called === name)
    .map(([, properties]) => properties);

beforeEach(() => {
  vi.clearAllMocks();
  resetDesignTabIds();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('design tab events', () => {
  it('reports an opened tab with its source and a bucketed count', () => {
    store().addDesignTab();

    expect(eventsNamed('design tab opened')).toEqual([
      { source: 'strip', open_count_bucket: '<=2' },
    ]);
  });

  it('reports a close with the kind and whether it had been worked on', () => {
    store().addDesignTab();
    const doomed = store().activeDesignId;

    store().closeDesignTab(doomed);

    expect(eventsNamed('design tab closed')).toEqual([
      { kind: 'none', touched: false, open_count_bucket: '<=2' },
    ]);
  });

  it('reports a rename with no properties at all', () => {
    // The new name is the one thing this event must never carry.
    store().renameDesignTab(store().activeDesignId, 'Commission for the Hendersons');

    expect(eventsNamed('design tab renamed')).toEqual([{}]);
  });

  it('reports a reorder without saying which tab moved', () => {
    store().addDesignTab();
    analytics.track.mockClear();

    store().reorderDesignTab(store().designTabs[1].id, 0);

    expect(eventsNamed('design tab reordered')).toEqual([{ open_count_bucket: '<=2' }]);
  });

  it('reports an activation', () => {
    store().addDesignTab();
    const [first] = store().designTabs.map((tab) => tab.id);
    analytics.track.mockClear();

    store().activateDesignTab(first);

    expect(eventsNamed('design tab activated')).toEqual([{ open_count_bucket: '<=2' }]);
  });

  it('never sends a tab title, however the tab was named', () => {
    const secret = 'Kabuto for the Hendersons';
    store().renameDesignTab(store().activeDesignId, secret);
    store().addDesignTab();
    store().renameDesignTab(store().activeDesignId, `${secret} 2`);
    store().reorderDesignTab(store().designTabs[1].id, 0);
    store().activateDesignTab(store().designTabs[0].id);
    store().closeDesignTab(store().designTabs[0].id);

    const values = tabEventValues();
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toContain('Hendersons');
      expect(value).not.toContain('Untitled');
    }
  });

  it('buckets the count rather than sending it raw', () => {
    for (let index = 0; index < 6; index += 1) store().addDesignTab();

    const buckets = eventsNamed('design tab opened').map(
      (properties) => properties?.open_count_bucket,
    );
    // Seven designs open collapse to four buckets, not seven values.
    expect(new Set(buckets).size).toBeLessThan(buckets.length);
    expect(buckets.at(-1)).toBe('<=10');
  });
});
