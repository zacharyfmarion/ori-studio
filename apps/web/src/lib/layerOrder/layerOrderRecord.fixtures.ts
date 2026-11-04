/**
 * Records for tests. Imported only by `*.test.ts`.
 */
import { LAYER_ORDER_RECORD_VERSION, type LayerOrderRecord } from './layerOrderRecord';

/**
 * A small, synthetic record: three faces of a unit sheet, two constraints and
 * one free pair of the order shown. Its points name no real figure's faces;
 * it is for hosts that only carry, count and save a record.
 */
export function twoConstraintRecord(overrides: Partial<LayerOrderRecord> = {}): LayerOrderRecord {
  return {
    faces: [
      { at: [0.25, 0.25], area: 0.125 },
      { at: [0.75, 0.25], area: 0.125 },
      { at: [0.5, 0.75], area: 0.25 },
    ],
    constraints: [
      [0, 1, 1],
      [2, 1, -1],
    ],
    order: [[0, 2, 1]],
    ...overrides,
  };
}

/** The record's JSON as the encoder writes it, without the budget the encoder holds it to. */
function jsonLength(record: LayerOrderRecord): number {
  return JSON.stringify({ v: LAYER_ORDER_RECORD_VERSION, ...record }).length;
}

/**
 * A record whose JSON is exactly `bytes` long: unit faces, then order pairs
 * between the first two to make up the rest, then the few bytes left over on
 * the first face's area (11, 111, …). A face is 27 bytes and a pair 8, comma
 * included.
 */
export function layerOrderRecordOfSize(bytes: number): LayerOrderRecord {
  const face = { at: [0.5, 0.25] as const, area: 1 };
  const empty = jsonLength({ faces: [], constraints: [], order: [] });
  const faceCount = Math.floor((bytes - empty) / (JSON.stringify(face).length + 1)) - 1;
  const faces = Array.from({ length: faceCount }, () => face);
  // The first pair has no comma before it.
  const pairCount = Math.floor((bytes - jsonLength({ faces, constraints: [], order: [] }) + 1) / 8);
  const record = { faces, constraints: [], order: Array.from({ length: pairCount }, () => [0, 1, 1] as const) };
  const area = Number('1'.repeat(bytes - jsonLength(record) + 1));
  return { ...record, faces: [{ at: face.at, area }, ...faces.slice(1)] };
}
