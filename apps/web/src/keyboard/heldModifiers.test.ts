import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearHeldModifiers,
  installHeldModifierTracker,
  readHeldModifiers,
  subscribeHeldModifiers,
  syncHeldModifiersFromEvent,
} from './heldModifiers';

function pressControl() {
  return new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true });
}

/** A `keyup` for Control reports `ctrlKey: false` -- the state *after* the event. */
function releaseControl() {
  return new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true });
}

describe('held modifiers', () => {
  const uninstalls: Array<() => void> = [];

  function install() {
    const uninstall = installHeldModifierTracker(window);
    uninstalls.push(uninstall);
    return uninstall;
  }

  afterEach(() => {
    while (uninstalls.length > 0) uninstalls.pop()?.();
    clearHeldModifiers();
    document.body.innerHTML = '';
  });

  it('tracks Control down and up', () => {
    install();

    window.dispatchEvent(pressControl());
    expect(readHeldModifiers().ctrl).toBe(true);

    window.dispatchEvent(releaseControl());
    expect(readHeldModifiers().ctrl).toBe(false);
  });

  it('notifies subscribers on transitions only, so auto-repeat is free', () => {
    install();
    const onChange = vi.fn();
    const unsubscribe = subscribeHeldModifiers(onChange);

    window.dispatchEvent(pressControl());
    expect(onChange).toHaveBeenCalledTimes(1);

    // Auto-repeat: same modifier state, so no listener runs.
    window.dispatchEvent(pressControl());
    window.dispatchEvent(pressControl());
    expect(onChange).toHaveBeenCalledTimes(1);

    window.dispatchEvent(releaseControl());
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(pressControl());
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('clears on window blur, where no keyup will arrive', () => {
    install();
    window.dispatchEvent(pressControl());
    expect(readHeldModifiers().ctrl).toBe(true);

    window.dispatchEvent(new Event('blur'));
    expect(readHeldModifiers().ctrl).toBe(false);
  });

  it('clears when the document is hidden', () => {
    install();
    window.dispatchEvent(pressControl());

    document.dispatchEvent(new Event('visibilitychange'));
    expect(readHeldModifiers().ctrl).toBe(false);
  });

  describe('editing targets', () => {
    function focusedInput() {
      const input = document.createElement('input');
      document.body.append(input);
      return input;
    }

    it('ignores keydown from a text field, so typing does not strobe the rail', () => {
      install();
      const input = focusedInput();

      input.dispatchEvent(pressControl());
      expect(readHeldModifiers().ctrl).toBe(false);
    });

    it('still accepts keyup from a text field, so the flag cannot latch on', () => {
      install();
      window.dispatchEvent(pressControl());
      expect(readHeldModifiers().ctrl).toBe(true);

      // Focus moved into a field while the modifier was down; the release must
      // still register or nothing is left to clear it.
      focusedInput().dispatchEvent(releaseControl());
      expect(readHeldModifiers().ctrl).toBe(false);
    });
  });

  it('adopts modifier state from a pointer event (the Canvas.java:245 resync)', () => {
    install();
    // Control went down while the window was not focused, so no keydown arrived.
    expect(readHeldModifiers().ctrl).toBe(false);

    syncHeldModifiersFromEvent({
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    });
    expect(readHeldModifiers().ctrl).toBe(true);
  });

  it('tracks the other modifiers independently', () => {
    install();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, altKey: true, bubbles: true })
    );

    const state = readHeldModifiers();
    expect(state.shift).toBe(true);
    expect(state.alt).toBe(true);
    expect(state.ctrl).toBe(false);
    expect(state.meta).toBe(false);
  });

  it('stops tracking and resets after uninstall', () => {
    const uninstall = install();
    window.dispatchEvent(pressControl());
    expect(readHeldModifiers().ctrl).toBe(true);

    uninstall();
    expect(readHeldModifiers().ctrl).toBe(false);

    window.dispatchEvent(pressControl());
    expect(readHeldModifiers().ctrl).toBe(false);
  });
});
