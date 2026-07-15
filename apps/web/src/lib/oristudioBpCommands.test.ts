import { describe, expect, it } from 'vitest';

import {
  ORISTUDIO_BP_CAPABILITY_IDS,
  ORISTUDIO_BP_COMMANDS,
  ORISTUDIO_BP_COMMAND_IDS,
  isOristudioBpCapabilityId,
  isOristudioBpCommandId,
} from './oristudioBpCommands';

describe('oristudio BP command contract', () => {
  it('keeps command ids unique and capability ids aligned', () => {
    expect(new Set(ORISTUDIO_BP_COMMAND_IDS).size).toBe(ORISTUDIO_BP_COMMAND_IDS.length);
    expect(new Set(ORISTUDIO_BP_CAPABILITY_IDS).size).toBe(
      ORISTUDIO_BP_CAPABILITY_IDS.length
    );
    expect(ORISTUDIO_BP_COMMANDS.map((command) => command.capability)).toEqual(
      ORISTUDIO_BP_COMMAND_IDS
    );
  });

  it('contains the core BP Studio workflow commands up front', () => {
    expect(ORISTUDIO_BP_COMMAND_IDS).toEqual(
      expect.arrayContaining([
        'bp.file.newProject',
        'bp.file.importTreeMaker',
        'bp.view.tree',
        'bp.view.packing',
        'bp.tree.goToDual',
        'bp.layout.moveFlap',
        'bp.layout.nudgeSelection',
        'bp.layout.updateRiverWidth',
        'bp.layout.subdivide',
        'bp.layout.rotateRight',
        'bp.layout.flipHorizontal',
        'bp.layout.changeGridType',
        'bp.layout.completeStretch',
        'bp.layout.moveDevice',
        'bp.optimize.layout',
        'bp.optimize.cancel',
        'bp.file.exportBps',
        'bp.file.exportFold',
        'bp.file.exportSvg',
        'bp.file.exportPng',
        'bp.workspace.saveAll',
      ])
    );
  });

  it('narrows command and capability ids', () => {
    expect(isOristudioBpCommandId('bp.optimize.layout')).toBe(true);
    expect(isOristudioBpCommandId('optimize.scale')).toBe(false);
    expect(isOristudioBpCapabilityId('bp.layout.moveFlap')).toBe(true);
    expect(isOristudioBpCapabilityId('file.open')).toBe(false);
  });
});
