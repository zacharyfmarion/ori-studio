/**
 * Import starting sheet over the session and a fake engine with its one call:
 * a pattern's outline becomes the sequence's sheet (and starts it over), an
 * outline the engine or the document cannot hold is refused before anything
 * changes, and what the request names but is no outline is refused too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import type { FoldPaperShape, FoldSequenceDocument } from '../document/foldSequenceDocument';
import type { FoldImportSource, FoldSheetFound } from '../engine/foldEngineIoWire';
import type { FoldEngineOutcome } from '../engine/foldEngineWire';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import { fakeFoldEngine, inProcessFoldRuntime, memoryFoldDocument, settle } from '../session/foldSession.fixtures';
import type { FoldImportRequest } from './foldImportFlow';
import { createFoldStartingSheetFlow, foldStartingShape, type FoldStartingSheetFlow } from './foldStartingSheet';

let flows: FoldStartingSheetFlow[] = [];
let sessions: FoldSession[] = [];

afterEach(() => {
  for (const flow of flows) flow.dispose();
  for (const session of sessions) session.dispose();
  flows = [];
  sessions = [];
});

function setup(document: FoldSequenceDocument | null, answer: FoldEngineOutcome<FoldSheetFound>) {
  const asked: FoldImportSource[] = [];
  const runtime = inProcessFoldRuntime(() =>
    Object.assign(fakeFoldEngine(), {
      importSheet(source: FoldImportSource) {
        asked.push(source);
        return answer;
      },
    })
  );
  let next = 0;
  const source = memoryFoldDocument(
    {
      held: document && { document, readOnlyRaw: null },
      reader: document && withFoldCursor(initialFoldReaderState(document.id), document, null),
    },
    (prefix) => `${prefix}-${(next += 1)}`
  );
  const session = createFoldSession({ document: source, runtime });
  sessions.push(session);
  const adopt = vi.fn((_shape: FoldPaperShape) => true);
  const changed = vi.fn();
  const refused = vi.fn();
  const flow = createFoldStartingSheetFlow({ session, adopt, onChanged: changed, onRefused: refused });
  flows.push(flow);
  return { flow, adopt, changed, refused, asked, runtime };
}

const FILE: FoldImportRequest = { kind: 'file', name: 'hexagon.fold', source: { format: 'fold', text: '{}' } };
const h = Math.sqrt(3) / 2;
const HEXAGON: [number, number][] = [
  [0.25, 0],
  [0.75, 0],
  [1, h / 2],
  [0.75, h],
  [0.25, h],
  [0, h / 2],
];

describe('foldStartingShape', () => {
  it('keeps a square and a rectangle as the document does, and a polygon of 3 to 8 corners', () => {
    expect(foldStartingShape({ shape: 'square' })).toEqual({ kind: 'square' });
    expect(foldStartingShape({ shape: 'rectangle', width: 2, height: 1 })).toEqual({ kind: 'rectangle', aspect: [1, 0.5] });
    expect(foldStartingShape({ shape: 'polygon', points: HEXAGON })).toEqual({ kind: 'polygon', points: HEXAGON });
    // Nine corners would open the file read-only in this build: refused, with how many.
    const nine = Array.from({ length: 9 }, (_, k): [number, number] => [Math.cos(k), Math.sin(k)]);
    expect(foldStartingShape({ shape: 'polygon', points: nine })).toEqual({ refused: 'sheet_sides', sides: 9 });
  });
});

describe('Import starting sheet', () => {
  it('takes the pattern’s outline as the sheet, starting the sequence over, and holds the engine while it lives', async () => {
    const { flow, adopt, changed, asked, runtime } = setup(sequenceOf([step('a', null)]), {
      status: 'ok',
      sheet: { shape: 'polygon', points: HEXAGON },
    });
    expect(runtime.holders()).toBe(1);
    await flow.open(FILE);
    await settle();
    expect(asked).toEqual([{ format: 'fold', text: '{}' }]);
    expect(adopt).toHaveBeenCalledExactlyOnceWith({ kind: 'polygon', points: HEXAGON });
    expect(changed).toHaveBeenCalledExactlyOnceWith({ kind: 'polygon', points: HEXAGON }, 'fold');
    expect(flow.store.getState()).toMatchObject({ phase: 'done', changed: true });
    flow.dispose();
    await settle();
    expect(runtime.holders()).toBe(0);
  });

  it('says why the engine refused an outline, before anything changes', async () => {
    const { flow, adopt, refused } = setup(null, {
      status: 'refused',
      refusal: { code: 'sheet_not_convex' },
      fixes: [],
      faces: [],
      vertices: [],
    } as never);
    await flow.open(FILE);
    await settle();
    expect(adopt).not.toHaveBeenCalled();
    expect(flow.store.getState()).toMatchObject({
      phase: 'refused',
      refusal: { kind: 'local', code: 'sheet_not_convex', name: 'hexagon.fold' },
    });
    expect(refused).toHaveBeenCalledOnce();
  });

  it('passes a border the engine found none in on as the import’s own refusal', async () => {
    const { flow, adopt } = setup(null, {
      status: 'refused',
      refusal: { code: 'import_outline_loops', count: 2 },
      fixes: [],
      faces: [],
      vertices: [],
    } as never);
    await flow.open(FILE);
    await settle();
    expect(adopt).not.toHaveBeenCalled();
    expect(flow.store.getState()).toMatchObject({ phase: 'refused', refusal: { kind: 'engine' } });
  });

  it('refuses a file it cannot read, and a request that names no outline, without asking the engine', async () => {
    const { flow, asked } = setup(null, { status: 'ok', sheet: { shape: 'square' } });
    await flow.open({ kind: 'file', name: 'notes.txt', source: null });
    expect(flow.store.getState()).toMatchObject({ phase: 'refused', refusal: { code: 'unsupported_file' } });
    await flow.open({ kind: 'edit-folded-figure' });
    expect(flow.store.getState()).toMatchObject({ phase: 'refused', refusal: { code: 'unsupported_file' } });
    expect(asked).toEqual([]);
  });
});
