import { describe, expect, it } from 'vitest';
import { flatSquareLandmarks, flatSquareScene } from '../canvas/foldCanvas.fixtures';
import { foldPickIndex, type FoldPick, type FoldPointPick } from '../canvas/foldPicking';
import { foldStepInputKey } from '../session/foldSessionEngine';
import { buildFoldStep } from './foldStepBuilder';
import {
  clampDivideParts,
  createFoldTools,
  FOLD_EVERY_LAYER,
  FOLD_TOOL_INITIAL,
  foldToolInputKey,
  hasToolInput,
  isLocated,
  picksAlongLine,
  type FoldResolvedSeed,
  type FoldToolState,
} from './foldToolState';

const point = (x: number, y: number): FoldPick => ({
  kind: 'point',
  provenance: 'vertex',
  sheet: [x, y],
  mark: null,
  scene: { x, y },
});

/** The bottom edge, as a line click takes it. */
const edge: FoldPick = {
  kind: 'segment',
  edge: 0,
  segment: 'raw_edge',
  sheet: [
    [0, 0],
    [1, 0],
  ],
  scene: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
};

const flapA = { faces: [1], witness: [0.2, 0.2] as [number, number] };
const flapB = { faces: [2], witness: [0.8, 0.2] as [number, number] };

describe('the Fold tools’ state', () => {
  it('retains free-line snapping between folds without changing already placed endpoints', () => {
    const tools = createFoldTools();
    expect(tools.store.getState().freeLineSnap).toBe(true);
    tools.pick(point(1, 0));
    const key = foldToolInputKey(tools.store.getState());
    tools.setFreeLineSnap(false);
    expect(foldToolInputKey(tools.store.getState())).toBe(key);
    expect(tools.store.getState().picks).toEqual([point(1, 0)]);
    tools.clear(); tools.selectTool('mountain'); tools.selectLineMode('free');
    expect(tools.store.getState().freeLineSnap).toBe(false);
  });

  it('locates once every click is in, and takes no click past the last', () => {
    const tools = createFoldTools();
    expect(tools.pick(point(1, 0))).toBe(true);
    expect(isLocated(tools.store.getState())).toBe(false);
    expect(tools.pick(point(0, 1))).toBe(true);
    expect(isLocated(tools.store.getState())).toBe(true);
    expect(tools.pick(point(0, 0))).toBe(false);
    expect(tools.store.getState().picks).toHaveLength(2);
  });

  it('keeps the line through V, M and P, and locates anew for another line mode or the Divide line', () => {
    const tools = createFoldTools();
    tools.pick(point(1, 0));
    tools.pick(point(0, 1));
    tools.selectTool('mountain');
    expect(tools.store.getState()).toMatchObject({ tool: 'mountain', picks: [point(1, 0), point(0, 1)] });
    tools.selectLineMode('free');
    expect(tools.store.getState()).toMatchObject({ lineMode: 'free', picks: [] });
    tools.selectTool('divide-line');
    tools.selectLineMode('axiom-3');
    // A line mode belongs to the folds: it takes one in hand.
    expect(tools.store.getState().tool).toBe('valley');
  });

  it('lets go of the clicks and every choice on a clear, and says whether there was any', () => {
    const tools = createFoldTools();
    expect(hasToolInput(tools.store.getState())).toBe(false);
    tools.pick(point(1, 0));
    tools.swapSide();
    tools.stepRoot(1, 2);
    expect(hasToolInput(tools.store.getState())).toBe(true);
    tools.clear();
    expect(tools.store.getState()).toMatchObject({ picks: [], swapped: false, root: 0, seed: { scope: 'top' } });
  });

  it('starts every fold on the top flap, and goes back to it on a clear and on a new pick (owner request, 2026-10-13)', () => {
    const tools = createFoldTools();
    expect(FOLD_TOOL_INITIAL.seed).toEqual({ scope: 'top' });
    tools.pick(point(1, 0));
    tools.pick(point(0, 1));
    tools.toggleFlap(flapB, [flapA, flapB], { scope: 'flaps', flaps: [flapA] });
    // Widened to every flap: every layer.
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
    // Escape's rung, and a commit's: the picks go, and the seed is the top flap again.
    tools.clear();
    expect(tools.store.getState()).toMatchObject({ picks: [], seed: { scope: 'top' } });
    // A widened seed alone is still something to let go.
    tools.setSeed({ scope: 'all' });
    expect(hasToolInput(tools.store.getState())).toBe(false);
    tools.clear();
    expect(tools.store.getState().seed).toEqual({ scope: 'top' });
    // Another line mode starts a new pick: the top flap again.
    tools.pick(point(1, 0));
    tools.pick(point(0, 1));
    tools.setSeed({ scope: 'flaps', flaps: [flapB] });
    tools.selectLineMode('free');
    expect(tools.store.getState()).toMatchObject({ picks: [], seed: { scope: 'top' } });
  });

  it('keeps the flaps picked through V, M and P along one line: the same layers fold the other way', () => {
    const tools = createFoldTools();
    tools.pick(point(1, 0));
    tools.pick(point(0, 1));
    tools.selectTool('mountain');
    expect(tools.store.getState().seed).toEqual({ scope: 'top' });
    tools.toggleFlap(flapB, [flapA, flapB], { scope: 'flaps', flaps: [flapA] });
    tools.selectTool('precrease');
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
  });

  it('swaps the side only once the line is located, and folds the new side’s own top flap', () => {
    const tools = createFoldTools();
    tools.pick(point(1, 0));
    // No line yet, no side: nothing is latched for the line to come.
    expect(tools.swapSide()).toBe(false);
    expect(tools.store.getState().swapped).toBe(false);
    tools.pick(point(0, 1));
    tools.setSeed({ scope: 'flaps', flaps: [flapB] });
    expect(tools.swapSide()).toBe(true);
    // The flap picked was the other side's: the new side's top flap is read from its own section.
    expect(tools.store.getState()).toMatchObject({ swapped: true, seed: { scope: 'top' } });
    // And back: the first side's top flap again, not the flap picked there before.
    tools.setSeed({ scope: 'all' });
    tools.swapSide();
    expect(tools.store.getState()).toMatchObject({ swapped: false, seed: { scope: 'top' } });
  });

  it('folds the other side on a swap under a flap seed', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const free = (x: number, y: number): FoldPick => ({ kind: 'free', pane: 'folded', scene: { x, y }, sheet: [x, y] });
    const tools = createFoldTools({ ...FOLD_TOOL_INITIAL, lineMode: 'free' });
    tools.pick(free(0, 0.5));
    tools.pick(free(1, 0.5));
    tools.setSeed({ scope: 'flaps', flaps: [{ faces: [0], witness: [0.5, 0.25] }] });
    const stepOf = (state: FoldToolState) => {
      // The flat square's moving side is one flap: its top flap is every layer (`topFlapSeed`).
      const seed: FoldResolvedSeed = state.seed.scope === 'top' ? FOLD_EVERY_LAYER : state.seed;
      const built = buildFoldStep(
        {
          kind: 'valley',
          lineMode: state.lineMode,
          picks: state.picks,
          candidate: null,
          swapped: state.swapped,
          seed,
          precreaseDirection: state.precreaseDirection,
        },
        index
      );
      if (built.status !== 'built') throw new Error(built.status);
      return built;
    };
    const before = stepOf(tools.store.getState());
    tools.swapSide();
    expect(tools.store.getState().seed).toEqual({ scope: 'top' });
    const after = stepOf(tools.store.getState());
    expect(foldStepInputKey({ op: after.op })).not.toBe(foldStepInputKey({ op: before.op }));
    expect(after.movingSign).toBe(-before.movingSign);
    // The new side's top flap, which is all of it, by a point of it.
    expect(after.op).toMatchObject({ seed: { scope: 'all' } });
  });

  it('widens from the top flap one chip at a time, every flap picked being every layer', () => {
    const tools = createFoldTools();
    // The top flap is pressed alone: pressing the other picks both, every layer.
    tools.toggleFlap(flapB, [flapA, flapB], { scope: 'flaps', flaps: [flapA] });
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
    // Unpressing it narrows back to the top flap, named now.
    tools.toggleFlap(flapB, [flapA, flapB], { scope: 'flaps', flaps: [flapA] });
    expect(tools.store.getState().seed).toEqual({ scope: 'flaps', flaps: [flapA] });
    // From every layer, a chip unpressed leaves the others.
    tools.setSeed({ scope: 'all' });
    tools.toggleFlap(flapA, [flapA, flapB], { scope: 'flaps', flaps: [flapA] });
    expect(tools.store.getState().seed).toEqual({ scope: 'flaps', flaps: [flapB] });
    tools.toggleFlap(flapA, [flapA, flapB], { scope: 'flaps', flaps: [flapA] });
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
  });

  it('never leaves a seed of no flaps: unpicking the only one picked is every layer', () => {
    const tools = createFoldTools();
    // The top flap, the only chip pressed, unpressed: the engine would refuse a
    // seed of none (`no_side`) and the window would have no chips left to pick
    // one again.
    tools.toggleFlap(flapA, [flapA, flapB], { scope: 'flaps', flaps: [flapA] });
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
    tools.setSeed({ scope: 'flaps', flaps: [flapB] });
    tools.toggleFlap(flapB, [flapA, flapB], { scope: 'flaps', flaps: [flapA] });
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
    // A section of one flap, the top flap every layer: its chip cannot be unpressed into nothing either.
    tools.setSeed({ scope: 'top' });
    tools.toggleFlap(flapA, [flapA], { scope: 'flaps', flaps: [flapA] });
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
    tools.setSeed({ scope: 'flaps', flaps: [] });
    expect(tools.store.getState().seed).toEqual({ scope: 'all' });
  });

  it('keeps a sink’s line and its fix’s between the open and the closed sink, its pocket stepped anew', () => {
    const tools = createFoldTools();
    tools.selectTool('open-sink');
    tools.pick(point(1, 0));
    tools.pick(point(0, 1));
    const square = {
      op: { kind: 'open-sink' as const, line: { via: 'free' as const, through: [[0, 0.4], [1, 0.4]] as [[number, number], [number, number]] }, seed: { scope: 'all' as const } },
    };
    tools.setOverride(square);
    tools.selectTool('closed-sink');
    expect(tools.store.getState()).toMatchObject({ tool: 'closed-sink', picks: [point(1, 0), point(0, 1)], override: square });
    tools.stepPocket(1, 2);
    expect(tools.store.getState().compound).toMatchObject({ pocket: 1, order: 0 });
    tools.stepPocket(1, 2);
    expect(tools.store.getState().compound.pocket).toBe(0);
    tools.stepPocket(1, 1);
    expect(tools.store.getState().compound.pocket).toBe(0);
    // The unsink keeps the line, but not a sink's fix.
    tools.selectTool('unsink');
    expect(tools.store.getState()).toMatchObject({ tool: 'unsink', picks: [point(1, 0), point(0, 1)], override: null });
  });

  it('steps through the roots round, and keeps the Divide line’s parts within the Diagram’s', () => {
    const tools = createFoldTools();
    tools.stepRoot(-1, 3);
    expect(tools.store.getState().root).toBe(2);
    tools.stepRoot(1, 3);
    expect(tools.store.getState().root).toBe(0);
    tools.setDivide({ parts: 99 });
    expect(tools.store.getState().divide.parts).toBe(32);
    expect(clampDivideParts(1)).toBe(2);
    expect(clampDivideParts(Number.NaN)).toBe(2);
  });

  it('locates a crimp’s two lines one after the other, keeping the first through a change of the second’s mode', () => {
    const tools = createFoldTools();
    tools.selectLineMode('axiom-1');
    tools.selectTool('crimp');
    tools.pick(point(1, 0));
    tools.pick(point(0, 1));
    // The first line is in; the second, a free line by default, is not.
    expect(isLocated(tools.store.getState())).toBe(false);
    tools.pick(point(0.2, 0.2));
    tools.setSecondLineMode('crease');
    // The second line is located anew in its mode: one click, the first line's kept.
    expect(tools.store.getState()).toMatchObject({ secondLineMode: 'crease' });
    expect(tools.store.getState().picks).toHaveLength(2);
    tools.pick(point(0.5, 0.5));
    expect(isLocated(tools.store.getState())).toBe(true);
    expect(tools.pick(point(0.6, 0.6))).toBe(false);
    // Another tool along a line keeps the first line, never the second's clicks.
    tools.selectTool('valley');
    expect(tools.store.getState().picks).toHaveLength(2);
    expect(isLocated(tools.store.getState())).toBe(true);
    // The second line's mode stays chosen, as the line mode does.
    tools.clear();
    expect(tools.store.getState().secondLineMode).toBe('crease');
  });

  it('keeps a tuck’s direction from fold to fold, and takes its target anew for another direction', () => {
    const tools = createFoldTools();
    tools.selectTool('tuck');
    tools.setTuckDirection('mountain');
    tools.setTuckTarget(7);
    tools.stepOrder(1, 2);
    // Another target is another tuck: its orders are its own.
    tools.setTuckTarget(5);
    expect(tools.store.getState().compound).toMatchObject({ tuckTarget: 5, order: 0 });
    tools.stepOrder(1, 2);
    tools.setTuckDirection('valley');
    expect(tools.store.getState()).toMatchObject({ tuckDirection: 'valley', compound: { tuckTarget: null, order: 0 } });
    tools.setTuckDirection('mountain');
    tools.pick(point(0.1, 0.1));
    tools.setTuckTarget(3);
    tools.clear();
    // A clear lets the target go; the direction stays chosen, as a precrease's does.
    expect(tools.store.getState()).toMatchObject({ tuckDirection: 'mountain', compound: { tuckTarget: null } });
  });
});

