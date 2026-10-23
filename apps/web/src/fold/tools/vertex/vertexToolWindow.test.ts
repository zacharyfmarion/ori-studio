import { describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import type { FoldEngineRefused, FoldRefusalBody } from '../../engine/foldEngineWire';
import { foldToolWindow, type FoldPreview, type FoldToolHost, type FoldToolWindowVerbs, type FoldToolWindowView } from '../foldToolWindow';
import { foldRefusalNotice } from '../refusalNotice';
import { FOLD_VERTEX_REFUSAL_CODES } from './vertexRefusal';
import { hasVertexChoices, type FoldVertexWindowView } from './vertexToolWindow';

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
    stepOrder: vi.fn(),
    setVertexDirection: vi.fn(),
    vertexOtherWay: vi.fn(),
    stepEmergent: vi.fn(),
    takeEmergent: vi.fn(),
    stepFanLayers: vi.fn(),
    resetSquashTarget: vi.fn(),
    setSquashHinge: vi.fn(),
    setVertexLineBy: vi.fn(),
    precreaseLine: vi.fn(),
    precreaseKite: vi.fn(),
    petalByEnds: vi.fn(),
  } satisfies FoldToolWindowVerbs;
}

const mouse: FoldToolHost = { coarse: false, alt: 'Option' };
const finger: FoldToolHost = { coarse: true, alt: 'Alt' };

const vertex = (extra: Partial<FoldVertexWindowView> = {}): FoldVertexWindowView => ({
  tool: 'squash',
  direction: 'valley',
  described: true,
  known: true,
  target: 'hinge',
  fourths: 0,
  fourth: 0,
  layers: 0,
  fanLayers: null,
  orders: 0,
  order: 0,
  ...extra,
});

const preview = (extra: Partial<FoldPreview> = {}): FoldPreview => ({
  section: null,
  interval: null,
  seed: 'all',
  added: [],
  refused: null,
  landing: false,
  ...extra,
});

const view = (shown: FoldVertexWindowView, extra: Partial<FoldToolWindowView> = {}): FoldToolWindowView => ({
  tool: shown.tool,
  lineMode: 'crease',
  readOnly: null,
  picks: 0,
  preview: null,
  vertex: shown,
  ...extra,
});

const refused = (refusal: FoldRefusalBody, fixes: FoldEngineRefused['fixes'] = []): FoldEngineRefused => ({
  status: 'refused',
  refusal,
  fixes,
  faces: [],
  vertices: [],
});

