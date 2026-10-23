import { describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import type { FoldCrossSection } from '../../engine/foldEngineWire';
import { foldToolWindow, type FoldPreview, type FoldToolHost, type FoldToolWindowView } from '../foldToolWindow';
import type { FoldTuckWindowView } from './tuckToolWindow';

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
    stepOrder: vi.fn(),
    setTuckDirection: vi.fn(),
    stepTuckTarget: vi.fn(),
    tuckTarget: vi.fn(),
  };
}

const mouse: FoldToolHost = { coarse: false, alt: 'Option' };

const view = (extra: Partial<FoldToolWindowView> = {}): FoldToolWindowView => ({
  tool: 'tuck',
  lineMode: 'free',
  readOnly: null,
  picks: 0,
  preview: null,
  ...extra,
});

/** Two flaps of one layer each at the line: the book fold. */
const section: FoldCrossSection = {
  line: { n: [1, 1], d: 1.2 },
  side: 'negative',
  from: { x: 0.7, y: 0 },
  to: { x: 1, y: 0.3 },
  flaps: [
    { faces: [1], witness: [0.3, 0.1] },
    { faces: [0], witness: [0.7, 0.1] },
  ],
  rows: [
    { faces: [1], spans: [[0, 1]], flap: 0 },
    { faces: [0], spans: [[0, 1]], flap: 1 },
  ],
  intervals: [{ start: 0, end: 1, faces: [1, 0], rows: [0, 1] }],
  order: { kind: 'layered', unordered: [] },
  layers: 2,
  joins: [],
};

const preview = (extra: Partial<FoldPreview> = {}): FoldPreview => ({
  section,
  interval: null,
  seed: [1],
  added: [],
  refused: null,
  landing: false,
  ...extra,
});

const tuck = (extra: Partial<FoldTuckWindowView> = {}): FoldTuckWindowView => ({
  direction: 'valley',
  known: true,
  targets: 2,
  target: 0,
  faces: [1, 4],
  orders: 0,
  order: 0,
  ...extra,
});

describe('the tuck tool’s window', () => {
  it('locates its line as a fold does', () => {
    const model = foldToolWindow(t, view({ picks: 1 }), verbs(), mouse);
    expect(model).toMatchObject({ phase: 'locate', title: 'Tuck', meta: '1 setting', kind: null });
    expect(model?.instructions.current).toBe(1);
    expect(model?.lineMode).toMatchObject({ label: 'Locate line', value: 'free' });
    expect(model?.tuck).toBeUndefined();
  });

  it('previews the tuck by its direction, its listed layers stepped through, never a free pick', () => {
    const calls = verbs();
    const model = foldToolWindow(t, view({ picks: 2, preview: preview(), tuck: tuck() }), calls, mouse);
    expect(model).toMatchObject({ phase: 'preview', title: 'Valley fold and tuck', meta: '4 settings' });
    expect(model?.kind?.options.map((option) => [option.value, option.label])).toEqual([
      ['valley', 'Valley fold and tuck'],
      ['mountain', 'Mountain fold and tuck'],
    ]);
    model?.kind?.set('mountain');
    model?.kind?.set('precrease');
    expect(calls.setTuckDirection.mock.calls).toEqual([['mountain']]);
    expect(model?.tuck?.note).toBe('2 layers here take the tuck under them: the folded paper lights each.');
    expect(model?.tuck?.target).toMatchObject({ label: 'Tuck under', value: '1 of 2' });
    model?.tuck?.target?.next.run();
    expect(calls.stepTuckTarget).toHaveBeenCalledWith(1);
    expect(model?.tuck?.order).toBeNull();
    expect(model?.instructions.items).toEqual(['Pick which flaps tuck.', 'Pick the layer to tuck against.', 'Press Enter to fold.']);
    expect(model?.footer?.commit.label).toBe('Valley fold and tuck');

    // One layer over which a mountain tuck goes, two orders it leaves.
    const over = foldToolWindow(
      t,
      view({ picks: 2, preview: preview(), tuck: tuck({ direction: 'mountain', targets: 1, faces: [1], orders: 2 }) }),
      calls,
      mouse
    );
    expect(over?.title).toBe('Mountain fold and tuck');
    expect(over?.tuck?.note).toBe('One layer here takes the tuck over it.');
    expect(over?.tuck?.target).toBeNull();
    expect(over?.tuck?.order).toMatchObject({ label: 'Layer order', value: '1 of 2' });
  });

  it('says when no layer takes it, and keeps the commit off', () => {
    const model = foldToolWindow(
      t,
      view({
        picks: 2,
        preview: preview({
          refused: { refusal: { code: 'tuck_infeasible', target: null, placement: 'under', faces: [] }, fixes: [] },
        }),
        tuck: tuck({ targets: 0, faces: [] }),
      }),
      verbs(),
      mouse
    );
    expect(model?.tuck?.note).toBe('No layer here takes the tuck.');
    expect(model?.refusal).toMatchObject({ code: 'tuck_infeasible', title: 'No layer takes the tuck here', actions: [] });
    expect(model?.refusal?.text).toBe(
      'No layer that stays can take the flap under it here. Fold it the other way, swap the moving side, or locate another line.'
    );
    expect(model?.footer?.commit.disabled).toBe(true);
    // The layers stay on show, so a flap can be narrowed until one takes it.
    expect(model?.layers?.picker).not.toBeNull();
  });

  it('binds a refused tuck’s other layers as fixes, named by their place in the list', () => {
    const calls = verbs();
    const model = foldToolWindow(
      t,
      view({
        picks: 2,
        preview: preview({
          refused: {
            refusal: { code: 'tuck_infeasible', target: 9, placement: 'under', faces: [9] },
            fixes: [
              { fix: 'tuck_target', face: 4, at: [0.6, 0.4] },
              { fix: 'tuck_target', face: 8, at: [0.6, 0.3] },
            ],
          },
        }),
        tuck: tuck(),
      }),
      calls,
      mouse
    );
    expect(model?.refusal?.title).toBe('It cannot be tucked under that layer');
    expect(model?.refusal?.text).toBe('No way of stacking the layers puts the flap right against that layer. Another layer here takes it.');
    expect(model?.refusal?.actions.map((action) => action.label)).toEqual([
      'Tuck under listed layer 2 instead',
      // A layer the list does not hold — the budget left it out — goes by what it is.
      'Tuck under the layer that fits instead',
    ]);
    model?.refusal?.actions[0]?.run();
    expect(calls.tuckTarget).toHaveBeenCalledWith(4);
  });
});
