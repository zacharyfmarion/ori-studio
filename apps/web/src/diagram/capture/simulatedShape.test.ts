import { describe, expect, it } from 'vitest';
import { encodeSimulatorShapeState } from '../../simulator/simulatorShape';
import { savedShapeOf, simulatorShapeOf, storedSimulatedShape } from './simulatedShape';

const STATE = new Float32Array([0.5, -0.125, 3, 1.25]);
const READ = { sheet: 'sk1:sheet', pins: [], posed: false, state: STATE };

describe('a simulated step’s saved positions', () => {
  it('store what Pose read, settled or not, and put the same floats back', () => {
    const saved = storedSimulatedShape(READ, false)!;
    expect(saved).toEqual({ sheet: 'sk1:sheet', state: encodeSimulatorShapeState(STATE), settled: false });
    expect(simulatorShapeOf(saved)).toEqual({ sheet: 'sk1:sheet', pins: [], posed: false, state: STATE });
    expect(savedShapeOf(saved)?.settled).toBe(false);
    expect(savedShapeOf(storedSimulatedShape(READ, true))?.settled).toBe(true);
  });

  it('store nothing for a model that keeps no shape, nor one pinned or posed', () => {
    expect(storedSimulatedShape('ambiguous', true)).toBeUndefined();
    expect(storedSimulatedShape('too-large', true)).toBeUndefined();
    expect(storedSimulatedShape('pulling', true)).toBeUndefined();
    expect(storedSimulatedShape({ ...READ, pins: [[0, 0, 0]] }, true)).toBeUndefined();
    expect(storedSimulatedShape({ ...READ, posed: true }, true)).toBeUndefined();
  });

  it('read as settled when unsaid', () => {
    const { settled: _settled, ...unsaid } = storedSimulatedShape(READ, false)!;
    expect(savedShapeOf(unsaid)?.settled).toBe(true);
  });

  it('are not read when another build’s: other fields, encodings or damage', () => {
    const saved = storedSimulatedShape(READ, true)!;
    expect(savedShapeOf(undefined)).toBeNull();
    // A build with Pose's tools (decision 5): carried, never put back here.
    expect(savedShapeOf({ ...saved, pins: [[0.25, 0.5]], posed: true, id: 'shape-1' })).toBeNull();
    expect(savedShapeOf({ ...saved, sheet: 'sk2:sheet' })).toBeNull();
    expect(savedShapeOf({ ...saved, state: 'ss2:AAAA' })).toBeNull();
    expect(savedShapeOf({ ...saved, settled: 'no' })).toBeNull();
    expect(savedShapeOf({ ...saved, state: 7 })).toBeNull();
    // Readable, but its state does not decode: nothing to open on.
    expect(simulatorShapeOf({ ...saved, state: 'ss1:AAA' })).toBeNull();
  });
});