describe('the vertex folds’ tool state', () => {
  const free = (x: number, y: number): FoldPick => ({ kind: 'free', pane: 'folded', scene: { x, y }, sheet: [x, y] });

  it('takes each tool’s own clicks, and swaps no moving side', () => {
    const tools = createFoldTools();
    tools.selectTool('squash');
    expect(tools.pick(free(0.2, 0.2))).toBe(true);
    expect(isLocated(tools.store.getState())).toBe(true);
    expect(tools.pick(free(0.3, 0.3))).toBe(false);
    expect(tools.swapSide()).toBe(false);
    // A swivel: its pivot, its edge and the line it lands on.
    tools.selectTool('swivel');
    expect(tools.store.getState().picks).toEqual([]);
    tools.pick(point(0.5, 0.3));
    tools.pick(edge);
    expect(isLocated(tools.store.getState())).toBe(false);
    tools.pick(edge);
    expect(isLocated(tools.store.getState())).toBe(true);
  });

  it('names a swivel’s target by a crease or two points, its pivot and edge kept when that changes', () => {
    const tools = createFoldTools();
    tools.selectTool('swivel');
    tools.pick(point(0.5, 0.3));
    tools.pick(edge);
    tools.setEmergent(1);
    tools.setSwivelTarget('points');
    expect(tools.store.getState()).toMatchObject({ swivelTarget: 'points', compound: { emergent: null } });
    expect(tools.store.getState().picks).toHaveLength(2);
    tools.pick(point(0, 1));
    expect(isLocated(tools.store.getState())).toBe(false);
    tools.pick(point(1, 0.5));
    expect(isLocated(tools.store.getState())).toBe(true);
    // Kept from fold to fold, as the line mode is.
    tools.clear();
    expect(tools.store.getState().swivelTarget).toBe('points');
  });

  it('names a petal fold’s hinge by its crease or its two ends, its clicks starting again, and takes no line mode', () => {
    const tools = createFoldTools();
    tools.selectTool('petal');
    expect(tools.store.getState().petalHinge).toBe('crease');
    // The hinge crease, then the flap.
    tools.pick(edge);
    expect(isLocated(tools.store.getState())).toBe(false);
    tools.pick(free(0.5, 0.2));
    expect(isLocated(tools.store.getState())).toBe(true);
    tools.setPetalHinge('points');
    expect(tools.store.getState()).toMatchObject({ tool: 'petal', petalHinge: 'points', picks: [] });
    // Its two ends, then the flap.
    tools.pick(point(0.2, 0.5));
    tools.pick(point(0.8, 0.5));
    expect(isLocated(tools.store.getState())).toBe(false);
    tools.pick(free(0.5, 0.2));
    expect(isLocated(tools.store.getState())).toBe(true);
    // A line mode is a fold's: choosing one takes a fold in hand.
    tools.selectLineMode('axiom-1');
    expect(tools.store.getState()).toMatchObject({ tool: 'valley', lineMode: 'axiom-1' });
    // Another tool's hinge setting changes no picks of its own.
    tools.pick(point(0.2, 0.5));
    tools.setPetalHinge('crease');
    expect(tools.store.getState().picks).toHaveLength(1);
  });

  it('lists the choices after one made anew, and keeps the direction from fold to fold', () => {
    const tools = createFoldTools();
    tools.selectTool('rabbit-ear');
    tools.setEmergent(2);
    tools.stepOrder(1, 3);
    expect(tools.store.getState().compound).toMatchObject({ emergent: 2, order: 1 });
    // Another fourth ray: its orders are listed anew.
    tools.setEmergent(0);
    expect(tools.store.getState().compound).toMatchObject({ emergent: 0, order: 0 });
    tools.stepOrder(1, 3);
    tools.setFanLayers(2);
    expect(tools.store.getState().compound).toMatchObject({ fanLayers: 2, order: 0 });
    tools.setVertexDirection('mountain');
    tools.setSquashTarget([0, 1]);
    expect(tools.store.getState().compound.squashTarget).toEqual([0, 1]);
    // Let go of the clicks: the choices go, the direction stays.
    tools.pick(point(0, 0));
    tools.clear();
    expect(tools.store.getState()).toMatchObject({
      vertexDirection: 'mountain',
      compound: { squashTarget: null, emergent: null, fanLayers: null, order: 0 },
    });
    expect(FOLD_TOOL_INITIAL.vertexDirection).toBe('valley');
  });

  it('picks a fan’s paper that stays again, listing its fourth creases and orders anew', () => {
    const tools = createFoldTools();
    tools.selectTool('rabbit-ear');
    for (const corner of [point(0, 1), point(1, 1), point(1, 0)]) tools.pick(corner);
    tools.pick(free(0.3, 0.3));
    expect(isLocated(tools.store.getState())).toBe(true);
    tools.setEmergent(2);
    tools.stepOrder(1, 3);
    tools.repick(free(0.8, 0.95));
    const state = tools.store.getState();
    expect(state.picks).toHaveLength(4);
    expect(state.picks[3]).toEqual(free(0.8, 0.95));
    expect(state.picks.slice(0, 3)).toEqual([point(0, 1), point(1, 1), point(1, 0)]);
    expect(state.compound).toMatchObject({ emergent: null, order: 0 });
    expect(isLocated(state)).toBe(true);
    // Nothing clicked: nothing to pick again.
    const fresh = createFoldTools();
    fresh.repick(free(0.5, 0.5));
    expect(fresh.store.getState().picks).toEqual([]);
  });

  it('clicks a precrease’s extent along its located line, steps back on Escape, and keeps the extent from fold to fold', () => {
    const tools = createFoldTools();
    tools.selectTool('precrease');
    tools.setExtent('segment');
    expect(FOLD_TOOL_INITIAL.extent).toBe('whole');
    // Before the line is located, a click is the line's.
    expect(picksAlongLine(tools.store.getState())).toBe(false);
    tools.pick(point(1, 0));
    tools.pick(point(0, 1));
    expect(picksAlongLine(tools.store.getState())).toBe(true);
    const [a, b, c] = [alongPoint(0.5, 0.5), alongPoint(0.75, 0.25), alongPoint(0.9, 0.1)];
    tools.pickAlong(a);
    tools.pickAlong(b);
    expect(tools.store.getState().extentPicks).toEqual([a, b]);
    // Once every point is in, a click starts the extent again from it.
    tools.pickAlong(c);
    expect(tools.store.getState().extentPicks).toEqual([c]);
    expect(hasToolInput(tools.store.getState())).toBe(true);
    // Escape's first rung: the last point along the line, then nothing more to step back.
    expect(tools.unpickAlong()).toBe(true);
    expect(tools.unpickAlong()).toBe(false);
    expect(tools.store.getState().picks).toHaveLength(2);
    // Another extent, or another root, starts its points over.
    tools.pickAlong(a);
    tools.setExtent('pinch');
    expect(tools.store.getState().extentPicks).toEqual([]);
    tools.pickAlong(b);
    tools.stepRoot(1, 2);
    expect(tools.store.getState().extentPicks).toEqual([]);
    // A commit lets the points go; the extent stays chosen.
    tools.pickAlong(b);
    tools.clear();
    expect(tools.store.getState()).toMatchObject({ extent: 'pinch', extentPicks: [], picks: [] });
    // Any other tool, or the whole line, clicks nothing along the line.
    tools.setExtent('whole');
    tools.pick(point(1, 0));
    tools.pick(point(0, 1));
    expect(picksAlongLine(tools.store.getState())).toBe(false);
    tools.pickAlong(a);
    expect(tools.store.getState().extentPicks).toEqual([]);
  });
});

