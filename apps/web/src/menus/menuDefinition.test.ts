import { describe, expect, it } from 'vitest';
import { isMenuActionId } from '../commands/menuActions';
import { FOLD_MODEL_TURNS, FOLD_MODEL_VERB_SHORTCUTS, FOLD_TOOL_SHORTCUTS } from '../fold/tools/foldToolCatalog';
import type { WorkspaceCapabilities } from '../lib/workspaceCapabilities';
import { getMenuBarDef, type MenuItemDef } from './menuDefinition';
import { nativeMenuOptions } from './nativeMenu';

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

  it('names the Fold scope’s key beside each Fold row it also runs, as the user has it bound', () => {
    const rows = (resolution?: Parameters<typeof getMenuBarDef>[0]) => {
      const fold = getMenuBarDef(resolution).find((menu) => menu.label === 'Fold');
      return Object.fromEntries(
        (fold?.items ?? []).flatMap((item) => (item.type === 'action' ? [[item.id, item.shortcut]] : []))
      );
    };
    expect(rows()).toMatchObject({
      // The rail's order: A valley, S mountain; D the precrease.
      'fold.valley': 'A',
      'fold.mountain': 'S',
      'fold.precrease': 'D',
      'fold.turn-over': 'T',
      // Rotate takes its tool in hand, as R does.
      'fold.rotate': 'R',
      // The sequence verbs, through their rows.
      'fold.unfold-to': 'Shift+E',
      'fold.repeat': 'Shift+R',
    });
    // The quarter turns done at once are gone: Rotate's window sets how far and which way.
    expect(rows()['fold.rotate-cw']).toBeUndefined();
    expect(rows()['fold.rotate-ccw']).toBeUndefined();
    // The keys the canvas runs are the ones the rail and the window name.
    expect([FOLD_TOOL_SHORTCUTS.valley, FOLD_TOOL_SHORTCUTS.mountain, FOLD_TOOL_SHORTCUTS.precrease]).toEqual([
      'fold.toolValley',
      'fold.toolMountain',
      'fold.toolPrecrease',
    ]);
    expect(FOLD_TOOL_SHORTCUTS.rotate).toBe('fold.rotate');
    expect(FOLD_MODEL_VERB_SHORTCUTS).toEqual({ 'turn-over': 'fold.turnOver' });
    expect(FOLD_MODEL_TURNS).toEqual({ 'turn-over': { kind: 'turn-over', axis: 'vertical' } });
    // Rebound, the hint follows.
    expect(rows({ 'fold.toolValley': [{ key: 'w' }] })['fold.valley']).toBe('W');
  });

  it('gives the Fold rows no native accelerator: a bare letter would be taken from every text field', () => {
    const fold = getMenuBarDef().filter((menu) => menu.label === 'Fold');
    const options = nativeMenuOptions(fold, {} as WorkspaceCapabilities, undefined);
    const items = options.flatMap((menu) => ('items' in menu ? (menu.items ?? []) : []));
    const row = (id: string) =>
      items.find((item) => typeof item === 'object' && 'id' in item && item.id === id) as { accelerator?: string } | undefined;
    expect(row('fold.valley')).toBeDefined();
    expect(row('fold.valley')?.accelerator).toBeUndefined();
    expect(row('fold.turn-over')).toBeDefined();
    expect(row('fold.turn-over')?.accelerator).toBeUndefined();
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

  it('exposes the workspace entries and the Properties pane from the View menu', () => {
    const viewMenu = getMenuBarDef().find((menu) => menu.label === 'View');
    const actionItems =
      viewMenu?.items.flatMap((item) =>
        item.type === 'action' ? [{ id: item.id, label: item.label }] : []
      ) ?? [];

    expect(actionItems.map((item) => item.label)).toEqual([
      'Design',
      'Edit',
      'Simulate',
      'References',
      'Diagram',
      'Fold',
      'Properties',
      'Reset Layout',
    ]);
    expect(actionItems.map((item) => item.id)).toEqual([
      'view.design',
      'view.edit',
      'view.simulate',
      'view.references',
      'view.diagram',
      'view.fold',
      'view.properties',
      'view.resetLayout',
    ]);
  });

  it('offers canvas placement from the Insert menu, and leaves Import in File', () => {
    const menus = getMenuBarDef();
    const insertMenu = menus.find((menu) => menu.label === 'Insert');

    expect(insertMenu ? actionIdsFor(insertMenu.items) : undefined).toEqual([
      'insert.image',
      'insert.text',
    ]);

    // Import (Add) reads a crease pattern off disk, which is a File verb.
    // Insert is about what goes onto the canvas, and listing one action in two
    // menus is how the two drift apart.
    const fileMenu = menus.find((menu) => menu.label === 'File');
    expect(fileMenu ? actionIdsFor(fileMenu.items) : []).toContain('file.importAdd');
  });

  it('exposes about from the Help menu', () => {
    const helpMenu = getMenuBarDef().find((menu) => menu.label === 'Help');
    const actionIds = helpMenu ? actionIdsFor(helpMenu.items) : undefined;

    expect(actionIds).toEqual(['help.about']);
  });

  it('exposes CP diagnostics, repair, and line commands', () => {
    const cpMenu = getMenuBarDef().find((menu) => menu.label === 'Crease Pattern');
    const actionIds = cpMenu ? actionIdsFor(cpMenu.items) : undefined;

    expect(actionIds).toEqual([
      // The pen, before the selection verbs: it applies to what you draw next,
      // where everything below applies to what is already selected.
      'cp.setActiveCreaseAngle',
      'cp.deleteSelectedLines',
      'cp.changeCreaseType',
      'cp.advanceCreaseType',
      'cp.toggleMountainValley',
      'cp.makeMountain',
      'cp.makeValley',
      'cp.makeEdge',
      'cp.makeAuxiliary',
      'cp.makeUnassignedKeepDirection',
      'cp.makeUnassigned',
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
      'cp.analyzeReferences',
      'cp.fix1',
      'cp.fix2',
      'cp.deleteExtraVertices',
      'cp.deleteExtraVerticesIgnoreColor',
      'cp.fixInaccurate',
      'cp.exactSolve',
      'cp.changeCircleColor',
      'cp.organizeCircles',
    ]);
  });
});
