import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import type { FoldCrossSection } from '../engine/foldEngineWire';
import { FOLD_DIVIDE_DEFAULT, type FoldDivideSettings } from './foldToolState';
import {
  foldToolWindow,
  type FoldPreview,
  type FoldToolHost,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from './foldToolWindow';

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
  } satisfies FoldToolWindowVerbs;
}

const mouse: FoldToolHost = { coarse: false, alt: 'Option' };
const finger: FoldToolHost = { coarse: true, alt: 'Alt' };

const view = (extra: Partial<FoldToolWindowView> = {}): FoldToolWindowView => ({
  tool: 'valley',
  lineMode: 'axiom-2',
  readOnly: null,
  picks: 0,
  preview: null,
  ...extra,
});

/** Two flaps of two layers each at the line: the square folded in half twice. */
const section: FoldCrossSection = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  flaps: [
    { faces: [2, 3], witness: [0.2, 0.7] },
    { faces: [0, 1], witness: [0.2, 0.2] },
  ],
  rows: [
    { faces: [3], spans: [[0, 1]], flap: 0 },
    { faces: [2], spans: [[0, 1]], flap: 0 },
    { faces: [1], spans: [[0, 1]], flap: 1 },
    { faces: [0], spans: [[0, 1]], flap: 1 },
  ],
  intervals: [{ start: 0, end: 1, faces: [3, 2, 1, 0], rows: [0, 1, 2, 3] }],
  order: { kind: 'layered', unordered: [] },
  layers: 4,
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

