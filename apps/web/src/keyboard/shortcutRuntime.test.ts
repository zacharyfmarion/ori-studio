import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleShortcutRuntimeKeyDown,
  registerCpActionShortcutExecutor,
  hasSimulatorExecutor,
  registerReferencesShortcutExecutor,
  registerSimulatorShortcutExecutor,
  registerViewportShortcutExecutor,
  runReferencesCommand,
  runSimulatorCommand,
  shortcutScopeStackForContext,
  subscribeSimulatorExecutor,
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
      })
    ).toEqual(['viewport', 'crease-pattern', 'global']);

    expect(
      shortcutScopeStackForContext({
        activeEditingContext: 'treemaker-tree',
      })
    ).toEqual(['viewport', 'global']);
  });

  it('pushes the references scope only while its panel holds an executor', () => {
    // Behind a focused simulation, ahead of the viewport: an inline simulation
    // window can be in hand while the References panel is mounted, and the
    // simulation is the thing being looked at.
    expect(
      shortcutScopeStackForContext({
        activeEditingContext: 'references',
        referencesFocused: true,
      })
    ).toEqual(['references', 'viewport', 'global']);
    expect(
      shortcutScopeStackForContext({
        activeEditingContext: 'references',
        simulatorFocused: true,
        referencesFocused: true,
      })
    ).toEqual(['simulator', 'references', 'viewport', 'global']);
    expect(
      shortcutScopeStackForContext({
        activeEditingContext: 'references',
      })
    ).toEqual(['viewport', 'global']);
  });

  describe('runReferencesCommand', () => {
    it('runs the registered References executor with the id, and says it did', () => {
      const references = vi.fn();
      cleanupWith(registerReferencesShortcutExecutor(references));

      expect(runReferencesCommand('references.exportAllSteps')).toBe(true);
      expect(references).toHaveBeenCalledTimes(1);
      expect(references).toHaveBeenCalledWith('references.exportAllSteps');
    });

    it('answers false while no References view is mounted', () => {
      expect(runReferencesCommand('references.exportAllSteps')).toBe(false);
    });

    it('answers false again once the registration is disposed', () => {
      const references = vi.fn();
      const dispose = registerReferencesShortcutExecutor(references);
      dispose();

      expect(runReferencesCommand('references.exportAllSteps')).toBe(false);
      expect(references).not.toHaveBeenCalled();
    });

    it('keeps a newer registration when an older one is disposed', () => {
      const older = vi.fn();
      const newer = vi.fn();
      const disposeOlder = registerReferencesShortcutExecutor(older);
      cleanupWith(registerReferencesShortcutExecutor(newer));
      disposeOlder();

      expect(runReferencesCommand('references.exportAllSteps')).toBe(true);
      expect(newer).toHaveBeenCalledWith('references.exportAllSteps');
      expect(older).not.toHaveBeenCalled();
    });
  });

  describe('runSimulatorCommand', () => {
    it('answers false while no simulation is in hand', () => {
      expect(hasSimulatorExecutor()).toBe(false);
      expect(runSimulatorCommand('simulator.exportView')).toBe(false);
    });

    it('runs the registered simulator executor with the id, and says it did', () => {
      const simulator = vi.fn(() => true);
      cleanupWith(registerSimulatorShortcutExecutor(simulator));

      expect(runSimulatorCommand('simulator.setUpright')).toBe(true);
      expect(simulator).toHaveBeenCalledWith('simulator.setUpright');
    });

    it('answers false when the simulation in hand declines the verb', () => {
      // An inline window holds the keyboard and has no tools.
      const simulator = vi.fn(() => false);
      cleanupWith(registerSimulatorShortcutExecutor(simulator));

      expect(runSimulatorCommand('simulator.tool.pin')).toBe(false);
      expect(simulator).toHaveBeenCalledWith('simulator.tool.pin');
    });

    it('tells subscribers when a simulation comes and goes, and not otherwise', () => {
      const listener = vi.fn();
      cleanupWith(subscribeSimulatorExecutor(listener));

      const disposeOlder = registerSimulatorShortcutExecutor(vi.fn(() => true));
      const disposeNewer = registerSimulatorShortcutExecutor(vi.fn(() => true));
      // Both unregisters are idempotent, so a failed assertion cannot leave
      // an executor behind for the next test.
      cleanupWith(disposeOlder);
      cleanupWith(disposeNewer);
      expect(listener).toHaveBeenCalledTimes(2);

      // A stale unregister finds a newer executor and leaves it: no news.
      disposeOlder();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(hasSimulatorExecutor()).toBe(true);

      disposeNewer();
      expect(listener).toHaveBeenCalledTimes(3);
      expect(hasSimulatorExecutor()).toBe(false);
    });
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
      })
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
      })
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
      })
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
          handleShortcutRuntimeKeyDown(event, { context: { activeEditingContext: context }, menu })
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
        registerViewportShortcutExecutor(
          'tree',
          (() => undefined) as unknown as () => boolean
        )
      );

      const event = pressDelete();
      expect(
        handleShortcutRuntimeKeyDown(event, {
          context: { activeEditingContext: 'treemaker-tree' },
          menu,
        })
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
      }
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
      })
    ).toBe(true);

    expect(menu).toHaveBeenCalledWith('edit.delete');
    expect(event.defaultPrevented).toBe(true);
  });
});
