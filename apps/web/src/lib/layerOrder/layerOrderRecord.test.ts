import { describe, expect, it } from 'vitest';
import { NEWER } from '../documentFile';
import {
  LAYER_ORDER_RECORD_MAX_BYTES,
  encodeLayerOrderRecord,
  readLayerOrderRecord,
  type LayerOrderRecord,
} from './layerOrderRecord';
import { layerOrderRecordOfSize } from './layerOrderRecord.fixtures';

/** Two constraints over three faces, and the one free pair the order shown settled. */
const RECORD: LayerOrderRecord = {
  faces: [
    { at: [0.25, 0.75], area: 0.125 },
    { at: [0.6, 0.4], area: 0.25 },
    { at: [-3.5, 12], area: 7.5 },
  ],
  constraints: [
    [0, 1, 1],
    [2, 0, -1],
  ],
  order: [[1, 2, -1]],
};

function encoded(record: LayerOrderRecord): string {
  const result = encodeLayerOrderRecord(record);
  if (!result.ok) throw new Error(`expected the record to encode: ${result.reason}`);
  return result.json;
}

/** A stored record's parsed value, loosely typed, for fixtures that reshape it. */
type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The stored string with `patch` applied to its parsed value. */
function patched(patch: (value: Stored) => void): string {
  const value = JSON.parse(encoded(RECORD)) as Stored;
  patch(value);
  return JSON.stringify(value);
}