describe('foldToolWindow while the line is located', () => {
  it('numbers the line mode’s clicks, marks the one in hand, and ends on picking the fold', () => {
    const model = foldToolWindow(t, view({ picks: 1 }), verbs(), mouse);
    expect(model?.phase).toBe('locate');
    expect(model?.title).toBe('Valley fold');
    expect(model?.meta).toBe('1 setting');
    expect(model?.instructions.items).toEqual([
      'Click the point to move.',
      'Click where it should land.',
      'Pick the fold and the layers, then press Enter.',
    ]);
    expect(model?.instructions.current).toBe(1);
    expect(model?.instructions.notes).toEqual([
      'Points snap to corners, marks, crease crossings, midpoints and edges.',
      'Hold Option to put a point down anywhere, without snapping.',
      'Esc clears the picks.',
    ]);
    expect(model?.kind).toBeNull();
    expect(model?.footer).toBeNull();
  });

  it('gives every line mode its own steps, in click order', () => {
    const steps = (lineMode: FoldToolWindowView['lineMode']) =>
      foldToolWindow(t, view({ lineMode }), verbs(), mouse)?.instructions.items.length;
    expect(steps('axiom-1')).toBe(3);
    expect(steps('axiom-5')).toBe(4);
    expect(steps('axiom-6')).toBe(5);
    expect(steps('free')).toBe(3);
    expect(steps('crease')).toBe(2);
  });

  it('offers no keys to a finger, and names the button it will tap', () => {
    const model = foldToolWindow(t, view({ tool: 'mountain' }), verbs(), finger);
    expect(model?.instructions.items.at(-1)).toBe('Pick the fold and the layers, then tap Mountain fold.');
    expect(model?.instructions.notes).toEqual([
      'Points snap to corners, marks, crease crossings, midpoints and edges.',
    ]);
    const free = foldToolWindow(t, view({ lineMode: 'free' }), verbs(), finger);
    expect(free?.instructions.notes).toEqual(['No snapping: the line runs exactly through the points you tap.']);
  });

  it('says tap to a finger, at every step and in every note, and click to a mouse', () => {
    const words = (host: typeof finger, lineMode: FoldToolWindowView['lineMode']) => {
      const model = foldToolWindow(t, view({ lineMode }), verbs(), host);
      return [...(model?.instructions.items ?? []), ...(model?.instructions.notes ?? [])].join(' ');
    };
    for (const lineMode of ['axiom-1', 'axiom-2', 'axiom-3', 'axiom-4', 'axiom-5', 'axiom-6', 'axiom-7', 'free', 'crease'] as const) {
      expect(words(finger, lineMode), lineMode).not.toMatch(/\bclick/i);
      expect(words(finger, lineMode), lineMode).toMatch(/\bTap\b/);
      expect(words(mouse, lineMode), lineMode).not.toMatch(/\btap\b/i);
    }
    expect(foldToolWindow(t, view({ lineMode: 'axiom-2' }), verbs(), finger)?.instructions.items.slice(0, 2)).toEqual([
      'Tap the point to move.',
      'Tap where it should land.',
    ]);
    // The layers' help, once there is a fold to pick them for.
    expect(foldToolWindow(t, view({ preview: preview() }), verbs(), finger)?.layers?.help).toMatch(/^Tap a layer/);
    expect(foldToolWindow(t, view({ preview: preview() }), verbs(), mouse)?.layers?.help).toMatch(/^Click a layer/);
  });

  it('says when a line drawn on the crease pattern runs through its points as they lie folded', () => {
    const across = foldToolWindow(t, view({ lineMode: 'free', picks: 2, preview: preview({ acrossLayers: true }) }), verbs(), mouse);
    expect(across?.instructions.notes).toEqual([
      'These points lie on layers that are folded apart, so the line runs through them where they lie in the folded form. The crease pattern shows the creases it makes.',
    ]);
    const drawn = foldToolWindow(t, view({ lineMode: 'free', picks: 2, preview: preview() }), verbs(), mouse);
    expect(drawn?.instructions.notes).toEqual([]);
  });

  it('keeps the step in hand inside the list once every reference is picked', () => {
    expect(foldToolWindow(t, view({ picks: 9 }), verbs(), mouse)?.instructions.current).toBe(2);
  });

  it('offers every line mode in the select, and passes on a choice that is one', () => {
    const calls = verbs();
    const select = foldToolWindow(t, view(), calls, mouse)?.lineMode;
    expect(select?.label).toBe('Locate line');
    expect(select?.value).toBe('axiom-2');
    expect(select?.options.map((option) => option.label)).toEqual([
      'Axiom 1: through two points',
      'Axiom 2: point onto point',
      'Axiom 3: edge onto edge',
      'Axiom 4: perpendicular through a point',
      'Axiom 5: point onto a line, through a point',
      'Axiom 6: two points onto two lines',
      'Axiom 7: point onto a line, perpendicular',
      'Free line',
      'Existing crease',
    ]);
    select?.set('crease');
    select?.set('not-a-mode');
    expect(calls.selectLineMode.mock.calls).toEqual([['crease']]);
  });
});

