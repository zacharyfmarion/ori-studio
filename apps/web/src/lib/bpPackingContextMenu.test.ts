import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../components/ui/contextMenuTypes';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from './workspaceCapabilities';
import {
  bpPackingMenuItems,
  type BpPackingContextMenuDeps,
  type BpPackingNudgeDirection,
} from './bpPackingContextMenu';

const t = ((_key: string, defaultValue?: string) => defaultValue ?? _key) as unknown as TFunction;

function capabilities(
  overrides: Partial<Record<WorkspaceCapabilityId, { enabled?: boolean; visible?: boolean }>> = {}
): WorkspaceCapabilities {
  return new Proxy({} as WorkspaceCapabilities, {
    get: (_target, key: string) => ({
      enabled: true,
      visible: true,
      label: key,
      reason: key,
      ...overrides[key as WorkspaceCapabilityId],
    }),
    has: () => true,
  });
}

function deps(overrides: Partial<BpPackingContextMenuDeps> = {}): BpPackingContextMenuDeps {
  return {
    t,
    action: { capabilities: capabilities(), run: vi.fn() },
    canNudge: () => true,
    nudge: vi.fn(),
    unpairableId: null,
    unpair: vi.fn(),
    ...overrides,
  };
}

function submenu(items: ContextMenuItem[], id: string) {
  const found = items.find((item) => item.kind === 'submenu' && item.id === id);
  return found && found.kind === 'submenu' ? found : null;
}

function ids(items: ContextMenuItem[]): string[] {
  return items.flatMap((item) => (item.kind === 'separator' ? [] : [item.id]));
}

describe('the flap menu', () => {
  it('leads with nudge — the verb a drag cannot replace', () => {
    const items = bpPackingMenuItems({ kind: 'flap', count: 1 }, deps());

    expect(items[0]).toMatchObject({ kind: 'submenu', id: 'bp-nudge' });
  });

  it('greys only the directions that are blocked', () => {
    const items = bpPackingMenuItems(
      { kind: 'flap', count: 1 },
      deps({ canNudge: (direction: BpPackingNudgeDirection) => direction !== 'left' })
    );
    const nudge = submenu(items, 'bp-nudge');

    expect(nudge?.items.map((item) => ('disabled' in item ? item.disabled : null))).toEqual([
      false, // up
      false, // down
      true, // left
      false, // right
    ]);
    expect(nudge?.disabled).toBe(false);
  });

  it('greys the trigger when the selection cannot move at all', () => {
    const items = bpPackingMenuItems(
      { kind: 'flap', count: 1 },
      deps({ canNudge: () => false })
    );

    expect(submenu(items, 'bp-nudge')?.disabled).toBe(true);
  });

  it('offers unpair only when there is a pairing to break', () => {
    expect(ids(bpPackingMenuItems({ kind: 'flap', count: 1 }, deps()))).not.toContain('bp-unpair');
    expect(
      ids(bpPackingMenuItems({ kind: 'flap', count: 1 }, deps({ unpairableId: 4 })))
    ).toContain('bp-unpair');
  });

  it('unpairs the flap it was built for', () => {
    const unpair = vi.fn();
    const items = bpPackingMenuItems(
      { kind: 'flap', count: 1 },
      deps({ unpairableId: 4, unpair })
    );
    const row = items.find((item) => 'id' in item && item.id === 'bp-unpair');

    if (row && row.kind === 'action') row.onSelect();

    expect(unpair).toHaveBeenCalledWith(4);
  });

  it('ends with a destructive delete', () => {
    const items = bpPackingMenuItems({ kind: 'flap', count: 1 }, deps());

    expect(items[items.length - 1]).toMatchObject({ id: 'edit.delete', danger: true });
  });
});

describe('the sheet menu', () => {
  it('offers the grid, transform and optimizer verbs the Design menu has', () => {
    const items = bpPackingMenuItems({ kind: 'sheet' }, deps());

    expect(ids(items)).toEqual(['bp.layout.subdivide', 'bp.layout.unsubdivide', 'bp-transform', 'bp.optimize.layout']);
    expect(submenu(items, 'bp-transform')?.items.filter((i) => i.kind !== 'separator')).toHaveLength(4);
  });

  it('collapses to nothing but the survivors when the context hides the sheet verbs', () => {
    const hidden = Object.fromEntries(
      ['bp.layout.subdivide', 'bp.layout.unsubdivide', 'bp.optimize.layout'].map((id) => [
        id,
        { visible: false },
      ])
    );
    const items = bpPackingMenuItems({ kind: 'sheet' }, deps({
      action: { capabilities: capabilities(hidden), run: vi.fn() },
    }));

    expect(ids(items)).toEqual(['bp-transform']);
    expect(items[0]?.kind).not.toBe('separator');
  });
});

describe('the river menu', () => {
  it('offers delete alone — a river is derived from the tree', () => {
    const items = bpPackingMenuItems({ kind: 'river' }, deps());

    expect(ids(items)).toEqual(['edit.delete']);
    expect(items[0]).toMatchObject({ danger: true });
  });
});
