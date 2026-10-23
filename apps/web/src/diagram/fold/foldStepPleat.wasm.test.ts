import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFoldEngineCalls } from '../../fold/engine/foldEngineCalls';
import { createFoldSession, type FoldSession } from '../../fold/session/foldSession';
import { inProcessFoldRuntime, settle } from '../../fold/session/foldSession.fixtures';
import { readFoldSequences, writeFoldSequences } from '../../fold/document/foldSequenceFile';
import { isStep } from '../document/diagramDocument';
import { readDiagram, writeDiagram } from '../document/diagramFile';

const held = vi.hoisted(() => ({ session: null as FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', async (original) => ({
  ...(await original<typeof import('../../store/workspaceStore/foldSession')>()),
  foldSession: () => held.session!,
}));
const { useWorkspaceStore } = await import('../../store/workspaceStore/store');
const { foldSessionDocumentSource } = await import('../../store/workspaceStore/foldSession');
const { pullFromFold } = await import('./foldBrowserActions');
const { refreshDiagramFoldStep, spreadDiagramFoldStep } = await import('./foldStepActions');

async function start() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm')) });
  held.session = createFoldSession({
    document: foldSessionDocumentSource(useWorkspaceStore),
    runtime: inProcessFoldRuntime(() => createFoldEngineCalls(new wasm.FoldEngine()), wasm.fold_engine_version()),
  });
  held.session.retain();
  await settle();
}
const state = () => useWorkspaceStore.getState();
const imported = () => state().diagram!.steps.filter(isStep)[0]!;
const kinds = () => imported().annotations.map((mark) => mark.unknown ? 'unknown' : mark.kind);

describe('a saved Pleat imported into Diagram', () => {
  beforeEach(async () => {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    await start();
  });
  afterEach(() => { held.session?.dispose(); held.session = null; });

  it('imports editable M/V lines and a pleat arrow after fresh replay, refreshes, and survives diagram save/open', async () => {
    const committed = await held.session!.commitStep({
      kind: 'pleat',
      line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
      second: { via: 'free', through: [[0.7, 0], [0.8, 1]] },
      moving: [0.9, 0.5], seed: { scope: 'all' },
    });
    expect(committed.status).toBe('committed');
    await settle();
    const reader = state().foldReader;
    const saved = readFoldSequences(JSON.parse(JSON.stringify(writeFoldSequences(state().foldSequences))));
    held.session!.dispose();
    state().installFoldSequences(saved, reader);
    await start();
    const step = state().foldSequences[0]!.document.steps[0]!;
    expect(await pullFromFold([{ kind: 'step', step: step.id, moment: 'before' }], { kind: 'end' }, { via: 'fold' })).toBe(1);
    expect(kinds()).toEqual(['mountain-line', 'valley-line', 'pleat-arrow']);
    expect(imported().annotations.every((mark) => !mark.unknown && mark.imported === 'untouched')).toBe(true);
    const savedMarks = imported().annotations;
    await refreshDiagramFoldStep(imported().id);
    expect(kinds()).toEqual(['mountain-line', 'valley-line', 'pleat-arrow']);
    expect(imported().annotations.map(({ id: _id, ...mark }) => mark))
      .toEqual(savedMarks.map(({ id: _id, ...mark }) => mark));
    expect(await spreadDiagramFoldStep(imported().id, { verb: 'spread-kind', kind: 'depth' })).toBe(true);
    expect(kinds()).toEqual(['mountain-line', 'valley-line', 'pleat-arrow']);
    expect(readDiagram(JSON.parse(JSON.stringify(writeDiagram(state().diagram!))))?.document.steps).toEqual(state().diagram!.steps);
  });
});
