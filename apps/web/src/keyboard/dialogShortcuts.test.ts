import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleDialogShortcutKeyDown,
  registerModalHistory,
  runModalHistory,
  type ModalHistory,
} from './dialogShortcuts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  document.body.innerHTML = '';
});

/** What `useModalDialog` renders for a dialog that owns every key, appended on top of any already open. */
function openDialog(): HTMLElement {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('data-shortcut-barrier', '');
  dialog.innerHTML = '<div role="document" tabindex="-1"></div>';
  document.body.append(dialog);
  return dialog;
}

/** A history with `past` steps to undo and `future` steps to redo. */
function historyOf(past: number, future = 0) {
  const state = { past, future };
  const history = {
    undo: vi.fn(() => {
      state.past -= 1;
      state.future += 1;
    }),
    redo: vi.fn(() => {
      state.future -= 1;
      state.past += 1;
    }),
    canUndo: () => state.past > 0,
    canRedo: () => state.future > 0,
  } satisfies ModalHistory;
  return history;
}

function keep(root: Element, history: ModalHistory): void {
  cleanups.push(registerModalHistory(root, history));
}

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

const surfaceOf = (dialog: Element) => dialog.querySelector('[role="document"]') as HTMLElement;
const undoKey = { key: 'z', metaKey: true };
const redoKey = { key: 'Z', metaKey: true, shiftKey: true };

describe('a modal history', () => {
  it('takes Undo and Redo while its dialog is on top', () => {
    const dialog = openDialog();
    const history = historyOf(2);
    keep(dialog, history);

    expect(runModalHistory('undo')).toBe(true);
    expect(history.undo).toHaveBeenCalledOnce();
    expect(runModalHistory('redo')).toBe(true);
    expect(history.redo).toHaveBeenCalledOnce();
  });

  it('takes no step it does not have', () => {
    const dialog = openDialog();
    const history = historyOf(0);
    keep(dialog, history);

    expect(runModalHistory('undo')).toBe(false);
    expect(runModalHistory('redo')).toBe(false);
    expect(history.undo).not.toHaveBeenCalled();
    expect(history.redo).not.toHaveBeenCalled();
  });

  it('is nothing with no dialog open, or a dialog that keeps none on top', () => {
    expect(runModalHistory('undo')).toBe(false);
    openDialog();
    expect(runModalHistory('undo')).toBe(false);
  });

  it('counts only for the dialog on top', () => {
    const under = openDialog();
    const underHistory = historyOf(3);
    keep(under, underHistory);

    // A dialog with no history of its own over it: Undo goes nowhere.
    const plain = openDialog();
    expect(runModalHistory('undo')).toBe(false);
    expect(underHistory.undo).not.toHaveBeenCalled();
    plain.remove();

    // One with its own: Undo goes to that one.
    const over = openDialog();
    const overHistory = historyOf(1);
    keep(over, overHistory);
    expect(runModalHistory('undo')).toBe(true);
    expect(overHistory.undo).toHaveBeenCalledOnce();
    expect(underHistory.undo).not.toHaveBeenCalled();

    // Closed: back to the one beneath.
    over.remove();
    expect(runModalHistory('undo')).toBe(true);
    expect(underHistory.undo).toHaveBeenCalledOnce();
  });

  it('goes with its unregister, which leaves a newer registration be', () => {
    const dialog = openDialog();
    const first = historyOf(1);
    const unregisterFirst = registerModalHistory(dialog, first);
    const second = historyOf(1);
    const unregisterSecond = registerModalHistory(dialog, second);

    unregisterFirst();
    expect(runModalHistory('undo')).toBe(true);
    expect(second.undo).toHaveBeenCalledOnce();
    expect(first.undo).not.toHaveBeenCalled();

    unregisterSecond();
    expect(runModalHistory('redo')).toBe(false);
  });
});

describe('keys while a barrier dialog is open', () => {
  function dispatch(event: KeyboardEvent, overrides?: Parameters<typeof handleDialogShortcutKeyDown>[1]['overrides']) {
    const menu = vi.fn();
    const claimed = handleDialogShortcutKeyDown(event, { menu, overrides });
    return { claimed, menu };
  }

  it('sends ⌘Z and ⇧⌘Z to the menus’ Undo and Redo, for the dialog’s history', () => {
    const dialog = openDialog();
    keep(dialog, historyOf(1));

    const undo = press(surfaceOf(dialog), undoKey);
    expect(dispatch(undo).menu).toHaveBeenCalledWith('edit.undo');
    expect(undo.defaultPrevented).toBe(true);
    expect(dispatch(press(surfaceOf(dialog), redoKey)).menu).toHaveBeenCalledWith('edit.redo');
  });

  it('claims nothing for a dialog that keeps no history, as before', () => {
    const dialog = openDialog();
    const event = press(surfaceOf(dialog), undoKey);

    const { claimed, menu } = dispatch(event);
    expect(claimed).toBe(false);
    expect(menu).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('follows Undo’s bindings, a chord the user added included', () => {
    const dialog = openDialog();
    keep(dialog, historyOf(1));

    const added = dispatch(press(surfaceOf(dialog), { key: 'u', metaKey: true }), {
      'edit.undo': [{ primary: true, key: 'u' }],
    });
    expect(added.menu).toHaveBeenCalledWith('edit.undo');
    expect(dispatch(press(surfaceOf(dialog), { key: 'u', metaKey: true })).claimed).toBe(false);
  });

  it('leaves a focused text field inside the dialog its own undo', () => {
    const dialog = openDialog();
    keep(dialog, historyOf(1));
    const field = dialog.appendChild(document.createElement('input'));

    for (const init of [undoKey, redoKey]) {
      const event = press(field, init);
      expect(dispatch(event).claimed).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('hands the keys to a dialog opened over it, and back when it closes', () => {
    const under = openDialog();
    keep(under, historyOf(1));

    // Settings over it, say: no history of its own, so its ⌘Z is its own.
    const over = openDialog();
    const aimedOver = press(surfaceOf(over), undoKey);
    expect(dispatch(aimedOver).claimed).toBe(false);
    expect(aimedOver.defaultPrevented).toBe(false);
    // Nor does a key aimed at the dialog beneath reach it.
    expect(dispatch(press(surfaceOf(under), undoKey)).claimed).toBe(false);

    over.remove();
    expect(dispatch(press(surfaceOf(under), undoKey)).menu).toHaveBeenCalledWith('edit.undo');
  });

  it('claims nothing else, Escape included, which is the dialog’s own', () => {
    const dialog = openDialog();
    keep(dialog, historyOf(1));

    for (const init of [{ key: 'Escape' }, { key: 'Delete' }, { key: 's', metaKey: true }, { key: 'ArrowLeft' }]) {
      const event = press(surfaceOf(dialog), init);
      const { claimed, menu } = dispatch(event);
      expect(claimed, init.key).toBe(false);
      expect(menu, init.key).not.toHaveBeenCalled();
      expect(event.defaultPrevented, init.key).toBe(false);
    }
  });
});
