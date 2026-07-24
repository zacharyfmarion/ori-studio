import { describe, expect, it, vi } from 'vitest';
import { handleShortcutKeyDown } from './shortcutDispatcher';

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
