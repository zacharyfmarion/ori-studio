import { describe, expect, it } from 'vitest';
import {
  cpToolSelectionForMouseMode,
  cpVariantGroupForOperation,
  cpVariantHostOperation,
  cpVariantOptionPatch,
  resolveCpVariantOperation,
} from './cpToolVariants';
import {
  DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
  type OristudioCpToolOptions,
} from './oristudioCpToolSettings';

function options(overrides: Partial<OristudioCpToolOptions> = {}): OristudioCpToolOptions {
  return { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, ...overrides };
}

describe('resolveCpVariantOperation', () => {
  it('picks the lengthen operation from the colour mode', () => {
    expect(resolveCpVariantOperation('LengthenCrease', options({ lengthenColorMode: 'active' }))).toBe(
      'LengthenCrease'
    );
    expect(resolveCpVariantOperation('LengthenCrease', options({ lengthenColorMode: 'same' }))).toBe(
      'LengthenCreaseSameColor'
    );
  });

  it('picks the divide operation from the divide mode', () => {
    expect(resolveCpVariantOperation('LineSegmentDivision', options({ divideMode: 'count' }))).toBe(
      'LineSegmentDivision'
    );
    expect(resolveCpVariantOperation('LineSegmentDivision', options({ divideMode: 'ratio' }))).toBe(
      'LineSegmentRatioSet'
    );
  });

  // The `.osf` restore path reaches a non-host variant directly. Resolving from
  // it too keeps the seam total, so no caller needs to normalise first.
  it('resolves from a non-host variant as well as from the host', () => {
    expect(
      resolveCpVariantOperation('LengthenCreaseSameColor', options({ lengthenColorMode: 'active' }))
    ).toBe('LengthenCrease');
    expect(resolveCpVariantOperation('LineSegmentRatioSet', options({ divideMode: 'count' }))).toBe(
      'LineSegmentDivision'
    );
  });

  it('returns an ordinary tool untouched', () => {
    expect(resolveCpVariantOperation('DrawCreaseFree', options())).toBe('DrawCreaseFree');
    expect(resolveCpVariantOperation('CreaseSelect', options())).toBe('CreaseSelect');
  });
});

describe('cpVariantGroupForOperation', () => {
  it('names the group for every member of a pair', () => {
    expect(cpVariantGroupForOperation('LengthenCrease')).toBe('lengthen-color');
    expect(cpVariantGroupForOperation('LengthenCreaseSameColor')).toBe('lengthen-color');
    expect(cpVariantGroupForOperation('LineSegmentDivision')).toBe('divide-mode');
    expect(cpVariantGroupForOperation('LineSegmentRatioSet')).toBe('divide-mode');
  });

  it('is null for an ordinary tool, and for no tool', () => {
    expect(cpVariantGroupForOperation('DrawCreaseFree')).toBeNull();
    expect(cpVariantGroupForOperation(null)).toBeNull();
    expect(cpVariantGroupForOperation(undefined)).toBeNull();
  });
});

describe('cpVariantHostOperation', () => {
  it('maps a non-host variant to the operation that owns the rail button', () => {
    expect(cpVariantHostOperation('LengthenCreaseSameColor')).toBe('LengthenCrease');
    expect(cpVariantHostOperation('LineSegmentRatioSet')).toBe('LineSegmentDivision');
  });

  it('leaves hosts and ordinary tools alone', () => {
    expect(cpVariantHostOperation('LengthenCrease')).toBe('LengthenCrease');
    expect(cpVariantHostOperation('DrawCreaseFree')).toBe('DrawCreaseFree');
  });
});

describe('cpVariantOptionPatch', () => {
  // Round trip: the patch for an operation must be exactly what resolves back to it.
  it('names the mode that selects the operation', () => {
    for (const operationId of [
      'LengthenCrease',
      'LengthenCreaseSameColor',
      'LineSegmentDivision',
      'LineSegmentRatioSet',
    ] as const) {
      const patch = cpVariantOptionPatch(operationId);
      expect(Object.keys(patch)).toHaveLength(1);
      expect(resolveCpVariantOperation(cpVariantHostOperation(operationId), options(patch))).toBe(
        operationId
      );
    }
  });

  it('is empty for an ordinary tool', () => {
    expect(cpVariantOptionPatch('DrawCreaseFree')).toEqual({});
  });
});

// Oriedita writes the active mouse mode into the file, and two of the four modes
// for the merged pairs now belong to actions with no rail button. Restoring one
// directly would leave the rail with nothing lit and the mode reading whatever it
// happened to be.
describe('cpToolSelectionForMouseMode', () => {
  it('lands a non-host variant on the host tool with the mode that runs it', () => {
    const lengthen = cpToolSelectionForMouseMode('LENGTHEN_CREASE_SAME_COLOR_70');
    expect(lengthen?.action.id).toBe('cp.action.lengthen-crease');
    expect(lengthen?.options).toEqual({ lengthenColorMode: 'same' });

    const divide = cpToolSelectionForMouseMode('LINE_SEGMENT_RATIO_SET_28');
    expect(divide?.action.id).toBe('cp.action.line-segment-division');
    expect(divide?.options).toEqual({ divideMode: 'ratio' });
  });

  it('round-trips: the restored tool plus mode arms the saved operation', () => {
    for (const [mouseMode, operationId] of [
      ['LENGTHEN_CREASE_5', 'LengthenCrease'],
      ['LENGTHEN_CREASE_SAME_COLOR_70', 'LengthenCreaseSameColor'],
      ['LINE_SEGMENT_DIVISION_27', 'LineSegmentDivision'],
      ['LINE_SEGMENT_RATIO_SET_28', 'LineSegmentRatioSet'],
    ] as const) {
      const selection = cpToolSelectionForMouseMode(mouseMode);
      expect(selection, mouseMode).not.toBeNull();
      expect(
        resolveCpVariantOperation(
          selection!.action.operationId,
          options(selection!.options ?? {})
        ),
        mouseMode
      ).toBe(operationId);
    }
  });

  it('leaves an ordinary tool alone, and is null for an unknown mode', () => {
    const plain = cpToolSelectionForMouseMode('DRAW_CREASE_FREE_1');
    expect(plain?.action.id).toBe('cp.action.draw-crease');
    expect(plain?.options).toBeUndefined();
    expect(cpToolSelectionForMouseMode('FUTURE_MOUSE_MODE_999')).toBeNull();
  });
});
