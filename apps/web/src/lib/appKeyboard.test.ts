import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditingContext } from '../workspaces/editingContext';
import { registerViewportShortcutExecutor } from '../keyboard/shortcutRuntime';
import { handleAppKeyDown, installAppKeyboardListener } from './appKeyboard';
import { createSampleProject, type Selection } from './sampleProject';
import { selectEverything } from './selection';

function createActions(
  selection: Selection,
  options: {
    activeEditingContext?: EditingContext;
  } = {}
) {
  return {
    getActiveEditingContext: vi.fn(() => options.activeEditingContext ?? 'treemaker-tree'),
    getSelection: vi.fn(() => selection),
    handleMenuAction: vi.fn(),
    selectNone: vi.fn(),
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('app keyboard shortcuts', () => {
  it('clears the active selection on Escape', () => {
    const actions = createActions(selectEverything(createSampleProject()));
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    expect(handleAppKeyDown(event, actions)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(actions.selectNone).toHaveBeenCalledOnce();
  });

  it('ignores Escape when nothing is selected', () => {
    const actions = createActions({ kind: 'tree' });
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    expect(handleAppKeyDown(event, actions)).toBe(false);

    expect(event.defaultPrevented).toBe(false);
    expect(actions.selectNone).not.toHaveBeenCalled();
  });

  it('keeps text input Escape available to the focused control', () => {
    const actions = createActions(selectEverything(createSampleProject()));
    const input = document.createElement('input');
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    let handled = true;
    input.addEventListener('keydown', (keyboardEvent) => {
      handled = handleAppKeyDown(keyboardEvent, actions);
    });

    input.dispatchEvent(event);

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(actions.selectNone).not.toHaveBeenCalled();
  });

  it('hands Escape to the crease-pattern viewport instead of a plain deselect', () => {
    // Deselecting is only the first rung of the CP ladder (hand tool, then
    // selection, then the active tool), and only the panel knows which applies —
    // so the app layer must not answer Escape itself in that context.
    // Claims whatever it is asked, as the real crease-pattern executor does for
    // Escape. A viewport that answers nothing declines and the chord moves on.
    const viewport = vi.fn(() => true);
    cleanups.push(registerViewportShortcutExecutor('crease-pattern', viewport));
    const actions = createActions(
      selectEverything(createSampleProject()),
      { activeEditingContext: 'crease-pattern' }
    );
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    expect(handleAppKeyDown(event, actions)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(viewport).toHaveBeenCalledWith('viewport.cancel');
    expect(actions.selectNone).not.toHaveBeenCalled();
    expect(actions.handleMenuAction).not.toHaveBeenCalled();
  });

  it('reaches the crease-pattern viewport with a toolbar button focused', () => {
    // The regression this replaces: Escape was scoped to the panel container and
    // skipped for any focused button, so it did nothing right after clicking a
    // tool in the rail or a control on a floating toolbar.
    // Claims whatever it is asked, as the real crease-pattern executor does for
    // Escape. A viewport that answers nothing declines and the chord moves on.
    const viewport = vi.fn(() => true);
    cleanups.push(registerViewportShortcutExecutor('crease-pattern', viewport));
    const actions = createActions({ kind: 'tree' }, { activeEditingContext: 'crease-pattern' });
    const button = document.body.appendChild(document.createElement('button'));
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    Object.defineProperty(event, 'target', { value: button });
    expect(handleAppKeyDown(event, actions)).toBe(true);
    expect(viewport).toHaveBeenCalledWith('viewport.cancel');
    button.remove();
  });

  it('leaves Escape to a focused text editor rather than the viewport', () => {
    // Claims whatever it is asked, as the real crease-pattern executor does for
    // Escape. A viewport that answers nothing declines and the chord moves on.
    const viewport = vi.fn(() => true);
    cleanups.push(registerViewportShortcutExecutor('crease-pattern', viewport));
    const actions = createActions({ kind: 'tree' }, { activeEditingContext: 'crease-pattern' });
    const editor = document.body.appendChild(document.createElement('div'));
    // jsdom does not implement `isContentEditable`, which is what the dispatcher
    // reads; setting the `contentEditable` attribute alone leaves it undefined.
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    Object.defineProperty(event, 'target', { value: editor });
    expect(handleAppKeyDown(event, actions)).toBe(false);
    expect(viewport).not.toHaveBeenCalled();
    editor.remove();
  });

  it('preserves Select All routing through the shared command layer', () => {
    const actions = createActions({ kind: 'tree' });
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: true,
      cancelable: true,
    });

    expect(handleAppKeyDown(event, actions)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(actions.handleMenuAction).toHaveBeenCalledWith('edit.selectAll');
  });

  it('routes global file, build, folded-preview, and CAMV shortcuts through the menu layer', () => {
    const actions = createActions({ kind: 'tree' });
    const shortcuts = [
      [new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true }), 'file.save'],
      [
        new KeyboardEvent('keydown', {
          key: 's',
          metaKey: true,
          shiftKey: true,
          cancelable: true,
        }),
        'file.saveAs',
      ],
      [new KeyboardEvent('keydown', { key: 'o', metaKey: true, cancelable: true }), 'file.open'],
      [new KeyboardEvent('keydown', { key: 'n', metaKey: true, cancelable: true }), 'file.new'],
      [new KeyboardEvent('keydown', { key: 'z', metaKey: true, cancelable: true }), 'edit.undo'],
      [
        new KeyboardEvent('keydown', {
          key: 'z',
          metaKey: true,
          shiftKey: true,
          cancelable: true,
        }),
        'edit.redo',
      ],
      [new KeyboardEvent('keydown', { key: 'b', metaKey: true, cancelable: true }), 'cp.build'],
      [
        new KeyboardEvent('keydown', {
          key: 'm',
          metaKey: true,
          shiftKey: true,
          cancelable: true,
        }),
        'cp.checkCamv',
      ],
    ] as const;

    for (const [event, command] of shortcuts) {
      expect(handleAppKeyDown(event, actions)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(actions.handleMenuAction).toHaveBeenLastCalledWith(command);
    }
  });

  it('routes Delete through the menu layer so CP mode can delete selected lines', () => {
    const actions = createActions({ kind: 'tree' });
    const event = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });

    expect(handleAppKeyDown(event, actions)).toBe(true);

    expect(actions.handleMenuAction).toHaveBeenCalledWith('edit.delete');
  });

  it('routes Backspace through the menu layer as a Delete alias', () => {
    const actions = createActions({ kind: 'tree' });
    const event = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });

    expect(handleAppKeyDown(event, actions)).toBe(true);

    expect(actions.handleMenuAction).toHaveBeenCalledWith('edit.delete');
  });

  it('honors user shortcut overrides', () => {
    const actions = {
      ...createActions({ kind: 'tree' }),
      getShortcutOverrides: vi.fn(() => ({
        'file.save': [{ primary: true, alt: true, key: 's' }],
      })),
    };
    const original = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      cancelable: true,
    });
    const rebound = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      altKey: true,
      cancelable: true,
    });

    expect(handleAppKeyDown(original, actions)).toBe(false);
    expect(handleAppKeyDown(rebound, actions)).toBe(true);

    expect(actions.handleMenuAction).toHaveBeenCalledWith('file.save');
  });

  it('captures app shortcuts before focused controls can stop propagation', () => {
    const actions = createActions({ kind: 'tree' });
    const target = document.createElement('button');
    document.body.append(target);
    target.addEventListener('keydown', (event) => event.stopPropagation());
    const uninstall = installAppKeyboardListener(actions);

    try {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );

      expect(actions.handleMenuAction).toHaveBeenCalledWith('edit.undo');
    } finally {
      uninstall();
      target.remove();
    }
  });

  it('lets window capture handlers preempt app shortcuts for modal capture flows', () => {
    const actions = createActions({ kind: 'tree' });
    const target = document.createElement('button');
    document.body.append(target);
    const stopAtWindow = (event: KeyboardEvent) => event.stopPropagation();
    window.addEventListener('keydown', stopAtWindow, true);
    const uninstall = installAppKeyboardListener(actions);

    try {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );

      expect(actions.handleMenuAction).not.toHaveBeenCalled();
    } finally {
      uninstall();
      window.removeEventListener('keydown', stopAtWindow, true);
      target.remove();
    }
  });
});
