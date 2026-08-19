import { describe, expect, it } from 'vitest';
import { cpActionById, type OristudioCpCommandActionDefinition } from './oristudioCpActions';
import { cpCommandByOperation, type OristudioCpCommandDefinition } from './oristudioCpCommands';
import {
  cancelOristudioCpToolState,
  IDLE_ORISTUDIO_CP_TOOL_STATE,
  transitionOristudioCpToolState,
} from './oristudioCpToolState';
import { DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS } from './oristudioCpToolSettings';

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
      toolOptions: DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
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
      toolOptions: DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
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
      toolOptions: DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
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
      toolOptions: DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
    });
    const nextDrawingStep = transitionOristudioCpToolState(drawing, { type: 'advanceStep' });
    const moving = transitionOristudioCpToolState(nextDrawingStep, {
      type: 'selectAction',
      action: action('cp.action.crease-move'),
      editable: true,
      toolOptions: DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
    });

    expect(moving).toMatchObject({
      activeActionId: 'cp.action.crease-move',
      activeOperationId: 'CreaseMove',
      phase: 'active',
      prompt: 'Move selected creases: Pick source point',
      stepIndex: 0,
    });
  });

  // Extend Line and Divided Line are one rail action over two kernel operations
  // each. The action is the tool identity; the operation is resolved from the
  // mode option, once, here -- every guard comparing `activeOperationId` against
  // the command it is about to run stays correct because both are the resolved one.
  describe('merged tools', () => {
    it('arms the operation the mode names, not the action own', () => {
      const same = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
        type: 'selectAction',
        action: action('cp.action.lengthen-crease'),
        editable: true,
        toolOptions: { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, lengthenColorMode: 'same' },
      });
      expect(same).toMatchObject({
        activeActionId: 'cp.action.lengthen-crease',
        activeOperationId: 'LengthenCreaseSameColor',
        activeLabel: 'Extend Line',
      });

      const active = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
        type: 'selectAction',
        action: action('cp.action.lengthen-crease'),
        editable: true,
        toolOptions: { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, lengthenColorMode: 'active' },
      });
      expect(active.activeOperationId).toBe('LengthenCrease');
    });

    it('re-resolves a mode changed while the tool is already armed', () => {
      const armed = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
        type: 'selectAction',
        action: action('cp.action.line-segment-division'),
        editable: true,
        toolOptions: { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, divideMode: 'count' },
      });
      const midGesture = transitionOristudioCpToolState(armed, { type: 'advanceStep' });
      const switched = transitionOristudioCpToolState(midGesture, {
        type: 'resolveVariant',
        toolOptions: { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, divideMode: 'ratio' },
      });

      expect(switched.activeOperationId).toBe('LineSegmentRatioSet');
      // The tool did not change, so neither does what has been picked so far.
      expect(switched.activeActionId).toBe(midGesture.activeActionId);
      expect(switched.stepIndex).toBe(midGesture.stepIndex);
      expect(switched.prompt).toBe(midGesture.prompt);
    });

    it('is identity for an unchanged mode and for an ordinary tool', () => {
      const drawing = transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
        type: 'selectAction',
        action: action('cp.action.draw-crease'),
        editable: true,
        toolOptions: DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
      });
      expect(
        transitionOristudioCpToolState(drawing, {
          type: 'resolveVariant',
          toolOptions: { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, divideMode: 'ratio' },
        }),
      ).toBe(drawing);
      expect(
        transitionOristudioCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE, {
          type: 'resolveVariant',
          toolOptions: DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
        }),
      ).toBe(IDLE_ORISTUDIO_CP_TOOL_STATE);
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
      }),
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
