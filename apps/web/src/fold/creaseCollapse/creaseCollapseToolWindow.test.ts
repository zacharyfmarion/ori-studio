import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { foldToolWindow, type FoldToolWindowVerbs, type FoldToolWindowView } from '../tools/foldToolWindow';
import type { FoldCreaseCollapseWindowView } from './creaseCollapseToolWindow';

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
    creaseCollapse: { setTo: vi.fn() },
  } satisfies FoldToolWindowVerbs;
}

const EMPTY: FoldCreaseCollapseWindowView = { to: 'valley', picks: 0, status: 'empty', problem: null, orders: null };

const view = (collapse: Partial<FoldCreaseCollapseWindowView> = {}, extra: Partial<FoldToolWindowView> = {}): FoldToolWindowView => ({
  tool: 'collapse',
  lineMode: 'axiom-2',
  readOnly: null,
  picks: 0,
  preview: null,
  creaseCollapse: { ...EMPTY, ...collapse },
  ...extra,
});

const HOST = { coarse: false, alt: 'Option' };

describe('the Collapse tool’s window', () => {
  it('says what to click in one line, holds the letter, and keeps the status line’s room while it is empty', () => {
    const bound = verbs();
    const model = foldToolWindow(t, view(), bound, HOST)!;
    expect(model).toMatchObject({ title: 'Collapse', lineMode: null, kind: null, movingSide: null, layers: null, refusal: null });
    expect(model.instructions.items).toEqual(['Click a crease to set it to the letter below.']);
    expect(model.instructions.notes).toEqual(['Enter collapses; Esc lets go of the creases set.']);
    expect(model.creaseCollapse?.letter).toMatchObject({ label: 'Set to', value: 'valley', disabled: false });
    expect(model.creaseCollapse?.letter.options.map((option) => [option.value, option.label])).toEqual([
      ['valley', 'Valley'],
      ['mountain', 'Mountain'],
      ['open', 'Open'],
    ]);
    model.creaseCollapse?.letter.set('open');
    expect(bound.creaseCollapse.setTo).toHaveBeenCalledWith('open');
    expect(model.creaseCollapse).toMatchObject({ count: '0 creases set', status: null, refused: false });
    // Nothing set: nothing to cancel, nothing to collapse.
    expect(model.footer?.cancel?.disabled).toBe(true);
    expect(model.footer?.commit).toMatchObject({ label: 'Collapse', shortcut: 'fold.commit', disabled: true });
  });

  it('says where the creases set stand, in words, and collapses only what lands', () => {
    const working = foldToolWindow(t, view({ picks: 1, status: 'working' }), verbs(), HOST)!;
    expect(working.creaseCollapse).toMatchObject({ count: '1 crease set', status: 'Working out the fold…' });
    expect(working.footer?.commit.disabled).toBe(true);
    const one = foldToolWindow(t, view({ picks: 3, status: 'landed', orders: 1 }), verbs(), HOST)!;
    expect(one.creaseCollapse?.status).toBe('Folds flat.');
    expect(one.footer?.commit.disabled).toBe(false);
    expect(one.footer?.cancel?.disabled).toBe(false);
    const several = foldToolWindow(t, view({ picks: 3, status: 'landed', orders: 17 }), verbs(), HOST)!;
    expect(several.creaseCollapse?.status).toBe('Folds flat, 17 layer orders.');
  });

  it('says why the creases set do not fold, and refuses to collapse them', () => {
    const vertex = foldToolWindow(t, view({ picks: 2, status: 'refused', problem: 'vertex' }), verbs(), HOST)!;
    expect(vertex.creaseCollapse).toMatchObject({
      status: 'The creases at the marked point can’t fold flat with these letters.',
      refused: true,
    });
    expect(vertex.footer?.commit.disabled).toBe(true);
    expect(foldToolWindow(t, view({ picks: 2, status: 'refused', problem: 'order' }), verbs(), HOST)!.creaseCollapse?.status).toBe(
      'No layer order fits these letters.'
    );
  });

  it('changes nothing on a sequence that cannot change, and names no key on a touch screen', () => {
    const locked = foldToolWindow(t, view({ picks: 2, status: 'landed', orders: 1 }, { readOnly: 'locked' }), verbs(), HOST)!;
    expect(locked.creaseCollapse?.letter.disabled).toBe(true);
    expect(locked.footer?.commit.disabled).toBe(true);
    expect(foldToolWindow(t, view(), verbs(), { ...HOST, coarse: true })!.instructions.notes).toEqual([]);
  });
});