describe('a vertex fold’s window while its clicks are made', () => {
  it('numbers each tool’s clicks and says its precondition up front', () => {
    const squash = foldToolWindow(t, view(vertex()), verbs(), mouse);
    expect(squash).toMatchObject({ phase: 'locate', title: 'Squash fold', lineMode: null, movingSide: null });
    expect(squash?.instructions.items).toEqual(['Click the flap to squash.', 'Press Enter to fold.']);
    expect(squash?.instructions.notes).toEqual(['Esc clears the picks.']);
    expect(squash?.vertex?.note).toBe('A flap squashes when its two layers are joined only at its hinge and nothing lies on top of it.');
    // Nothing to choose yet beside the direction.
    expect(squash?.vertex && hasVertexChoices(squash.vertex)).toBe(false);

    const ear = foldToolWindow(t, view(vertex({ tool: 'rabbit-ear' }), { picks: 3 }), verbs(), mouse);
    expect(ear?.instructions.items).toHaveLength(5);
    expect(ear?.instructions.current).toBe(3);
    // The paper that stays, by what the folder sees: a part of it, lit under the pointer.
    expect(ear?.instructions.items[3]).toBe('Click the region where the hinge crease goes.');
    expect(ear?.instructions.items[4]).toBe('Press Enter to fold.');
    // Its corners clicked: no point is asked for, so nothing is said of snapping.
    expect(ear?.instructions.notes).toEqual(['Esc clears the picks.']);
    // While a corner is asked for: what a point snaps to, and the key that frees it, in one note.
    const corners = foldToolWindow(t, view(vertex({ tool: 'rabbit-ear' })), verbs(), mouse);
    expect(corners?.instructions.notes).toEqual([
      'Points snap to corners, crossings, marks and midpoints: hold Option to put one anywhere.',
      'Esc clears the picks.',
    ]);
    expect(ear?.instructions.intro).toBeNull();
    expect(ear?.vertex?.note).toBe('The creases meet at the triangle’s incenter: one to each corner, and a fourth the ear stands up along.');
  });

  it('words a finger’s clicks as taps, as its choose step does', () => {
    const ear = foldToolWindow(t, view(vertex({ tool: 'rabbit-ear' })), verbs(), finger);
    expect(ear?.instructions.items).toEqual([
      'Tap the triangle’s first corner.',
      'Tap its second corner.',
      'Tap its third corner.',
      'Tap the region where the hinge crease goes.',
      'Tap Rabbit ear to fold.',
    ]);
    expect(ear?.instructions.notes).toEqual([
      'Points snap to corners, crossings, marks and midpoints: turn on Free point to put one anywhere.',
    ]);
    const squash = foldToolWindow(t, view(vertex()), verbs(), finger);
    expect(squash?.instructions.items).toEqual(['Tap the flap to squash.', 'Tap Squash fold to fold.']);
    expect(squash?.instructions.notes).toEqual([]);
  });

  it('says what a swivel is in a line, then names each click by its part in the fold, and offers no direction while clicking', () => {
    const calls = verbs();
    const swivel = foldToolWindow(t, view(vertex({ tool: 'swivel', lineBy: 'crease' })), calls, mouse);
    expect(swivel?.instructions.intro).toBe('Swings an edge of the paper onto a line.');
    expect(swivel?.instructions.items).toEqual([
      'Click the folded edge the creases meet on, anywhere along it. On flat paper, click where they meet, or hold Option for any point.',
      'Click the edge to swing onto a line.',
      'Click the line it lands on.',
      'Press Enter to fold.',
    ]);
    // One note, never a step said again.
    expect(swivel?.instructions.notes).toEqual(['Esc clears the picks.']);
    // The canvas offers only what lands either way: no direction to choose yet, nothing under it.
    expect(swivel?.vertex?.direction).toBeNull();
    expect(swivel?.vertex?.note).toBeNull();
    // The line it lands on, by a crease or edge or by two points.
    expect(swivel?.vertex?.lineBy).toMatchObject({
      label: 'Lands on',
      value: 'crease',
      options: [{ short: 'Crease or edge' }, { short: 'Two points' }],
    });
    expect(swivel?.meta).toBe('2 settings');
    swivel?.vertex?.lineBy?.set('points');
    expect(calls.setVertexLineBy).toHaveBeenCalledWith('points');
    const points = foldToolWindow(t, view(vertex({ tool: 'swivel', lineBy: 'points' })), calls, mouse);
    expect(points?.instructions.items.slice(2, 4)).toEqual([
      'Click a point on the line it lands on.',
      'Click a second point on that line.',
    ]);
    // A finger taps, and has no key to hold.
    const touch = foldToolWindow(t, view(vertex({ tool: 'swivel' })), calls, finger);
    expect(touch?.instructions.items).toEqual([
      'Tap the folded edge the creases meet on, anywhere along it. On flat paper, tap where they meet, or turn on Free point for any point.',
      'Tap the edge to swing onto a line.',
      'Tap the line it lands on.',
      'Tap Swivel fold to fold.',
    ]);
    expect(touch?.instructions.notes).toEqual([]);
  });

  it('says in the step in hand when nothing can swing from where the creases meet', () => {
    const nothing = vertex({ tool: 'swivel', lineBy: 'crease', described: false, known: false, nothingSwings: true });
    const model = foldToolWindow(t, view(nothing, { picks: 1 }), verbs(), mouse);
    expect(model?.instructions.current).toBe(1);
    expect(model?.instructions.items[1]).toBe('Nothing can swing from there: click another point.');
    // In its place, the window's shape kept: no notice, no note below.
    expect(model?.refusal).toBeNull();
    expect(model?.vertex?.note).toBeNull();
    expect(foldToolWindow(t, view(nothing, { picks: 1 }), verbs(), finger)?.instructions.items[1]).toBe(
      'Nothing can swing from there: tap another point.'
    );
  });

  it('starts a petal fold on its hinge crease, or its two ends, then the flap that lifts', () => {
    const calls = verbs();
    const crease = foldToolWindow(t, view(vertex({ tool: 'petal', lineBy: 'crease' })), calls, mouse);
    expect(crease?.lineMode).toBeNull();
    expect(crease?.instructions.intro).toBe('Lifts a flap’s point up along a hinge.');
    expect(crease?.instructions.items).toEqual([
      'Click the hinge: a precrease across the flap.',
      'Click the flap that lifts, below the hinge.',
      'Choose Valley or Mountain, then press Enter.',
    ]);
    expect(crease?.instructions.notes).toEqual(['Esc clears the picks.']);
    // A finger taps, and has no key to clear with.
    const tapped = foldToolWindow(t, view(vertex({ tool: 'petal', lineBy: 'crease' })), calls, finger);
    expect(tapped?.instructions.items.slice(0, 2)).toEqual([
      'Tap the hinge: a precrease across the flap.',
      'Tap the flap that lifts, below the hinge.',
    ]);
    expect(tapped?.instructions.notes).toEqual([]);
    expect(crease?.vertex?.lineBy).toMatchObject({
      label: 'Hinge',
      value: 'crease',
      options: [{ short: 'Hinge crease' }, { short: 'Two endpoints' }],
    });
    crease?.vertex?.lineBy?.set('points');
    expect(calls.setVertexLineBy).toHaveBeenCalledWith('points');
    const ends = foldToolWindow(t, view(vertex({ tool: 'petal', lineBy: 'points' }), { picks: 1 }), calls, mouse);
    expect(ends?.instructions.items.slice(0, 3)).toEqual([
      'Click one end of the hinge, where a kite crease meets the flap’s edge.',
      'Click its other end, where the other kite crease meets the edge.',
      'Click the flap that lifts, below the hinge.',
    ]);
    expect(ends?.instructions.current).toBe(1);
    expect(ends?.instructions.notes[0]).toMatch(/^Points snap to corners/);
    // The hinge named: the flap's step; the canvas lights it, so no note says so.
    const region = foldToolWindow(t, view(vertex({ tool: 'petal', lineBy: 'points' }), { picks: 2 }), calls, mouse);
    expect(region?.instructions.current).toBe(2);
    expect(region?.instructions.notes).toEqual(['Esc clears the picks.']);
    expect(ends?.vertex?.note).toBeNull();
    // Previewing: the way it lifts, another flap, and the commit by key or button.
    const previewing = foldToolWindow(t, view(vertex({ tool: 'petal' }), { preview: preview() }), calls, mouse);
    expect(previewing?.instructions.intro).toBeUndefined();
    expect(previewing?.instructions.items).toEqual([
      'Choose which way it lifts, or click another flap to lift that one.',
      'Press Enter, or click Petal fold, to fold.',
    ]);
    // A finger taps.
    const touch = foldToolWindow(t, view(vertex({ tool: 'petal', lineBy: 'points' })), calls, finger);
    expect(touch?.instructions.items.slice(0, 3)).toEqual([
      'Tap one end of the hinge, where a kite crease meets the flap’s edge.',
      'Tap its other end, where the other kite crease meets the edge.',
      'Tap the flap that lifts, below the hinge.',
    ]);
  });

  it('says what a petal fold creases itself as the flap lifts', () => {
    const said = (hinge: boolean, kites: number) =>
      foldToolWindow(t, view(vertex({ tool: 'petal', petalScores: { hinge, kites } }), { preview: preview() }), verbs(), mouse)
        ?.vertex?.note;
    expect(said(true, 2)).toBe(
      'The fold creases the hinge through the top layer and both kite creases through the top two layers as the flap lifts.'
    );
    expect(said(true, 1)).toMatch(/^The fold creases the hinge through the top layer and one kite crease/);
    expect(said(true, 0)).toBe(
      'The fold creases the hinge through the top layer as the flap lifts. The kite creases are there already.'
    );
    expect(said(false, 2)).toMatch(/^The fold creases both kite creases through the top two layers/);
    expect(said(false, 1)).toMatch(/^The fold creases one kite crease/);
    expect(said(false, 0)).toBe('Every crease it folds is there already: it refolds the hinge and the kite creases.');
  });
});

