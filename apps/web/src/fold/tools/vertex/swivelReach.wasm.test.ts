import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNativeProjectFile } from '../../../lib/nativeProjectFile';
import { foldPickIndex, sheetToScene, type FoldPick, type FoldPickIndex } from '../../canvas/foldPicking';
import {
  FOLD_SWIVEL_KINDS,
  isLockedStep,
  vertexDirectionOf,
  withSwivelKind,
  type FoldDirection,
  type FoldSequenceDocument,
  type FoldStep,
  type FoldVertexOp,
  type SheetPoint,
} from '../../document/foldSequenceDocument';
import { readFoldSequences } from '../../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../../engine/foldEngineCompoundCalls';
import { createFoldEngineVertexCalls, type FoldEngineVertexCalls } from '../../engine/foldEngineSquashCalls';
import type { FoldEngineOutcome } from '../../engine/foldEngineWire';
import { swivelReach, swivelReachAsk, swivelReachView, type FoldSwivelReach, type FoldSwivelReachAsk } from './swivelReach';

/**
 * A swivel's reach over the real bridge, in-process, on the example projects
 * (`tests/fixtures/fold-examples`): from where the creases meet, the edges
 * and lines it offers are exactly the pairs that fold — each pair offered
 * folds, every pair not offered is refused both ways, asked through the
 * family's own fold call rather than the question the reach asks — and the
 * swivel offered for the owner's clicks is the one a click previews and a
 * commit lands, to the fingerprint the example stores.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const EXAMPLES = resolve(ROOT, '../../tests/fixtures/fold-examples');
const available = existsSync(WASM) && existsSync(EXAMPLES);

interface Engine {
  calls: FoldEngineCalls;
  compound: FoldEngineCompoundCalls;
  vertex: FoldEngineVertexCalls;
}

async function engine(): Promise<Engine> {
  const wasm = await import('../../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return {
    calls: createFoldEngineCalls(fold),
    compound: createFoldEngineCompoundCalls(fold),
    vertex: createFoldEngineVertexCalls(fold),
  };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

function opened(name: string): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(resolve(EXAMPLES, name), 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  if (!held) throw new Error(`${name}: no sequence`);
  return held.document;
}

/** The state the `n`th step of the file (1 for its first) folds from, and the step. */
function parentOf({ calls }: Engine, document: FoldSequenceDocument, n: number): { state: number; step: FoldStep } {
  const steps = new Map(
    document.steps.map((node) => {
      if (isLockedStep(node)) throw new Error(`${node.id} is locked`);
      return [node.id, node] as const;
    })
  );
  const step = [...steps.values()][n - 1];
  if (!step) throw new Error(`no step ${n}`);
  const path: FoldStep[] = [];
  for (let at = step.parent ? steps.get(step.parent) : undefined; at; at = at.parent ? steps.get(at.parent) : undefined) {
    path.unshift(at);
  }
  let state = landed(calls.sheet(document.paper)).state;
  for (const each of path) state = landed(calls.step(state, each.op, each.choices)).state;
  return { state, step };
}

/** Whether `op` folds, by the family's own call: one order landed, or several to choose from. */
function folds({ calls, vertex }: Engine, state: number, op: FoldVertexOp): boolean {
  const tried = vertex.vertexFold(state, op);
  if (tried.status !== 'ok') return false;
  if (tried.result === 'landed') calls.release([tried.state]);
  else vertex.releaseVertexChoices([tried.pending]);
  return true;
}

/** The line a pane offers through a sheet point: by its id, the one whose sheet stretch holds it. */
function lineThrough(index: FoldPickIndex, at: SheetPoint): number {
  const segment = [...index.folded.segments, ...index.creasePattern.segments].find(({ sheet: [a, b] }) => {
    const cross = (b[0] - a[0]) * (at[1] - a[1]) - (b[1] - a[1]) * (at[0] - a[0]);
    const along = (at[0] - a[0]) * (b[0] - a[0]) + (at[1] - a[1]) * (b[1] - a[1]);
    const length = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    return Math.abs(cross) < 1e-9 && along > 0 && along < length;
  });
  if (!segment) throw new Error(`no line through ${at.join(', ')}`);
  return segment.edge;
}

