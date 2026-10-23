import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { FOLD_SINK_REFUSAL_CODES } from '../engine/foldEngineSinkWire';
import {
  FOLD_PARTIAL_PRECREASE_REFUSAL_CODES,
  FOLD_REFUSAL_CODES,
  type FoldCrossSection,
  type FoldRefusalBody,
} from '../engine/foldEngineWire';
import {
  foldRefusalNotice,
  neededFlaps,
  sectionFlapNames,
  sinkRefusalTitle,
  type FoldFixVerbs,
  type FoldRefused,
  type FoldRefusalContext,
  type FoldUseLineFix,
} from './refusalNotice';

const t = i18n.t.bind(i18n);

function verbs() {
  return { includeFlaps: vi.fn(), foldOtherWay: vi.fn(), pickFlap: vi.fn(), useLine: vi.fn() } satisfies FoldFixVerbs;
}

/**
 * On screen, the engine's flap 0 is the second flap from the top, and its
 * flap 1 the first. No section is shown, so a fix's flaps go by where it lists them.
 */
const context = (extra: Partial<FoldRefusalContext> = {}): FoldRefusalContext => ({
  kind: 'valley',
  flapNumber: (flap) => [2, 1, 3][flap] ?? flap + 1,
  flapOf: null,
  readOnly: false,
  ...extra,
});

const line = { n: [0, 1] as const, d: 0.5 };

