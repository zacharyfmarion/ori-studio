import { describe, expect, it } from 'vitest';
import { isMenuActionId } from '../commands/menuActions';
import { getMenuBarDef, type MenuItemDef } from './menuDefinition';

function actionIdsFor(items: MenuItemDef[]) {
  return items.flatMap((item): string[] => {
    if (item.type === 'action') return [item.id];
    if (item.type === 'submenu') return actionIdsFor(item.items);
    return [];
  });
}

describe('web menu definition', () => {
  it('uses command ids supported by the shared menu dispatcher', () => {
    const actionIds = getMenuBarDef().flatMap((menu) => actionIdsFor(menu.items));

    expect(actionIds.length).toBeGreaterThan(0);
    expect(actionIds.every((id) => isMenuActionId(id))).toBe(true);
  });

  it('reads shortcut labels from resolved shortcut bindings', () => {
    const fileMenu = getMenuBarDef({
      'file.save': [{ primary: true, alt: true, key: 's' }],
    }).find((menu) => menu.label === 'File');
    const save = fileMenu?.items.find((item) => item.type === 'action' && item.id === 'file.save');

    expect(save && 'shortcut' in save ? save.shortcut : '').toMatch(/(Alt|Option)\+S/u);
  });

  it('keeps quit out of the web menu surface', () => {
    const actionIds = getMenuBarDef().flatMap((menu) => actionIdsFor(menu.items));

    expect(actionIds).not.toContain('app.quit');
    expect(actionIds).not.toContain('app.about');
  });

  it('groups extended edit tools into compact submenus', () => {
    const editMenu = getMenuBarDef().find((menu) => menu.label === 'Edit');
    const submenuLabels = editMenu?.items.flatMap((item) =>
      item.type === 'submenu' ? [item.label] : []
    );

    expect(submenuLabels).toEqual(['Select', 'Node', 'Edge', 'Strain', 'Stubs']);
  });

  it('exposes documentation and about from the Help menu', () => {
    const helpMenu = getMenuBarDef().find((menu) => menu.label === 'Help');
    const actionIds = helpMenu ? actionIdsFor(helpMenu.items) : undefined;

    expect(actionIds).toEqual(['help.documentation', 'help.about']);
  });

  it('exposes CP diagnostics, repair, and line commands', () => {
    const cpMenu = getMenuBarDef().find((menu) => menu.label === 'Crease Pattern');
    const actionIds = cpMenu ? actionIdsFor(cpMenu.items) : undefined;

    expect(actionIds).toEqual([
      'cp.deleteSelectedLines',
      'cp.changeCreaseType',
      'cp.advanceCreaseType',
      'cp.toggleMountainValley',
      'cp.makeMountain',
      'cp.makeValley',
      'cp.makeEdge',
      'cp.makeAuxiliary',
      'cp.replaceLineType',
      'cp.deleteLineType',
      'cp.transformFlipHorizontal',
      'cp.transformFlipVertical',
      'cp.transformRotateLeft',
      'cp.transformRotateRight',
      'cp.checkCamv',
      'cp.check1',
      'cp.check2',
      'cp.check3',
      'cp.check4',
      'cp.fix1',
      'cp.fix2',
      'cp.fixInaccurate',
      'cp.changeCircleColor',
      'cp.organizeCircles',
    ]);
  });
});
