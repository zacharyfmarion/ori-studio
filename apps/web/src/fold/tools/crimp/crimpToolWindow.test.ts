import { describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import type { FoldCrossSection } from '../../engine/foldEngineWire';
import { foldToolWindow, type FoldPreview, type FoldToolHost, type FoldToolWindowView } from '../foldToolWindow';
import type { FoldReverseWindowView } from '../reverse/reverseToolWindow';

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
    hoverFlap: vi.fn(),
    cancel: vi.fn(),
    commit: vi.fn(),
    setReverseKind: vi.fn(),
    stepOpening: vi.fn(),
    stepOrder: vi.fn(),
    setSecondLineMode: vi.fn(),
    otherKind: vi.fn(),
  };
}

const mouse: FoldToolHost = { coarse: false, alt: 'Option' };
const finger: FoldToolHost = { coarse: true, alt: 'Alt' };

const view = (extra: Partial<FoldToolWindowView> = {}): FoldToolWindowView => ({
  tool: 'crimp',
  lineMode: 'free',
  secondLineMode: 'free',
  readOnly: null,
  picks: 0,
  preview: null,
  ...extra,
});

/** One flap of two layers at the first line: the triangle. */
const section: FoldCrossSection = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  flaps: [{ faces: [0, 1], witness: [0.2, 0.7] }],
  rows: [
    { faces: [1], spans: [[0, 1]], flap: 0 },
    { faces: [0], spans: [[0, 1]], flap: 0 },
  ],
  intervals: [{ start: 0, end: 1, faces: [1, 0], rows: [0, 1] }],
  order: { kind: 'layered', unordered: [] },
  layers: 2,
  joins: [{ upper: 0, lower: 1, at: 1 }],
};

const preview = (extra: Partial<FoldPreview> = {}): FoldPreview => ({
  section,
  interval: null,
  seed: 'all',
  added: [],
  refused: null,
  landing: false,
  ...extra,
});

const crimp = (extra: Partial<FoldReverseWindowView> = {}): FoldReverseWindowView => ({
  kind: 'inside',
  kinds: ['inside', 'outside'],
  known: true,
  ways: 0,
  way: 0,
  orders: 0,
  order: 0,
  ...extra,
});

