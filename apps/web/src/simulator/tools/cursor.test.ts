import { describe, expect, it } from 'vitest';
import { simulatorCanvasCursor } from './cursor';

describe('simulatorCanvasCursor', () => {
  it('shows the tool’s own cursor at rest', () => {
    expect(simulatorCanvasCursor({ tool: 'crosshair', orbiting: false, pulling: false, refused: false, navigateModifierHeld: false })).toBe(
      'crosshair'
    );
    expect(simulatorCanvasCursor({ tool: 'grab', orbiting: false, pulling: false, refused: false, navigateModifierHeld: false })).toBe('grab');
  });

  it('promises an orbit while Meta is held, under any tool', () => {
    expect(simulatorCanvasCursor({ tool: 'crosshair', orbiting: false, pulling: false, refused: false, navigateModifierHeld: true })).toBe(
      'grab'
    );
  });

  it('keeps the closed hand while an orbit is in flight', () => {
    expect(simulatorCanvasCursor({ tool: 'crosshair', orbiting: true, pulling: false, refused: false, navigateModifierHeld: false })).toBe(
      'grabbing'
    );
    expect(simulatorCanvasCursor({ tool: 'crosshair', orbiting: true, pulling: false, refused: false, navigateModifierHeld: true })).toBe(
      'grabbing'
    );
  });

  it('closes the hand on a pull in flight, whatever else is true', () => {
    expect(
      simulatorCanvasCursor({ tool: 'grab', orbiting: false, pulling: true, refused: false, navigateModifierHeld: true })
    ).toBe('grabbing');
  });

  it('says a press would be refused, unless Meta promises an orbit instead', () => {
    expect(
      simulatorCanvasCursor({ tool: 'grab', orbiting: false, pulling: false, refused: true, navigateModifierHeld: false })
    ).toBe('not-allowed');
    expect(
      simulatorCanvasCursor({ tool: 'grab', orbiting: false, pulling: false, refused: true, navigateModifierHeld: true })
    ).toBe('grab');
  });
});
