import { describe, expect, it } from 'vitest';
import {
  EMPTY_CP_MEASURE_SESSION,
  cpMeasureSessionIsEmpty,
  redoCpMeasurement,
  releasedCpMeasureRedo,
  takeCpMeasurement,
  undoCpMeasurement,
} from './measureSession';
import type { CpMeasurement } from './measure';

function reading(value: number): CpMeasurement {
  return {
    kind: 'distance',
    value,
    points: [
      { x: 0, y: 0 },
      { x: value, y: 0 },
    ],
  };
}

describe('takeCpMeasurement', () => {
  it('appends oldest-first, which is the order the list is read in', () => {
    const session = takeCpMeasurement(takeCpMeasurement(EMPTY_CP_MEASURE_SESSION, reading(1)), reading(2));
    expect(session.taken.map((entry) => entry.value)).toEqual([1, 2]);
  });

  it('clears the redo stack — a new reading is a new action', () => {
    const two = takeCpMeasurement(takeCpMeasurement(EMPTY_CP_MEASURE_SESSION, reading(1)), reading(2));
    const undone = undoCpMeasurement(two);
    expect(undone?.undone).toHaveLength(1);
    expect(takeCpMeasurement(undone!, reading(3)).undone).toEqual([]);
  });
});

describe('undoCpMeasurement', () => {
  it('takes back the newest reading', () => {
    const two = takeCpMeasurement(takeCpMeasurement(EMPTY_CP_MEASURE_SESSION, reading(1)), reading(2));
    const next = undoCpMeasurement(two);
    expect(next?.taken.map((entry) => entry.value)).toEqual([1]);
    expect(next?.undone.map((entry) => entry.value)).toEqual([2]);
  });

  it('is null with nothing to take back, so the caller can fall through to the document', () => {
    expect(undoCpMeasurement(EMPTY_CP_MEASURE_SESSION)).toBeNull();
  });

  it('stacks newest-undone first', () => {
    let session = takeCpMeasurement(EMPTY_CP_MEASURE_SESSION, reading(1));
    session = takeCpMeasurement(session, reading(2));
    session = undoCpMeasurement(session)!;
    session = undoCpMeasurement(session)!;
    expect(session.taken).toEqual([]);
    expect(session.undone.map((entry) => entry.value)).toEqual([1, 2]);
  });
});

describe('redoCpMeasurement', () => {
  it('mirrors undo exactly, one reading at a time', () => {
    let session = takeCpMeasurement(EMPTY_CP_MEASURE_SESSION, reading(1));
    session = takeCpMeasurement(session, reading(2));
    session = undoCpMeasurement(session)!;
    session = undoCpMeasurement(session)!;
    session = redoCpMeasurement(session)!;
    expect(session.taken.map((entry) => entry.value)).toEqual([1]);
    session = redoCpMeasurement(session)!;
    expect(session.taken.map((entry) => entry.value)).toEqual([1, 2]);
    expect(session.undone).toEqual([]);
  });

  it('is null with nothing to put back', () => {
    expect(redoCpMeasurement(EMPTY_CP_MEASURE_SESSION)).toBeNull();
    expect(redoCpMeasurement(takeCpMeasurement(EMPTY_CP_MEASURE_SESSION, reading(1)))).toBeNull();
  });
});

describe('releasedCpMeasureRedo', () => {
  it('drops the redo stack so a document redo is not shadowed by a stepped-past reading', () => {
    const undone = undoCpMeasurement(takeCpMeasurement(EMPTY_CP_MEASURE_SESSION, reading(1)))!;
    expect(releasedCpMeasureRedo(undone)).toEqual({ taken: [], undone: [] });
  });

  it('returns the same object when there is nothing to drop, so a no-op writes no state', () => {
    const session = takeCpMeasurement(EMPTY_CP_MEASURE_SESSION, reading(1));
    expect(releasedCpMeasureRedo(session)).toBe(session);
  });
});

describe('cpMeasureSessionIsEmpty', () => {
  it('counts undone readings too — a session with a redo left is still live', () => {
    expect(cpMeasureSessionIsEmpty(EMPTY_CP_MEASURE_SESSION)).toBe(true);
    const undone = undoCpMeasurement(takeCpMeasurement(EMPTY_CP_MEASURE_SESSION, reading(1)))!;
    expect(cpMeasureSessionIsEmpty(undone)).toBe(false);
  });
});