describe('foldToolWindow with a fold under preview', () => {
  it('shows the kind, the moving side, the layers and the footer, and binds each', () => {
    const calls = verbs();
    const model = foldToolWindow(t, view({ preview: preview() }), calls, mouse);
    expect(model?.phase).toBe('preview');
    expect(model?.meta).toBe('3 settings');
    expect(model?.instructions.items).toEqual(['Pick which layers move.', 'Press Enter to fold.']);
    expect(model?.lineMode).toBeNull();

    expect(model?.kind?.value).toBe('valley');
    expect(model?.kind?.options.map((option) => option.label)).toEqual(['Valley fold', 'Mountain fold', 'Precrease']);
    model?.kind?.set('precrease');
    expect(calls.selectTool).toHaveBeenCalledWith('precrease');

    expect(model?.movingSide?.swapLabel).toBe('Swap');
    model?.movingSide?.swap();
    expect(calls.swapSide).toHaveBeenCalledTimes(1);

    expect(model?.layers?.summary).toBe('4 of 4 layers moving');
    expect(model?.layers?.picker?.rows.map((row) => row.state)).toEqual(['picked', 'picked', 'picked', 'picked']);
    expect(model?.layers?.chips.map((chip) => chip.pressed)).toEqual([true, true]);
    model?.layers?.toggle(1);
    model?.layers?.hover(0);
    expect(calls.toggleFlap).toHaveBeenCalledWith(1);
    expect(calls.hoverFlap).toHaveBeenCalledWith(0);

    expect(model?.footer?.cancel.label).toBe('Cancel');
    expect(model?.footer?.cancel.shortcut).toBe('viewport.cancel');
    expect(model?.footer?.commit).toMatchObject({ label: 'Valley fold', shortcut: 'fold.commit', disabled: false });
    model?.footer?.commit.run();
    model?.footer?.cancel.run();
    expect(calls.commit).toHaveBeenCalledTimes(1);
    expect(calls.cancel).toHaveBeenCalledTimes(1);
    expect(model?.refusal).toBeNull();
  });

  it('reads a narrowed seed and what the fold moved besides', () => {
    const model = foldToolWindow(t, view({ preview: preview({ seed: [1], added: [] }) }), verbs(), mouse);
    expect(model?.layers?.summary).toBe('2 of 4 layers moving');
    expect(model?.layers?.chips.map((chip) => chip.pressed)).toEqual([false, true]);
    const anyway = foldToolWindow(t, view({ preview: preview({ seed: [1], added: [0] }) }), verbs(), mouse);
    expect(anyway?.layers?.summary).toBe('4 of 4 layers moving');
    expect(anyway?.layers?.chips.map((chip) => chip.added)).toEqual([true, false]);
  });

  it('says it is still finding the layers until the section arrives', () => {
    const model = foldToolWindow(t, view({ preview: preview({ section: null }) }), verbs(), mouse);
    expect(model?.layers?.picker).toBeNull();
    expect(model?.layers?.summary).toBeNull();
    expect(model?.layers?.finding).toBe('Finding the layers at the line…');
    expect(model?.layers?.chips).toEqual([]);
  });

  it('refuses to commit while the fold is landing, refused or read-only, and offers the fixes', () => {
    const commit = (extra: Partial<FoldToolWindowView>) =>
      foldToolWindow(t, view(extra), verbs(), mouse)?.footer?.commit.disabled;
    expect(commit({ preview: preview({ landing: true }) })).toBe(true);
    expect(commit({ preview: preview(), readOnly: 'locked' })).toBe(true);

    const calls = verbs();
    const refused = foldToolWindow(
      t,
      view({
        preview: preview({
          seed: [1],
          refused: {
            refusal: { code: 'closure_adds_flaps', added: [0] },
            fixes: [{ fix: 'include_flaps', flaps: [0] }, { fix: 'opposite_direction' }],
          },
        }),
      }),
      calls,
      mouse
    );
    expect(refused?.footer?.commit.disabled).toBe(true);
    expect(refused?.refusal?.title).toBe('More flaps would move');
    // The engine's flap 0 is the top flap at the line: Flap 1 on screen, as its chip says.
    expect(refused?.refusal?.actions.map((action) => action.label)).toEqual([
      'Include flap 1',
      'Mountain fold instead',
    ]);
    expect(refused?.layers?.chips.map((chip) => [chip.name, chip.needed])).toEqual([
      ['Flap 1', true],
      ['Flap 2', false],
    ]);
    refused?.refusal?.actions[0]?.run();
    expect(calls.includeFlaps).toHaveBeenCalledWith([0]);
  });

  it('holds the controls on a read-only sequence', () => {
    const model = foldToolWindow(t, view({ preview: preview(), readOnly: 'newer' }), verbs(), mouse);
    expect(model?.kind?.disabled).toBe(true);
    expect(model?.movingSide?.disabled).toBe(true);
    expect(model?.layers?.disabled).toBe(true);
    expect(model?.footer?.cancel.disabled).toBe(false);
    expect(foldToolWindow(t, view({ readOnly: 'newer' }), verbs(), mouse)?.lineMode?.disabled).toBe(true);
  });
});