describe('a layer order record', () => {
  it('is one compact string, version first and its fields in a fixed order', () => {
    expect(encoded(RECORD)).toBe(
      '{"v":1,"faces":[{"at":[0.25,0.75],"area":0.125},{"at":[0.6,0.4],"area":0.25},{"at":[-3.5,12],"area":7.5}],' +
        '"constraints":[[0,1,1],[2,0,-1]],"order":[[1,2,-1]]}'
    );
  });

  it('reads back as it was written, byte for byte', () => {
    const json = encoded(RECORD);
    const read = readLayerOrderRecord(json);
    expect(read).toEqual({ ok: true, record: RECORD, json });
    // And whatever key order it was stored in, it is held as this build writes it.
    const shuffled = JSON.stringify({ order: [[1, 2, -1]], v: 1, constraints: RECORD.constraints, faces: RECORD.faces });
    expect(readLayerOrderRecord(shuffled)).toEqual({ ok: true, record: RECORD, json });
  });

  it('writes its attention last, and only when it has one', () => {
    const flagged: LayerOrderRecord = { ...RECORD, attention: { reason: 'conflict', count: 2 } };
    const json = encoded(flagged);
    expect(json.endsWith(',"attention":{"reason":"conflict","count":2}}')).toBe(true);
    expect(readLayerOrderRecord(json)).toEqual({ ok: true, record: flagged, json });
    expect(encoded(RECORD)).not.toMatch(/attention/);
  });

  it('holds a record with no constraints: an order browsed to and applied (D16)', () => {
    const browsed: LayerOrderRecord = { faces: RECORD.faces, constraints: [], order: RECORD.order };
    expect(readLayerOrderRecord(encoded(browsed))).toMatchObject({ ok: true, record: browsed });
  });

  it.each<[string, (value: Stored) => void]>([
    ['a later version', (value) => (value.v = 2)],
    ['a field it has no name for', (value) => (value.chosenBy = 'count')],
    ['a field of a face', (value) => (value.faces[1].normal = [0, 0, 1])],
    ['a field of its attention', (value) => (value.attention = { reason: 'conflict', count: 1, rows: [0] })],
    ['an attention reason', (value) => (value.attention = { reason: 'stale-paper', count: 1 })],
    // A later build may mean something by what reads here as damage: its record is carried, not dropped.
    [
      'a field beside damage',
      (value) => {
        value.faces[0].area = 0;
        value.faces[1].normal = [0, 0, 1];
      },
    ],
  ])('is a newer build’s when it holds %s', (_label, patch) => {
    expect(readLayerOrderRecord(patched(patch))).toBe(NEWER);
  });

  it('is a newer build’s when it is more than this build keeps', () => {
    expect(readLayerOrderRecord(' '.repeat(LAYER_ORDER_RECORD_MAX_BYTES + 1))).toBe(NEWER);
  });

  it.each<[string, () => unknown, string]>([
    ['not a string', () => ({ faces: [] }), 'not-text'],
    ['not JSON', () => '{"v":1,', 'not-json'],
    ['a list', () => '[1]', 'record'],
    ['no version', () => patched((value) => delete value.v), 'version'],
    ['a version of none', () => patched((value) => (value.v = 0)), 'version'],
    ['a version that is no whole number', () => patched((value) => (value.v = 1.5)), 'version'],
    ['faces that are no list', () => patched((value) => (value.faces = {})), 'faces'],
    ['a point that is no number', () => patched((value) => (value.faces[0].at = [0, null])), 'faces'],
    ['a point of three numbers', () => patched((value) => (value.faces[0].at = [0, 1, 2])), 'faces'],
    ['a face of no area', () => patched((value) => (value.faces[2].area = 0)), 'faces'],
    ['a face of a negative area', () => patched((value) => (value.faces[2].area = -1)), 'faces'],
    ['a constraint past the faces', () => patched((value) => (value.constraints[0] = [0, 3, 1])), 'constraints'],
    ['a constraint on one face', () => patched((value) => (value.constraints[0] = [1, 1, 1])), 'constraints'],
    ['a constraint with no sign', () => patched((value) => (value.constraints[0] = [0, 1, 0])), 'constraints'],
    ['a constraint of four', () => patched((value) => (value.constraints[0] = [0, 1, 1, 1])), 'constraints'],
    ['a face index that is no whole number', () => patched((value) => (value.order[0] = [0.5, 1, 1])), 'order'],
    ['an order that is no list', () => patched((value) => (value.order = 'free')), 'order'],
    ['an attention that is no record', () => patched((value) => (value.attention = 'conflict')), 'attention'],
    ['an attention with no count', () => patched((value) => (value.attention = { reason: 'conflict' })), 'attention'],
    ['an attention of a negative count', () => patched((value) => (value.attention = { reason: 'timeout', count: -1 })), 'attention'],
  ])('is damaged when it is %s', (_label, stored, damage) => {
    expect(readLayerOrderRecord(stored())).toEqual({ ok: false, damage });
  });

  it('refuses to write a record that would not read back, naming the part', () => {
    expect(encodeLayerOrderRecord({ ...RECORD, order: [[0, 9, 1]] })).toEqual({ ok: false, reason: 'invalid', part: 'order' });
    expect(encodeLayerOrderRecord({ ...RECORD, faces: [{ at: [Number.NaN, 0], area: 1 }] })).toEqual({
      ok: false,
      reason: 'invalid',
      part: 'faces',
    });
  });
});

describe('the record budget', () => {
  it('writes a record of exactly the budget, and reads it back', () => {
    const record = layerOrderRecordOfSize(LAYER_ORDER_RECORD_MAX_BYTES);
    const json = encoded(record);
    expect(json.length).toBe(LAYER_ORDER_RECORD_MAX_BYTES);
    const read = readLayerOrderRecord(json);
    expect(read !== NEWER && read.ok && read.json).toBe(json);
  });

  it('refuses one byte more, saying how far over it is', () => {
    const record = layerOrderRecordOfSize(LAYER_ORDER_RECORD_MAX_BYTES + 1);
    expect(encodeLayerOrderRecord(record)).toEqual({
      ok: false,
      reason: 'over-budget',
      bytes: LAYER_ORDER_RECORD_MAX_BYTES + 1,
      budget: LAYER_ORDER_RECORD_MAX_BYTES,
    });
  });
});
