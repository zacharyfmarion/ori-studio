import type { DesignKindId } from '../../designKinds';
import type { DesignMethod } from './designVariant';

/**
 * One design open in the Design workspace.
 *
 * Replaces the single `designMethod` scalar. The method is not a property of the
 * workspace — it is a property of the design being authored, and once several can
 * be open at once a workspace-level field cannot say which one it describes.
 *
 * Deliberately an **array** rather than a map plus an order list: the order *is*
 * the tab order, and keeping two structures in step would be exactly the kind of
 * duplicated fact this refactor exists to remove. Tab counts are small enough
 * that the linear lookups do not matter.
 */
export interface DesignTab {
  /** Stable for the life of the tab; also the document id written to `.osf`. */
  id: string;
  /**
   * The authoring method, or `null` while this tab is still showing the chooser.
   *
   * A tab with no kind is the NUX state. It is a real tab — it has a position and
   * a title — which is what lets "close the last tab" re-provision an empty one
   * instead of leaving the workspace with nothing to render.
   */
  kind: DesignKindId | null;
  /** User-editable tab name. */
  title: string;
}

export const DEFAULT_DESIGN_TITLE = 'Untitled Design';

/**
 * Session-monotonic counter behind {@link nextDesignTabId}.
 *
 * Ids only have to be unique within one workspace, and readable ones make a
 * devtools session and an `.osf` far easier to follow than UUIDs. Uniqueness
 * against ids that arrived from a file is handled by {@link nextDesignTabId}
 * taking the tabs already present.
 */
let idCounter = 0;

export function nextDesignTabId(existing: readonly DesignTab[] = []): string {
  const taken = new Set(existing.map((tab) => tab.id));
  let id: string;
  do {
    idCounter += 1;
    id = `design-${idCounter}`;
  } while (taken.has(id));
  return id;
}

/** Reset the id counter. Tests only, so ids are predictable per test. */
export function resetDesignTabIds(): void {
  idCounter = 0;
}

/**
 * A title that does not collide with the tabs already open.
 *
 * The first tab is plain `Untitled Design`; only a duplicate takes a suffix, so a
 * lone tab never carries a pointless `1`.
 */
export function uniqueDesignTitle(
  existing: readonly DesignTab[],
  base: string = DEFAULT_DESIGN_TITLE
): string {
  const taken = new Set(existing.map((tab) => tab.title));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

export function createDesignTab(
  existing: readonly DesignTab[] = [],
  overrides: Partial<Omit<DesignTab, 'id'>> = {}
): DesignTab {
  return {
    id: nextDesignTabId(existing),
    kind: overrides.kind ?? null,
    title: overrides.title ?? uniqueDesignTitle(existing),
  };
}

/** The state slice these helpers read. Narrow, so tests need not build a store. */
export interface DesignTabsSlice {
  designTabs: DesignTab[];
  activeDesignId: string;
}

/**
 * The tab being authored.
 *
 * Total by construction: `designTabs` is never empty and `activeDesignId` always
 * names one of them (see the invariant note on the state fields). The fallback to
 * the first tab exists so a corrupted pairing degrades to a working workspace
 * rather than a crash — it should never be reached, and a dev assertion says so.
 */
export function activeDesignTab(state: DesignTabsSlice): DesignTab {
  const active = state.designTabs.find((tab) => tab.id === state.activeDesignId);
  if (active) return active;
  if (import.meta.env.DEV) {
    console.error(
      `[ori-studio] activeDesignId "${state.activeDesignId}" matches no tab; falling back to the first`
    );
  }
  return state.designTabs[0];
}

/** The design method of a tab, in the shape the layout and routing already speak. */
export function designMethodOf(tab: DesignTab): DesignMethod {
  return tab.kind ?? 'none';
}

/**
 * The active design's method.
 *
 * The replacement for reading `state.designMethod`. A selector rather than a
 * stored field, so it cannot disagree with the tab it describes.
 */
export function selectDesignMethod(state: DesignTabsSlice): DesignMethod {
  return designMethodOf(activeDesignTab(state));
}

/**
 * Apply a patch to the active tab, returning the field to `set()`.
 *
 * Every write to the active design's identity goes through here, so there is one
 * place that knows how the active tab is located.
 */
export function withActiveTab(
  state: DesignTabsSlice,
  patch: Partial<Omit<DesignTab, 'id'>>
): Pick<DesignTabsSlice, 'designTabs'> {
  return {
    designTabs: state.designTabs.map((tab) =>
      tab.id === state.activeDesignId ? { ...tab, ...patch } : tab
    ),
  };
}

/** A one-tab workspace authoring `kind`. */
export function singleDesignTab(
  kind: DesignKindId | null = null,
  title?: string
): DesignTabsSlice {
  const tab = createDesignTab([], { kind, title });
  return { designTabs: [tab], activeDesignId: tab.id };
}

/**
 * The initial single tab: one design, no method chosen, chooser showing.
 *
 * A fresh session starts with a tab rather than with nothing, which is what makes
 * `activeDesignId` a plain `string` instead of `string | null` and removes the
 * "no design open" state from every consumer.
 */
export function initialDesignTabs(): DesignTabsSlice {
  return singleDesignTab(null);
}
