import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../components/ui/contextMenuTypes';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from '../lib/workspaceCapabilities';
import { treeMenuItems, type TreeContextMenuDeps } from './treeContextMenu';

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

function deps(overrides: Partial<TreeContextMenuDeps> = {}): TreeContextMenuDeps {
  return {
    t,
    action: { capabilities: capabilities(), run: vi.fn() },
    addLeafHere: null,
    unpair: null,
    mirror: { enabled: false, toggle: vi.fn(), label: 'Mirror draw' },
    labels: { visible: true, toggle: vi.fn(), label: 'Labels' },
    clearSelection: vi.fn(),
    hasSelection: false,
    ...overrides,
  };
}

function ids(items: ContextMenuItem[]): string[] {
  return items.flatMap((item) => (item.kind === 'separator' ? [] : [item.id]));
}

describe('the vertex menu', () => {
  it('offers delete, and unpair only when the vertex is paired', () => {
    expect(ids(treeMenuItems({ kind: 'vertex', id: 1 }, deps()))).toEqual(['edit.delete']);
    expect(
      ids(treeMenuItems({ kind: 'vertex', id: 1 }, deps({ unpair: vi.fn() })))
    ).toEqual(['tree-unpair', 'edit.delete']);
  });

  it('marks delete destructive', () => {
    const items = treeMenuItems({ kind: 'vertex', id: 1 }, deps());

    expect(items[items.length - 1]).toMatchObject({ danger: true });
  });
});

describe('the edge menu', () => {
  it('offers delete alone — length is authored by the editor the click opens', () => {
    expect(ids(treeMenuItems({ kind: 'edge', id: 2 }, deps()))).toEqual(['edit.delete']);
  });
});

describe('the empty-canvas menu', () => {
  it('offers Add leaf here only when a vertex is there to hang it from', () => {
    expect(ids(treeMenuItems(null, deps()))).not.toContain('tree-add-leaf');
    expect(ids(treeMenuItems(null, deps({ addLeafHere: vi.fn() })))).toContain('tree-add-leaf');
  });

  it('offers Deselect only when there is a selection to drop', () => {
    expect(ids(treeMenuItems(null, deps()))).not.toContain('tree-deselect');
    expect(ids(treeMenuItems(null, deps({ hasSelection: true })))).toContain('tree-deselect');
  });

  it('reports each view toggle as checked or not', () => {
    const items = treeMenuItems(
      null,
      deps({ mirror: { enabled: true, toggle: vi.fn(), label: 'Mirror draw' } })
    );

    expect(items.find((item) => 'id' in item && item.id === 'tree-mirror')).toMatchObject({
      kind: 'radio',
      checked: true,
    });
    expect(items.find((item) => 'id' in item && item.id === 'tree-labels')).toMatchObject({
      checked: true,
    });
  });

  it('drops the mirror row for a surface with no mirror at all', () => {
    // `null` on the host means no mirror anywhere — not a disabled one.
    expect(ids(treeMenuItems(null, deps({ mirror: null })))).toEqual(['tree-labels']);
  });

  it('never opens on a stranded separator', () => {
    const items = treeMenuItems(null, deps({ mirror: null }));

    expect(items[0]?.kind).not.toBe('separator');
  });
});
