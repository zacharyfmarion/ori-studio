import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { selectionFoldActions } from './selectionFoldActions';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('selectionFoldActions', () => {
  function actions(route: 'flat' | 'spatial' | 'none') {
    const fold = vi.fn();
    const foldWithLayerOrder = vi.fn();
    return { fold, foldWithLayerOrder, list: selectionFoldActions({ t, route, fold, foldWithLayerOrder }) };
  }

  it('offers Fold, then Fold with layer order…, each running its own verb', () => {
    const { fold, foldWithLayerOrder, list } = actions('flat');
    expect(list.map(({ id, label, disabled }) => [id, label, disabled])).toEqual([
      ['fold', 'Fold', false],
      ['fold-with-layer-order', 'Fold with layer order…', false],
    ]);
    list[1]!.run();
    expect(foldWithLayerOrder).toHaveBeenCalledTimes(1);
    list[0]!.run();
    expect(fold).toHaveBeenCalledTimes(1);
  });

  it('names the key that runs each verb on the selection: G’s, then Shift+G’s', () => {
    const { list } = actions('flat');
    expect(list.map((action) => action.shortcutId)).toEqual([
      'cp.action.folding-estimate',
      'cp.action.fold-with-layer-order',
    ]);
  });

  it('holds Fold with layer order…, saying why, on creases that fold in 3D; Fold folds them', () => {
    const { list } = actions('spatial');
    expect(list[0]).toMatchObject({ id: 'fold', disabled: false });
    expect(list[0]?.hint).toBeUndefined();
    expect(list[1]).toMatchObject({
      id: 'fold-with-layer-order',
      disabled: true,
      hint: 'Layer order works on flat folds',
    });
  });

  it('leaves both enabled with nothing foldable, as Fold always was: the press says why', () => {
    const { list } = actions('none');
    expect(list.map((action) => action.disabled)).toEqual([false, false]);
  });
});