describe('a vertex fold’s window while it previews', () => {
  it('offers a squash’s spine target, and the hinge back once it is aimed off it', () => {
    const calls = verbs();
    const onHinge = foldToolWindow(t, view(vertex(), { preview: preview() }), calls, mouse);
    // The direction, the hinge — the folded edge, or a line drawn — and where the spine lands.
    expect(onHinge).toMatchObject({ phase: 'preview', meta: '3 settings' });
    expect(onHinge?.vertex?.hinge?.value).toBe('folded');
    expect(onHinge?.vertex?.hinge?.options.map((option) => [option.short, option.disabled])).toEqual([
      ['Folded edge', false],
      ['Line', false],
    ]);
    onHinge?.vertex?.hinge?.set('line');
    expect(calls.setSquashHinge).toHaveBeenCalledWith('line');
    expect(onHinge?.vertex?.target).toEqual({ label: 'Spine lands on', value: 'The hinge line', reset: null });
    // Where it lands, as the folded pane draws it, and how to move it: said once, in the step.
    expect(onHinge?.instructions.items[0]).toBe('The spine lands on the bold line: click the paper to land it elsewhere.');
    const aimed = foldToolWindow(t, view(vertex({ target: 'point' }), { preview: preview() }), calls, mouse);
    expect(aimed?.vertex?.target?.value).toBe('The point clicked');
    aimed?.vertex?.target?.reset?.run();
    expect(calls.resetSquashTarget).toHaveBeenCalledTimes(1);
    aimed?.vertex?.direction?.set('mountain');
    expect(calls.setVertexDirection).toHaveBeenCalledWith('mountain');
    expect(aimed?.footer?.commit).toMatchObject({ label: 'Squash fold', disabled: false });
  });

  it('offers layers but no separate fourth-crease selector for a rabbit ear', () => {
    const calls = verbs();
    const ear = vertex({
      tool: 'rabbit-ear',
      // Of three candidates, two land: only they are offered.
      fourths: 2,
      fourth: 1,
      layers: 4,
      fanLayers: 2,
    });
    const model = foldToolWindow(t, view(ear, { preview: preview() }), calls, mouse);
    const controls = model?.vertex;
    expect(controls?.emergent).toBeNull();
    expect(controls?.emergentNote).toBe('The hinge crease lies in the selected region.');
    expect(controls?.layers?.value).toBe('Top 2 of 4');
    expect(controls).not.toHaveProperty('ridge');
    // Direction and layers.
    expect(model?.meta).toBe('2 settings');
    expect(model?.instructions.items[0]).toBe(
      'Choose the layers, or click another region for the hinge crease.'
    );
    expect(foldToolWindow(t, view(ear, { preview: preview() }), calls, finger)?.instructions.items[0]).toBe(
      'Choose the layers, or tap another region for the hinge crease.'
    );
    expect(controls?.note).toMatch(/a fourth the ear stands up along/);
    controls?.emergent?.next.run();
    controls?.layers?.previous.run();
    expect(calls.stepEmergent).not.toHaveBeenCalled();
    expect(calls.stepFanLayers).toHaveBeenCalledWith(-1);
    // From the bottom, for a mountain; every layer, said so.
    const mountain = foldToolWindow(t, view({ ...ear, direction: 'mountain' }, { preview: preview() }), calls, mouse);
    expect(mountain?.vertex?.layers?.value).toBe('Bottom 2 of 4');
    const all = foldToolWindow(t, view({ ...ear, fanLayers: null }, { preview: preview() }), calls, mouse);
    expect(all?.vertex?.layers?.value).toBe('All 4');
  });

  it('explains an unavailable hinge region without offering another fourth crease', () => {
    const calls = verbs();
    const ear = vertex({ tool: 'rabbit-ear', fourths: 1, fourth: 0, layers: 1 });
    const one = foldToolWindow(t, view(ear, { preview: preview() }), calls, mouse)?.vertex;
    expect(one?.emergent).toBeNull();
    expect(one?.emergentNote).toBe('The hinge crease lies in the selected region.');
    expect(one && hasVertexChoices(one)).toBe(true);
    const blocked = { ...ear, fourths: 0, known: false };
    const none = foldToolWindow(t, view(blocked, { preview: preview() }), calls, mouse);
    expect(none?.vertex?.emergent).toBeNull();
    expect(none?.vertex?.emergentNote).toBe('This hinge region cannot fold with these layers. Click another region or change the layers.');
    expect(none?.footer?.commit.disabled).toBe(true);
    expect(foldToolWindow(t, view(blocked, { preview: preview() }), calls, finger)?.vertex?.emergentNote).toBe(
      'This hinge region cannot fold with these layers. Tap another region or change the layers.'
    );
    expect(calls.stepEmergent).not.toHaveBeenCalled();
  });

  it('keeps a swivel’s steps once previewed, its last in hand, and steps its ridge by name only when both land', () => {
    const calls = verbs();
    const swivel = vertex({ tool: 'swivel', lineBy: 'crease', fourths: 2, fourth: 1, ridge: 'end', directions: [true, true] });
    const model = foldToolWindow(t, view(swivel, { preview: preview() }), calls, mouse);
    const controls = model?.vertex;
    expect(controls?.emergent).toMatchObject({ label: 'Ridge', value: 'Toward the edge’s end' });
    expect(controls?.emergentNote).toBeNull();
    // Every layer at its vertex: no layers to step.
    expect(controls?.layers).toBeNull();
    // How to read the picture, in a line.
    expect(controls?.note).toBe('The creases meet at the dot, the edge lands on the bold line, and the lit paper moves.');
    // The same steps, the commit in hand: by key or by button, a stepper above it may hold the focus.
    expect(model?.instructions.items).toEqual([
      'Click the folded edge the creases meet on, anywhere along it. On flat paper, click where they meet, or hold Option for any point.',
      'Click the edge to swing onto a line.',
      'Click the line it lands on.',
      'Press Enter, or click Swivel fold, to fold.',
    ]);
    expect(model?.instructions.current).toBe(3);
    // Both ways land: direction, the line it lands on, the ridge.
    expect(controls?.direction?.options.map((option) => option.disabled ?? false)).toEqual([false, false]);
    expect(model?.meta).toBe('4 settings');
    controls?.emergent?.previous.run();
    expect(calls.stepEmergent).toHaveBeenCalledWith(-1);
    // One ridge and one way land: nothing to choose, so nothing offered, and Enter folds.
    const one = foldToolWindow(
      t,
      view({ ...swivel, fourths: 1, fourth: 0, ridge: 'foot', directions: [true, false] }, { preview: preview() }),
      calls,
      mouse
    );
    expect(one?.vertex?.emergent).toBeNull();
    expect(one?.vertex?.direction).toBeNull();
    expect(one?.instructions.items.at(-1)).toBe('Press Enter to fold.');
    expect(one?.meta).toBe('2 settings');
    // Before the engine has described it, nothing is offered that may go again.
    const asking = foldToolWindow(t, view({ ...swivel, described: false, known: false, directions: undefined }, { preview: preview() }), calls, mouse);
    expect(asking?.vertex?.direction).toBeNull();
    // A target named by two points: which ways land is not known, so both are offered.
    const drawn = foldToolWindow(t, view({ ...swivel, lineBy: 'points', directions: undefined }, { preview: preview() }), calls, mouse);
    expect(drawn?.vertex?.direction?.options).toHaveLength(2);
  });

  it('offers a swivel on a folded edge no ridge, and no direction when only one way lands', () => {
    const calls = verbs();
    const onFold = vertex({ tool: 'swivel', lineBy: 'crease', onFold: true, directions: [true, false] });
    const model = foldToolWindow(t, view(onFold, { preview: preview() }), calls, mouse);
    const controls = model?.vertex;
    expect(controls?.emergent).toBeNull();
    expect(controls?.emergentNote).toBeNull();
    expect(controls?.direction).toBeNull();
    expect(controls?.note).toBe('The creases meet at the dot, the edge lands on the bold line, and the lit paper moves.');
    expect(model?.instructions.items.at(-1)).toBe('Press Enter to fold.');
    // The line it lands on.
    expect(model?.meta).toBe('2 settings');
    // Both ways land: the way is offered, and the commit names its button.
    const both = foldToolWindow(t, view({ ...onFold, directions: [true, true] }, { preview: preview() }), calls, mouse);
    expect(both?.vertex?.direction?.value).toBe('valley');
    expect(both?.instructions.items.at(-1)).toBe('Press Enter, or click Swivel fold, to fold.');
    // Its last step while clicking: the commit.
    const locating = foldToolWindow(t, view(onFold, { picks: 3 }), calls, mouse);
    expect(locating?.instructions.items.at(-1)).toBe('Press Enter to fold.');
    // A refusal is worded on the folded edge.
    const blocked = foldToolWindow(
      t,
      view(onFold, { preview: preview({ refused: refused({ code: 'fan_ray_blocked', faces: [12] }) }) }),
      calls,
      mouse
    );
    expect(blocked?.refusal?.text).toMatch(/^A crease would run into a fold before it reaches the paper’s edge/);
  });

  it('offers a swivel on a folded edge its kind, Open or Inside, when the other kind lands', () => {
    const calls = { ...verbs(), setSwivelKind: vi.fn() };
    const onFold = vertex({
      tool: 'swivel',
      lineBy: 'crease',
      onFold: true,
      directions: [true, false],
      swivelKind: 'open',
      swivelKinds: ['open', 'inside'],
    });
    const model = foldToolWindow(t, view(onFold, { preview: preview() }), calls, mouse);
    const kind = model?.vertex?.kind;
    expect(kind?.label).toBe('Kind');
    expect(kind?.value).toBe('open');
    expect(kind?.options.map((option) => [option.value, option.short, option.disabled])).toEqual([
      ['open', 'Open', false],
      ['inside', 'Inside', false],
    ]);
    expect(kind?.options[1]?.label).toBe('Inside swivel: the strip tucks between the layers');
    expect(kind?.note).toBeNull();
    // A choice above the commit: the commit names its button. The line it lands on and the kind.
    expect(model?.instructions.items.at(-1)).toBe('Press Enter, or click Swivel fold, to fold.');
    expect(model?.meta).toBe('3 settings');
    kind?.set('inside');
    expect(calls.setSwivelKind).toHaveBeenCalledWith('inside');
    // Inside taken: shown as taken.
    const inside = foldToolWindow(t, view({ ...onFold, swivelKind: 'inside' }, { preview: preview() }), calls, mouse);
    expect(inside?.vertex?.kind?.value).toBe('inside');
    // Only the kind asked lands, or none: no control. Only the other: offered, the one asked disabled.
    for (const swivelKinds of [['open'], []] as const) {
      const one = foldToolWindow(t, view({ ...onFold, swivelKinds }, { preview: preview() }), calls, mouse);
      expect(one?.vertex?.kind, swivelKinds.join()).toBeNull();
    }
    const other = foldToolWindow(t, view({ ...onFold, swivelKinds: ['inside'] }, { preview: preview() }), calls, mouse);
    expect(other?.vertex?.kind?.options.map((option) => [option.value, option.disabled])).toEqual([
      ['open', true],
      ['inside', false],
    ]);
    // Not while clicking, nor before the engine has described it, nor at a free vertex.
    expect(foldToolWindow(t, view(onFold, { picks: 3 }), calls, mouse)?.vertex?.kind).toBeNull();
    const asking = foldToolWindow(t, view({ ...onFold, described: false }, { preview: preview() }), calls, mouse);
    expect(asking?.vertex?.kind).toBeNull();
    const free = foldToolWindow(t, view({ ...onFold, onFold: false }, { preview: preview() }), calls, mouse);
    expect(free?.vertex?.kind).toBeNull();
  });

  it('steps the layer order when the fold leaves several', () => {
    const calls = verbs();
    const model = foldToolWindow(t, view(vertex({ orders: 3, order: 1 }), { preview: preview() }), calls, mouse);
    expect(model?.vertex?.order?.value).toBe('2 of 3');
    model?.vertex?.order?.next.run();
    expect(calls.stepOrder).toHaveBeenCalledWith(1);
  });

  it('holds the commit until the step is built, and offers nothing about a flap the engine refused', () => {
    const waiting = foldToolWindow(t, view(vertex({ known: false }), { preview: preview() }), verbs(), mouse);
    expect(waiting?.footer?.commit.disabled).toBe(true);
    const noFlap = refused({ code: 'squash_no_flap', faces: [0], cause: 'single_layer' });
    const model = foldToolWindow(
      t,
      view(vertex({ described: false, known: false }), { preview: preview({ refused: noFlap }) }),
      verbs(),
      mouse
    );
    expect(model?.vertex?.target).toBeNull();
    expect(model?.instructions.items).toEqual(['Press Esc and pick again: the notice below says what to change.']);
    expect(model?.refusal).toMatchObject({
      title: 'No flap to squash here',
      text: 'Only one layer lies here. Click a flap of two layers joined along a folded edge.',
    });
    expect(model?.footer?.commit.disabled).toBe(true);
    // A refusal with a fix to take says so first.
    const unprecreased = refused({ code: 'petal_not_precreased', faces: [], missing: 'line' });
    const petal = foldToolWindow(
      t,
      view(vertex({ tool: 'petal', described: false, known: false }), { preview: preview({ refused: unprecreased }) }),
      verbs(),
      mouse
    );
    expect(petal?.refusal?.actions.map((action) => action.label)).toEqual(['Precrease the hinge first']);
    expect(petal?.instructions.items).toEqual(['Click a fix below, or press Esc and pick again.']);
    const touch = foldToolWindow(
      t,
      view(vertex({ tool: 'petal', described: false, known: false }), { preview: preview({ refused: unprecreased }) }),
      verbs(),
      finger
    );
    expect(touch?.instructions.items).toEqual(['Tap a fix below, or tap Cancel and pick again.']);
  });
});

