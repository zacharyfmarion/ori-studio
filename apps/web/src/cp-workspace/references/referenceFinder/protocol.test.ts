import { describe, expect, it } from 'vitest';
import {
  DATABASE_SETTINGS_LENGTH,
  DEFAULT_DATABASE_SETTINGS,
  DEFAULT_QUERY_SETTINGS,
  ReferenceFinderProtocolError,
  databaseKey,
  encodeDatabaseSettings,
  encodeLineQuery,
  encodePointQuery,
  isReadyLine,
  parseProgressLine,
  parseSolutionLine,
  querySettingsKey,
} from './protocol';
import lineExact from './__fixtures__/line-exact.json';

describe('encodeDatabaseSettings', () => {
  it('produces the 24 numbers readDbSettings() reads, in its order', () => {
    // useDatabase, forceRebuild, width, height, maxRank, maxLines, maxMarks,
    // seven axiom slots, useDivision, numX, numY, numA, numD, minAspectRatio,
    // minAngleSine, visibility, seed marks, seed lines.
    expect(encodeDatabaseSettings(DEFAULT_DATABASE_SETTINGS)).toEqual([
      0, 0, 1, 1, 6, 600000, 600000, 2, 3, 7, 6, 5, 4, 1, 1, 5000, 5000, 5000, 5000, 0.1, 0.342, 1,
      0, 0,
    ]);
    expect(encodeDatabaseSettings(DEFAULT_DATABASE_SETTINGS)).toHaveLength(DATABASE_SETTINGS_LENGTH);
  });

  it('matches the vector the fixtures were captured with', () => {
    // capture.mjs sends its own copy of the vector; the two must never drift.
    expect(encodeDatabaseSettings(lineExact.database)).toEqual(
      encodeDatabaseSettings(DEFAULT_DATABASE_SETTINGS)
    );
  });

  it('encodes booleans as 0/1 and a rectangular sheet as given', () => {
    const encoded = encodeDatabaseSettings({
      ...DEFAULT_DATABASE_SETTINGS,
      width: 2,
      height: 1.5,
      useDivision: false,
      visibility: false,
    });
    expect(encoded.slice(2, 4)).toEqual([2, 1.5]);
    expect(encoded[14]).toBe(0);
    expect(encoded[21]).toBe(0);
  });

  it('refuses settings the core would misread', () => {
    expect(() => encodeDatabaseSettings({ ...DEFAULT_DATABASE_SETTINGS, width: 0 })).toThrow(
      ReferenceFinderProtocolError
    );
    expect(() =>
      encodeDatabaseSettings({ ...DEFAULT_DATABASE_SETTINGS, axiomPriority: [2, 3, 7] })
    ).toThrow(/7 slots/);
    expect(() =>
      encodeDatabaseSettings({ ...DEFAULT_DATABASE_SETTINGS, axiomPriority: [2, 3, 7, 6, 5, 4, 8] })
    ).toThrow(/axiom 1-7/);
    expect(() =>
      encodeDatabaseSettings({ ...DEFAULT_DATABASE_SETTINGS, maxRank: Number.NaN })
    ).toThrow(ReferenceFinderProtocolError);
  });
});

describe('query encoders', () => {
  it('encodes a point query as [1, goodEnoughError, count, worstCase, x, y]', () => {
    expect(encodePointQuery(0.25, 0.75)).toEqual([1, 1e-9, 5, 1, 0.25, 0.75]);
    expect(encodePointQuery(0.5, 0.5, { goodEnoughError: 0.005, count: 3, worstCase: 0 })).toEqual([
      1, 0.005, 3, 0, 0.5, 0.5,
    ]);
  });

  it('encodes a line query as [2, goodEnoughError, count, worstCase, x1, y1, x2, y2]', () => {
    expect(encodeLineQuery(0, 0.25, 1, 0.25)).toEqual([2, 1e-9, 5, 1, 0, 0.25, 1, 0.25]);
  });

  it('refuses query settings the core would misread', () => {
    expect(() => encodePointQuery(0, 0, { ...DEFAULT_QUERY_SETTINGS, count: 0 })).toThrow(
      ReferenceFinderProtocolError
    );
    expect(() => encodePointQuery(0, 0, { ...DEFAULT_QUERY_SETTINGS, worstCase: 2 })).toThrow(
      /worstCase/
    );
    expect(() => encodeLineQuery(0, 0, Number.POSITIVE_INFINITY, 1)).toThrow(/x2/);
  });
});

