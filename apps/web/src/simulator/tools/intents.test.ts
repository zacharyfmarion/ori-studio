import { describe, expect, it } from 'vitest';
import { pickQueryFor, pinIntentFor, pullIntentFor } from './intents';
import type { SimulatorGesture } from './types';

const SURFACE = { width: 400, height: 300 };
const THROUGH = { pinThroughLayers: true };
const VISIBLE = { pinThroughLayers: false };

type PinGesture = Exclude<SimulatorGesture, { kind: 'pull' }>;

const box = (extra: Partial<Extract<SimulatorGesture, { kind: 'box' }>> = {}): PinGesture => ({
  kind: 'box',
  rect: { left: 10, top: 20, right: 110, bottom: 220 },
  shift: false,
  touch: false,
  ...extra,
});
const click = (extra: Partial<Extract<SimulatorGesture, { kind: 'click' }>> = {}): PinGesture => ({
  kind: 'click',
  point: { x: 30, y: 40 },
  shift: false,
  touch: false,
  ...extra,
});

describe('pinIntentFor', () => {
  it.each([
    ['box', box(), THROUGH, { gesture: 'box', mode: 'replace', reach: 'all-layers' }],
    ['box, layers off', box(), VISIBLE, { gesture: 'box', mode: 'replace', reach: 'visible' }],
    ['Shift+box', box({ shift: true }), THROUGH, { gesture: 'box', mode: 'add', reach: 'all-layers' }],
    ['finger box', box({ touch: true }), VISIBLE, { gesture: 'box', mode: 'add', reach: 'visible' }],
    ['click', click(), THROUGH, { gesture: 'click', mode: 'replace', reach: 'front' }],
    ['Shift+click', click({ shift: true }), THROUGH, { gesture: 'click', mode: 'toggle', reach: 'front' }],
    ['tap', click({ touch: true }), THROUGH, { gesture: 'tap', mode: 'toggle', reach: 'front' }],
  ] as const)('%s', (_name, gesture, options, expected) => {
    expect(pinIntentFor(gesture, options, SURFACE)).toMatchObject({
      kind: 'pick-faces',
      surface: SURFACE,
      ...expected,
    });
  });

  it('carries the region in canvas CSS pixels', () => {
    expect(pinIntentFor(box(), THROUGH, SURFACE).region).toEqual({
      kind: 'box',
      left: 10,
      top: 20,
      right: 110,
      bottom: 220,
    });
    expect(pinIntentFor(click(), THROUGH, SURFACE).region).toEqual({ kind: 'point', x: 30, y: 40 });
  });
});

describe('pickQueryFor', () => {
  it('asks the renderer the question the intent means, at the size it was asked at', () => {
    expect(pickQueryFor(pinIntentFor(box(), THROUGH, SURFACE))).toEqual({
      region: { kind: 'box', left: 10, top: 20, right: 110, bottom: 220 },
      cssWidth: 400,
      cssHeight: 300,
      depth: 'all-layers',
    });
    expect(pickQueryFor(pinIntentFor(box(), VISIBLE, SURFACE)).depth).toBe('visible');
  });
});

describe('pullIntentFor', () => {
  it('carries each step with the cursor measured against the canvas', () => {
    for (const phase of ['begin', 'move', 'end', 'cancel'] as const) {
      expect(pullIntentFor({ kind: 'pull', phase, point: { x: 30, y: 40 }, touch: true }, SURFACE)).toEqual({
        kind: 'pull',
        phase,
        at: { x: 30, y: 40, cssWidth: 400, cssHeight: 300 },
        touch: true,
      });
    }
  });
});
