import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewportToolbarGroupSpec } from '../../components/panels/viewportToolbarLayout';
import type { OristudioCpActionId } from '../../lib/oristudioCpActions';
import {
  CP_TOOLBAR_FAVORITE_LIMIT,
  cpToolFavoriteIds,
  resetCpToolFavorites,
  toggleCpToolFavorite,
} from './cpToolFavorites';
import { useCpFavoriteToolbarGroup } from './useCpFavoriteToolbarGroup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  resetCpToolFavorites();
});

/** Render the hook and hand back whatever it returned. */
function group(options: {
  enabled?: boolean;
  activeActionId?: OristudioCpActionId | null;
} = {}): ViewportToolbarGroupSpec | null {
  let result: ViewportToolbarGroupSpec | null = null;
  function Probe() {
    result = useCpFavoriteToolbarGroup({
      enabled: options.enabled ?? true,
      activeActionId: options.activeActionId ?? null,
      activeOperationId: null,
      onSelectAction: () => {},
    });
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Probe />);
  });
  return result;
}

describe('useCpFavoriteToolbarGroup', () => {
  /*
   * The shipped defaults currently fill the bar exactly, so nothing ships
   * starred-but-hidden. That is worth knowing and not worth pinning: the two
   * numbers answer different questions — a product call about which tools, and a
   * measurement of how many fit — so they are free to diverge again. The
   * assertion is on the slice, which holds either way; the count is only
   * asserted as "no more than fits".
   */
  it('offers the shipped defaults up to the cap, in the stored order', () => {
    const spec = group();
    expect(spec?.items.map((item) => item && item.id)).toEqual(
      cpToolFavoriteIds()
        .slice(0, CP_TOOLBAR_FAVORITE_LIMIT)
        .map((id) => `favorite-${id}`)
    );
    expect(spec?.items.length).toBeLessThanOrEqual(CP_TOOLBAR_FAVORITE_LIMIT);
  });

  it('is absent where the rail exists, so nothing duplicates it', () => {
    expect(group({ enabled: false })).toBeNull();
  });

  it('is absent when nothing is starred, rather than an empty run with a separator', () => {
    for (const id of [...cpToolFavoriteIds()]) toggleCpToolFavorite(id);
    expect(group()).toBeNull();
  });

  /*
   * The store takes any number of favorites; one row of a 375px screen does not.
   * The sheet's helper text names the same constant, so a change to it moves
   * both together.
   */
  it('shows only the first few of a long list', () => {
    for (const id of [
      'cp.action.square-bisector',
      'cp.action.perpendicular-draw',
      'cp.action.symmetric-draw',
      'cp.action.parallel-draw',
    ] satisfies OristudioCpActionId[]) {
      toggleCpToolFavorite(id);
    }
    expect(cpToolFavoriteIds().length).toBeGreaterThan(CP_TOOLBAR_FAVORITE_LIMIT);
    expect(group()?.items).toHaveLength(CP_TOOLBAR_FAVORITE_LIMIT);
  });

  it('takes them in the stored order, so a reorder changes which are shown', () => {
    const extra: OristudioCpActionId = 'cp.action.square-bisector';
    toggleCpToolFavorite(extra);
    expect(group()?.items.map((item) => item && item.id)).not.toContain(`favorite-${extra}`);
  });

  // The bar is the only place a phone says which tool is armed, the rail being
  // gone and the Tools pill being off to the side.
  it('marks the active tool checked', () => {
    const active = cpToolFavoriteIds()[1];
    const items = group({ activeActionId: active })?.items ?? [];
    const checked = items.filter((item) => item && item.kind === 'action' && item.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0] && checked[0].id).toBe(`favorite-${active}`);
  });

  // Unpinned, they would collapse into the very overflow menu they displaced.
  it('pins every tool so none falls into the overflow menu', () => {
    for (const item of group()?.items ?? []) {
      expect(item && item.kind === 'action' && item.pinned).toBe(true);
    }
  });
});
