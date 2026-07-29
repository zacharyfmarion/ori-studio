import { describe, expect, it, vi } from 'vitest';
import { handleShortcutKeyDown } from './shortcutDispatcher';
import { SHORTCUT_DEFINITIONS } from './shortcuts';

describe('shortcut dispatcher', () => {
  it('runs scoped CP shortcuts before global shortcuts', () => {
    const cpAction = vi.fn();
    const menu = vi.fn();
    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(
      handleShortcutKeyDown(event, {
        scopeStack: ['crease-pattern', 'global'],
        executors: { cpAction, menu },
      })
    ).toBe(true);

    expect(cpAction).toHaveBeenCalledWith('cp.action.inward');
    expect(menu).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('skips disabled shortcuts', () => {
    const cpAction = vi.fn();
    // `a` is the mountain line type; clearing its override leaves the key unbound.
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });

    expect(
      handleShortcutKeyDown(event, {
        scopeStack: ['crease-pattern'],
        overrides: { 'cp.action.line-type.mountain': null },
        executors: { cpAction },
      })
    ).toBe(false);

    expect(cpAction).not.toHaveBeenCalled();
  });
});

describe('simulator scope', () => {
  // A focused simulation and the crease-pattern tools want the same keys. The
  // scope stack is what arbitrates: `simulator` sits ahead of `crease-pattern`,
  // and is only present while a simulation actually holds the keyboard.
  const scopedStack = ['simulator', 'viewport', 'crease-pattern', 'global'] as const;
  const editStack = ['viewport', 'crease-pattern', 'global'] as const;

  function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  }

  it.each([
    ['f', 'simulator.toggleFaces'],
    ['c', 'simulator.toggleCreases'],
    ['r', 'simulator.replay'],
    ['l', 'simulator.toggleLighting'],
    [' ', 'simulator.playPause'],
  ])('routes %s to the simulation while it is focused', (key, expected) => {
    const simulator = vi.fn();
    const cpAction = vi.fn();

    expect(
      handleShortcutKeyDown(press(key), {
        scopeStack: [...scopedStack],
        executors: { simulator, cpAction },
      })
    ).toBe(true);

    expect(simulator).toHaveBeenCalledWith(expected);
    expect(cpAction).not.toHaveBeenCalled();
  });

  /** What the crease-pattern scope binds a bare key to, per the live registry. */
  function cpActionFor(key: string): string | undefined {
    return SHORTCUT_DEFINITIONS.find(
      (definition) =>
        definition.scope === 'crease-pattern' &&
        definition.defaultChords.some(
          (chord) => chord.key === key && !chord.primary && !chord.shift && !chord.alt
        )
    )?.id;
  }

  it.each([' ', 'f', 'c', 'r'])(
    'leaves %s to the crease-pattern tool when no simulation is focused',
    (key) => {
      const cpAction = vi.fn();
      // Chords normalize the space bar to the name, not the character.
      const expected = cpActionFor(key === ' ' ? 'space' : key);
      expect(expected, `${key} should still be a CP binding`).toBeDefined();

      handleShortcutKeyDown(press(key), {
        scopeStack: [...editStack],
        executors: { cpAction },
      });

      expect(cpAction).toHaveBeenCalledWith(expected);
    }
  );

  it('falls through when the simulator scope is present but nothing claimed it', () => {
    const cpAction = vi.fn();

    // The scope can outlive its executor for a frame. Falling through means the
    // CP tools merely stop being shadowed, rather than going dead.
    handleShortcutKeyDown(press('f'), {
      scopeStack: [...scopedStack],
      executors: { cpAction },
    });

    expect(cpAction).toHaveBeenCalledWith(cpActionFor('f'));
  });
});