describe('a vertex fold’s refusals', () => {
  const vertexContext = (tool: FoldVertexWindowView['tool'], extra = {}) => ({
    kind: 'vertex' as const,
    flapNumber: (flap: number) => flap + 1,
    flapOf: null,
    readOnly: false,
    vertex: { tool, ...extra },
  });

  it('words every code of the family in the tool’s words, never as a fold that cannot be made', () => {
    const bodies: Record<(typeof FOLD_VERTEX_REFUSAL_CODES)[number], FoldRefusalBody> = {
      squash_no_flap: { code: 'squash_no_flap', faces: [0], cause: 'no_hinge' },
      squash_flap_not_free: { code: 'squash_flap_not_free', faces: [1] },
      squash_flap_covered: { code: 'squash_flap_covered', faces: [1] },
      squash_target_outside: { code: 'squash_target_outside' },
      petal_not_precreased: { code: 'petal_not_precreased', faces: [1], missing: 'kite' },
      petal_no_flap: { code: 'petal_no_flap', faces: [1], cause: 'no_corner' },
      fan_center: { code: 'fan_center', faces: [1] },
      fan_ray_blocked: { code: 'fan_ray_blocked', faces: [1] },
      fan_not_flat: { code: 'fan_not_flat' },
      fan_fourth_beside_stayer: { code: 'fan_fourth_beside_stayer' },
      fan_fourth_cannot_rise: { code: 'fan_fourth_cannot_rise' },
      fan_stayer_detached: { code: 'fan_stayer_detached', point: [0.5, 0.5] },
      swivel_not_an_edge: { code: 'swivel_not_an_edge', point: [0.5, 0.3] },
      swivel_target_parallel: { code: 'swivel_target_parallel', faces: [0] },
      swivel_pivot_on_edge: { code: 'swivel_pivot_on_edge', faces: [0] },
      swivel_edge_short: { code: 'swivel_edge_short', faces: [0] },
      swivel_edge_stays: { code: 'swivel_edge_stays', faces: [0] },
      swivel_line_meeting: { code: 'swivel_line_meeting' },
      swivel_no_flap: { code: 'swivel_no_flap', faces: [17, 18] },
      swivel_not_a_fold: { code: 'swivel_not_a_fold', point: [0.75, 0.6] },
      swivel_misses_fold: { code: 'swivel_misses_fold', faces: [17, 18] },
      swivel_fold_wide: { code: 'swivel_fold_wide', faces: [17, 18] },
      swivel_inside_free: { code: 'swivel_inside_free', faces: [0] },
    };
    const titles = new Set<string>();
    for (const code of FOLD_VERTEX_REFUSAL_CODES) {
      const notice = foldRefusalNotice(t, refused(bodies[code]), vertexContext('squash'), verbs());
      expect(notice.title, code).not.toBe('This fold cannot be made');
      expect(notice.text, code).not.toBe('It would not land on a valid flat model.');
      titles.add(notice.title);
      // Read away from its tool, it is still worded, by the fold its code names.
      const bare = foldRefusalNotice(t, refused(bodies[code]), { ...vertexContext('squash'), vertex: undefined }, verbs());
      expect(bare.title, code).toBe(notice.title);
    }
    expect(titles.size).toBeGreaterThan(14);
    // Each cause says its own reason.
    for (const cause of ['single_layer', 'no_spine', 'no_hinge', 'upper_not_hinged'] as const) {
      const notice = foldRefusalNotice(t, refused({ code: 'squash_no_flap', faces: [0], cause }), vertexContext('squash'), verbs());
      expect(notice.text, cause).not.toBe('');
    }
    // A covered petal lifts; a covered squash opens.
    const petal = foldRefusalNotice(t, refused(bodies.squash_flap_covered), vertexContext('petal'), verbs());
    expect(petal.text).toMatch(/lift it the other way/);
    const ear = foldRefusalNotice(t, refused(bodies.fan_center), vertexContext('rabbit-ear'), verbs());
    expect(ear.text).toMatch(/incenter/);
    // A fourth crease beside the paper that stays: refused, offering the ones across from it.
    const calls = verbs();
    const beside = foldRefusalNotice(
      t,
      refused(bodies.fan_fourth_beside_stayer, [{ fix: 'use_emergent', direction: [0, -1] }]),
      vertexContext('rabbit-ear', { emergentNumber: () => 2 }),
      calls
    );
    expect(beside.title).toBe('The fourth crease is beside the paper that stays');
    expect(beside.text).toMatch(/rises along the fourth crease/);
    expect(beside.actions.map((action) => action.label)).toEqual(['Use fourth crease 2']);
    beside.actions[0]?.run();
    expect(calls.takeEmergent).toHaveBeenCalledWith([0, -1]);
  });

  it('words a petal fold with no flap by what the engine names of it: a hinge that misses the flap, or too near its closed point', () => {
    const noFlap = (cause: 'no_ends' | 'no_corner', detail?: object) =>
      foldRefusalNotice(t, refused({ code: 'petal_no_flap', faces: [1], cause, ...(detail ? { detail } : {}) } as FoldRefusalBody), vertexContext('petal'), verbs());
    expect(noFlap('no_ends', { kind: 'misses_flap' })).toMatchObject({
      title: 'The hinge misses the flap',
      text: expect.stringMatching(/lies wholly on one side of the hinge/),
    });
    expect(noFlap('no_corner', { kind: 'past_corner', corner: [0.1, 0.1] })).toMatchObject({
      title: 'The hinge is too near the closed point',
      text: expect.stringMatching(/Move the hinge farther from the flap’s closed point/),
    });
    expect(noFlap('no_ends').title).toBe('The hinge does not cross the flap');
    expect(noFlap('no_corner').title).toBe('No point to lift');
  });

  it('words a swivel by its edge in its own words: its ridge, its pivot, and the plain fold along the bisector', () => {
    const calls = verbs();
    const swivel = vertexContext('swivel', { swivel: 'edge' });
    const short = foldRefusalNotice(
      t,
      refused({ code: 'swivel_edge_short', faces: [0] }, [{ fix: 'use_line', line: { n: [0.38, -0.92], d: 0 }, side: 'negative' }]),
      swivel,
      calls
    );
    expect(short.title).toBe('The edge ends before it would turn');
    expect(short.actions.map((action) => action.label)).toEqual(['Fold the edge onto the line instead']);
    short.actions[0]?.run();
    expect(calls.useLine).toHaveBeenCalledTimes(1);
    const blocked = foldRefusalNotice(
      t,
      refused({ code: 'fan_ray_blocked', faces: [1] }, [{ fix: 'use_emergent', direction: [0.5, -0.5] }]),
      swivel,
      calls
    );
    expect(blocked.text).toMatch(/Pick another pivot, or another line for the edge to land on/);
    expect(blocked.actions.map((action) => action.label)).toEqual(['Use the other ridge']);
    blocked.actions[0]?.run();
    expect(calls.takeEmergent).toHaveBeenCalledWith([0.5, -0.5]);
    expect(foldRefusalNotice(t, refused({ code: 'fan_center', faces: [1] }), swivel, calls).text).toMatch(/pick another pivot/);
    // Read away from its tool, a swivel by its edge's own code is still its own.
    const bare = foldRefusalNotice(t, refused({ code: 'swivel_target_parallel', faces: [0] }), { ...swivel, vertex: undefined }, calls);
    expect(bare.title).toBe('The line runs parallel to the edge');
  });

  it('makes every fix a button that acts: the other direction, a fourth crease that fits', () => {
    const calls = verbs();
    const notice = foldRefusalNotice(
      t,
      refused({ code: 'fan_ray_blocked', faces: [1] }, [
        { fix: 'opposite_direction' },
        { fix: 'use_emergent', direction: [0, 1] },
      ]),
      vertexContext('swivel', { emergentNumber: () => 3 }),
      calls
    );
    expect(notice.actions.map((action) => action.label)).toEqual(['Fold it the other way', 'Use fourth crease 3']);
    notice.actions.forEach((action) => action.run());
    expect(calls.vertexOtherWay).toHaveBeenCalledTimes(1);
    expect(calls.foldOtherWay).not.toHaveBeenCalled();
    expect(calls.takeEmergent).toHaveBeenCalledWith([0, 1]);
  });

  it('gives the refusals the engine offers no fix for the tools’ own buttons', () => {
    const calls = verbs();
    const target = foldRefusalNotice(t, refused({ code: 'squash_target_outside' }), vertexContext('squash'), calls);
    expect(target.actions.map((action) => action.label)).toEqual(['Put the spine onto the hinge']);
    target.actions[0]?.run();
    expect(calls.resetSquashTarget).toHaveBeenCalledTimes(1);

    const line = { code: 'petal_not_precreased' as const, faces: [], missing: 'line' as const };
    const crease = foldRefusalNotice(t, refused(line), vertexContext('petal'), calls);
    expect(crease.title).toBe('Precrease the hinge first');
    expect(crease.text).toMatch(/^The hinge crease does not run through every layer/);
    expect(crease.actions.map((action) => action.label)).toEqual(['Precrease the hinge first']);
    const ends = foldRefusalNotice(t, refused(line), vertexContext('petal', { hinge: 'points' }), calls);
    expect(ends.text).toMatch(/^The hinge crosses paper of the second layer/);
    ends.actions[0]?.run();
    expect(calls.precreaseLine).toHaveBeenCalledTimes(1);

    const kiteBody = { code: 'petal_not_precreased' as const, faces: [1], missing: 'kite' as const };
    const kite = foldRefusalNotice(t, refused(kiteBody), vertexContext('petal', { hinge: 'crease' }), calls);
    expect(kite.title).toBe('The kite creases are not there');
    expect(kite.actions.map((action) => action.label)).toEqual(['Crease the kites as it folds', 'Precrease the kite']);
    kite.actions.forEach((action) => action.run());
    expect(calls.petalByEnds).toHaveBeenCalledTimes(1);
    expect(calls.precreaseKite).toHaveBeenCalledTimes(1);
    // By its ends, the fold creases the kite already: only the Precrease tool is left to offer.
    const byEnds = foldRefusalNotice(t, refused(kiteBody), vertexContext('petal', { hinge: 'points' }), calls);
    expect(byEnds.actions.map((action) => action.label)).toEqual(['Precrease the kite']);
    // Read-only: shown, none taken.
    const locked = foldRefusalNotice(t, refused(line), { ...vertexContext('petal'), readOnly: true }, calls);
    expect(locked.actions.every((action) => action.disabled)).toBe(true);
  });
});

