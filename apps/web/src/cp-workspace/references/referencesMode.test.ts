import { describe, expect, it } from 'vitest';
import { referencesSurfaces, type ReferencesModeInput } from './referencesMode';

function input(overrides: Partial<ReferencesModeInput> = {}): ReferencesModeInput {
  return {
    mode: 'find',
    targeted: false,
    hasCreases: true,
    planned: false,
    busy: false,
    ...overrides,
  };
}

describe('referencesSurfaces', () => {
  it('lands in Find with the whole sheet, no filmstrip and the hint', () => {
    expect(referencesSurfaces(input())).toEqual({
      canvas: 'whole',
      strip: 'none',
      lead: { kind: 'hint-find' },
      pick: 'query',
      emptySheet: false,
    });
  });

  it('shows the picked target and its candidates in Find', () => {
    const surfaces = referencesSurfaces(input({ targeted: true }));
    expect(surfaces.canvas).toBe('target');
    expect(surfaces.strip).toBe('candidate');
    expect(surfaces.lead).toEqual({ kind: 'none' });
  });

  it('ignores a cached plan while in Find: the sheet stays whole', () => {
    const surfaces = referencesSurfaces(input({ planned: true }));
    expect(surfaces.canvas).toBe('whole');
    expect(surfaces.strip).toBe('none');
  });

  it('reads the plan in Sequence, and a tap jumps to a step', () => {
    expect(referencesSurfaces(input({ mode: 'sequence', planned: true }))).toEqual({
      canvas: 'plan',
      strip: 'plan',
      lead: { kind: 'none' },
      pick: 'jump',
      emptySheet: false,
    });
  });

  it('says it is planning where the cards will be, and offers the plan when nothing is', () => {
    expect(referencesSurfaces(input({ mode: 'sequence', busy: true })).lead).toEqual({
      kind: 'planning',
    });
    const idle = referencesSurfaces(input({ mode: 'sequence' }));
    expect(idle.lead).toEqual({ kind: 'plan' });
    expect(idle.strip).toBe('none');
    expect(idle.pick).toBe('none');
  });

  it('has nothing to find or plan on a sheet that is only a border', () => {
    for (const mode of ['find', 'sequence'] as const) {
      const surfaces = referencesSurfaces(input({ mode, hasCreases: false, planned: true }));
      expect(surfaces.emptySheet).toBe(true);
      expect(surfaces.strip).toBe('none');
      expect(surfaces.pick).toBe('none');
      expect(surfaces.lead).toEqual({ kind: 'none' });
    }
  });
});
