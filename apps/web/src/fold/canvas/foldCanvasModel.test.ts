import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import type { Point } from '../../lib/geometry';
import type { FoldAnalysis, FoldCrossSection, FoldEngineRefused } from '../engine/foldEngineWire';
import type { FoldVertexAnalysis } from '../engine/foldEngineSquashWire';
import { FOLD_TOOL_INITIAL, type FoldToolState } from '../tools/foldToolState';
import type { FoldPick } from './foldPicking';
import { bookScene } from './foldCanvas.fixtures';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import {
  chooserBounds,
  chooserKeys,
  foldChoiceNote,
  foldCrimpWindowView,
  foldFreeLineStart,
  foldLocatedLines,
  foldShownPicks,
  foldSinkWindowView,
  foldTuckWindowView,
  foldVertexWindowView,
  foldWindowPreview,
  refusedFaceInks,
  takenLinesPending,
} from './foldCanvasModel';
import { foldMovingTint, foldTargetsTint, joinFills } from './foldPaneOverlays';

const t = i18n.t.bind(i18n);
import { foldPickIndex } from './foldPicking';
import type { FoldToolPreview } from './useFoldToolPreview';

const free = (x: number, y: number): FoldPick => ({ kind: 'free', pane: 'folded', scene: { x, y }, sheet: null });

const flaps = [
  { faces: [2], witness: [0.75, 0.5] as [number, number] },
  { faces: [1], witness: [0.25, 0.5] as [number, number] },
];

const section: FoldCrossSection = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  from: { x: 0, y: 0.5 },
  to: { x: 0.5, y: 0.5 },
  intervals: [{ start: 0, end: 0.5, faces: [1, 0], rows: [0, 1] }],
  rows: [
    { faces: [2], spans: [[0, 0.5]], flap: 0 },
    { faces: [1], spans: [[0, 0.5]], flap: 1 },
  ],
  order: { kind: 'layered', unordered: [] },
  flaps,
  layers: 2,
  joins: [],
};

const analysis: FoldAnalysis = {
  line: { n: [0, 1], d: 0.5 },
  side: 'positive',
  snap: { clusters: 0, angle: 0, max_shift: 0 },
  direction: 'valley',
  // The engine's own order, which the section's need not share.
  flaps: [flaps[1]!, flaps[0]!],
  picked: [1],
  added: [0],
  moving: [1, 2],
};

function preview(extra: Partial<FoldToolPreview> = {}): FoldToolPreview {
  return {
    candidates: null,
    build: { status: 'unlocated' },
    step: null,
    analysis,
    section,
    action: null,
    landed: null,
    refused: null,
    landing: false,
    reverse: null,
    ...extra,
  } as FoldToolPreview;
}

const located: FoldToolState = { ...FOLD_TOOL_INITIAL, lineMode: 'free', picks: [free(0, 0.5), free(1, 0.5)] };

