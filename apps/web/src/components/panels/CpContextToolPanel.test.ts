import { describe, expect, it } from 'vitest';

import { cpCommandByOperation } from '../../lib/oristudioCpCommands';
import {
  emptyOristudioCpSelection,
  type OristudioCpSelection,
} from '../../lib/creasePatternViewport';
import { contextApplyDisabledForCommand, cpLineTypeStatusLabel } from './CpContextToolPanel';

function selection(lines: number[], circles: number[] = []): OristudioCpSelection {
  return { ...emptyOristudioCpSelection(), lines, circles };
}

describe('cpLineTypeStatusLabel', () => {
  it('maps line colors to their Oriedita status label', () => {
    expect(cpLineTypeStatusLabel('Red1')).toBe('Line M');
    expect(cpLineTypeStatusLabel('Blue2')).toBe('Line V');
  });
});

describe('contextApplyDisabledForCommand', () => {
  const propagate = cpCommandByOperation('PropagateFoldAngles')!;

  it('offers propagation’s Apply only once creases are selected', () => {
    // The button *is* the selection route. Enabled with nothing selected it
    // would offer a scope the kernel declines — and declining is deliberate
    // there, because "no scope" used to mean the whole canvas.
    expect(contextApplyDisabledForCommand(propagate, selection([]), 0)).toBe(true);
    expect(contextApplyDisabledForCommand(propagate, selection([7]), 0)).toBe(false);
  });

  it('does not confuse a circle selection for a crease one', () => {
    expect(contextApplyDisabledForCommand(propagate, selection([], [2, 3]), 0)).toBe(true);
  });
});
