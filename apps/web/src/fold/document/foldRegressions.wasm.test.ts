import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { foldPickIndex, resolveFoldPick, sheetPointsTogether, sheetToScene, type FoldPickIndex } from '../canvas/foldPicking';
import { toPoint } from '../canvas/foldCanvasGeometry';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import { createFoldEnginePort } from '../engine/foldEnginePort';
import type { FoldSceneCrease } from '../engine/foldEngineWire';
import { orderResolvedStep } from '../engine/foldEnginePreview';
import { findMoverFix, withMoverSwapped } from '../tools/moverStays';
import { FOLD_EVERY_LAYER, type FoldResolvedSeed } from '../tools/foldToolState';
import { findReverseSeedFix, narrowerReverseFlaps } from '../tools/reverse/reverseSeedFix';
import { reverseDrawnSegment, reverseSegmentSeed } from '../tools/reverse/reverseSegmentSeed';
import { buildReverseStep } from '../tools/reverse/reverseStep';
import { lineSectionProbe } from '../tools/topFlapSeed';
import { createFoldReplayer, type FoldReplayProgress } from './foldReplay';
import { isLockedStep, type FoldChoices, type FoldOp, type FoldSequenceDocument, type FoldStep, type SheetPoint } from './foldSequenceDocument';
import { readFoldSequences } from './foldSequenceFile';

/**
 * The fold-regression fixtures in `tests/fixtures/fold-regressions`: one
 * minimal sequence per bug fixed for the Fold workspace's launch, each built
 * from scratch (see the folder's README). Each opens as the app reads a
 * project and replays every step to its stored fingerprint through the real
 * bridge; then the behaviour its fix brought is asserted on the replayed
 * states: what a click on the folded pane takes, what lands and what moves.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const FIXTURES = resolve(ROOT, '../../tests/fixtures/fold-regressions');
const available = existsSync(WASM) && existsSync(FIXTURES);

/** The fixtures this file asserts; others in the folder have tests of their own, which the README names. */
const NAMES = [
  'edge-crossing.osf',
  'ghost-precrease.osf',
  'reverse-seed-segment.osf',
  'squash-covered.osf',
  'squash-drawn-hinge.osf',
  'tuck-target-layer.osf',
  'unfold-to-after-import.osf',
];

