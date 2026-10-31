import { describe, expect, it } from 'vitest';
import { createSimulatorRateMeter } from './simulatorRate';

describe('createSimulatorRateMeter', () => {
  it('reports steps and frames per second once a window closes', () => {
    const meter = createSimulatorRateMeter(1000);
    expect(meter.observe(80, 0)).toBeNull();
    for (let i = 1; i < 60; i += 1) expect(meter.observe(80, (i * 1000) / 60)).toBeNull();
    const rate = meter.observe(80, 1000);
    expect(rate?.framesPerSecond).toBeCloseTo(60);
    expect(rate?.stepsPerSecond).toBeCloseTo(4800);
  });

  it('counts a redraw as a frame with no steps', () => {
    const meter = createSimulatorRateMeter(1000);
    meter.observe(0, 0);
    meter.observe(0, 500);
    expect(meter.observe(0, 1000)).toEqual({ stepsPerSecond: 0, framesPerSecond: 2 });
  });

  it('starts a fresh window after a reset', () => {
    const meter = createSimulatorRateMeter(1000);
    meter.observe(80, 0);
    meter.observe(80, 900);
    meter.reset();
    expect(meter.observe(80, 1000)).toBeNull();
    expect(meter.observe(40, 2000)).toEqual({ stepsPerSecond: 40, framesPerSecond: 1 });
  });
});
