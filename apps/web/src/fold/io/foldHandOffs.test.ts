/**
 * What leaves a Fold sequence, over the session and a fake engine: each
 * hand-off holds the engine, waits for the active path to land, and follows
 * it — Send to Edit the tip's crease pattern, the FOLD export every state of
 * the path, the paper export a page per numbered step — or says why not.
 */
import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { FileService } from '../../platform/fileService';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import type { FoldSequenceDocument } from '../document/foldSequenceDocument';
import type { FoldEngineCalls } from '../engine/foldEngineCalls';
import type { FoldScene } from '../engine/foldEngineWire';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import { fakeFoldEngine, inProcessFoldRuntime, memoryFoldDocument } from '../session/foldSession.fixtures';
import {
  exportFoldSequence,
  openFoldStepsExport,
  sendFoldSequenceToEdit,
  type FoldHandOffDeps,
} from './foldHandOffs';

const t = ((_key: string, english: string, values?: Record<string, unknown>) =>
  english.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))) as unknown as TFunction;

let sessions: FoldSession[] = [];
afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions = [];
});

/** a → b (a turn) → c, the reader on c. */
function sequence(): FoldSequenceDocument {
  return sequenceOf([
    step('a', null, valleyAt(0.5)),
    step('b', 'a', { kind: 'turn', axis: 'vertical' }),
    step('c', 'b', valleyAt(0.25)),
  ]);
}

function setup(document: FoldSequenceDocument = sequence(), cursor: string | null = 'c', exportRefusal?: string) {
  const asked: string[] = [];
  const runtime = inProcessFoldRuntime(() => {
    const base = fakeFoldEngine();
    return Object.assign(base, {
      sendToEdit(state: number, title?: string) {
        asked.push(`sendToEdit:${base.trail(state)?.join('>')}:${title}`);
        return `{"fold":"${state}"}`;
      },
      exportFold(states: readonly number[], title?: string) {
        asked.push(`exportFold:${states.length}:${title}`);
        return exportRefusal
          ? { status: 'refused', refusal: { code: exportRefusal }, fixes: [], faces: [], vertices: [] }
          : { status: 'ok', text: `{"frames":${states.length}}` };
      },
      scene(state: number): FoldScene {
        asked.push(`scene:${base.trail(state)?.at(-1)}`);
        return { creases: [] } as unknown as FoldScene;
      },
    }) as FoldEngineCalls;
  });
  const source = memoryFoldDocument({
    held: { document, readOnlyRaw: null },
    reader: withFoldCursor(initialFoldReaderState(document.id), document, cursor),
  });
  const session = createFoldSession({ document: source, runtime });
  sessions.push(session);
  const saved: Parameters<FileService['saveTextFile']>[0][] = [];
  const deps: FoldHandOffDeps = {
    session,
    t,
    title: () => 'Crane',
    blocked: vi.fn(),
    sendToEdit: vi.fn(async () => true),
    sentToEdit: vi.fn(),
    fileService: () =>
      ({
        saveTextFile: async (options) => {
          saved.push(options);
          return { name: options.suggestedName, path: null };
        },
      }) as FileService,
    exportStyle: () => DEFAULT_PAPER_STYLE,
    openPaperExport: vi.fn(),
  };
  return { deps, asked, runtime, saved, session };
}

