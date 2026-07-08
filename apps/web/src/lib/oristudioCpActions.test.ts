import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORISTUDIO_CP_ACTION_ID,
  ORISTUDIO_CP_ACTION_GROUPS,
  ORISTUDIO_CP_LINE_TYPE_ACTIONS,
  cpActionById,
  cpActionByOperation,
  cpActionByUpstreamMouseMode,
  cpRailActions,
} from './oristudioCpActions';
import { ORISTUDIO_CP_COMMANDS } from './oristudioCpCommands';

describe('oristudio CP action registry', () => {
  it('keeps Oriedita line type actions in the bottom toolbar', () => {
    expect(ORISTUDIO_CP_ACTION_GROUPS.map((group) => group.id).slice(0, 4)).toEqual([
      'line-type',
      'select-edit',
      'draw',
      'edit',
    ]);
    expect(ORISTUDIO_CP_LINE_TYPE_ACTIONS.map((action) => action.railLabel)).toEqual([
      'M',
      'V',
      'E',
      'U',
      'A',
    ]);
    expect(ORISTUDIO_CP_LINE_TYPE_ACTIONS.map((action) => action.lineColor)).toEqual([
      'Red1',
      'Blue2',
      'Black0',
      'None',
      'Cyan3',
    ]);
    expect(ORISTUDIO_CP_LINE_TYPE_ACTIONS.every((action) => action.placement === 'bottom-toolbar')).toBe(true);
    expect(cpRailActions().some((action) => action.kind === 'line-type')).toBe(false);
  });

  it('keeps every operation-backed command reachable through an action', () => {
    const operationActionIds = new Set(
      cpRailActions()
        .filter((action) => action.kind === 'command')
        .map((action) => action.operationId)
    );

    for (const command of ORISTUDIO_CP_COMMANDS) {
      if (command.placement === 'hidden-ui-only') continue;
      if (command.placement === 'menu' || command.placement === 'palette') continue;
      expect(operationActionIds.has(command.operationId), command.operationId).toBe(true);
    }
  });

  it('orders rail actions like Oriedita while exposing dropdown entries', () => {
    expect(cpRailActions().slice(0, 14).map((action) => action.label)).toEqual([
      'Box Select',
      'Select Overlapping Lines',
      'Polygon Select',
      'Lasso Select',
      'Box Deselect',
      'Deselect Overlapping Lines',
      'Polygon Deselect',
      'Lasso Deselect',
      'Line',
      'Grid Restricted Line',
      'Rabbit Ear',
      'Flat Foldable Line',
      'Extend Line',
      'Lengthen by Same Color',
    ]);

    expect(cpRailActions().slice(14, 15).map((action) => action.label)).toEqual([
      'Perpendicular Line',
    ]);

    expect(cpRailActions().find((action) => action.kind === 'command' && action.operationId === 'DrawCreaseAngleRestricted5')).toMatchObject({
      label: 'Angle Restricted Line',
      upstreamAction: 'deg2Action',
      upstreamMouseMode: 'DRAW_CREASE_ANGLE_RESTRICTED_5_37',
    });
    expect(cpRailActions().find((action) => action.kind === 'command' && action.operationId === 'AngleSystem')).toMatchObject({
      label: 'Offset Restricted Line',
      upstreamAction: 'deg3Action',
      upstreamMouseMode: 'ANGLE_SYSTEM_16',
    });
    expect(cpRailActions().find((action) => action.kind === 'command' && action.operationId === 'DrawCreaseAngleRestricted')).toMatchObject({
      label: 'Converging Lines',
      upstreamAction: 'deg1Action',
      upstreamMouseMode: 'DRAW_CREASE_ANGLE_RESTRICTED_13',
    });
    expect(cpRailActions().find((action) => action.kind === 'command' && action.operationId === 'FoldableLineInput')).toMatchObject({
      label: 'Flat Foldable Line (extend)',
      upstreamAction: 'foldableLinePlusGridInputAction',
      upstreamMouseMode: 'FOLDABLE_LINE_INPUT_39',
    });
  });

  it('keeps Oriedita mouse-mode edit tools in the sidebar', () => {
    expect(
      cpRailActions()
        .filter((action) => action.group === 'edit')
        .map((action) => ({
          label: action.label,
          upstreamAction: action.upstreamAction,
          upstreamMouseMode: action.kind === 'command' ? action.upstreamMouseMode : undefined,
        }))
    ).toEqual([
      {
        label: 'Eraser',
        upstreamAction: 'lineSegmentDeleteAction',
        upstreamMouseMode: 'LINE_SEGMENT_DELETE_3',
      },
      {
        label: 'Delete Point',
        upstreamAction: 'vertexDeleteAction',
        upstreamMouseMode: 'DELETE_POINT_15',
      },
      {
        label: 'Delete any Vertex',
        upstreamAction: 'v_del_ccAction',
        upstreamMouseMode: 'VERTEX_DELETE_ON_CREASE_41',
      },
      {
        label: 'Delete Coincident Lines',
        upstreamAction: 'del_lAction',
        upstreamMouseMode: 'CREASE_DELETE_OVERLAPPING_64',
      },
      {
        label: 'Delete Overlapping Lines',
        upstreamAction: 'del_l_XAction',
        upstreamMouseMode: 'CREASE_DELETE_INTERSECTING_65',
      },
    ]);
  });

  it('models the Oriedita line tool as a repeatable drag-line action', () => {
    expect(cpActionById(DEFAULT_ORISTUDIO_CP_ACTION_ID)).toMatchObject({
      kind: 'command',
      operationId: 'CreaseSelect',
      label: 'Box Select',
      inputMode: 'drag-box',
      repeatable: true,
    });

    expect(cpActionById('cp.action.draw-crease')).toMatchObject({
      kind: 'command',
      operationId: 'DrawCreaseFree',
      label: 'Line',
      inputMode: 'drag-line',
      repeatable: true,
      toolSteps: ['Drag crease endpoint'],
      upstreamAction: 'drawCreaseFreeAction',
    });

    expect(cpActionById('cp.action.draw-auxiliary-line')).toMatchObject({
      kind: 'command',
      operationId: 'DrawCreaseFree',
      inputMode: 'drag-line',
      lineInputMode: 'aux-line',
      uiStatus: 'not-implemented',
    });

    expect(cpActionByOperation('DrawCreaseSymmetric')).toMatchObject({
      kind: 'command',
      operationId: 'DrawCreaseSymmetric',
      label: 'Reflect selection over line',
      group: 'transform',
      toolSteps: ['Select 2 points or select a line', 'Pick reflection line end'],
    });
  });

  it('resolves persisted Oriedita mouse modes to the matching command action', () => {
    expect(cpActionByUpstreamMouseMode('DRAW_CREASE_FREE_1')).toMatchObject({
      id: 'cp.action.draw-crease',
      operationId: 'DrawCreaseFree',
      lineInputMode: 'fold-line',
    });
    expect(cpActionByUpstreamMouseMode('CREASE_SELECT_19')).toMatchObject({
      id: DEFAULT_ORISTUDIO_CP_ACTION_ID,
      operationId: 'CreaseSelect',
    });
    expect(cpActionByUpstreamMouseMode('FUTURE_MOUSE_MODE_999')).toBeUndefined();
  });
});
