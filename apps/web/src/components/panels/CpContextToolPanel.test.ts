import { describe, expect, it } from 'vitest';
import { cpCommandByOperation } from '../../lib/oristudioCpCommands';
import { cpCommandRequiresContextApply, cpLineTypeStatusLabel } from './CpContextToolPanel';

describe('cpCommandRequiresContextApply', () => {
  it('requires an explicit Apply for selection-driven commands', () => {
    // Text and Voronoi apply against the current selection / seeds, not per drag.
    expect(cpCommandRequiresContextApply(cpCommandByOperation('VoronoiCreate')!)).toBe(true);
    expect(cpCommandRequiresContextApply(cpCommandByOperation('Text')!)).toBe(true);
  });

  it('does not require Apply for step-driven draw tools', () => {
    // Tools that commit through their own tool-step gestures need no Apply button.
    expect(cpCommandRequiresContextApply(cpCommandByOperation('DrawCreaseFree')!)).toBe(false);
    expect(cpCommandRequiresContextApply(cpCommandByOperation('PerpendicularDraw')!)).toBe(false);
  });
});

describe('cpLineTypeStatusLabel', () => {
  it('maps line colors to their Oriedita status label', () => {
    expect(cpLineTypeStatusLabel('Red1')).toBe('Line M');
    expect(cpLineTypeStatusLabel('Blue2')).toBe('Line V');
  });
});
