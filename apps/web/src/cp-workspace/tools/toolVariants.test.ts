import { describe, expect, it } from 'vitest';
import {
  cpVariantGroupForOperation,
  cpVariantHostOperation,
  cpVariantOptionPatch,
  resolveCpVariantOperation,
} from './toolVariants';
import {
  DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
  type OristudioCpToolOptions,
} from '../../lib/oristudioCpToolSettings';

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