/** The meeting point as the tool picks it: on a folded edge (`fold`), or a pivot. */
function meetingPick(index: FoldPickIndex, at: SheetPoint, onFold: boolean): FoldPick {
  const fold = onFold ? index.folded.segments.find((segment) => segment.edge === lineThrough(index, at)) : undefined;
  return {
    kind: 'point',
    provenance: onFold ? 'fold' : 'free',
    sheet: at,
    mark: null,
    scene: sheetToScene(index.scene, at),
    ...(fold ? { fold } : {}),
  };
}

/**
 * Every pair asked and not offered folds neither way — on a folded edge, of
 * neither kind; every pair offered folds the way it is kept.
 */
function expectExactlyWhatFolds(e: Engine, state: number, ask: FoldSwivelReachAsk, reach: FoldSwivelReach) {
  const offered = new Map(reach.landings.map((landing) => [`${landing.edge}:${landing.target}`, landing]));
  let refused = 0;
  for (const edge of ask.edges) {
    for (const target of ask.targets) {
      if (edge.id === target.id) continue;
      const landing = offered.get(`${edge.id}:${target.id}`);
      const base = { kind: 'swivel', via: 'edge', edge: edge.at, target: { via: 'crease', at: target.at } } as const;
      const ways = (['valley', 'mountain'] as FoldDirection[]).flatMap((direction): FoldVertexOp[] =>
        'fold' in ask.at
          ? FOLD_SWIVEL_KINDS.map((kind) => withSwivelKind({ ...base, fold: (ask.at as { fold: SheetPoint }).fold, direction }, kind))
          : [{ ...base, pivot: ask.at.pivot, seed: { scope: 'all' }, direction }]
      );
      if (landing) {
        // Offered: some way folds it, and it is kept as the folder asked it,
        // folding when that way does (and refused, with the other way, when not).
        expect(vertexDirectionOf(landing.op), `${edge.id} onto ${target.id}`).toBe(ask.direction);
        expect(landing.directions[ask.direction === 'valley' ? 0 : 1], `${edge.id} onto ${target.id}`).toBe(folds(e, state, landing.op));
        expect(ways.some((op) => folds(e, state, op)), `${edge.id} onto ${target.id}`).toBe(true);
        continue;
      }
      for (const op of ways) expect(folds(e, state, op), `${edge.id} onto ${target.id}`).toBe(false);
      refused += 1;
    }
  }
  return refused;
}