/** Every fixture the README lists, by its bullet's file name. */
function readmeNames(): string[] {
  const readme = readFileSync(resolve(FIXTURES, 'README.md'), 'utf8');
  return [...readme.matchAll(/^- `([^`]+\.osf)`/gm)].map((match) => match[1]!).sort();
}

/** A click's reach on the folded pane, in its scene units. */
const RADII = { point: 0.02, line: 0.02 };
const POINT_RULE = { snap: 'point', edges: true, free: false } as const;
const FREE_RULE = { snap: 'free', edges: false, free: false } as const;

type Calls = FoldEngineCalls & FoldEngineCompoundCalls;

async function engine(): Promise<{ calls: Calls; version: number }> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return { calls: { ...createFoldEngineCalls(fold), ...createFoldEngineCompoundCalls(fold) }, version: wasm.fold_engine_version() };
}

/** The one sequence a fixture holds, read as the app opens a project. */
function opened(name: string): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(resolve(FIXTURES, name), 'utf8'));
  const sequences = readFoldSequences(project.workspace.foldSequences);
  expect(sequences, name).toHaveLength(1);
  const [held] = sequences;
  if (!held) throw new Error(`${name}: no sequence`);
  expect(held.readOnlyRaw, name).toBeNull();
  return held.document;
}

function steps(document: FoldSequenceDocument): FoldStep[] {
  return document.steps.map((node) => {
    if (isLockedStep(node)) throw new Error(`${document.title}: ${node.id} is locked`);
    return node;
  });
}

/** A fixture replayed through the app's replayer: every step's state, and its parent's. */
async function replayed(name: string) {
  const document = opened(name);
  const { calls, version } = await engine();
  const port = createFoldEnginePort(
    {
      generation: () => 0,
      sheet: async (paper) => calls.sheet(paper),
      step: async (state, op, choices) => calls.step(state, op, choices),
      returnTo: async (current, target, history) => calls.returnTo(current, target, history),
      release: async (states) => calls.release(states),
    },
    version
  );
  const done = await createFoldReplayer(port).run({ loadId: 1, sequence: document });
  if (!done) throw new Error(`${name}: the replay was superseded`);
  const all = steps(document);
  const stateOf = (step: FoldStep | undefined): number => {
    const node = step ? done.steps.get(step.id) : null;
    const state = step ? node?.state : done.sheet.state;
    if (!state) throw new Error(`${name}: ${step?.id ?? 'the sheet'} did not land`);
    return state.id;
  };
  const parentOf = (step: FoldStep) => stateOf(all.find((each) => each.id === step.parent));
  return { document, calls, done, steps: all, stateOf, parentOf };
}

/** The folded pane's pick index on a state, as the canvas builds it. */
function pickIndex(calls: Calls, state: number): FoldPickIndex {
  return foldPickIndex(calls.scene(state), calls.landmarks(state, []), []);
}

/** Where a sheet point lies in a state's model frame. */
function imageOf(calls: Calls, state: number, sheet: SheetPoint): [number, number] {
  const index = pickIndex(calls, state);
  const at = sheetToScene(index.scene, sheet);
  if (!at) throw new Error(`${sheet.join(', ')} is not on the paper`);
  const model = index.toModel(at);
  return [model.x, model.y];
}

const minus = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];

function expectNear(actual: readonly number[], expected: readonly number[], what: string) {
  expect(actual.length, what).toBe(expected.length);
  actual.forEach((value, k) => expect(value, what).toBeCloseTo(expected[k]!, 9));
}

function stepOk(done: FoldReplayProgress<unknown>, step: FoldStep, name: string) {
  const node = done.steps.get(step.id);
  expect(node?.status, `${name} ${step.id} ${JSON.stringify(node?.refusal)}`).toBe('ok');
  expect(node?.fingerprint, `${name} ${step.id}`).toBe(step.expect);
}

describe.skipIf(!available)('the fold-regression fixtures', () => {
  it('holds one fixture per bug the README names', () => {
    const files = readdirSync(FIXTURES).filter((name) => name.endsWith('.osf')).sort();
    expect(files).toEqual(readmeNames());
    for (const name of NAMES) expect(files).toContain(name);
  });

  it.each(NAMES)('opens %s and replays every step to its stored fingerprint', async (name) => {
    const { done, steps: all } = await replayed(name);
    expect(done.done).toBe(true);
    for (const step of all) {
      stepOk(done, step, name);
      expect(step.note?.trim().length ?? 0, `${name} ${step.id} has no note`).toBeGreaterThan(0);
    }
  });

  it('ghost-precrease: a folded-pane click on the flap’s corner takes the flap’s point, not the layer’s under it', async () => {
    const { calls, steps: all, parentOf } = await replayed('ghost-precrease.osf');
    const precrease = all.at(-1)!;
    const op = precrease.op;
    if (op.kind !== 'precrease' || op.line.via !== 'axiom') throw new Error('the last step is the precrease by Axiom 2');
    const parent = parentOf(precrease);
    const index = pickIndex(calls, parent);
    // P, the flap's corner, and Q, the middle of its folded edge: clicked
    // where the folded pane draws them, each takes the sheet point the step
    // stores, which a click on the crease pattern takes.
    const stored = op.line.inputs.map((ref) => (ref.kind === 'edge' ? null : ref.at));
    expect(stored).toEqual([
      [1, 0.5],
      [0.5, 0.25],
    ]);
    for (const sheet of stored as SheetPoint[]) {
      const at = sheetToScene(index.scene, sheet);
      if (!at) throw new Error('not on the paper');
      expect(resolveFoldPick(index, 'folded', at, RADII, POINT_RULE)).toMatchObject({ kind: 'point', pane: 'folded', sheet });
    }
    // At P the strip's corner lies too, on the layer under the flap, and it
    // shows past the flap: the point the folded pane used to take there.
    const under: SheetPoint = [0, 1];
    expect(sheetPointsTogether(index, [1, 0.5])).toContainEqual(under);
    const landmark = calls
      .landmarks(parent, [])
      .points.find((point) => point.sources.some((source) => source.sheet[0] === 0 && source.sheet[1] === 1 && source.visible));
    expect(landmark?.sources.find((source) => source.visible)?.sheet).toEqual(under);
    // Stored with it, the precrease is refused, the point staying put: the
    // top flap folds, the strip does not.
    const staying = withMoverSwapped(op, [1, 0.5], under);
    if (!staying) throw new Error('no point swapped');
    const refused = calls.step(parent, staying, precrease.choices);
    expect(refused).toMatchObject({ status: 'refused', refusal: { code: 'mover_stays', point: under } });
    if (refused.status !== 'refused') return;
    // The refusal's fix: the point at the same spot on the flap, the paper
    // on top first, offered because it lands, and the step it makes is the
    // fixture's.
    const lands = async (asked: FoldOp) => calls.step(parent, asked, precrease.choices).status === 'ok';
    const fix = await findMoverFix(staying, refused, (point) => sheetPointsTogether(index, point), lands);
    expect(fix).toMatchObject({ from: under, to: [1, 0.5] });
    expect(fix?.op).toEqual(op);
    const fixed = calls.step(parent, fix!.op, precrease.choices);
    expect(fixed).toMatchObject({ status: 'ok', fingerprint: precrease.expect });
    // Only the flap is creased: the strip under it stays one face there.
    const before = calls.summary(parent).faces;
    if (fixed.status === 'ok') expect(calls.summary(fixed.state).faces - before).toBe(2);
  });

  it('tuck-target-layer: the corner tucks against its whole layer, a precrease splitting it on the fold line', async () => {
    const { calls, steps: all, parentOf, stateOf } = await replayed('tuck-target-layer.osf');
    const tuck = all.at(-1)!;
    const op = tuck.op;
    if (op.kind !== 'mountain' || op.landing?.kind !== 'against') throw new Error('the last step is a mountain tucked against a layer');
    const parent = parentOf(tuck);
    // The flap alone moves: the corner of the top layer, one face.
    const analysed = calls.analyse(parent, op, tuck.choices);
    expect(analysed.status).toBe('ok');
    if (analysed.status === 'ok') expect(analysed.analysis.moving).toHaveLength(1);
    // Folded by the tool, the chooser offers that landing alone, whatever form it stores it in; it used to drop it.
    const { landing: _landing, ...asked } = op;
    const search = calls.orderSelection(parent, asked as FoldOp, tuck.choices, { index: 0, searchMs: 2_000 });
    expect(search).toMatchObject({ status: 'ok', count: { orders: 1 } });
    const offered = search.status === 'ok' ? orderResolvedStep(asked as FoldOp, tuck.choices, search) : null;
    expect(offered).not.toBeNull();
    const landed = calls.step(parent, offered!.op, offered!.choices);
    expect(landed).toMatchObject({ status: 'ok', fingerprint: tuck.expect });
    // The corner lies tucked: its tip at the precrease's mirror, the back layer's corner piece where it was.
    expectNear(imageOf(calls, stateOf(tuck), [0.95, 0.05]), [0.25, 0.25], 'the tucked tip');
    expectNear(imageOf(calls, stateOf(tuck), [0.05, 0.05]), [0.05, 0.05], 'the back layer’s corner');
  });

  it('squash-covered: the corner folded over the hinge rides with the squashed layer', async () => {
    const { calls, steps: all, parentOf, stateOf } = await replayed('squash-covered.osf');
    const squash = all.at(-1)!;
    expect(squash.op.kind).toBe('squash');
    const [parent, landed] = [parentOf(squash), stateOf(squash)];
    // The corner lay folded over the hinge; both its layers turn back with
    // the squashed layer, to where the diagonal fold left them.
    const diagonal = stateOf(all[0]);
    for (const sheet of [
      [0.95, 0.3],
      [0.3, 0.95],
    ] as SheetPoint[]) {
      expect(Math.hypot(...minus(imageOf(calls, parent, sheet), [0.95, 0.3])), 'folded over').toBeGreaterThan(0.1);
      expectNear(imageOf(calls, landed, sheet), imageOf(calls, diagonal, sheet), `${sheet.join(', ')} back`);
      expectNear(imageOf(calls, landed, sheet), [0.95, 0.3], `${sheet.join(', ')} at the corner`);
    }
  });

  it('squash-drawn-hinge: only the end beyond the precrease squashes', async () => {
    const { calls, steps: all, parentOf, stateOf } = await replayed('squash-drawn-hinge.osf');
    const squash = all.at(-1)!;
    expect(squash.op).toMatchObject({ kind: 'squash', hinge: { line: { via: 'crease' } } });
    const [parent, landed] = [parentOf(squash), stateOf(squash)];
    // O is (0.3, 0.3): the tip's lower layer turns over x = 0.3, its upper one across the hinge.
    for (const [sheet, expected] of [
      [
        [0.1, 0.05],
        [0.5, 0.05],
      ],
      [
        [0.1, 0.4],
        [0.5, 0.2],
      ],
      [
        [0.05, 0.1],
        [0.55, 0.1],
      ],
    ] as [SheetPoint, [number, number]][]) {
      expectNear(imageOf(calls, landed, sheet), expected, `the tip's ${sheet.join(', ')}`);
    }
    // The rest of the flap, both layers, and the corner stay.
    for (const sheet of [
      [0.6, 0.4],
      [0.4, 0.6],
      [0.95, 0.3],
    ] as SheetPoint[]) {
      expectNear(imageOf(calls, landed, sheet), imageOf(calls, parent, sheet), `${sheet.join(', ')} stays`);
    }
  });

  it('reverse-seed-segment: a line drawn across one arm reverses that arm, where every layer on the line was refused', async () => {
    const { calls, steps: all, parentOf, stateOf } = await replayed('reverse-seed-segment.osf');
    const reverse = all.at(-1)!;
    expect(reverse.op.kind).toBe('inside-reverse');
    const [parent, landed] = [parentOf(reverse), stateOf(reverse)];
    const index = pickIndex(calls, parent);
    // A free line drawn across the left arm only, along the line the step folds.
    const picks = [
      { x: 0.12, y: 0.018 },
      { x: 0.22, y: 0.108 },
    ].map((at) => {
      const pick = resolveFoldPick(index, 'folded', at, RADII, FREE_RULE);
      if (!pick) throw new Error('no pick');
      return pick;
    });
    const tools = { tool: 'inside-reverse' as const, lineMode: 'free' as const, picks, swapped: false, override: null };
    const probe = lineSectionProbe(tools, index, null);
    if (!probe) throw new Error('no section asked');
    const sectioned = calls.crossSection(parent, probe.line, probe.side);
    if (sectioned.status !== 'ok') throw new Error('no section');
    const { section } = sectioned;
    const drawn = reverseDrawnSegment(tools);
    if (!drawn) throw new Error('no segment');
    // Extended, the line crosses both arms' ends: two flaps on the tip side, the stretch drawn crossing one.
    expect(section.flaps).toHaveLength(2);
    const seed = reverseSegmentSeed(section, drawn);
    expect(seed).toMatchObject({ scope: 'flaps', flaps: [{ faces: expect.any(Array) }] });
    const build = (asked: FoldResolvedSeed) =>
      buildReverseStep({ lineMode: 'free', picks, candidate: null, swapped: false, seed: asked, kind: 'inside', openings: [], completion: null }, index);
    const drawnStep = build(seed);
    if (drawnStep.status !== 'built') throw new Error('not built');
    expect(drawnStep.op).toEqual(reverse.op);
    // The old default, every layer on the line: neither kind lands, and the engine offers no fix.
    const everyLayer = build(FOLD_EVERY_LAYER);
    if (everyLayer.status !== 'built') throw new Error('not built');
    for (const kind of ['inside-reverse', 'outside-reverse'] as const) {
      expect(calls.step(parent, { ...everyLayer.op, kind } as FoldOp, everyLayer.choices)).toMatchObject({
        status: 'refused',
        refusal: { code: 'reverse_kind_infeasible' },
        fixes: [],
      });
    }
    // The tools' fix for that refusal: the flap the drawn stretch crosses, which lands.
    const refused = calls.step(parent, everyLayer.op, everyLayer.choices);
    const narrower = refused.status === 'refused' ? narrowerReverseFlaps(refused, FOLD_EVERY_LAYER, section, drawn) : null;
    expect(narrower).toEqual(seed.scope === 'flaps' ? seed.flaps : null);
    const ask = async (op: FoldOp, choices: FoldChoices | undefined) => {
      if (op.kind !== 'inside-reverse' && op.kind !== 'outside-reverse') return null;
      const asked = calls.compoundAnalysis(parent, op, choices);
      return asked.status === 'ok' && asked.family === 'reverse' ? asked : null;
    };
    const fix = narrower ? await findReverseSeedFix(narrower, drawnStep, ask, null) : null;
    expect(fix).toEqual({ flaps: narrower, opening: 0, ways: 0 });
    // The drawn arm's flap alone lands, as the fixture stores it: the left arm's end turns, the up arm stays.
    expect(calls.step(parent, drawnStep.op, drawnStep.choices)).toMatchObject({ status: 'ok', fingerprint: reverse.expect });
    for (const sheet of [
      [0.02, 0.06],
      [0.02, 0.19],
    ] as SheetPoint[]) {
      expect(Math.hypot(...minus(imageOf(calls, landed, sheet), imageOf(calls, parent, sheet))), `${sheet.join(', ')} turns`).toBeGreaterThan(0.05);
    }
    for (const sheet of [
      [0.98, 0.06],
      [0.98, 0.19],
      [0.6, 0.06],
    ] as SheetPoint[]) {
      expectNear(imageOf(calls, landed, sheet), imageOf(calls, parent, sheet), `${sheet.join(', ')} stays`);
    }
  });

  it('edge-crossing: where the flap’s edge crosses the edges below it at a slant, a point the folded pane snaps to', async () => {
    const { calls, steps: all, stateOf } = await replayed('edge-crossing.osf');
    const state = stateOf(all.at(-1));
    const landmarks = calls.landmarks(state, []);
    const index = pickIndex(calls, state);
    // The flap's edge, the image of x = 1, crosses the bottom edge at about
    // (0.497, 0) and the folded edge y = x at about (0.435, 0.435).
    for (const at of [
      [0.4974, 0],
      [0.435, 0.435],
    ]) {
      const crossing = landmarks.points.find(
        (point) => Math.hypot(point.at[0] - at[0]!, point.at[1] - at[1]!) < 2e-3 && point.sources.some((source) => source.kind === 'crossing')
      );
      expect(crossing?.visible, `${at.join(', ')}`).toBe(true);
      const shown = index.toScene(toPoint(crossing!.at));
      expect(resolveFoldPick(index, 'folded', shown, RADII, POINT_RULE)).toMatchObject({ kind: 'point', provenance: 'crossing' });
    }
  });

  it('unfold-to-after-import: unfolding to an Import CP brings back no crease from before it, and opens only the fold made since', async () => {
    const { calls, steps: all, stateOf } = await replayed('unfold-to-after-import.osf');
    const [, , imported, after, unfold] = all;
    if (imported?.op.kind !== 'cp-jump' || unfold?.op.kind !== 'unfold-to' || unfold.op.target !== imported.id || !after) {
      throw new Error('step 3 is the import and step 5 unfolds to it');
    }
    const creases = (state: number) => calls.scene(state).creases.filter((crease) => crease.kind !== 'border');
    const onX = (x: number) => (crease: FoldSceneCrease) => Math.abs(crease.from.x - x) < 1e-9 && Math.abs(crease.to.x - x) < 1e-9;
    const onDiagonal = (crease: FoldSceneCrease) => Math.abs(crease.from.x - crease.from.y) < 1e-9 && Math.abs(crease.to.x - crease.to.y) < 1e-9;
    expect(creases(stateOf(all[0])).some(onDiagonal), 'step 1 precreased the diagonal').toBe(true);
    expect(creases(stateOf(imported)).some(onDiagonal), 'the import dropped it').toBe(false);
    const returned = stateOf(unfold);
    const summary = calls.stepSummary(returned);
    if (summary.status !== 'ok' || !summary.summary) throw new Error('the unfold has a summary');
    // Nothing added: the creases come from the import on, never from the steps it replaced.
    expect(summary.summary.diff.added).toEqual([]);
    expect(creases(returned).filter(onDiagonal)).toEqual([]);
    expect(calls.scene(returned).faces).toHaveLength(calls.scene(stateOf(after)).faces.length);
    // Opened: step 4's fold along x = 1/2, every piece of it, and nothing else.
    const opened = creases(returned).filter((crease) => summary.summary!.diff.unfolded.includes(crease.id));
    expect(opened.length).toBe(creases(stateOf(after)).filter(onX(0.5)).length);
    expect(opened.every(onX(0.5))).toBe(true);
  });
});
