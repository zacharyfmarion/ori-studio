import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { FOLD_PENDING_NODE } from '../session/foldSessionState';
import type { FoldPathEntry } from '../sequence/foldSequencePath';
import { foldToolWindow, type FoldToolHost, type FoldToolWindowVerbs, type FoldToolWindowView } from '../tools/foldToolWindow';
import type { FoldRepeatPhase, FoldRepeatWindowView } from './repeatToolWindow';

const t = i18n.t.bind(i18n);
const HOST: FoldToolHost = { coarse: false, alt: 'Option' };

const entry = (id: string | null, number: number): FoldPathEntry => ({
  id,
  key: id ?? 'sheet',
  node: null,
  kind: id === null ? 'sheet' : 'fold',
  number,
  status: 'ok',
  session: { ...FOLD_PENDING_NODE, status: 'ok', state: { generation: 1, id: number } },
  branches: null,
});
const entries = [entry(null, 0), entry('s1', 1), entry('s2', 2)];

function repeat(phase: FoldRepeatPhase, extra: Partial<FoldRepeatWindowView> = {}): FoldRepeatWindowView {
  return {
    range: { entries, starts: entries.slice(1), first: 's1', count: 2 },
    axes: [
      { sheet: { n: [1, 0], d: 0.5 }, side: 'same' },
      { sheet: { n: [0, 1], d: 0.5 }, side: 'behind' },
    ],
    axis: 0,
    hovered: -1,
    side: 'same',
    individual: false,
    rebuilding: false,
    phase,
    drawing: true,
    drawn: null,
    ...extra,
  };
}

function verbs() {
  return {
    selectTool: vi.fn(),
    selectLineMode: vi.fn(),
    swapSide: vi.fn(),
    toggleFlap: vi.fn(),
    cancel: vi.fn(),
    commit: vi.fn(),
    setFreeLineSnap: vi.fn(),
    repeat: {
      setFirst: vi.fn(),
      setAxis: vi.fn(),
      hoverAxis: vi.fn(),
      setIndividual: vi.fn(),
      stepOrder: vi.fn(),
      acceptOrder: vi.fn(),
      backFromOrder: vi.fn(),
    },
  } as unknown as FoldToolWindowVerbs & { repeat: NonNullable<FoldToolWindowVerbs['repeat']> };
}

function windowOf(state: FoldRepeatWindowView, calls = verbs(), lineMode: FoldToolWindowView['lineMode'] = 'axiom-2') {
  const view: FoldToolWindowView = { tool: 'repeat', lineMode, readOnly: null, picks: 0, preview: null, freeLineSnap: true, repeat: state };
  const model = foldToolWindow(t, view, calls, HOST);
  if (!model) throw new Error('no window');
  return model;
}

