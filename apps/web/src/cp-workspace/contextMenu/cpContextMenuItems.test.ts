import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from '../../lib/workspaceCapabilities';
import { getMenuBarDef, type MenuItemDef } from '../../menus/menuDefinition';
import { cpAnnotationMenuItems, cpCircleMenuItems, cpSelectionMenuItems } from './cpContextMenuItems';

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

function deps(overrides: Parameters<typeof capabilities>[0] = {}, run = vi.fn()) {
  return { t, action: { capabilities: capabilities(overrides), run } };
}

/** Row ids, flattened one level so submenu contents are addressable. */
function ids(items: ContextMenuItem[]): string[] {
  return items.flatMap((item) => {
    if (item.kind === 'separator') return ['---'];
    if (item.kind === 'submenu') return [item.id, ...item.items.map((child) => `${item.id}/${'id' in child ? child.id : '---'}`)];
    return [item.id];
  });
}

function submenu(items: ContextMenuItem[], id: string) {
  const found = items.find((item) => item.kind === 'submenu' && item.id === id);
  return found && found.kind === 'submenu' ? found : null;
}

describe('cpSelectionMenuItems', () => {
  it('offers every crease-type verb the menu bar does', () => {
    // The ask was "all the actions I can do on those creases". A curated subset
    // teaches people the menu bar is still the real one, so this asserts the two
    // lists are the same set rather than a hand-written expectation that would
    // silently stop tracking the bar.
    const creasePattern = getMenuBarDef().find((menu) => menu.label === 'Crease Pattern');
    const selectedLines = creasePattern?.items.find(
      (item): item is Extract<MenuItemDef, { type: 'submenu' }> =>
        item.type === 'submenu' && item.label === 'Selected Lines'
    );
    const barIds = (selectedLines?.items ?? [])
      .flatMap((item) => (item.type === 'action' ? [item.id] : []));

    const menuIds = new Set(ids(cpSelectionMenuItems(deps())).map((id) => id.split('/').pop()));

    expect(barIds.length).toBeGreaterThan(10);
    expect(barIds.filter((id) => !menuIds.has(id))).toEqual([]);
  });

  it('groups the type verbs behind one submenu rather than spending top-level rows', () => {
    const items = cpSelectionMenuItems(deps());

    expect(submenu(items, 'cp-crease-type')?.items.length).toBeGreaterThan(5);
  });

  it('leads with the clipboard verbs', () => {
    const items = cpSelectionMenuItems(deps());

    expect(ids(items).slice(0, 3)).toEqual(['edit.cut', 'edit.copy', 'edit.paste']);
  });

  it('ends with delete, in the destructive tone', () => {
    const items = cpSelectionMenuItems(deps());
    const last = items[items.length - 1];

    expect(last).toMatchObject({ id: 'cp.deleteSelectedLines', danger: true });
  });

  it('drops a whole group when the context hides it, taking its divider', () => {
    // Authoring a box-pleat design hides every `cp.*` verb. What is left must not
    // be a column of stranded dividers.
    const hidden = Object.fromEntries(
      ['cp.transformFlipHorizontal', 'cp.transformFlipVertical', 'cp.transformRotateLeft', 'cp.transformRotateRight'].map(
        (id) => [id, { visible: false }]
      )
    );
    const items = cpSelectionMenuItems(deps(hidden));

    expect(submenu(items, 'cp-transform')).toBeNull();
    expect(items[0]?.kind).not.toBe('separator');
    expect(items[items.length - 1]?.kind).not.toBe('separator');
  });

  it('dispatches a chosen row through the supplied runner', () => {
    const run = vi.fn();
    const items = cpSelectionMenuItems({ t, action: { capabilities: capabilities(), run } });
    const mountain = submenu(items, 'cp-crease-type')?.items.find(
      (item) => 'id' in item && item.id === 'cp.makeMountain'
    );

    if (mountain && mountain.kind === 'action') mountain.onSelect();

    expect(run).toHaveBeenCalledWith('cp.makeMountain');
  });
});

describe('cpCircleMenuItems', () => {
  it('offers the circle verbs and a destructive delete', () => {
    const items = cpCircleMenuItems(deps());

    expect(ids(items)).toEqual([
      'cp.changeCircleColor',
      'cp.organizeCircles',
      '---',
      'edit.delete',
    ]);
    expect(items[items.length - 1]).toMatchObject({ danger: true });
  });
});

describe('cpAnnotationMenuItems', () => {
  const annotation = {
    bringToFront: vi.fn(),
    sendToBack: vi.fn(),
    remove: vi.fn(),
    edit: vi.fn(),
    crop: vi.fn(),
  };

  it('offers Edit text on a text box and not on an image', () => {
    const text = ids(cpAnnotationMenuItems('text', { ...deps(), annotation }));
    const image = ids(cpAnnotationMenuItems('image', { ...deps(), annotation }));

    expect(text).toContain('annotation-edit');
    expect(image).not.toContain('annotation-edit');
  });

  it('offers the stacking verbs to both kinds', () => {
    for (const kind of ['text', 'image'] as const) {
      const items = ids(cpAnnotationMenuItems(kind, { ...deps(), annotation }));
      expect(items).toContain('annotation-front');
      expect(items).toContain('annotation-back');
    }
  });

  it('renders nothing without the store bindings, rather than dead rows', () => {
    expect(cpAnnotationMenuItems('text', deps())).toEqual([]);
  });

  it('does not open with a leading separator when the first row is absent', () => {
    // `edit` omitted: the divider that followed it must not survive as row one.
    const items = cpAnnotationMenuItems('text', {
      ...deps(),
      annotation: { ...annotation, edit: undefined },
    });

    expect(items[0]?.kind).not.toBe('separator');
  });
});