describe('line classifiers', () => {
  it('recognises only the bare Ready prompt', () => {
    expect(isReadyLine('Ready')).toBe(true);
    expect(isReadyLine('Ready ')).toBe(false);
    expect(isReadyLine('Initializing using O2, O3, O7, O6, O5, O4, O1, vis=true')).toBe(false);
  });

  it('reads a progress line and ignores the banner', () => {
    expect(parseProgressLine('{"rank": 6, "lines": 600000, "marks": 598712}')).toEqual({
      rank: 6,
      lines: 600000,
      marks: 598712,
    });
    expect(parseProgressLine('ReferenceFinder 4.8.1 (build 20260402)')).toBeNull();
    expect(parseProgressLine('{"solution":[0.5,0.5],"err":0}')).toBeNull();
  });

  it('reads a solution line and nothing else', () => {
    const line = JSON.stringify(lineExact.solutions[0]);
    const parsed = parseSolutionLine(line);
    expect(parsed?.rank).toBe(2);
    expect(parsed?.steps).toHaveLength(3);
    expect(parseSolutionLine('Ready')).toBeNull();
    expect(parseSolutionLine('{"rank": 6, "lines": 1, "marks": 1}')).toBeNull();
  });

  it('refuses a { line that is neither progress nor a solution', () => {
    expect(() => parseSolutionLine('{"something":1}')).toThrow(ReferenceFinderProtocolError);
    expect(() => parseSolutionLine('{not json')).toThrow(/not JSON/);
    expect(() => parseProgressLine('{"rank": "six"}')).toThrow(/progress/);
  });
});

describe('databaseKey', () => {
  it('is stable for equal settings and names every build-time setting', () => {
    const key = databaseKey(DEFAULT_DATABASE_SETTINGS);
    expect(databaseKey({ ...DEFAULT_DATABASE_SETTINGS })).toBe(key);
    expect(databaseKey(lineExact.database)).toBe(key);
    expect(key).toBe(
      'rf1|w=1|h=1|rank=6|lines=600000|marks=600000|ax=2,3,7,6,5,4,1|div=1|nx=5000|ny=5000|na=5000|nd=5000|ar=0.1|sin=0.342|vis=1'
    );
  });

  it('changes with any setting that changes the database', () => {
    const base = databaseKey(DEFAULT_DATABASE_SETTINGS);
    const variants: Array<Partial<typeof DEFAULT_DATABASE_SETTINGS>> = [
      { width: 2 },
      { height: 0.5 },
      { maxRank: 5 },
      { maxLines: 1 },
      { maxMarks: 1 },
      { axiomPriority: [1, 2, 3, 4, 5, 6, 7] },
      { useDivision: false },
      { numX: 1 },
      { numY: 1 },
      { numA: 1 },
      { numD: 1 },
      { minAspectRatio: 0.2 },
      { minAngleSine: 0.5 },
      { visibility: false },
    ];
    const keys = new Set(variants.map((v) => databaseKey({ ...DEFAULT_DATABASE_SETTINGS, ...v })));
    expect(keys.size).toBe(variants.length);
    expect(keys.has(base)).toBe(false);
  });

  it('rounds the sheet size to 1e-6 so float noise does not fork databases', () => {
    expect(databaseKey({ ...DEFAULT_DATABASE_SETTINGS, width: 1 + 1e-9 })).toBe(
      databaseKey(DEFAULT_DATABASE_SETTINGS)
    );
    expect(databaseKey({ ...DEFAULT_DATABASE_SETTINGS, width: 1 + 1e-5 })).not.toBe(
      databaseKey(DEFAULT_DATABASE_SETTINGS)
    );
  });

  it('keys query settings separately', () => {
    expect(querySettingsKey(DEFAULT_QUERY_SETTINGS)).toBe('e=1e-9|n=5|wc=1');
    expect(querySettingsKey(lineExact.search)).toBe(querySettingsKey(DEFAULT_QUERY_SETTINGS));
  });
});
