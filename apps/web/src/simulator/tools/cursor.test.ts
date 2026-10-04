import { describe, expect, it } from 'vitest';
import { simulatorCanvasCursor } from './cursor';

describe('simulatorCanvasCursor', () => {
  it('shows the tool’s own cursor at rest', () => {
    expect(simulatorCanvasCursor({ tool: 'crosshair', orbiting: false, navigateModifierHeld: false })).toBe(
      'crosshair'
    );
    expect(simulatorCanvasCursor({ tool: 'grab', orbiting: false, navigateModifierHeld: false })).toBe('grab');
  });

  it('promises an orbit while Meta is held, under any tool', () => {
    expect(simulatorCanvasCursor({ tool: 'crosshair', orbiting: false, navigateModifierHeld: true })).toBe(
      'grab'
    );
  });

  it('keeps the closed hand while an orbit is in flight', () => {
    expect(simulatorCanvasCursor({ tool: 'crosshair', orbiting: true, navigateModifierHeld: false })).toBe(
      'grabbing'
    );
    expect(simulatorCanvasCursor({ tool: 'crosshair', orbiting: true, navigateModifierHeld: true })).toBe(
      'grabbing'
    );
  });
});
