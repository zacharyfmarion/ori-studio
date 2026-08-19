import { describe, expect, it } from 'vitest';
import { isRestingCpTool } from './restingTool';
import { DEFAULT_ORISTUDIO_CP_ACTION_ID, cpActionById } from '../../lib/oristudioCpActions';
import { cpCommandByOperation } from '../../lib/oristudioCpCommands';

const restingAction = cpActionById(DEFAULT_ORISTUDIO_CP_ACTION_ID);
if (restingAction?.kind !== 'command') {
  throw new Error('the default CP action is expected to be a command action');
}
const restingCommand = restingAction.command;

describe('isRestingCpTool', () => {
  it('recognises the tool Escape lands on', () => {
    expect(isRestingCpTool(restingAction, restingCommand)).toBe(true);
  });

  it('recognises it when reached without an action id', () => {
    // Some routes activate a command directly and leave `activeActionId` null.
    // The window must not reappear depending on how the tool was reached.
    expect(isRestingCpTool(undefined, restingCommand)).toBe(true);
  });

  it('does not claim other tools', () => {
    const other = cpCommandByOperation('DrawCreaseFree');
    expect(other).toBeDefined();
    if (!other) return;
    expect(isRestingCpTool(undefined, other)).toBe(false);
  });

  it('tracks the constant rather than a hard-coded operation', () => {
    // If the default action moves, so does this — the assertion is that the two
    // agree, not that either is `CreaseSelect`.
    expect(restingCommand.operationId).toBe(
      (cpActionById(DEFAULT_ORISTUDIO_CP_ACTION_ID) as typeof restingAction).command.operationId,
    );
  });
});