describe('the Fold canvas model', () => {
  it('names what the seed asks for and what the closure adds by the section’s flaps', () => {
    expect(foldWindowPreview({ ...located, picks: located.picks.slice(0, 1) }, preview())).toBeNull();
    expect(foldWindowPreview(located, preview({ seed: { scope: 'all' } }))).toMatchObject({ seed: 'all', added: [1] });
    const picked = foldWindowPreview({ ...located, seed: { scope: 'flaps', flaps: [flaps[1]!] } }, preview({
      seed: { scope: 'flaps', flaps: [flaps[1]!] },
      step: {
        op: { kind: 'valley', line: { via: 'free', through: [[0, 0.5], [0.5, 0.5]] }, seed: { scope: 'flaps', at: [[0.25, 0.5]] } },
        key: 'k',
      },
    }));
    expect(picked?.seed).toEqual([1]);
  });

  it('says the orders are still being searched for while the order search has not answered and is not under review', () => {
    const resolution = (waiting: boolean, active = false) => ({ waiting, active }) as FoldToolPreview['orderResolution'];
    expect(foldWindowPreview(located, preview({ orderResolution: resolution(true) }))?.searching).toBe(true);
    expect(foldWindowPreview(located, preview({ orderResolution: resolution(false) }))?.searching).toBeUndefined();
    expect(foldWindowPreview(located, preview({ orderResolution: resolution(true, true) }))?.searching).toBeUndefined();
    expect(foldWindowPreview(located, preview())?.searching).toBeUndefined();
  });

  it('presses the top flap the step was built with while the tools hold the default (owner request, 2026-10-13)', () => {
    // The tools hold `top`; the preview's seed is the section's top flap, the step's flaps seed its witness.
    expect(located.seed).toEqual({ scope: 'top' });
    const top = foldWindowPreview(located, preview({
      seed: { scope: 'flaps', flaps: [flaps[0]!] },
      step: {
        op: { kind: 'valley', line: { via: 'free', through: [[0, 0.5], [0.5, 0.5]] }, seed: { scope: 'flaps', at: [[0.75, 0.5]] } },
        key: 'top',
      },
    }));
    expect(top).toMatchObject({ seed: [0], added: [1] });
    // A moving side of one flap: its top flap is every layer, every chip pressed, as before.
    expect(foldWindowPreview(located, preview({ seed: { scope: 'all' }, step: { op: { kind: 'valley', line: { via: 'free', through: [[0, 0.5], [0.5, 0.5]] }, seed: { scope: 'all' } }, key: 'one' } }))?.seed).toBe('all');
    // While the section the top flap is read from is asked, nothing is pressed.
    expect(foldWindowPreview(located, preview({ seed: null, analysis: null, section: null }))?.seed).toEqual([]);
  });

  it('hands the window the woven stack the pointer is over, the first while it has been over none', () => {
    expect(foldWindowPreview(located, preview())?.interval).toBeNull();
    expect(foldWindowPreview(located, preview(), 1)?.interval).toBe(1);
  });

  it('tints the faces a refusal names, by their index in the scene, not their id', () => {
    const refused: FoldEngineRefused = {
      status: 'refused',
      refusal: { code: 'layer_order' },
      fixes: [],
      faces: [2],
      vertices: [],
    };
    const inks = refusedFaceInks(bookScene(), preview({ refused }), [1, 0, 0, 1]);
    expect([...(inks?.keys() ?? [])]).toEqual([1]);
    expect(refusedFaceInks(bookScene(), preview(), [1, 0, 0, 1])).toBeUndefined();
  });

  it('lights the moving set cut to the moving side of the line', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const tint = foldMovingTint(index, { line: analysis.line, sign: 1, faces: [2], hovered: [] }, [0, 0, 1, 1]);
    if (!tint) throw new Error('no tint');
    // Two triangles: the cell above y = 0.5, no lower than it.
    expect(tint.count).toBe(6);
    const ys = Array.from(tint.position).filter((_, k) => k % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0.5, 12);
    expect(foldMovingTint(index, null, [0, 0, 1, 1])).toBeNull();
  });

  it('lights a tuck’s listed layers whole over the paper, the one taken brighter, drawn with the moving set', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const accent: [number, number, number, number] = [0, 0, 1, 1];
    const listed = foldTargetsTint(index, { listed: [1], taken: null }, accent);
    if (!listed) throw new Error('no tint');
    // The book's one cell, whole: two triangles, never cut by a line.
    expect(listed.count).toBe(6);
    const taken = foldTargetsTint(index, { listed: [1], taken: 1 }, accent);
    expect(taken?.count).toBe(12);
    expect(taken?.color[3]).toBeLessThan(taken?.color[4 * 6 + 3] ?? 0);
    expect(foldTargetsTint(index, { listed: [], taken: null }, accent)).toBeNull();
    const moving = foldMovingTint(index, { line: analysis.line, sign: 1, faces: [2], hovered: [] }, accent);
    expect(joinFills(listed, moving)?.count).toBe(12);
    expect(joinFills(null, moving)).toBe(moving);
    expect(joinFills(listed, null)).toBe(listed);
  });

  it('draws a crimp’s first line while its second is being located, and starts its second free line’s live line', () => {
    const crimping: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'crimp', lineMode: 'axiom-1' };
    const point = (x: number, y: number): FoldPick => ({ kind: 'point', provenance: 'vertex', sheet: [x, y], mark: null, scene: { x, y } });
    // The first line's two clicks in, and the second free line's first.
    const state = { ...crimping, picks: [point(0, 0), point(1, 1), free(0.2, 0.4)] };
    expect(foldFreeLineStart(state)).toEqual(free(0.2, 0.4));
    expect(foldFreeLineStart({ ...state, picks: state.picks.slice(0, 2) })).toBeNull();
    expect(foldFreeLineStart({ ...state, secondLineMode: 'crease' })).toBeNull();
    // A plain fold's free line, as before.
    expect(foldFreeLineStart({ ...FOLD_TOOL_INITIAL, lineMode: 'free', picks: [free(0.1, 0.1)] })).toEqual(free(0.1, 0.1));

    const lines = { first: [{ x: 0, y: 0 }, { x: 1, y: 1 }] as [Point, Point], second: null };
    expect(foldLocatedLines('crimp', false, lines)).toEqual([lines.first]);
    // Once the fold's picture is in, it draws both lines itself.
    expect(foldLocatedLines('crimp', true, lines)).toEqual([]);
    expect(foldLocatedLines('valley', false, lines)).toEqual([]);
  });

  it('draws a swivel’s valley taken and the line located now in their own pens: the valley, then the mountain', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const swivel: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'swivel', swivelInput: 'valley-mountain' };
    const line = (d: number) => ({ line: { via: 'free' as const, through: [[0, d], [1, d]] as [[number, number], [number, number]] }, sceneLine: { n: [0, 1] as [number, number], d } });
    const letters = (state: FoldToolState, located: ReturnType<typeof line> | null) =>
      takenLinesPending(index, state, located)?.folded.map((crease) => crease.letter) ?? null;
    // Locating the valley: drawn as a valley.
    expect(letters(swivel, line(0.3))).toEqual(['valley']);
    // Taken: the valley stays, and the line located now is the mountain.
    expect(letters({ ...swivel, takenLine: line(0.3) }, line(0.6))).toEqual(['valley', 'mountain']);
    expect(letters({ ...swivel, takenLine: line(0.3) }, null)).toEqual(['valley']);
    // A squash's drawn hinge, located and then taken, in its direction's pen.
    const squash: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'squash', squashHinge: 'line' };
    expect(letters(squash, line(0.3))).toEqual(['valley']);
    expect(letters({ ...squash, takenLine: line(0.3), vertexDirection: 'mountain' }, null)).toEqual(['mountain']);
    expect(letters({ ...squash, squashHinge: 'folded' }, line(0.3))).toBeNull();
    // Nothing for the swivel by its edge, or with nothing located.
    expect(letters({ ...swivel, swivelInput: 'edge' }, line(0.3))).toBeNull();
    expect(letters(swivel, null)).toBeNull();
  });

  it('runs a live line from a swivel’s first target point, never from a petal fold’s hinge', () => {
    const swivel: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'swivel' };
    const point = (x: number, y: number): FoldPick => ({ kind: 'point', provenance: 'vertex', sheet: [x, y], mark: null, scene: { x, y } });
    const edge: FoldPick = { kind: 'segment', edge: 0, segment: 'raw_edge', sheet: [[0, 0], [1, 0]], scene: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    const byPoints: FoldToolState = { ...swivel, swivelTarget: 'points', picks: [point(0.5, 0.2), edge, point(0, 1)] };
    // The second target point's live line runs from the first; a crease target has none.
    expect(foldFreeLineStart(byPoints)).toEqual(point(0, 1));
    expect(foldFreeLineStart({ ...byPoints, swivelTarget: 'crease' })).toBeNull();
    // A petal fold's hinge by its ends: drawn in its pen, not as a live line.
    const ends: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'petal', petalHinge: 'points', picks: [point(0.2, 0.5)] };
    expect(foldFreeLineStart(ends)).toBeNull();
  });

  it('shows a swivel’s pivot and target until the engine has drawn the vertex and the landing in their place', () => {
    const point = (x: number, y: number): FoldPick => ({ kind: 'point', provenance: 'free', sheet: [x, y], mark: null, scene: { x, y } });
    const swivel: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'swivel', picks: [point(0.8, 0.3), free(0.5, 0), free(0.3, 0.3)] };
    expect(foldShownPicks(swivel, { vertex: null })).toBe(swivel.picks);
    const analysis = { kind: 'swivel-by-edge' } as unknown as FoldVertexAnalysis;
    const described = { vertex: { base: { analysis, emergents: [], orders: null } } } as unknown as Pick<FoldToolPreview, 'vertex'>;
    // The edge it moves stays lit.
    expect(foldShownPicks(swivel, described)).toEqual([free(0.5, 0)]);
    expect(foldShownPicks({ ...swivel, tool: 'petal' }, described)).toBe(swivel.picks);
    // Previewed under the pointer before its last click: its meeting point gives way to the vertex drawn.
    const twoClicks = { ...swivel, picks: swivel.picks.slice(0, 2) };
    expect(foldShownPicks(twoClicks, { vertex: null }, true)).toEqual([free(0.5, 0)]);
    expect(foldShownPicks(twoClicks, { vertex: null }, false)).toBe(twoClicks.picks);
  });

  it('hands the crimp’s and the tuck’s windows what they choose among, only for their own tool once located', () => {
    const lines = { first: null, second: null };
    const way = { openings: [], stored: [] };
    const crimp = { asked: null, kind: 'outside' as const, kinds: ['outside' as const], ways: [way, way], way, orders: [], order: null, lines };
    const crimping: FoldToolState = { ...located, tool: 'crimp', picks: [...located.picks, free(0, 0.7), free(1, 0.7)] };
    expect(foldCrimpWindowView(crimping, preview({ crimp }))).toEqual({
      kind: 'outside',
      kinds: ['outside'],
      known: false,
      ways: 2,
      way: 0,
      orders: 0,
      order: 0,
    });
    // Its second line still to locate: nothing to choose yet.
    expect(foldCrimpWindowView({ ...crimping, picks: located.picks }, preview({ crimp }))).toBeUndefined();
    const target = (face: number) => ({ face, at: [0.1, 0.1] as [number, number], feasible: true });
    const tuck = {
      asked: null,
      direction: 'mountain' as const,
      targets: [target(3), target(7)],
      target: target(7),
      orders: [],
      order: null,
    };
    expect(foldTuckWindowView({ ...located, tool: 'tuck' }, preview({ tuck }))).toEqual({
      direction: 'mountain',
      known: false,
      targets: 2,
      pinned: [],
      target: 1,
      faces: [3, 7],
      orders: 0,
      order: 0,
    });
    expect(foldTuckWindowView(located, preview({ tuck }))).toBeUndefined();
  });

  it('reads a vertex tool’s window view off its preview, and gives none to any other tool', () => {
    expect(foldVertexWindowView(located, preview())).toBeUndefined();
    const tools: FoldToolState = {
      ...FOLD_TOOL_INITIAL,
      tool: 'rabbit-ear',
      vertexDirection: 'mountain',
      compound: { ...FOLD_TOOL_INITIAL.compound, squashTarget: null, fanLayers: 1 },
    };
    // Before the engine has described anything: only the direction.
    const waiting = foldVertexWindowView(tools, preview({ vertex: null }));
    expect(waiting).toMatchObject({ tool: 'rabbit-ear', direction: 'mountain', described: false, known: false, fourths: 0 });
    const order = { faces: [], orders: [] };
    const second = { faces: [], orders: [] };
    const shown = foldVertexWindowView(
      tools,
      preview({
        step: { op: { kind: 'turn', axis: 'vertical' }, key: 'k' },
        vertex: {
          base: {
            analysis: {
              kind: 'rabbit-ear',
              center: [0.3, 0.3],
              given: [],
              candidates: [
                [1, 0],
                [0, 1],
                [-1, 0],
              ],
              emergent: 0,
              layers: [1, 2],
            },
            emergents: [false, true, true],
            orders: null,
          },
          answer: null,
          emergent: 2,
          // The first candidate does not land: the other two are offered, numbered among themselves.
          fourths: [1, 2],
          elsewhere: null,
          direction: 'mountain',
          orders: [order, second],
          order: second,
          layers: 3,
        },
      })
    );
    expect(shown).toMatchObject({
      described: true,
      known: true,
      target: 'hinge',
      fourths: 2,
      fourth: 1,
      layers: 3,
      fanLayers: 1,
      orders: 2,
      order: 1,
    });
    // A rabbit ear names no line of its own.
    expect(shown).not.toHaveProperty('lineBy');
    // A fix's fourth crease is named by its number among those offered; one not offered has none.
    expect(shown?.emergentNumber?.([0.1, 0.9])).toBe(1);
    expect(shown?.emergentNumber?.([-0.9, 0.1])).toBe(2);
    expect(shown?.emergentNumber?.([0.9, -0.1])).toBeNull();
  });

  it('reads a petal fold’s hinge and what it creases itself, and a swivel’s target and ridge by name', () => {
    const petalTools: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'petal', petalHinge: 'points' };
    expect(foldVertexWindowView(petalTools, preview({ vertex: null }))).toMatchObject({ tool: 'petal', lineBy: 'points' });
    const petalAnalysis = {
      kind: 'petal' as const,
      line: { n: [0, 1] as [number, number], d: 0.5 },
      ends: [
        [0.2, 0.5],
        [0.8, 0.5],
      ] as [[number, number], [number, number]],
      corner: [0.5, 0.1] as [number, number],
      kites: [
        { n: [1, 0] as [number, number], d: 0.2 },
        { n: [1, 0] as [number, number], d: 0.8 },
      ] as [{ n: [number, number]; d: number }, { n: [number, number]; d: number }],
      top: [1],
      second: [2],
      scores_line: true,
      scores_kites: [true, false] as [boolean, boolean],
    };
    const lifted = foldVertexWindowView(
      petalTools,
      preview({
        vertex: {
          base: { analysis: petalAnalysis, emergents: [], orders: null },
          answer: null,
          emergent: null,
          fourths: [],
          elsewhere: null,
          direction: 'valley',
          orders: [],
          order: null,
          layers: 0,
        },
      })
    );
    expect(lifted?.petalScores).toEqual({ hinge: true, kites: 1 });

    const swivelTools: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'swivel', swivelTarget: 'points' };
    const swivelAnalysis = {
      kind: 'swivel-by-edge' as const,
      pivot: [0.8, 0.3] as [number, number],
      vertex: [0.8, 0.33] as [number, number],
      meet: [0, 0] as [number, number],
      edge: [
        [0, 0],
        [1, 0],
      ] as [[number, number], [number, number]],
      edge_faces: [0],
      foot: [0.8, 0] as [number, number],
      target: { n: [0.7071, -0.7071] as [number, number], d: 0 },
      rotation: 0.78,
      landed: [],
      creases: [],
      ridges: [
        [0, -1],
        [0.5, -0.5],
      ] as [number, number][],
      ridge: 0,
      layers: [0],
      regions: [],
    };
    const swivel = foldVertexWindowView(
      swivelTools,
      preview({
        vertex: {
          base: { analysis: swivelAnalysis, emergents: [true, true], orders: null },
          answer: null,
          emergent: 1,
          fourths: [0, 1],
          elsewhere: null,
          direction: 'valley',
          orders: [],
          order: null,
          layers: 0,
        },
      })
    );
    expect(swivel).toMatchObject({ lineBy: 'points', ridge: 'end', fourths: 2, fourth: 1 });
    // The other ridge, as a fix names it, is the first offered.
    expect(swivel?.emergentNumber?.([0, -1])).toBe(1);
  });

  it('reads a sink tool’s window from its point: what fits, the pocket named as seen, the depth', () => {
    const pockets = [
      { upper: [1], lower: [2, 3], seams: [7], stored: { above: [0.1, 0.1] as [number, number], below: [0.1, 0.2] as [number, number] } },
      { upper: [1, 2], lower: [3], seams: [8], stored: { above: [0.2, 0.1] as [number, number], below: [0.2, 0.2] as [number, number] } },
    ];
    const point = {
      analysis: {
        line: { n: [0, 1] as [number, number], d: 0.5 },
        side: 'positive' as const,
        snap: { clusters: 0, angle: 0, max_shift: 0 },
        point: { faces: [1, 2, 3], witness: [0.5, 0.7] as [number, number] },
        outline: [7, 8],
        exterior: 'mountain' as const,
        apex: [0.5, 0.8] as [number, number],
        square: null,
        pockets,
        truncated: false,
      },
      open: {
        refusal: { code: 'sink_line_tilted' as const, offset: 0.01, faces: [1] },
        fixes: [],
        faces: [1],
        vertices: [],
      },
    };
    const sink = { tool: 'closed-sink' as const, point, pockets, pocket: 1, sunk: null, orders: 0, order: 0 };
    const tools: FoldToolState = { ...located, tool: 'closed-sink' };
    expect(foldSinkWindowView(tools, preview({ sink }), false)).toEqual({
      tool: 'closed-sink',
      known: true,
      openRefusal: 'sink_line_tilted',
      pocketsFound: 2,
      pockets: 2,
      pocket: 1,
      pocketName: 'back',
      orders: 0,
      order: 0,
      depth: expect.closeTo(0.3, 12),
      sunk: 0,
    });
    // Turned over, the second pocket is the front one.
    expect(foldSinkWindowView(tools, preview({ sink }), true)?.pocketName).toBe('front');
    // Not while the line is being located, nor for another tool.
    expect(foldSinkWindowView({ ...tools, picks: [] }, preview({ sink }), false)).toBeUndefined();
    expect(foldSinkWindowView(located, preview({ sink }), false)).toBeUndefined();
  });
});

