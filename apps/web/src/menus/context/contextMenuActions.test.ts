import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceCapabilities, WorkspaceCapabilityId } from '../../lib/workspaceCapabilities';
import {
  contextMenuActionItem,
  contextMenuActionItems,
  contextMenuActionSubmenu,
  menuActionLabelIndex,
  pruneContextMenuItems,
  type ContextMenuActionContext,
} from './contextMenuActions';

/**
 * A capability map where everything is enabled and visible, so a test only has
 * to say what is *different*. Built as a Proxy rather than by enumerating the
 * ~110 ids: the union grows, and a fixture that has to be extended alongside it
 * turns every new capability into a broken test file.
 */
function capabilities(
  overrides: Partial<Record<WorkspaceCapabilityId, Partial<WorkspaceCapabilities[WorkspaceCapabilityId]>>> = {}
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

function context(overrides: Partial<ContextMenuActionContext> = {}): ContextMenuActionContext {
  return { capabilities: capabilities(), ...overrides };
}

describe('contextMenuActionItem', () => {
  it('labels a row from the menu bar, not from the capability', () => {
    // The two disagree for this id — the capability calls it "Delete Selected CP
    // Lines" — and the menu bar's wording is the one the user already knows.
    const item = contextMenuActionItem('cp.deleteSelectedLines', context());

    expect(item).not.toBeNull();
    expect(item && 'label' in item ? item.label : null).toBe('Delete Selected Lines');
  });

  it('falls back to the capability label for a command the menu bar omits', () => {
    // The View menu offers `view.edit`, not the `view.creasePattern` alias, so
    // this id is gated and dispatchable but has no menu-bar wording to borrow.
    const item = contextMenuActionItem('view.creasePattern', context());

    expect(item && 'label' in item ? item.label : null).toBe('view.creasePattern');
  });

  it('refuses an id no capability gates', () => {
    // A compile-time claim, not a runtime one: `app.about` is dispatchable but
    // ungated, and a row built from it would be permanently enabled. The
    // `@ts-expect-error` failing *is* the test — it means the union widened and
    // that class of row became expressible again.
    // @ts-expect-error - not a WorkspaceCapabilityId
    expect(() => contextMenuActionItem('app.about', context())).not.toThrow();
  });

  it('carries the resolved shortcut as the row hint', () => {
    const item = contextMenuActionItem('file.save', context(), menuActionLabelIndex());

    expect(item && 'shortcut' in item ? item.shortcut : undefined).toMatch(/S$/u);
  });

  it('hides a row whose capability is not visible', () => {
    const item = contextMenuActionItem(
      'cp.makeMountain',
      context({ capabilities: capabilities({ 'cp.makeMountain': { visible: false } }) })
    );

    expect(item).toBeNull();
  });

  it('keeps an unavailable row, disabled, and explains why on it', () => {
    const item = contextMenuActionItem(
      'cp.makeMountain',
      context({
        capabilities: capabilities({
          'cp.makeMountain': { enabled: false, reason: 'Select one or more lines first' },
        }),
      })
    );

    expect(item).toMatchObject({
      disabled: true,
      hint: 'Select one or more lines first',
    });
  });

  it('leaves an enabled row without a hint', () => {
    const item = contextMenuActionItem('cp.makeMountain', context());

    expect(item && 'hint' in item ? item.hint : 'unset').toBeUndefined();
  });

  it('dispatches through the supplied runner', () => {
    const run = vi.fn();
    const item = contextMenuActionItem('cp.makeValley', context({ run }));

    if (item && item.kind === 'action') item.onSelect();

    expect(run).toHaveBeenCalledWith('cp.makeValley');
  });
});

describe('contextMenuActionItems', () => {
  it('preserves order and drops only the hidden ids', () => {
    const items = contextMenuActionItems(
      ['cp.makeMountain', 'cp.makeValley', 'cp.makeEdge'],
      context({ capabilities: capabilities({ 'cp.makeValley': { visible: false } }) })
    );

    expect(items.map((item) => ('id' in item ? item.id : null))).toEqual([
      'cp.makeMountain',
      'cp.makeEdge',
    ]);
  });
});

describe('pruneContextMenuItems', () => {
  it('collapses leading, trailing, and doubled separators', () => {
    const action = (id: string) =>
      ({ kind: 'action', id, label: id, onSelect: () => {} }) as const;
    const separator = { kind: 'separator' } as const;

    const pruned = pruneContextMenuItems([
      separator,
      separator,
      action('a'),
      separator,
      null,
      separator,
      action('b'),
      separator,
      separator,
    ]);

    expect(pruned.map((item) => ('id' in item ? item.id : 'separator'))).toEqual([
      'a',
      'separator',
      'b',
    ]);
  });

  it('drops a group that vanished along with its divider', () => {
    const action = (id: string) =>
      ({ kind: 'action', id, label: id, onSelect: () => {} }) as const;

    const pruned = pruneContextMenuItems([
      action('a'),
      { kind: 'separator' },
      false,
      null,
    ]);

    expect(pruned).toHaveLength(1);
  });
});

describe('contextMenuActionSubmenu', () => {
  it('returns null when every child is hidden, rather than an empty trigger', () => {
    const submenu = contextMenuActionSubmenu(
      'crease-type',
      'Crease type',
      ['cp.makeMountain', 'cp.makeValley'],
      context({
        capabilities: capabilities({
          'cp.makeMountain': { visible: false },
          'cp.makeValley': { visible: false },
        }),
      })
    );

    expect(submenu).toBeNull();
  });

  it('disables the trigger when every surviving child is disabled', () => {
    const submenu = contextMenuActionSubmenu(
      'crease-type',
      'Crease type',
      ['cp.makeMountain', 'separator', 'cp.makeValley'],
      context({
        capabilities: capabilities({
          'cp.makeMountain': { enabled: false },
          'cp.makeValley': { enabled: false },
        }),
      })
    );

    expect(submenu).toMatchObject({ kind: 'submenu', disabled: true });
  });

  it('leaves the trigger enabled when one child can run', () => {
    const submenu = contextMenuActionSubmenu(
      'crease-type',
      'Crease type',
      ['cp.makeMountain', 'cp.makeValley'],
      context({ capabilities: capabilities({ 'cp.makeMountain': { enabled: false } }) })
    );

    expect(submenu).toMatchObject({ disabled: false });
  });

  it('collapses a separator left stranded by a hidden child', () => {
    const submenu = contextMenuActionSubmenu(
      'crease-type',
      'Crease type',
      ['cp.makeMountain', 'separator', 'cp.makeValley'],
      context({ capabilities: capabilities({ 'cp.makeValley': { visible: false } }) })
    );

    expect(submenu && submenu.kind === 'submenu' ? submenu.items : []).toHaveLength(1);
  });
});