function alongPoint(x: number, y: number): FoldPointPick {
  return { kind: 'point', provenance: 'crossing', sheet: [x, y], mark: null, scene: { x, y } };
}


it('retains additional tuck targets while comparing the primary target, and clears them for new geometry', () => {
  const tools = createFoldTools();
  tools.selectTool('tuck');
  tools.setTuckTarget(5);
  tools.stepOrder(1, 2);
  tools.toggleTuckPinned(7);
  expect(tools.store.getState().compound).toMatchObject({ tuckPinned: [7], order: 0 });
  tools.setTuckTarget(9);
  expect(tools.store.getState().compound.tuckPinned).toEqual([7]);
  tools.toggleTuckPinned(7);
  expect(tools.store.getState().compound.tuckPinned).toEqual([]);
  tools.toggleTuckPinned(7);
  tools.setSeed({ scope: 'all' });
  expect(tools.store.getState().compound.tuckPinned).toEqual([]);
});


it('steps the largest indexed opening list without losing a choice to integer rounding', () => {
  const tools = createFoldTools();
  const count = Number.MAX_SAFE_INTEGER;
  tools.stepOpening(2, count);
  expect(tools.store.getState().compound.opening).toBe(2);
  tools.stepOpening(-3, count);
  expect(tools.store.getState().compound.opening).toBe(count - 1);
  tools.stepOpening(1, count);
  expect(tools.store.getState().compound.opening).toBe(0);
});

