import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hasNonDefaultCpToolOptions,
  isPersistedCpToolOption,
  persistedCpToolOptionKeys,
  readCpToolOptions,
  resetCpToolOptions,
  writeCpToolOptions,
} from './cpToolOptionPersistence';
import { DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS } from './oristudioCpToolSettings';
import { STORAGE_KEYS, storageKey } from './storage';

const KEY = storageKey(STORAGE_KEYS.cpToolOptions);

function store(value: unknown): void {
  localStorage.setItem(KEY, JSON.stringify(value));
}

describe('cpToolOptionPersistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns the defaults when nothing is stored', () => {
    expect(readCpToolOptions()).toEqual(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS);
  });

  it('round-trips an opted-in value', () => {
    writeCpToolOptions({ ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, angleSystemDivider: 16 });
    expect(readCpToolOptions().angleSystemDivider).toBe(16);
  });

  it('never writes the per-invocation options', () => {
    // `candidateIndex` against a different vertex's candidates would silently
    // pre-select the wrong one; `textContent` would pre-fill the next annotation
    // with the last one's text. Both must stay out of storage entirely.
    writeCpToolOptions({
      ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
      candidateIndex: 2,
      textContent: 'hello',
    });
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(raw).not.toHaveProperty('candidateIndex');
    expect(raw).not.toHaveProperty('textContent');
    expect(isPersistedCpToolOption('candidateIndex')).toBe(false);
    expect(isPersistedCpToolOption('textContent')).toBe(false);
  });

  it('ignores a key it does not persist, even when one is in storage', () => {
    store({ angleSystemDivider: 16, polygonCorners: 12, somethingRemoved: true });
    const options = readCpToolOptions();
    expect(options.angleSystemDivider).toBe(16);
    expect(options.polygonCorners).toBe(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.polygonCorners);
  });

  it('falls back per key, so one bad value does not cost its neighbours', () => {
    // The whole reason there is no version field: a key whose range changed
    // should lose only itself.
    store({ angleSystemDivider: 'not a number', fixPrecision: 0.01 });
    const options = readCpToolOptions();
    expect(options.angleSystemDivider).toBe(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.angleSystemDivider);
    expect(options.fixPrecision).toBe(0.01);
  });

  it('rejects an out-of-range value rather than handing it to the tool', () => {
    store({ angleSystemDivider: 9999, fixPrecision: -5 });
    const options = readCpToolOptions();
    expect(options.angleSystemDivider).toBe(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.angleSystemDivider);
    expect(options.fixPrecision).toBe(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.fixPrecision);
  });

  it('takes a custom angle set only when all six angles are usable', () => {
    store({ angleSystemAngles: [10, 20, 30, 40, 50, 60] });
    expect(readCpToolOptions().angleSystemAngles).toEqual([10, 20, 30, 40, 50, 60]);

    store({ angleSystemAngles: [10, 20, 30] });
    expect(readCpToolOptions().angleSystemAngles).toEqual(
      DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.angleSystemAngles
    );

    store({ angleSystemAngles: [10, 20, 30, 40, 50, 'x'] });
    expect(readCpToolOptions().angleSystemAngles).toEqual(
      DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.angleSystemAngles
    );
  });

  it('survives a stored value that is not an object at all', () => {
    localStorage.setItem(KEY, '"a string"');
    expect(readCpToolOptions()).toEqual(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS);
    localStorage.setItem(KEY, 'not json');
    expect(readCpToolOptions()).toEqual(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS);
  });

  it('refuses on the way out what it would refuse on the way in', () => {
    // A control with a bad clamp would otherwise write a value this module then
    // declines to read, which presents as a setting that forgets itself.
    writeCpToolOptions({ ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, angleSystemDivider: -3 });
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(raw).not.toHaveProperty('angleSystemDivider');
  });

  it('takes a mode only when it is one the tool actually has', () => {
    store({ lengthenColorMode: 'active', divideMode: 'ratio' });
    expect(readCpToolOptions().lengthenColorMode).toBe('active');
    expect(readCpToolOptions().divideMode).toBe('ratio');

    // A mode removed by a later release, or hand-edited, costs only itself.
    store({ lengthenColorMode: 'rainbow', divideMode: 'ratio' });
    const options = readCpToolOptions();
    expect(options.lengthenColorMode).toBe(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.lengthenColorMode);
    expect(options.divideMode).toBe('ratio');
  });

  it('takes a ratio only when all six coefficients are usable', () => {
    const expression = { a: 3, b: 0, c: 0, d: 1, e: 1, f: 5 };
    store({ divisionRatio: expression });
    expect(readCpToolOptions().divisionRatio).toEqual(expression);

    // A partial ratio would evaluate its missing halves to zero, which is a
    // silently different division rather than a visibly reset one.
    store({ divisionRatio: { a: 3, b: 0, c: 0 } });
    expect(readCpToolOptions().divisionRatio).toEqual(
      DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.divisionRatio
    );
  });

  it('persists the divide mode together with its operands', () => {
    // Restoring Ratio mode with the ratio reverted to its default is the
    // half-restored state the angle-system pair exists to avoid.
    for (const key of ['divideMode', 'divisionCount', 'divisionRatio'] as const) {
      expect(isPersistedCpToolOption(key)).toBe(true);
    }
  });

  it('names every opted-in key', () => {
    expect(persistedCpToolOptionKeys().sort()).toEqual(
      [
        'angleSystemAngles',
        'angleSystemDivider',
        'divideMode',
        'divisionCount',
        'divisionRatio',
        'fixPrecision',
        'fixPrecisionUse22_5',
        'fixPrecisionUseBp',
        'foldableLineStopsOnAux',
        'lengthenColorMode',
      ].sort()
    );
  });

  describe('reset', () => {
    it('puts the named keys back and leaves the rest', () => {
      const options = {
        ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
        angleSystemDivider: 16,
        polygonCorners: 9,
      };
      const reset = resetCpToolOptions(options, ['angleSystemDivider']);
      expect(reset.angleSystemDivider).toBe(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.angleSystemDivider);
      expect(reset.polygonCorners).toBe(9);
    });

    it('reports whether any of the named keys is non-default', () => {
      const options = { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, angleSystemDivider: 16 };
      expect(hasNonDefaultCpToolOptions(options, ['angleSystemDivider'])).toBe(true);
      expect(hasNonDefaultCpToolOptions(options, ['polygonCorners'])).toBe(false);
      expect(hasNonDefaultCpToolOptions(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, ['fixPrecision'])).toBe(
        false
      );
    });

    it('compares by value, so a changed angle set counts as non-default', () => {
      const options = {
        ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
        angleSystemAngles: [1, 2, 3, 4, 5, 6] as OristudioCpToolAngles,
      };
      expect(hasNonDefaultCpToolOptions(options, ['angleSystemAngles'])).toBe(true);
      expect(
        hasNonDefaultCpToolOptions(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS, ['angleSystemAngles'])
      ).toBe(false);
    });
  });
});

type OristudioCpToolAngles = (typeof DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS)['angleSystemAngles'];