describe.skipIf(!available)('a swivel’s reach over the real bridge', () => {
  it('offers, from the owner’s point on the squashed kite’s folded edge, exactly the edges and lines that fold, his among them', async () => {
    const e = await engine();
    const document = opened('swivel-on-edge.osf');
    // Step 7, the swivel, folds from the squash.
    const { state, step } = parentOf(e, document, 7);
    const stored = step.op;
    if (stored.kind !== 'swivel' || !('fold' in stored) || !('edge' in stored)) throw new Error('step 7 is the swivel on a folded edge');
    const index = foldPickIndex(e.calls.scene(state), e.calls.landmarks(state, []), []);
    const ask = swivelReachAsk(index, {
      tool: 'swivel',
      swivelTarget: 'crease',
      picks: [meetingPick(index, stored.fold, true)],
      vertexDirection: 'valley',
    });
    if (!ask) throw new Error('no ask');
    expect(ask.at).toEqual({ fold: stored.fold });
    const reach = swivelReach((op) => e.compound.compoundAnalysis(state, op), ask);
    const view = swivelReachView(reach);
    // His edge swings, and onto his line.
    const edge = lineThrough(index, stored.edge);
    const target = stored.target.via === 'crease' ? lineThrough(index, stored.target.at) : -1;
    expect(view.edges.has(edge)).toBe(true);
    const his = view.targets.get(edge)?.get(target);
    expect(his).toBeDefined();
    // Not everything is offered: the reach is a choice, not every line.
    expect(view.edges.size).toBeLessThan(ask.edges.length);
    expect(expectExactlyWhatFolds(e, state, ask, reach)).toBeGreaterThan(0);
    // What the pointer previews over his line is what a click asks, and a commit lands his step.
    if (!his) return;
    expect(his.op).toMatchObject({ kind: 'swivel', via: 'edge', fold: stored.fold, direction: 'valley' });
    expect(his.directions).toEqual([true, false]);
    const asked = landed(e.compound.compoundAnalysis(state, his.op));
    expect(asked.family === 'vertex' && asked.analysis).toEqual(his.answer.analysis);
    expect(landed(e.calls.step(state, his.op)).fingerprint).toBe(step.expect);
    // Both kinds land his: open and inside.
    expect(his.kinds).toEqual([true, true]);
  });

  it('keeps, asked inside, the owner’s swivel inside: its letters as figure 2 draws them', async () => {
    const e = await engine();
    const document = opened('swivel-on-edge.osf');
    const { state, step } = parentOf(e, document, 7);
    const stored = step.op;
    if (stored.kind !== 'swivel' || !('fold' in stored) || !('edge' in stored)) throw new Error('step 7 is the swivel on a folded edge');
    const index = foldPickIndex(e.calls.scene(state), e.calls.landmarks(state, []), []);
    const asked = swivelReachAsk(index, {
      tool: 'swivel',
      swivelTarget: 'crease',
      picks: [meetingPick(index, stored.fold, true)],
      vertexDirection: 'valley',
    });
    if (!asked) throw new Error('no ask');
    const ask = { ...asked, kind: 'inside' as const };
    const reach = swivelReach((op) => e.compound.compoundAnalysis(state, op), ask);
    const view = swivelReachView(reach);
    const edge = lineThrough(index, stored.edge);
    const target = stored.target.via === 'crease' ? lineThrough(index, stored.target.at) : -1;
    const his = view.targets.get(edge)?.get(target);
    expect(his?.op).toEqual(withSwivelKind(stored, 'inside'));
    const analysis = his?.answer.analysis;
    if (analysis?.kind !== 'swivel-by-edge') throw new Error('not a swivel by its edge');
    expect(analysis.creases.map((crease) => crease.letter)).toEqual(['valley', 'valley', 'mountain']);
    // It lands, and not as the open one does.
    const inside = landed(e.calls.step(state, his?.op ?? stored));
    expect(inside.fingerprint).not.toBe(step.expect);
  });

  it('offers, from a free pivot, the pairs that fold either way, and folds the one picked the way it lands', async () => {
    const e = await engine();
    const document = opened('swivel-fold.osf');
    // Branch 1: the bottom edge onto the precreased diagonal, about the pivot clicked.
    const { state, step } = parentOf(e, document, 2);
    const stored = step.op;
    if (stored.kind !== 'swivel' || !('pivot' in stored)) throw new Error('step 2 is a swivel at a pivot');
    const index = foldPickIndex(e.calls.scene(state), e.calls.landmarks(state, []), []);
    for (const direction of ['valley', 'mountain'] as FoldDirection[]) {
      const ask = swivelReachAsk(index, {
        tool: 'swivel',
        swivelTarget: 'crease',
        picks: [meetingPick(index, stored.pivot, false)],
        vertexDirection: direction,
      });
      if (!ask) throw new Error('no ask');
      expect(ask.at).toEqual({ pivot: stored.pivot });
      const reach = swivelReach((op) => e.compound.compoundAnalysis(state, op), ask);
      expectExactlyWhatFolds(e, state, ask, reach);
      const view = swivelReachView(reach);
      const his = view.targets.get(lineThrough(index, stored.edge))?.get(
        stored.target.via === 'crease' ? lineThrough(index, stored.target.at) : -1
      );
      // A flat sheet folds the swivel either way; the folder's way is the one kept.
      expect(his?.directions).toEqual([true, true]);
      expect(his && vertexDirectionOf(his.op)).toBe(direction);
      if (direction === 'valley') expect(his && landed(e.calls.step(state, his.op)).fingerprint).toBe(step.expect);
    }
  });
});
