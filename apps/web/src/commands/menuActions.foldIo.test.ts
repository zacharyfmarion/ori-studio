import { describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  runFoldIoCommand: vi.fn<(command: unknown, fileService?: unknown) => Promise<boolean>>(async () => true),
  sendFoldStepsToDiagram: vi.fn<(scope: unknown) => Promise<boolean>>(async () => true),
}));
vi.mock('../fold/io/foldIoCommands', () => ({ runFoldIoCommand: io.runFoldIoCommand }));
vi.mock('../diagram/fold/foldBrowserActions', () => ({ sendFoldStepsToDiagram: io.sendFoldStepsToDiagram }));

import { getMenuBarDef, type MenuItemDef } from '../menus/menuDefinition';
import { createMenuActionHandler, isMenuActionId, type MenuActionDependencies } from './menuActions';

function actionIds(items: MenuItemDef[]): string[] {
  return items.flatMap((item) =>
    item.type === 'action' ? [item.id] : item.type === 'submenu' ? actionIds(item.items) : []
  );
}

describe('Fold’s imports and hand-offs in the menu', () => {
  it('lists every one in the Fold menu, after the sequence’s verbs, dispatched by the shared handler', () => {
    const fold = getMenuBarDef().find((menu) => menu.label === 'Fold');
    expect(fold && actionIds(fold.items)).toEqual([
      'fold.valley',
      'fold.mountain',
      'fold.precrease',
      'fold.turn-over',
      'fold.rotate',
      'fold.unfold-last',
      'fold.unfold-to',
      'fold.repeat',
      'fold.delete-step',
      'fold.import-cp',
      'fold.import-sample-preliminary-base',
      'fold.import-sample-waterbomb-base',
      'fold.import-sample-pleat-in-eighths',
      'fold.start-from-edit-folded-figure',
      'fold.send-to-edit',
      'fold.send-to-diagram',
      'fold.send-path-to-diagram',
      'fold.export-fold',
      'fold.export-step',
      'fold.export-steps',
    ]);
    expect(actionIds(fold?.items ?? []).every(isMenuActionId)).toBe(true);
  });

  it('runs each as its Fold io verb, with the dispatcher’s file service', async () => {
    const fileService = { surface: 'web' } as MenuActionDependencies['fileService'];
    const handle = createMenuActionHandler({ fileService } as unknown as MenuActionDependencies);
    const ran = async (id: string) => {
      io.runFoldIoCommand.mockClear();
      await expect(handle(id)).resolves.toBe(true);
      expect(io.runFoldIoCommand.mock.calls[0]?.[1]).toBe(fileService);
      return io.runFoldIoCommand.mock.calls[0]?.[0];
    };
    expect(await ran('fold.import-cp')).toEqual({ kind: 'import-cp' });
    expect(await ran('fold.import-sample-waterbomb-base')).toEqual({ kind: 'import-sample', sample: 'waterbomb-base' });
    expect(await ran('fold.start-from-edit-folded-figure')).toEqual({ kind: 'start-from-edit-folded-figure' });
    expect(await ran('fold.send-to-edit')).toEqual({ kind: 'send-to-edit' });
    expect(await ran('fold.export-fold')).toEqual({ kind: 'export-fold' });
    expect(await ran('fold.export-step')).toEqual({ kind: 'export-steps', scope: 'this' });
    expect(await ran('fold.export-steps')).toEqual({ kind: 'export-steps', scope: 'all' });
  });

  it('runs Send to Diagram as the Diagram’s own pull, by what it sends, not as a Fold io verb', async () => {
    const handle = createMenuActionHandler({} as unknown as MenuActionDependencies);
    io.runFoldIoCommand.mockClear();
    io.sendFoldStepsToDiagram.mockClear();
    await expect(handle('fold.send-to-diagram')).resolves.toBe(true);
    await expect(handle('fold.send-path-to-diagram')).resolves.toBe(true);
    expect(io.sendFoldStepsToDiagram.mock.calls).toEqual([['step'], ['path']]);
    expect(io.runFoldIoCommand).not.toHaveBeenCalled();
  });

  it('runs none while its capability is disabled', async () => {
    io.runFoldIoCommand.mockClear();
    const handle = createMenuActionHandler({
      capabilities: () => ({ 'fold.export-fold': { enabled: false, visible: true, label: 'Export FOLD...', reason: 'Fold a step first' } }),
    } as unknown as MenuActionDependencies);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(handle('fold.export-fold')).resolves.toBe(false);
    expect(io.runFoldIoCommand).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
