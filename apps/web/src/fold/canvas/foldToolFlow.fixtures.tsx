/**
 * What the Fold tools' flow tests drive the canvas's tool pipeline with: the
 * real bridge in-process, the canvas's tool hooks mounted as `FoldCanvas`
 * mounts them (`useFoldToolPreview`, `useFoldCanvasVerbs`), the example
 * projects in `tests/fixtures/fold-examples`, and the clicks and commits a
 * folder makes — each click through the canvas's own hit test and pick.
 *
 * Shared by the swivel's flow test and the examples' flows: one harness, so
 * a change to how the canvas mounts its tools reaches both.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, useEffect, useMemo } from 'react';
import { expect } from 'vitest';
import { useStore } from 'zustand';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { isLockedStep, type FoldOp, type FoldSequenceDocument, type FoldStep } from '../document/foldSequenceDocument';
import { readFoldSequences } from '../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCrimpTuckCalls } from '../engine/foldEngineCrimpTuckCalls';
import { createFoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import { createFoldEngineVertexCalls } from '../engine/foldEngineSquashCalls';
import type { FoldSession } from '../session/foldSession';
import { inProcessFoldRuntime, settle } from '../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../session/foldSessionState';
import type { FoldSessionSurface } from '../session/useFoldSession';
import type { FoldTools } from '../tools/foldToolState';
import { swivelReach, type FoldSwivelReachAsk } from '../tools/vertex/swivelReach';
import { foldPickIndex, type FoldHit, type FoldPaneId, type FoldPickIndex } from './foldPicking';
import { useFoldCanvasVerbs, type FoldCanvasVerbs } from './useFoldCanvasVerbs';
import type { FoldStateView } from './useFoldStateView';
import { useFoldToolPreview, type FoldToolPreview } from './useFoldToolPreview';

const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const EXAMPLES = resolve(ROOT, '../../tests/fixtures/fold-examples');

/** The bridge is built and the examples are there: a fresh worktree before `build:wasm` has no bridge. */
export const FOLD_FLOW_AVAILABLE = existsSync(WASM) && existsSync(EXAMPLES);

/** A click's reach on the folded pane, in its scene units: about a dozen pixels at the zoom the README's clicks were made at. */
export const FOLD_FLOW_RADII = { point: 0.02, line: 0.02 };

/** An example project's one sequence, read as the app opens a project. */
export function openedExample(name: string): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(resolve(EXAMPLES, name), 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  if (!held) throw new Error(`${name}: no sequence`);
  return held.document;
}

/** A document's `n`th step (0 for its first), which this build reads. */
export function exampleStep(document: FoldSequenceDocument, n: number): FoldStep {
  const node = document.steps[n];
  if (!node || isLockedStep(node)) throw new Error(`step ${n + 1} is missing or locked`);
  return node;
}

/**
 * The worker's calls over the real bridge, in-process: the engine's, the
 * compound and vertex folds', and the swivel's reach composed over the
 * compound question as `foldSequenceWorker` composes it.
 */
export async function foldFlowBridge() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const calls = (): FoldEngineCalls => {
    const engine = new wasm.FoldEngine();
    const compound = createFoldEngineCompoundCalls(engine);
    return {
      ...createFoldEngineCalls(engine),
      ...compound,
      ...createFoldEngineCrimpTuckCalls(engine),
      ...createFoldEngineVertexCalls(engine),
      swivelReach: (state: number, ask: FoldSwivelReachAsk) => swivelReach((op) => compound.compoundAnalysis(state, op), ask),
    } as FoldEngineCalls;
  };
  return inProcessFoldRuntime(calls, wasm.fold_engine_version());
}