describe('where the canvas chooser frames', () => {
  const action = {
    kind: 'fold',
    direction: 'valley',
    line: [
      { x: 0.1, y: 0.4 },
      { x: 0.3, y: 0.6 },
    ],
    spans: [],
    moving: [],
    grip: null,
  } as NonNullable<FoldToolPreview['action']>;
  const paper = { minX: 0, minY: 0, maxX: 0.5, maxY: 1 };

  it('frames a fold line, or the paper while there is none', () => {
    expect(chooserBounds(preview({ action }), bookScene())).toEqual({ minX: 0.1, minY: 0.4, maxX: 0.3, maxY: 0.6 });
    expect(chooserBounds(preview(), bookScene())).toEqual(paper);
    expect(chooserBounds(preview(), null)).toBeNull();
  });

  it('frames the paper for a vertex fold, whose picture’s line is one short crease from its center', () => {
    const swivel = {
      op: { kind: 'swivel', vertex: [0.5, 0.3], toward: [], emergent: [0, -1], seed: { scope: 'all' }, stayer: [0.3, 0.9], direction: 'valley' },
      key: 'k',
    } as unknown as NonNullable<FoldToolPreview['step']>;
    expect(chooserBounds(preview({ action, step: swivel }), bookScene())).toEqual(paper);
  });
});

