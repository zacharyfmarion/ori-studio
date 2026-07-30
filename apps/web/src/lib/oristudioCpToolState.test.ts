import { describe, expect, it } from 'vitest';
import {
  cpActionById,
  type OristudioCpCommandActionDefinition,
} from './oristudioCpActions';
import {
  cpCommandByOperation,
  type OristudioCpCommandDefinition,
} from './oristudioCpCommands';
import {
  cancelOristudioCpToolState,
  IDLE_ORISTUDIO_CP_TOOL_STATE,
  transitionOristudioCpToolState,
} from './oristudioCpToolState';

function command(operationId: OristudioCpCommandDefinition['operationId']) {
  const definition = cpCommandByOperation(operationId);
  if (!definition) throw new Error(`Missing command ${operationId}`);
  return definition;
}

function ready(operationId: OristudioCpCommandDefinition['operationId']) {
  return {
    ...command(operationId),
    uiStatus: 'ready',
    disabledReason: '',
  } satisfies OristudioCpCommandDefinition;
}

function action(id: OristudioCpCommandActionDefinition['id']) {
  const definition = cpActionById(id);
  if (!definition || definition.kind !== 'command') throw new Error(`Missing action ${id}`);
  return definition;
}

describe('oristudio CP tool state', () => {
  it('selects unavailable commands as blocked but keeps the active command visible', () => {
    const state = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
      type: 'selectAction',
      action: action('cp.action.draw-auxiliary-line'),
      editable: true,
    });

    expect(state).toMatchObject({
      activeActionId: 'cp.action.draw-auxiliary-line',
      activeOperationId: 'DrawCreaseFree',
      phase: 'blocked',
      prompt: 'Draw auxiliary line: Not implemented',
      status: 'not-implemented',
      stepIndex: 0,
    });
    expect(state.steps).toEqual([
      'Click or drag to set the crease start',
      'Click to set the crease end',
    ]);
  });

  it('starts ready action tools and keeps repeatable draw tools active after commit', () => {
    const first = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
      type: 'selectAction',
      action: action('cp.action.draw-crease'),
      editable: true,
    });
    const committed = transitionOristudioCpToolState(first, { type: 'commit', keepActive: true });

    expect(first).toMatchObject({
      activeActionId: 'cp.action.draw-crease',
      activeOperationId: 'DrawCreaseFree',
      phase: 'active',
      prompt: 'Line: Click or drag to set the crease start',
      stepIndex: 0,
    });
    expect(committed).toMatchObject({
      activeActionId: 'cp.action.draw-crease',
      activeOperationId: 'DrawCreaseFree',
      phase: 'active',
      prompt: 'Line: Click or drag to set the crease start',
      stepIndex: 0,
    });
  });

  it('advances multi-step action prompts without changing tools', () => {
    const first = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
      type: 'selectAction',
      action: action('cp.action.crease-move'),
      editable: true,
    });
    const second = transitionOristudioCpToolState(first, { type: 'advanceStep' });
    const beyondLast = transitionOristudioCpToolState(second, { type: 'advanceStep' });

    expect(first.prompt).toBe('Move selected creases: Pick source point');
    expect(second).toMatchObject({
      activeActionId: 'cp.action.crease-move',
      activeOperationId: 'CreaseMove',
      phase: 'active',
      prompt: 'Move selected creases: Pick destination point',
      stepIndex: 1,
    });
    expect(beyondLast).toBe(second);
  });

  it('resets step state when switching command modes', () => {
    const drawing = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
      type: 'selectAction',
      action: action('cp.action.draw-crease'),
      editable: true,
    });
    const nextDrawingStep = transitionOristudioCpToolState(drawing, { type: 'advanceStep' });
    const moving = transitionOristudioCpToolState(nextDrawingStep, {
      type: 'selectAction',
      action: action('cp.action.crease-move'),
      editable: true,
    });

    expect(moving).toMatchObject({
      activeActionId: 'cp.action.crease-move',
      activeOperationId: 'CreaseMove',
      phase: 'active',
      prompt: 'Move selected creases: Pick source point',
      stepIndex: 0,
    });
  });

  it('surfaces command errors against the active tool', () => {
    const active = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
      type: 'selectCommand',
      command: ready('DrawPoint'),
      editable: true,
    });

    expect(
      transitionOristudioCpToolState(active, {
        type: 'commandError',
        message: 'candidate vanished',
      })
    ).toMatchObject({
      activeActionId: null,
      activeOperationId: 'DrawPoint',
      phase: 'error',
      prompt: 'Draw point: candidate vanished',
      status: 'error',
    });
  });

  it('cancels active or blocked tools before falling through to selection clearing', () => {
    expect(cancelOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE)).toEqual({
      handled: false,
      state: IDLE_ORISTUDIO_CP_TOOL_STATE,
    });

    const blocked = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
      type: 'selectCommand',
      command: command('Fold'),
      editable: true,
    });

    expect(cancelOristudioCpToolState(blocked)).toEqual({
      handled: true,
      state: IDLE_ORISTUDIO_CP_TOOL_STATE,
    });
  });
});
