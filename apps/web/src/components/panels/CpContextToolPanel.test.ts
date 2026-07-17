import { describe, expect, it } from 'vitest';
import { cpCommandByOperation } from '../../lib/oristudioCpCommands';
import { cpCommandRequiresContextApply, cpLineTypeStatusLabel } from './CpContextToolPanel';

describe('cpCommandRequiresContextApply', () => {
  it('requires an explicit Apply for selection-driven commands', () => {
    // Voronoi applies against the accumulated seed list, not per drag.
    expect(cpCommandRequiresContextApply(cpCommandByOperation('VoronoiCreate')!)).toBe(true);
  });

  it('does not require Apply for step-driven draw tools', () => {
    // Tools that commit through their own tool-step gestures need no Apply button.
    expect(cpCommandRequiresContextApply(cpCommandByOperation('DrawCreaseFree')!)).toBe(false);
    expect(cpCommandRequiresContextApply(cpCommandByOperation('PerpendicularDraw')!)).toBe(false);
  });

  it('does not require Apply for the Text tool (authored inline on the canvas)', () => {
    expect(cpCommandRequiresContextApply(cpCommandByOperation('Text')!)).toBe(false);
  });
});

describe('cpLineTypeStatusLabel', () => {
  it('maps line colors to their Oriedita status label', () => {
    expect(cpLineTypeStatusLabel('Red1')).toBe('Line M');
    expect(cpLineTypeStatusLabel('Blue2')).toBe('Line V');
  });
});
