import { describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import type { FoldCrossSection } from '../../engine/foldEngineWire';
import { foldToolWindow, type FoldPreview, type FoldToolWindowVerbs, type FoldToolWindowView } from '../foldToolWindow';
import type { FoldSinkWindowView } from './sinkToolWindow';

const t = i18n.t.bind(i18n);

function verbs() {
  return {
    selectTool: vi.fn(),
    selectLineMode: vi.fn(),
    includeFlaps: vi.fn(),
    foldOtherWay: vi.fn(),
    pickFlap: vi.fn(),
    useLine: vi.fn(),
    otherSink: vi.fn(),
    swapSide: vi.fn(),
    toggleFlap: vi.fn(),
    cancel: vi.fn(),
    commit: vi.fn(),
    stepOrder: vi.fn(),
    stepPocket: vi.fn(),
  } satisfies FoldToolWindowVerbs;
}

const section = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  flaps: [{ faces: [0, 1, 2, 3], witness: [0.4, 0.45] }],
  rows: [{ faces: [0], spans: [[0, 1]], flap: 0 }],
  intervals: [{ start: 0, end: 1, faces: [0], rows: [0] }],
  order: { kind: 'layered', unordered: [] },
  layers: 4,
  joins: [],
} as unknown as FoldCrossSection;

const preview = (extra: Partial<FoldPreview> = {}): FoldPreview => ({
  section,
  interval: null,
  seed: 'all',
  added: [],
  refused: null,
  landing: false,
  ...extra,
});

const sink = (extra: Partial<FoldSinkWindowView> = {}): FoldSinkWindowView => ({
  tool: 'open-sink',
  known: true,
  openRefusal: null,
  pocketsFound: 2,
  pockets: 0,
  pocket: 0,
  pocketName: null,
  orders: 0,
  order: 0,
  depth: 0.212132,
  sunk: 0,
  ...extra,
});

const window = (view: Partial<FoldToolWindowView>, calls = verbs()) => {
  const model = foldToolWindow(
    t,
    { tool: 'open-sink', lineMode: 'axiom-4', readOnly: null, picks: 0, preview: null, ...view },
    calls,
    { coarse: false, alt: 'Alt' }
  );
  if (!model) throw new Error('no window');
  return model;
};