describe('the crimp tool’s window', () => {
  it('locates the first line, then the second after it, the one in hand marked', () => {
    const first = foldToolWindow(t, view({ picks: 1 }), verbs(), mouse);
    expect(first).toMatchObject({ phase: 'locate', title: 'Crimp', meta: '2 settings', kind: null });
    expect(first?.compound).toBeUndefined();
    // What a crimp is, in a line, before the first click; which line is which, in the steps.
    expect(first?.instructions.intro).toBe('Turns a flap’s end in along one line and back out along a second.');
    expect(first?.instructions.items).toEqual([
      'Click where the first line starts, nearer the body: where the flap turns in.',
      'Click where it ends.',
      'Click where the second line starts, beyond the first toward the tip: where the flap turns back out.',
      'Click where it ends.',
      'Choose Inside or Outside, then press Enter.',
    ]);
    expect(first?.instructions.current).toBe(1);
    // What snaps is the first line's mode's while it is in hand, then the second's.
    expect(first?.instructions.notes[0]).toBe('No snapping: the line runs exactly through the points you click.');
    expect(first?.lineMode).toMatchObject({ label: 'First line', value: 'free' });
    expect(first?.secondLine).toMatchObject({ label: 'Second line', value: 'free' });
    expect(first?.secondLine?.options.map((option) => [option.id, option.label])).toEqual([
      ['free', 'Free line'],
      ['crease', 'Existing crease'],
    ]);

    // An axiom's first line, a crease's second: its one click after the axiom's.
    const second = foldToolWindow(t, view({ lineMode: 'axiom-2', secondLineMode: 'crease', picks: 2 }), verbs(), finger);
    expect(second?.instructions.items.slice(2)).toEqual([
      'Tap the crease or folded edge beyond the first line where the flap turns back out.',
      'Choose Inside or Outside, then tap Crimp.',
    ]);
    expect(second?.instructions.current).toBe(2);
    expect(second?.instructions.notes).toEqual([
      'Folding along a precrease refolds it; along a folded edge, it unfolds the flap.',
    ]);

    // An axiom left in hand by the fold before: its steps, and how to draw the line instead.
    const axiom = foldToolWindow(t, view({ lineMode: 'axiom-2', picks: 0 }), verbs(), mouse);
    expect(axiom?.instructions.items.slice(0, 2)).toEqual(['Click the point to move.', 'Click where it should land.']);
    expect(axiom?.instructions.notes[0]).toBe(
      'The first line is located by Axiom 2: point onto point, the line mode in hand. To draw it, choose Free line under First line.'
    );
  });

  it('passes on a second line mode, and only one that is one', () => {
    const calls = verbs();
    const model = foldToolWindow(t, view(), calls, mouse);
    model?.secondLine?.set('crease');
    model?.secondLine?.set('axiom-2');
    expect(calls.setSecondLineMode.mock.calls).toEqual([['crease']]);
    expect(foldToolWindow(t, view({ readOnly: 'newer' }), calls, mouse)?.secondLine?.disabled).toBe(true);
  });

  it('previews the crimp under its kind’s name, with the kinds that fit and its listed choices', () => {
    const calls = verbs();
    const both = foldToolWindow(t, view({ picks: 4, preview: preview(), crimp: crimp() }), calls, mouse);
    expect(both).toMatchObject({ phase: 'preview', title: 'Inside crimp', meta: '3 settings', lineMode: null });
    expect(both?.secondLine).toBeUndefined();
    expect(both?.compound?.kind?.note).toBe('Both kinds of crimp fit here: choose which way the tip goes.');
    expect(both?.compound?.kind?.options.map((option) => [option.value, option.short, option.label, option.disabled])).toEqual([
      ['inside', 'Inside', 'Inside crimp', false],
      ['outside', 'Outside', 'Outside crimp', false],
    ]);
    both?.compound?.kind?.set('outside');
    expect(calls.setReverseKind).toHaveBeenCalledWith('outside');
    expect(both?.movingSide?.label).toBe('Tip side');
    // The tip, the kind, the flaps, then the commit, as the window shows them.
    expect(both?.instructions.items).toEqual([
      'The end beyond the second line turns: if it is the wrong end, press Swap.',
      'Choose Inside to tuck the end inside the flap, or Outside to wrap it round.',
      'Under Layers, leave out any flap that should not crimp.',
      'Press Enter, or click Inside crimp, to fold.',
    ]);
    expect(both?.footer?.commit.label).toBe('Inside crimp');

    // Only the outside fits: no kind to choose, so no control and no step for it; the title names it.
    const only = foldToolWindow(t, view({ picks: 4, preview: preview(), crimp: crimp({ kind: 'outside', kinds: ['outside'] }) }), calls, mouse);
    expect(only?.title).toBe('Outside crimp');
    expect(only?.compound?.kind).toBeNull();
    expect(only?.meta).toBe('2 settings');
    expect(only?.instructions.items).toHaveLength(3);

    // An opening and an order to choose: a stepper each.
    const choosing = foldToolWindow(
      t,
      view({ picks: 4, preview: preview(), crimp: crimp({ ways: 3, way: 1, orders: 2, order: 0 }) }),
      calls,
      mouse
    );
    expect(choosing?.meta).toBe('5 settings');
    expect(choosing?.compound?.opening).toMatchObject({ label: 'Opening', value: '2 of 3' });
    expect(choosing?.compound?.order).toMatchObject({ label: 'Layer order', value: '1 of 2' });
    choosing?.compound?.opening?.next.run();
    expect(calls.stepOpening).toHaveBeenCalledWith(1);
  });

  it('says its refusals in a crimp’s words, and its fixes name a crimp', () => {
    const calls = verbs();
    const refusedPreview = (refused: FoldPreview['refused']) =>
      foldToolWindow(t, view({ picks: 4, preview: preview({ refused }), crimp: crimp({ kinds: [] }) }), calls, mouse);
    const meet = refusedPreview({ refusal: { code: 'crimp_lines_meet', faces: [0] }, fixes: [] });
    expect(meet?.refusal).toMatchObject({ code: 'crimp_lines_meet', title: 'The lines meet', actions: [] });
    expect(meet?.refusal?.text).toMatch(/Press Esc and draw the second line clear of the first/);
    expect(meet?.footer?.commit.disabled).toBe(true);
    // Neither kind fits, and nothing to press: what to draw instead.
    const neither = refusedPreview({ refusal: { code: 'crimp_kind_infeasible', kind: 'inside', faces: [0] }, fixes: [] });
    expect(neither?.refusal?.text).toBe(
      'Neither an inside nor an outside crimp fits these lines: no way of stacking the layers lets the tip turn on both. Press Esc and draw the lines closer to parallel, or crimp fewer flaps.'
    );
    // The second line beyond nothing: the tip may be the other end.
    const misses = refusedPreview({ refusal: { code: 'crimp_misses_tip', faces: [0] }, fixes: [] });
    expect(misses?.refusal?.text).toMatch(/^The second line crosses none of the paper beyond the first.*Swap the tip side/);
    const everything = refusedPreview({
      refusal: { code: 'nothing_stays' },
      fixes: [{ fix: 'pick_flap', flaps: [{ faces: [0, 1], witness: [0.2, 0.7] }] }],
    });
    expect(everything?.refusal?.actions.map((action) => action.label)).toEqual(['Crimp flap 1 only']);
    everything?.refusal?.actions[0]?.run();
    expect(calls.pickFlap).toHaveBeenCalledWith({ faces: [0, 1], witness: [0.2, 0.7] });
    const kind = refusedPreview({
      refusal: { code: 'crimp_kind_infeasible', kind: 'inside', faces: [0] },
      fixes: [{ fix: 'other_kind', kind: 'outside' }],
    });
    expect(kind?.refusal?.title).toBe('It cannot crimp inside');
    expect(kind?.refusal?.actions.map((action) => action.label)).toEqual(['Outside crimp instead']);
    kind?.refusal?.actions[0]?.run();
    expect(calls.otherKind).toHaveBeenCalledWith('outside');
  });
});
