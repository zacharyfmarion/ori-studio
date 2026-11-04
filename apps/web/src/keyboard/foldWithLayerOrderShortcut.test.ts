// @vitest-environment jsdom
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shortcutActionLabel, shortcutCategoryLabel, shortcutScopeLabel } from '../i18n/shortcutLabels';
import type { EditingContext } from '../workspaces/editingContext';
import {
  handleShortcutRuntimeKeyDown,
  registerConditionalScopeExecutor,
  registerCpActionShortcutExecutor,
} from './shortcutRuntime';
import {
  FOLD_WITH_LAYER_ORDER_SHORTCUT_ID,
  getDefaultShortcutChords,
  getResolvedShortcuts,
  getShortcutDefinition,
  isShortcutBindable,
  keyChordId,
  SHORTCUT_DEFINITIONS,
  shortcutIdForOrieditaAction,
  type ShortcutDefaultsSource,
} from './shortcuts';

// Answers with the key, so a label read from the catalogue is told apart from the registry's English.
const keyOf = ((key: string) => key) as unknown as TFunction;

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/**
 * "Fold with layer order…" (row H5): a command in the registry on Shift+G,
 * right after Fold estimate, the command that carries G.
 */
describe('the Fold with layer order… shortcut', () => {
  const definition = getShortcutDefinition(FOLD_WITH_LAYER_ORDER_SHORTCUT_ID)!;

  it('comes right after Fold estimate, in its category and its scope', () => {
    const ids = SHORTCUT_DEFINITIONS.map((entry) => entry.id);
    expect(ids.indexOf(FOLD_WITH_LAYER_ORDER_SHORTCUT_ID)).toBe(ids.indexOf('cp.action.folding-estimate') + 1);
    const estimate = getShortcutDefinition('cp.action.folding-estimate')!;
    expect(definition).toMatchObject({ category: estimate.category, scope: 'crease-pattern', target: 'cp-action' });
    expect(definition.upstreamAction).toBeUndefined();
  });

  it('is Shift+G by default, under either layout, and no Oriedita import can claim it', () => {
    expect(getDefaultShortcutChords(FOLD_WITH_LAYER_ORDER_SHORTCUT_ID, 'ori-studio').map(keyChordId)).toEqual([
      'shift+g',
    ]);
    expect(getDefaultShortcutChords(FOLD_WITH_LAYER_ORDER_SHORTCUT_ID, 'oriedita').map(keyChordId)).toEqual([
      'shift+g',
    ]);
    expect(getResolvedShortcuts(FOLD_WITH_LAYER_ORDER_SHORTCUT_ID).map(keyChordId)).toEqual(['shift+g']);
    expect(shortcutIdForOrieditaAction('foldAction')).toBe('cp.action.folding-estimate');
  });

  it('can be rebound, and then resolves to the key bound', () => {
    expect(isShortcutBindable(FOLD_WITH_LAYER_ORDER_SHORTCUT_ID)).toBe(true);
    const chord = { alt: true, shift: true, key: 'k' };
    expect(getResolvedShortcuts(FOLD_WITH_LAYER_ORDER_SHORTCUT_ID, { [FOLD_WITH_LAYER_ORDER_SHORTCUT_ID]: [chord] })).toEqual([
      chord,
    ]);
  });

  describe('Shift+G, wherever it is pressed', () => {
    function pressShiftG(context: EditingContext, defaultsSource: ShortcutDefaultsSource = 'ori-studio') {
      const cpAction = vi.fn();
      const fold = vi.fn(() => true);
      const menu = vi.fn();
      disposers.push(registerCpActionShortcutExecutor(cpAction));
      disposers.push(registerConditionalScopeExecutor('fold', fold));
      handleShortcutRuntimeKeyDown(
        new KeyboardEvent('keydown', { key: 'G', shiftKey: true, bubbles: true, cancelable: true }),
        { context: { activeEditingContext: context }, defaultsSource, menu }
      );
      return { cpAction, fold, menu };
    }

    it.each(['ori-studio', 'oriedita'] as const)('folds with a layer order on the Edit canvas (%s layout)', (layout) => {
      const { cpAction, fold, menu } = pressShiftG('crease-pattern', layout);
      expect(cpAction.mock.calls).toEqual([[FOLD_WITH_LAYER_ORDER_SHORTCUT_ID]]);
      expect(fold).not.toHaveBeenCalled();
      expect(menu).not.toHaveBeenCalled();
    });

    it('stays Petal Fold in the Fold workspace, whose scope never stacks with the Edit canvas’s', () => {
      const { cpAction, fold } = pressShiftG('fold');
      expect(fold.mock.calls).toEqual([['fold.toolPetal']]);
      expect(cpAction).not.toHaveBeenCalled();
    });
  });

  it('is named in Settings with the selection toolbar button’s own words, translated', () => {
    expect(shortcutActionLabel(keyOf, definition)).toBe('panels:creasePattern.selectionToolbar.foldWithLayerOrder');
    expect(shortcutCategoryLabel(keyOf, definition.category)).toBe(
      shortcutCategoryLabel(keyOf, getShortcutDefinition('cp.action.folding-estimate')!.category)
    );
    expect(shortcutScopeLabel(keyOf, definition.scope)).toBe(shortcutScopeLabel(keyOf, 'crease-pattern'));
  });
});