describe('foldToolWindow for the other tools', () => {
  it('says how to use the Divide line', () => {
    const model = foldToolWindow(t, view({ tool: 'divide-line' }), verbs(), mouse);
    expect(model?.phase).toBe('divide');
    expect(model?.title).toBe('Divide line');
    expect(model?.meta).toBe('Instructions');
    expect(model?.instructions.items).toEqual([
      'Click an edge or crease to divide it.',
      'Use the new points as references for any fold.',
    ]);
    // The step says what can be divided: no note says it again.
    expect(model?.instructions.notes).toEqual([]);
  });

  it('locates the reverse fold’s line, then names the window for the kind it folds', () => {
    const locating = foldToolWindow(t, view({ tool: 'inside-reverse' }), verbs(), mouse);
    expect(locating).toMatchObject({ phase: 'locate', title: 'Reverse fold', kind: null });
    expect(locating?.lineMode?.value).toBe('axiom-2');
    // Once the line is in, the flaps that reverse are picked: no plain fold's kind.
    expect(locating?.instructions.items.at(-1)).toBe('Pick which flaps reverse, then press Enter.');
    const reverse = { kind: 'outside' as const, kinds: ['outside' as const], known: true, ways: 0, way: 0, orders: 0, order: 0 };
    const previewing = foldToolWindow(t, view({ tool: 'inside-reverse', preview: preview(), reverse }), verbs(), mouse);
    expect(previewing).toMatchObject({ phase: 'preview', title: 'Outside reverse fold', kind: null });
    // Only the outside fits: the title names it, and there is no kind to choose.
    expect(previewing?.compound?.kind).toBeNull();
    expect(previewing?.meta).toBe('2 settings');
    expect(previewing?.compound?.opening).toBeNull();
    expect(previewing?.footer?.commit.label).toBe('Outside reverse fold');
    // Both fit: the kind is the folder's to choose.
    const both = foldToolWindow(
      t,
      view({ tool: 'inside-reverse', preview: preview(), reverse: { ...reverse, kinds: ['inside', 'outside'] } }),
      verbs(),
      mouse
    );
    expect(both?.compound?.kind?.options.map((option) => [option.value, option.disabled])).toEqual([
      ['inside', false],
      ['outside', false],
    ]);
    expect(both?.compound?.kind?.note).toBe('Both kinds fit here: choose which way the tip goes.');
  });

  it('names the flaps a refused tip can open by their chips, when the engine lists only those', () => {
    const reverse = { kind: 'inside' as const, kinds: ['inside' as const], known: true, ways: 0, way: 0, orders: 0, order: 0 };
    const bottom = section.flaps[1]!;
    const refused = {
      refusal: { code: 'reverse_no_opening' as const, faces: [2], cause: 'no_spine' as const },
      fixes: [{ fix: 'pick_flap' as const, flaps: [bottom] }],
    };
    const bound = verbs();
    const model = foldToolWindow(t, view({ tool: 'inside-reverse', preview: preview({ refused }), reverse }), bound, mouse);
    // The chips read Flap 1 for the top flap, Flap 2 for the bottom one: the one the fix lists.
    expect(model?.layers?.chips.map((chip) => chip.name)).toEqual(['Flap 1', 'Flap 2']);
    expect(model?.refusal?.actions.map((action) => action.label)).toEqual(['Reverse flap 2 only']);
    model?.refusal?.actions[0]?.run();
    expect(bound.pickFlap).toHaveBeenCalledWith(bottom);
  });

  it('offers the Divide line’s count, its exact ratio, and clearing the marks made here', () => {
    const setDivide = vi.fn();
    const clearMarks = vi.fn();
    const divide = (settings: Partial<FoldDivideSettings>, marks = 2) => ({
      settings: { ...FOLD_DIVIDE_DEFAULT, ...settings },
      marks,
    });
    const bound = { ...verbs(), setDivide, clearMarks };
    const counted = foldToolWindow(t, view({ tool: 'divide-line', divide: divide({}) }), bound, mouse)?.divide;
    expect(counted?.parts).toMatchObject({ value: 2, min: 2, max: 32 });
    expect(counted?.ratio).toBeNull();
    expect(counted?.clear).toMatchObject({ label: 'Clear the 2 marks made here', disabled: false });
    counted?.clear.run();
    expect(clearMarks).toHaveBeenCalled();

    const ratio = foldToolWindow(t, view({ tool: 'divide-line', divide: divide({ mode: 'ratio' }, 0) }), bound, mouse)
      ?.divide;
    expect(ratio?.parts).toBeNull();
    expect(ratio?.ratio?.readout).toBe('Computed ratio 1 : 1');
    expect(ratio?.clear.disabled).toBe(true);
    // Edit's ratio fields' spelling: a radical is accepted, nonsense is not.
    expect(ratio?.ratio?.right.set('sqrt(2)')).toBe(true);
    expect(setDivide).toHaveBeenLastCalledWith({ ratio: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 2 } });
    expect(ratio?.ratio?.left.set('two')).toBe(false);
    // Without the verbs, a surface offers none.
    expect(foldToolWindow(t, view({ tool: 'divide-line', divide: divide({}) }), verbs(), mouse)?.divide).toBeNull();
  });
});