describe("Repeat's window", () => {
  it('offers the range start, the verified axes by name and how it is added, and adds the repeat previewed', () => {
    const calls = verbs();
    const model = windowOf(repeat({ kind: 'ready', busy: false }), calls);
    expect(model.title).toBe('Repeat');
    expect(model.steps).toMatchObject({ label: 'Start with', value: 's1', options: [{ id: 's1', label: 'Step 1' }, { id: 's2', label: 'Step 2' }] });
    // Each axis by where it runs on the paper, as the crease pattern shows it.
    expect(model.repeat?.axis).toMatchObject({
      label: 'Symmetry axis',
      value: '0',
      options: [
        { id: '0', label: 'Center line, top to bottom' },
        { id: '1', label: 'Center line, left to right' },
      ],
    });
    expect(model.repeat?.individual).toMatchObject({ label: 'Show as individual steps', checked: false });
    expect(model.repeat?.summary).toBe('Repeat 2 operations through the current step on the other side, as one numbered step.');
    // An axis of the folder's own is located as any fold's line is.
    expect(model.lineMode).toMatchObject({ label: 'Locate line', value: 'axiom-2' });
    // Drawn as a free line, the window offers its snapping, as every free line's; located otherwise, none.
    expect(model.freeLineSnap).toBeUndefined();
    expect(windowOf(repeat({ kind: 'ready', busy: false }), verbs(), 'free').freeLineSnap).toMatchObject({ label: 'Snap to points', checked: true });
    // One confirm: the preview is on the canvas, and the commit adds it.
    expect(model.instructions.items.at(-1)).toBe('Press Enter to add the repeated folds.');
    expect(model.instructions.current).toBe(2);
    expect(model.instructions.notes).toEqual(['The canvas shows the repeated folds and the creases they add.']);
    expect(model.footer?.commit).toMatchObject({ label: 'Repeat on the other side', disabled: false });
    expect(model.footer?.cancel.label).toBe('Cancel');
    model.repeat?.axis.set('1');
    model.steps?.set('s2');
    model.repeat?.individual?.set(true);
    expect(calls.repeat.setAxis).toHaveBeenCalledWith(1);
    expect(calls.repeat.setFirst).toHaveBeenCalledWith('s2');
    expect(calls.repeat.setIndividual).toHaveBeenCalledWith(true);
  });

  it('offers an axis whose repeat is refused disabled, with why under it', () => {
    const model = windowOf(
      repeat({ kind: 'ready', busy: false }, {
        axis: 1,
        side: 'behind',
        states: [
          { kind: 'refused', stop: { code: 'repeat_creases' }, step: 0 },
          { kind: 'lands' },
        ],
      })
    );
    expect(model.repeat?.axis.value).toBe('1');
    expect(model.repeat?.axis.options).toEqual([
      {
        id: '0',
        label: 'Center line, top to bottom',
        disabled: true,
        description:
          'Stops at operation 1: Repeating would change additional paper or creases. The two sides cannot be folded independently in this range.',
      },
      { id: '1', label: 'Center line, left to right' },
    ]);
  });

  it('lists only the axis taken, as a plain choice, when no axis repeat lands', () => {
    const refused = { kind: 'refused', stop: { code: 'repeat_creases' }, step: 0 } as const;
    const blocked = windowOf(repeat({ kind: 'blocked', step: 0, stop: { code: 'repeat_creases' } }, { axis: 1, side: 'behind', states: [refused, refused] }));
    expect(blocked.repeat?.axis.value).toBe('1');
    expect(blocked.repeat?.axis.options).toEqual([{ id: '1', label: 'Center line, left to right' }]);
    // Why stays said, below the list.
    expect(blocked.refusal?.title).toBe('Cannot repeat');
    // One still being prepared may land: all are listed, the refused one disabled.
    const preparing = windowOf(repeat({ kind: 'preparing' }, { axis: 1, states: [refused, { kind: 'unknown' }] }));
    expect(preparing.repeat?.axis.options).toHaveLength(2);
    expect(preparing.repeat?.axis.options[0]).toMatchObject({ disabled: true });
  });

  it('says it repeats behind when the axis previewed reverses the layers: the summary and the commit', () => {
    const behind = windowOf(repeat({ kind: 'ready', busy: false }, { side: 'behind', hovered: 1 }));
    expect(behind.repeat?.summary).toBe('Repeat 2 operations through the current step behind, as one numbered step.');
    expect(behind.footer?.commit.label).toBe('Repeat behind');
    // The axis taken stays the one chosen while another is only hovered: nothing moves under the pointer.
    expect(behind.repeat?.axis.value).toBe('0');
  });

  it('turns its cancel into Stop while the preview prepares, the range and axis still free to change', () => {
    const preparing = windowOf(repeat({ kind: 'preparing' }), verbs(), 'free');
    expect(preparing.footer?.cancel.label).toBe('Stop');
    expect(preparing.footer?.commit).toMatchObject({ label: 'Repeat on the other side', disabled: true });
    expect(preparing.instructions.notes).toEqual(['Preparing repeated folds…']);
    expect(preparing.steps?.disabled).toBe(false);
    expect(preparing.repeat?.axis.disabled).toBe(false);
    // An axis may be drawn while it prepares: a new one prepares anew.
    expect(preparing.freeLineSnap).toMatchObject({ label: 'Snap to points' });
    // While the repeat is added, nothing changes under it.
    const adding = windowOf(repeat({ kind: 'ready', busy: true }, { drawing: false }), verbs(), 'free');
    expect(adding.footer?.commit.disabled).toBe(true);
    expect(adding.steps?.disabled).toBe(true);
    expect(adding.repeat?.axis.disabled).toBe(true);
    expect(adding.freeLineSnap).toBeUndefined();
    expect(adding.lineMode).toBeNull();
    // Stopped, the commit prepares it again.
    const blocked = windowOf(repeat({ kind: 'stopped' }));
    expect(blocked.footer?.commit).toMatchObject({ label: 'Repeat on the other side', disabled: false });
    expect(blocked.instructions.notes).toEqual(['Stopped before the repeat was ready. No steps were added.']);
    const rebuilt = windowOf(repeat({ kind: 'ready', busy: false }, { rebuilding: true }));
    expect(rebuilt.footer?.commit.label).toBe('Update from source steps');
    // A rebuild adds as the repeat was added.
    expect(rebuilt.repeat?.individual).toBeNull();
  });

  it('says to tap the commit on a touch screen', () => {
    const view: FoldToolWindowView = { tool: 'repeat', lineMode: 'axiom-2', readOnly: null, picks: 0, preview: null, freeLineSnap: true, repeat: repeat({ kind: 'ready', busy: false }) };
    const model = foldToolWindow(t, view, verbs(), { coarse: true, alt: 'Option' });
    expect(model?.instructions.items.at(-1)).toBe('Tap Repeat on the other side to add the repeated folds.');
  });

  it('says why a repeat stopped in its own words, with its advice', () => {
    const blocked = windowOf(
      repeat({ kind: 'blocked', step: 0, stop: { code: 'witness_not_in_face', refusal: { code: 'witness_not_in_face' } } })
    );
    expect(blocked.refusal).toMatchObject({
      code: 'witness_not_in_face',
      title: 'Cannot repeat',
      text: 'Stopped at source operation 1: The spot the mirrored fold picks is not inside a layer on the moving side. Try another axis, or start the range after this operation.',
    });
    expect(blocked.footer?.commit.disabled).toBe(true);
    const none = windowOf(repeat({ kind: 'failed', stop: { code: 'repeat_axis' } }, { axes: [], axis: -1, drawing: false }));
    expect(none.refusal?.code).toBe('repeat_axis');
    expect(none.footer?.commit.disabled).toBe(true);
  });

  it('refuses a drawn line that is no axis, offering the nearest in its place', () => {
    const calls = verbs();
    const model = windowOf(repeat({ kind: 'ready', busy: false }, { drawn: { nearest: 1, line: true } }), calls);
    expect(model.refusal).toMatchObject({
      code: 'repeat_axis_drawn',
      title: 'Not a symmetry axis',
      text: 'This line does not pair matching material and layers in the starting model.',
    });
    expect(model.refusal?.actions.map((action) => action.label)).toEqual(['Use Center line, left to right']);
    model.refusal?.actions[0]?.run();
    expect(calls.repeat.setAxis).toHaveBeenCalledWith(1);
    expect(windowOf(repeat({ kind: 'preparing' }, { drawn: { nearest: -1, line: true } })).refusal?.actions).toEqual([]);
    // An axiom with no line through the picks: said so.
    expect(windowOf(repeat({ kind: 'preparing' }, { drawn: { nearest: -1, line: false } })).refusal?.text).toBe(
      'These picks locate no line here. Pick again, or choose an axis.'
    );
  });

  it('says a range that changes nothing as a whole, not as one operation', () => {
    const nothing = windowOf(repeat({ kind: 'blocked', step: 2, stop: { code: 'repeat_nothing' } }));
    expect(nothing.refusal?.text).toBe(
      'Every operation in the range is its own mirror across this axis, so repeating it changes nothing. Choose another axis or range.'
    );
  });

  it('chooses a layer order with the shared chooser, its own buttons in place of the footer', () => {
    const calls = verbs();
    const model = windowOf(repeat({ kind: 'choosing', step: 1, count: 3, index: 0, waiting: false, failed: false }), calls);
    expect(model.footer).toBeNull();
    expect(model.instructions.notes).toContain('Source operation 2 has 3 matching layer orders. Choose one to continue.');
    expect(model.repeat?.order).toMatchObject({ index: 0, count: 3, ready: true });
    model.repeat?.order?.step(1);
    model.repeat?.order?.accept();
    model.repeat?.order?.back();
    expect(calls.repeat.stepOrder).toHaveBeenCalledWith(1);
    expect(calls.repeat.acceptOrder).toHaveBeenCalledOnce();
    expect(calls.repeat.backFromOrder).toHaveBeenCalledOnce();
  });

  it('has nothing to offer at the flat sheet', () => {
    const model = windowOf(repeat({ kind: 'unavailable', why: 'sheet' }, { range: null, axes: null, axis: -1, drawing: false }));
    expect(model.steps).toBeNull();
    expect(model.instructions.notes).toEqual(['Fold a step first.']);
    expect(model.footer?.commit.disabled).toBe(true);
  });
});