it('keeps a swivel’s valley taken while the mountain’s line mode changes, and clears both on Escape', () => {
  const tools=createFoldTools();
  tools.selectTool('swivel');tools.setSwivelInput('valley-mountain');tools.selectLineMode('axiom-3');
  const valley={line:{via:'free' as const,through:[[0,0],[1,1]] as [[number,number],[number,number]]},sceneLine:{n:[1,-1] as [number,number],d:0}};
  tools.takeLine(valley);
  expect(hasToolInput(tools.store.getState())).toBe(true);
  tools.selectLineMode('crease');
  expect(tools.store.getState()).toMatchObject({tool:'swivel',takenLine:valley,lineMode:'crease',picks:[],root:0});
  tools.clear();
  expect(tools.store.getState().takenLine).toBeUndefined();
  expect(hasToolInput(tools.store.getState())).toBe(false);
});

it('keeps the kind a swivel by its valley and mountain asks for across its locates, and asks anew by its edge', () => {
  const tools = createFoldTools();
  tools.selectTool('swivel');
  tools.setSwivelInput('valley-mountain');
  tools.setSwivelKind('inside');
  const valley = { line: { via: 'free' as const, through: [[0, 0], [1, 1]] as [[number, number], [number, number]] }, sceneLine: { n: [1, -1] as [number, number], d: 0 } };
  // Another line mode, the valley taken, Escape: still the inside swivel asked.
  tools.selectLineMode('axiom-3');
  tools.takeLine(valley);
  tools.clear();
  expect(tools.store.getState().compound.swivelKind).toBe('inside');
  // Another construction asks anew.
  tools.setSwivelInput('edge');
  expect(tools.store.getState().compound.swivelKind).toBeNull();
  // By its edge, the kind is chosen once the picks are in, and a new locate starts it again.
  tools.setSwivelKind('inside');
  tools.clear();
  tools.pick(point(0.5, 0.5));
  tools.clear();
  expect(tools.store.getState().compound.swivelKind).toBeNull();
});

