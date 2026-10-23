import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FoldChoices, FoldCrimpOp, FoldPaper, FoldReverseOp, FoldStep } from '../document/foldSequenceDocument';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import { createFoldReplayer } from '../document/foldReplay';
import { createFoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineCompoundCalls } from './foldEngineCompoundCalls';
import { createFoldEnginePort } from './foldEnginePort';
import type { FoldEngineOutcome } from './foldEngineWire';

const wasmPath = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');

async function engine() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(wasmPath) });
  const fold = new wasm.FoldEngine();
  return { calls: createFoldEngineCalls(fold), question: createFoldEngineCompoundCalls(fold), version: wasm.fold_engine_version() };
}

function landed<T>(result: FoldEngineOutcome<T>): T {
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  return result;
}

describe.skipIf(!existsSync(wasmPath))('nested reverse and boundary crimp saved through Fold', () => {
  for (const name of ['reverse-nested-dove', 'crimp-boundary-squirrel']) {
    it(`${name}: tool analysis offers inside, saved choices and every state replay`, async () => {
      const fixture = JSON.parse(readFileSync(resolve(process.cwd(), `../../tests/fixtures/fold-examples/${name}.json`), 'utf8')) as {
        paper: FoldPaper; steps: FoldStep[]; op: FoldReverseOp | FoldCrimpOp; choices: FoldChoices;
      };
      const current = await engine();
      expect(current.version).toBeGreaterThanOrEqual(2);
      let state = landed(current.calls.sheet(fixture.paper)).state;
      const nodes: FoldStep[] = fixture.steps.map(node => {
        const result = landed(current.calls.step(state, node.op, node.choices));
        state = result.state;
        return { ...node, expect: result.fingerprint };
      });
      const analysis = landed(current.question.compoundAnalysis(state, fixture.op, fixture.choices));
      if (analysis.family !== 'reverse' && analysis.family !== 'crimp') throw new Error('wrong tool family');
      expect(analysis.kinds).toContain('inside');
      const result = landed(current.calls.step(state, fixture.op, fixture.choices));
      nodes.push(step('fstep-direct-operation', nodes.at(-1)!.id, fixture.op, { choices: fixture.choices, expect: result.fingerprint }));
      const saved = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence({ document: sequenceOf(nodes, fixture.paper), readOnlyRaw: null }))))!;
      const fresh = await engine();
      const port = createFoldEnginePort({
        generation: () => 0,
        sheet: async paper => fresh.calls.sheet(paper),
        step: async (parent, op, choices) => fresh.calls.step(parent, op, choices),
        release: async states => fresh.calls.release(states),
      }, fresh.version);
      const replay = await createFoldReplayer(port).run({ loadId: 1, sequence: saved.document });
      expect(replay?.steps.size).toBe(nodes.length);
      for (const node of nodes) {
        expect(replay?.steps.get(node.id)?.status).toBe('ok');
        expect(replay?.steps.get(node.id)?.fingerprint).toBe(node.expect);
      }
    });
  }
});