describe('foldToolWindow for a precrease of part of its line', () => {
  const precrease = (extra: Partial<FoldToolWindowView> = {}) =>
    view({ tool: 'precrease', extent: { mode: 'pinch', picked: 0 }, ...extra });
  const withExtent = () => ({ ...verbs(), setExtent: vi.fn() });

  it('offers the extent from the start, and adds its clicks along the line to the steps', () => {
    const calls = withExtent();
    const model = foldToolWindow(t, precrease(), calls, { ...mouse, keyLabel: (id) => (id === 'fold.cycleExtent' ? 'E' : undefined) });
    expect(model?.meta).toBe('2 settings');
    expect(model?.extent).toMatchObject({ label: 'Extent', value: 'pinch' });
    expect(model?.extent?.options.map((option) => option.short)).toEqual(['Whole line', 'Segment', 'Pinch']);
    expect(model?.extent?.note).toBe('Crease only a short mark, centred on a point you click along the line.');
    expect(model?.instructions.items).toEqual([
      'Click the point to move.',
      'Click where it should land.',
      'Click where to pinch along the line.',
      'Pick the fold and the layers, then press Enter.',
    ]);
    expect(model?.instructions.notes.at(-1)).toBe('Press E to step through the extents.');
    model?.extent?.set('segment');
    expect(calls.setExtent).toHaveBeenCalledWith('segment');
    // The whole line says nothing more, and another tool has no extent.
    const whole = foldToolWindow(t, precrease({ extent: { mode: 'whole', picked: 0 } }), calls, mouse);
    expect(whole?.extent?.note).toBeNull();
    expect(whole?.instructions.items).toHaveLength(3);
    expect(foldToolWindow(t, view({ extent: { mode: 'pinch', picked: 0 } }), calls, mouse)?.extent).toBeUndefined();
  });

  it('marks the click along the line in hand and holds the commit until every point is in', () => {
    const model = foldToolWindow(
      t,
      precrease({ picks: 2, extent: { mode: 'segment', picked: 1 }, preview: preview({ incomplete: true }) }),
      withExtent(),
      mouse
    );
    expect(model?.phase).toBe('preview');
    expect(model?.meta).toBe('4 settings');
    expect(model?.instructions.items).toEqual([
      'Click where the crease starts along the line.',
      'Click where it ends.',
      'Pick which layers move.',
      'Press Enter to fold.',
    ]);
    expect(model?.instructions.current).toBe(1);
    expect(model?.instructions.notes).toEqual([
      'Points snap to where the line crosses creases, edges and marks, to points on it, and to its middle.',
      'Hold Option to put a point down anywhere, without snapping.',
      'Esc takes back the last point.',
    ]);
    expect(model?.footer?.commit).toMatchObject({ label: 'Precrease', disabled: true });
    // Every point in: the layers are next, and a pinch is committed by its own name.
    const pinched = foldToolWindow(
      t,
      precrease({ picks: 2, extent: { mode: 'pinch', picked: 1 }, preview: preview() }),
      withExtent(),
      finger
    );
    expect(pinched?.instructions.current).toBe(1);
    expect(pinched?.instructions.items.at(-1)).toBe('Tap Pinch to fold.');
    expect(pinched?.instructions.notes).toEqual([]);
    expect(pinched?.footer?.commit).toMatchObject({ label: 'Pinch', disabled: false });
  });

  it('words a partial precrease’s refusal, with the fixes the tool can make', () => {
    const calls = { ...withExtent(), useWholeLine: vi.fn(), pinchInstead: vi.fn(), throughAllLayers: vi.fn() };
    const refused = (code: string, mode: 'segment' | 'pinch', seed: FoldPreview['seed'] = 'all') =>
      foldToolWindow(
        t,
        precrease({ picks: 2, extent: { mode, picked: mode === 'segment' ? 2 : 1 }, preview: preview({ seed, refused: { refusal: { code } as never, fixes: [] } }) }),
        calls,
        mouse
      )?.refusal;
    const short = refused('extent_too_short', 'segment');
    expect(short?.title).toBe('Too short to crease');
    expect(short?.actions.map((action) => action.label)).toEqual(['Pinch there instead', 'Use the whole line']);
    short?.actions[0]?.run();
    expect(calls.pinchInstead).toHaveBeenCalled();
    const layers = refused('extent_misses_layers', 'pinch', [0]);
    expect(layers?.title).toBe('No layer to crease there');
    expect(layers?.actions.map((action) => action.label)).toEqual(['Crease through all layers', 'Use the whole line']);
    layers?.actions[0]?.run();
    expect(calls.throughAllLayers).toHaveBeenCalled();
    // Through every layer already: only the whole line.
    expect(refused('extent_misses_layers', 'pinch')?.actions.map((action) => action.label)).toEqual(['Use the whole line']);
    expect(refused('mark_on_crease', 'pinch')?.actions).toEqual([]);
  });
});