describe('a squash about a drawn hinge', () => {
  const locating = vertex({ tool: 'squash', squashHinge: 'line', lineTaken: false, lineLocated: true, described: false, known: false });

  it('locates the hinge with the line modes, takes it with Enter, then asks for the end of the flap', () => {
    const actions = verbs();
    const window = foldToolWindow(t, view(locating, { picks: 1, lineMode: 'crease', preview: preview() }), actions, mouse)!;
    expect(window.phase).toBe('locate');
    expect(window.lineMode).toMatchObject({ value: 'crease', label: 'Hinge line' });
    expect(window.instructions.intro).toBe('Draw the hinge across the flap’s folded edge. Only the end beyond it squashes.');
    expect(window.instructions.items.at(-1)).toBe('Press Enter to take it as the hinge.');
    expect(window.footer?.commit).toMatchObject({ label: 'Use as the hinge', disabled: false });
    window.footer!.commit.run();
    expect(actions.commit).toHaveBeenCalledOnce();
    expect(foldToolWindow(t, view({ ...locating, lineLocated: false }, { lineMode: 'crease' }), actions, mouse)!.footer?.commit.disabled).toBe(true);
    // Taken: no line mode, and the click names the end on one side of it.
    const taken = foldToolWindow(t, view({ ...locating, lineTaken: true }, { lineMode: 'crease' }), actions, mouse)!;
    expect(taken.lineMode).toBeNull();
    expect(taken.instructions.items[0]).toBe('Click the end of the flap to squash, on one side of the line.');
    expect(taken.vertex?.hinge?.value).toBe('line');
  });
});