/** What `useFoldSession` hands the canvas, for this session. */
function useSurface(session: FoldSession): FoldSessionSurface {
  const cursor = useStore(session.store, selectFoldCursorNode);
  const cursorId = useStore(session.store, (snapshot) => snapshot.cursor);
  const readOnly = useStore(session.store, (snapshot) => snapshot.readOnly);
  const pending = useStore(session.store, (snapshot) => snapshot.pending);
  const analysis = useStore(session.store, (snapshot) => snapshot.analysis);
  const error = useStore(session.store, (snapshot) => snapshot.error);
  return useMemo(
    () => ({
      cursor,
      cursorId,
      readOnly,
      pending,
      analysis,
      error,
      analyse: session.analyse,
      preview: session.preview,
      resolveOrders: session.resolveOrders,
      axiomRoots: session.axiomRoots,
      commitStep: session.commitStep,
      cancel: session.cancel,
      cancelSearch: session.cancelSearch,
      withState: session.withState,
      withNode: session.withNode,
      withCursor: session.withCursor,
      query: session.query,
      peek: session.peek,
      retry: session.retry,
    }),
    [session, cursor, cursorId, readOnly, pending, analysis, error]
  );
}

/** What the canvas shows of the tools, handed out after each render. */
export interface FoldFlowSeen {
  preview: FoldToolPreview;
  verbs: FoldCanvasVerbs;
}

export type FoldFlowSeenRef = { current: FoldFlowSeen | null };

/** The Fold canvas's tool pipeline, as `FoldCanvas` mounts it, with what it shows handed out. */
export function FoldFlowCanvas({
  session,
  tools,
  view,
  seenRef,
}: {
  session: FoldSession;
  tools: FoldTools;
  view: FoldStateView;
  seenRef: FoldFlowSeenRef;
}) {
  const surface = useSurface(session);
  const state = useStore(tools.store);
  const preview = useFoldToolPreview(surface, view, state);
  const { verbs } = useFoldCanvasVerbs(surface, tools, view, preview);
  useEffect(() => {
    seenRef.current = { preview, verbs };
  });
  return null;
}

/** Let the session and the hooks answer until `ready` holds. */
export async function untilFlow<T>(ready: () => T | null | undefined | false, what: string): Promise<T> {
  for (let round = 0; round < 400; round += 1) {
    const value = ready();
    if (value) return value;
    await act(async () => {
      await settle(2);
    });
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** The step on screen as the canvas indexes it: its scene and its landmarks. */
export async function shownPickIndex(session: FoldSession): Promise<FoldPickIndex> {
  const scene = await session.withCursor((engine, at) => engine.scene(at));
  const landmarks = await session.withCursor((engine, at) => engine.landmarks(at, []));
  if (scene.status !== 'answered' || landmarks.status !== 'answered') throw new Error('no scene');
  return foldPickIndex(scene.value, landmarks.value, []);
}

/** A click on a pane where the canvas would take it: its hit test, then its pick. */
export async function clickPane(
  seen: FoldFlowSeenRef,
  at: { x: number; y: number },
  pane: FoldPaneId = 'folded'
): Promise<FoldHit | null> {
  const verbs = seen.current?.verbs;
  if (!verbs) throw new Error('no canvas');
  const hit = verbs.hitTest(pane, at, FOLD_FLOW_RADII);
  await act(async () => {
    verbs.pick(hit);
    await settle();
  });
  return hit;
}

/** Commit what the tool previews, as Enter does, and wait for the step to land on screen. */
export async function commitPreviewed(
  session: FoldSession,
  seen: FoldFlowSeenRef
): Promise<{ op: FoldOp; fingerprint: string }> {
  const snapshot = () => session.store.getState();
  const cursor = () => selectFoldCursorNode(snapshot());
  const before = snapshot().cursor;
  const verbs = seen.current?.verbs;
  if (!verbs) throw new Error('no canvas');
  let taken = false;
  await act(async () => {
    taken = seen.current?.preview.orderResolution?.required ? verbs.acceptOrder?.() ?? false : verbs.commit();
    await settle();
  });
  expect(taken).toBe(true);
  const fingerprint = await untilFlow(
    () => snapshot().cursor !== before && cursor().status === 'ok' && cursor().fingerprint,
    'the commit'
  );
  const held = useWorkspaceStore.getState().foldSequences[0]?.document;
  const step = held?.steps.find((each) => each.id === snapshot().cursor);
  if (!step || isLockedStep(step)) throw new Error('no step committed');
  return { op: step.op, fingerprint };
}