describe('foldRefusalNotice', () => {
  it('words every refusal the engine and the bridge can give', () => {
    for (const code of FOLD_REFUSAL_CODES) {
      const refusal = {
        code,
        added: [0],
        vertex: 1,
        distance: 1e-4,
        cause: 'band',
        face: 2,
        penetration: 1e-4,
      } as FoldRefusalBody;
      const notice = foldRefusalNotice(t, { refusal, fixes: [] }, context(), verbs());
      expect(notice.code).toBe(code);
      expect(notice.title, code).not.toBe('');
      expect(notice.text, code).not.toBe('');
    }
  });

  it('words every sink refusal in its own words, and a pocket still to choose as its chooser asks', () => {
    const generic = foldRefusalNotice(t, { refusal: { code: 'internal' }, fixes: [] }, context(), verbs());
    const titles = new Set<string>();
    for (const code of FOLD_SINK_REFUSAL_CODES) {
      const refusal = { code, flaps: 3, faces: [0] } as FoldRefusalBody;
      const notice = foldRefusalNotice(t, { refusal, fixes: [] }, context({ kind: 'sink' }), verbs());
      expect(notice.title, code).not.toBe(generic.title);
      expect(notice.text, code).not.toBe(generic.text);
      expect(notice.title, code).toBe(sinkRefusalTitle(t, code));
      titles.add(notice.title);
    }
    expect(titles.size).toBe(FOLD_SINK_REFUSAL_CODES.length);
    const several = foldRefusalNotice(
      t,
      { refusal: { code: 'sink_several_points', flaps: 3, faces: [0] }, fixes: [] },
      context({ kind: 'sink' }),
      verbs()
    );
    expect(several.text).toBe('3 points lie on the tip side, and a sink takes one. Pick the point to sink.');
    const pocket = foldRefusalNotice(t, { refusal: { code: 'choice_needed', choice: 'pocket' }, fixes: [] }, context(), verbs());
    expect(pocket.title).toBe('Choose a pocket');
  });

  it('gives every sink fix a button: the square line, the other sink, a point to sink alone', () => {
    const calls = { ...verbs(), otherSink: vi.fn() } satisfies FoldFixVerbs;
    const square: FoldUseLineFix = { fix: 'use_line', line, side: 'positive' };
    const flap = { faces: [4], witness: [0.2, 0.2] as [number, number] };
    const refused: FoldRefused = {
      refusal: { code: 'sink_line_tilted', offset: 0.01, faces: [0] },
      fixes: [square, { fix: 'other_sink', kind: 'closed' }, { fix: 'other_sink', kind: 'open' }, { fix: 'pick_flap', flaps: [flap] }],
    };
    const notice = foldRefusalNotice(t, refused, context({ kind: 'sink' }), calls);
    expect(notice.actions.map((action) => action.label)).toEqual([
      'Use the square line',
      'Closed sink instead',
      'Open sink instead',
      'Sink flap 2 only',
    ]);
    notice.actions.forEach((action) => action.run());
    expect(calls.useLine).toHaveBeenCalledWith(square);
    expect(calls.otherSink.mock.calls).toEqual([['closed'], ['open']]);
    expect(calls.pickFlap).toHaveBeenCalledWith(flap);
    // Without the verb, no button that would do nothing.
    expect(foldRefusalNotice(t, refused, context({ kind: 'sink' }), verbs()).actions.map((action) => action.label)).toEqual([
      'Use the square line',
      'Sink flap 2 only',
    ]);
  });

  it('offers to include the flaps the closure would move, by their numbers on screen', () => {
    const calls = verbs();
    const refused: FoldRefused = {
      refusal: { code: 'closure_adds_flaps', added: [0] },
      fixes: [{ fix: 'include_flaps', flaps: [0] }],
    };
    const notice = foldRefusalNotice(t, refused, context(), calls);
    expect(notice.title).toBe('More flaps would move');
    expect(notice.text).toBe('Folding these layers moves flap 2 too.');
    expect(notice.actions.map((action) => action.label)).toEqual(['Include flap 2']);
    notice.actions[0]?.run();
    expect(calls.includeFlaps).toHaveBeenCalledWith([0]);

    const several = foldRefusalNotice(
      t,
      { refusal: { code: 'closure_adds_flaps', added: [0, 2] }, fixes: [{ fix: 'include_flaps', flaps: [0, 2] }] },
      context(),
      calls
    );
    expect(several.text).toBe('Folding these layers moves 2 more flaps too.');
    expect(several.actions.map((action) => action.label)).toEqual(['Include the 2 flaps']);
  });

  it('names the other way after the fold asked for', () => {
    const calls = verbs();
    const refused: FoldRefused = { refusal: { code: 'layer_order' }, fixes: [{ fix: 'opposite_direction' }] };
    const labels = (['valley', 'mountain', 'precrease'] as const).map(
      (kind) => foldRefusalNotice(t, refused, context({ kind }), calls).actions[0]?.label
    );
    expect(labels).toEqual(['Mountain fold instead', 'Valley fold instead', 'Precrease the other way']);
    const notice = foldRefusalNotice(t, refused, context(), calls);
    expect(notice.title).toBe('Collision');
    notice.actions[0]?.run();
    expect(calls.foldOtherWay).toHaveBeenCalledTimes(1);
  });

  it('offers each flap to fold alone when everything would move', () => {
    const calls = verbs();
    const flaps = [
      { faces: [0], witness: [0.2, 0.2] as const },
      { faces: [1], witness: [0.8, 0.8] as const },
    ];
    const notice = foldRefusalNotice(
      t,
      { refusal: { code: 'nothing_stays' }, fixes: [{ fix: 'pick_flap', flaps }] },
      context(),
      calls
    );
    expect(notice.title).toBe('Everything would move');
    // Not "turn over": the fix for everything moving is a flap (plan D3).
    expect(notice.text).toBe('Every layer is on the moving side, so nothing would stay put. Pick a flap to fold.');
    expect(notice.actions.map((action) => action.label)).toEqual(['Fold flap 2 only', 'Fold flap 1 only']);
    notice.actions[1]?.run();
    expect(calls.pickFlap).toHaveBeenCalledWith(flaps[1]);
  });

  it('numbers a fix’s flaps as the chips do when the engine lists only some of the section’s, in its own order', () => {
    const flap = (face: number) => ({ faces: [face, face + 1], witness: [0.1 * face, 0.5] as [number, number] });
    const flaps = [flap(0), flap(2), flap(4), flap(6)];
    // Top to bottom the rows are engine flaps 2, 0, 3, 1: the chips read Flap 2 for flap 0, Flap 4 for flap 1, …
    const section = {
      flaps,
      rows: [2, 0, 3, 1].map((index) => ({ flap: index })),
    } as unknown as FoldCrossSection;
    const names = sectionFlapNames(section);
    expect([0, 1, 2, 3].map(names.flapNumber)).toEqual([2, 4, 1, 3]);

    // A reverse fold's tip that cannot open lists the flaps that open: engine flaps 0 and 2.
    const reverse = { ...verbs(), otherKind: vi.fn() };
    const notice = foldRefusalNotice(
      t,
      {
        refusal: { code: 'reverse_no_opening', faces: [0], cause: 'no_split' },
        fixes: [{ fix: 'pick_flap', flaps: [flaps[0]!, flaps[2]!] }],
      },
      { kind: 'reverse', readOnly: false, ...names },
      reverse
    );
    expect(notice.actions.map((action) => action.label)).toEqual(['Reverse flap 2 only', 'Reverse flap 1 only']);
    notice.actions[1]?.run();
    expect(reverse.pickFlap).toHaveBeenCalledWith(flaps[2]);

    // A sink seeded on several points lists those: engine flaps 1 and 3, the chips' Flap 4 and Flap 3.
    const sink = foldRefusalNotice(
      t,
      {
        refusal: { code: 'sink_several_points', flaps: 2, faces: [0] },
        fixes: [{ fix: 'pick_flap', flaps: [flaps[1]!, flaps[3]!] }],
      },
      { kind: 'sink', readOnly: false, ...names },
      verbs()
    );
    expect(sink.actions.map((action) => action.label)).toEqual(['Sink flap 4 only', 'Sink flap 3 only']);

    // A flap the section does not show has no chip to share a number with.
    const elsewhere = foldRefusalNotice(
      t,
      { refusal: { code: 'nothing_stays' }, fixes: [{ fix: 'pick_flap', flaps: [flap(9)] }] },
      { kind: 'tuck', readOnly: false, ...names },
      verbs()
    );
    expect(elsewhere.actions.map((action) => action.label)).toEqual(['Tuck this flap only']);
  });

  it('points a reverse fold that cannot go one way to the other kind only when the engine says that one lands', () => {
    const refusal = { code: 'reverse_kind_infeasible', kind: 'inside', faces: [1] } as unknown as FoldRefusalBody;
    const other = foldRefusalNotice(t, { refusal, fixes: [{ fix: 'other_kind', kind: 'outside' }] }, context({ kind: 'reverse' }), {
      ...verbs(),
      otherKind: vi.fn(),
    });
    expect(other.text).toContain('The other kind of reverse fold may fit.');
    expect(other.actions.map((action) => action.label)).toEqual(['Outside reverse fold instead']);
    const neither = foldRefusalNotice(t, { refusal, fixes: [] }, context({ kind: 'reverse' }), verbs());
    expect(neither.title).toBe('It cannot go inside');
    expect(neither.text).toContain('Neither kind of reverse fold fits here');
    expect(neither.text).not.toContain('may fit');
    expect(neither.actions).toEqual([]);
  });

  it('offers the point on the moving flap for a point that stays put, only when the tools found one that lands', () => {
    const refused: FoldRefused = { refusal: { code: 'mover_stays', point: [0, 1] }, fixes: [] };
    const useMovingPoint = vi.fn();
    const offered = foldRefusalNotice(t, refused, context({ kind: 'precrease', movingPoint: true }), { ...verbs(), useMovingPoint });
    expect(offered.title).toBe('The point would stay put');
    expect(offered.actions.map((action) => action.label)).toEqual(['Use the point on the moving flap']);
    offered.actions[0]?.run();
    expect(useMovingPoint).toHaveBeenCalledTimes(1);
    // None found to land, none bound, or nothing can change: no button, or none to press.
    expect(foldRefusalNotice(t, refused, context({ kind: 'precrease' }), { ...verbs(), useMovingPoint }).actions).toEqual([]);
    expect(foldRefusalNotice(t, refused, context({ kind: 'precrease', movingPoint: true }), verbs()).actions).toEqual([]);
    expect(
      foldRefusalNotice(t, refused, context({ kind: 'precrease', movingPoint: true, readOnly: true }), { ...verbs(), useMovingPoint })
        .actions[0]?.disabled
    ).toBe(true);
    // Another refusal never offers it.
    expect(
      foldRefusalNotice(t, { refusal: { code: 'no_side' }, fixes: [] }, context({ movingPoint: true }), { ...verbs(), useMovingPoint }).actions
    ).toEqual([]);
  });

  it('offers a reverse fold only the flaps its drawn line crosses, only when the tools found that they land', () => {
    const refused: FoldRefused = { refusal: { code: 'reverse_kind_infeasible', kind: 'inside', faces: [1] }, fixes: [] };
    const useNarrowerSeed = vi.fn();
    const one = foldRefusalNotice(t, refused, context({ kind: 'reverse', narrowerSeed: [0] }), { ...verbs(), useNarrowerSeed });
    expect(one.text).toBe(
      'Neither kind of reverse fold fits here: no way of stacking the layers lets the tip turn. Move the line, or reverse other flaps.'
    );
    expect(one.actions.map((action) => action.label)).toEqual(['Reverse flap 2 only']);
    one.actions[0]?.run();
    expect(useNarrowerSeed).toHaveBeenCalledTimes(1);
    const two = foldRefusalNotice(t, refused, context({ kind: 'reverse', narrowerSeed: [0, 2] }), { ...verbs(), useNarrowerSeed });
    expect(two.actions.map((action) => action.label)).toEqual(['Reverse only the flaps the line crosses']);
    // None found to land, none bound, or nothing can change: no button, or none to press.
    expect(foldRefusalNotice(t, refused, context({ kind: 'reverse' }), { ...verbs(), useNarrowerSeed }).actions).toEqual([]);
    expect(foldRefusalNotice(t, refused, context({ kind: 'reverse', narrowerSeed: [0] }), verbs()).actions).toEqual([]);
    expect(
      foldRefusalNotice(t, refused, context({ kind: 'reverse', narrowerSeed: [0], readOnly: true }), { ...verbs(), useNarrowerSeed }).actions[0]
        ?.disabled
    ).toBe(true);
  });

  it('says a sink or a vertex fold no order lands in its own words, pointing to the fix the engine offers', () => {
    const generic = foldRefusalNotice(t, { refusal: { code: 'internal' }, fixes: [] }, context(), verbs());
    const noOrder = { code: 'no_order', faces: [1, 2] } as FoldRefusalBody;

    // A closed sink the open one fits instead.
    const calls = { ...verbs(), otherSink: vi.fn() };
    const closed = foldRefusalNotice(
      t,
      { refusal: noOrder, fixes: [{ fix: 'other_sink', kind: 'open' }] },
      context({ kind: 'sink', sink: { tool: 'closed-sink' } }),
      calls
    );
    expect(closed.title).toBe('The point cannot sink this way here');
    expect(closed.text).toBe('No way of stacking the layers lets the point sink this way here. The other kind of sink fits.');
    expect(closed.actions.map((action) => action.label)).toEqual(['Open sink instead']);
    const neither = foldRefusalNotice(t, { refusal: noOrder, fixes: [] }, context({ kind: 'sink', sink: { tool: 'open-sink' } }), calls);
    expect(neither.text).toBe('No way of stacking the layers lets the point sink this way here. Move the line, or pick another point.');
    const unsink = foldRefusalNotice(t, { refusal: noOrder, fixes: [] }, context({ kind: 'sink', sink: { tool: 'unsink' } }), calls);
    expect(unsink.title).toBe('The point cannot come back out here');

    // A squash the other direction fits.
    const squash = foldRefusalNotice(
      t,
      { refusal: noOrder, fixes: [{ fix: 'opposite_direction' }] },
      context({ kind: 'vertex', vertex: { tool: 'squash' } }),
      { ...verbs(), vertexOtherWay: vi.fn() }
    );
    expect(squash.title).toBe('It cannot be squashed flat here');
    expect(squash.text).toBe('No way of stacking the layers lets it fold flat this way here. Folded the other way, it fits.');
    expect(squash.actions.map((action) => action.label)).toEqual(['Fold it the other way']);
    const ear = foldRefusalNotice(t, { refusal: noOrder, fixes: [] }, context({ kind: 'vertex', vertex: { tool: 'rabbit-ear' } }), verbs());
    expect(ear.title).toBe('The ear cannot fold flat here');
    expect(ear.text).toBe('No way of stacking the layers lets it fold flat here. Pick other points, or fold the layers in its way first.');

    for (const notice of [closed, neither, unsink, squash, ear]) {
      expect(notice.title).not.toBe(generic.title);
      expect(notice.text).not.toBe(generic.text);
    }
  });

  it('says a search that ran out of time is not a fold that would not land, whatever the fold', () => {
    for (const kind of ['reverse', 'crimp', 'tuck', 'sink', 'vertex'] as const) {
      const notice = foldRefusalNotice(
        t,
        { refusal: { code: 'budget_exceeded' } as FoldRefusalBody, fixes: [] },
        context({ kind, ...(kind === 'vertex' ? { vertex: { tool: 'swivel' as const } } : {}) }),
        verbs()
      );
      expect(notice.title, kind).toBe('The search ran out of time');
      expect(notice.text, kind).toContain('it is not known whether this fold fits');
    }
  });

  it('offers the landmark line for a near miss', () => {
    const calls = verbs();
    const fix: FoldUseLineFix = { fix: 'use_line', line, side: 'positive' };
    const notice = foldRefusalNotice(
      t,
      { refusal: { code: 'near_miss', vertex: 4, distance: 4e-4, cause: 'band' }, fixes: [fix] },
      context(),
      calls
    );
    expect(notice.title).toBe('Too close to a point');
    expect(notice.actions.map((action) => action.label)).toEqual(['Use the landmark line']);
    notice.actions[0]?.run();
    expect(calls.useLine).toHaveBeenCalledWith(fix);
  });

  it('offers a sliver’s remedies by how they move the line, each with the step it commits', () => {
    const calls = verbs();
    const remedy = (axiom: 5 | 7): FoldUseLineFix => ({
      fix: 'use_line',
      line: { n: [1, 0], d: 0.8 },
      side: 'positive',
      step: {
        op: {
          kind: 'valley',
          line: {
            via: 'axiom',
            axiom,
            inputs:
              axiom === 5
                ? [
                    { kind: 'point', at: [0.8, 0] },
                    { kind: 'point', at: [1, 0] },
                    { kind: 'edge', a: [0.6, 0], b: [0.6, 0.5] },
                  ]
                : [
                    { kind: 'point', at: [1, 0] },
                    { kind: 'edge', a: [0.6, 0], b: [0.6, 0.5] },
                    { kind: 'edge', a: [0.3, 0], b: [1, 0] },
                  ],
          },
          seed: { scope: 'all' },
        },
        choices: { root: { n: [1, 0], d: 0.8 } },
      },
    });
    const notice = foldRefusalNotice(
      t,
      { refusal: { code: 'sliver', vertex: 3, face: 1, penetration: 1e-4 }, fixes: [remedy(5), remedy(7)] },
      context(),
      calls
    );
    expect(notice.title).toBe('A point lands just inside an edge');
    expect(notice.actions.map((action) => action.label)).toEqual([
      'Turn the line to land the point on the edge',
      'Slide the line to land the point on the edge',
    ]);
    notice.actions[1]?.run();
    expect(calls.useLine).toHaveBeenCalledWith(remedy(7));
  });

  it('says every crimp and tuck refusal in its own words, none as a fold that cannot be made', () => {
    const generic = foldRefusalNotice(t, { refusal: { code: 'internal' }, fixes: [] }, context(), verbs()).title;
    const titles: Record<string, string> = {
      crimp_lines_meet: 'The lines meet',
      crimp_misses_tip: 'The second line misses the flap',
      crimp_no_opening: 'This flap cannot open at the second line',
      crimp_kind_infeasible: 'It cannot crimp round the outside',
      crimp_tip_not_free: 'Layers are in the way',
      tuck_infeasible: 'It cannot be tucked over that layer',
      tuck_target_moves: 'The layer to tuck under would move',
    };
    for (const [code, title] of Object.entries(titles)) {
      const refusal = { code, faces: [1], kind: 'outside', target: 3, placement: 'over', blocking: [2] } as unknown as FoldRefusalBody;
      const notice = foldRefusalNotice(t, { refusal, fixes: [] }, context({ kind: code.startsWith('crimp') ? 'crimp' : 'tuck' }), verbs());
      expect(notice.title, code).toBe(title);
      expect(notice.title, code).not.toBe(generic);
    }
    const tipNotFree = foldRefusalNotice(
      t,
      { refusal: { code: 'crimp_tip_not_free', blocking: [2], faces: [2] } as unknown as FoldRefusalBody, fixes: [] },
      context({ kind: 'crimp' }),
      verbs()
    );
    expect(tipNotFree.text).toBe(
      'Other layers lie where the crimped paper would turn. Include their flaps in the crimp, or crimp it somewhere else.'
    );
    // A single-layer tip, refused as a reverse fold's is, named as a crimp.
    const singleLayer = { refusal: { code: 'reverse_no_opening', cause: 'no_spine' } as FoldRefusalBody, fixes: [] };
    expect(foldRefusalNotice(t, singleLayer, context({ kind: 'crimp' }), verbs()).text).toBe(
      'A single layer has no folded edge to crimp along. Crimp a flap of layers joined by a fold.'
    );
    expect(foldRefusalNotice(t, singleLayer, context({ kind: 'reverse' }), verbs()).text).toBe(
      'A single layer has no folded edge to reverse along. Reverse a flap of layers joined by a fold.'
    );
  });

  it('says every partial precrease refusal in its own words, none as a fold that cannot be made', () => {
    const generic = foldRefusalNotice(t, { refusal: { code: 'internal' }, fixes: [] }, context(), verbs()).title;
    const titles = FOLD_PARTIAL_PRECREASE_REFUSAL_CODES.map((code) => {
      const notice = foldRefusalNotice(
        t,
        { refusal: { code } as FoldRefusalBody, fixes: [] },
        context({ kind: 'precrease', extent: { mode: 'segment', allLayers: true } }),
        verbs()
      );
      expect(notice.title, code).not.toBe(generic);
      return [code, notice.title];
    });
    expect(Object.fromEntries(titles)).toEqual({
      mark_off_sheet: 'The mark would leave the paper',
      mark_too_short: 'Too short to crease',
      mark_on_crease: 'Already creased there',
      marks_overlap: 'The marks would overlap',
      extent_off_paper: 'A point is off the paper',
      extent_too_short: 'Too short to crease',
      extent_misses_paper: 'No paper there',
      extent_misses_layers: 'No layer to crease there',
    });
    // A pinch too short has no two points to move apart.
    const pinch = foldRefusalNotice(
      t,
      { refusal: { code: 'extent_too_short' } as FoldRefusalBody, fixes: [{ fix: 'opposite_direction' }] },
      context({ kind: 'precrease', extent: { mode: 'pinch', allLayers: true } }),
      { ...verbs(), useWholeLine: vi.fn(), pinchInstead: vi.fn() }
    );
    expect(pinch.text).toBe('This pinch is too short for the paper to take a crease. Crease more of the line.');
    // The engine's fix first, then the tool's own.
    expect(pinch.actions.map((action) => action.label)).toEqual(['Precrease the other way', 'Use the whole line']);
  });

  it('binds a tuck’s other layer, and its narrowed flaps, in a tuck’s words', () => {
    const calls = { ...verbs(), tuckTarget: vi.fn() };
    const flap = { faces: [1], witness: [0.2, 0.2] as [number, number] };
    const notice = foldRefusalNotice(
      t,
      {
        refusal: { code: 'tuck_infeasible', target: 3, placement: 'under', faces: [3] },
        fixes: [
          { fix: 'tuck_target', face: 5, at: [0.5, 0.5] },
          { fix: 'pick_flap', flaps: [flap] },
        ],
      },
      context({ kind: 'tuck', tuck: { under: true, targetNumber: (face) => (face === 5 ? 3 : null) } }),
      calls
    );
    expect(notice.actions.map((action) => action.label)).toEqual(['Tuck under listed layer 3 instead', 'Tuck flap 2 only']);
    notice.actions[0]?.run();
    expect(calls.tuckTarget).toHaveBeenCalledWith(5);
    notice.actions[1]?.run();
    expect(calls.pickFlap).toHaveBeenCalledWith(flap);
    // Without a verb to bind, a surface offers no other layer.
    const unbound = foldRefusalNotice(
      t,
      { refusal: { code: 'tuck_infeasible', target: 3, placement: 'under', faces: [3] }, fixes: [{ fix: 'tuck_target', face: 5, at: [0.5, 0.5] }] },
      context({ kind: 'tuck' }),
      verbs()
    );
    expect(unbound.actions).toEqual([]);
    expect(unbound.text).toBe('No way of stacking the layers puts the flap right against that layer. Another layer here takes it.');
  });

  it('keeps every fix in the engine’s order, and holds them on a read-only sequence', () => {
    const notice = foldRefusalNotice(
      t,
      {
        refusal: { code: 'layer_order' },
        fixes: [
          { fix: 'include_flaps', flaps: [1] },
          { fix: 'opposite_direction' },
        ],
      },
      context({ readOnly: true }),
      verbs()
    );
    expect(notice.actions.map((action) => [action.label, action.disabled])).toEqual([
      ['Include flap 1', true],
      ['Mountain fold instead', true],
    ]);
    expect(new Set(notice.actions.map((action) => action.id)).size).toBe(2);
  });
});

describe('neededFlaps', () => {
  it('is the flaps an include fix names, and none without a refusal', () => {
    expect(
      [...neededFlaps({ refusal: { code: 'layer_order' }, fixes: [{ fix: 'include_flaps', flaps: [2, 0] }, { fix: 'opposite_direction' }] })].sort()
    ).toEqual([0, 2]);
    expect(neededFlaps(null).size).toBe(0);
  });
});
