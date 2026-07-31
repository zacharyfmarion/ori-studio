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
  it('puts the line type actions first in the left rail', () => {
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
    // Unassigned stays a real line type (imported patterns carry it) but is not
    // worth a chip, so it is the one kept out of the rail.
    const shown = ORISTUDIO_CP_LINE_TYPE_ACTIONS.filter(
      (action) => action.placement === 'left-rail'
    );
    expect(shown.map((action) => action.railLabel)).toEqual(['M', 'V', 'E', 'A']);
    expect(
      ORISTUDIO_CP_LINE_TYPE_ACTIONS.filter((action) => action.placement === 'hidden-ui-only').map(
        (action) => action.railLabel
      )
    ).toEqual(['U']);

    // The rail is their only home, and they lead it (group order 5).
    const rail = cpRailActions();
    expect(rail.filter((action) => action.kind === 'line-type')).toHaveLength(shown.length);
    expect(rail.slice(0, shown.length).map((action) => action.id)).toEqual(
      shown.map((action) => action.id)
    );
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
    // Line types lead the rail in their own group, so the Oriedita tool order
    // is asserted from the first command action onward.
    const tools = cpRailActions().filter((action) => action.kind === 'command');
    expect(tools.slice(0, 10).map((action) => action.label)).toEqual([
      'Box Select',
      'Lasso Select',
      'Box Deselect',
      'Lasso Deselect',
      'Line',
      'Grid Restricted Line',
      'Rabbit Ear',
      'Flat Foldable Line',
      'Extend Line',
      'Lengthen by Same Color',
    ]);

    expect(tools.slice(10, 11).map((action) => action.label)).toEqual([
      'Perpendicular Line',
    ]);

    // Angle-restricted variants that remain in the curated rail keep their Oriedita
    // override mappings. (Offset Restricted Line / Flat Foldable Line (extend) and the
    // other non-Oriedita-UI tools were deliberately hidden from the rail.)
    expect(cpRailActions().find((action) => action.kind === 'command' && action.operationId === 'DrawCreaseAngleRestricted5')).toMatchObject({
      label: 'Angle Restricted Line',
      upstreamAction: 'deg2Action',
      upstreamMouseMode: 'DRAW_CREASE_ANGLE_RESTRICTED_5_37',
    });
    expect(cpRailActions().find((action) => action.kind === 'command' && action.operationId === 'DrawCreaseAngleRestricted')).toMatchObject({
      label: 'Converging Lines',
      upstreamAction: 'deg1Action',
      upstreamMouseMode: 'DRAW_CREASE_ANGLE_RESTRICTED_13',
    });
  });

  it('rails the pattern generators under Generate rather than Draw', () => {
    expect(
      cpRailActions()
        .filter((action) => action.group === 'generators')
        .map((action) => action.label)
    ).toEqual([
      'Blintz base',
      'Fish base',
      'Dove base',
      'Bird base',
      'Frog base',
      'Regular Polygon',
      'Voronoi',
    ]);

    expect(
      cpRailActions().some(
        (action) =>
          action.group === 'draw' &&
          action.kind === 'command' &&
          (action.operationId === 'PolygonSetNoCorners' || action.operationId === 'VoronoiCreate')
      )
    ).toBe(false);
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
        // Not a mouse tool — a whole-document sweep, hence no mouse mode. The
        // same-type variant is the one on the rail because it is the one with a
        // keybinding; its ignore-type sibling lives in the Repair menu.
        label: 'Delete Extra Vertices',
        upstreamAction: 'v_del_allAction',
        upstreamMouseMode: undefined,
      },
      // `VertexDeleteOnCrease` (Delete any Vertex) and `CreaseDeleteOverlapping`
      // (Delete Coincident Lines) are deliberately absent: both are hidden from
      // the rail, the first because it reads the same as Delete Point at a
      // glance, the second because Delete Overlapping Lines below is its
      // superset. Both kernel operations still exist.
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
      toolSteps: ['Click or drag to set the crease start', 'Click to set the crease end'],
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