describe('the canvas chooser’s note', () => {
  const kinds = ['pocket', 'target', 'emergent', 'ridge', 'root', 'opening', 'order'] as const;

  it('offers the keys the user’s shortcuts step it with', () => {
    const keys = chooserKeys((id) => shortcutLabelForAction(id), false);
    expect(keys).toBe('Shift+← / Shift+→');
    expect(foldChoiceNote(t, 'root', keys)).toBe('This axiom has more than one fold here. Step through them, or press Shift+← / Shift+→.');
    // Rebound, the note names the new key.
    const rebound = { overrides: { 'fold.nextCandidate': [{ key: 'n' }] } };
    const named = chooserKeys((id) => shortcutLabelForAction(id, rebound), false);
    expect(named).toBe('Shift+← / N');
    for (const kind of kinds) expect(foldChoiceNote(t, kind, named), kind).toMatch(/or press Shift\+← \/ N\.$/);
  });

  it('offers no keys on a finger, or while one of them is unbound: its arrows alone', () => {
    expect(chooserKeys((id) => shortcutLabelForAction(id), true)).toBeNull();
    const unbound = { overrides: { 'fold.previousCandidate': [] } };
    expect(chooserKeys((id) => shortcutLabelForAction(id, unbound), false)).toBeNull();
    for (const kind of kinds) {
      const note = foldChoiceNote(t, kind, null);
      expect(note, kind).toMatch(/Step through them\.$/);
      expect(note, kind).not.toContain('Shift');
    }
  });
});
