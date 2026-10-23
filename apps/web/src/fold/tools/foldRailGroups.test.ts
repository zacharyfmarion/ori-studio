import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { foldRailGroups, foldRailTooltip, type FoldRailVerbs, type FoldToolsView } from './foldRailGroups';

const t = i18n.t.bind(i18n);

function verbs() {
  return { selectTool: vi.fn(), selectLineMode: vi.fn(), turn: vi.fn() } satisfies FoldRailVerbs;
}

const view = (extra: Partial<FoldToolsView> = {}): FoldToolsView => ({
  tool: 'valley',
  lineMode: 'axiom-2',
  readOnly: null,
  ...extra,
});

const item = (groups: ReturnType<typeof foldRailGroups>, id: string) => {
  const found = groups.flatMap((group) => group.items).find((each) => each.id === id);
  if (!found) throw new Error(`no rail item ${id}`);
  return found;
};

describe('foldRailGroups', () => {
  it('lists the folds, the sinks, Reference points, Locate line, the model verbs, the sequence tools, in that order', () => {
    const groups = foldRailGroups(t, view(), verbs());
    expect(groups.map((group) => [group.id, group.label])).toEqual([
      ['fold', 'Fold'],
      ['sink', 'Sinks'],
      ['reference', 'Reference points'],
      ['locate', 'Locate line'],
      ['model', 'Model'],
      ['sequence', 'Sequence'],
    ]);
    expect(groups.map((group) => group.items.map((each) => each.id))).toEqual([
      ['valley', 'mountain', 'precrease', 'inside-reverse', 'crimp', 'pleat', 'squash', 'petal', 'rabbit-ear', 'swivel'],
      ['open-sink', 'closed-sink', 'unsink'],
      ['divide-line'],
      ['axiom-1', 'axiom-2', 'axiom-3', 'axiom-4', 'axiom-5', 'axiom-6', 'axiom-7', 'free', 'crease'],
      ['turn-over', 'rotate'],
      ['unfold-to', 'repeat'],
    ]);
    // Only usable tool groups are shown, all open initially.
    expect(groups.filter((group) => group.collapsedByDefault).map((group) => group.id)).toEqual([]);
  });

  it('names the axioms by the move a folder makes, and every item by its key', () => {
    const groups = foldRailGroups(t, view(), verbs());
    expect(item(groups, 'axiom-2').label).toBe('Axiom 2: point onto point');
    expect(item(groups, 'free').label).toBe('Free line');
    expect(item(groups, 'crease').label).toBe('Existing crease');
    expect(item(groups, 'turn-over').label).toBe('Turn over');
    expect(item(groups, 'rotate').label).toBe('Rotate');
    expect(item(groups, 'valley').shortcut).toBe('fold.toolValley');
    expect(item(groups, 'axiom-7').shortcut).toBe('fold.lineAxiom7');
    expect(item(groups, 'rotate').shortcut).toBe('fold.rotate');
    expect(item(groups, 'squash').shortcut).toBe('fold.toolSquash');
    expect(item(groups, 'crimp').shortcut).toBe('fold.toolCrimp');
  });

  it('takes the reverse fold as a tool, its line mode marked', () => {
    const calls = verbs();
    const groups = foldRailGroups(t, view({ tool: 'inside-reverse', lineMode: 'free' }), calls);
    const reverse = item(groups, 'inside-reverse');
    expect(reverse).toMatchObject({ kind: 'tool', available: true, reason: null, active: true });
    expect(item(groups, 'free').active).toBe(true);
    reverse.select();
    expect(calls.selectTool).toHaveBeenCalledWith('inside-reverse');
    calls.selectTool.mockClear();
    // Every compound fold is a tool now: none is planned.
    for (const id of ['crimp', 'squash', 'swivel', 'unsink']) expect(item(groups, id).kind).toBe('tool');
    expect(groups.flatMap((group) => group.items.map((each) => each.id))).toContain('pleat');
  });

  it('takes Unfold to step and Repeat as tools, keyless, refused at the flat sheet and while read-only', () => {
    const calls = verbs();
    const groups = foldRailGroups(t, view({ tool: 'repeat' }), calls);
    expect(item(groups, 'unfold-to')).toMatchObject({
      kind: 'tool',
      label: 'Unfold to step',
      shortcut: 'fold.toolUnfoldTo',
      available: true,
      active: false,
    });
    expect(item(groups, 'repeat')).toMatchObject({
      kind: 'tool',
      label: 'Repeat',
      shortcut: 'fold.toolRepeat',
      available: true,
      active: true,
    });
    item(groups, 'unfold-to').select();
    expect(calls.selectTool).toHaveBeenLastCalledWith('unfold-to');
    // No line mode is what the canvas is doing while either is in hand.
    expect(groups.flatMap((group) => group.items).filter((each) => each.active).map((each) => each.id)).toEqual(['repeat']);
    const sheet = foldRailGroups(t, view({ atSheet: true }), verbs());
    for (const id of ['unfold-to', 'repeat']) {
      expect(item(sheet, id)).toMatchObject({ available: false, reason: 'Fold a step first.' });
    }
    // The other tools fold the flat sheet as ever.
    expect(item(sheet, 'valley').available).toBe(true);
    const locked = foldRailGroups(t, view({ readOnly: 'newer' }), verbs());
    expect(item(locked, 'repeat').available).toBe(false);
  });

  it('keeps Crimp and removes standalone Tuck from the Fold group', () => {
    const calls = verbs();
    const groups = foldRailGroups(t, view({ tool: 'crimp' }), calls);
    expect(item(groups, 'crimp')).toMatchObject({
      kind: 'tool',
      label: 'Crimp',
      description: 'Fold a flap in along one line and back out along a second, so its end turns.',
      shortcut: 'fold.toolCrimp',
      available: true,
      active: true,
    });
    expect(groups.flatMap((group) => group.items).some((item) => item.id === 'tuck')).toBe(false);
  });

  it('takes each sink as a tool along a located line, keyless until the user gives it one', () => {
    const calls = verbs();
    const groups = foldRailGroups(t, view({ tool: 'closed-sink', lineMode: 'axiom-4' }), calls);
    for (const [id, label, shortcut] of [
      ['open-sink', 'Open sink', 'fold.toolOpenSink'],
      ['closed-sink', 'Closed sink', 'fold.toolClosedSink'],
      ['unsink', 'Unsink', 'fold.toolUnsink'],
    ] as const) {
      const sink = item(groups, id);
      expect(sink).toMatchObject({ kind: 'tool', available: true, reason: null, label, shortcut });
      sink.select();
      expect(calls.selectTool).toHaveBeenLastCalledWith(id);
    }
    expect(item(groups, 'closed-sink').active).toBe(true);
    // A sink locates its line as every fold does: the line mode is marked under it.
    expect(item(groups, 'axiom-4').active).toBe(true);
    expect(item(groups, 'open-sink').description).toBe('Push a closed point’s tip in, turning every layer of it inside out.');
    // Locked, they are refused as every tool is.
    const locked = foldRailGroups(t, view({ readOnly: 'locked' }), verbs());
    expect(item(locked, 'unsink').available).toBe(false);
  });

  it('marks the tool in hand and the line mode chosen, but no line mode under the Divide line', () => {
    let groups = foldRailGroups(t, view({ tool: 'mountain', lineMode: 'axiom-5' }), verbs());
    expect(groups.flatMap((group) => group.items).filter((each) => each.active).map((each) => each.id)).toEqual([
      'mountain',
      'axiom-5',
    ]);
    groups = foldRailGroups(t, view({ tool: 'divide-line', lineMode: 'axiom-5' }), verbs());
    expect(groups.flatMap((group) => group.items).filter((each) => each.active).map((each) => each.id)).toEqual([
      'divide-line',
    ]);
  });

  it('binds each item to its call: a tool, a line mode, a turn as a step of its own', () => {
    const calls = verbs();
    const groups = foldRailGroups(t, view(), calls);
    item(groups, 'precrease').select();
    item(groups, 'divide-line').select();
    item(groups, 'crease').select();
    item(groups, 'turn-over').select();
    item(groups, 'rotate').select();
    // Rotate is a tool: taken in hand, its window sets how far and which way before it is applied.
    expect(calls.selectTool.mock.calls).toEqual([['precrease'], ['divide-line'], ['rotate']]);
    expect(calls.selectLineMode.mock.calls).toEqual([['crease']]);
    expect(calls.turn.mock.calls).toEqual([[{ kind: 'turn-over', axis: 'vertical' }]]);
    // Done at once: a verb is never the thing in hand; a tool is, while it is.
    expect(item(groups, 'turn-over').active).toBe(false);
    expect(item(groups, 'rotate')).toMatchObject({ kind: 'tool', shortcut: 'fold.rotate', active: false });
    expect(item(foldRailGroups(t, view({ tool: 'rotate' }), calls), 'rotate').active).toBe(true);
  });

  it('holds every tool on a read-only sequence, saying why', () => {
    const groups = foldRailGroups(t, view({ readOnly: 'newer' }), verbs());
    for (const id of ['valley', 'divide-line', 'axiom-1', 'free', 'turn-over']) {
      expect(item(groups, id).available).toBe(false);
      expect(item(groups, id).reason).toBe('This sequence is from a newer Ori Studio, so it opens read-only.');
    }
    expect(item(groups, 'inside-reverse').available).toBe(false);
    expect(item(groups, 'crimp').available).toBe(false);
    expect(item(groups, 'squash').available).toBe(false);
    expect(item(groups, 'unsink').available).toBe(false);
  });

  it('builds a tooltip from the name, the key and what it does, or why it cannot', () => {
    const groups = foldRailGroups(t, view(), verbs());
    expect(foldRailTooltip(item(groups, 'valley'), 'V')).toBe(
      'Valley fold (V) - Fold the moving side toward you, so it lands on top.'
    );
    expect(foldRailTooltip(item(groups, 'axiom-1'), undefined)).toBe(
      'Axiom 1: through two points - The line through two points.'
    );
  });

  it('takes the vertex folds as tools, none of them locating a line through the line modes', () => {
    const calls = verbs();
    let groups = foldRailGroups(t, view({ tool: 'squash', lineMode: 'crease' }), calls);
    for (const id of ['squash', 'petal', 'rabbit-ear', 'swivel']) {
      expect(item(groups, id)).toMatchObject({ kind: 'tool', available: true, reason: null });
    }
    expect(foldRailTooltip(item(groups, 'petal'), undefined)).toBe(
      'Petal fold - Lift a flap’s lower point along a hinge while its sides fold in along two kite creases.'
    );
    expect(foldRailTooltip(item(groups, 'swivel'), undefined)).toBe(
      'Swivel fold - Swivel an edge onto a line, pivoting at a point.'
    );
    // A squash locates no line: no line mode is what the canvas is doing.
    expect(groups.flatMap((group) => group.items).filter((each) => each.active).map((each) => each.id)).toEqual([
      'squash',
    ]);
    item(groups, 'rabbit-ear').select();
    expect(calls.selectTool).toHaveBeenCalledWith('rabbit-ear');
    // A petal fold names its hinge in its own window, by a crease or by its two ends: no line mode is lit.
    groups = foldRailGroups(t, view({ tool: 'petal', lineMode: 'crease' }), calls);
    expect(groups.flatMap((group) => group.items).filter((each) => each.active).map((each) => each.id)).toEqual(['petal']);
  });
});

 describe('swivel line toolbar', () => {
  it('highlights the chosen line mode only for a swivel by its valley and mountain', () => {
    for (const swivelInput of ['edge', 'valley-mountain'] as const) {
      const groups = foldRailGroups(t, view({ tool: 'swivel', lineMode: 'axiom-1', construction: { swivelInput } }), verbs());
      expect(groups.find(g => g.id === 'locate')!.items.filter(i => i.active).map(i => i.id))
        .toEqual(swivelInput === 'valley-mountain' ? ['axiom-1'] : []);
    }
  });
});