describe('a swivel by its valley and mountain', () => {
  const valleyStep = vertex({ tool: 'swivel', swivelInput: 'valley-mountain', lineTaken: false, lineLocated: true, described: false, known: false });

  it('names each line by its letter, the line modes’ own clicks under it, and takes the valley with Enter', () => {
    const actions = verbs();
    const window = foldToolWindow(t, view(valleyStep, { picks: 2, lineMode: 'axiom-1', preview: preview() }), actions, mouse)!;
    expect(window.lineMode).toMatchObject({ value: 'axiom-1', label: 'Valley line' });
    expect(window.instructions.intro).toBe('Pick the valley line: the flap’s hinge, on the layer you see, from a point on a folded edge into the paper.');
    expect(window.instructions.items).toEqual([
      'Valley line: Click the first point the fold passes through.',
      'Valley line: Click the second point.',
      'Press Enter to take it as the valley.',
    ]);
    expect(window.footer?.commit).toMatchObject({ label: 'Use as the valley', disabled: false });
    window.footer!.commit.run();
    expect(actions.commit).toHaveBeenCalledOnce();
    // Not until a line is located.
    const none = foldToolWindow(t, view({ ...valleyStep, lineLocated: false }, { lineMode: 'crease' }), actions, mouse)!;
    expect(none.footer?.commit.disabled).toBe(true);
  });

  it('locates the mountain next, offers no direction, and folds with Enter', () => {
    const taken = { ...valleyStep, lineTaken: true };
    const mountain = foldToolWindow(t, view(taken, { lineMode: 'crease' }), verbs(), mouse)!;
    expect(mountain.lineMode).toMatchObject({ value: 'crease', label: 'Mountain line' });
    expect(mountain.instructions.intro).toContain('mountain line');
    expect(mountain.instructions.items[0]).toMatch(/^Mountain line: /);
    expect(mountain.instructions.items.at(-1)).toBe('Press Enter to fold.');
    expect(mountain.vertex?.direction).toBeNull();
    // Its kind is the folder's to ask from the first pick: both offered until the engine says which land.
    const asking = foldToolWindow(t, view({ ...taken, onFold: true, swivelKind: 'open' }, { lineMode: 'crease' }), verbs(), mouse)!;
    expect(asking.vertex?.kind?.value).toBe('open');
    expect(asking.vertex?.kind?.options.map((option) => option.disabled)).toEqual([false, false]);
    // The kind asked refused before any answer said which land: the other still offered.
    const refused = foldToolWindow(t, view({ ...taken, onFold: true, swivelKind: 'open', described: false }, { preview: preview() }), verbs(), mouse)!;
    expect(refused.vertex?.kind?.options.map((option) => option.disabled)).toEqual([false, false]);
    // Answered: the kind that does not land offered disabled, the kind asked among them.
    const answered = foldToolWindow(
      t,
      view({ ...taken, onFold: true, described: true, known: false, swivelKind: 'open', swivelKinds: ['inside'] }, { preview: preview() }),
      verbs(),
      mouse
    )!;
    expect(answered.vertex?.kind?.options.map((option) => option.disabled)).toEqual([true, false]);
    // Previewed: still no direction, its kinds offered where both land.
    const previewed = foldToolWindow(
      t,
      view({ ...taken, onFold: true, described: true, known: true, swivelKind: 'open', swivelKinds: ['open', 'inside'], directions: [true, false] }, { preview: preview() }),
      verbs(),
      mouse
    )!;
    expect(previewed.vertex?.direction).toBeNull();
    expect(previewed.vertex?.kind?.options.map((option) => option.disabled)).toEqual([false, false]);
    expect(previewed.vertex?.lineBy).toBeNull();
  });
});

