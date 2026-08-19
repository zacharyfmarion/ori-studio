import { describe, expect, it } from 'vitest';
import { pruneMenuItems } from '../menus/menuVisibility';
import type { MenuItemDef } from '../menus/menuDefinition';
import type { WorkspaceCapabilities } from '../lib/workspaceCapabilities';

// pruneMenuItems only reads capabilities[id].visible; ids absent from the map
// default to visible, so a partial fixture suffices.
function caps(visibility: Record<string, boolean>): WorkspaceCapabilities {
  const entries = Object.fromEntries(
    Object.entries(visibility).map(([id, visible]) => [
      id,
      { visible, enabled: visible, label: id, reason: '' },
    ]),
  );
  return entries as unknown as WorkspaceCapabilities;
}

const exportItems: MenuItemDef[] = [
  { type: 'action', id: 'file.exportV5', label: 'Export TreeMaker 5...' },
  { type: 'action', id: 'file.exportV4', label: 'Export TreeMaker 4...' },
  { type: 'separator' },
  { type: 'action', id: 'file.exportCp', label: 'Export CP...' },
  { type: 'action', id: 'file.exportBps', label: 'Export .bps...' },
  { type: 'separator' },
  { type: 'action', id: 'file.exportSvg', label: 'Export SVG...' },
];

describe('pruneMenuItems', () => {
  it('drops separators orphaned around a lone visible item', () => {
    const pruned = pruneMenuItems(
      exportItems,
      caps({
        'file.exportV5': false,
        'file.exportV4': false,
        'file.exportCp': false,
        'file.exportBps': true,
        'file.exportSvg': false,
      }),
    );
    expect(pruned).toEqual([{ type: 'action', id: 'file.exportBps', label: 'Export .bps...' }]);
  });

  it('keeps a separator that divides two visible groups', () => {
    const pruned = pruneMenuItems(
      exportItems,
      caps({
        'file.exportV5': true,
        'file.exportV4': false,
        'file.exportCp': false,
        'file.exportBps': false,
        'file.exportSvg': true,
      }),
    );
    expect(pruned.map((item) => (item.type === 'action' ? item.id : item.type))).toEqual([
      'file.exportV5',
      'separator',
      'file.exportSvg',
    ]);
  });

  it('collapses leading and doubled separators', () => {
    const items: MenuItemDef[] = [
      { type: 'separator' },
      { type: 'separator' },
      { type: 'action', id: 'file.exportBps', label: 'Export .bps...' },
      { type: 'separator' },
    ];
    expect(pruneMenuItems(items, caps({ 'file.exportBps': true }))).toEqual([
      { type: 'action', id: 'file.exportBps', label: 'Export .bps...' },
    ]);
  });
});