describe('Fold’s hand-offs', () => {
  it('sends the tip of the active path to Edit, its precreases as aux lines, holding the engine only while it does', async () => {
    const { deps, asked, runtime } = setup();
    await expect(sendFoldSequenceToEdit(deps)).resolves.toBe(true);
    expect(asked).toEqual(['sendToEdit:sheet:square:front>valley@0.5>turn>valley@0.25:Crane']);
    expect(deps.sendToEdit).toHaveBeenCalledExactlyOnceWith({
      text: expect.stringMatching(/^\{"fold"/),
      format: 'fold',
      label: 'Send to Edit',
      filename: 'Crane.fold',
      unassignedAsAuxiliary: true,
    });
    expect(deps.sentToEdit).toHaveBeenCalledExactlyOnceWith();
    expect(runtime.holders()).toBe(0);
  });

  it('counts a Send to Edit only when Edit took it', async () => {
    const { deps } = setup();
    deps.sendToEdit = vi.fn(async () => false);
    await expect(sendFoldSequenceToEdit(deps)).resolves.toBe(false);
    expect(deps.sentToEdit).not.toHaveBeenCalled();
  });

  it('exports every state of the active path, the sheet first, as one FOLD file', async () => {
    const { deps, asked, saved } = setup();
    await expect(exportFoldSequence(deps)).resolves.toBe(true);
    expect(asked).toEqual(['exportFold:4:Crane']);
    expect(saved).toEqual([
      { title: 'Export Fold Sequence', contents: '{"frames":4}', suggestedName: 'Crane.fold', extensions: ['fold'] },
    ]);
  });

  it('names the files by the rule every export is named by, so a title is never read as a path', async () => {
    const { deps, asked, saved } = setup();
    deps.title = () => 'Crane 1/2: base';
    await expect(exportFoldSequence(deps)).resolves.toBe(true);
    await expect(sendFoldSequenceToEdit(deps)).resolves.toBe(true);
    expect(saved.map((options) => options.suggestedName)).toEqual(['Crane-1-2-base.fold']);
    expect(vi.mocked(deps.sendToEdit).mock.calls[0]?.[0].filename).toBe('Crane-1-2-base.fold');
    // The title inside the file is the sequence's, as it is written.
    expect(asked.every((call) => call.endsWith(':Crane 1/2: base'))).toBe(true);
  });

  it('says when a FOLD file would be too large', async () => {
    const { deps, saved } = setup(sequence(), 'c', 'fold_export_too_large');
    await expect(exportFoldSequence(deps)).resolves.toBe(false);
    expect(deps.blocked).toHaveBeenCalledWith('too-large');
    expect(saved).toEqual([]);
  });

  it('opens the paper export on a page per numbered step, the step on screen in view', async () => {
    const { deps, asked } = setup(sequence(), 'b');
    await expect(openFoldStepsExport(deps, 'this')).resolves.toBe(true);
    // The turn gets no page; the step on screen is the turn, so its page is the one before.
    expect(asked).toEqual(['scene:valley@0.5', 'scene:valley@0.25']);
    const [target, scope] = vi.mocked(deps.openPaperExport).mock.calls[0]!;
    expect(scope).toBe('this');
    expect(target.surface).toBe('fold');
    expect(target.pages?.list.map((page) => page.label)).toEqual(['Step 1', 'Step 2']);
    expect(target.pages?.current).toBe(0);
  });

  it('has no step to export with the flat sheet on screen, and says to go to one, but every step for all of them', async () => {
    const { deps } = setup(sequence(), null);
    await expect(openFoldStepsExport(deps, 'this')).resolves.toBe(false);
    expect(deps.blocked).toHaveBeenCalledExactlyOnceWith('sheet-on-screen');
    await expect(openFoldStepsExport(deps, 'all')).resolves.toBe(true);
  });

  it('has no page for a turn before the first step, though the sequence has steps', async () => {
    const document = sequenceOf([step('t', null, { kind: 'turn', axis: 'vertical' }), step('a', 't', valleyAt(0.5))]);
    const { deps } = setup(document, 't');
    await expect(openFoldStepsExport(deps, 'this')).resolves.toBe(false);
    expect(deps.blocked).toHaveBeenCalledExactlyOnceWith('sheet-on-screen');
  });

  it('has nothing to export from a path of turns alone', async () => {
    const document = sequenceOf([step('t', null, { kind: 'turn', axis: 'vertical' })]);
    const { deps } = setup(document, 't');
    await expect(openFoldStepsExport(deps, 'all')).resolves.toBe(false);
    expect(deps.blocked).toHaveBeenCalledExactlyOnceWith('no-step');
  });

  it('hands off no path with a step that does not land', async () => {
    const locked = { id: 'd', parent: 'c', unknown: { id: 'd', parent: 'c', op: { kind: 'sink' } } };
    const document = { ...sequence(), steps: [...sequence().steps, locked] };
    const { deps, asked } = setup(document, 'd');
    await expect(sendFoldSequenceToEdit(deps)).resolves.toBe(false);
    await expect(exportFoldSequence(deps)).resolves.toBe(false);
    expect(deps.blocked).toHaveBeenCalledWith('path-broken');
    expect(asked).toEqual([]);
  });
});
