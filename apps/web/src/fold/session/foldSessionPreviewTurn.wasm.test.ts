import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { foldPickIndex, type FoldPick } from '../canvas/foldPicking';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { isLockedStep, type FoldOp, type FoldSequenceDocument } from '../document/foldSequenceDocument';
import { readFoldSequences } from '../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import { orderResolvedStep } from '../engine/foldEnginePreview';
import type { FoldScene } from '../engine/foldEngineWire';
import { axiomLineOfPicks } from '../tools/foldStepBuilder';
import { lineSectionProbe } from '../tools/topFlapSeed';
import { createFoldSession, type FoldSession, type FoldStateCall } from './foldSession';
import { inProcessFoldRuntime, memoryFoldDocument, settle, type MemoryFoldDocument } from './foldSession.fixtures';
import { selectFoldCursorNode } from './foldSessionState';
import { FOLD_SCENE_QUERY, FOLD_STEP_SUMMARY_QUERY, foldCrossSectionQuery } from './foldStateQueries';

/**
 * A tool's preview in as few round trips as its questions allow, over the
 * real bridge on the crane (`tests/fixtures/fold-design-completion`): the
 * step landed with what the panes show of it in one turn; the step a fold's
 * orders resolve landed in the orders' own turn and taken by the preview
 * that asks for it next; an axiom's roots brought with the layers at the
 * root taken, under the very line the tool asks them at. Each answer is the
 * one the engine gives when asked alone — the same scene, summary, section
 * and fingerprint — and the calls each saves are counted.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CRANE = resolve(ROOT, '../../tests/fixtures/fold-design-completion/crane.osf');
const available = existsSync(WASM) && existsSync(CRANE);

/** Calls made of the engine, by name. */
const asked = new Map<string, number>();
const count = (name: string) => asked.get(name) ?? 0;

async function bridge() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  return inProcessFoldRuntime(() => {
    const engine = new wasm.FoldEngine();
    const calls = { ...createFoldEngineCalls(engine), ...createFoldEngineCompoundCalls(engine) } as FoldEngineCalls;
    // Every call counted as it is made.
    return new Proxy(calls, {
      get(target, name, receiver) {
        const value = Reflect.get(target, name, receiver) as unknown;
        if (typeof name !== 'string' || typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          asked.set(name, count(name) + 1);
          return (value as (...given: unknown[]) => unknown)(...args);
        };
      },
    });
  }, wasm.fold_engine_version());
}

function crane(): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(CRANE, 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  if (!held) throw new Error('no sequence');
  return held.document;
}

function stepOp(document: FoldSequenceDocument, id: string): FoldOp {
  const node = document.steps.find((step) => step.id === id);
  if (!node || isLockedStep(node) || !node.op) throw new Error(`no step ${id}`);
  return node.op;
}

const point = (x: number, y: number): FoldPick => ({ kind: 'point', provenance: 'vertex', sheet: [x, y], mark: null, scene: { x, y } });