it('offers every construction separately for the mountain and valley lines of a pleat', () => {
  const calls = { ...verbs(), setSecondLineMode: vi.fn() };
  const model = foldToolWindow(t, view({ tool: 'pleat', lineMode: 'free', secondLineMode: 'free', picks: 2 }), calls, mouse)!;
  expect(model.secondLine?.options.map((option) => option.id)).toEqual(model.lineMode?.options.map((option) => option.id));
  expect(model.secondLine?.options).toHaveLength(9);
  model.secondLine?.set('axiom-4');
  expect(calls.setSecondLineMode).toHaveBeenCalledWith('axiom-4');
  model.lineMode?.set('axiom-1');
  expect(calls.selectLineMode).toHaveBeenCalledWith('axiom-1', 'first');
});

it('says while a pleat’s layer orders are searched for, beside the Escape that stops it, and that a confirmation made meanwhile waits', () => {
  const pleat = { tool: 'pleat', lineMode: 'free', secondLineMode: 'free', picks: 4 } as const;
  const found = foldToolWindow(t, view({ ...pleat, preview: preview() }), verbs(), mouse)!;
  expect(found.instructions.notes).toContain('Esc clears the picks.');
  const searching = foldToolWindow(t, view({ ...pleat, preview: preview({ searching: true, queued: true }) }), verbs(), mouse)!;
  expect(searching.instructions.notes).toEqual([
    ...found.instructions.notes,
    'Working out how the pleat’s layers can stack…',
    'Folding as soon as the preview is ready…',
  ]);
  expect(searching.footer?.cancel.shortcut).toBe('viewport.cancel');
});
