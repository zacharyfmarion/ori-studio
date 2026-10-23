/**
 * The state view the canvas paints from: the step on screen's own scene once
 * it is in; while the next step loads, the last picture stays up — so the
 * panes never blank — but nothing can be picked on it; a step that can have
 * no picture (broken) shows none.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({ session: null as import('../session/foldSession').FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/foldSession')>()),
  foldSession: () => {
    if (!app.session) throw new Error('no session');
    return app.session;
  },
}));

import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import type { FoldEngineCalls } from '../engine/foldEngineCalls';
import { diagonalHalfScene, squareScene } from '../sequence/foldScene.fixtures';
import { createFoldSession } from '../session/foldSession';
import {
  fakeFoldEngine,
  inProcessFoldRuntime,
  memoryFoldDocument,
  settle,
  type InProcessFoldRuntime,
  type MemoryFoldDocument,
} from '../session/foldSession.fixtures';
import { useFoldStateView, type FoldStateView } from './useFoldStateView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** sheet → a → b, and b's sibling c, which no longer folds. */
const document = sequenceOf([
  step('a', null, valleyAt(0.5)),
  step('b', 'a', valleyAt(0.25)),
  step('c', 'a', { ...valleyAt(0.75), kind: 'mountain' }),
]);

/** Every landmarks call the engine answers. */
const landmarks = vi.fn(() => ({ points: [], lines: [], segments: [] }));

/** A scene per state, each its own object: the sheet's flat, every fold's a half. */
function engine(): FoldEngineCalls {
  const fake = fakeFoldEngine({ refuse: (op) => (op.kind === 'mountain' ? 'layer_order' : null) });
  return {
    ...fake,
    scene: (state) => (fake.trail(state)?.length === 1 ? squareScene() : diagonalHalfScene()),
    landmarks,
  };
}

let host: HTMLDivElement;
let root: Root;
let runtime: InProcessFoldRuntime;
let source: MemoryFoldDocument;
let seen: FoldStateView[];

function Probe() {
  const view = useFoldStateView();
  seen.push(view);
  return null;
}

const view = () => seen[seen.length - 1]!;
const moveTo = (cursor: string | null) =>
  source.set({ reader: withFoldCursor(source.read().reader!, document, cursor) });

beforeEach(async () => {
  seen = [];
  runtime = inProcessFoldRuntime(engine);
  source = memoryFoldDocument({
    held: { document, readOnlyRaw: null },
    reader: withFoldCursor(initialFoldReaderState(document.id), document, 'a'),
  });
  app.session = createFoldSession({ document: source, runtime });
  app.session.retain();
  await settle();
  host = document_().createElement('div');
  document_().body.append(host);
  root = createRoot(host);
  act(() => root.render(<Probe />));
  await act(async () => settle());
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  app.session?.dispose();
  app.session = null;
});

/** The DOM's document; `document` here is the Fold sequence. */
function document_(): Document {
  return globalThis.document;
}

describe('the Fold canvas’s state view', () => {
  it('keeps the last picture up while the next step’s scene is on its way, with nothing to pick on it', async () => {
    const atA = view();
    expect(atA.scene).not.toBeNull();
    expect(atA.index).not.toBeNull();
    expect(atA.summary?.step).toBe(1);

    // b's scene is asked of an engine that is busy: the panes keep a's picture.
    const from = seen.length;
    runtime.hold();
    await act(async () => {
      moveTo('b');
      await settle();
    });
    expect(view().cursorId).toBe('b');
    expect(view().scene).toBe(atA.scene);
    expect(view().summary).toBe(atA.summary);
    expect(view().index).toBeNull();

    await act(async () => {
      await runtime.open();
    });
    // Never blank on the way.
    expect(seen.slice(from).some((shown) => shown.scene === null)).toBe(false);
    expect(view().scene).not.toBe(atA.scene);
    expect(view().summary?.step).toBe(2);
    expect(view().index).not.toBeNull();
  });

  it('asks a landed preview’s landmarks while it shows, so the step a commit makes of it can be picked on at once', async () => {
    const session = app.session!;
    await act(async () => {
      await session.preview(valleyAt(0.1));
      await settle();
    });
    const asked = landmarks.mock.calls.length;
    // Committed: the step is on screen with its landmarks in hand, and none asked for it.
    runtime.hold();
    await act(async () => {
      await session.commitStep(valleyAt(0.1));
    });
    const committed = seen.find((shown) => shown.cursorId !== 'a');
    expect(committed?.landmarks).not.toBeNull();
    expect(committed?.index).not.toBeNull();
    await act(async () => {
      await runtime.open();
    });
    expect(landmarks.mock.calls.length).toBe(asked);
  });

  it('shows no picture for a step that cannot have one', async () => {
    await act(async () => {
      moveTo('c');
      await settle();
    });
    expect(view()).toMatchObject({ cursorId: 'c', scene: null, index: null });
  });
});