describe('a swivel never folds another way or kind than the one asked', () => {
  const onFold = vertex({ tool: 'swivel', onFold: true, described: true, known: false, swivelKind: 'open' });

  it('offers the other way when only that lands, the way asked disabled', () => {
    const window = foldToolWindow(t, view({ ...onFold, direction: 'valley', directions: [false, true] }, { picks: 3, preview: preview() }), verbs(), mouse)!;
    expect(window.vertex?.direction?.value).toBe('valley');
    expect(window.vertex?.direction?.options.map((option) => option.disabled === true)).toEqual([true, false]);
    // Only the way asked lands: no choice, no control.
    const only = foldToolWindow(t, view({ ...onFold, direction: 'valley', directions: [true, false] }, { picks: 3, preview: preview() }), verbs(), mouse)!;
    expect(only.vertex?.direction).toBeNull();
  });

  it('offers the other kind when only that lands, the kind asked disabled', () => {
    const window = foldToolWindow(t, view({ ...onFold, swivelKinds: ['inside'] }, { picks: 3, preview: preview() }), verbs(), mouse)!;
    expect(window.vertex?.kind?.value).toBe('open');
    expect(window.vertex?.kind?.options.map((option) => option.disabled)).toEqual([true, false]);
    // Only the kind asked lands: no control.
    const only = foldToolWindow(t, view({ ...onFold, swivelKinds: ['open'] }, { picks: 3, preview: preview() }), verbs(), mouse)!;
    expect(only.vertex?.kind).toBeNull();
  });
});
