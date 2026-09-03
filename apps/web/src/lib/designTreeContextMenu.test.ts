import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../components/ui/contextMenuTypes';
import { getMenuBarDef, type MenuItemDef } from '../menus/menuDefinition';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from './workspaceCapabilities';
import { designTreeMenuItems, type DesignTreeContextMenuDeps } from './designTreeContextMenu';

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

function deps(overrides: Parameters<typeof capabilities>[0] = {}): DesignTreeContextMenuDeps {
  return { t, action: { capabilities: capabilities(overrides), run: vi.fn() } };
}

/** Every row id, submenu contents included. */
function allIds(items: ContextMenuItem[]): string[] {
  return items.flatMap((item) => {
    if (item.kind === 'separator') return [];
    if (item.kind === 'submenu') return [item.id, ...allIds(item.items)];
    return [item.id];
  });
}

/** The action ids under one Edit-menu submenu, as the menu bar declares them. */
function editSubmenuIds(label: string): string[] {
  const edit = getMenuBarDef().find((menu) => menu.label === 'Edit');
  const group = edit?.items.find(
    (item): item is Extract<MenuItemDef, { type: 'submenu' }> =>
      item.type === 'submenu' && item.label === label
  );
  return (group?.items ?? []).flatMap((item) => (item.type === 'action' ? [item.id] : []));
}

describe('the node menu', () => {
  it('leads with Make Root, which has no other home on the canvas', () => {
    expect(allIds(designTreeMenuItems({ kind: 'node', id: 1 }, deps()))[0]).toBe('edit.makeRoot');
  });

  it('offers every Node verb the Edit menu does', () => {
    const menuIds = new Set(allIds(designTreeMenuItems({ kind: 'node', id: 1 }, deps())));

    expect(editSubmenuIds('Node').filter((id) => !menuIds.has(id))).toEqual([]);
  });

  it('offers every Strain verb the Edit menu does', () => {
    const menuIds = new Set(allIds(designTreeMenuItems({ kind: 'node', id: 1 }, deps())));

    expect(editSubmenuIds('Strain').filter((id) => !menuIds.has(id))).toEqual([]);
  });

  it('ends with a destructive delete', () => {
    const items = designTreeMenuItems({ kind: 'node', id: 1 }, deps());

    expect(items[items.length - 1]).toMatchObject({ id: 'edit.delete', danger: true });
  });
});

describe('the edge menu', () => {
  it('offers every Edge verb the Edit menu does', () => {
    const menuIds = new Set(allIds(designTreeMenuItems({ kind: 'edge', id: 2 }, deps())));

    expect(editSubmenuIds('Edge').filter((id) => !menuIds.has(id))).toEqual([]);
  });

  it('puts the three length verbs at the top rather than in a submenu', () => {
    const items = designTreeMenuItems({ kind: 'edge', id: 2 }, deps());

    expect(items.slice(0, 3).map((item) => ('id' in item ? item.id : null))).toEqual([
      'edit.setEdgeLength',
      'edit.scaleEdgeLengths',
      'edit.splitEdge',
    ]);
  });
});

describe('the empty-paper menu', () => {
  it('runs select → optimize → build, the order the work happens in', () => {
    const items = designTreeMenuItems({ kind: 'empty' }, deps());

    expect(items.filter((item) => item.kind !== 'separator').map((item) => ('id' in item ? item.id : null))).toEqual([
      'design-select',
      'optimize.scale',
      'optimize.edges',
      'optimize.strain',
      'edit.triangulateTree',
      'cp.build',
    ]);
  });

  it('gives a path the whole-tree menu, since a path has no verbs of its own', () => {
    expect(allIds(designTreeMenuItems({ kind: 'path', id: 3 }, deps()))).toEqual(
      allIds(designTreeMenuItems({ kind: 'empty' }, deps()))
    );
  });

  it('drops hidden verbs without stranding their dividers', () => {
    const items = designTreeMenuItems(
      { kind: 'empty' },
      deps({
        'optimize.scale': { visible: false },
        'optimize.edges': { visible: false },
        'optimize.strain': { visible: false },
      })
    );

    expect(items.some((item) => item.kind === 'separator' && items.indexOf(item) === 0)).toBe(false);
    expect(items[items.length - 1]?.kind).not.toBe('separator');
  });
});
