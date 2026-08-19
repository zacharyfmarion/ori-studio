import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleShortcutRuntimeKeyDown,
  registerCpActionShortcutExecutor,
  registerViewportShortcutExecutor,
  shortcutScopeStackForContext,
} from './shortcutRuntime';
import type { ViewportShortcutId } from './shortcuts';

const cleanupFns: Array<() => void> = [];

function cleanupWith(dispose: () => void): void {
  cleanupFns.push(dispose);
}

afterEach(() => {
  for (const cleanup of cleanupFns.splice(0)) cleanup();
});

describe('shortcut runtime', () => {
  it('computes scopes from active app surface instead of DOM focus', () => {
    expect(
      shortcutScopeStackForContext({
        activeEditingContext: 'crease-pattern',
      }),
    ).toEqual(['viewport', 'crease-pattern', 'global']);

    expect(
      shortcutScopeStackForContext({
        activeEditingContext: 'treemaker-tree',
      }),
    ).toEqual(['viewport', 'global']);
  });

  it('lets viewport ownership differ from editing ownership', () => {
    const designViewport = vi.fn(() => true);
    const cpViewport = vi.fn(() => true);
    const menu = vi.fn();
    cleanupWith(registerViewportShortcutExecutor('tree', designViewport));
    cleanupWith(registerViewportShortcutExecutor('crease-pattern', cpViewport));

    const event = new KeyboardEvent('keydown', {
      key: '=',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(
      handleShortcutRuntimeKeyDown(event, {
        context: {
          activeEditingContext: 'treemaker-tree',
          activeViewportSurface: 'crease-pattern',
        },
        menu,
      }),
    ).toBe(true);

    expect(cpViewport).toHaveBeenCalledWith('viewport.zoomIn');
    expect(designViewport).not.toHaveBeenCalled();
  });

  it('runs scoped CP shortcuts before global shortcuts when CP is active', () => {
    const cpAction = vi.fn();
    const menu = vi.fn();
    cleanupWith(registerCpActionShortcutExecutor(cpAction));

    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(
      handleShortcutRuntimeKeyDown(event, {
        context: {
          activeEditingContext: 'crease-pattern',
        },
        menu,
      }),
    ).toBe(true);

    expect(cpAction).toHaveBeenCalledWith('cp.action.inward');
    expect(menu).not.toHaveBeenCalled();
  });

  it('routes viewport shortcuts to the active surface executor', () => {
    const designViewport = vi.fn(() => true);
    const cpViewport = vi.fn(() => true);
    const menu = vi.fn();
    cleanupWith(registerViewportShortcutExecutor('tree', designViewport));
    cleanupWith(registerViewportShortcutExecutor('crease-pattern', cpViewport));

    const event = new KeyboardEvent('keydown', {
      key: '=',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(
      handleShortcutRuntimeKeyDown(event, {
        context: {
          activeEditingContext: 'treemaker-tree',
        },
        menu,
      }),
    ).toBe(true);

    expect(designViewport).toHaveBeenCalledWith('viewport.zoomIn');
    expect(cpViewport).not.toHaveBeenCalled();
    expect(menu).not.toHaveBeenCalled();
  });

  // The bug this replaced: the canvas-object delete was a raw `window` keydown
  // listener on the panel, so it ran *in addition to* `edit.delete` rather than
  // instead of it, and one press deleted both the object and the creases.
  describe('Delete has one owner', () => {
    function pressDelete() {
      return new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    }

    function dispatch(menu: () => void) {
      return handleShortcutRuntimeKeyDown(pressDelete(), {
        context: { activeEditingContext: 'crease-pattern' },
        menu,
      });
    }

    /** The shape every non-CP viewport has: a camera, and no opinion else. */
    function cameraOnlyExecutor(id: ViewportShortcutId): boolean {
      switch (id) {
        case 'viewport.zoomIn':
        case 'viewport.zoomOut':
        case 'viewport.fit':
        case 'viewport.actualSize':
          return true;
        default:
          return false;
      }
    }

    it('deletes the canvas object and not the creases when the viewport claims it', () => {
      const menu = vi.fn();
      cleanupWith(registerViewportShortcutExecutor('crease-pattern', () => true));

      expect(dispatch(menu)).toBe(true);
      expect(menu).not.toHaveBeenCalled();
    });

    it('deletes the creases when the viewport has nothing selected to delete', () => {
      const menu = vi.fn();
      cleanupWith(registerViewportShortcutExecutor('crease-pattern', () => false));

      expect(dispatch(menu)).toBe(true);
      expect(menu).toHaveBeenCalledWith('edit.delete');
      expect(menu).toHaveBeenCalledTimes(1);
    });

    // The regression this guards: a viewport that implements only the camera
    // verbs still has `viewport.delete` bound in its scope, so it is *asked*
    // about Delete. Answering anything but `false` swallows the press, and
    // `edit.delete` -- the verb that deletes the selected BP node or tree part
    // -- never runs. Every camera-only surface must decline.
    for (const [surface, context] of [
      ['tree', 'bp-tree'],
      ['bp-editor', 'bp-packing'],
      ['tree', 'treemaker-tree'],
    ] as const) {
      it(`hands Delete to edit.delete on the ${context} surface`, () => {
        const menu = vi.fn();
        cleanupWith(registerViewportShortcutExecutor(surface, cameraOnlyExecutor));

        const event = pressDelete();
        expect(
          handleShortcutRuntimeKeyDown(event, { context: { activeEditingContext: context }, menu }),
        ).toBe(true);
        expect(menu).toHaveBeenCalledWith('edit.delete');
      });
    }

    // Belt and braces for the same failure at the dispatcher: the executor
    // contract is a required `boolean`, but a violation that slips past the
    // types must leave the chord for the next scope rather than eat it.
    it('treats a viewport executor that answers nothing as declining', () => {
      const menu = vi.fn();
      cleanupWith(
        registerViewportShortcutExecutor('tree', (() => undefined) as unknown as () => boolean),
      );

      const event = pressDelete();
      expect(
        handleShortcutRuntimeKeyDown(event, {
          context: { activeEditingContext: 'treemaker-tree' },
          menu,
        }),
      ).toBe(true);
      expect(menu).toHaveBeenCalledWith('edit.delete');
    });
  });

  // The runtime is where the store's answer meets the dispatcher, so the
  // defaults source has to travel the same path the overrides do. Threading it
  // only as far as the settings list would leave the toggle purely cosmetic.
  it('carries the defaults source through to the executor', () => {
    const cpAction = vi.fn();
    const menu = vi.fn();
    cleanupWith(registerCpActionShortcutExecutor(cpAction));

    handleShortcutRuntimeKeyDown(
      new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }),
      {
        context: { activeEditingContext: 'crease-pattern' },
        defaultsSource: 'oriedita',
        menu,
      },
    );

    // F is Auxiliary under our layout and Fold under upstream's.
    expect(cpAction).toHaveBeenCalledWith('cp.action.folding-estimate');
  });

  it('keeps global aliases available through the central runtime', () => {
    const menu = vi.fn();
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });

    expect(
      handleShortcutRuntimeKeyDown(event, {
        context: {
          activeEditingContext: 'crease-pattern',
        },
        menu,
      }),
    ).toBe(true);

    expect(menu).toHaveBeenCalledWith('edit.delete');
    expect(event.defaultPrevented).toBe(true);
  });
});
