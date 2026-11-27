import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { foldToolWindow, type FoldToolWindowVerbs, type FoldToolWindowView } from '../tools/foldToolWindow';
import type { FoldAdjustOrderWindowView } from './adjustOrderToolWindow';

const t = i18n.t.bind(i18n);

function verbs() {
  return {
    selectTool: vi.fn(),
    selectLineMode: vi.fn(),
    includeFlaps: vi.fn(),
    foldOtherWay: vi.fn(),
    pickFlap: vi.fn(),
    useLine: vi.fn(),
    swapSide: vi.fn(),
    toggleFlap: vi.fn(),
    cancel: vi.fn(),
    commit: vi.fn(),
  } satisfies FoldToolWindowVerbs;
}

const READY: FoldAdjustOrderWindowView = { unavailable: null, checking: false, busy: false, failed: false };

const view = (adjustOrder: Partial<FoldAdjustOrderWindowView> = {}, extra: Partial<FoldToolWindowView> = {}): FoldToolWindowView => ({
  tool: 'adjust-order',
  lineMode: 'axiom-2',
  readOnly: null,
  picks: 0,
  preview: null,
  adjustOrder: { ...READY, ...adjustOrder },
  ...extra,
});

const HOST = { coarse: false, alt: 'Option' };

describe('the Adjust order tool’s window', () => {
  it('offers one thing: a line on what it does, and one button that opens the Layer order dialog', () => {
    const bound = verbs();
    const model = foldToolWindow(t, view(), bound, HOST)!;
    expect(model).toMatchObject({ title: 'Adjust order', lineMode: null, kind: null, movingSide: null, layers: null, refusal: null });
    expect(model.instructions.intro).toBe('Change which layers lie in front, with no new crease.');
    expect(model.instructions.items).toEqual([]);
    expect(model.instructions.notes).toEqual(['Enter opens the Layer order dialog.']);
    // One button, no Cancel.
    expect(model.footer?.cancel).toBeUndefined();
    expect(model.footer?.commit).toMatchObject({ label: 'Edit layer order…', shortcut: 'fold.commit', disabled: false });
    model.footer?.commit.run();
    expect(bound.commit).toHaveBeenCalledTimes(1);
    // A finger has no Enter to name.
    expect(foldToolWindow(t, view(), bound, { ...HOST, coarse: true })!.instructions.notes).toEqual([]);
  });

  it('says why the dialog cannot open, in the words every host says it, and disables its button', () => {
    const notFlat = foldToolWindow(t, view({ unavailable: 'not_flat' }), verbs(), HOST)!;
    expect(notFlat.instructions.notes).toEqual(['Layer order works on flat folds']);
    expect(notFlat.footer?.commit.disabled).toBe(true);
    const sheet = foldToolWindow(t, view({ unavailable: 'sheet' }), verbs(), HOST)!;
    expect(sheet.instructions.notes).toEqual(['Fold a step first.']);
    expect(sheet.footer?.commit.disabled).toBe(true);
    const unreadable = foldToolWindow(t, view({ unavailable: 'unreadable' }), verbs(), HOST)!;
    expect(unreadable.instructions.notes).toEqual(['The Layer order dialog can’t read this step’s layers.']);
    expect(unreadable.footer?.commit.disabled).toBe(true);
  });

  it('waits while the step’s paper is read or the dialog is open, and while the sequence cannot change', () => {
    for (const waiting of [{ checking: true }, { busy: true }]) {
      expect(foldToolWindow(t, view(waiting), verbs(), HOST)!.footer?.commit.disabled, JSON.stringify(waiting)).toBe(true);
    }
    expect(foldToolWindow(t, view({}, { readOnly: 'locked' }), verbs(), HOST)!.footer?.commit.disabled).toBe(true);
  });

  it('says when an Apply added no step', () => {
    const model = foldToolWindow(t, view({ failed: true }), verbs(), HOST)!;
    expect(model.instructions.notes[0]).toBe('That order could not be added as a step. Open the dialog and try again.');
    expect(model.footer?.commit.disabled).toBe(false);
  });
});
