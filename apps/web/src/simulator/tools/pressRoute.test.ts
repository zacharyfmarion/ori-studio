import { describe, expect, it } from 'vitest';
import { boxGestureEngine } from './engines/boxGesture';
import { pullGestureEngine } from './engines/pullGesture';
import { routeSimulatorPress, type SimulatorPress } from './pressRoute';

function press(extra: Partial<SimulatorPress> = {}): SimulatorPress {
  return { button: 0, contextClick: false, meta: false, shift: false, ...extra };
}

describe('routeSimulatorPress', () => {
  it('leaves the secondary button and a Mac Ctrl-click to the context menu, under any tool', () => {
    for (const input of ['orbit', 'pick-faces'] as const) {
      expect(routeSimulatorPress(press({ button: 2 }), input)).toEqual({ kind: 'menu' });
      expect(routeSimulatorPress(press({ contextClick: true }), input)).toEqual({ kind: 'menu' });
    }
  });

  it('orbits on the middle button and on Meta whatever the tool, and rolls with Shift', () => {
    expect(routeSimulatorPress(press({ button: 1 }), 'pick-faces')).toEqual({ kind: 'orbit', mode: 'orbit' });
    expect(routeSimulatorPress(press({ meta: true }), 'pick-faces')).toEqual({ kind: 'orbit', mode: 'orbit' });
    expect(routeSimulatorPress(press({ meta: true, shift: true }), 'pick-faces')).toEqual({
      kind: 'orbit',
      mode: 'roll',
    });
    expect(routeSimulatorPress(press({ button: 1, shift: true }), 'orbit')).toEqual({ kind: 'orbit', mode: 'roll' });
  });

  it('hands a plain press to the tool', () => {
    expect(routeSimulatorPress(press(), 'orbit')).toEqual({ kind: 'orbit', mode: 'orbit' });
    expect(routeSimulatorPress(press({ shift: true }), 'orbit')).toEqual({ kind: 'orbit', mode: 'roll' });
    expect(routeSimulatorPress(press(), 'pick-faces')).toEqual({ kind: 'gesture', engine: boxGestureEngine });
    // Shift is the Pin tool's to read, not a roll.
    expect(routeSimulatorPress(press({ shift: true }), 'pick-faces')).toEqual({
      kind: 'gesture',
      engine: boxGestureEngine,
    });
  });

  it('hands a pull its engine, which takes hold of the paper', () => {
    expect(routeSimulatorPress(press(), 'pull')).toEqual({
      kind: 'gesture',
      engine: pullGestureEngine,
      grabsPaper: true,
    });
    // Meta still orbits under Pull, as under every tool.
    expect(routeSimulatorPress(press({ meta: true }), 'pull')).toEqual({ kind: 'orbit', mode: 'orbit' });
  });

  it('ignores the buttons nothing answers', () => {
    expect(routeSimulatorPress(press({ button: 3 }), 'orbit')).toEqual({ kind: 'ignore' });
    expect(routeSimulatorPress(press({ button: 4 }), 'pick-faces')).toEqual({ kind: 'ignore' });
  });
});
