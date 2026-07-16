import { describe, expect, it, vi } from 'vitest';
import type { EditingContext } from '../workspaces/editingContext';
import { handleAppKeyDown, installAppKeyboardListener } from './appKeyboard';
import { createSampleProject, type Selection } from './sampleProject';
import { selectEverything } from './selection';

function createActions(
  selection: Selection,
  options: {
    activeEditingContext?: EditingContext;
    cpSelectionSize?: number;
  } = {}
) {
  return {
    getActiveEditingContext: vi.fn(() => options.activeEditingContext ?? 'treemaker-tree'),
    getCpSelectionSize: vi.fn(() => options.cpSelectionSize ?? 0),
    getSelection: vi.fn(() => selection),
    handleMenuAction: vi.fn(),
    selectNone: vi.fn(),
  };
}

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

  it('routes Escape through CP deselection when editing an imported crease pattern', () => {
    const actions = createActions(
      { kind: 'tree' },
      { activeEditingContext: 'crease-pattern', cpSelectionSize: 2 }
    );
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    expect(handleAppKeyDown(event, actions)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(actions.handleMenuAction).toHaveBeenCalledWith('edit.deselectAll');
    expect(actions.selectNone).not.toHaveBeenCalled();
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
