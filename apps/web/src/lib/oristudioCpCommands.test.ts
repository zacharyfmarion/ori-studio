import { describe, expect, it } from 'vitest';
import {
  ORISTUDIO_CP_COMMANDS,
  ORISTUDIO_CP_COMMAND_GROUPS,
  ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS,
  cpCommandByOperation,
  cpCommandsForGroup,
  cpRailCommands,
} from './oristudioCpCommands';

describe('oristudio CP command registry', () => {
  it('assigns every source-mapped Oriedita operation to one UI command', () => {
    const commandOperations = ORISTUDIO_CP_COMMANDS.map((command) => command.operationId).sort();
    const sourceOperations = [...ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS].sort();

    expect(commandOperations).toEqual(sourceOperations);
    expect(new Set(commandOperations).size).toBe(commandOperations.length);
  });

  it('keeps command IDs stable and source-map backed', () => {
    expect(cpCommandByOperation('DrawCreaseFree')).toMatchObject({
      id: 'cp.draw-crease-free',
      group: 'draw',
      upstream: 'MouseHandlerDrawCreaseFree',
      placement: 'left-rail',
    });
    expect(cpCommandByOperation('MoveCreasePattern')).toMatchObject({
      id: 'cp.move-crease-pattern',
      uiStatus: 'out-of-scope-ui',
      placement: 'hidden-ui-only',
    });
    expect(cpCommandByOperation('FoldingEstimate')).toMatchObject({
      uiStatus: 'porting',
      group: 'folding',
    });
    expect(cpCommandByOperation('CreaseMakeMountain')).toMatchObject({
      uiStatus: 'ready',
      placement: 'menu',
      selectionRequirement: 'selected lines',
    });
    expect(cpCommandByOperation('CreaseSetLineColor')).toMatchObject({
      uiStatus: 'ready',
      placement: 'palette',
      selectionRequirement: 'selected lines',
    });
    expect(cpCommandByOperation('CreaseMove')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Pick source point', 'Pick destination point'],
    });
    expect(cpCommandByOperation('LengthenCreaseSameColor')).toMatchObject({
      uiStatus: 'ready',
      label: 'Lengthen by Same Color',
      group: 'draw',
      toolSteps: ['Select line to extend', 'Select target line'],
    });
    expect(cpCommandByOperation('DrawCreaseSymmetric')).toMatchObject({
      uiStatus: 'ready',
      label: 'Reflect selection over line',
      group: 'transform',
      selectionRequirement: 'selected creases',
      toolSteps: ['Select 2 points or select a line', 'Pick reflection line end'],
    });
    expect(cpCommandByOperation('CreaseMove4p')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: [
        'Pick source first point',
        'Pick source second point',
        'Pick target first point',
        'Pick target second point',
      ],
    });
    expect(cpCommandByOperation('CreaseDeleteIntersecting')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Pick drag start point', 'Pick drag end point'],
    });
    expect(cpCommandByOperation('DrawCreaseFree')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Drag crease endpoint'],
      inputMode: 'drag-line',
    });
    expect(cpCommandByOperation('Axiom5')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: [
        'Pick target point',
        'Pick target crease',
        'Pick pivot point',
        'Pick destination crease',
      ],
    });
    expect(cpCommandByOperation('SelectLineIntersecting')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Pick drag start point', 'Pick drag end point'],
    });
    expect(cpCommandByOperation('CreaseSelect')).toMatchObject({
      uiStatus: 'ready',
      inputMode: 'drag-box',
      toolSteps: ['Drag selection box'],
    });
    expect(cpCommandByOperation('FixInaccurate')).toMatchObject({
      uiStatus: 'ready',
      placement: 'menu',
      selectionRequirement: 'selected folding lines',
    });
    expect(cpCommandByOperation('Check1')).toMatchObject({
      uiStatus: 'ready',
      label: 'Check overlaps',
      tooltip: 'Find overlapping or contained non-auxiliary crease pairs',
    });
    expect(cpCommandByOperation('CheckCamv')).toMatchObject({
      uiStatus: 'ready',
    });
    expect(cpCommandByOperation('FlatFoldableCheck')).toMatchObject({
      uiStatus: 'ready',
      inputMode: 'drag-path',
      toolSteps: ['Draw a closed boundary loop'],
    });
    expect(cpCommandByOperation('Fix1')).toMatchObject({
      uiStatus: 'ready',
      label: 'Repair overlaps',
    });
    expect(cpCommandByOperation('Fix2')).toMatchObject({
      uiStatus: 'ready',
      label: 'Split T-junctions',
    });
    expect(cpCommandByOperation('DisplayLengthBetweenPoints1')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Pick first point', 'Pick second point'],
    });
    expect(cpCommandByOperation('DisplayAngleBetweenThreePoints1')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Pick first point', 'Pick vertex point', 'Pick second point'],
    });
    expect(cpCommandByOperation('CircleDraw')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Pick center point', 'Pick radius point'],
    });
    expect(cpCommandByOperation('CircleDrawTangentLine')).toMatchObject({
      uiStatus: 'ready',
      selectionRequirement: 'selected circle(s)',
    });
    expect(cpCommandByOperation('CircleDrawInverted')).toMatchObject({
      uiStatus: 'ready',
      selectionRequirement: 'selected circle and circle or crease',
    });
    expect(cpCommandByOperation('CircleDrawConcentric')).toMatchObject({
      uiStatus: 'ready',
      selectionRequirement: 'selected circle',
      toolSteps: ['Pick radius start', 'Pick radius end'],
    });
    expect(cpCommandByOperation('CircleDrawConcentricSelect')).toMatchObject({
      uiStatus: 'ready',
      selectionRequirement: 'three selected circles',
    });
    expect(cpCommandByOperation('CircleDrawConcentricTwoCircleSelect')).toMatchObject({
      uiStatus: 'ready',
      selectionRequirement: 'two selected circles',
    });
    expect(cpCommandByOperation('PolygonSetNoCorners')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Pick first corner', 'Pick second corner'],
    });
    expect(cpCommandByOperation('DrawBlintz')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Pick first anchor point', 'Pick second anchor point'],
    });
    expect(cpCommandByOperation('CircleChangeColor')).toMatchObject({
      uiStatus: 'ready',
      selectionRequirement: 'selected circles or auxiliary lines',
    });
    expect(cpCommandByOperation('OrganizeCircles')).toMatchObject({
      uiStatus: 'ready',
      tooltip: 'Prune invalid zero-radius circles using Oriedita cleanup rules',
    });
    expect(cpCommandByOperation('VoronoiCreate')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Click seed point'],
    });
    expect(cpCommandByOperation('Text')).toMatchObject({
      uiStatus: 'ready',
      toolSteps: ['Click text position'],
    });
  });

  it('keeps the left rail populated by ordered command groups', () => {
    const groupIds = ORISTUDIO_CP_COMMAND_GROUPS.map((group) => group.id);
    expect(groupIds).toEqual([
      'select-edit',
      'draw',
      'construct',
      'transform',
      'color',
      'annotations',
      'generators',
      'measure',
      'check-fix',
      'folding',
      'file',
    ]);

    for (const group of ORISTUDIO_CP_COMMAND_GROUPS) {
      expect(cpCommandsForGroup(group.id).length, `${group.id} should have commands`).toBeGreaterThan(0);
    }
    expect(cpRailCommands().some((command) => command.group === 'file')).toBe(false);
    expect(cpRailCommands().some((command) => command.group === 'draw')).toBe(true);
  });

  it('makes disabled states explainable instead of hiding missing behavior', () => {
    for (const command of ORISTUDIO_CP_COMMANDS) {
      expect(command.label).not.toEqual('');
      expect(command.icon).not.toEqual('');
      expect(command.tooltip).not.toEqual('');
      expect(command.disabledReason).not.toEqual('');
      if (command.uiStatus === 'not-implemented') {
        expect(command.disabledReason).toContain('Not implemented');
      }
    }
  });
});