describe.skipIf(!available)('a preview in one turn, over the bridge', () => {
  let session: FoldSession;
  let source: MemoryFoldDocument;
  let runtime: Awaited<ReturnType<typeof bridge>>;
  let document: FoldSequenceDocument;

  const here = () => {
    const state = selectFoldCursorNode(session.store.getState()).state;
    if (!state) throw new Error('no state on screen');
    return state;
  };
  /** Ask the engine alone, as a surface did one call at a time. */
  const alone = async <T>(call: FoldStateCall<T>, state = here()) => {
    const answer = await session.withState(state, call);
    if (answer.status !== 'answered') throw new Error(answer.reason);
    return answer.value;
  };

  beforeEach(async () => {
    asked.clear();
    runtime = await bridge();
    document = crane();
    // On the crane's step 23: turned over, so its scene is the model seen through a reflection.
    source = memoryFoldDocument({ held: { document, readOnlyRaw: null }, reader: withFoldCursor(initialFoldReaderState(document.id), document, 'fstep-crane-23') });
    session = createFoldSession({ document: source, runtime });
    session.retain();
    for (let round = 0; round < 20 && selectFoldCursorNode(session.store.getState()).status !== 'ok'; round += 1) await settle();
    expect(selectFoldCursorNode(session.store.getState()).status).toBe('ok');
    asked.clear();
  });

  afterEach(() => session.dispose());

  it('lands a step with its scene and summary in hand, and commits it asking nothing, at the fingerprint the file’s step has', async () => {
    const op = stepOp(document, 'fstep-crane-24');
    const preview = await session.preview(op);
    if (preview.status !== 'landed') throw new Error(preview.status);
    expect(count('apply')).toBe(1);
    expect(count('scene')).toBe(1);
    expect(count('stepSummary')).toBe(1);
    // In hand, and what the engine says when asked alone.
    const scene = session.peek(preview.state, FOLD_SCENE_QUERY);
    const summary = session.peek(preview.state, FOLD_STEP_SUMMARY_QUERY);
    expect(scene?.value).toEqual(await alone((engine, at) => engine.scene(at), preview.state));
    const summarised = await alone((engine, at) => engine.stepSummary(at), preview.state);
    if (summarised.status !== 'ok') throw new Error('no summary');
    expect(summary?.value).toEqual({ summary: summarised.summary });

    await settle();
    const fingerprints = count('fingerprint');
    expect(fingerprints).toBe(1);
    const committed = await session.commitStep(op);
    if (committed.status !== 'committed') throw new Error(committed.status);
    expect(count('fingerprint')).toBe(fingerprints);
    expect(count('apply')).toBe(1);
    // The same state the file's own step lands.
    expect(committed.fingerprint).toBe(session.store.getState().nodes.get('fstep-crane-24')?.fingerprint);
  });

  it('lands the step a fold’s orders resolve in their turn, which the preview then takes without asking', async () => {
    const base = stepOp(document, 'fstep-crane-24');
    const query = { index: 0, batch: 0, perComponent: 1000, maxNodes: 200_000 };
    const reply = await session.resolveOrders(base, {}, query);
    if (reply.status !== 'answered' || reply.value.status !== 'ok') throw new Error('no orders');
    const step = orderResolvedStep(base, undefined, reply.value);
    if (!step) throw new Error('no step');
    expect(count('orderSelection')).toBe(1);
    expect(count('apply')).toBe(1);
    expect(count('analyse')).toBe(1);
    expect(count('action')).toBe(1);

    const preview = await session.preview(step.op, step.choices);
    if (preview.status !== 'landed') throw new Error(preview.status);
    const analysis = await session.analyse(step.op, step.choices);
    expect(analysis.status).toBe('analysed');
    // Nothing asked again: the orders' turn answered all of it.
    expect(count('apply')).toBe(1);
    expect(count('analyse')).toBe(1);
    // The state a fold of that step on its own lands.
    const folded = await alone((engine, at) => engine.step(at, step.op, step.choices));
    if (folded.status !== 'ok') throw new Error('refused');
    await settle();
    const committed = await session.commitStep(step.op, step.choices);
    if (committed.status !== 'committed') throw new Error(committed.status);
    expect(committed.fingerprint).toBe(folded.fingerprint);
  });

  it('lets the step the orders folded go when the tool lets go before previewing it', async () => {
    const base = stepOp(document, 'fstep-crane-24');
    const live = await alone((engine) => engine.live());
    await session.resolveOrders(base, {}, { index: 0, batch: 0 });
    expect(await alone((engine) => engine.live())).toBe(live + 1);
    session.cancel();
    await settle();
    expect(await alone((engine) => engine.live())).toBe(live);
  });

  it('brings the layers at the root a fold takes with the roots, under the line the tool asks them at', async () => {
    const state = here();
    const scene = (await session.query(state, FOLD_SCENE_QUERY)) as { status: 'answered'; value: FoldScene };
    const landmarks = await session.withState(state, (engine, at) => engine.landmarks(at, []));
    if (landmarks.status !== 'answered') throw new Error('no landmarks');
    const index = foldPickIndex(scene.value, landmarks.value, []);
    // Point onto point: one corner of the sheet onto the opposite one.
    const picks = [point(0, 0), point(1, 1)];
    const line = axiomLineOfPicks('axiom-2', picks);
    if (!line) throw new Error('no axiom line');
    asked.clear();
    for (const swapped of [false, true]) {
      const roots = await session.axiomRoots(line, { viewTransform: scene.value.view_transform, root: 0, swapped });
      if (roots.status !== 'answered' || roots.value.status !== 'ok') throw new Error('no roots');
      const candidate = roots.value.candidates[0] ?? null;
      const probe = lineSectionProbe({ tool: 'valley', lineMode: 'axiom-2', picks, swapped, override: null }, index, candidate);
      if (!probe) throw new Error('no probe');
      const held = session.peek(state, foldCrossSectionQuery(probe.line, probe.side));
      expect(held).not.toBeNull();
      expect(held?.value).toEqual(await alone((engine, at) => engine.crossSection(at, probe.line, probe.side)));
    }
    // One section with each ask of the roots, and the two asked alone above.
    expect(count('crossSection')).toBe(4);
  });
});