describe('the sink tools’ window', () => {
  it('locates each sink’s line as every fold does, saying what the line is to it', () => {
    const open = window({ picks: 1 });
    expect(open).toMatchObject({ phase: 'locate', title: 'Open sink' });
    expect(open.sink).toBeUndefined();
    expect(open.lineMode?.value).toBe('axiom-4');
    expect(open.instructions.current).toBe(1);
    expect(open.instructions.notes[0]).toBe(
      'The line across the point sets how deep it sinks, and must be exactly square to its centre line: Axiom 4 draws one.'
    );
    // Once the line is in, the point that sinks is picked: said as the last step, not a plain fold's.
    expect(open.instructions.items.at(-1)).toBe('Pick the point, then press Enter.');
    expect(window({ tool: 'closed-sink' }).instructions.notes[0]).toBe('The line across the point sets how deep it sinks.');
    const unsink = window({ tool: 'unsink', lineMode: 'crease' });
    expect(unsink.title).toBe('Unsink');
    // What its line is, and nothing of what folding along any crease does.
    expect(unsink.instructions.notes).toEqual(['The line is a crease of the ring the sink left, along the sunk point’s top.']);
    // Its sunk point is found for the folder.
    expect(unsink.instructions.items.at(-1)).toBe('Press Enter to fold.');
  });

  it('switches between the open and the closed sink while there is a choice, the one that does not fit disabled with why', () => {
    const calls = verbs();
    const tilted = window(
      { preview: preview(), sink: sink({ openRefusal: 'sink_line_tilted' }) },
      calls
    );
    // The open sink in hand does not fit; the closed one does: a choice.
    const kind = tilted.sink?.kind;
    expect(kind?.value).toBe('open');
    expect(kind?.options.map((option) => [option.short, option.disabled, option.reason])).toEqual([
      ['Open', true, 'The line is not square to the point'],
      ['Closed', false, null],
    ]);
    expect(kind?.note).toBe('Only the closed sink fits here.');
    kind?.set('closed');
    expect(calls.selectTool).toHaveBeenCalledWith('closed-sink');
    // The depth; the rule for its line was said while it was located, and the refusal's fix folds along it.
    expect(tilted.sink).not.toHaveProperty('square');
    expect(tilted.sink?.depth).toMatchObject({ label: 'Depth', value: '0.212 from the tip' });
    expect(tilted.movingSide?.label).toBe('Tip side');

    const both = window({ tool: 'closed-sink', preview: preview(), sink: sink({ tool: 'closed-sink' }) });
    expect(both.title).toBe('Closed sink');
    expect(both.sink?.kind?.value).toBe('closed');
    expect(both.sink?.kind?.note).toContain('Both sinks fit here');

    // Only the sink in hand fits: nothing to choose, so no control; the title names it.
    const pocketless = window({ preview: preview(), sink: sink({ pocketsFound: 0 }) });
    expect(pocketless.sink?.kind).toBeNull();
    expect(pocketless.meta).toBe('2 settings');
    // Nor before the engine has described the point.
    expect(window({ preview: preview(), sink: sink({ known: false }) }).sink?.kind).toBeNull();
  });

  it('steps a closed sink’s pockets, named front and back, and the layer orders', () => {
    const calls = verbs();
    const model = window(
      {
        tool: 'closed-sink',
        preview: preview(),
        sink: sink({ tool: 'closed-sink', pockets: 2, pocket: 1, pocketName: 'back', orders: 3, order: 0 }),
      },
      calls
    );
    expect(model.sink?.pocket).toMatchObject({ label: 'Pocket', value: 'Back' });
    model.sink?.pocket?.next.run();
    expect(calls.stepPocket).toHaveBeenCalledWith(1);
    expect(model.sink?.order).toMatchObject({ label: 'Layer order', value: '1 of 3' });
    model.sink?.order?.previous.run();
    expect(calls.stepOrder).toHaveBeenCalledWith(-1);
    expect(model.meta).toBe('5 settings');
    // Numbered when the viewer sees none nearer.
    const numbered = window({
      tool: 'closed-sink',
      preview: preview(),
      sink: sink({ tool: 'closed-sink', pockets: 3, pocket: 2 }),
    });
    expect(numbered.sink?.pocket?.value).toBe('3 of 3');
    // An open sink has no pocket to choose.
    expect(window({ preview: preview(), sink: sink({ pockets: 2 }) }).sink?.pocket).toBeNull();
  });

  it('words a tilted line’s refusal, with the square line and the closed sink as fixes that act', () => {
    const calls = verbs();
    const square = { fix: 'use_line' as const, line: { n: [0, 1] as [number, number], d: 0.4 }, side: 'positive' as const };
    const model = window(
      {
        preview: preview({
          refused: {
            refusal: { code: 'sink_line_tilted', offset: 0.01, faces: [0] },
            fixes: [square, { fix: 'other_sink', kind: 'closed' }],
          },
        }),
        sink: sink({ openRefusal: 'sink_line_tilted' }),
      },
      calls
    );
    expect(model.refusal?.title).toBe('The line is not square to the point');
    expect(model.refusal?.actions.map((action) => action.label)).toEqual(['Use the square line', 'Closed sink instead']);
    model.refusal?.actions[0]?.run();
    expect(calls.useLine).toHaveBeenCalledWith(square);
    model.refusal?.actions[1]?.run();
    expect(calls.otherSink).toHaveBeenCalledWith('closed');
    expect(model.footer?.commit.disabled).toBe(true);
  });

  it('finds an unsink’s sunk point for the folder, its side the sunk side, with no kind to choose', () => {
    const model = window({ tool: 'unsink', preview: preview(), sink: sink({ tool: 'unsink', depth: null, sunk: 2 }) });
    expect(model.sink?.kind).toBeNull();
    expect(model.sink?.depth).toBeNull();
    expect(model.movingSide?.label).toBe('Sunk side');
    expect(model.instructions.items[0]).toBe('The sunk point is found for you: pick another in the layers to pull that out.');
    expect(model.instructions.notes).toContain('2 sunk points lie here: the first is taken.');
    expect(model.footer?.commit.label).toBe('Unsink');
  });
});