describe('the sequence tools in hand', () => {
  it('are held for one step, as Rotate is: put down, the tool they were taken up from is back', () => {
    const tools = createFoldTools();
    tools.selectTool('mountain');
    tools.selectTool('unfold-to');
    expect(tools.store.getState()).toMatchObject({ tool: 'unfold-to', resume: 'mountain' });
    // From one such tool to another, what they were taken up from stays.
    tools.selectTool('rotate');
    tools.selectTool('repeat');
    expect(tools.store.getState()).toMatchObject({ tool: 'repeat', resume: 'mountain' });
    expect(tools.putDown()).toBe(true);
    expect(tools.store.getState().tool).toBe('mountain');
    expect(tools.putDown()).toBe(false);
  });

  it("start from the step on screen each time they are taken up, keeping Repeat's axis and saving", () => {
    const tools = createFoldTools();
    tools.selectTool('unfold-to');
    tools.setUnfoldTarget(null);
    expect(tools.store.getState().unfoldTarget).toEqual({ id: null });
    tools.selectTool('repeat');
    tools.setRepeatFirst('s1');
    tools.setRepeatAxis({ n: [1, 0], d: 0.5 });
    tools.setRepeatIndividual(true);
    // Escape's rung lets the picks go, not the settings.
    tools.clear();
    expect(tools.store.getState()).toMatchObject({ repeatFirst: 's1', repeatIndividual: true });
    tools.putDown();
    tools.selectTool('repeat');
    tools.selectTool('unfold-to');
    expect(tools.store.getState()).toMatchObject({
      unfoldTarget: null,
      repeatFirst: null,
      repeatAxis: { n: [1, 0], d: 0.5 },
      repeatIndividual: true,
    });
  });

  it('rebuild a saved step with its own settings, let go once another tool is taken', () => {
    const tools = createFoldTools();
    tools.rebuildStep({
      tool: 'repeat',
      id: 'r',
      parent: 's2',
      expected: { kind: 'repeat', source: { first: 's1', last: 's2', revision: 'fh1:x' }, parentState: 'p', axis: { n: [0, 1], d: 0.5 }, steps: [] },
    });
    expect(tools.store.getState()).toMatchObject({ tool: 'repeat', repeatFirst: 's1', repeatAxis: { n: [0, 1], d: 0.5 }, rebuild: { id: 'r' } });
    // A rebuild's op is the store's to check, never part of what the tools are asked to fold.
    expect(foldToolInputKey(tools.store.getState())).toContain('"rebuild":"r"');
    tools.selectTool('valley');
    expect(tools.store.getState().rebuild).toBeNull();
    tools.rebuildStep({
      tool: 'unfold-to',
      id: 'u',
      parent: 's2',
      expected: { kind: 'unfold-to', target: 's1', source: { path: 'p', state: 'f', targetState: 't' } },
    });
    expect(tools.store.getState()).toMatchObject({ tool: 'unfold-to', unfoldTarget: { id: 's1' }, rebuild: { id: 'u' } });
    tools.dropRebuild();
    expect(tools.store.getState()).toMatchObject({ tool: 'unfold-to', rebuild: null });
  });
});
